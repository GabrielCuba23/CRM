"""Prepare offline, then publish a separate Access-protected operator control plane."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cloud'))
from deploy import Cloudflare,ensure_access_team,ensure_pin
from retail_deploy import publish
from panel.build import build_panel

NAME='nexo-retail-panel'
DATABASE='nexo-retail-registry'

def configuration(account,database,owner,team,audience,subdomain,provider,assets):
    return {'name':NAME,'main':str(ROOT/'cloud/panel/index.mjs'),'compatibility_date':'2026-10-06','account_id':account,'workers_dev':True,'preview_urls':False,
        'assets':{'directory':str(assets),'binding':'ASSETS','run_worker_first':True},
        'd1_databases':[{'binding':'DB','database_name':DATABASE,'database_id':database}],
        'triggers':{'crons':['*/5 * * * *']},
        'vars':{'OWNER_EMAIL':owner,'ACCESS_TEAM_DOMAIN':team,'ACCESS_AUD':audience,'ACCOUNT_ID':account,'WORKERS_SUBDOMAIN':subdomain,'PIN_PROVIDER_ID':provider,'PANEL_WORKER_NAME':NAME,'PUBLIC_URL':f'https://{NAME}.{subdomain}.workers.dev'}}

def deploy_panel(api,owner,assets,wrangler):
    team=ensure_access_team(api)
    provider=ensure_pin(api)
    subdomain=api.call('GET','/workers/subdomain').get('subdomain','')
    if not re.fullmatch(r'[a-z0-9-]+',subdomain):raise RuntimeError('Activa el subdominio workers.dev en tu cuenta.')
    hostname=f'{NAME}.{subdomain}.workers.dev'
    databases=api.call('GET','/d1/database?per_page=100')
    applications=api.call('GET','/access/apps?per_page=100')
    workers=api.call('GET','/workers/scripts')
    if len(databases)>=100 or len(applications)>=100:raise RuntimeError('Revisa la paginación antes de crear recursos.')
    if any(db.get('name')==DATABASE for db in databases) or any(app.get('domain')==hostname for app in applications) or any(script.get('id',script.get('name'))==NAME for script in workers):raise RuntimeError('El panel o su base ya existen. Revisa esos recursos; no se sobrescribirán.')
    with tempfile.TemporaryDirectory(prefix='retail-panel-') as folder:
        manifest=Path(folder)/'publication.json'
        state={'owner_email':owner,'hostname':hostname,'status':'preparing'}
        # Store recoverable checkpoints outside assets even if an operation fails.
        checkpoint=Path(tempfile.mkdtemp(prefix='retail-panel-record-'))/'publication.json'
        def save():
            checkpoint.write_text(json.dumps(state,indent=2)+'\n');checkpoint.chmod(0o600)
        save()
        database=api.call('POST','/d1/database',{'name':DATABASE})
        if not database.get('uuid'):raise RuntimeError('Cloudflare no confirmó la base del panel.')
        state.update(database_id=database['uuid'],status='database_created');save()
        result=api.call('POST',f"/d1/database/{database['uuid']}/query",{'sql':(ROOT/'cloud/panel/schema.sql').read_text()})
        if not result or any(row.get('success') is False for row in result):raise RuntimeError('No se confirmó el esquema del panel.')
        config=configuration(api.account,database['uuid'],owner,team,'not-configured-closed',subdomain,provider['id'],assets)
        publish(config,wrangler,hostname);state['status']='worker_locked';save()
        application=api.call('POST','/access/apps',{'name':'Panel CRM marca blanca','type':'self_hosted','domain':hostname,'session_duration':'8h','allowed_idps':[provider['id']],'http_only_cookie_attribute':True,'policies':[{'name':'Solo administrador','decision':'allow','include':[{'email':{'email':owner}}]}]})
        state.update(access_id=application.get('id'),status='access_pending_validation');save()
        if not application.get('aud') or application['aud']=='not-configured-closed' or any(app.get('aud')==application['aud'] for app in applications):raise RuntimeError('Access no confirmó una audiencia propia para el panel.')
        config['vars']['ACCESS_AUD']=application['aud'];publish(config,wrangler,hostname)
        state.update(status='published_pending_verification',access_aud=application['aud']);save()
        (checkpoint.parent/'wrangler.json').write_text(json.dumps(config,indent=2));(checkpoint.parent/'wrangler.json').chmod(0o600)
        return 'https://'+hostname,checkpoint

def main():
    parser=argparse.ArgumentParser(description='Preparar panel Cloudflare; --deploy publica recursos privados nuevos.')
    parser.add_argument('--deploy',action='store_true')
    parser.add_argument('--owner-email',default=os.environ.get('RETAIL_ADMIN_EMAIL','gabostreaming0@gmail.com'))
    parser.add_argument('--wrangler',default='/tmp/crm-cloud-tools/node_modules/.bin/wrangler')
    args=parser.parse_args();owner=args.owner_email.strip().lower()
    if not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',owner):parser.error('Correo administrador no válido.')
    token=os.environ.get('CLOUDFLARE_API_TOKEN');account=os.environ.get('CLOUDFLARE_ACCOUNT_ID','')
    if args.deploy and (not token or not re.fullmatch(r'[a-f0-9]{32}',account)):parser.error('Configura CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en los ajustes seguros.')
    assets=build_panel()
    if not args.deploy:
        print('Panel preparado localmente. Administrador previsto:',owner)
        print('Para publicar utiliza --deploy cuando las credenciales estén disponibles. No se crearon recursos externos.');return
    url,record=deploy_panel(Cloudflare(account,token),owner,assets,args.wrangler)
    print('Panel publicado, pendiente de verificar:',url)
    print('Registro privado de publicación:',record)
    print('Configura RETAIL_PROVISION_TOKEN como secreto en el Worker para habilitar la creación de CRMs. No se copió el token del entorno a producción.')

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError) as error:raise SystemExit(str(error)) from None
