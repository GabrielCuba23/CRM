import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'cloud'))
import deploy

class ProvisionTests(unittest.TestCase):
    def test_access_policy_is_exclusive_owner(self):
        calls=[]
        class API:
            def call(self,method,path,data=None):
                calls.append((method,path,data))
                return [] if method=='GET' else {'aud':'test-aud'}
        result=deploy.ensure_application(API(),'nexo-crm.test.workers.dev','owner@example.com','pin-id')
        self.assertEqual(result['aud'],'test-aud')
        body=calls[-1][2]
        self.assertEqual(body['policies'][0]['include'],[{'email':{'email':'owner@example.com'}}])
        self.assertEqual(body['allowed_idps'],['pin-id'])
        self.assertTrue(body['http_only_cookie_attribute'])

    def test_no_account_activation_or_paid_plan(self):
        class API:
            def call(self,method,path,**kwargs):
                self.assert_read=method=='GET'
                return None
        api=API()
        with self.assertRaises(RuntimeError):deploy.ensure_access_team(api)
        self.assertTrue(api.assert_read)

    def test_existing_database_is_reused_and_schema_is_nondestructive(self):
        calls=[]
        class API:
            def call(self,method,path,data=None):
                calls.append((method,path,data))
                return [{'name':'nexo-crm','uuid':'test-db'}] if method=='GET' else []
        self.assertEqual(deploy.ensure_database(API()),'test-db')
        self.assertEqual(len(calls),2)
        self.assertNotIn('DROP',calls[1][2]['sql'].upper())

    def test_two_stage_publication_starts_locked(self):
        configs=[]
        class API:pass
        def publish(config,executable):
            configs.append(config['vars']['ACCESS_AUD'])
            return 'https://nexo-crm.test.workers.dev'
        with patch.dict('os.environ',{'CLOUDFLARE_API_TOKEN':'test-only','CLOUDFLARE_ACCOUNT_ID':'0'*32,'CRM_OWNER_EMAIL':'owner@example.com'}),patch.object(sys,'argv',['deploy.py']),patch.object(deploy,'Cloudflare',return_value=API()),patch.object(deploy,'ensure_access_team',return_value='test.cloudflareaccess.com'),patch.object(deploy,'ensure_pin',return_value={'id':'pin'}),patch.object(deploy,'ensure_database',return_value='test-db'),patch.object(deploy,'build',return_value=Path('/tmp/test-assets')),patch.object(deploy,'ensure_application',return_value={'aud':'real-aud'}),patch.object(deploy,'publish',side_effect=publish),patch.object(Path,'write_text'),patch.object(Path,'chmod'),patch('builtins.print'):
            deploy.main()
        self.assertEqual(configs,['not-configured-closed','real-aud'])

if __name__=='__main__':unittest.main()
