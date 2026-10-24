import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'connector_build', ROOT / 'cloud/connector_build.py',
)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class AssetAllowlistTests(unittest.TestCase):
    def test_only_explicit_public_files_are_embedded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'styles.css').write_text('body{color:red}')
            (root / '.env').write_text('CREDENTIAL=should-not-be-embedded')
            assets = build.asset_map(root, {'styles.css': 'styles.css'})
            self.assertEqual(list(assets), ['/styles.css'])
            self.assertEqual(base64.b64decode(assets['/styles.css']['body']),
                             b'body{color:red}')
            self.assertNotIn('should-not-be-embedded', json.dumps(assets))
            for bad in ['../styles.css', '/styles.css', '.env', 'a\\styles.css']:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    build.asset_map(root, {'styles.css': bad})

    def test_traversal_routes_and_escaping_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            (root / 'ok.css').write_text('safe')
            secret = Path(outside) / 'private.css'
            secret.write_text('not public')
            (root / 'linked.css').symlink_to(secret)
            with self.assertRaises(ValueError):
                build.asset_map(root, {'linked.css': 'linked.css'})
            for route in ['../ok.css', '/ok.css', 'a//ok.css']:
                with self.subTest(route=route), self.assertRaises(ValueError):
                    build.asset_map(root, {route: 'ok.css'})


@unittest.skipUnless(build.DEFAULT_ESBUILD.exists(), 'esbuild no está instalado')
class CompiledWorkerTests(unittest.TestCase):
    def test_crm_and_panel_preserve_handlers_authentication_and_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            manifests = {
                kind: build.build_worker(kind, directory)
                for kind in ['crm', 'panel']
            }
            for kind, manifest in manifests.items():
                content = Path(manifest['worker_path']).read_bytes()
                self.assertEqual(manifest['worker_sha256'], hashlib.sha256(content).hexdigest())
                self.assertEqual(manifest['worker_bytes'], len(content))
                self.assertFalse(manifest['resources_created'])
                self.assertTrue(manifest['assets_embedded'])
                self.assertNotIn('ASSETS', [row['name'] for row in manifest['required_bindings']])
                self.assertTrue(all('text' not in row and 'id' not in row
                                    for row in manifest['required_bindings']))
            program = r'''
                import { pathToFileURL } from 'node:url';
                const crm = await import(pathToFileURL(process.argv[1]));
                const panel = await import(pathToFileURL(process.argv[2]));
                const c = crm.default, p = panel.default;
                const health = await c.fetch(new Request('https://crm.test/healthz'), {});
                const css = await c.fetch(new Request('https://crm.test/styles.css'), {});
                const privatePage = await c.fetch(new Request('https://crm.test/'), {});
                const panelClosed = await p.fetch(new Request('https://panel.test/'), {PUBLIC_URL:'https://panel.test'});
                let forwarded = false;
                const secret = 'a'.repeat(64);
                const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))),v=>v.toString(16).padStart(2,'0')).join('');
                const DB = {prepare: sql => ({bind: id => ({first: async () => {
                    forwarded = id === 'b'.repeat(32) && sql.includes('lifecycle_hash');
                    return {status:'active',lifecycle_hash:hash,session_after:0};
                }})})};
                const life = await p.fetch(new Request('https://control.internal/lifecycle/'+'b'.repeat(32),{headers:{Authorization:'Bearer '+secret}}),{DB});
                console.log(JSON.stringify({
                    crmHandlers: typeof c.fetch==='function' && typeof c.scheduled==='function',
                    panelHandlers: typeof p.fetch==='function' && typeof p.scheduled==='function',
                    namedHandlers: typeof crm.handleRequest==='function' && typeof panel.handlePanel==='function',
                    health: await health.json(),cssStatus:css.status,cssType:css.headers.get('Content-Type'),
                    privateStatus:privatePage.status,panelClosed:panelClosed.status,
                    lifecycle:await life.json(),forwarded
                }));
            '''
            result = subprocess.run([
                'node', '--input-type=module', '-e', program,
                manifests['crm']['worker_path'], manifests['panel']['worker_path'],
            ], check=True, text=True, capture_output=True)
            data = json.loads(result.stdout)
            self.assertTrue(data['crmHandlers'])
            self.assertTrue(data['panelHandlers'])
            self.assertTrue(data['namedHandlers'])
            self.assertEqual(data['health'], {'status': 'ok', 'configured': False})
            self.assertEqual(data['cssStatus'], 200)
            self.assertTrue(data['cssType'].startswith('text/css'))
            self.assertEqual(data['privateStatus'], 503)
            self.assertEqual(data['panelClosed'], 503)
            self.assertTrue(data['forwarded'])
            self.assertEqual(data['lifecycle'], {'status': 'active', 'sessionAfter': 0})


if __name__ == '__main__':
    unittest.main()
