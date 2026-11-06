"""Private five-line registry and durable, explicitly enabled chatbot attempts.

The application's existing authentication and Origin/CSRF hooks protect these
routes. No endpoint sends a WhatsApp message or stores a browser password.
"""
import copy
import datetime as dt
import hashlib
import hmac
import json
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
        media = row.get('media', [])
        if not isinstance(media, list) or len(media) > 10:
            raise EngagementError('Cada respuesta admite hasta 10 archivos.')
        cleaned_media = []
        for item in media:
            if not isinstance(item, dict) or not re.fullmatch(r'[a-f0-9]{32}', str(item.get('id', ''))) or item.get('type') not in ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'] or type(item.get('size')) is not int or not 1 <= item['size'] <= 20971520 or not re.fullmatch(r'[a-f0-9]{64}', str(item.get('sha256', ''))):
                raise EngagementError('Un archivo de la respuesta no es válido.')
            cleaned_media.append({key: item[key] for key in ['id', 'type', 'size', 'sha256']} | {'name': _text(item.get('name'), 200, True)})
        if len({x['id'] for x in cleaned_media}) != len(cleaned_media) or sum(x['size'] for x in cleaned_media) > 20971520:
            raise EngagementError('Los adjuntos superan 20 MiB o están repetidos.')
        text = _text(row.get('text', ''), 8000)
        if not text.strip() and not cleaned_media:
            raise EngagementError('Escribe una respuesta o añade un archivo.')
        cleaned_rules.append({'id': _text(row.get('id'), 100, True), 'name': _text(row.get('name'), 160, True),
                              'enabled': _bool(row.get('enabled', False)), 'match': row['match'],
                              'keywords': keywords, 'text': text, 'media': cleaned_media})
    if len({row['id'] for row in cleaned_rules}) != len(cleaned_rules):
        raise EngagementError('Hay reglas con el mismo identificador.')
    result = {'revision': value['revision'], 'lines': cleaned_lines,
              'bot': {'enabled': _bool(bot.get('enabled', False)), 'rules': cleaned_rules,
                      'cooldownSeconds': cooldown, 'timezone': zone,
                      'hours': {'enabled': enabled, 'start': start, 'end': end, 'days': days}}}
    if len(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()) > 600000:
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
        ''')

    def check_media(db, config):
        for rule in config['bot']['rules']:
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
                        item = {key: row[column] for key, column in [('id', 'id'), ('lineId', 'line_id'), ('phone', 'phone'), ('incomingId', 'incoming_id'), ('ruleId', 'rule_id'), ('ruleName', 'rule_name'), ('status', 'status'), ('createdAt', 'created'), ('updatedAt', 'updated'), ('evidence', 'evidence'), ('error', 'error')]}
                        if item['status'] == 'pending' and item['createdAt'] <= now - 90:
                            item.update(status='uncertain', error=item['error'] or 'El intento se interrumpió. Revisa WhatsApp antes de repetir.')
                        items.append(item)
                    return jsonify(items=items)
                if request.method not in ['POST', 'PUT']:
                    raise EngagementError('Operación no permitida.', 405)
                value = _input(700000 if suffix is None else 16384)
                db.execute('BEGIN IMMEDIATE')
                config = _read(db)
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
                        allowed = bool(row and isinstance(token, str) and hmac.compare_digest(row['token_hash'], _hash(token)) and row['line_id'] == line['id'] and row['status'] == 'pending' and row['created'] > now - 90 and row['config_revision'] == config['revision'] and config['bot']['enabled'] and in_hours(config['bot'], now) and any(x['id'] == row['rule_id'] and x['enabled'] for x in config['bot']['rules']))
                        return jsonify(allowed=allowed)
                    phone = _phone(value.get('phone'))
                    incoming = _text(value.get('incomingId'), 300, True)
                    incoming_text = _text(value.get('incomingText'), 8000)
                    rule_id = _text(value.get('ruleId'), 100, True)
                    rule = match_rule(config['bot'], incoming_text, now)
                    if not rule or rule['id'] != rule_id:
                        return jsonify(claimed=False, reason='rule_or_hours')
                    dedupe = _hash(line['id'] + '\0' + incoming)
                    if db.execute('SELECT 1 FROM engagement_bot_attempts WHERE dedupe_key=?', (dedupe,)).fetchone():
                        return jsonify(claimed=False, reason='duplicate')
                    if db.execute('SELECT 1 FROM engagement_bot_attempts WHERE line_id=? AND phone=? AND created>?', (line['id'], phone, now - config['bot']['cooldownSeconds'])).fetchone():
                        return jsonify(claimed=False, reason='cooldown')
                    if db.execute('SELECT COUNT(*) FROM engagement_bot_attempts').fetchone()[0] >= 10000:
                        return jsonify(claimed=False, reason='history_limit')
                    claim_id, token = secrets.token_hex(16), secrets.token_hex(32)
                    db.execute("INSERT INTO engagement_bot_attempts(id,dedupe_key,line_id,phone,incoming_id,rule_id,rule_name,rule_body,config_revision,token_hash,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)", (claim_id, dedupe, line['id'], phone, incoming, rule_id, rule['name'], json.dumps(rule, ensure_ascii=False, separators=(',', ':')), config['revision'], _hash(token), now, now))
                    db.commit()
                    return jsonify(claimed=True, claimId=claim_id, claimToken=token, rule=rule, configRevision=config['revision'])
                raise EngagementError('Recurso no encontrado.', 404)
        except EngagementError as error:
            return jsonify(error=str(error)), error.status

