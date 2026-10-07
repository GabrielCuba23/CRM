import unittest
from backend.storage import default_workspace
from backend.validation import validate_workspace
class ProcurementTest(unittest.TestCase):
    def test_roundtrip_and_invalid_reference(self):
        state=default_workspace()
        state['procurement']={'suppliers':[{'id':'s','name':'Proveedor','email':'','phone':'','notes':''}],'offers':[{'id':'o','name':'Netflix','supplierId':'s','type':'product','costCents':4000,'intervalMonths':1,'capacity':5,'notes':''}]}
        state['accounts']=[{'id':'a','service':'Netflix','email':'a@example.com','provider':'Proveedor','expires':'2099-01-01','capacity':5,'supplierId':'s','offerId':'o','costCents':4000,'costIntervalMonths':1}]
        state['ledger']=[{'id':'m','description':'Compra','service':'Netflix','date':'2026-10-07','kind':'expense','amount':4000,'supplierId':'s','offerId':'o','accountId':'a','category':'purchase','reference':'001'}]
        clean=validate_workspace(state)
        self.assertEqual(clean['procurement'],state['procurement'])
        self.assertEqual(clean['accounts'][0]['costCents'],4000)
        self.assertEqual(clean['ledger'][0]['supplierId'],'s')
        state['accounts'][0]['offerId']='missing'
        with self.assertRaises(ValueError):validate_workspace(state)
