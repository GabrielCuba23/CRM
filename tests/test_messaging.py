import unittest
from backend.storage import default_workspace
from backend.validation import validate_workspace
class MessagingTest(unittest.TestCase):
    def test_private_manual_chat_roundtrip_and_social_restrictions(self):
        state=default_workspace()
        state['growth']={'segments':[],'campaigns':[],'posts':[],'interactions':[{'id':'m','name':'Mensaje recibido registrado manualmente','clientId':'c','network':'WhatsApp','kind':'received_manual','body':'Hola','agent':'Propietario','outcome':'open','occurredAt':'2026-10-08T14:00:00Z'}],'scoring':{'email':10,'phone':10,'active':20,'paid':30}}
        self.assertEqual(validate_workspace(state)['growth']['interactions'][0]['kind'],'received_manual')
        state['growth']['interactions'][0]['network']='Facebook'
        with self.assertRaises(ValueError):validate_workspace(state)
        state['growth']['interactions']=[]
        state['growth']['posts']=[{'id':'p','name':'Post','network':'WhatsApp','body':'Hola','scheduledAt':'','status':'draft'}]
        with self.assertRaises(ValueError):validate_workspace(state)
