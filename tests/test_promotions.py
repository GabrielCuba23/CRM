import unittest
from backend.promotions import validate_promotions
from backend.storage import default_workspace
from backend.validation import validate_workspace
class PromotionsTest(unittest.TestCase):
    def test_private_roundtrip_and_forged_totals(self):
        state=default_workspace();state['promotions']={'offers':[{'id':'o','name':'Especial','kind':'percent','value':1500,'giftService':'','notes':''}],'applications':[{'id':'a','clientId':'c','offerId':'o','name':'Especial','kind':'percent','value':1500,'giftService':'','notes':'','service':'Max','occurredAt':'2026-10-08T14:00:00Z','ledgerId':'l','updateClientPrice':True,'base':10000,'discount':1500,'final':8500}]}
        self.assertEqual(validate_workspace(state)['promotions']['applications'][0]['final'],8500)
        state['promotions']['offers'][0]['value']=2000
        self.assertEqual(validate_promotions(state['promotions'])['applications'][0]['value'],1500)
        state['promotions']['applications'][0]['final']=1
        with self.assertRaises(ValueError):validate_workspace(state)
    def test_old_backup_and_invalid_gift(self):
        self.assertEqual(validate_workspace(default_workspace())['promotions'],{'offers':[],'applications':[]})
        with self.assertRaises(ValueError):validate_promotions({'offers':[{'id':'o','name':'Regalo','kind':'gift','value':0,'giftService':'','notes':''}],'applications':[]})
