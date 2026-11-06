import tempfile
import unittest
import base64
import hashlib
import sqlite3
import time
from pathlib import Path
from backend.app import create_app
from backend.engagement import EngagementError, advance_flow, clean_flows


class EngagementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING': True, 'DB_PATH': str(Path(self.temp.name) / 'crm.sqlite3'), 'PUBLIC_URL': 'http://localhost', 'ALLOW_HTTP': True, 'OWNER_EMAIL': 'owner@example.test', 'OWNER_PASSWORD': 'Synthetic rules password 1!'})
        self.client = self.app.test_client()
        login = self.client.post('/api/login', json={'email': 'owner@example.test', 'password': 'Synthetic rules password 1!'}, headers={'Origin': 'http://localhost'})
        self.headers = {'Origin': 'http://localhost', 'X-CSRF-Token': login.json['csrf']}

    def tearDown(self):
        self.temp.cleanup()

    def configured(self):
        config = self.client.get('/api/engagement').json
        config['lines'] = [dict(id='line' + str(i), name='Línea ' + str(i), phone='5191234567' + str(i), enabled=True, allowBackground=True) for i in range(5)]
        config['bot'].update(enabled=True, rules=[dict(id='hi', name='Saludo', enabled=True, match='contains', keywords=['hola'], text='Hola {nombre}', media=[])])
        response = self.client.put('/api/engagement', json=config, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def lease(self, index=0):
        body = dict(lineId='line' + str(index), installationId=str(index + 1) * 32)
        response = self.client.post('/api/engagement/lease', json=body, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.json)
        body['leaseToken'] = response.json['leaseToken']
        return body

    def flow_configured(self, cooldown=86400):
        config = self.configured()
        flow = dict(id='sales', name='Menú de ventas', enabled=True, entryNodeId='menu', triggerKeywords=['comprar'], nodes=[
            dict(id='menu', type='menu', text='¿Qué necesitas?', options=[dict(key=str(i), label='Opción ' + str(i), nextNodeId='question' if i == 8 else 'other') for i in range(1, 9)]),
            dict(id='question', type='question', text='¿Cuál es tu nombre?', variable='nombre_cliente', validation='text', nextNodeId='done'),
            dict(id='done', type='end', text='Solicitud de {nombre_cliente} recibida.'),
            dict(id='other', type='end', text='Gracias por escribirnos.')])
        config['bot'].update(flows=[flow], defaultFlowId='sales', rules=[], cooldownSeconds=cooldown)
        result = self.client.put('/api/engagement', json=config, headers=self.headers)
        self.assertEqual(result.status_code, 200, result.json)
        return result.json

    def claim(self, fields, incoming, text='Hola', chat='wa:synthetic-peer-a'):
        response = self.client.post('/api/engagement/bot/claim', json=dict(fields, chatId=chat, incomingId=incoming, incomingText=text), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def finish(self, grant, status='sent_observed'):
        response = self.client.post('/api/engagement/bot/result', json=dict(claimId=grant['claimId'], claimToken=grant['claimToken'], status=status, evidence='Synthetic fixture'), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def conversation(self, chat='wa:synthetic-peer-a'):
        response = self.client.get('/api/engagement/conversations', query_string=dict(lineId='line0', chatId=chat))
        self.assertEqual(response.status_code, 200, response.json)
        return response.json['items'][0]

    def test_private_disabled_defaults_and_csrf(self):
        self.assertEqual(self.app.test_client().get('/api/engagement').status_code, 401)
        config = self.client.get('/api/engagement').json
        self.assertFalse(config['bot']['enabled'])
        self.assertEqual(self.client.put('/api/engagement', json=config).status_code, 403)

    def test_maximum_five_and_revision_conflict_preserve_configuration(self):
        config = self.configured()
        config['lines'].append(dict(config['lines'][0], id='six'))
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 400)
        config['lines'].pop()
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 409)

    def test_five_profiles_are_independent_and_competing_lease_is_rejected(self):
        self.configured()
        leases = [self.lease(i) for i in range(5)]
        duplicate = dict(lineId='line0', installationId='e' * 32)
        self.assertEqual(self.client.post('/api/engagement/lease', json=duplicate, headers=self.headers).status_code, 409)
        config = self.client.get('/api/engagement').json
        self.assertEqual(sum(line['online'] for line in config['lines']), 5)
        self.assertNotIn(leases[0]['leaseToken'], str(config))

    def test_claim_deduplication_and_stop_all_prevent_duplicate_or_revoked_send(self):
        self.configured()
        fields = self.lease()
        body = dict(fields, phone='51998765432', incomingId='false_fixture@lid_new', incomingText='hola', ruleId='hi')
        response = self.client.post('/api/engagement/bot/claim', json=body, headers=self.headers)
        self.assertTrue(response.json['claimed'], response.json)
        grant = response.json
        self.assertFalse(self.client.post('/api/engagement/bot/claim', json=body, headers=self.headers).json['claimed'])
        permit = dict(fields, claimId=grant['claimId'], claimToken=grant['claimToken'])
        self.assertTrue(self.client.post('/api/engagement/bot/permit', json=permit, headers=self.headers).json['allowed'])
        self.client.post('/api/engagement/stop', json={}, headers=self.headers)
        self.assertFalse(self.client.post('/api/engagement/bot/permit', json=permit, headers=self.headers).json['allowed'])
        result = dict(claimId=grant['claimId'], claimToken=grant['claimToken'], status='uncertain', error='Interrupción sintética')
        self.assertEqual(self.client.post('/api/engagement/bot/result', json=result, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/engagement/history').json['items'][0]['status'], 'uncertain')

    def test_menu_eight_question_capture_only_advances_on_confirmed_send(self):
        self.flow_configured()
        fields = self.lease()
        menu = self.claim(fields, 'flow-start')
        self.assertTrue(menu['claimed'])
        self.assertIn('8. Opción 8', menu['rule']['text'])
        pending = self.conversation()
        self.assertIsNone(pending['state'])
        self.assertTrue(pending['pending'])
        self.assertEqual(self.claim(fields, 'parallel-while-pending', '8')['reason'], 'conversation_busy')
        self.finish(menu)
        self.assertEqual(self.conversation()['state']['nodeId'], 'menu')
        question = self.claim(fields, 'flow-eight', '8')
        self.assertEqual(question['rule']['text'], '¿Cuál es tu nombre?')
        self.assertEqual(self.conversation()['state']['nodeId'], 'menu')
        self.finish(question)
        result = self.claim(fields, 'flow-name', 'Antonella')
        self.assertEqual(result['rule']['text'], 'Solicitud de Antonella recibida.')
        self.finish(result)
        state = self.conversation()['state']
        self.assertEqual(state['variables'], {'nombre_cliente': 'Antonella'})
        self.assertTrue(state['ended'])
        self.assertFalse(self.claim(fields, 'flow-name', 'Antonella')['claimed'])

    def test_phone_less_peers_are_isolated_and_permit_requires_exact_chat(self):
        self.flow_configured()
        fields = self.lease()
        first = self.claim(fields, 'peer-a-menu')
        second = self.claim(fields, 'peer-b-menu', chat='wa:synthetic-peer-b')
        self.assertTrue(first['claimed'] and second['claimed'])
        self.assertNotEqual(first['contactKey'], second['contactKey'])
        self.assertEqual(self.conversation()['phone'], '')
        permit = dict(fields, claimId=first['claimId'], claimToken=first['claimToken'])
        self.assertFalse(self.client.post('/api/engagement/bot/permit', json=permit, headers=self.headers).json['allowed'])
        self.assertFalse(self.client.post('/api/engagement/bot/permit', json=dict(permit, chatId='wa:synthetic-peer-b'), headers=self.headers).json['allowed'])
        self.assertTrue(self.client.post('/api/engagement/bot/permit', json=dict(permit, chatId='wa:synthetic-peer-a'), headers=self.headers).json['allowed'])
        self.finish(first)
        self.finish(second)
        choice = self.claim(fields, 'peer-a-eight', '8')
        self.finish(choice)
        self.assertEqual(self.conversation()['state']['nodeId'], 'question')
        self.assertEqual(self.conversation('wa:synthetic-peer-b')['state']['nodeId'], 'menu')
        bad = dict(fields, incomingId='no-peer', incomingText='Hola', name='Aldo')
        self.assertEqual(self.client.post('/api/engagement/bot/claim', json=bad, headers=self.headers).status_code, 400)
        bad['chatId'] = 'Nombre del contacto'
        self.assertEqual(self.client.post('/api/engagement/bot/claim', json=bad, headers=self.headers).status_code, 400)

    def test_failed_send_does_not_advance_and_duplicate_input_never_retries(self):
        self.flow_configured()
        fields = self.lease()
        menu = self.claim(fields, 'failed-start')
        self.finish(menu)
        question = self.claim(fields, 'failed-eight', '8')
        self.finish(question, 'failed')
        self.assertEqual(self.conversation()['state']['nodeId'], 'menu')
        self.assertFalse(self.conversation()['pending'])
        self.assertFalse(self.conversation()['blocked'])
        self.assertEqual(self.claim(fields, 'failed-eight', '8')['reason'], 'duplicate')
        another = self.claim(fields, 'new-eight', '8')
        self.assertTrue(another['claimed'])
        self.assertEqual(another['rule']['text'], '¿Cuál es tu nombre?')

    def test_uncertain_send_blocks_until_explicit_reset_and_reset_revokes_pending(self):
        self.flow_configured(cooldown=0)
        fields = self.lease()
        menu = self.claim(fields, 'uncertain-start')
        self.finish(menu)
        question = self.claim(fields, 'uncertain-eight', '8')
        self.finish(question, 'uncertain')
        state = self.conversation()
        self.assertTrue(state['blocked'])
        self.assertEqual(state['state']['nodeId'], 'menu')
        self.assertEqual(self.claim(fields, 'after-uncertain', '8')['reason'], 'conversation_blocked')
        response = self.client.post('/api/engagement/conversations/reset', json=dict(lineId='line0', chatId='wa:synthetic-peer-a'), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(self.conversation()['blocked'])
        self.assertIsNone(self.conversation()['state'])
        fresh = self.claim(fields, 'after-reset', 'Hola')
        self.assertTrue(fresh['claimed'])
        self.client.post('/api/engagement/conversations/reset', json=dict(lineId='line0', contactKey=fresh['contactKey']), headers=self.headers)
        permit = dict(fields, chatId='wa:synthetic-peer-a', claimId=fresh['claimId'], claimToken=fresh['claimToken'])
        self.assertFalse(self.client.post('/api/engagement/bot/permit', json=permit, headers=self.headers).json['allowed'])
        self.assertEqual(self.claim(fields, 'after-reset', 'Hola')['reason'], 'duplicate')

    def test_stale_pending_is_blocked_by_status_lookup_and_stays_blocked_after_expiry(self):
        self.flow_configured(cooldown=0)
        fields = self.lease()
        grant = self.claim(fields, 'stale-start')
        with sqlite3.connect(self.app.config['DB_PATH']) as db:
            db.execute('UPDATE engagement_bot_attempts SET created=? WHERE id=?', (int(time.time()) - 91, grant['claimId']))
            db.execute('UPDATE engagement_conversations SET expires=?', (int(time.time()) - 1,))
        self.assertTrue(self.conversation()['blocked'])
        self.assertEqual(self.client.get('/api/engagement/history').json['items'][0]['status'], 'uncertain')
        self.assertEqual(self.claim(fields, 'stale-new', 'Hola')['reason'], 'conversation_blocked')

    def test_legacy_rule_hint_does_not_suppress_triggered_or_default_flow(self):
        config = self.flow_configured(cooldown=0)
        config['bot']['rules'] = [dict(id='old', name='Anterior', enabled=True, match='fallback', keywords=[], text='Respuesta antigua', media=[])]
        response = self.client.put('/api/engagement', json=config, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        fields = self.lease()
        for index, message in enumerate(['Hola', 'Quiero comprar']):
            result = self.client.post('/api/engagement/bot/claim', json=dict(fields, chatId='wa:hint-' + str(index), incomingId='hint-' + str(index), incomingText=message, ruleId='old'), headers=self.headers)
            self.assertEqual(result.status_code, 200, result.json)
            self.assertTrue(result.json['claimed'])
            self.assertEqual(result.json['flowId'], 'sales')
            self.assertIn('8. Opción 8', result.json['reply']['text'])

    def test_flow_validation_and_optional_configuration_round_trip(self):
        legacy = self.configured()
        self.assertNotIn('flows', legacy['bot'])
        configured = self.flow_configured()
        self.assertEqual(configured['bot']['defaultFlowId'], 'sales')
        configured['bot']['conversationTtlMinutes'] = 1
        configured['bot']['rules'] = [dict(id='linked', name='Inicio', enabled=True, match='exact', keywords=['comprar'], text='', media=[], flowId='sales')]
        response = self.client.put('/api/engagement', json=configured, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['bot']['rules'][0]['flowId'], 'sales')
        configured = response.json
        configured['bot']['flows'][0]['nodes'][1]['nextNodeId'] = 'missing'
        self.assertEqual(self.client.put('/api/engagement', json=configured, headers=self.headers).status_code, 400)
        cycle = [dict(id='loop', name='Ciclo', enabled=True, entryNodeId='a', nodes=[dict(id='a', type='message', text='Uno', nextNodeId='b'), dict(id='b', type='message', text='Dos', nextNodeId='a')])]
        with self.assertRaises(EngagementError):
            clean_flows(cycle)

    def test_pure_flow_invalid_restart_cancel_and_typed_answers(self):
        configured = self.flow_configured()
        flow = configured['bot']['flows'][0]
        entry = advance_flow(flow, None, 'Hola')
        invalid = advance_flow(flow, entry['nextState'], '99')
        self.assertFalse(invalid['accepted'])
        self.assertEqual(invalid['nextState'], entry['nextState'])
        question = advance_flow(flow, entry['nextState'], '8. Opción 8')
        restart = advance_flow(flow, question['nextState'], 'menú')
        self.assertEqual(restart['nextState']['nodeId'], 'menu')
        self.assertEqual(restart['nextState']['variables'], {})
        self.assertTrue(advance_flow(flow, question['nextState'], 'cancelar')['ended'])
        flow['nodes'][1]['validation'] = 'phone'
        result = advance_flow(flow, question['nextState'], '912 345 678')
        self.assertEqual(result['nextState']['variables']['nombre_cliente'], '51912345678')
        flow['nodes'][1]['validation'] = 'number'
        result = advance_flow(flow, question['nextState'], '12,50')
        self.assertEqual(result['nextState']['variables']['nombre_cliente'], '12.50')

    def test_legacy_attempts_table_is_migrated_without_losing_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'legacy.sqlite3')
            with sqlite3.connect(path) as db:
                db.execute("CREATE TABLE engagement_bot_attempts(id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,line_id TEXT NOT NULL,phone TEXT NOT NULL,incoming_id TEXT NOT NULL,rule_id TEXT NOT NULL,rule_name TEXT NOT NULL,rule_body TEXT NOT NULL,config_revision INTEGER NOT NULL,token_hash TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,evidence TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '')")
                db.execute("INSERT INTO engagement_bot_attempts VALUES('old','dedupe','line0','51912345678','incoming','hi','Saludo','{}',1,'hashed','failed',1,1,'','')")
            create_app(dict(TESTING=True, DB_PATH=path, PUBLIC_URL='http://localhost', ALLOW_HTTP=True, OWNER_EMAIL='owner@example.test', OWNER_PASSWORD='Synthetic rules password 1!'))
            with sqlite3.connect(path) as db:
                columns = {row[1] for row in db.execute('PRAGMA table_info(engagement_bot_attempts)')}
                self.assertTrue({'contact_key', 'chat_id', 'next_state'}.issubset(columns))
                self.assertEqual(db.execute('SELECT id,contact_key FROM engagement_bot_attempts').fetchone(), ('old', ''))

    def test_handoff_waits_for_restart_and_keeps_the_other_peer_independent(self):
        config = self.flow_configured()
        config['bot']['flows'][0]['nodes'][1]['nextNodeId'] = 'human'
        config['bot']['flows'][0]['nodes'].append(dict(id='human', type='handoff', text='Un asesor continuará contigo.'))
        response = self.client.put('/api/engagement', json=config, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        fields = self.lease()
        start = self.claim(fields, 'handoff-start')
        self.finish(start)
        question = self.claim(fields, 'handoff-eight', '8')
        self.finish(question)
        handoff = self.claim(fields, 'handoff-name', 'Cliente sintético')
        self.finish(handoff)
        self.assertTrue(self.conversation()['state']['handoff'])
        self.assertEqual(self.claim(fields, 'handoff-extra', 'Hola')['reason'], 'handoff')
        fresh_peer = self.claim(fields, 'handoff-peer-b', chat='wa:synthetic-peer-b')
        self.assertTrue(fresh_peer['claimed'])
        restart = self.claim(fields, 'handoff-restart', 'menú')
        self.assertTrue(restart['claimed'])
        self.assertIn('8. Opción 8', restart['rule']['text'])
        self.finish(restart)
        self.assertFalse(self.conversation()['state']['handoff'])
        self.assertEqual(self.conversation()['state']['variables'], {})

    def test_flow_media_metadata_and_delete_reference_are_checked(self):
        config = self.flow_configured()
        data = b'\x89PNG\r\n\x1a\nSynthetic flow fixture'
        metadata = dict(name='Fixture.png', type='image/png', size=len(data), sha256=hashlib.sha256(data).hexdigest())
        uploaded = self.client.post('/api/outreach/media', json=metadata, headers=self.headers)
        self.assertEqual(uploaded.status_code, 201, uploaded.json)
        media = uploaded.json['media']
        base = '/api/outreach/media/' + media['id']
        self.client.put(base + '/chunks/0', json=dict(data=base64.b64encode(data).decode()), headers=self.headers)
        self.assertEqual(self.client.post(base + '/complete', json={}, headers=self.headers).status_code, 200)
        config['bot']['flows'][0]['nodes'][2]['media'] = [dict(media, sha256='0' * 64)]
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 409)
        config['bot']['flows'][0]['nodes'][2]['media'] = [media]
        saved = self.client.put('/api/engagement', json=config, headers=self.headers)
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(self.client.delete(base, json={}, headers=self.headers).status_code, 409)
        updated = saved.json
        updated['bot']['flows'][0]['nodes'][2]['media'] = []
        self.assertEqual(self.client.put('/api/engagement', json=updated, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.delete(base, json={}, headers=self.headers).status_code, 200)

    def test_unmatched_input_allocates_no_session_and_expired_answers_are_removed(self):
        config = self.flow_configured(cooldown=0)
        config['bot']['defaultFlowId'] = ''
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 200)
        fields = self.lease()
        self.assertFalse(self.claim(fields, 'no-match', 'Sin coincidencia')['claimed'])
        self.assertEqual(self.client.get('/api/engagement/conversations').json['items'], [])
        menu = self.claim(fields, 'expiry-start', 'Quiero comprar')
        self.finish(menu)
        question = self.claim(fields, 'expiry-question', '8')
        self.finish(question)
        response = self.claim(fields, 'expiry-answer', 'Cliente sintético')
        self.finish(response)
        with sqlite3.connect(self.app.config['DB_PATH']) as db:
            db.execute('UPDATE engagement_conversations SET expires=?', (int(time.time()) - 1,))
        self.assertEqual(self.client.get('/api/engagement/conversations').json['items'], [])
        self.assertEqual(self.claim(fields, 'expiry-answer', 'Cliente sintético')['reason'], 'duplicate')

    def test_keyword_only_ended_flow_restarts_without_triggering_again(self):
        config = self.flow_configured()
        config['bot']['defaultFlowId'] = ''
        self.assertEqual(self.client.put('/api/engagement', json=config, headers=self.headers).status_code, 200)
        fields = self.lease()
        menu = self.claim(fields, 'keyword-menu', 'comprar')
        self.finish(menu)
        end = self.claim(fields, 'keyword-end', '1')
        self.finish(end)
        self.assertTrue(self.conversation()['state']['ended'])
        restart = self.claim(fields, 'keyword-restart', 'menú')
        self.assertTrue(restart['claimed'], restart)
        self.assertIn('8. Opción 8', restart['rule']['text'])
        self.finish(restart)
        self.assertEqual(self.conversation()['state']['nodeId'], 'menu')


if __name__ == '__main__':
    unittest.main()
