"""Owner-only scheduled Excel reports. Provider acceptance is not delivery."""
import base64
import calendar
import datetime as dt
import io
import json
import os
import re
import urllib.request
import urllib.error
import zipfile
from xml.sax.saxutils import escape, quoteattr
from zoneinfo import ZoneInfo
from .storage import connect, read_workspace


def due_reports(settings, now):
    local = now.astimezone(ZoneInfo('America/Lima'))
    if local.hour < settings.get('hour', 9):
        return []
    day = local.date().isoformat()
    kinds = []
    if settings.get('clientsWeekly') and local.weekday() == 4:
        kinds.append('clients')
    if settings.get('financeTwiceMonthly') and local.day in (15, calendar.monthrange(local.year, local.month)[1]):
        kinds.append('finance')
    return [(kind, day) for kind in kinds]


def sheets(state, kind, day):
    clients, accounts, ledger = (state.get(k, []) for k in ['clients','accounts','ledger'])
    if kind == 'clients':
        rows = [['ID','Nombre','Teléfono','Usuario WhatsApp','Correo','Servicio','Perfil','Renovar el','Precio venta S/','Coste por perfil S/','Estado','Notas']]
        for c in clients:
            a = next((a for a in accounts if a['id'] == c.get('accountId')), {})
            cost = a['costCents']/a['capacity']/100 if 'costCents' in a and a.get('capacity') else ''
            status = 'Archivado' if c.get('archived') else 'Sin servicio' if not c.get('expires') else 'Vencido' if c['expires'] < day else 'Vigente'
            rows.append([c['id'], c['name'], c['phone'], c.get('whatsappUsername',''), c['email'], c['service'], c['profile'], c['expires'], c.get('price',0)/100, cost, status,c['notes']])
        history = [['Cliente ID','Nombre','Servicio','Vencimiento','Precio S/','Finalizado']] + [[c['id'],c['name'],h['service'],h['expires'],h['price']/100,h['endedAt']] for c in clients for h in c.get('serviceHistory',[])]
        purchases = [['Fecha','Cliente ID','Descripción','Servicio','Importe S/']] + [[l['date'],l.get('clientId',''),l['description'],l['service'],l['amount']/100] for l in ledger if l['kind'] != 'expense']
        return [('Clientes',rows),('Historial de servicios',history),('Compras',purchases)]
    movements = [l for l in ledger if l['date'].startswith(day[:7]) and l['date'] <= day]
    income = sum(l['amount'] for l in movements if l['kind'] != 'expense')/100
    expenses = sum(l['amount'] for l in movements if l['kind'] == 'expense')/100
    summary = [['Concepto','Valor'],['Periodo',day[:7]],['Hasta',day],['Ingresos cobrados S/',income],['Gastos pagados S/',expenses],['Resultado de caja S/',income-expenses],['Renovaciones cobradas',sum(l['kind']=='renewal' for l in movements)],['Criterio','Solo movimientos registrados; no incluye ventas pendientes ni gastos sin registrar.']]
    details = [['Fecha','Tipo','Descripción','Servicio','Cliente ID','Proveedor ID','Cuenta ID','Categoría','Referencia','Importe S/']] + [[l['date'],l['kind'],l['description'],l['service'],l.get('clientId',''),l.get('supplierId',''),l.get('accountId',''),l.get('category',''),l.get('reference',''),l['amount']/100] for l in movements]
    costs = [['Servicio','Cuenta','Proveedor','Coste cuenta S/','Perfiles','Coste por perfil S/','Periodo meses','Criterio']] + [[a['service'],a['email'],a['provider'],a['costCents']/100 if 'costCents' in a else '',a['capacity'],a['costCents']/a['capacity']/100 if 'costCents' in a else '',a.get('costIntervalMonths',''),'Coste configurado; no es un gasto pagado'] for a in accounts]
    return [('Resumen',summary),('Movimientos',details),('Costes de cuentas',costs)]


def workbook(tables):
    output = io.BytesIO()
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    def text(value):
        return escape(re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(value)))
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,len(tables)+1))+'</Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml',f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ''.join(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>' for i,(name,_) in enumerate(tables,1))+'</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,len(tables)+1))+'</Relationships>')
        for i,(_,rows) in enumerate(tables,1):
            body = []
            for j,row in enumerate(rows,1):
                cells=[]
                for k,v in enumerate(row,1):
                    col='';n=k
                    while n:
                        n,r=divmod(n-1,26);col=chr(65+r)+col
                    ref=f'{col}{j}'
                    cells.append(f'<c r="{ref}"><v>{v}</v></c>' if type(v) in (int,float) else f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text(v)}</t></is></c>')
                body.append(f'<row r="{j}">'+''.join(cells)+'</row>')
            z.writestr(f'xl/worksheets/sheet{i}.xml',f'<worksheet xmlns="{ns}"><sheetData>'+''.join(body)+'</sheetData></worksheet>')
    return output.getvalue()


def report_status(path):
    with connect(path) as db:
        owner = db.execute('SELECT email FROM owner WHERE id=1').fetchone()
        recent = [dict(r) for r in db.execute('SELECT kind,day,state FROM email_reports ORDER BY attempted DESC LIMIT 20')]
    recipient = owner['email'] if owner else ''
    return {'configured':bool(recipient and os.environ.get('RESEND_API_KEY') and os.environ.get('REPORT_FROM_EMAIL')),'recipient':recipient,'recent':recent,'delivery':'resend'}


def send_report(payload, key):
    request = urllib.request.Request('https://api.resend.com/emails',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['RESEND_API_KEY'],'Content-Type':'application/json','Idempotency-Key':key})
    with urllib.request.urlopen(request,timeout=25) as response:
        return json.load(response).get('id')


def process_reports(path, now=None, sender=send_report):
    status=report_status(path)
    if not status['configured']:
        return 0
    now=now or dt.datetime.now(dt.timezone.utc)
    state,_=read_workspace(path);accepted=0
    for kind,day in due_reports(state.get('reports',{}),now):
        key=kind+':'+day
        with connect(path) as db:
            inserted=db.execute("INSERT OR IGNORE INTO email_reports(id,kind,day,state,attempted) VALUES(?,?,?,'processing',?)",(key,kind,day,int(now.timestamp()*1000))).rowcount
        if not inserted:
            continue
        result='failed';provider_id=None
        try:
            content=base64.b64encode(workbook(sheets(state,kind,day))).decode()
            payload={'from':os.environ['REPORT_FROM_EMAIL'],'to':[status['recipient']],'subject':f"{state['settings']['business']} · {'Clientes' if kind=='clients' else 'Finanzas'} · {day}",'text':f'Reporte del CRM al {day}, hora de Lima. No incluye contraseñas ni PIN.','attachments':[{'filename':f'{kind}-{day}.xlsx','content':content}]}
            result='uncertain'
            provider_id=sender(payload,key)
            if isinstance(provider_id,str) and provider_id:
                result='accepted';accepted+=1
        except urllib.error.HTTPError as error:
            result='uncertain' if error.code>=500 else 'rejected'
        except Exception:
            pass
        with connect(path) as db:
            db.execute('UPDATE email_reports SET state=?,provider_id=? WHERE id=?',(result,provider_id,key))
    return accepted
