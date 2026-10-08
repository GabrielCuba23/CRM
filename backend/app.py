import hmac
import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, jsonify, make_response, redirect, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash
from .storage import connect, initialize, read_workspace
from .validation import validate_workspace

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_FILES = {'styles.css', 'login.js', 'icons.svg'}
APP_FILES = {'messaging.mjs','reports.mjs', 'report-config.mjs', 'app.js', 'crm.mjs', 'automation.mjs', 'bulk.mjs','lifecycle.mjs','procurement.mjs','procurement-ui.mjs','growth.mjs','growth-ui.mjs', 'vendor/exceljs-4.4.0.min.js', 'index.html', 'sw.js', 'manifest.webmanifest', 'app-icon.svg','app-icon-192.png','app-icon-512.png'}
SESSION_SECONDS = 8 * 3600


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DB_PATH=os.environ.get('CRM_DB_PATH', '/workspace/crm-data/crm.sqlite3'),
        PUBLIC_URL=os.environ.get('CRM_PUBLIC_URL', 'https://localhost'),
        OWNER_EMAIL=os.environ.get('CRM_OWNER_EMAIL', ''),
        OWNER_PASSWORD=os.environ.get('CRM_OWNER_PASSWORD', ''),
        MAX_CONTENT_LENGTH=10_000_000,
        ALLOW_HTTP=os.environ.get('CRM_ALLOW_HTTP') == '1',
    )
    if config:
        app.config.update(config)
    parsed = urlsplit(app.config['PUBLIC_URL'])
    if parsed.scheme not in ['http', 'https'] or not parsed.netloc or parsed.path not in ['', '/']:
        raise ValueError('CRM_PUBLIC_URL debe ser el origen público del servidor.')
    if parsed.scheme == 'http' and not app.config['ALLOW_HTTP']:
        raise ValueError('Producción requiere HTTPS. CRM_ALLOW_HTTP=1 es solo para desarrollo local.')
    if parsed.scheme == 'http' and parsed.hostname not in ['localhost', '127.0.0.1', '::1']:
        raise ValueError('HTTP solo está permitido en una dirección local de desarrollo.')
    origin = f'{parsed.scheme}://{parsed.netloc}'
    secure = parsed.scheme == 'https'
    cookie_name = '__Host-nexo_session' if secure else 'nexo_dev_session'
    db_path = app.config['DB_PATH']
    initialize(db_path)
    with connect(db_path) as db:
        owner = db.execute('SELECT id FROM owner WHERE id=1').fetchone()
        if not owner and app.config['OWNER_EMAIL'] and app.config['OWNER_PASSWORD']:
            if len(app.config['OWNER_PASSWORD']) < 12:
                raise ValueError('La contraseña inicial debe tener al menos 12 caracteres.')
            db.execute('INSERT OR IGNORE INTO owner VALUES(1, ?, ?)', (app.config['OWNER_EMAIL'].strip().lower(), generate_password_hash(app.config['OWNER_PASSWORD'])))
    # Do not retain the bootstrap password in the Flask configuration.
    app.config['OWNER_PASSWORD'] = ''

    def session():
        token = request.cookies.get(cookie_name, '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token):
            return None
        with connect(db_path) as db:
            return db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()

    def has_owner():
        with connect(db_path) as db:
            return db.execute('SELECT email FROM owner WHERE id=1').fetchone()

    @app.before_request
    def protect():
        if request.path == '/healthz':
            return None
        if request.method in ['POST', 'PUT', 'PATCH', 'DELETE']:
            # JSON-only writes, explicit Origin, no cross-origin cookie mutations.
            if request.headers.get('Origin') != origin or not request.is_json:
                return jsonify(error='Origen o formato de solicitud no permitido.'), 403
        public = request.path in ['/login', '/api/login'] or request.path.lstrip('/') in PUBLIC_FILES
        if not public:
            if not session():
                if request.path.startswith('/api/'):
                    return jsonify(error='Inicia sesión para continuar.'), 401
                return redirect('/login')
            if request.method in ['POST', 'PUT', 'PATCH', 'DELETE']:
                csrf = request.headers.get('X-CSRF-Token', '')
                if not hmac.compare_digest(session()['csrf'], csrf):
                    return jsonify(error='Sesión no válida. Recarga e inicia sesión nuevamente.'), 403

    @app.after_request
    def security_headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
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
        return send_from_directory(ROOT, 'login.html')

    @app.post('/api/login')
    def login():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict) or not isinstance(data.get('email'), str) or not isinstance(data.get('password'), str) or len(data['password']) > 1024:
            return jsonify(error='Datos de acceso no válidos.'), 400
        now, ip = int(time.time()), request.remote_addr or 'unknown'
        with connect(db_path) as db:
            db.execute('DELETE FROM login_attempts WHERE attempted<?', (now-900,))
            attempts = db.execute('SELECT COUNT(*) FROM login_attempts').fetchone()[0]
            per_ip = db.execute('SELECT COUNT(*) FROM login_attempts WHERE ip=?', (ip,)).fetchone()[0]
            if attempts >= 50 or per_ip >= 8:
                return jsonify(error='Demasiados intentos. Espera 15 minutos.'), 429
            db.execute('INSERT INTO login_attempts VALUES(?, ?)', (ip, now))
            owner = db.execute('SELECT * FROM owner WHERE id=1').fetchone()
        if not owner:
            return jsonify(error='El administrador debe configurar el usuario inicial en el servidor.'), 503
        valid = check_password_hash(owner['password_hash'], data['password'])
        if not valid or data['email'].strip().lower() != owner['email']:
            return jsonify(error='Correo o contraseña incorrectos.'), 401
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with connect(db_path) as db:
            db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
            db.execute('DELETE FROM login_attempts WHERE ip=?', (ip,))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), csrf, now+SESSION_SECONDS))
        response = jsonify(csrf=csrf)
        response.set_cookie(cookie_name, token, max_age=SESSION_SECONDS, httponly=True, secure=secure, samesite='Strict', path='/')
        return response

    @app.get('/api/session')
    def current_session():
        return jsonify(email=has_owner()['email'], csrf=session()['csrf'], mode='server')

    @app.post('/api/logout')
    def logout():
        with connect(db_path) as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (session()['token_hash'],))
        response = jsonify(ok=True)
        response.delete_cookie(cookie_name, path='/', secure=secure, httponly=True, samesite='Strict')
        return response

    @app.post('/api/password')
    def password():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict) or not isinstance(data.get('current'), str) or not isinstance(data.get('next'), str) or not 12 <= len(data['next']) <= 1024 or len(data['current']) > 1024:
            return jsonify(error='Usa una nueva contraseña de al menos 12 caracteres.'), 400
        with connect(db_path) as db:
            owner = db.execute('SELECT * FROM owner WHERE id=1').fetchone()
            if not check_password_hash(owner['password_hash'], data['current']):
                return jsonify(error='Contraseña actual incorrecta.'), 400
            db.execute('UPDATE owner SET password_hash=? WHERE id=1', (generate_password_hash(data['next']),))
            db.execute('DELETE FROM sessions')
        response = jsonify(ok=True)
        response.delete_cookie(cookie_name, path='/', secure=secure, httponly=True, samesite='Strict')
        return response

    @app.get('/api/report-status')
    def report_status():
        from .email_reports import report_status as status
        return jsonify(status(db_path))

    @app.get('/api/workspace')
    def workspace():
        state, revision = read_workspace(db_path)
        return jsonify(state=state, revision=revision)

    @app.put('/api/workspace')
    def save_workspace():
        data = request.get_json(silent=True)
        try:
            if not isinstance(data, dict) or type(data.get('revision')) is not int:
                raise ValueError('Revisión no válida.')
            state = validate_workspace(data.get('state'))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        with connect(db_path) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision FROM workspace WHERE id=1').fetchone()
            revision = row['revision'] if row else 0
            if data['revision'] != revision:
                return jsonify(error='Los datos cambiaron en otra sesión. Recarga antes de guardar.'), 409
            revision += 1
            db.execute('INSERT OR REPLACE INTO workspace VALUES(1,?,?)', (revision, json.dumps(state, ensure_ascii=False)))
        return jsonify(revision=revision)

    @app.get('/api/automation-status')
    def automation_status():
        with connect(db_path) as db:
            reminders = [dict(row) for row in db.execute('SELECT * FROM reminders ORDER BY attempted DESC LIMIT 100')]
            worker = db.execute('SELECT checked,status FROM worker_health WHERE id=1').fetchone()
        configured = all(os.environ.get(k) for k in ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'])
        return jsonify(configured=configured, worker=dict(worker) if worker else None, reminders=reminders)

    @app.get('/')
    def index():
        return make_response((ROOT / 'index.html').read_text().replace('<head>', '<head><meta name="crm-backend" content="required">'))

    @app.get('/<path:filename>')
    def assets(filename):
        if filename == 'index.html':
            return index()
        if filename in PUBLIC_FILES | APP_FILES:
            return send_from_directory(ROOT, filename)
        return jsonify(error='Recurso no encontrado.'), 404

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error='El archivo supera 10 MB.'), 413

    return app
