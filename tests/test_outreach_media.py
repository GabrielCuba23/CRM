import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from backend.app import create_app
from backend.storage import connect


class OutreachMediaTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = str(Path(self.directory.name) / 'crm.sqlite3')
        self.app = create_app({'TESTING': True, 'DB_PATH': self.db, 'PUBLIC_URL': 'http://localhost', 'ALLOW_HTTP': True, 'OWNER_EMAIL': 'owner@example.test', 'OWNER_PASSWORD': 'Synthetic media password 123!'})
        self.client = self.app.test_client()
        self.origin = {'Origin': 'http://localhost'}
        login = self.client.post('/api/login', json={'email': 'owner@example.test', 'password': 'Synthetic media password 123!'}, headers=self.origin)
        self.assertEqual(login.status_code, 200)
        self.headers = dict(self.origin, **{'X-CSRF-Token': login.json['csrf']})

    def tearDown(self):
        self.directory.cleanup()

    def create(self, data, mime='image/png'):
        response = self.client.post('/api/outreach/media', json={'name': 'Foto sintética.png', 'type': mime, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['media']

    def upload(self, media, data):
        size = 524288
        for part in reversed(range((len(data) + size - 1) // size)):
            response = self.client.put('/api/outreach/media/' + media['id'] + '/chunks/' + str(part), json={'data': base64.b64encode(data[part * size:(part + 1) * size]).decode('ascii')}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.json)
        return self.client.post('/api/outreach/media/' + media['id'] + '/complete', json={}, headers=self.headers)

    def test_private_authenticated_chunk_protocol_preserves_binary_and_blocks_mutation(self):
        path = '/api/outreach/media'
        self.assertEqual(self.app.test_client().get(path).status_code, 401)
        self.assertEqual(self.client.post(path, json={}, headers=self.origin).status_code, 403)
        self.assertEqual(self.client.post(path, json={}, headers=dict(self.headers, Origin='https://other.test')).status_code, 403)
        data = b'\x89PNG\r\n\x1a\n' + bytes(range(256)) * 5000
        media = self.create(data)
        self.assertEqual(self.client.get(path + '/' + media['id'] + '/metadata').status_code, 404)
        self.assertEqual(self.upload(media, data).status_code, 200)
        listing = self.client.get(path).json
        self.assertEqual(listing['media'], [media])
        self.assertEqual(listing['usedBytes'], len(data))
        downloaded = self.client.get(path + '/' + media['id'])
        self.assertEqual(downloaded.data, data)
        self.assertEqual(downloaded.headers['Content-Type'], 'image/png')
        self.assertIn('no-store', downloaded.headers['Cache-Control'])
        self.assertEqual(self.client.put(path + '/' + media['id'] + '/chunks/0', json={'data': ''}, headers=self.headers).status_code, 409)
        self.assertEqual(self.client.post(path + '/' + media['id'] + '/complete', json={}, headers=self.headers).status_code, 200)

    def test_hash_signature_limits_and_incomplete_upload_never_become_ready(self):
        png = b'\x89PNG\r\n\x1a\nfixture'
        media = self.create(png)
        self.assertEqual(self.client.post('/api/outreach/media/' + media['id'] + '/complete', json={}, headers=self.headers).status_code, 409)
        wrong = dict(media, size=20971521)
        self.assertEqual(self.client.post('/api/outreach/media', json=wrong, headers=self.headers).status_code, 413)
        bad = self.create(b'<script>fake PNG</script>')
        self.assertEqual(self.upload(bad, b'<script>fake PNG</script>').status_code, 400)
        mismatch = self.create(png)
        self.assertEqual(self.upload(mismatch, png[:-1] + b'X').status_code, 400)
        self.assertEqual(self.client.get('/api/outreach/media').json['media'], [])

    def test_references_preserve_templates_and_explicit_delete_removes_all_chunks(self):
        data = b'\x89PNG\r\n\x1a\nfixture'
        media = self.create(data)
        self.assertEqual(self.upload(media, data).status_code, 200)
        with connect(self.db) as db:
            db.execute('INSERT INTO workspace(id,revision,body) VALUES(1,1,?)', (json.dumps({'growth': {'outreach': {'templates': [{'media': [media]}]}}}),))
        url = '/api/outreach/media/' + media['id']
        self.assertEqual(self.client.delete(url, json={}, headers=self.headers).status_code, 409)
        with connect(self.db) as db:
            db.execute('DELETE FROM workspace')
        self.assertEqual(self.client.delete(url, json={}, headers=self.headers).status_code, 200)
        with connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM outreach_media_chunks').fetchone()[0], 0)
        self.assertEqual(self.client.get(url).status_code, 404)


if __name__ == '__main__':
    unittest.main()
