import tempfile
import unittest
from pathlib import Path
from backend.app import create_app


class EngagementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING': True, 'DB_PATH': str(Path(self.temp.name) / 'crm.sqlite3'), 'PUBLIC_URL': 'http://localhost', 'ALLOW_HTTP': True, 'OWNER_EMAIL': 'owner@example.test', 'OWNER_PASSWORD': 'Synthetic rules password 1!'})
        self.client = self.app.test_client()
        login = self.client.post('/api/login', json={'email': 'owner@example.test', 'password': 'Synthetic rules password 1!'}, headers={'Origin': 'http://localhost'})
        self.headers = {'Origin': 'http://localhost', 'X-CSRF-Token': login.json['csrf']}

    def tearDown(self):
        self.temp.cleanup()

    def configured(self):
        config = self.client.get('/api/engagement').json
        config['lines'] = [dict(id='line' + str(i), name='Línea ' + str(i), phone='5191234567' + str(i), enabled=True, allowBackground=True) for i in range(5)]
        config['bot'].update(enabled=True, rules=[dict(id='hi', name='Saludo', enabled=True, match='contains', keywords=['hola'], text='Hola {nombre}', media=[])])
        response = self.client.put('/api/engagement', json=config, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def lease(self, index=0):
        body = dict(lineId='line' + str(index), installationId=str(index + 1) * 32)
        response = self.client.post('/api/engagement/lease', json=body, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.json)
        body['leaseToken'] = response.json['leaseToken']
        return body

    def test_private_disabled_defaults_and_csrf(self):
        self.assertEqual(self.app.test_client().get('/api/engagement').status_code, 401)
        config = self.client.get('/api/engagement').json
        self.assertFalse(config['bot']['enabled'])
        self.assertEqual(self.client.put('/api/engagement', json=config).status_code, 403)

    def test_maximum_five_and_revision_conflict_preserve_configuration(self):
        config = self.configured()
        config['lines'].append(dict(config['lines'][0], id='six'))
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 400)
        config['lines'].pop()
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 409)

    def test_five_profiles_are_independent_and_competing_lease_is_rejected(self):
        self.configured()
        leases = [self.lease(i) for i in range(5)]
        duplicate = dict(lineId='line0', installationId='e' * 32)
        self.assertEqual(self.client.post('/api/engagement/lease', json=duplicate, headers=self.headers).status_code, 409)
        config = self.client.get('/api/engagement').json
        self.assertEqual(sum(line['online'] for line in config['lines']), 5)
        self.assertNotIn(leases[0]['leaseToken'], str(config))

    def test_claim_deduplication_and_stop_all_prevent_duplicate_or_revoked_send(self):
        self.configured()
        fields = self.lease()
        body = dict(fields, phone='51998765432', incomingId='false_fixture@lid_new', incomingText='hola', ruleId='hi')
        response = self.client.post('/api/engagement/bot/claim', json=body, headers=self.headers)
        self.assertTrue(response.json['claimed'], response.json)
        grant = response.json
        self.assertFalse(self.client.post('/api/engagement/bot/claim', json=body, headers=self.headers).json['claimed'])
        permit = dict(fields, claimId=grant['claimId'], claimToken=grant['claimToken'])
        self.assertTrue(self.client.post('/api/engagement/bot/permit', json=permit, headers=self.headers).json['allowed'])
        self.client.post('/api/engagement/stop', json={}, headers=self.headers)
        self.assertFalse(self.client.post('/api/engagement/bot/permit', json=permit, headers=self.headers).json['allowed'])
        result = dict(claimId=grant['claimId'], claimToken=grant['claimToken'], status='uncertain', error='Interrupción sintética')
        self.assertEqual(self.client.post('/api/engagement/bot/result', json=result, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/engagement/history').json['items'][0]['status'], 'uncertain')


if __name__ == '__main__':
    unittest.main()
