"""Validate deployment ordering without creating Cloudflare resources."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'cloud'))
spec = importlib.util.spec_from_file_location('panel_deploy', ROOT / 'cloud/panel/deploy.py')
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)

class API:
    account = '0' * 32
    def __init__(self, collision=False):
        self.calls = []
        self.collision = collision
    def call(self, method, path, data=None):
        self.calls.append((method, path, data))
        if method == 'GET':
            return {
                '/workers/subdomain': {'subdomain': 'test-only'},
                '/d1/database?per_page=100': [{'name': 'nexo-crm'}],
                '/access/apps?per_page=100': [{'aud': 'original-aud'}],
                '/workers/scripts': [{'id': panel.NAME}] if self.collision else [{'id': 'nexo-crm'}],
            }[path]
        if path == '/d1/database': return {'uuid': 'panel-db'}
        if path.endswith('/query'): return [{'success': True}]
        if path == '/access/apps': return {'id': 'panel-app', 'aud': 'panel-aud'}
        raise AssertionError((method, path))

class PanelDeployTests(unittest.TestCase):
    def test_registry_and_owner_are_separate_and_publication_starts_closed(self):
        api = API()
        published = []
        with patch.object(panel, 'ensure_access_team', return_value='test.cloudflareaccess.com'), patch.object(panel, 'ensure_pin', return_value={'id': 'pin'}), patch.object(panel, 'publish', side_effect=lambda config, *args: published.append(json.loads(json.dumps(config)))):
            url, record = panel.deploy_panel(api, 'gabostreaming0@gmail.com', ROOT/'cloud/panel/build/assets', 'mock-wrangler')
        try:
            self.assertEqual(url, 'https://nexo-retail-panel.test-only.workers.dev')
            self.assertEqual([c['vars']['ACCESS_AUD'] for c in published], ['not-configured-closed', 'panel-aud'])
            self.assertTrue(all(c['d1_databases'][0]['database_id'] == 'panel-db' for c in published))
            self.assertTrue(all(c['assets']['run_worker_first'] for c in published))
            self.assertTrue(all('RETAIL_PROVISION_TOKEN' not in c['vars'] for c in published))
            access = next(data for method, path, data in api.calls if method == 'POST' and path == '/access/apps')
            self.assertEqual(access['policies'][0]['include'], [{'email': {'email': 'gabostreaming0@gmail.com'}}])
            self.assertEqual(json.loads(record.read_text())['status'], 'published_pending_verification')
            self.assertEqual(record.stat().st_mode & 0o777, 0o600)
            self.assertFalse(any('nexo-crm' in path for method, path, data in api.calls if method != 'GET'))
        finally:
            import shutil
            shutil.rmtree(record.parent)
    def test_existing_namespace_refuses_to_overwrite(self):
        api = API(collision=True)
        with patch.object(panel, 'ensure_access_team', return_value='test.cloudflareaccess.com'), patch.object(panel, 'ensure_pin', return_value={'id': 'pin'}), patch.object(panel, 'publish') as publish:
            with self.assertRaises(RuntimeError): panel.deploy_panel(api, 'owner@example.com', ROOT, 'mock')
            publish.assert_not_called()
        self.assertTrue(all(method == 'GET' for method, path, data in api.calls))

if __name__ == '__main__': unittest.main()
