"""Reuse the private single-owner CRM after an owner activates their own host."""

import hashlib
import hmac
import html
import re
import time
from pathlib import Path

from flask import jsonify, make_response, redirect, render_template, request, send_from_directory
from werkzeug.security import generate_password_hash

from backend.app import create_app as create_crm_app
from backend.storage import connect

ROOT = Path(__file__).resolve().parent


def create_tenant_app(registry, identifier, testing=False):
    instance = registry.get(identifier)
    if not instance:
        raise ValueError('Instancia no encontrada.')
    public_url = registry.tenant_url(instance)
    path = registry.database(identifier)
    # Explicit empty bootstrap credentials prevent inheritance from a personal CRM.
    app = create_crm_app({'DB_PATH': path, 'PUBLIC_URL': public_url, 'OWNER_EMAIL': '',
                          'OWNER_PASSWORD': '', 'ALLOW_HTTP': False, 'TESTING': testing})
    app.template_folder = str(ROOT / 'templates')
    authority = public_url.removeprefix('https://')

    def activation():
        if request.headers.get('Origin') != public_url or not request.is_json:
            return jsonify(error='Origen o formato no permitido.'), 403
        data = request.get_json(silent=True)
        if (not isinstance(data, dict) or not isinstance(data.get('token'), str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', data['token'])
                or not isinstance(data.get('email'), str) or len(data['email']) > 254
                or not isinstance(data.get('password'), str) or not 12 <= len(data['password']) <= 1024):
            return jsonify(error='Usa el enlace de activación, tu correo y una contraseña de al menos 12 caracteres.'), 400
        now, ip = int(time.time()), request.remote_addr or 'unknown'
        with connect(path) as customer_db:
            customer_db.execute('DELETE FROM login_attempts WHERE attempted<?', (now - 900,))
            total = customer_db.execute('SELECT COUNT(*) FROM login_attempts').fetchone()[0]
            per_ip = customer_db.execute('SELECT COUNT(*) FROM login_attempts WHERE ip=?', (ip,)).fetchone()[0]
            if total >= 50 or per_ip >= 8:
                return jsonify(error='Demasiados intentos. Espera 15 minutos.'), 429
            customer_db.execute('INSERT INTO login_attempts VALUES(?,?)', (ip, now))
        with registry.connect() as db:
            # Serialize invite consumption. No operator reset or impersonation exists.
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM instances WHERE id=?', (identifier,)).fetchone()
            valid = (row and row['status'] == 'pending' and row['activated_at'] is None
                     and (row['invitation_expires'] or 0) > now
                     and hmac.compare_digest(row['invitation_hash'] or '', hashlib.sha256(data['token'].encode()).hexdigest())
                     and hmac.compare_digest(row['owner_email'].encode('utf-8'), data['email'].strip().lower().encode('utf-8')))
            if not valid:
                return jsonify(error='El enlace o correo no es válido, o la invitación ya venció.'), 401
            password_hash = generate_password_hash(data['password'])
            with connect(path) as customer_db:
                # Never replace an existing owner's password, including crash recovery.
                if customer_db.execute('SELECT id FROM owner WHERE id=1').fetchone():
                    return jsonify(error='La activación necesita revisión del administrador del servidor.'), 409
                customer_db.execute('INSERT INTO owner VALUES(1,?,?)', (row['owner_email'], password_hash))
                customer_db.execute('DELETE FROM sessions')
                customer_db.execute('DELETE FROM login_attempts')
            db.execute('UPDATE instances SET status=\'active\',activated_at=?,invitation_hash=NULL,invitation_expires=NULL WHERE id=?', (now, identifier))
        return jsonify(ok=True, loginUrl='/login')

    def gate():
        if request.environ.get('HTTP_HOST', '') != authority:
            return jsonify(error='Dominio no reconocido.'), 404
        row = registry.get(identifier)
        if not row or row['status'] == 'suspended':
            return jsonify(error='Este CRM está suspendido. Contacta con tu proveedor.'), 403
        if request.path == '/retail-static/activate.js' and request.method == 'GET':
            return send_from_directory(ROOT / 'static', 'activate.js')
        if request.path == '/retail-static/panel.css' and request.method == 'GET':
            return send_from_directory(ROOT / 'static', 'panel.css')
        if request.path == '/activate':
            if request.method != 'GET':
                return jsonify(error='Método no permitido.'), 405
            if row['activated_at'] is not None:
                return redirect('/login')
            # Never render the invitation hash, token or unmasked owner email.
            return render_template('activate.html', instance={'name': row['name'], 'crmName': row['crm_name']})
        if request.path == '/api/activate':
            if request.method != 'POST':
                return jsonify(error='Método no permitido.'), 405
            return activation()
        if row['status'] == 'pending' and request.path not in {'/styles.css', '/login.js', '/icons.svg', '/healthz'}:
            if request.path.startswith('/api/'):
                return jsonify(error='El propietario debe activar su CRM con el enlace privado.'), 401
            return redirect('/activate')
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} and not request.headers.get('X-CSRF-Token', '').isascii():
            return jsonify(error='Sesión no válida.'), 403
        return None

    # Run the tenant lifecycle and origin gate before the CRM authentication hook.
    app.before_request_funcs.setdefault(None, []).insert(0, gate)
    original_login = app.view_functions['login_page']

    def branded_login():
        response = original_login()
        if not hasattr(response, 'get_data') or response.status_code != 200:
            return response
        response.direct_passthrough = False
        name = html.escape(instance['crm_name'])
        page = response.get_data(as_text=True)
        page = page.replace('Nexo · Iniciar sesión', f'{name} · Iniciar sesión')
        page = page.replace('◈ Nexo<span>CRM</span>', f'◈ {name}')
        response.close()
        return make_response(page)

    app.view_functions['login_page'] = branded_login

    # Each integration needs instance-specific credentials. Global process secrets
    # from the personal CRM must not make a customer's integration appear connected.
    app.view_functions['automation_status'] = lambda: jsonify(configured=False, worker=None, reminders=[], reason='Configura credenciales privadas para esta instancia antes de activar integraciones.')
    app.view_functions['report_status'] = lambda: jsonify(configured=False, recipient=instance['owner_email'], recent=[], delivery='disconnected', reason='El envío por correo requiere un proveedor configurado exclusivamente para esta instancia.')
    return app
