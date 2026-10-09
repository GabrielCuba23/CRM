"""Instance metadata only. Customer records live in separate CRM databases."""

import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from backend.storage import default_workspace, initialize as initialize_crm, connect as connect_crm
from backend.validation import validate_workspace

INVITATION_SECONDS = 48 * 3600
RESERVED_SLUGS = {'admin', 'api', 'www', 'mail', 'localhost', 'static', 'login', 'activate', 'retail', 'support'}


def origin(value, allow_http=False):
    parsed = urlsplit(value)
    if (parsed.scheme not in {'https', 'http'} or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {'', '/'} or parsed.query or parsed.fragment):
        raise ValueError('La URL pública debe ser un origen HTTPS sin ruta ni credenciales.')
    if parsed.scheme == 'http' and not (allow_http and parsed.hostname in {'localhost', '127.0.0.1', '::1'}):
        raise ValueError('HTTP solo está disponible para desarrollo en localhost.')
    if parsed.netloc != parsed.netloc.lower() or parsed.hostname.endswith('.'):
        raise ValueError('Usa el nombre de dominio canónico en minúsculas.')
    try:
        parsed.port
    except ValueError:
        raise ValueError('Puerto no válido.') from None
    return f'{parsed.scheme}://{parsed.netloc}'


def text(value, field, maximum=120, required=True):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f'{field} no válido.')
    value = value.strip()
    if required and not value:
        raise ValueError(f'Completa {field}.')
    return value


def email(value):
    value = text(value, 'correo del propietario', 254).lower()
    if not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', value):
        raise ValueError('Correo del propietario no válido.')
    return value


class Registry:
    def __init__(self, config):
        self.public_url = origin(config['PUBLIC_URL'], config.get('ALLOW_HTTP', False))
        self.admin_host = urlsplit(self.public_url).netloc
        self.tenant_port = config.get('TENANT_PORT', 443)
        if type(self.tenant_port) is not int or not 1 <= self.tenant_port <= 65535:
            raise ValueError('El puerto de los CRM no es válido.')
        self.base_domain = text(config['BASE_DOMAIN'], 'dominio base', 253).lower()
        if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', self.base_domain):
            raise ValueError('Configura un dominio base DNS válido, sin esquema ni puerto.')
        self.root = Path(config['DATA_ROOT']).absolute()
        if self.root.is_symlink():
            raise ValueError('El directorio de datos no puede ser un enlace simbólico.')
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self.root = self.root.resolve()
        self.path = self.root / 'registry.sqlite3'
        if self.path.is_symlink():
            raise ValueError('La base del registro no puede ser un enlace simbólico.')
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS instances (
                    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL, owner_email TEXT NOT NULL, crm_name TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','active','suspended')),
                    created_at INTEGER NOT NULL, activated_at INTEGER,
                    invitation_hash TEXT, invitation_expires INTEGER
                );
                CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, password_hash TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, attempted INTEGER NOT NULL);
            ''')
        os.chmod(self.path, 0o600)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def database(self, identifier):
        if not re.fullmatch(r'[a-f0-9]{32}', identifier):
            raise ValueError('Identificador de instancia no válido.')
        directory = self.root / 'instances' / identifier
        if directory.is_symlink() or directory.parent.is_symlink():
            raise ValueError('La ruta de la instancia no puede ser un enlace simbólico.')
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory.parent, 0o700)
        os.chmod(directory, 0o700)
        path = directory / 'crm.sqlite3'
        if path.is_symlink():
            raise ValueError('La base de la instancia no puede ser un enlace simbólico.')
        return str(path)

    def tenant_url(self, row):
        suffix = f':{self.tenant_port}' if self.tenant_port != 443 else ''
        return f"https://{row['hostname']}{suffix}"

    def public(self, row):
        return {'id': row['id'], 'slug': row['slug'], 'name': row['name'], 'ownerEmail': row['owner_email'],
                'crmName': row['crm_name'], 'url': self.tenant_url(row), 'status': row['status'],
                'createdAt': row['created_at'], 'activatedAt': row['activated_at']}

    def list(self):
        with self.connect() as db:
            return [self.public(row) for row in db.execute('SELECT * FROM instances ORDER BY created_at DESC, id')]

    def get(self, identifier=None, hostname=None):
        with self.connect() as db:
            if identifier is not None:
                return db.execute('SELECT * FROM instances WHERE id=?', (identifier,)).fetchone()
            return db.execute('SELECT * FROM instances WHERE hostname=?', (hostname,)).fetchone()

    def create(self, data):
        if not isinstance(data, dict):
            raise ValueError('Datos de instancia no válidos.')
        name = text(data.get('name'), 'nombre')
        owner_email = email(data.get('ownerEmail'))
        slug = text(data.get('slug'), 'subdominio', 40).lower()
        if not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', slug) or slug in RESERVED_SLUGS:
            raise ValueError('Usa un subdominio de letras minúsculas, números y guiones; evita nombres reservados.')
        hostname = f'{slug}.{self.base_domain}'
        authority = hostname + (f':{self.tenant_port}' if self.tenant_port != 443 else '')
        if authority == self.admin_host or len(hostname) > 253:
            raise ValueError('El subdominio no está disponible.')
        crm_name = text(data.get('crmName') or name, 'nombre del CRM', 80)
        business = text(data.get('business') or name, 'nombre del negocio', 120)
        logo = data.get('logoDataUrl', '')
        if not isinstance(logo, str) or len(logo) > 150000:
            raise ValueError('Logo no válido; máximo 150 KB de texto.')
        if logo:
            match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', logo)
            if not match:
                raise ValueError('Usa un logo PNG, JPEG o WebP.')
            try:
                raw = base64.b64decode(match[2], validate=True)
            except ValueError:
                raise ValueError('Logo no válido.') from None
            valid = (match[1] == 'png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1] == 'jpeg' and raw.startswith(b'\xff\xd8\xff')) or (match[1] == 'webp' and raw.startswith(b'RIFF') and raw[8:12] == b'WEBP')
            if not valid:
                raise ValueError('El formato del logo no coincide con su contenido.')
        identifier, token, now = uuid.uuid4().hex, secrets.token_urlsafe(32), int(time.time())
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT id FROM instances WHERE slug=? OR hostname=?', (slug, hostname)).fetchone():
                raise ValueError('El subdominio ya está registrado.')
            path = self.database(identifier)
            initialize_crm(path)
            state = default_workspace()
            state['settings'].update(business=business, crmName=crm_name, logoDataUrl=logo)
            # Every instance starts empty. No customer data or credentials are cloned.
            state = validate_workspace(state)
            with connect_crm(path) as customer_db:
                customer_db.execute('INSERT INTO workspace VALUES(1,0,?)', (json.dumps(state, ensure_ascii=False),))
            db.execute('INSERT INTO instances VALUES(?,?,?,?,?,?,\'pending\',?,NULL,?,?)',
                       (identifier, slug, hostname, name, owner_email, crm_name, now,
                        hashlib.sha256(token.encode()).hexdigest(), now + INVITATION_SECONDS))
        row = self.get(identifier)
        return self.public(row), f'{self.tenant_url(row)}/activate#token={token}'

    def invitation(self, identifier):
        token, now = secrets.token_urlsafe(32), int(time.time())
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM instances WHERE id=?', (identifier,)).fetchone()
            if not row:
                raise LookupError('Instancia no encontrada.')
            if row['activated_at'] is not None:
                raise ValueError('La instancia ya fue activada; el panel no puede restablecer su contraseña.')
            db.execute('UPDATE instances SET invitation_hash=?,invitation_expires=? WHERE id=?',
                       (hashlib.sha256(token.encode()).hexdigest(), now + INVITATION_SECONDS, identifier))
        return self.public(row), f'{self.tenant_url(row)}/activate#token={token}'

    def set_status(self, identifier, status):
        if not isinstance(status, str) or status not in {'active', 'suspended'}:
            raise ValueError('Estado no válido.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM instances WHERE id=?', (identifier,)).fetchone()
            if not row:
                raise LookupError('Instancia no encontrada.')
            if row['activated_at'] is None:
                raise ValueError('El propietario debe activar el CRM primero.')
            db.execute('UPDATE instances SET status=? WHERE id=?', (status, identifier))
            if status == 'suspended':
                with connect_crm(self.database(identifier)) as customer_db:
                    customer_db.execute('DELETE FROM sessions')
        return self.public(self.get(identifier))
