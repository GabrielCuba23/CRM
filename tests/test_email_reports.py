import unittest, tempfile, os, datetime as dt, json, zipfile, io
from unittest.mock import patch
from backend.storage import initialize, connect, default_workspace
from backend.email_reports import due_reports, sheets, workbook, process_reports
from backend.validation import validate_workspace
class ReportsTest(unittest.TestCase):
    def test_pending_prices_persist_and_export_blank_without_hiding_known_zero(self):
        state = default_workspace()
        state['clients'] = []
        for index, pending in enumerate([True, False]):
            client = {'id':str(index),'name':'Synthetic','phone':'','email':'','service':'Netflix','profile':'','expires':'','notes':'','accountId':'','pin':'','price':0,
                      'serviceHistory':[{'id':'history','service':'Netflix','accountId':'','profile':'','expires':'','price':0,'endedAt':'2026-10-07T14:00:00Z'}]}
            if pending:
                client['pricePending'] = True
                client['serviceHistory'][0]['pricePending'] = True
            state['clients'].append(client)
        clean = validate_workspace(state)
        self.assertIs(clean['clients'][0]['pricePending'], True)
        self.assertIs(clean['clients'][0]['serviceHistory'][0]['pricePending'], True)
        self.assertNotIn('pricePending', clean['clients'][1])
        tables = sheets(clean, 'clients', '2026-10-15')
        self.assertEqual(tables[0][1][1][8], '')
        self.assertEqual(tables[0][1][2][8], 0)
        self.assertEqual(tables[1][1][1][4], '')
        self.assertEqual(tables[1][1][2][4], 0)
        for location in [state['clients'][0], state['clients'][0]['serviceHistory'][0]]:
            for bad in ['true', 1]:
                location['pricePending'] = bad
                with self.assertRaises(ValueError):
                    validate_workspace(state)
            location['pricePending'] = True
            location['price'] = 1
            with self.assertRaises(ValueError):
                validate_workspace(state)
            location['price'] = 0

    def test_schedule_and_literal_excel(self):
        settings={'clientsWeekly':True,'financeTwiceMonthly':True,'hour':9}
        self.assertEqual(len(due_reports(settings,dt.datetime.fromisoformat('2026-05-15T14:00:00+00:00'))),2)
        self.assertEqual(due_reports(settings,dt.datetime.fromisoformat('2026-05-15T13:59:00+00:00')),[])
        self.assertEqual(due_reports(settings,dt.datetime.fromisoformat('2028-02-29T14:00:00+00:00')),[('finance','2028-02-29')])
        state=default_workspace();state['ledger']=[{'date':'2026-10-10','kind':'sale','amount':1500,'description':'=BAD','service':'Max'},{'date':'2026-10-20','kind':'sale','amount':5000,'description':'Future','service':'Max'}]
        tables=sheets(state,'finance','2026-10-15');self.assertEqual(tables[0][1][3][1],15)
        with zipfile.ZipFile(io.BytesIO(workbook(tables))) as z:
            xml=z.read('xl/worksheets/sheet2.xml');self.assertIn(b'=BAD',xml);self.assertNotIn(b'<f>',xml);self.assertNotIn(b'Future',xml)
    def test_owner_recipient_dedup_and_uncertain_not_retried(self):
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'RESEND_API_KEY':'fixture','REPORT_FROM_EMAIL':'reports@example.com'}):
            path=d+'/db';initialize(path);state=default_workspace();state['reports']={'clientsWeekly':True,'financeTwiceMonthly':True,'hour':9}
            with connect(path) as db:
                db.execute("INSERT INTO owner VALUES(1,'owner@example.com','fixture')")
                db.execute('INSERT INTO workspace VALUES(1,0,?)',(json.dumps(state),))
            sent=[]
            def sender(payload,key):sent.append(payload);return 'fixture-id'
            now=dt.datetime.fromisoformat('2026-05-15T14:00:00+00:00')
            self.assertEqual(process_reports(path,now,sender),2);self.assertEqual(process_reports(path,now,sender),0);self.assertEqual(sent[0]['to'],['owner@example.com'])
            def uncertain(*args):raise TimeoutError()
            next_day=dt.datetime.fromisoformat('2026-05-22T14:00:00+00:00')
            process_reports(path,next_day,uncertain);self.assertEqual(process_reports(path,next_day,sender),0)
