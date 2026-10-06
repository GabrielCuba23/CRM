import concurrent.futures
import datetime as dt
import json
import secrets
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import create_app
from backend.storage import connect, default_workspace
from backend.worker import process_due, SendFailure, LIMA
from backend.validation import validate_workspace


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = str(Path(self.directory.name)/'crm.sqlite3')
        self.password = secrets.token_urlsafe(24)
        self.app = create_app({'TESTING': True, 'DB_PATH': self.db, 'PUBLIC_URL':'http://localhost', 'ALLOW_HTTP':True, 'OWNER_EMAIL':'owner@example.com', 'OWNER_PASSWORD':self.password})
        self.client = self.app.test_client()
        self.headers = {'Origin':'http://localhost'}

    def tearDown(self):
        self.directory.cleanup()

    def login(self, client=None):
        client = client or self.client
        response = client.post('/api/login', json={'email':'owner@example.com','password':self.password}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        return {**self.headers, 'X-CSRF-Token':response.json['csrf']}

    def save(self, state, revision=0):
        headers = self.login()
        return self.client.put('/api/workspace', json={'state':state,'revision':revision}, headers=headers)

    def reminder_state(self):
        state = default_workspace()
        state['clients']=[{'id':'client','name':'Ana','email':'ana@example.com','phone':'987654321','service':'Max','profile':'Perfil 1','expires':'2026-10-09','notes':'','accountId':'','pin':'','price':2000,'reminderConsent':True}]
        state['automation'].update(enabled=True,templateName='renewal_approved')
        self.assertEqual(self.save(state).status_code, 200)
        return state

    def test_private_routes_and_no_exposed_database(self):
        for url in ['/','/index.html','/app.js','/crm.mjs']:
            self.assertEqual(self.client.get(url).status_code, 302)
        for url in ['/api/workspace','/api/session','/api/automation-status']:
            self.assertEqual(self.client.get(url).status_code, 401)
        self.login()
        for url in ['/backend/app.py','/.env','/crm.sqlite3','/../backend/app.py']:
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertIn(b'crm-backend', self.client.get('/').data)

    def test_login_hash_cookie_and_origin_csrf(self):
        response = self.client.post('/api/login', json={'email':'owner@example.com','password':self.password}, headers=self.headers)
        self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        self.assertIn('SameSite=Strict',response.headers['Set-Cookie'])
        with connect(self.db) as db:
            self.assertNotIn(self.password,db.execute('SELECT password_hash FROM owner').fetchone()[0])
        payload={'state':default_workspace(),'revision':0}
        self.assertEqual(self.client.put('/api/workspace',json=payload,headers=self.headers).status_code,403)
        headers={**self.headers,'X-CSRF-Token':response.json['csrf']}
        self.assertEqual(self.client.put('/api/workspace',json=payload,headers={**headers,'Origin':'https://attacker.example'}).status_code,403)
        self.assertEqual(self.client.put('/api/workspace',json=payload,headers=headers).status_code,200)
        self.assertEqual(self.client.post('/api/logout',json={},headers=headers).status_code,200)
        self.assertEqual(self.client.get('/api/workspace').status_code,401)

    def test_stale_revision_and_persistence(self):
        self.assertEqual(self.save(default_workspace()).status_code,200)
        self.assertEqual(self.save(default_workspace(),revision=0).status_code,409)
        self.assertEqual(self.client.get('/api/workspace').json['revision'],1)
        other=create_app({'TESTING':True,'DB_PATH':self.db,'PUBLIC_URL':'http://localhost','ALLOW_HTTP':True})
        client=other.test_client();self.login(client)
        self.assertEqual(client.get('/api/workspace').json['state']['version'],2)

    def test_password_change_revokes_all_sessions(self):
        headers=self.login();second=self.app.test_client();self.login(second)
        next_password=secrets.token_urlsafe(24)
        self.assertEqual(self.client.post('/api/password',json={'current':self.password,'next':next_password},headers=headers).status_code,200)
        self.assertEqual(second.get('/api/workspace').status_code,401)
        self.assertEqual(self.client.get('/api/workspace').status_code,401)
        self.password=next_password;self.login()

    def test_expired_session_and_login_rate_limit(self):
        self.login()
        with connect(self.db) as db:
            db.execute('UPDATE sessions SET expires=0')
        self.assertEqual(self.client.get('/api/workspace').status_code,401)
        for _ in range(8):
            self.client.post('/api/login',json={'email':'wrong@example.com','password':'wrong'},headers=self.headers)
        self.assertEqual(self.client.post('/api/login',json={'email':'owner@example.com','password':self.password},headers=self.headers).status_code,429)

    def test_unconfigured_owner_cannot_register(self):
        path=str(Path(self.directory.name)/'empty.sqlite3')
        app=create_app({'TESTING':True,'DB_PATH':path,'PUBLIC_URL':'http://localhost','ALLOW_HTTP':True,'OWNER_EMAIL':'','OWNER_PASSWORD':''})
        client=app.test_client()
        self.assertEqual(client.post('/api/login',json={'email':'a@example.com','password':'test'},headers=self.headers).status_code,503)
        self.assertEqual(client.post('/api/register',json={},headers=self.headers).status_code,401)

    def test_validation_contexts_and_unknown_secrets(self):
        state=default_workspace();state['templates']=[{'id':str(i),'name':f'Mensaje {i}','context':'Mi contexto','body':'Texto libre {nombre}'} for i in range(30)]
        state['token']='must-not-be-persisted'
        validated=validate_workspace(state)
        self.assertEqual(len(validated['templates']),30)
        self.assertNotIn('token',validated)
        state['automation']['parameters']=['contrasena']
        with self.assertRaises(ValueError):validate_workspace(state)
        state['automation']['parameters']=[{}]
        with self.assertRaises(ValueError):validate_workspace(state)

    def test_exactly_three_days_lima_hour_and_deduplication(self):
        self.reminder_state();sent=[]
        sender=lambda payload:sent.append(payload) or 'provider-id'
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,8,59,tzinfo=LIMA),sender),0)
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,5,10,tzinfo=LIMA),sender),0)
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA),sender),1)
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,11,tzinfo=LIMA),sender),0)
        self.assertEqual(len(sent),1)
        self.assertEqual(sent[0]['to'],'51987654321')
        self.assertEqual(sent[0]['template']['components'][0]['parameters'][2]['text'],'09/10/2026')
        with connect(self.db) as db:
            self.assertEqual(db.execute('SELECT state FROM reminders').fetchone()[0],'accepted')

    def test_concurrent_workers_claim_once(self):
        self.reminder_state();sent=[]
        def run():return process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA),lambda payload:sent.append(payload) or 'id')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            result=list(pool.map(lambda _:run(), range(2)))
        self.assertEqual(sum(result),1);self.assertEqual(len(sent),1)

    def test_optout_and_disabled_reminders(self):
        state=self.reminder_state();state['clients'][0]['reminderConsent']=False
        self.assertEqual(self.save(state,revision=1).status_code,200)
        sent=[];sender=lambda p:sent.append(p) or 'id'
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA),sender),0)
        state['clients'][0]['reminderConsent']=True;state['automation']['enabled']=False
        self.assertEqual(self.save(state,revision=2).status_code,200)
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA),sender),0)
        self.assertFalse(sent)

    def test_missing_credentials_do_not_mark_as_sent(self):
        self.reminder_state()
        with patch.dict('os.environ',{'WHATSAPP_ACCESS_TOKEN':'','WHATSAPP_PHONE_NUMBER_ID':''}):
            self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA)),0)
        with connect(self.db) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM reminders').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT status FROM worker_health').fetchone()[0],'missing_configuration')

    def test_timeout_not_retried_and_rate_limit_retries(self):
        self.reminder_state()
        def uncertain(_):raise SendFailure('unknown')
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA),uncertain),0)
        with connect(self.db) as db:
            self.assertEqual(db.execute('SELECT state FROM reminders').fetchone()[0],'uncertain')
        sent=[]
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,11,tzinfo=LIMA),lambda p:sent.append(p) or 'id'),0)
        self.assertFalse(sent)
        with connect(self.db) as db:db.execute('DELETE FROM reminders')
        def limited(_):raise SendFailure('HTTP_429',retry_safe=True)
        process_due(self.db,dt.datetime(2026,10,6,10,tzinfo=LIMA),limited)
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,5,tzinfo=LIMA),lambda p:'id'),0)
        self.assertEqual(process_due(self.db,dt.datetime(2026,10,6,10,16,tzinfo=LIMA),lambda p:'id'),1)


if __name__ == '__main__':unittest.main()
