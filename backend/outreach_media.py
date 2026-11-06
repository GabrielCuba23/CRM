"""Private campaign media, compatible with the Cloudflare chunk protocol.

The Flask application's existing before_request hook authenticates every route
and checks JSON Origin/CSRF on writes before these handlers run.
"""
import base64
import hashlib
import json
import re
import secrets
import sqlite3
import time
from contextlib import closing

from flask import Response, jsonify, request, stream_with_context

from .storage import connect

FILE_BYTES = 20 * 1024 * 1024
TOTAL_BYTES = 200 * 1024 * 1024
CHUNK_BYTES = 512 * 1024
LIMITS = {'fileBytes': FILE_BYTES, 'totalBytes': TOTAL_BYTES, 'chunkBytes': CHUNK_BYTES, 'files': 500}
TYPES = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'}


class MediaError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _value(limit=8192):
    if not request.is_json:
        raise MediaError('Usa una solicitud JSON válida.')
    if request.content_length is not None and request.content_length > limit:
        raise MediaError('La solicitud supera el tamaño permitido.', 413)
    body = request.stream.read(limit + 1)
    if len(body) > limit:
        raise MediaError('La solicitud supera el tamaño permitido.', 413)
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError):
        raise MediaError('Usa una solicitud JSON válida.') from None
    if not isinstance(value, dict):
        raise MediaError('Completa los datos del archivo.')
    return value


def _descriptor(row):
    return {key: row[key] for key in ['id', 'name', 'type', 'size', 'sha256']}


def _parts(size):
    return (size + CHUNK_BYTES - 1) // CHUNK_BYTES


def _metadata(row):
    return {'media': _descriptor(row), 'chunkSize': CHUNK_BYTES, 'chunks': _parts(row['size'])}


def _row(db, media_id, ready=False):
    row = db.execute('SELECT * FROM outreach_media WHERE id=?', (media_id,)).fetchone()
    if row is None or ready and row['state'] != 'ready':
        raise MediaError('El archivo no está disponible.', 404)
    return row


def _part(db, row, number):
    chunk = db.execute('SELECT data FROM outreach_media_chunks WHERE media_id=? AND part=?', (row['id'], number)).fetchone()
    if chunk is None:
        raise MediaError('Faltan fragmentos del archivo. Vuelve a subirlo.', 409)
    data = bytes(chunk['data'])
    if len(data) != min(CHUNK_BYTES, row['size'] - number * CHUNK_BYTES):
        raise MediaError('El archivo guardado está incompleto.', 409)
    return data


def _signature(data, mime):
    if mime == 'image/png':
        return data.startswith(b'\x89PNG\r\n\x1a\n')
    if mime == 'image/jpeg':
        return data.startswith(b'\xff\xd8\xff')
    if mime == 'image/gif':
        return data.startswith((b'GIF87a', b'GIF89a'))
    if mime == 'image/webp':
        return data.startswith(b'RIFF') and data[8:12] == b'WEBP'
    if mime == 'video/mp4':
        return len(data) >= 12 and data[4:8] == b'ftyp'
    if mime == 'video/webm':
        return data.startswith(b'\x1a\x45\xdf\xa3')
    return False


def register_outreach_media(app, db_path):
    with closing(connect(db_path)) as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS outreach_media (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
                size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 20971520),
                sha256 TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('uploading','validating','ready')),
                created INTEGER NOT NULL, lease TEXT, validation_started INTEGER
            );
            CREATE INDEX IF NOT EXISTS outreach_media_created ON outreach_media(created);
            CREATE TABLE IF NOT EXISTS outreach_media_chunks (
                media_id TEXT NOT NULL REFERENCES outreach_media(id) ON DELETE CASCADE,
                part INTEGER NOT NULL CHECK(part BETWEEN 0 AND 39), data BLOB NOT NULL,
                PRIMARY KEY(media_id,part)
            );
        ''')

    def complete(media_id):
        with closing(connect(db_path)) as db:
            row = _row(db, media_id)
            if row['state'] == 'ready':
                return jsonify(**_metadata(row), status='ready')
            lease, now = secrets.token_hex(16), int(time.time())
            claimed = db.execute("UPDATE outreach_media SET state='validating',lease=?,validation_started=? WHERE id=? AND (state='uploading' OR (state='validating' AND validation_started<?)) RETURNING *", (lease, now, media_id, now - 120)).fetchone()
            db.commit()
            if claimed is None:
                raise MediaError('El archivo ya se está comprobando. Reintenta en un momento.', 409)
            try:
                usage = db.execute('SELECT COUNT(*) AS count,COALESCE(SUM(length(data)),0) AS bytes FROM outreach_media_chunks WHERE media_id=?', (media_id,)).fetchone()
                if usage['count'] != _parts(claimed['size']) or usage['bytes'] != claimed['size']:
                    raise MediaError('Faltan fragmentos del archivo. Completa la subida antes de guardarlo.', 409)
                digest = hashlib.sha256()
                for number in range(_parts(claimed['size'])):
                    data = _part(db, claimed, number)
                    if number == 0 and not _signature(data, claimed['type']):
                        raise MediaError('El contenido del archivo no coincide con su tipo de foto o video.')
                    digest.update(data)
                if digest.hexdigest() != claimed['sha256']:
                    raise MediaError('El archivo cambió o llegó incompleto. Vuelve a subirlo.')
                ready = db.execute("UPDATE outreach_media SET state='ready',lease=NULL,validation_started=NULL WHERE id=? AND state='validating' AND lease=? RETURNING *", (media_id, lease)).fetchone()
                db.commit()
                if ready is None:
                    raise MediaError('El archivo cambió durante la comprobación. Vuelve a intentarlo.', 409)
                return jsonify(**_metadata(ready), status='ready')
            except Exception:
                db.execute("UPDATE outreach_media SET state='uploading',lease=NULL,validation_started=NULL WHERE id=? AND state='validating' AND lease=?", (media_id, lease))
                db.commit()
                raise

    @app.route('/api/outreach/media', methods=['GET', 'POST'])
    @app.route('/api/outreach/media/<path:suffix>', methods=['GET', 'HEAD', 'PUT', 'POST', 'DELETE'])
    def outreach_media(suffix=None):
        try:
            if suffix is None:
                if request.method == 'GET':
                    with closing(connect(db_path)) as db:
                        rows = db.execute('SELECT * FROM outreach_media ORDER BY created DESC,id DESC LIMIT 500').fetchall()
                        used = db.execute('SELECT COALESCE(SUM(size),0) FROM outreach_media').fetchone()[0]
                    return jsonify(media=[_descriptor(row) for row in rows if row['state'] == 'ready'], uploads=[dict(_descriptor(row), status=row['state']) for row in rows if row['state'] != 'ready'], limits=LIMITS, usedBytes=used)
                value = _value()
                name, mime, size, sha256 = (value.get(key) for key in ['name', 'type', 'size', 'sha256'])
                if not isinstance(name, str) or not name.strip() or len(name) > 200 or re.search(r'[\x00-\x1f\x7f/\\]', name):
                    raise MediaError('Indica un nombre de archivo válido, sin rutas.')
                if mime not in TYPES:
                    raise MediaError('Usa una foto PNG, JPG, GIF o WEBP, o un video MP4 o WEBM.')
                if type(size) is not int or not 1 <= size <= FILE_BYTES:
                    raise MediaError('Cada archivo debe ocupar entre 1 byte y 20 MiB.', 413)
                if not isinstance(sha256, str) or not re.fullmatch(r'[a-f0-9]{64}', sha256):
                    raise MediaError('El archivo necesita una huella SHA-256 válida.')
                with closing(connect(db_path)) as db:
                    row = db.execute("INSERT INTO outreach_media(id,name,type,size,sha256,state,created) SELECT ?,?,?,?,?,'uploading',? WHERE (SELECT COALESCE(SUM(size),0) FROM outreach_media)+?<=? AND (SELECT COUNT(*) FROM outreach_media)<? RETURNING *", (secrets.token_hex(16), name.strip(), mime, size, sha256, int(time.time()), size, TOTAL_BYTES, LIMITS['files'])).fetchone()
                    db.commit()
                    if row is None:
                        raise MediaError('La biblioteca alcanzó su límite. Elimina archivos que ya no utilices antes de subir otros.', 409)
                return jsonify(**_metadata(row), status='uploading'), 201
            match = re.fullmatch(r'([a-f0-9]{32})(?:/(metadata|complete|chunks/([0-9]{1,2})))?', suffix)
            if not match:
                raise MediaError('Archivo o ruta no válidos.', 404)
            media_id, action, raw_part = match.groups()
            if action == 'complete' and request.method == 'POST':
                _value()
                return complete(media_id)
            with closing(connect(db_path)) as db:
                if not action and request.method == 'DELETE':
                    db.execute('BEGIN IMMEDIATE')
                    _row(db, media_id)
                    workspace = db.execute('SELECT body FROM workspace WHERE id=1').fetchone()
                    outreach = json.loads(workspace['body']).get('growth', {}).get('outreach', {}) if workspace else {}
                    campaigns = outreach.get('campaigns', []) + outreach.get('templates', [])
                    config = db.execute('SELECT body FROM engagement_config WHERE id=1').fetchone()
                    if config:
                        campaigns += json.loads(config['body']).get('bot', {}).get('rules', [])
                    if any(any(item.get('id') == media_id for item in campaign.get('media', [])) for campaign in campaigns):
                        raise MediaError('Este archivo está usado en una campaña o plantilla. Quítalo antes de eliminarlo.', 409)
                    db.execute('DELETE FROM outreach_media_chunks WHERE media_id=?', (media_id,))
                    db.execute('DELETE FROM outreach_media WHERE id=?', (media_id,))
                    db.commit()
                    return jsonify(ok=True)
                if action and action.startswith('chunks/'):
                    row = _row(db, media_id, request.method == 'GET')
                    number = int(raw_part)
                    if str(number) != raw_part or number >= _parts(row['size']):
                        raise MediaError('El número de fragmento no es válido.')
                    if request.method == 'GET':
                        return jsonify(id=media_id, part=number, data=base64.b64encode(_part(db, row, number)).decode('ascii'))
                    if request.method == 'PUT':
                        if row['state'] != 'uploading':
                            raise MediaError('Este archivo ya se guardó o se está comprobando.', 409)
                        value = _value((CHUNK_BYTES * 4 + 2) // 3 + 1024)
                        expected = min(CHUNK_BYTES, row['size'] - number * CHUNK_BYTES)
                        encoded = value.get('data')
                        if not isinstance(encoded, str) or len(encoded) != 4 * ((expected + 2) // 3):
                            raise MediaError('El fragmento del archivo no es válido.')
                        try:
                            data = base64.b64decode(encoded, validate=True)
                        except ValueError:
                            raise MediaError('El fragmento del archivo no es válido.') from None
                        if len(data) != expected:
                            raise MediaError('El fragmento del archivo tiene un tamaño incorrecto.')
                        saved = db.execute("INSERT INTO outreach_media_chunks(media_id,part,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM outreach_media WHERE id=? AND state='uploading') ON CONFLICT(media_id,part) DO UPDATE SET data=excluded.data WHERE EXISTS(SELECT 1 FROM outreach_media WHERE id=? AND state='uploading') RETURNING part", (media_id, number, data, media_id, media_id)).fetchone()
                        db.commit()
                        if saved is None:
                            raise MediaError('El archivo cambió durante la subida. Vuelve a intentarlo.', 409)
                        return jsonify(ok=True, id=media_id, part=number)
                    return jsonify(error='Método no permitido.'), 405
                if request.method in ['GET', 'HEAD'] and action in [None, 'metadata']:
                    row = _row(db, media_id, True)
                    if action == 'metadata':
                        return jsonify(**_metadata(row))
                    saved = dict(row)
                    def chunks():
                        for number in range(_parts(saved['size'])):
                            with closing(connect(db_path)) as streamed_db:
                                yield _part(streamed_db, saved, number)
                    response = Response(stream_with_context(chunks()) if request.method != 'HEAD' else None, mimetype=saved['type'])
                    from urllib.parse import quote
                    response.headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + quote(saved['name'], safe='')
                    response.headers['Content-Length'] = str(saved['size'])
                    return response
            return jsonify(error='Método no permitido.'), 405
        except MediaError as error:
            return jsonify(error=str(error)), error.status
        except (sqlite3.Error, ValueError, KeyError, TypeError):
            return jsonify(error='No se pudo guardar o leer el archivo. Reintenta y comprueba la conexión del CRM.'), 503
