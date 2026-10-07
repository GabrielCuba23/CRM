"""Provision the user's own Cloudflare Free resources after explicit account authorization.
Credentials are read from the process environment, never command arguments or output.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request

from build import build

ROOT=Path(__file__).resolve().parent.parent
API='https://api.cloudflare.com/client/v4'


class Cloudflare:
    def __init__(self,account,token):
        self.account=account
        self.token=token

    def call(self,method,path,data=None,allow_missing=False):
        request=urllib.request.Request(API+'/accounts/'+self.account+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=30) as response:result=json.load(response)
        except urllib.error.HTTPError as error:
            if allow_missing and error.code==404:return None
            raise RuntimeError(f'Cloudflare rechazó la operación {method} {path} (HTTP {error.code}). Revisa los permisos de la cuenta y el plan Free.') from None
        except urllib.error.URLError:
            raise RuntimeError('No se pudo conectar con Cloudflare. Revisa la autorización de red del entorno.') from None
        if not result.get('success'):
            raise RuntimeError(f'Cloudflare no confirmó la operación {method} {path}. No se publicará una web sin protección.')
        return result['result']


def ensure_database(api):
    databases=api.call('GET','/d1/database?per_page=100')
    if len(databases)>=100:raise RuntimeError('La lista de bases requiere paginación. No se crearán recursos ambiguos.')
    matches=[db for db in databases if db['name']=='nexo-crm']
    if len(matches)>1:raise RuntimeError('Hay varias bases de datos llamadas nexo-crm. Selecciona una antes de continuar.')
    database=matches[0] if matches else api.call('POST','/d1/database',{'name':'nexo-crm'})
    results=api.call('POST',f"/d1/database/{database['uuid']}/query",{'sql':(ROOT/'cloud/schema.sql').read_text()})
    if any(result.get('success') is False for result in (results or [])):raise RuntimeError('D1 no confirmó el esquema. El despliegue permanece bloqueado.')
    return database['uuid']


def ensure_access_team(api):
    organization=api.call('GET','/access/organizations',allow_missing=True)
    if not organization:
        raise RuntimeError('Primero activa Cloudflare Zero Trust con el plan Free en tu propia cuenta. El script no acepta planes de pago ni condiciones legales por ti.')
    domain=organization.get('auth_domain','')
    if not re.fullmatch(r'[a-z0-9-]+\.cloudflareaccess\.com',domain):raise RuntimeError('No se encontró un dominio válido del equipo Zero Trust.')
    return domain


def ensure_pin(api):
    providers=api.call('GET','/access/identity_providers')
    existing=next((p for p in providers if p.get('type')=='onetimepin'),None)
    return existing or api.call('POST','/access/identity_providers',{'name':'Nexo · código por correo','type':'onetimepin','config':{}})


def ensure_application(api,domain,owner,provider_id):
    applications=api.call('GET','/access/apps?per_page=100')
    if len(applications)>=100:raise RuntimeError('La lista de aplicaciones requiere paginación. No se cambiará Access.')
    existing=next((a for a in applications if a.get('domain')==domain),None)
    if existing:
        if existing.get('name')!='Nexo CRM privado':raise RuntimeError('Ese dominio tiene otra aplicación de Access. No se sobrescribirá su configuración.')
        return existing
    return api.call('POST','/access/apps',{
        'name':'Nexo CRM privado','type':'self_hosted','domain':domain,'session_duration':'8h',
        'allowed_idps':[provider_id],'http_only_cookie_attribute':True,
        'policies':[{'name':'Solo el administrador','decision':'allow','include':[{'email':{'email':owner}}]}]
    })


def worker_config(account,database,owner,team,aud,assets):
    return {
        'name':'nexo-crm','main':str(ROOT/'cloud/index.mjs'),'compatibility_date':'2026-10-06',
        'account_id':account,'workers_dev':True,'preview_urls':False,
        'assets':{'directory':str(assets),'binding':'ASSETS','run_worker_first':True},
        'triggers':{'crons':['0 * * * *']},
        'vars':{'OWNER_EMAIL':owner,'ACCESS_TEAM_DOMAIN':team,'ACCESS_AUD':aud,'WHATSAPP_API_VERSION':'v23.0'},
        'd1_databases':[{'binding':'DB','database_name':'nexo-crm','database_id':database}],
    }


def publish(config,executable):
    with tempfile.NamedTemporaryFile(mode='w',suffix='.json',prefix='nexo-wrangler-',delete=False) as file:
        json.dump(config,file);path=file.name
    try:
        result=subprocess.run([executable,'deploy','--config',path],cwd=ROOT,env={**os.environ,'WRANGLER_SEND_METRICS':'false','XDG_CONFIG_HOME':os.environ.get('XDG_CONFIG_HOME','/tmp/crm-cloud-config'),'WRANGLER_LOG_PATH':'/tmp/crm-cloud-logs'},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:raise RuntimeError('Wrangler no pudo publicar. Revisa la autenticación y los permisos de Cloudflare en el entorno seguro; no se imprimirán respuestas que puedan contener datos sensibles.')
        urls=re.findall(r'https://nexo-crm\.[a-z0-9-]+\.workers\.dev',result.stdout)
        if not urls:raise RuntimeError('Wrangler terminó, pero no se confirmó la URL workers.dev. Verifica el resultado en la cuenta antes de continuar.')
        return urls[-1]
    finally:
        Path(path).unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description='Publicar Nexo en la cuenta Cloudflare Free del usuario.')
    parser.add_argument('--account-id',default=os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
    parser.add_argument('--owner-email',default=os.environ.get('CRM_OWNER_EMAIL'))
    parser.add_argument('--wrangler',default='/tmp/crm-cloud-tools/node_modules/.bin/wrangler')
    args=parser.parse_args()
    token=os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:parser.error('Falta CLOUDFLARE_API_TOKEN. Configúralo de forma privada, nunca en el chat.')
    if not args.account_id or not re.fullmatch(r'[0-9a-f]{32}',args.account_id):parser.error('Falta un CLOUDFLARE_ACCOUNT_ID válido.')
    if not args.owner_email or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',args.owner_email):parser.error('Falta CRM_OWNER_EMAIL para restringir el acceso.')
    api=Cloudflare(args.account_id,token)
    team=ensure_access_team(api)
    provider=ensure_pin(api)
    database=ensure_database(api)
    assets=build()
    config=worker_config(args.account_id,database,args.owner_email.lower(),team,'not-configured-closed',assets)
    # First deploy is locked. There is no temporary unauthenticated application.
    url=publish(config,args.wrangler)
    application=ensure_application(api,url.split('://')[1],args.owner_email.lower(),provider['id'])
    if not application.get('aud'):raise RuntimeError('Cloudflare no devolvió el identificador del acceso. El sitio permanece bloqueado.')
    config['vars']['ACCESS_AUD']=application['aud']
    publish(config,args.wrangler)
    generated=ROOT/'cloud/wrangler.generated.json'
    generated.write_text(json.dumps(config,indent=2)+'\n')
    generated.chmod(0o600)
    print('Publicación completada:',url)
    print('Prueba el acceso con tu correo y confirma que otro usuario queda bloqueado. WhatsApp sigue desactivado hasta conectar Meta y una plantilla aprobada.')


if __name__=='__main__':
    try:main()
    except RuntimeError as error:raise SystemExit(str(error)) from None
