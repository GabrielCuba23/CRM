"""Private five-line registry and durable, explicitly enabled chatbot attempts.

The application's existing authentication and Origin/CSRF hooks protect these
routes. No endpoint sends a WhatsApp message or stores a browser password.
"""
import copy
import datetime as dt
import hashlib
import hmac
import json
import math
import re
import secrets
import time
import unicodedata
from contextlib import closing
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import jsonify, request

from .storage import connect


class EngagementError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def empty_config():
    return {'revision': 0, 'lines': [], 'bot': {'enabled': False, 'rules': [],
            'cooldownSeconds': 60, 'timezone': 'America/Lima',
            'hours': {'enabled': False, 'start': '09:00', 'end': '18:00', 'days': list(range(1, 8))}}}


def _text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or required and not value.strip():
        raise EngagementError('Completa los datos de líneas y chatbot con valores válidos.')
    return value.strip() if required else value


def _bool(value):
    if type(value) is not bool:
        raise EngagementError('Una opción de líneas o chatbot no es válida.')
    return value


def _phone(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9]\d{6,14}', value):
        raise EngagementError('Introduce el número con código de país, sin espacios.')
    return value


def _media(value):
    if not isinstance(value, list) or len(value) > 10:
        raise EngagementError('Cada respuesta admite hasta 10 archivos.')
    result = []
    for item in value:
        if not isinstance(item, dict) or not re.fullmatch(r'[a-f0-9]{32}', str(item.get('id', ''))) or item.get('type') not in ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'] or type(item.get('size')) is not int or not 1 <= item['size'] <= 20971520 or not re.fullmatch(r'[a-f0-9]{64}', str(item.get('sha256', ''))):
            raise EngagementError('Un archivo de la respuesta no es válido.')
        result.append({key: item[key] for key in ['id', 'type', 'size', 'sha256']} | {'name': _text(item.get('name'), 200, True)})
    if len({item['id'] for item in result}) != len(result) or sum(item['size'] for item in result) > 20971520:
        raise EngagementError('Los adjuntos superan 20 MiB o están repetidos.')
    return result


def _flow_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value) or value.lower() in ['__proto__', 'prototype', 'constructor', 'password', 'contrasena', 'token', 'secret']:
        raise EngagementError('Un identificador del flujo no es válido.')
    return value


def _node_text(node, variables=None):
    text = _render_flow_text(node['text'], variables or {})
    if node['type'] == 'menu':
        text = '\n'.join(([text] if text else []) + [item['key'] + '. ' + _render_flow_text(item['label'], variables or {}) for item in node['options']])
    return text


def _flow_reply(texts, media):
    text = '\n\n'.join(part for part in texts if part != '')
    by_id = {}
    for item in media:
        if item['id'] in by_id and item != by_id[item['id']]:
            raise EngagementError('Un adjunto tiene metadatos distintos en el flujo.')
        by_id.setdefault(item['id'], item)
    media = list(by_id.values())
    if len(text) > 8000 or len(media) > 10 or sum(item['size'] for item in media) > 20971520:
        raise EngagementError('La respuesta completa del flujo supera el tamaño permitido.')
    return {'text': text, 'media': copy.deepcopy(media)}


def clean_flows(value):
    """Validate a small, deterministic flow graph; no executable expressions."""
    if not isinstance(value, list) or len(value) > 20:
        raise EngagementError('Puedes configurar hasta 20 flujos de conversación.')
    result = []
    for flow in value:
        if not isinstance(flow, dict) or not isinstance(flow.get('nodes'), list) or not 1 <= len(flow['nodes']) <= 50:
            raise EngagementError('Cada flujo necesita entre 1 y 50 pasos.')
        nodes = []
        variables = set()
        for node in flow['nodes']:
            if not isinstance(node, dict) or node.get('type') not in ['message', 'menu', 'question', 'end', 'handoff']:
                raise EngagementError('Un paso del flujo no es válido.')
            kind = node['type']
            row = {'id': _flow_id(node.get('id')), 'type': kind,
                   'text': _text(node.get('text', ''), 8000), 'media': _media(node.get('media', []))}
            if kind in ['message', 'question']:
                row['nextNodeId'] = _flow_id(node.get('nextNodeId'))
            if kind in ['menu', 'question'] and 'invalidText' in node:
                row['invalidText'] = _text(node.get('invalidText', ''), 1000)
            if kind == 'question':
                variable = _text(node.get('variable'), 40, True)
                if not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]{0,39}', variable) or variable.lower() in ['__proto__', 'prototype', 'constructor', 'contrasena', 'password', 'token', 'secret']:
                    raise EngagementError('El nombre de la respuesta del flujo no es válido.')
                variables.add(variable.lower())
                row['variable'] = variable
                row['validation'] = node.get('validation', 'text')
                if row['validation'] not in ['text', 'number', 'email', 'phone']:
                    raise EngagementError('La validación de la respuesta no es válida.')
            if kind == 'menu':
                options = node.get('options')
                if not isinstance(options, list) or not 1 <= len(options) <= 10:
                    raise EngagementError('Cada menú admite entre 1 y 10 opciones.')
                row['options'] = []
                for option in options:
                    if not isinstance(option, dict):
                        raise EngagementError('Una opción del menú no es válida.')
                    key = _text(option.get('key'), 20, True)
                    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,19}', key) or _normalized(key) in ['0', 'menu', 'inicio', 'salir', 'cancelar']:
                        raise EngagementError('Las claves del menú no son válidas; 0 y menú se reservan para reiniciar.')
                    row['options'].append({'key': key, 'label': _text(option.get('label'), 160, True), 'nextNodeId': _flow_id(option.get('nextNodeId'))})
                if len({_normalized(option['key']) for option in row['options']}) != len(row['options']) or len({_normalized(option['label']) for option in row['options']}) != len(row['options']):
                    raise EngagementError('Las opciones del menú necesitan claves distintas.')
            if kind != 'menu' and not row['text'].strip() and not row['media']:
                raise EngagementError('Escribe el mensaje de cada paso o añade un archivo.')
            nodes.append(row)
        ids = {node['id'] for node in nodes}
        if len(ids) != len(nodes) or len(variables) > 20:
            raise EngagementError('Hay pasos repetidos o demasiadas respuestas en el flujo.')
        entry = _flow_id(flow.get('entryNodeId'))
        if entry not in ids:
            raise EngagementError('El paso inicial del flujo no existe.')
        by_id = {node['id']: node for node in nodes}
        for node in nodes:
            targets = [item['nextNodeId'] for item in node.get('options', [])] + ([node['nextNodeId']] if node.get('nextNodeId') else [])
            if any(target not in ids for target in targets):
                raise EngagementError('Un paso apunta a otro paso que no existe.')
            seen, parts, media = set(), [], []
            cursor = node
            while True:
                if cursor['id'] in seen:
                    raise EngagementError('El flujo contiene un ciclo de mensajes sin esperar una respuesta.')
                seen.add(cursor['id'])
                parts.append(_node_text(cursor))
                media.extend(cursor['media'])
                if cursor['type'] != 'message':
                    break
                cursor = by_id[cursor['nextNodeId']]
            _flow_reply(parts, media)
            if node['type'] in ['menu', 'question']:
                invalid = node.get('invalidText') or ('Elige una opción de la lista.' if node['type'] == 'menu' else 'La respuesta no tiene el formato esperado. Inténtalo otra vez.')
                _flow_reply([invalid, _node_text(node)], node['media'])
        keywords = flow.get('triggerKeywords', [])
        if not isinstance(keywords, list) or len(keywords) > 30:
            raise EngagementError('Un flujo admite hasta 30 frases de inicio.')
        result.append({'id': _flow_id(flow.get('id')), 'name': _text(flow.get('name'), 160, True),
                       'enabled': _bool(flow.get('enabled', False)), 'entryNodeId': entry,
                       'triggerKeywords': [_text(item, 100, True) for item in keywords], 'nodes': nodes})
    if len({flow['id'] for flow in result}) != len(result):
        raise EngagementError('Hay flujos con el mismo identificador.')
    return result


def clean_config(value):
    if not isinstance(value, dict) or type(value.get('revision')) is not int or value['revision'] < 0:
        raise EngagementError('La revisión de líneas y chatbot no es válida.')
    lines, bot = value.get('lines'), value.get('bot')
    if not isinstance(lines, list) or len(lines) > 5 or not isinstance(bot, dict):
        raise EngagementError('Puedes configurar hasta cinco líneas independientes.')
    cleaned_lines = []
    for row in lines:
        if not isinstance(row, dict):
            raise EngagementError('La línea no es válida.')
        cleaned_lines.append({'id': _text(row.get('id'), 100, True),
                              'name': _text(row.get('name'), 160, True),
                              'phone': _phone(row.get('phone')),
                              'enabled': _bool(row.get('enabled', False)),
                              'allowBackground': _bool(row.get('allowBackground', False))})
    if len({row['id'] for row in cleaned_lines}) != len(lines) or len({row['phone'] for row in cleaned_lines}) != len(lines):
        raise EngagementError('Cada línea necesita un identificador y teléfono distintos.')
    rules = bot.get('rules', [])
    cooldown = bot.get('cooldownSeconds', 60)
    if not isinstance(rules, list) or len(rules) > 50 or type(cooldown) is not int or not 0 <= cooldown <= 86400:
        raise EngagementError('Las reglas o el tiempo entre respuestas no son válidos.')
    zone = _text(bot.get('timezone', 'America/Lima'), 80, True)
    try:
        ZoneInfo(zone)
    except (ValueError, ZoneInfoNotFoundError):
        raise EngagementError('La zona horaria no es válida.') from None
    hours = bot.get('hours', empty_config()['bot']['hours'])
    if not isinstance(hours, dict):
        raise EngagementError('El horario no es válido.')
    enabled = _bool(hours.get('enabled', False))
    start, end = hours.get('start', '09:00'), hours.get('end', '18:00')
    if not all(isinstance(x, str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', x) for x in [start, end]):
        raise EngagementError('Introduce un horario de 00:00 a 23:59.')
    days = hours.get('days', list(range(1, 8)))
    if not isinstance(days, list) or len(days) > 7 or any(type(x) is not int or not 1 <= x <= 7 for x in days) or len(set(days)) != len(days) or enabled and not days:
        raise EngagementError('Elige los días de atención.')
    flows = clean_flows(bot.get('flows', []))
    flow_ids = {flow['id'] for flow in flows}
    default_flow = _text(bot.get('defaultFlowId', ''), 100)
    if default_flow and default_flow not in flow_ids:
        raise EngagementError('El flujo predeterminado no existe.')
    cleaned_rules = []
    for row in rules:
        if not isinstance(row, dict) or row.get('match') not in ['exact', 'contains', 'fallback']:
            raise EngagementError('El tipo de regla no es válido.')
        keywords = row.get('keywords', [])
        if not isinstance(keywords, list) or len(keywords) > 30:
            raise EngagementError('La regla admite hasta 30 palabras o frases.')
        keywords = [_text(x, 100, True) for x in keywords]
        if row['match'] != 'fallback' and not keywords:
            raise EngagementError('Añade una palabra o frase a la regla.')
        cleaned_media = _media(row.get('media', []))
        text = _text(row.get('text', ''), 8000)
        flow_id = _text(row.get('flowId', ''), 100)
        if flow_id and flow_id not in flow_ids:
            raise EngagementError('El flujo de la regla no existe.')
        if not text.strip() and not cleaned_media and not flow_id:
            raise EngagementError('Escribe una respuesta o añade un archivo.')
        cleaned_rules.append({'id': _text(row.get('id'), 100, True), 'name': _text(row.get('name'), 160, True),
                              'enabled': _bool(row.get('enabled', False)), 'match': row['match'],
                              'keywords': keywords, 'text': text, 'media': cleaned_media})
        if 'flowId' in row:
            cleaned_rules[-1]['flowId'] = flow_id
    if len({row['id'] for row in cleaned_rules}) != len(cleaned_rules):
        raise EngagementError('Hay reglas con el mismo identificador.')
    result = {'revision': value['revision'], 'lines': cleaned_lines,
              'bot': {'enabled': _bool(bot.get('enabled', False)), 'rules': cleaned_rules,
                      'cooldownSeconds': cooldown, 'timezone': zone,
                      'hours': {'enabled': enabled, 'start': start, 'end': end, 'days': days}}}
    if 'flows' in bot:
        result['bot']['flows'] = flows
    if 'defaultFlowId' in bot:
        result['bot']['defaultFlowId'] = default_flow
    if 'conversationTtlMinutes' in bot:
        ttl = bot['conversationTtlMinutes']
        if type(ttl) is not int or not 1 <= ttl <= 1440:
            raise EngagementError('La duración de la conversación debe ser de 1 a 1440 minutos.')
        result['bot']['conversationTtlMinutes'] = ttl
    if len(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()) > 700000:
        raise EngagementError('La configuración supera el tamaño permitido.', 413)
    return result


def _normalized(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', value) if not unicodedata.combining(c)).lower().split())


def in_hours(bot, now):
    hours = bot['hours']
    if not hours['enabled']:
        return True
    local = dt.datetime.fromtimestamp(now, ZoneInfo(bot['timezone']))
    minutes = local.hour * 60 + local.minute
    start, end = [int(x[:2]) * 60 + int(x[3:]) for x in [hours['start'], hours['end']]]
    if start == end:
        return local.isoweekday() in hours['days']
    if start < end:
        return local.isoweekday() in hours['days'] and start <= minutes < end
    day = local.isoweekday() if minutes >= start else (local.isoweekday() - 2) % 7 + 1
    return day in hours['days'] and (minutes >= start or minutes < end)


def match_rule(bot, text, now):
    if not bot['enabled'] or not in_hours(bot, now):
        return None
    text = _normalized(text)
    fallback = None
    for row in bot['rules']:
        if not row['enabled']:
            continue
        if row['match'] == 'fallback':
            fallback = fallback or row
        elif any(text == _normalized(key) if row['match'] == 'exact' else _normalized(key) in text for key in row['keywords']):
            return row
    return fallback


def _render_flow_text(text, variables):
    lookup = {key.lower(): item for key, item in variables.items()}
    return re.sub(r'\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}', lambda match: str(lookup.get(match[1].lower(), match[0])), text)


def advance_flow(flow, state, incoming_text):
    """Compute a reply without mutating the stored conversation."""
    by_id = {node['id']: node for node in flow['nodes']}
    incoming = _normalized(incoming_text)
    if state is not None and (not isinstance(state, dict) or state.get('flowId') != flow['id'] or state.get('nodeId') not in by_id):
        raise EngagementError('El paso guardado ya no existe. Reinicia la conversación.', 409)
    if state:
        values = state.get('variables', {})
        if not isinstance(values, dict) or len(values) > 20 or len({key.lower() for key in values}) != len(values):
            raise EngagementError('Los datos de la conversación no son válidos.', 409)
        for key, item in values.items():
            if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,39}', key) or key.lower() in ['prototype', 'constructor', 'contrasena', 'password', 'token', 'secret'] or not isinstance(item, str) or len(item) > 1000:
                raise EngagementError('Los datos de la conversación no son válidos.', 409)
        if type(state.get('ended', False)) is not bool or type(state.get('waiting', False)) is not bool or type(state.get('handoff', False)) is not bool or state.get('handoff') and not state.get('ended'):
            raise EngagementError('El estado de la conversación no es válido.', 409)
    active = bool(state and not state.get('ended'))
    variables = dict(state.get('variables', {})) if active else {}
    current = by_id[state['nodeId']] if active else by_id[flow['entryNodeId']]
    accepted, reason, prefix = True, 'started' if not active else 'advanced', ''
    if incoming in ['salir', 'cancelar']:
        current = by_id[state['nodeId']] if state else by_id[flow['entryNodeId']]
        variables = dict(state.get('variables', {})) if state else {}
        next_state = {'flowId': flow['id'], 'nodeId': current['id'], 'variables': variables, 'waiting': False, 'ended': True, 'handoff': False}
        return {'reply': {'text': 'Conversación finalizada. Escribe menú para comenzar de nuevo.', 'media': []}, 'nextState': next_state, 'waiting': False, 'ended': True, 'handoff': False, 'accepted': True, 'reason': 'cancelled'}
    if state and state.get('handoff') and incoming not in ['0', 'menu', 'inicio']:
        return dict(reply=None, nextState=copy.deepcopy(state), waiting=False, ended=True, handoff=True, accepted=False, reason='handoff')
    if incoming in ['0', 'menu', 'inicio']:
        variables, current, reason = {}, by_id[flow['entryNodeId']], 'restart'
    elif active and current['type'] == 'menu':
        choice = next((option for option in current['options'] if incoming in [_normalized(option['key']), _normalized(option['label']), _normalized(option['key'] + '. ' + option['label'])]), None)
        if choice:
            current = by_id[choice['nextNodeId']]
        else:
            accepted, reason = False, 'invalid'
            prefix = current.get('invalidText') or 'Elige una opción de la lista.'
    elif active and current['type'] == 'question':
        answer, validation = incoming_text.strip(), current.get('validation', 'text')
        valid = bool(answer and len(answer) <= 1000)
        if validation == 'number':
            valid = valid and bool(re.fullmatch(r'[+-]?\d+(?:[.,]\d+)?', answer))
            if valid:
                answer = answer.replace(',', '.')
                valid = math.isfinite(float(answer))
        elif validation == 'email':
            valid = valid and len(answer) <= 254 and bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', answer))
        elif validation == 'phone':
            valid = valid and bool(re.fullmatch(r'\+?[\d\s().-]+', answer))
            if valid:
                digits = re.sub(r'\D', '', answer)
                if answer.startswith('00'):
                    digits = digits[2:]
                answer = '51' + digits if len(digits) == 9 else digits
                valid = bool(re.fullmatch(r'[1-9]\d{6,14}', answer))
        if valid:
            variables = {key: item for key, item in variables.items() if key.lower() != current['variable'].lower()}
            variables[current['variable']] = answer
            target = current.get('nextNodeId')
            current = by_id[target]
        else:
            accepted, reason = False, 'invalid'
            prefix = current.get('invalidText') or 'La respuesta no tiene el formato esperado. Inténtalo otra vez.'
    texts, media, seen = [], [], set()
    if prefix:
        texts.append(_render_flow_text(prefix, variables))
    while True:
        if current['id'] in seen:
            raise EngagementError('El flujo tiene un ciclo de mensajes sin respuesta.', 409)
        seen.add(current['id'])
        text = _node_text(current, variables)
        if text != '':
            texts.append(text)
        media.extend(copy.deepcopy(current['media']))
        if current['type'] != 'message' or not current.get('nextNodeId'):
            break
        current = by_id[current['nextNodeId']]
    reply = _flow_reply(texts, media)
    waiting = current['type'] in ['menu', 'question']
    handoff = current['type'] == 'handoff'
    next_state = {'flowId': flow['id'], 'nodeId': current['id'], 'variables': variables, 'waiting': waiting, 'ended': not waiting, 'handoff': handoff}
    return dict(reply=reply, nextState=next_state, waiting=waiting, ended=not waiting, handoff=handoff, accepted=accepted, reason=reason)


def _identity(value):
    chat_id, phone = value.get('chatId', ''), value.get('phone', '')
    if phone not in ['', None]:
        phone = _phone(phone)
    else:
        phone = ''
    if chat_id:
        if not isinstance(chat_id, str) or len(chat_id) > 300 or not re.fullmatch(r'wa:[^\s\x00-\x1f\x7f]{1,297}', chat_id):
            raise EngagementError('La identidad del chat no es válida.')
        return 'chat:' + _hash(chat_id), chat_id, phone
    if not phone:
        raise EngagementError('Identifica el chat o introduce su teléfono con código de país.')
    return 'phone:' + phone, '', phone


def _conversation(db, line_id, contact_key, now):
    row = db.execute('SELECT * FROM engagement_conversations WHERE line_id=? AND contact_key=?', (line_id, contact_key)).fetchone()
    if row and row['pending_claim']:
        attempt = db.execute('SELECT * FROM engagement_bot_attempts WHERE id=?', (row['pending_claim'],)).fetchone()
        if attempt and attempt['status'] == 'pending' and attempt['created'] <= now - 90:
            db.execute("UPDATE engagement_bot_attempts SET status='uncertain',updated=?,error='El intento se interrumpió. Revisa WhatsApp antes de reiniciar.' WHERE id=? AND status='pending'", (now, attempt['id']))
            db.execute('UPDATE engagement_conversations SET blocked=1,pending_claim=\'\',updated=? WHERE line_id=? AND contact_key=?', (now, line_id, contact_key))
            row = db.execute('SELECT * FROM engagement_conversations WHERE line_id=? AND contact_key=?', (line_id, contact_key)).fetchone()
    return row


def _expire_conversations(db, now):
    stale = db.execute("SELECT c.line_id,c.contact_key,c.pending_claim FROM engagement_conversations c JOIN engagement_bot_attempts a ON a.id=c.pending_claim WHERE a.status='pending' AND a.created<=?", (now - 90,)).fetchall()
    for row in stale:
        db.execute("UPDATE engagement_bot_attempts SET status='uncertain',updated=?,error='El intento se interrumpió. Revisa WhatsApp antes de reiniciar.' WHERE id=? AND status='pending'", (now, row['pending_claim']))
        db.execute("UPDATE engagement_conversations SET blocked=1,pending_claim='',updated=? WHERE line_id=? AND contact_key=?", (now, row['line_id'], row['contact_key']))
    db.execute("UPDATE engagement_conversations SET state_json='null',revision=revision+1 WHERE expires<=? AND blocked=1 AND state_json<>'null'", (now,))
    db.execute("DELETE FROM engagement_conversations WHERE expires<=? AND blocked=0 AND pending_claim=''", (now,))


def _conversation_state(row, now):
    if not row or row['expires'] <= now:
        return None
    try:
        state = json.loads(row['state_json'])
    except (ValueError, TypeError):
        return None
    return state if isinstance(state, dict) else None


def _select_response(bot, state, incoming_text, now, requested_rule=''):
    if not bot['enabled']:
        return None, {'reason': 'disabled'}, False
    if not in_hours(bot, now):
        return None, {'reason': 'outside_hours'}, False
    flows = [flow for flow in bot.get('flows', []) if flow['enabled']]
    restarting = _normalized(incoming_text) in ['0', 'menu', 'inicio']
    if isinstance(state, dict) and state.get('handoff') and not restarting:
        return None, {'reason': 'handoff'}, False
    active = bool(isinstance(state, dict) and (not state.get('ended') or restarting))
    flow = next((flow for flow in flows if active and state.get('flowId') == flow['id']), None)
    if active and not flow:
        return None, {'reason': 'rule_changed'}, False
    matching = match_rule(bot, incoming_text, now)
    if not flow:
        hinted = next((row for row in bot['rules'] if row['enabled'] and row['id'] == requested_rule), None)
        if hinted and hinted.get('flowId'):
            flow = next((flow for flow in flows if flow['id'] == hinted['flowId']), None)
        if not flow:
            text = _normalized(incoming_text)
            if text:
                flow = next((flow for flow in flows if any(_normalized(word) in text for word in flow['triggerKeywords'])), None)
                if not flow:
                    linked = next((row for row in bot['rules'] if row['enabled'] and row.get('flowId') and (row['match'] == 'fallback' or any(text == _normalized(key) if row['match'] == 'exact' else _normalized(key) in text for key in row['keywords']))), None)
                    flow = next((flow for flow in flows if linked and flow['id'] == linked['flowId']), None)
                if not flow:
                    flow = next((flow for flow in flows if flow['id'] == bot.get('defaultFlowId')), None)
    if flow:
        transition = advance_flow(flow, state if active else None, incoming_text)
        if transition['reply'] is None:
            return None, transition, active
        rule = {'id': 'flow:' + flow['id'], 'name': flow['name'], 'enabled': True, 'match': 'flow', 'keywords': [], 'flowId': flow['id'], **transition['reply']}
        return rule, transition, active
    if requested_rule and (not matching or requested_rule != matching['id']):
        return None, {'reason': 'rule_changed'}, False
    return matching, {'reason': 'no_match'} if matching is None else None, False


def _input(limit=16384):
    if request.content_length is not None and request.content_length > limit:
        raise EngagementError('La solicitud supera el tamaño permitido.', 413)
    raw = request.stream.read(limit + 1)
    if len(raw) > limit:
        raise EngagementError('La solicitud supera el tamaño permitido.', 413)
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        raise EngagementError('Usa una solicitud JSON válida.') from None
    if not isinstance(value, dict):
        raise EngagementError('Usa un objeto JSON válido.')
    return value


def _hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _read(db):
    row = db.execute('SELECT revision,body FROM engagement_config WHERE id=1').fetchone()
    return dict(json.loads(row['body']), revision=row['revision']) if row else empty_config()


def _public(db, config, now):
    result = copy.deepcopy(config)
    leases = {row['line_id']: row for row in db.execute('SELECT * FROM engagement_leases WHERE expires>?', (now,))}
    for line in result['lines']:
        lease = leases.get(line['id'])
        online = bool(line['enabled'] and lease and lease['phone'] == line['phone'])
        line.update(online=online, leaseExpiresAt=lease['expires'] if online else 0)
    return dict(result, serverTime=now)


def _lease(db, value, config, now):
    line_id, install, token = value.get('lineId'), value.get('installationId'), value.get('leaseToken')
    if not isinstance(line_id, str) or not re.fullmatch(r'[a-f0-9]{32}', str(install)) or not re.fullmatch(r'[a-f0-9]{64}', str(token)):
        raise EngagementError('La conexión de la línea no es válida.', 409)
    line = next((x for x in config['lines'] if x['id'] == line_id and x['enabled']), None)
    lease = db.execute('SELECT * FROM engagement_leases WHERE line_id=? AND installation_id=? AND token_hash=? AND expires>?', (line_id, install, _hash(token), now)).fetchone()
    if not line or not lease or line['phone'] != lease['phone']:
        raise EngagementError('La línea se desconectó. Vuelve a activarla en este perfil.', 409)
    return line, lease


def register_engagement(app, db_path):
    with closing(connect(db_path)) as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS engagement_config(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS engagement_leases(line_id TEXT PRIMARY KEY,installation_id TEXT NOT NULL,token_hash TEXT NOT NULL,phone TEXT NOT NULL,expires INTEGER NOT NULL,updated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS engagement_bot_attempts(id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,line_id TEXT NOT NULL,phone TEXT NOT NULL,incoming_id TEXT NOT NULL,rule_id TEXT NOT NULL,rule_name TEXT NOT NULL,rule_body TEXT NOT NULL,config_revision INTEGER NOT NULL,token_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','sent_observed','failed','uncertain')),created INTEGER NOT NULL,updated INTEGER NOT NULL,evidence TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '');
            CREATE INDEX IF NOT EXISTS engagement_bot_attempts_updated ON engagement_bot_attempts(updated);
            CREATE INDEX IF NOT EXISTS engagement_bot_attempts_phone ON engagement_bot_attempts(line_id,phone,created);
            CREATE TABLE IF NOT EXISTS engagement_conversations(line_id TEXT NOT NULL,contact_key TEXT NOT NULL,chat_id TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',state_json TEXT NOT NULL DEFAULT 'null',revision INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL,updated INTEGER NOT NULL,blocked INTEGER NOT NULL DEFAULT 0,pending_claim TEXT NOT NULL DEFAULT '',PRIMARY KEY(line_id,contact_key));
            CREATE INDEX IF NOT EXISTS engagement_conversations_updated ON engagement_conversations(updated);
        ''')
        columns = {row['name'] for row in db.execute('PRAGMA table_info(engagement_bot_attempts)')}
        for name in ['contact_key', 'chat_id', 'next_state']:
            if name not in columns:
                db.execute('ALTER TABLE engagement_bot_attempts ADD COLUMN ' + name + " TEXT NOT NULL DEFAULT ''")
        db.execute("UPDATE engagement_bot_attempts SET status='uncertain',error='Intento anterior a la actualización. Revisa WhatsApp antes de continuar.' WHERE status='pending' AND contact_key=''")
        db.execute('CREATE INDEX IF NOT EXISTS engagement_bot_attempts_contact ON engagement_bot_attempts(line_id,contact_key,created)')
        db.commit()

    def check_media(db, config):
        responses = config['bot']['rules'] + [node for flow in config['bot'].get('flows', []) for node in flow['nodes']]
        for rule in responses:
            for item in rule['media']:
                row = db.execute("SELECT * FROM outreach_media WHERE id=? AND state='ready'", (item['id'],)).fetchone()
                if not row or any(row[key] != item[key] for key in ['type', 'size', 'sha256']):
                    raise EngagementError('Un adjunto del chatbot cambió o no terminó de subir.', 409)

    @app.route('/api/engagement', methods=['GET', 'PUT'])
    @app.route('/api/engagement/<path:suffix>', methods=['GET', 'POST'])
    def engagement(suffix=None):
        try:
            now = int(time.time())
            with closing(connect(db_path)) as db:
                if suffix is None and request.method == 'GET':
                    return jsonify(_public(db, _read(db), now))
                if suffix == 'history' and request.method == 'GET':
                    rows = db.execute('SELECT * FROM engagement_bot_attempts ORDER BY created DESC,id DESC LIMIT 100').fetchall()
                    items = []
                    for row in rows:
                        item = {key: row[column] for key, column in [('id', 'id'), ('lineId', 'line_id'), ('phone', 'phone'), ('chatId', 'chat_id'), ('contactKey', 'contact_key'), ('incomingId', 'incoming_id'), ('ruleId', 'rule_id'), ('ruleName', 'rule_name'), ('status', 'status'), ('createdAt', 'created'), ('updatedAt', 'updated'), ('evidence', 'evidence'), ('error', 'error')]}
                        if item['status'] == 'pending' and item['createdAt'] <= now - 90:
                            item.update(status='uncertain', error=item['error'] or 'El intento se interrumpió. Revisa WhatsApp antes de repetir.')
                        items.append(item)
                    return jsonify(items=items)
                if suffix == 'conversations' and request.method == 'GET':
                    filters, parameters = [], []
                    line_id = request.args.get('lineId')
                    if line_id:
                        filters.append('line_id=?')
                        parameters.append(_text(line_id, 100, True))
                    if request.args.get('chatId') or request.args.get('phone'):
                        contact_key, _, _ = _identity(request.args)
                        filters.append('contact_key=?')
                        parameters.append(contact_key)
                    elif request.args.get('contactKey'):
                        filters.append('contact_key=?')
                        parameters.append(_text(request.args['contactKey'], 100, True))
                    query = 'SELECT * FROM engagement_conversations' + (' WHERE ' + ' AND '.join(filters) if filters else '') + ' ORDER BY updated DESC LIMIT 100'
                    db.execute('BEGIN IMMEDIATE')
                    _expire_conversations(db, now)
                    rows = db.execute(query, parameters).fetchall()
                    items = []
                    for row in rows:
                        row = _conversation(db, row['line_id'], row['contact_key'], now)
                        state = _conversation_state(row, now)
                        items.append({'lineId': row['line_id'], 'contactKey': row['contact_key'], 'chatId': row['chat_id'], 'phone': row['phone'], 'state': state, 'revision': row['revision'], 'expiresAt': row['expires'], 'updatedAt': row['updated'], 'blocked': bool(row['blocked']), 'pending': bool(row['pending_claim']), 'active': bool(state and not state.get('ended') and not row['blocked'])})
                    db.commit()
                    return jsonify(items=items, serverTime=now)
                if request.method not in ['POST', 'PUT']:
                    raise EngagementError('Operación no permitida.', 405)
                value = _input(700000 if suffix is None else 16384)
                db.execute('BEGIN IMMEDIATE')
                config = _read(db)
                if suffix == 'conversations/reset':
                    line_id = _text(value.get('lineId'), 100, True)
                    if not any(line['id'] == line_id for line in config['lines']):
                        raise EngagementError('La línea no existe.', 404)
                    supplied_key = value.get('contactKey')
                    if value.get('chatId') or value.get('phone'):
                        contact_key, _, _ = _identity(value)
                        if supplied_key and supplied_key != contact_key:
                            raise EngagementError('La identidad del chat no coincide.', 409)
                    elif isinstance(supplied_key, str) and re.fullmatch(r'(?:chat:[a-f0-9]{64}|phone:[1-9]\d{6,14})', supplied_key):
                        contact_key = supplied_key
                    else:
                        raise EngagementError('Identifica la conversación que quieres reiniciar.')
                    db.execute("UPDATE engagement_bot_attempts SET status='failed',updated=?,error='Conversación reiniciada por el administrador.' WHERE line_id=? AND contact_key=? AND status='pending'", (now, line_id, contact_key))
                    db.execute("UPDATE engagement_conversations SET state_json='null',revision=revision+1,expires=?,updated=?,blocked=0,pending_claim='' WHERE line_id=? AND contact_key=?", (now + config['bot'].get('conversationTtlMinutes', 30) * 60, now, line_id, contact_key))
                    db.commit()
                    return jsonify(ok=True, reset=True, contactKey=contact_key)
                if suffix is None and request.method == 'PUT':
                    cleaned = clean_config(value)
                    if cleaned['revision'] != config['revision']:
                        raise EngagementError('La configuración cambió en otra sesión. Actualiza antes de guardar.', 409)
                    check_media(db, cleaned)
                    cleaned['revision'] += 1
                    db.execute('INSERT INTO engagement_config(id,revision,body) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body', (cleaned['revision'], json.dumps(cleaned, ensure_ascii=False, separators=(',', ':'))))
                    db.commit()
                    return jsonify(_public(db, cleaned, now))
                if suffix == 'stop':
                    config['bot']['enabled'] = False
                    config['revision'] += 1
                    db.execute('INSERT INTO engagement_config(id,revision,body) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body', (config['revision'], json.dumps(config, ensure_ascii=False, separators=(',', ':'))))
                    db.execute('DELETE FROM engagement_leases')
                    db.commit()
                    return jsonify(_public(db, config, now))
                if suffix == 'lease':
                    line_id = _text(value.get('lineId'), 100, True)
                    install = value.get('installationId')
                    if not isinstance(install, str) or not re.fullmatch(r'[a-f0-9]{32}', install):
                        raise EngagementError('El perfil de Chrome no es válido.')
                    line = next((x for x in config['lines'] if x['id'] == line_id and x['enabled']), None)
                    if not line:
                        raise EngagementError('Esta línea no está habilitada.', 409)
                    previous = db.execute('SELECT * FROM engagement_leases WHERE line_id=?', (line_id,)).fetchone()
                    if previous and previous['expires'] > now:
                        raise EngagementError('Esta línea ya está activa en otro perfil o sesión.', 409)
                    token = secrets.token_hex(32)
                    db.execute('INSERT INTO engagement_leases(line_id,installation_id,token_hash,phone,expires,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(line_id) DO UPDATE SET installation_id=excluded.installation_id,token_hash=excluded.token_hash,phone=excluded.phone,expires=excluded.expires,updated=excluded.updated', (line_id, install, _hash(token), line['phone'], now + 120, now))
                    db.commit()
                    return jsonify(leaseToken=token, expiresAt=now + 120, config=_public(db, config, now)), 201
                if suffix in ['lease/heartbeat', 'lease/release']:
                    line, lease = _lease(db, value, config, now)
                    if suffix.endswith('/release'):
                        db.execute('DELETE FROM engagement_leases WHERE line_id=? AND token_hash=?', (line['id'], lease['token_hash']))
                        db.commit()
                        return jsonify(released=True)
                    db.execute('UPDATE engagement_leases SET expires=?,updated=? WHERE line_id=? AND token_hash=?', (now + 120, now, line['id'], lease['token_hash']))
                    db.commit()
                    return jsonify(expiresAt=now + 120, config=_public(db, config, now))
                if suffix == 'bot/result':
                    claim_id, token = value.get('claimId'), value.get('claimToken')
                    if not isinstance(claim_id, str) or not re.fullmatch(r'[a-f0-9]{32}', claim_id) or not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{64}', token):
                        raise EngagementError('El intento del chatbot no es válido.', 409)
                    row = db.execute('SELECT * FROM engagement_bot_attempts WHERE id=?', (claim_id,)).fetchone()
                    if not row or not hmac.compare_digest(row['token_hash'], _hash(token)):
                        raise EngagementError('El intento del chatbot no es válido.', 409)
                    state = value.get('status')
                    if state not in ['sent_observed', 'failed', 'uncertain']:
                        raise EngagementError('El resultado del chatbot no es válido.')
                    if row['status'] != 'pending' and row['status'] != state:
                        raise EngagementError('Este intento ya tiene un resultado. No se puede sobrescribir.', 409)
                    if row['status'] == 'pending':
                        conversation = _conversation(db, row['line_id'], row['contact_key'], now) if row['contact_key'] else None
                        if conversation and (conversation['pending_claim'] != claim_id or conversation['blocked']):
                            db.commit()
                            raise EngagementError('La conversación cambió o requiere revisión antes de continuar.', 409)
                        transition = json.loads(row['next_state']) if row['next_state'] else None
                        if state == 'sent_observed' and transition and conversation['revision'] != transition['baseRevision']:
                            raise EngagementError('La conversación cambió antes de confirmar el envío.', 409)
                        if conversation:
                            if state == 'sent_observed':
                                next_state = json.dumps(transition['nextState'], ensure_ascii=False, separators=(',', ':')) if transition else conversation['state_json']
                                ttl = config['bot'].get('conversationTtlMinutes', 30) * 60
                                db.execute("UPDATE engagement_conversations SET state_json=?,revision=revision+1,expires=?,updated=?,pending_claim='' WHERE line_id=? AND contact_key=? AND pending_claim=?", (next_state, now + ttl, now, row['line_id'], row['contact_key'], claim_id))
                            else:
                                db.execute("UPDATE engagement_conversations SET blocked=?,updated=?,pending_claim='' WHERE line_id=? AND contact_key=? AND pending_claim=?", (int(state == 'uncertain'), now, row['line_id'], row['contact_key'], claim_id))
                        db.execute('UPDATE engagement_bot_attempts SET status=?,updated=?,evidence=?,error=? WHERE id=? AND status=\'pending\'', (state, now, _text(value.get('evidence', ''), 1000), _text(value.get('error', ''), 1000), claim_id))
                    db.commit()
                    return jsonify(ok=True, status=state)
                if suffix in ['bot/claim', 'bot/permit']:
                    try:
                        line, lease = _lease(db, value, config, now)
                    except EngagementError:
                        if suffix == 'bot/permit':
                            return jsonify(allowed=False)
                        raise
                    if suffix == 'bot/permit':
                        claim_id, token = value.get('claimId'), value.get('claimToken')
                        row = db.execute('SELECT * FROM engagement_bot_attempts WHERE id=?', (claim_id,)).fetchone() if isinstance(claim_id, str) else None
                        allowed = bool(row and isinstance(token, str) and hmac.compare_digest(row['token_hash'], _hash(token)) and row['line_id'] == line['id'] and row['status'] == 'pending' and row['created'] > now - 90 and row['config_revision'] == config['revision'] and config['bot']['enabled'] and in_hours(config['bot'], now))
                        if allowed and (row['chat_id'] or value.get('chatId') or value.get('phone')):
                            try:
                                key, _, _ = _identity(value)
                                allowed = key == row['contact_key']
                            except EngagementError:
                                allowed = False
                        if allowed:
                            snapshot = json.loads(row['rule_body'])
                            flow_id = snapshot.get('flowId')
                            allowed = any(flow['id'] == flow_id and flow['enabled'] for flow in config['bot'].get('flows', [])) if flow_id else any(rule['id'] == row['rule_id'] and rule['enabled'] for rule in config['bot']['rules'])
                        if row and row['contact_key']:
                            conversation = _conversation(db, row['line_id'], row['contact_key'], now)
                            allowed = bool(allowed and conversation and not conversation['blocked'] and conversation['pending_claim'] == row['id'])
                        db.commit()
                        return jsonify(allowed=allowed)
                    contact_key, chat_id, phone = _identity(value)
                    incoming = _text(value.get('incomingId'), 300, True)
                    incoming_text = _text(value.get('incomingText'), 8000)
                    requested_rule = _text(value.get('ruleId', ''), 100)
                    _expire_conversations(db, now)
                    dedupe = _hash(line['id'] + '\0' + incoming)
                    if db.execute('SELECT 1 FROM engagement_bot_attempts WHERE dedupe_key=?', (dedupe,)).fetchone():
                        db.commit()
                        return jsonify(claimed=False, reason='duplicate')
                    conversation = _conversation(db, line['id'], contact_key, now)
                    if conversation and (conversation['blocked'] or conversation['pending_claim']):
                        db.commit()
                        return jsonify(claimed=False, reason='conversation_blocked' if conversation['blocked'] else 'conversation_busy')
                    stored_state = _conversation_state(conversation, now)
                    rule, transition, active_flow = _select_response(config['bot'], stored_state, incoming_text, now, requested_rule)
                    if not rule:
                        db.commit()
                        return jsonify(claimed=False, reason=transition.get('reason', 'no_match') if transition else 'no_match')
                    if not active_flow and db.execute("SELECT 1 FROM engagement_bot_attempts WHERE line_id=? AND (contact_key=? OR (contact_key='' AND phone<>'' AND phone=?)) AND created>?", (line['id'], contact_key, phone, now - config['bot']['cooldownSeconds'])).fetchone():
                        db.commit()
                        return jsonify(claimed=False, reason='cooldown')
                    if db.execute('SELECT COUNT(*) FROM engagement_bot_attempts').fetchone()[0] >= 10000:
                        db.commit()
                        return jsonify(claimed=False, reason='history_limit')
                    if not conversation:
                        db.execute("DELETE FROM engagement_conversations WHERE expires<=? AND blocked=0 AND pending_claim=''", (now,))
                        if db.execute('SELECT COUNT(*) FROM engagement_conversations').fetchone()[0] >= 5000:
                            db.commit()
                            return jsonify(claimed=False, reason='conversation_limit')
                        db.execute('INSERT INTO engagement_conversations(line_id,contact_key,chat_id,phone,expires,updated) VALUES(?,?,?,?,?,?)', (line['id'], contact_key, chat_id, phone, now + config['bot'].get('conversationTtlMinutes', 30) * 60, now))
                        conversation = db.execute('SELECT * FROM engagement_conversations WHERE line_id=? AND contact_key=?', (line['id'], contact_key)).fetchone()
                    claim_id, token = secrets.token_hex(16), secrets.token_hex(32)
                    next_state = json.dumps({'baseRevision': conversation['revision'], 'nextState': transition['nextState'], 'flowId': rule['flowId']}, ensure_ascii=False, separators=(',', ':')) if transition else ''
                    db.execute("INSERT INTO engagement_bot_attempts(id,dedupe_key,line_id,phone,incoming_id,rule_id,rule_name,rule_body,config_revision,token_hash,status,created,updated,contact_key,chat_id,next_state) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)", (claim_id, dedupe, line['id'], phone, incoming, rule['id'], rule['name'], json.dumps(rule, ensure_ascii=False, separators=(',', ':')), config['revision'], _hash(token), now, now, contact_key, chat_id, next_state))
                    db.execute('UPDATE engagement_conversations SET chat_id=?,phone=CASE WHEN ?<>\'\' THEN ? ELSE phone END,pending_claim=?,updated=? WHERE line_id=? AND contact_key=?', (chat_id, phone, phone, claim_id, now, line['id'], contact_key))
                    db.commit()
                    response = dict(claimed=True, claimId=claim_id, claimToken=token, rule=rule, reply={'text': rule['text'], 'media': rule['media']}, flowId=rule.get('flowId', ''), configRevision=config['revision'], contactKey=contact_key, chatId=chat_id)
                    if transition:
                        response['transition'] = {key: transition[key] for key in ['waiting', 'ended', 'handoff', 'accepted', 'reason']}
                    return jsonify(response)
                raise EngagementError('Recurso no encontrado.', 404)
        except EngagementError as error:
            return jsonify(error=str(error)), error.status

