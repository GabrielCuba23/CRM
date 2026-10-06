import datetime as dt
import re

FIELDS = {'nombre', 'telefono', 'correo', 'servicio', 'perfil', 'vence', 'pin', 'negocio', 'pago'}


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
        if 'reminderConsent' in c and type(c['reminderConsent']) is not bool:
            fail()
    for a in state['accounts']:
        if not strings(a, ['id', 'service', 'email', 'provider', 'expires']) or not a['service'].strip() or not date(a['expires'], False) or type(a.get('capacity')) is not int or not 1 <= a['capacity'] <= 50:
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
    settings = state.get('settings')
    if not strings(settings, ['business', 'payments']) or type(settings.get('dark')) is not bool:
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
    # Preserve only known schema fields. Never copy tokens/passwords from an imported file.
    keys = {
        'clients': ['id', 'name', 'email', 'phone', 'service', 'profile', 'expires', 'notes', 'accountId', 'pin', 'price', 'reminderConsent'],
        'accounts': ['id', 'service', 'email', 'provider', 'expires', 'capacity'],
        'templates': ['id', 'name', 'body', 'context'],
        'combos': ['id', 'name', 'services', 'price'],
        'ledger': ['id', 'description', 'service', 'kind', 'date', 'amount'],
    }
    clean = {'version': 2, 'settings': {k: settings[k] for k in ['business', 'payments', 'dark']}, 'automation': {k: automation[k] for k in ['enabled', 'templateName', 'language', 'parameters', 'hour']}}
    for collection, allowed in keys.items():
        clean[collection] = [{k: row[k] for k in allowed if k in row} for row in state[collection]]
    return clean
