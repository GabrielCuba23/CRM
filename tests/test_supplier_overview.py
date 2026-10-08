import unittest
from backend.validation import validate_workspace
from backend.storage import default_workspace
class SupplierRenewalTest(unittest.TestCase):
    def test_date_roundtrip_and_rejection(self):
        s=default_workspace();s['procurement']={'suppliers':[{'id':'p','name':'Proveedor','phone':'','email':'','notes':''}],'offers':[{'id':'o','supplierId':'p','name':'Hosting','type':'business','costCents':12000,'intervalMonths':12,'capacity':1,'notes':'','nextRenewal':'2026-10-11'}]}
        self.assertEqual(validate_workspace(s)['procurement']['offers'][0]['nextRenewal'],'2026-10-11')
        s['procurement']['offers'][0]['nextRenewal']='2026-02-30'
        with self.assertRaises(ValueError):validate_workspace(s)
