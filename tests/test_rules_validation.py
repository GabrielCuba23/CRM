import copy
import unittest
from backend.storage import default_workspace
from backend.validation import validate_workspace

class RulesValidationTest(unittest.TestCase):
    def fixture(self):
        state=default_workspace()
        state['rules']=[{'id':'rule','name':'Mensaje libre','enabled':True,'templateId':'renew','daysBefore':3,'hour':9,'delivery':'manual','services':[], 'meta':{'templateName':'','language':'es','parameters':['nombre']}}]
        return state
    def test_rules_preserved_without_unknown_secrets(self):
        state=self.fixture();state['rules'][0]['token']='not-stored';state['rules'][0]['meta']['secret']='not-stored'
        clean=validate_workspace(state)
        self.assertEqual(clean['rules'][0]['name'],'Mensaje libre')
        self.assertNotIn('token',clean['rules'][0]);self.assertNotIn('secret',clean['rules'][0]['meta'])
    def test_old_workspace_and_thirty_five_rules(self):
        self.assertEqual(validate_workspace(default_workspace())['rules'],[])
        state=self.fixture();state['rules']=[dict(copy.deepcopy(state['rules'][0]),id=f'r{i}') for i in range(35)]
        self.assertEqual(len(validate_workspace(state)['rules']),35)
    def test_invalid_rules_and_password_schedules_fail(self):
        for key,value in [('hour',24),('daysBefore',1.5),('delivery','unknown'),('templateId','missing')]:
            state=self.fixture();state['rules'][0][key]=value
            with self.assertRaises(ValueError):validate_workspace(state)
        state=self.fixture();state['templates'][1]['body']='{contrasena}'
        with self.assertRaises(ValueError):validate_workspace(state)
    def test_confirmation_schema(self):
        state=self.fixture();state['taskReceipts']=[{'id':'task','signature':'a'*64,'completedAt':'2026-10-06T14:00:00.000Z','secret':'not-stored'}]
        self.assertNotIn('secret',validate_workspace(state)['taskReceipts'][0])
        state['taskReceipts'][0]['completedAt']='invalid'
        with self.assertRaises(ValueError):validate_workspace(state)
