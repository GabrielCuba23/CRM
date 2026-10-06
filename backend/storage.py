import json
import os
import sqlite3
from pathlib import Path


def connect(path):
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


def initialize(path):
    root = Path(path).parent
    root.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS owner (
                id INTEGER PRIMARY KEY CHECK (id=1), email TEXT NOT NULL, password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                ip TEXT NOT NULL, attempted INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS login_attempt_time ON login_attempts(attempted);
            CREATE TABLE IF NOT EXISTS workspace (
                id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, body TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reminders (
                client_id TEXT NOT NULL, expires TEXT NOT NULL, state TEXT NOT NULL,
                attempted INTEGER NOT NULL, provider_id TEXT, error TEXT,
                PRIMARY KEY(client_id, expires)
            );
            CREATE TABLE IF NOT EXISTS worker_health (
                id INTEGER PRIMARY KEY CHECK(id=1), checked INTEGER NOT NULL, status TEXT NOT NULL
            );
        ''')
    os.chmod(path, 0o600)


def default_workspace():
    return {
        'version': 2, 'clients': [], 'accounts': [], 'combos': [], 'ledger': [],
        'templates': [
            {'id': 'welcome', 'name': 'Entrega de acceso', 'context': 'Entrega', 'body': 'Hola {nombre} 👋\n\n*✅ {servicio}*\n*📧 Correo:* {correo}\n*☑️ Perfil:* {perfil}\n*📍 Vence:* {vence}'},
            {'id': 'renew', 'name': 'Recordatorio de renovación', 'context': 'Renovación', 'body': 'Hola {nombre} 👋\nTu servicio *{servicio}* vence el *{vence}*.\n¿Deseas renovarlo?\n{pago}'},
        ],
        'settings': {'business': 'Nexo Streaming', 'payments': '', 'dark': False},
        'automation': {'enabled': False, 'templateName': '', 'language': 'es', 'parameters': ['nombre', 'servicio', 'vence'], 'hour': 9},
    }


def read_workspace(path):
    with connect(path) as db:
        row = db.execute('SELECT * FROM workspace WHERE id=1').fetchone()
    return (json.loads(row['body']), row['revision']) if row else (default_workspace(), 0)
