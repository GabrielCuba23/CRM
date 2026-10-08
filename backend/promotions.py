import datetime as dt

def validate_promotions(p=None):
    if p is None:p={'offers':[],'applications':[]}
    def fail():raise ValueError('Promociones no válidas.')
    def text(o,keys):return isinstance(o,dict) and all(isinstance(o.get(k),str) and len(o[k])<=8000 for k in keys)
    def number(n,max_value=99999900):return type(n) is int and 0<=n<=max_value
    def total(base,kind,value):
        if not number(base) or kind not in ['percent','amount','gift'] or not number(value) or (kind=='percent' and value>10000) or (kind=='gift' and value!=0):fail()
        discount=(base*value+5000)//10000 if kind=='percent' else min(base,value) if kind=='amount' else 0
        return discount,base-discount
    if not isinstance(p,dict) or any(not isinstance(p.get(k),list) or len(p[k])>10000 for k in ['offers','applications']):fail()
    offer_keys=['id','name','kind','value','giftService','notes']
    application_keys=['id','clientId','offerId','name','kind','value','giftService','notes','service','occurredAt','ledgerId','updateClientPrice','base','discount','final']
    for key,fields in [('offers',offer_keys),('applications',application_keys)]:
        ids=[]
        for o in p[key]:
            strings=[k for k in fields if k not in ['value','updateClientPrice','base','discount','final']]
            if not text(o,strings) or not o['id']:fail()
            ids.append(o['id'])
            if key=='offers':
                if not o['name'].strip() or (o['kind']=='gift' and not o['giftService'].strip()):fail()
                total(0,o['kind'],o['value'])
            else:
                if not o['clientId'] or type(o['updateClientPrice']) is not bool:fail()
                try:dt.datetime.fromisoformat(o['occurredAt'].replace('Z','+00:00'))
                except ValueError:fail()
                discount,final=total(o['base'],o['kind'],o['value'])
                if not number(o['discount']) or not number(o['final']) or o['discount']!=discount or o['final']!=final:fail()
        if len(set(ids))!=len(ids):fail()
    return {'offers':[{k:o[k] for k in offer_keys} for o in p['offers']],'applications':[{k:o[k] for k in application_keys} for o in p['applications']]}
