"""Run continuously, separately from the web process: python -m backend.worker."""
import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

from .storage import connect, initialize, read_workspace

LIMA = ZoneInfo('America/Lima')


class SendFailure(Exception):
    def __init__(self, code='unknown', retry_safe=False):
        self.code, self.retry_safe = code, retry_safe


def normalize_phone(value):
    raw = value.strip()
    if not raw or re.search(r'[^\d+\s().-]', raw) or ('+' in raw and not re.fullmatch(r'\+[^+]*', raw)):
        raise ValueError('Teléfono no válido.')
    number = re.sub(r'\D', '', raw)
    if number.startswith('00'):
        number = number[2:]
    if not raw.startswith('+') and len(number) == 9 and number.startswith('9'):
        number = '51' + number
    if not re.fullmatch(r'[1-9]\d{7,14}', number) or (number.startswith('51') and not re.fullmatch(r'519\d{8}', number)):
        raise ValueError('Teléfono no válido.')
    return number


def build_message(client, automation, settings):
    values = {
        'nombre': client['name'], 'telefono': client['phone'], 'usuario_whatsapp': client.get('whatsappUsername') or 'No indicado', 'correo': client['email'] or 'No indicado',
        'servicio': client['service'] or 'Tu servicio', 'perfil': client['profile'] or 'No indicado',
        'vence': dt.date.fromisoformat(client['expires']).strftime('%d/%m/%Y'),
        'pin': client.get('pin') or 'Sin PIN', 'negocio': settings['business'] or 'Nuestro equipo',
        'pago': settings['payments'] or 'Consulta los medios de pago',
    }
    parameters = [{'type': 'text', 'text': values[key]} for key in automation['parameters']]
    template = {'name': automation['templateName'], 'language': {'code': automation['language']}}
    if parameters:
        template['components'] = [{'type': 'body', 'parameters': parameters}]
    return {'messaging_product': 'whatsapp', 'to': normalize_phone(client['phone']), 'type': 'template', 'template': template}


def send_meta(payload):
    token = os.environ.get('WHATSAPP_ACCESS_TOKEN', '')
    phone_id = os.environ.get('WHATSAPP_PHONE_NUMBER_ID', '')
    version = os.environ.get('WHATSAPP_API_VERSION', 'v23.0')
    if not token or not re.fullmatch(r'\d+', phone_id) or not re.fullmatch(r'v\d+\.\d+', version):
        raise SendFailure('configuration')
    url = f'https://graph.facebook.com/{version}/{phone_id}/messages'
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.load(response)
            provider_id = data.get('messages', [{}])[0].get('id')
            if not provider_id:
                raise SendFailure('unknown')
            return provider_id
    except urllib.error.HTTPError as error:
        # Do not log provider response bodies, credentials or message contents.
        code = f'HTTP_{error.code}'
        raise SendFailure(code, retry_safe=error.code == 429) from None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError, KeyError, IndexError):
        # A timeout can occur after Meta accepts the message. Never blindly resend.
        raise SendFailure('unknown') from None


def process_due(db_path, now=None, sender=None):
    now = now or dt.datetime.now(LIMA)
    now = now.astimezone(LIMA)
    timestamp = int(now.timestamp())
    state, _ = read_workspace(db_path)
    automation = state.get('automation', {})
    configured = sender is not None or all(os.environ.get(k) for k in ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'])
    status = 'disabled' if not automation.get('enabled') else 'missing_configuration' if not configured else 'running'
    with connect(db_path) as db:
        db.execute('INSERT OR REPLACE INTO worker_health VALUES(1,?,?)', (timestamp, status))
    if status != 'running' or now.hour < automation.get('hour', 9):
        return 0
    sender = sender or send_meta
    target = (now.date() + dt.timedelta(days=3)).isoformat()
    accepted = 0
    for client in state['clients']:
        if client['expires'] != target or not client.get('reminderConsent', False):
            continue
        with connect(db_path) as db:
            db.execute('BEGIN IMMEDIATE')
            # Renewals, opt-out and disabling the rule invalidate old candidates.
            current = db.execute('SELECT body FROM workspace WHERE id=1').fetchone()
            latest = json.loads(current['body']) if current else state
            latest_client = next((c for c in latest['clients'] if c['id'] == client['id']), None)
            if not latest.get('automation', {}).get('enabled') or not latest_client or latest_client['expires'] != target or not latest_client.get('reminderConsent', False):
                continue
            client = latest_client
            automation = latest['automation']
            previous = db.execute('SELECT * FROM reminders WHERE client_id=? AND expires=?', (client['id'], target)).fetchone()
            if previous:
                # Automatic retry only for explicit rate-limit rejections; all ambiguous results need review.
                if previous['state'] != 'rate_limited' or timestamp - previous['attempted'] < 900:
                    continue
            db.execute('INSERT OR REPLACE INTO reminders VALUES(?,?,?,?,?,?)', (client['id'], target, 'processing', timestamp, None, None))
        try:
            payload = build_message(client, automation, latest['settings'])
            provider_id = sender(payload)
            result, error = 'accepted', None
            accepted += 1
        except ValueError:
            result, error, provider_id = 'rejected', 'invalid_phone', None
        except SendFailure as failure:
            result = 'rate_limited' if failure.retry_safe else 'uncertain' if failure.code == 'unknown' else 'rejected'
            error, provider_id = failure.code, None
        except Exception:
            result, error, provider_id = 'uncertain', 'unknown', None
        with connect(db_path) as db:
            db.execute('UPDATE reminders SET state=?,provider_id=?,error=? WHERE client_id=? AND expires=?', (result, provider_id, error, client['id'], target))
    return accepted


def main():
    db_path = os.environ.get('CRM_DB_PATH', '/workspace/crm-data/crm.sqlite3')
    initialize(db_path)
    print('Trabajador de recordatorios iniciado. Sin datos personales en los registros.', flush=True)
    while True:
        try:
            process_due(db_path)
        except Exception:
            print('No se pudo completar la revisión; se volverá a revisar en un minuto.', flush=True)
        time.sleep(60)


if __name__ == '__main__':
    main()
