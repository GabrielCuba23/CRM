import concurrent.futures
import hashlib
import json
import os
import secrets
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from werkzeug.test import Client
from werkzeug.wrappers import Response

from backend.storage import connect, default_workspace, read_workspace
from retail.dispatcher import create_dispatcher
from retail.registry import Registry


class RetailTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.password = secrets.token_urlsafe(24)
        self.config = {'TESTING': True, 'PUBLIC_URL': 'https://admin.retail.test', 'BASE_DOMAIN': 'clients.retail.test',
                       'DATA_ROOT': self.directory.name, 'ADMIN_EMAIL': 'operator@example.com', 'ADMIN_PASSWORD': self.password}
        self.dispatcher = create_dispatcher(self.config)
        self.registry = self.dispatcher.registry
        self.admin = Client(self.dispatcher, Response)
        self.admin_url = self.config['PUBLIC_URL']
        self.headers = {'Origin': self.admin_url}
        response = self.admin.post('/api/login', base_url=self.admin_url,
                                   json={'email': self.config['ADMIN_EMAIL'], 'password': self.password}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.auth = {**self.headers, 'X-CSRF-Token': response.json['csrf']}

    def tearDown(self):
        self.directory.cleanup()

    def create(self, slug='customer-one'):
        response = self.admin.post('/api/instances', base_url=self.admin_url,
                                   json={'name': 'Negocio ' + slug, 'slug': slug, 'ownerEmail': slug + '@example.com',
                                         'crmName': 'Mi CRM ' + slug, 'business': 'Mi empresa'}, headers=self.auth)
        self.assertEqual(response.status_code, 201, response.data)
        return response.json

    @staticmethod
    def token(result):
        return parse_qs(urlsplit(result['activationUrl']).fragment)['token'][0]

    def activate(self, result, client=None, token=None, email=None):
        client = client or Client(self.dispatcher, Response)
        password = secrets.token_urlsafe(24)
        instance = result['instance']
        response = client.post('/api/activate', base_url=instance['url'],
                               json={'email': email or instance['ownerEmail'], 'password': password,
                                     'token': token or self.token(result)}, headers={'Origin': instance['url']})
        return client, password, response

    def login_tenant(self, result, client, password):
        instance = result['instance']
        response = client.post('/api/login', base_url=instance['url'],
                               json={'email': instance['ownerEmail'], 'password': password}, headers={'Origin': instance['url']})
        self.assertEqual(response.status_code, 200, response.data)
        return {'Origin': instance['url'], 'X-CSRF-Token': response.json['csrf']}

    def test_clean_instance_unique_private_files_and_metadata_only(self):
        with patch.dict(os.environ, {'CRM_OWNER_EMAIL': 'personal@example.com', 'CRM_OWNER_PASSWORD': self.password}):
            first, second = self.create(), self.create('customer-two')
            self.dispatcher.apps.clear()
            unknown = Client(self.dispatcher, Response).get('/api/workspace', base_url=first['instance']['url'])
            self.assertEqual(unknown.status_code, 401)
        first_path = self.registry.database(first['instance']['id'])
        second_path = self.registry.database(second['instance']['id'])
        self.assertNotEqual(first_path, second_path)
        self.assertEqual(Path(first_path).stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(first_path).parent.stat().st_mode & 0o777, 0o700)
        with connect(first_path) as db:
            self.assertIsNone(db.execute('SELECT id FROM owner').fetchone())
        state, revision = read_workspace(first_path)
        self.assertEqual(revision, 0)
        for collection in ['clients', 'accounts', 'ledger', 'combos']:
            self.assertEqual(state[collection], [])
        self.assertEqual(state['settings']['crmName'], first['instance']['crmName'])
        listed = self.admin.get('/api/instances', base_url=self.admin_url).json
        self.assertEqual(len(listed['instances']), 2)
        self.assertNotIn(self.token(first), json.dumps(listed))
        self.assertNotIn('password', json.dumps(listed))
        self.assertEqual(self.admin.get('/api/workspace', base_url=self.admin_url).status_code, 404)
        self.assertEqual(self.admin.get('/../instances/a/crm.sqlite3', base_url=self.admin_url).status_code, 404)
        self.assertNotIn('workspace', Path(self.registry.path).read_bytes().decode('latin1'))
        with self.registry.connect() as db:
            row = db.execute('SELECT invitation_hash FROM instances WHERE id=?', (first['instance']['id'],)).fetchone()
            self.assertEqual(row[0], hashlib.sha256(self.token(first).encode()).hexdigest())

    def test_activation_owner_email_one_use_and_login(self):
        result = self.create()
        client, password, wrong = self.activate(result, email='not-owner@example.com')
        self.assertEqual(wrong.status_code, 401)
        client, password, response = self.activate(result, client)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json['loginUrl'], '/login')
        login_page = client.get('/login', base_url=result['instance']['url'])
        self.assertEqual(login_page.status_code, 200)
        self.assertIn(result['instance']['crmName'], login_page.text)
        self.assertEqual(self.activate(result)[2].status_code, 401)
        self.login_tenant(result, client, password)
        response = client.get('/api/workspace', base_url=result['instance']['url'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['state']['settings']['crmName'], result['instance']['crmName'])
        row = self.registry.get(result['instance']['id'])
        self.assertEqual(row['status'], 'active')
        self.assertIsNone(row['invitation_hash'])
        self.assertIsNone(row['invitation_expires'])
        self.assertNotIn(password, Path(self.registry.database(row['id'])).read_bytes().decode('latin1'))
        self.assertEqual(self.admin.post(f"/api/instances/{row['id']}/invitation", base_url=self.admin_url, json={}, headers=self.auth).status_code, 409)

    def test_expired_invitation_rotation_and_wrong_host(self):
        first, second = self.create(), self.create('customer-two')
        self.assertEqual(self.activate(second, token=self.token(first))[2].status_code, 401)
        with self.registry.connect() as db:
            db.execute('UPDATE instances SET invitation_expires=? WHERE id=?', (int(time.time()) - 1, first['instance']['id']))
        self.assertEqual(self.activate(first)[2].status_code, 401)
        renewed = self.admin.post(f"/api/instances/{first['instance']['id']}/invitation", base_url=self.admin_url, json={}, headers=self.auth)
        self.assertEqual(renewed.status_code, 200)
        self.assertNotEqual(self.token(first), self.token(renewed.json))
        self.assertEqual(self.activate(first)[2].status_code, 401)
        self.assertEqual(self.activate(renewed.json)[2].status_code, 200)

    def test_two_tenants_and_operator_cookie_never_cross_data(self):
        first, second = self.create(), self.create('customer-two')
        client_a, password_a, response_a = self.activate(first)
        client_b, password_b, response_b = self.activate(second)
        self.assertEqual(response_a.status_code, 200)
        self.assertEqual(response_b.status_code, 200)
        headers_a = self.login_tenant(first, client_a, password_a)
        headers_b = self.login_tenant(second, client_b, password_b)
        state = default_workspace()
        state['settings']['business'] = 'CONFIDENTIAL COMPANY A'
        self.assertEqual(client_a.put('/api/workspace', base_url=first['instance']['url'], json={'state': state, 'revision': 0}, headers=headers_a).status_code, 200)
        self.assertNotIn('CONFIDENTIAL COMPANY A', client_b.get('/api/workspace', base_url=second['instance']['url']).text)
        admin_cookie = self.admin.get_cookie('__Host-retail_session', domain='admin.retail.test').value
        intruder = Client(self.dispatcher, Response)
        intruder.set_cookie('__Host-retail_session', admin_cookie, domain=urlsplit(first['instance']['url']).hostname)
        intruder.set_cookie('__Host-nexo_session', admin_cookie, domain=urlsplit(first['instance']['url']).hostname)
        self.assertEqual(intruder.get('/api/workspace', base_url=first['instance']['url']).status_code, 401)
        a_cookie = client_a.get_cookie('__Host-nexo_session', domain=urlsplit(first['instance']['url']).hostname).value
        intruder.set_cookie('__Host-nexo_session', a_cookie, domain=urlsplit(second['instance']['url']).hostname)
        self.assertEqual(intruder.get('/api/workspace', base_url=second['instance']['url']).status_code, 401)
        self.assertEqual(intruder.put('/api/workspace', base_url=second['instance']['url'], json={'state': state, 'revision': 0}, headers={'Origin': second['instance']['url'], 'X-CSRF-Token': headers_a['X-CSRF-Token']}).status_code, 401)
        intruder.set_cookie('__Host-retail_session', a_cookie, domain='admin.retail.test')
        self.assertEqual(intruder.get('/api/instances', base_url=self.admin_url).status_code, 401)
        self.assertEqual(client_b.get('/api/session', base_url=second['instance']['url']).json['csrf'], headers_b['X-CSRF-Token'])

    def test_suspended_crm_blocks_existing_cookie_assets_and_api(self):
        result = self.create()
        client, password, response = self.activate(result)
        self.assertEqual(response.status_code, 200)
        self.login_tenant(result, client, password)
        url = f"/api/instances/{result['instance']['id']}"
        self.assertEqual(self.admin.patch(url, base_url=self.admin_url, json={'status': 'suspended'}, headers=self.auth).status_code, 200)
        for path in ['/', '/api/workspace', '/app.js', '/login', '/api/session', '/activate', '/styles.css']:
            self.assertEqual(client.get(path, base_url=result['instance']['url']).status_code, 403, path)
        self.assertEqual(self.admin.patch(url, base_url=self.admin_url, json={'status': 'active'}, headers=self.auth).status_code, 200)
        self.assertEqual(client.get('/api/workspace', base_url=result['instance']['url']).status_code, 401)
        self.login_tenant(result, client, password)
        self.assertEqual(client.get('/api/workspace', base_url=result['instance']['url']).status_code, 200)

    def test_unicode_owner_email_activation_is_safe(self):
        instance, activation_url = self.registry.create({'name': 'Mi CRM', 'slug': 'unicode-owner', 'ownerEmail': 'dueño@example.com'})
        result = {'instance': instance, 'activationUrl': activation_url}
        self.assertEqual(self.activate(result, email='extraño@example.com')[2].status_code, 401)
        self.assertEqual(self.activate(result)[2].status_code, 200)

    def test_host_origin_csrf_and_secrets_fail_closed(self):
        guest = Client(self.dispatcher, Response)
        self.assertEqual(guest.get('/api/instances', base_url=self.admin_url).status_code, 401)
        self.assertEqual(self.admin.post('/api/instances', base_url=self.admin_url, json={}, headers=self.headers).status_code, 403)
        self.assertEqual(self.admin.post('/api/instances', base_url=self.admin_url, json={}, headers={**self.auth, 'Origin': 'https://attacker.test'}).status_code, 403)
        for host in ['https://unknown.retail.test', 'https://admin.retail.test.evil.test', 'https://admin.retail.test:444', 'https://ADMIN.retail.test']:
            # Werkzeug normalizes URL case, therefore pass raw Host explicitly.
            self.assertEqual(guest.get('/healthz', base_url=host, headers={'Host': urlsplit(host).netloc, 'X-Forwarded-Host': 'admin.retail.test'}).status_code, 404)
        result = self.create()
        self.assertEqual(guest.post('/api/activate', base_url=result['instance']['url'], json={}, headers={'Origin': self.admin_url}).status_code, 403)
        for path in ['/backend/app.py', '/.env', '/crm.sqlite3', '/retail/registry.py']:
            self.assertEqual(self.admin.get(path, base_url=self.admin_url).status_code, 404)
        response = self.admin.get('/api/instances', base_url=self.admin_url)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')

    def test_config_and_slug_validation_and_duplicate_instances(self):
        for value in ['https://u:p@admin.test', 'https://admin.test/path', 'https://admin.test#token=x', 'https://admin.test?token=x', 'https://admin.test:bad', 'http://admin.test']:
            with self.assertRaises(ValueError):
                Registry({**self.config, 'PUBLIC_URL': value})
        for domain in ['../../data', 'https://clients.test', 'clients.test/path', 'clients.test:443', '*']:
            with self.assertRaises(ValueError):
                Registry({**self.config, 'BASE_DOMAIN': domain})
        for slug in ['../one', 'admin', 'foo.bar', 'foo/../bar', 'foo--bar', '-foo', 'a' * 41]:
            response = self.admin.post('/api/instances', base_url=self.admin_url, json={'name': 'CRM', 'slug': slug, 'ownerEmail': 'o@example.com'}, headers=self.auth)
            self.assertEqual(response.status_code, 400, slug)
        result = self.create()
        response = self.admin.post('/api/instances', base_url=self.admin_url, json={'name': 'CRM', 'slug': result['instance']['slug'], 'ownerEmail': 'o@example.com'}, headers=self.auth)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(self.registry.list()), 1)
        self.assertEqual(self.admin.patch(f"/api/instances/{result['instance']['id']}", base_url=self.admin_url, json={'status': 'active'}, headers=self.auth).status_code, 409)
        self.assertEqual(self.admin.patch(f"/api/instances/{result['instance']['id']}", base_url=self.admin_url, json={'status': 'suspended'}, headers=self.auth).status_code, 409)
        for status in [[], {}, None, False]:
            self.assertEqual(self.admin.patch(f"/api/instances/{result['instance']['id']}", base_url=self.admin_url, json={'status': status}, headers=self.auth).status_code, 409)
        with self.assertRaises(ValueError):
            self.registry.database('../../escape')

    def test_concurrent_invite_only_one_owner_and_integrations_disconnected(self):
        result = self.create()
        with patch.dict(os.environ, {'WHATSAPP_ACCESS_TOKEN': 'global-secret', 'WHATSAPP_PHONE_NUMBER_ID': 'global-number', 'RESEND_API_KEY': 'global-mail', 'REPORT_FROM_EMAIL': 'sender@example.com'}):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                outcomes = list(pool.map(lambda _: self.activate(result), range(2)))
            self.assertEqual(sorted(x[2].status_code for x in outcomes), [200, 401])
            client, password, _ = next(x for x in outcomes if x[2].status_code == 200)
            self.login_tenant(result, client, password)
            for path in ['/api/automation-status', '/api/report-status']:
                response = client.get(path, base_url=result['instance']['url'])
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json['configured'])
                self.assertNotIn('global-secret', response.text)

    def test_optional_tls_port_is_canonical(self):
        with tempfile.TemporaryDirectory() as directory:
            dispatcher = create_dispatcher({**self.config, 'DATA_ROOT': directory, 'PUBLIC_URL': 'https://admin.retail.test:8443', 'TENANT_PORT': 8443})
            result, activation = dispatcher.registry.create({'name': 'CRM', 'slug': 'example', 'ownerEmail': 'o@example.com'})
            self.assertEqual(result['url'], 'https://example.clients.retail.test:8443')
            self.assertIn(':8443/activate#token=', activation)
            client = Client(dispatcher, Response)
            self.assertEqual(client.get('/healthz', base_url=result['url']).status_code, 200)
            self.assertEqual(client.get('/healthz', base_url='https://example.clients.retail.test').status_code, 404)

    def test_unicode_csrf_denied_without_changing_customer_workspace(self):
        from backend.app import create_app as create_crm_app

        result = self.create()
        client, password, response = self.activate(result)
        self.assertEqual(response.status_code, 200)
        auth = self.login_tenant(result, client, password)
        before = client.get('/api/workspace', base_url=result['instance']['url']).json
        payload = {'state': default_workspace(), 'revision': before['revision']}
        response = client.put('/api/workspace', base_url=result['instance']['url'], json=payload,
                              headers={**auth, 'X-CSRF-Token': 'sesión-no-válida'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(client.get('/api/workspace', base_url=result['instance']['url']).json, before)

        # Verify the shared single-owner authentication itself, without the retail
        # lifecycle gate, so both tenant and standalone deployments reject safely.
        standalone = create_crm_app({'TESTING': True, 'DB_PATH': self.registry.database(result['instance']['id']),
                                     'PUBLIC_URL': result['instance']['url'], 'OWNER_EMAIL': '', 'OWNER_PASSWORD': ''})
        direct = standalone.test_client()
        response = direct.post('/api/login', base_url=result['instance']['url'],
                               json={'email': result['instance']['ownerEmail'], 'password': password},
                               headers={'Origin': result['instance']['url']})
        self.assertEqual(response.status_code, 200)
        response = direct.put('/api/workspace', base_url=result['instance']['url'], json=payload,
                              headers={'Origin': result['instance']['url'], 'X-CSRF-Token': 'sesión-no-válida'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(direct.get('/api/workspace', base_url=result['instance']['url']).json, before)


if __name__ == '__main__':
    unittest.main()
