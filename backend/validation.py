import datetime as dt
import re

FIELDS = {'nombre', 'telefono', 'usuario_whatsapp', 'correo', 'servicio', 'perfil', 'vence', 'pin', 'negocio', 'pago'}


def validate_workspace(state):
    def fail():
        raise ValueError('Los datos del CRM no son válidos.')

    def strings(item, keys):
        return isinstance(item, dict) and all(isinstance(item.get(key), str) and len(item[key]) <= 8000 for key in keys)

    def date(value, optional=True):
        if optional and value == '':
            return True
        try:
            return re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is not None and dt.date.fromisoformat(value).isoformat() == value
        except (ValueError, TypeError):
            return False

    def amount(value):
        return type(value) is int and 0 <= value <= 99999900

    if not isinstance(state, dict) or state.get('version') != 2:
        fail()
    for key in ['clients', 'accounts', 'templates', 'combos', 'ledger']:
        rows = state.get(key)
        if not isinstance(rows, list) or len(rows) > 10000 or not all(strings(row, ['id']) and row['id'] for row in rows):
            fail()
        if len({row['id'] for row in rows}) != len(rows):
            fail()
    for c in state['clients']:
        if not strings(c, ['id', 'name', 'email', 'phone', 'service', 'profile', 'expires', 'notes', 'accountId', 'pin']) or not c['name'].strip() or not date(c['expires']) or not amount(c.get('price')):
            fail()
        if 'whatsappUsername' in c and (not isinstance(c['whatsappUsername'], str) or len(c['whatsappUsername']) > 100):
            fail()
        if 'reminderConsent' in c and type(c['reminderConsent']) is not bool:
            fail()
    for a in state['accounts']:
        if not strings(a, ['id', 'service', 'email', 'provider', 'expires']) or not a['service'].strip() or not date(a['expires'], False) or type(a.get('capacity')) is not int or not 1 <= a['capacity'] <= 50:
            fail()
        if 'password' in a and (not isinstance(a['password'], str) or len(a['password']) > 512):
            fail()
        assigned = [c for c in state['clients'] if c['accountId'] == a['id']]
        valid = {f'Perfil {n}' for n in range(1, a['capacity'] + 1)}
        if any(c['profile'] not in valid for c in assigned) or len({c['profile'] for c in assigned}) != len(assigned):
            fail()
    if any(c['accountId'] and not any(a['id'] == c['accountId'] for a in state['accounts']) for c in state['clients']):
        fail()
    if not state['templates']:
        fail()
    for t in state['templates']:
        if not strings(t, ['id', 'name', 'body']) or not t['name'].strip() or not t['body'].strip() or ('context' in t and not isinstance(t['context'], str)):
            fail()
    for c in state['combos']:
        if not strings(c, ['id', 'name', 'services']) or not c['name'].strip() or not c['services'].strip() or not amount(c.get('price')):
            fail()
    for m in state['ledger']:
        if not strings(m, ['id', 'description', 'service', 'kind', 'date']) or m['kind'] not in ['sale', 'renewal', 'expense'] or not date(m['date'], False) or not amount(m.get('amount')):
            fail()
    for m in state['ledger']:
        if 'clientId' in m and not isinstance(m['clientId'], str):
            fail()
    settings = state.get('settings')
    if not strings(settings, ['business', 'payments']) or type(settings.get('dark')) is not bool:
        fail()
    if 'crmName' in settings and (not isinstance(settings['crmName'], str) or len(settings['crmName']) > 80):
        fail()
    if 'logoDataUrl' in settings and (not isinstance(settings['logoDataUrl'], str) or len(settings['logoDataUrl']) > 150000 or (settings['logoDataUrl'] and not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+', settings['logoDataUrl']))):
        fail()
    automation = state.get('automation', {'enabled': False, 'templateName': '', 'language': 'es', 'parameters': ['nombre', 'servicio', 'vence'], 'hour': 9})
    if not isinstance(automation, dict) or type(automation.get('enabled')) is not bool or type(automation.get('hour')) is not int or not 0 <= automation['hour'] <= 23:
        fail()
    if not strings(automation, ['templateName', 'language']) or not re.fullmatch(r'[a-z]{2,3}(?:_[A-Z]{2})?', automation['language']):
        fail()
    if automation['templateName'] and not re.fullmatch(r'[a-z0-9_]{1,512}', automation['templateName']):
        fail()
    if automation['enabled'] and not automation['templateName']:
        raise ValueError('Indica el nombre de la plantilla aprobada por Meta.')
    if not isinstance(automation.get('parameters'), list) or len(automation['parameters']) > 20 or any(not isinstance(v, str) or v not in FIELDS for v in automation['parameters']):
        fail()
    rules = state.get('rules', [])
    receipts = state.get('taskReceipts', [])
    if not isinstance(rules, list) or len(rules) > 10000 or not all(strings(r, ['id']) and r['id'] for r in rules) or len({r['id'] for r in rules}) != len(rules):
        fail()
    for r in rules:
        if not strings(r, ['name', 'templateId', 'delivery']) or not r['name'].strip() or len(r['name']) > 200 or len(r['id']) > 200 or type(r.get('enabled')) is not bool or type(r.get('daysBefore')) is not int or abs(r['daysBefore']) > 365 or type(r.get('hour')) is not int or not 0 <= r['hour'] <= 23 or r['delivery'] not in ['manual', 'integration', 'meta'] or not isinstance(r.get('services'), list) or len(r['services']) > 1000 or any(not isinstance(v, str) or len(v) > 200 for v in r['services']):
            fail()
        template = next((t for t in state['templates'] if t['id'] == r['templateId']), None)
        if r['enabled'] and (not template or '{contrasena}' in template['body']):
            raise ValueError('Una regla activa necesita una plantilla existente sin contraseña.')
        m = r.get('meta')
        if not strings(m, ['templateName', 'language']) or not re.fullmatch(r'[a-z]{2,3}(?:_[A-Z]{2})?', m['language']) or (m['templateName'] and not re.fullmatch(r'[a-z0-9_]{1,512}', m['templateName'])) or not isinstance(m.get('parameters'), list) or len(m['parameters']) > 20 or any(not isinstance(v, str) or v not in FIELDS for v in m['parameters']):
            fail()
        if r['enabled'] and r['delivery'] == 'meta' and not m['templateName']:
            raise ValueError('Indica la plantilla aprobada para activar esta regla de Meta.')
    if not isinstance(receipts, list) or len(receipts) > 10000 or not all(strings(r, ['id', 'signature', 'completedAt']) and re.fullmatch(r'[a-f0-9]{64}', r['signature']) for r in receipts) or len({r['id'] for r in receipts}) != len(receipts):
        fail()
    for receipt in receipts:
        try:
            dt.datetime.fromisoformat(receipt['completedAt'].replace('Z', '+00:00'))
        except ValueError:
            fail()
    growth = state.get('growth', {'segments': [], 'campaigns': [], 'posts': [], 'interactions': [], 'scoring': {'email': 10, 'phone': 10, 'active': 20, 'paid': 30}})
    if not isinstance(growth, dict) or not isinstance(growth.get('scoring'), dict) or any(type(growth['scoring'].get(k)) is not int or not 0 <= growth['scoring'][k] <= 100 for k in ['email', 'phone', 'active', 'paid']):
        fail()
    growth_keys = {'segments': ['id','name','query','service','status','persona','minScore'], 'campaigns': ['id','name','channel','segmentId','subject','body','status'], 'posts': ['id','name','network','body','scheduledAt','status'], 'interactions': ['id','name','clientId','network','kind','body','agent','outcome','occurredAt']}
    networks = ['Facebook','Instagram','LinkedIn','TikTok','X','Google Business']
    for key, fields in growth_keys.items():
        rows = growth.get(key)
        if not isinstance(rows, list) or len(rows) > 10000 or any(not strings(r, [k for k in fields if k != 'minScore']) or not r['id'] or not r['name'].strip() for r in rows) or len({r['id'] for r in rows}) != len(rows):
            fail()
    for r in growth['segments']:
        if r['status'] not in ['all','active','soon','expired','none'] or type(r['minScore']) is not int or not 0 <= r['minScore'] <= 100:
            fail()
    for r in growth['campaigns']:
        if r['channel'] not in ['email','whatsapp','rss'] or r['status'] != 'draft' or not r['body'].strip() or (r['segmentId'] and not any(x['id'] == r['segmentId'] for x in growth['segments'])):
            fail()
    for r in growth['posts'] + growth['interactions']:
        if r['network'] not in networks or not r['body'].strip():
            fail()
        stamp = r.get('scheduledAt', r.get('occurredAt', ''))
        if stamp:
            try:
                dt.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            except ValueError:
                fail()
    for r in growth['posts']:
        if r['status'] != 'draft':
            fail()
    for r in growth['interactions']:
        if not r['clientId'] or not r['occurredAt'] or r['kind'] not in ['comment','dm','review'] or r['outcome'] not in ['open','answered','won']:
            fail()
    procurement = state.get('procurement', {'suppliers': [], 'offers': []})
    procurement_keys = {'suppliers': ['id','name','email','phone','notes'], 'offers': ['id','name','supplierId','type','costCents','intervalMonths','capacity','notes']}
    if not isinstance(procurement, dict):
        fail()
    for key, fields in procurement_keys.items():
        rows = procurement.get(key)
        if not isinstance(rows, list) or len(rows) > 10000 or any(not strings(r, [k for k in fields if k not in ['costCents','intervalMonths','capacity']]) or not r['id'] or not r['name'].strip() for r in rows) or len({r['id'] for r in rows}) != len(rows):
            fail()
    for o in procurement['offers']:
        if o['type'] not in ['product','business'] or not any(s['id'] == o['supplierId'] for s in procurement['suppliers']) or not amount(o['costCents']) or type(o['intervalMonths']) is not int or not 0 <= o['intervalMonths'] <= 36 or type(o['capacity']) is not int or not 1 <= o['capacity'] <= 50:
            fail()
    for a in state['accounts']:
        if any(k in a and not isinstance(a[k], str) for k in ['supplierId','offerId']) or ('costCents' in a and not amount(a['costCents'])) or ('costIntervalMonths' in a and (type(a['costIntervalMonths']) is not int or not 0 <= a['costIntervalMonths'] <= 36)):
            fail()
        if a.get('supplierId') and not any(s['id'] == a['supplierId'] for s in procurement['suppliers']):
            fail()
        if a.get('offerId') and not any(o['id'] == a['offerId'] and o['supplierId'] == a.get('supplierId') and o['type'] == 'product' for o in procurement['offers']):
            fail()
    for m in state['ledger']:
        if any(k in m and (not isinstance(m[k], str) or len(m[k]) > 8000) for k in ['supplierId','offerId','accountId','category','reference']):
            fail()
    # Preserve explicit account credentials, but never arbitrary tokens or unknown fields.
    keys = {
        'clients': ['id', 'name', 'email', 'phone', 'whatsappUsername', 'service', 'profile', 'expires', 'notes', 'accountId', 'pin', 'price', 'reminderConsent'],
        'accounts': ['id', 'service', 'email', 'provider', 'expires', 'capacity', 'password', 'supplierId','offerId','costCents','costIntervalMonths'],
        'templates': ['id', 'name', 'body', 'context'],
        'combos': ['id', 'name', 'services', 'price'],
        'ledger': ['id', 'description', 'service', 'kind', 'date', 'amount', 'clientId','supplierId','offerId','accountId','category','reference'],
    }
    clean = {'version': 2, 'settings': {k: settings[k] for k in ['business', 'payments', 'dark', 'crmName', 'logoDataUrl'] if k in settings}, 'automation': {k: automation[k] for k in ['enabled', 'templateName', 'language', 'parameters', 'hour']}}
    clean['procurement'] = {key: [{k:r[k] for k in fields} for r in procurement[key]] for key,fields in procurement_keys.items()}
    clean['growth'] = {key: [{k: r[k] for k in fields} for r in growth[key]] for key, fields in growth_keys.items()}
    clean['growth']['scoring'] = {k: growth['scoring'][k] for k in ['email','phone','active','paid']}
    clean['rules'] = [{k: r[k] for k in ['id', 'name', 'templateId', 'delivery', 'enabled', 'daysBefore', 'hour', 'services']} | {'meta': {k: r['meta'][k] for k in ['templateName', 'language', 'parameters']}} for r in rules]
    clean['taskReceipts'] = [{k: r[k] for k in ['id', 'signature', 'completedAt']} for r in receipts]
    for collection, allowed in keys.items():
        clean[collection] = [{k: row[k] for k in allowed if k in row} for row in state[collection]]
    return clean
