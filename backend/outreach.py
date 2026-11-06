"""Validate optional campaign data without storing attachment bytes in workspaces."""
import datetime as dt
import json
import re


def validate_outreach(value):
    def fail():
        raise ValueError('Los datos de campañas o contactos no son válidos.')
    def text(v, limit=8000, required=False):
        if not isinstance(v, str) or len(v) > limit or (required and not v.strip()): fail()
        return v
    def number(v, low, high):
        if type(v) is not int or not low <= v <= high: fail()
        return v
    def stamp(v):
        text(v, 40)
        if v:
            try: dt.datetime.fromisoformat(v.replace('Z', '+00:00'))
            except ValueError: fail()
        return v
    def strings(v, count=100, length=100):
        if not isinstance(v, list) or len(v) > count: fail()
        result = [text(x, length, True).strip() for x in v]
        if len(set(result)) != len(result): fail()
        return result
    def rows(v, count, clean):
        if not isinstance(v, list) or len(v) > count: fail()
        result = [clean(x) for x in v]
        if len({x['id'] for x in result}) != len(result): fail()
        return result
    def phone(v, optional=False):
        if optional and v == '': return ''
        if not isinstance(v, str) or not re.fullmatch(r'[1-9]\d{6,14}', v): fail()
        return v
    def fields(v):
        if not isinstance(v, dict) or len(v) > 40: fail()
        if any(k in ('__proto__','prototype','constructor') for k in v): fail()
        return {text(k, 100, True): text(x, 1000) for k,x in v.items()}
    def media(v):
        if not isinstance(v, dict) or v.get('type') not in ['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']: fail()
        sha = text(v.get('sha256',''),64)
        if sha and not re.fullmatch('[a-f0-9]{64}', sha): fail()
        return dict(id=text(v.get('id'),100,True),name=text(v.get('name'),200,True),type=v['type'],size=number(v.get('size'),1,20971520),sha256=sha)
    def contact(v):
        if not isinstance(v, dict) or v.get('source') not in ['manual','excel','whatsapp','crm']: fail()
        if any(type(v.get(k,False)) is not bool for k in ['archived','marketingConsent']): fail()
        return dict(id=text(v.get('id'),100,True),name=text(v.get('name'),160,True),phone=phone(v.get('phone',''),True),fields=fields(v.get('fields',{})),labels=strings(v.get('labels',[]),30,80),source=v['source'],archived=v.get('archived',False),marketingConsent=v.get('marketingConsent',False))
    def recipient(v):
        if not isinstance(v,dict) or v.get('status') not in ['pending','prepared','sending','sent_observed','sent_manual','failed','uncertain','skipped']: fail()
        return dict(id=text(v.get('id'),100,True),name=text(v.get('name'),160,True),phone=phone(v.get('phone')),fields=fields(v.get('fields',{})),labels=strings(v.get('labels',[]),30,80),status=v['status'],attempts=number(v.get('attempts',0),0,100),error=text(v.get('error',''),1000),sentAt=stamp(v.get('sentAt','')),evidence=text(v.get('evidence',''),1000))
    def template(v):
        if not isinstance(v,dict): fail()
        result=dict(id=text(v.get('id'),100,True),name=text(v.get('name'),160,True),body=text(v.get('body','')),media=rows(v.get('media',[]),10,media))
        if not result['body'].strip() and not result['media']: fail()
        if sum(x['size'] for x in result['media']) > 20971520: fail()
        return result
    def campaign(v):
        result=template(v)
        if v.get('status') not in ['draft','scheduled','running','paused','completed','cancelled']: fail()
        recipients=rows(v.get('recipients',[]),2000,recipient)
        if len({x['phone'] for x in recipients}) != len(recipients): fail()
        result.update(recipients=recipients,status=v['status'],createdAt=stamp(v.get('createdAt')),updatedAt=stamp(v.get('updatedAt')),scheduledAt=stamp(v.get('scheduledAt','')),delaySeconds=number(v.get('delaySeconds',5),0,86400),batchSize=number(v.get('batchSize',20),1,1000),batchPauseSeconds=number(v.get('batchPauseSeconds',30),0,86400))
        return result
    if not isinstance(value,dict) or value.get('version') != 1 or not isinstance(value.get('settings'),dict): fail()
    code=text(value['settings'].get('countryCode'),4,True)
    if not re.fullmatch(r'\d{1,4}',code): fail()
    result=dict(version=1,contacts=rows(value.get('contacts'),5000,contact),campaigns=rows(value.get('campaigns'),50,campaign),templates=rows(value.get('templates'),200,template),labels=strings(value.get('labels'),100,80),exclusions=strings(value.get('exclusions'),5000,15),settings={'countryCode':code})
    phones=[x['phone'] for x in result['contacts'] if x['phone']]
    if len(set(phones)) != len(phones): fail()
    for x in result['exclusions']: phone(x)
    if len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()) > 700000: fail()
    return result
