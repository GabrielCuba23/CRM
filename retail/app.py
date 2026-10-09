"""Operator panel: instance metadata only, no customer workspace endpoints."""

import hashlib
import hmac
import os
import re
import secrets
import time
from pathlib import Path

from flask import Flask, jsonify, make_response, redirect, render_template, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

from .registry import Registry, email

ROOT = Path(__file__).resolve().parent
CRM_ROOT = ROOT.parent
SESSION_SECONDS = 8 * 3600


def configuration(config=None):
    result = {
        'PUBLIC_URL': os.environ.get('RETAIL_PUBLIC_URL', 'https://admin.example.com'),
        'BASE_DOMAIN': os.environ.get('RETAIL_BASE_DOMAIN', 'clients.example.com'),
        'DATA_ROOT': os.environ.get('RETAIL_DATA_ROOT', '/workspace/retail-data'),
        'ADMIN_EMAIL': os.environ.get('RETAIL_ADMIN_EMAIL', ''),
        'ADMIN_PASSWORD': os.environ.get('RETAIL_ADMIN_PASSWORD', ''),
        'ALLOW_HTTP': os.environ.get('RETAIL_ALLOW_HTTP') == '1',
        'TENANT_PORT': int(os.environ.get('RETAIL_TENANT_PORT', '443')),
    }
    result.update(config or {})
    return result


def create_app(config=None, registry=None):
    settings = configuration(config)
    registry = registry or Registry(settings)
    app = Flask(__name__, template_folder=str(ROOT / 'templates'), static_folder=None)
    app.config.update(settings, MAX_CONTENT_LENGTH=200_000)
    app.extensions['retail_registry'] = registry
    secure = registry.public_url.startswith('https:')
    cookie_name = '__Host-retail_session' if secure else 'retail_dev_session'
    if settings['ADMIN_EMAIL'] and settings['ADMIN_PASSWORD']:
        if not 12 <= len(settings['ADMIN_PASSWORD']) <= 1024:
            raise ValueError('La contraseña inicial del panel requiere entre 12 y 1024 caracteres.')
        owner_email = email(settings['ADMIN_EMAIL'])
        with registry.connect() as db:
            db.execute('INSERT OR IGNORE INTO owner VALUES(1,?,?)',
                       (owner_email, generate_password_hash(settings['ADMIN_PASSWORD'])))
    app.config['ADMIN_PASSWORD'] = ''

    def session():
        token = request.cookies.get(cookie_name, '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token):
            return None
        with registry.connect() as db:
            return db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?',
                              (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()

    @app.before_request
    def protect():
        # Do not trust forwarded host headers or serve aliases of the panel origin.
        if request.environ.get('HTTP_HOST', '') != registry.admin_host:
            return jsonify(error='Dominio no reconocido.'), 404
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            if request.headers.get('Origin') != registry.public_url or not request.is_json:
                return jsonify(error='Origen o formato no permitido.'), 403
        public = request.path in {'/healthz', '/login', '/api/login', '/login.js', '/styles.css', '/icons.svg', '/retail-static/panel.css', '/retail-static/panel.js'}
        if not public:
            current = session()
            if not current:
                if request.path.startswith('/api/'):
                    return jsonify(error='Inicia sesión en el panel.'), 401
                return redirect('/login')
            if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} and not hmac.compare_digest(current['csrf'].encode('utf-8'), request.headers.get('X-CSRF-Token', '').encode('utf-8')):
                return jsonify(error='Sesión no válida. Recarga e inicia sesión nuevamente.'), 403

    @app.after_request
    def security(response):
        response.headers.update({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
                                 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
        if secure:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.get('/healthz')
    def health():
        return jsonify(status='ok')

    @app.get('/login')
    def login_page():
        if session():
            return redirect('/')
        template = ROOT / 'templates' / 'panel.html'
        if template.is_file():
            return render_template('panel.html')
        page = (CRM_ROOT / 'login.html').read_text().replace('Nexo', 'Panel de marca blanca')
        return make_response(page)

    @app.post('/api/login')
    def login():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('email'), str) or not isinstance(data.get('password'), str) or len(data['password']) > 1024:
            return jsonify(error='Datos de acceso no válidos.'), 400
        now, ip = int(time.time()), request.remote_addr or 'unknown'
        with registry.connect() as db:
            db.execute('DELETE FROM login_attempts WHERE attempted<?', (now - 900,))
            total = db.execute('SELECT COUNT(*) FROM login_attempts').fetchone()[0]
            per_ip = db.execute('SELECT COUNT(*) FROM login_attempts WHERE ip=?', (ip,)).fetchone()[0]
            if total >= 50 or per_ip >= 8:
                return jsonify(error='Demasiados intentos. Espera 15 minutos.'), 429
            db.execute('INSERT INTO login_attempts VALUES(?,?)', (ip, now))
            owner = db.execute('SELECT * FROM owner WHERE id=1').fetchone()
        if not owner:
            return jsonify(error='Configura el propietario del panel desde el servidor.'), 503
        valid = check_password_hash(owner['password_hash'], data['password'])
        if not valid or data['email'].strip().lower() != owner['email']:
            return jsonify(error='Correo o contraseña incorrectos.'), 401
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with registry.connect() as db:
            db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
            db.execute('DELETE FROM login_attempts WHERE ip=?', (ip,))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), csrf, now + SESSION_SECONDS))
        response = jsonify(csrf=csrf)
        response.set_cookie(cookie_name, token, max_age=SESSION_SECONDS, httponly=True, secure=secure, samesite='Strict', path='/')
        return response

    @app.get('/api/session')
    def current_session():
        with registry.connect() as db:
            owner = db.execute('SELECT email FROM owner WHERE id=1').fetchone()
        return jsonify(email=owner['email'], csrf=session()['csrf'], mode='retail', baseDomain=registry.base_domain)

    @app.post('/api/logout')
    def logout():
        with registry.connect() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (session()['token_hash'],))
        response = jsonify(ok=True)
        response.delete_cookie(cookie_name, path='/', secure=secure, httponly=True, samesite='Strict')
        return response

    @app.post('/api/password')
    def password():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('current'), str) or not isinstance(data.get('next'), str) or not 12 <= len(data['next']) <= 1024 or len(data['current']) > 1024:
            return jsonify(error='Usa una nueva contraseña de al menos 12 caracteres.'), 400
        with registry.connect() as db:
            owner = db.execute('SELECT * FROM owner WHERE id=1').fetchone()
            if not check_password_hash(owner['password_hash'], data['current']):
                return jsonify(error='Contraseña actual incorrecta.'), 400
            db.execute('UPDATE owner SET password_hash=? WHERE id=1', (generate_password_hash(data['next']),))
            db.execute('DELETE FROM sessions')
        response = jsonify(ok=True)
        response.delete_cookie(cookie_name, path='/', secure=secure, httponly=True, samesite='Strict')
        return response

    @app.get('/api/instances')
    def instances():
        return jsonify(instances=registry.list())

    @app.post('/api/instances')
    def create_instance():
        try:
            instance, activation_url = registry.create(request.get_json(silent=True))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        return jsonify(instance=instance, activationUrl=activation_url), 201

    @app.patch('/api/instances/<identifier>')
    def update_instance(identifier):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != {'status'}:
            return jsonify(error='Solo se permite cambiar el estado de la instancia.'), 400
        try:
            return jsonify(instance=registry.set_status(identifier, data['status']))
        except LookupError as error:
            return jsonify(error=str(error)), 404
        except ValueError as error:
            return jsonify(error=str(error)), 409

    @app.post('/api/instances/<identifier>/invitation')
    def renew_invitation(identifier):
        try:
            instance, activation_url = registry.invitation(identifier)
            return jsonify(instance=instance, activationUrl=activation_url)
        except LookupError as error:
            return jsonify(error=str(error)), 404
        except ValueError as error:
            return jsonify(error=str(error)), 409

    @app.get('/')
    def panel():
        return render_template('panel.html')

    @app.get('/<path:filename>')
    def assets(filename):
        if filename in {'styles.css', 'login.js', 'icons.svg'}:
            return send_from_directory(CRM_ROOT, filename)
        if filename in {'retail-static/panel.js', 'retail-static/panel.css'}:
            return send_from_directory(ROOT / 'static', filename.split('/')[-1])
        return jsonify(error='Recurso no encontrado.'), 404

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error='La solicitud supera el tamaño permitido.'), 413

    return app
