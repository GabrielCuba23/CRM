import copy
import json
import tempfile
import unittest
from pathlib import Path

from backend.app import create_app
from backend.storage import default_workspace
from backend.validation import validate_workspace


class MenuSectionsTest(unittest.TestCase):
    def test_legacy_workspaces_do_not_gain_menu_preferences(self):
        state = default_workspace()
        original = copy.deepcopy(state)
        self.assertNotIn('menuSections', state['settings'])
        self.assertNotIn('menuSections', validate_workspace(state)['settings'])
        self.assertEqual(state, original)

    def test_empty_partial_and_full_preferences_survive_json_backup_restore(self):
        for preferences in [{}, {'security': True, 'automation': False}, {
            'security': False, 'automation': True, 'integrations': False,
            'settings': True, 'marketing': False, 'social': True,
        }]:
            with self.subTest(preferences=preferences):
                state = default_workspace()
                state['settings']['menuSections'] = preferences
                original = copy.deepcopy(state)
                clean = validate_workspace(state)
                self.assertEqual(clean['settings']['menuSections'], preferences)
                restored = validate_workspace(json.loads(json.dumps(clean)))
                self.assertEqual(restored['settings']['menuSections'], preferences)
                self.assertEqual(state, original)

    def test_rejects_malformed_objects_unknown_keys_and_non_boolean_flags(self):
        invalid = [None, [], [True], 'security', True, 1,
                   {'clients': False}, {'security': True, 'unknown': False},
                   {'__proto__': False}]
        invalid += [{'security': value} for value in [None, 0, 1, '', 'true', 'false', [], {}]]
        for preferences in invalid:
            with self.subTest(preferences=preferences):
                state = default_workspace()
                state['settings']['menuSections'] = preferences
                with self.assertRaises(ValueError):
                    validate_workspace(state)

    def test_flask_save_reload_keeps_preferences_and_rejects_invalid_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {
                'TESTING': True, 'DB_PATH': str(Path(directory) / 'crm.sqlite3'),
                'PUBLIC_URL': 'http://localhost', 'ALLOW_HTTP': True,
                'OWNER_EMAIL': 'owner@example.com', 'OWNER_PASSWORD': 'test-only-long-password',
            }
            app = create_app(config)
            client = app.test_client()
            origin = {'Origin': 'http://localhost'}
            login = client.post('/api/login', json={
                'email': config['OWNER_EMAIL'], 'password': config['OWNER_PASSWORD'],
            }, headers=origin)
            self.assertEqual(login.status_code, 200)
            headers = {**origin, 'X-CSRF-Token': login.json['csrf']}
            self.assertNotIn('menuSections', client.get('/api/workspace').json['state']['settings'])
            state = default_workspace()
            state['settings']['menuSections'] = {
                'security': True, 'automation': False, 'integrations': True,
                'settings': False, 'marketing': True, 'social': False,
            }
            response = client.put('/api/workspace', json={'state': state, 'revision': 0}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(client.get('/api/workspace').json['state']['settings']['menuSections'], state['settings']['menuSections'])

            invalid = copy.deepcopy(state)
            invalid['settings']['menuSections']['social'] = 1
            response = client.put('/api/workspace', json={'state': invalid, 'revision': 1}, headers=headers)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(client.get('/api/workspace').json['revision'], 1)

            restarted = create_app(config).test_client()
            self.assertEqual(restarted.post('/api/login', json={
                'email': config['OWNER_EMAIL'], 'password': config['OWNER_PASSWORD'],
            }, headers=origin).status_code, 200)
            self.assertEqual(restarted.get('/api/workspace').json['state']['settings']['menuSections'], state['settings']['menuSections'])
