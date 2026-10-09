import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cloud"))
import retail_deploy


class API:
    account = "0" * 32

    def __init__(self, databases=None, apps=None, scripts=None):
        self.calls = []
        self.databases = databases or []
        self.apps = apps or []
        self.scripts = scripts or []

    def call(self, method, path, data=None, **kwargs):
        self.calls.append((method, path, data))
        if method == "GET":
            return {
                "/workers/subdomain": {"subdomain": "isolated-test"},
                "/d1/database?per_page=100": self.databases,
                "/access/apps?per_page=100": self.apps,
                "/workers/scripts": self.scripts,
            }[path]
        if path == "/d1/database":
            return {"uuid": "isolated-db"}
        if path.endswith("/query"):
            return [{"success": True, "results": []}]
        if path == "/access/apps":
            return {"id": "exclusive-app", "aud": "exclusive-aud"}
        raise AssertionError((method, path))


class RetailCloudTests(unittest.TestCase):
    def manifest(self, instance_id="1" * 32):
        return retail_deploy.instance_manifest(instance_id, "cliente", "Owner@Example.com", "Mi CRM")

    def test_full_ids_are_distinct_even_for_same_slug_and_prefix(self):
        first, second = self.manifest(), self.manifest("1" * 31 + "2")
        self.assertNotEqual(first["worker_name"], second["worker_name"])
        self.assertNotEqual(first["database_name"], second["database_name"])
        self.assertNotEqual(first["database_name"], "nexo-crm")
        self.assertEqual(first["owner_email"], "owner@example.com")
        for bad in ("../owner", "UPPER", "a" * 41, "evil.local/"):
            with self.assertRaises(ValueError):
                retail_deploy.instance_manifest("1" * 32, bad, "owner@example.com", "CRM")
        with self.assertRaises(ValueError):
            retail_deploy.instance_manifest("1" * 32, "client", "bad\n@example.com", "CRM")

    def test_assets_and_offline_manifest_are_separate_and_no_data_copied(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = retail_deploy.prepare(self.manifest(), Path(temporary) / "client")
            saved = json.loads((directory / "instance.json").read_text())
            self.assertFalse(saved["data_copied"])
            self.assertEqual((directory / "instance.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertTrue((directory / "assets/index.html").is_file())
            self.assertFalse((directory / "assets/instance.json").exists())
            self.assertFalse((directory / "assets/.env").exists())
            self.assertFalse(list((directory / "assets").rglob("*.sqlite3")))
            with self.assertRaises(FileExistsError):
                retail_deploy.prepare(self.manifest(), directory)

    def test_factory_has_brand_and_empty_contacts_accounts_ledger(self):
        state = retail_deploy.fresh_workspace("Marca blanca <segura>")
        self.assertEqual(state["settings"]["crmName"], "Marca blanca <segura>")
        for name in ("clients", "accounts", "ledger", "rules", "taskReceipts", "combos"):
            self.assertEqual(state[name], [])
        self.assertFalse(state["automation"]["enabled"])
        self.assertTrue(state["templates"])
        # Validate the actual serialized state against the app's factory and validator.
        program = "import {cleanState} from './cloud/state.mjs'; cleanState(JSON.parse(process.argv[1]));"
        subprocess.run(["node", "--input-type=module", "-e", program, json.dumps(state)],
                       check=True, capture_output=True, cwd=retail_deploy.ROOT)

    def test_existing_resource_or_full_hostname_is_not_reused(self):
        manifest = self.manifest()
        host = f"{manifest['worker_name']}.isolated-test.workers.dev"
        for api in (
            API(databases=[{"name": manifest["database_name"]}]),
            API(apps=[{"domain": host, "aud": "other"}]),
            API(scripts=[{"id": manifest["worker_name"]}]),
        ):
            with self.assertRaises(RuntimeError):
                retail_deploy.preflight(api, manifest)
            self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_modified_manifest_cannot_target_original_production_database(self):
        manifest, api = self.manifest(), API()
        manifest["database_name"] = "nexo-crm"
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(RuntimeError):
                retail_deploy.deploy_instance(manifest, directory, api, "/fake/wrangler")
        self.assertEqual(api.calls, [])

    def test_publication_locked_then_own_audience_and_only_own_database(self):
        manifest, api, publications = self.manifest(), API(), []

        def publish(config, executable, hostname):
            publications.append(json.loads(json.dumps(config)))

        with tempfile.TemporaryDirectory() as directory, patch.object(retail_deploy, "ensure_access_team", return_value="test.cloudflareaccess.com"), patch.object(retail_deploy, "ensure_pin", return_value={"id": "pin-id"}), patch.object(retail_deploy, "publish", side_effect=publish):
            url = retail_deploy.deploy_instance(manifest, directory, api, "/fake/wrangler")
            self.assertTrue(url.startswith("https://crm-r-cliente-"))
            self.assertEqual([c["vars"]["ACCESS_AUD"] for c in publications], ["not-configured-closed", "exclusive-aud"])
            self.assertEqual(publications[1]["vars"]["OWNER_EMAIL"], "owner@example.com")
            self.assertEqual(publications[1]["d1_databases"][0]["database_id"], "isolated-db")
            self.assertNotIn("RESEND_API_KEY", publications[1]["vars"])
            self.assertNotIn("WHATSAPP_ACCESS_TOKEN", publications[1]["vars"])
            app = next(body for method, path, body in api.calls if method == "POST" and path == "/access/apps")
            self.assertNotIn("*", app["domain"])
            self.assertEqual(app["domain"], url.removeprefix("https://"))
            self.assertEqual(app["policies"][0]["include"], [{"email": {"email": "owner@example.com"}}])
            initial = next(json.loads(body["params"][0]) for method, path, body in api.calls if method == "POST" and body and "params" in body)
            self.assertEqual(initial["clients"], [])
            self.assertEqual(manifest["status"], "published_pending_verification")

    def test_reused_access_audience_keeps_worker_closed_and_checkpoint(self):
        manifest, api, publications = self.manifest(), API(apps=[{"domain": "other.workers.dev", "aud": "exclusive-aud"}]), []
        with tempfile.TemporaryDirectory() as directory, patch.object(retail_deploy, "ensure_access_team", return_value="test.cloudflareaccess.com"), patch.object(retail_deploy, "ensure_pin", return_value={"id": "pin-id"}), patch.object(retail_deploy, "publish", side_effect=lambda config, *args: publications.append(config["vars"]["ACCESS_AUD"])):
            with self.assertRaises(RuntimeError):
                retail_deploy.deploy_instance(manifest, directory, api, "/fake/wrangler")
            self.assertEqual(publications, ["not-configured-closed"])
            saved = json.loads((Path(directory) / "instance.json").read_text())
            self.assertEqual(saved["database_id"], "isolated-db")
            self.assertEqual(saved["access_app_id"], "exclusive-app")
            self.assertEqual(saved["status"], "access_pending_validation")

    def test_real_signed_token_from_other_instance_or_owner_is_rejected(self):
        # Cryptographic verification uses a local public key and a mocked certs
        # response. No Cloudflare requests or real user sessions are involved.
        program = r"""
            import assert from 'node:assert/strict';
            import {authenticate} from './cloud/auth.mjs';
            const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
            const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'retail-test-key',use:'sig'};
            const env={ACCESS_TEAM_DOMAIN:'retail-test.cloudflareaccess.com',ACCESS_AUD:'tenant-b-aud',OWNER_EMAIL:'tenant-b@example.com'};
            const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
            async function request(email,aud){
                const text=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://'+env.ACCESS_TEAM_DOMAIN,aud:[aud],email,exp:Date.now()/1000+3600});
                const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(text));
                return new Request('https://tenant-b.test/api/workspace',{headers:{'Cf-Access-Jwt-Assertion':text+'.'+Buffer.from(signature).toString('base64url')}});
            }
            const options={fetcher:async()=>Response.json({keys:[jwk]})};
            assert.equal((await authenticate(await request(env.OWNER_EMAIL,env.ACCESS_AUD),env,options)).email,env.OWNER_EMAIL);
            await assert.rejects(authenticate(await request(env.OWNER_EMAIL,'tenant-a-aud'),env,options));
            await assert.rejects(authenticate(await request('tenant-a@example.com',env.ACCESS_AUD),env,options));
            await assert.rejects(authenticate(await request(env.OWNER_EMAIL,env.ACCESS_AUD),{...env,ACCESS_AUD:''},options));
        """
        subprocess.run(["node", "--input-type=module", "-e", program], check=True,
                       capture_output=True, cwd=retail_deploy.ROOT)


if __name__ == "__main__":
    unittest.main()
