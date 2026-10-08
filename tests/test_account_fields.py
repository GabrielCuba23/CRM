import unittest
from backend.storage import default_workspace
from backend.validation import validate_workspace
class AccountFieldsTest(unittest.TestCase):
    def test_password_username_and_sale_link_are_preserved(self):
        state=default_workspace();state['accounts']=[{'id':'a','email':'test@example.com','service':'Max','provider':'','expires':'2099-01-01','capacity':1,'password':'fixture-only'}]
        state['clients']=[{'id':'c','name':'Amigo','email':'','phone':'','whatsappUsername':'@amigo','service':'Max','profile':'','expires':'','notes':'','accountId':'','pin':'','price':0}]
        state['ledger']=[{'id':'l','kind':'sale','description':'Venta','date':'2026-10-07','service':'Max','amount':1000,'clientId':'c'}]
        clean=validate_workspace(state);self.assertEqual(clean['accounts'][0]['password'],'fixture-only');self.assertEqual(clean['clients'][0]['whatsappUsername'],'@amigo');self.assertEqual(clean['ledger'][0]['clientId'],'c')
        state['accounts'][0]['password']='a'*513
        with self.assertRaises(ValueError):validate_workspace(state)

    def test_growth_and_branding_roundtrip(self):
        state=default_workspace()
        state['settings']['crmName']='Mi marca'
        state['settings']['logoDataUrl']='data:image/png;base64,YQ=='
        state['growth']={'segments': [], 'campaigns': [], 'posts': [], 'interactions': [], 'scoring': {'email':10,'phone':10,'active':20,'paid':30}}
        state['growth']['posts']=[{'id':'p','name':'Borrador','network':'Instagram','body':'Oferta','scheduledAt':'2026-10-10T14:00:00Z','status':'draft'}]
        clean=validate_workspace(state)
        self.assertEqual(clean['settings']['crmName'],'Mi marca')
        self.assertEqual(clean['growth'],state['growth'])
        state['growth']['posts'][0]['status']='published'
        with self.assertRaises(ValueError):validate_workspace(state)

    def test_archived_history_survives_private_validation(self):
        state=default_workspace()
        state['clients']=[{'id':'old','name':'Ana','email':'','phone':'','service':'Netflix','profile':'','expires':'2020-01-01','notes':'','accountId':'','pin':'','price':1200,'archived':True,'marketingConsent':True,'serviceHistory':[{'id':'h','service':'Netflix','accountId':'old-account','profile':'Perfil 1','expires':'2020-01-01','price':1200,'endedAt':'2026-10-07T14:00:00Z'}]}]
        clean=validate_workspace(state)
        self.assertTrue(clean['clients'][0]['archived'])
        self.assertEqual(clean['clients'][0]['serviceHistory'][0]['price'],1200)
        state['clients'][0]['archived']='yes'
        with self.assertRaises(ValueError):validate_workspace(state)
