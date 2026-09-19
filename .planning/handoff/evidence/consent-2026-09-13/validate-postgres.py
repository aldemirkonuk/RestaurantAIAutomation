from pathlib import Path
import subprocess,time,json,datetime
name='mudavym-consent-validation-20260913'
b=Path(__file__).resolve().parents[4]/'supabase/migrations'
a=(b/'20260913191200_integration_consent_receipts.sql').read_text();undo=(b/'20260913191300_mudavym_design_flag_authorize.sql').read_text()
def run(args,**kw):return subprocess.run(args,capture_output=True,text=True,**kw)
def rawsql(s):return run(['docker','exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-A','-t'],input=s)
def sql(s):
 r=rawsql(s)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
r=run(['docker','run','--rm','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17'])
if r.returncode:raise RuntimeError(r.stderr)
try:
 for _ in range(100):
  log=run(['docker','logs',name]);logs=log.stdout+log.stderr
  if 'PostgreSQL init process complete; ready for start up.' in logs and rawsql('SELECT 1;').returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('final server did not become ready')
 fixture=Path(__file__).with_name('postgres-fixture.sql').read_text()
 sql(fixture)
 sql(a);sql(undo)
 tests=Path(__file__).with_name('postgres-assertions.sql').read_text()
 print(sql(tests))
 result={'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':'Disposable PostgreSQL17; network none; tmpfs only','assertions':'Append-only receipts under actual service role; client read denied; duplicate seal refusal; CAS state replay refusal; account deletion cascade; dark page flag','limit':'Minimal matching schema, not full production migration history; no production writes'}
 Path(__file__).with_name('postgres-validation.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
finally:
 print('Disposable container removed:',run(['docker','rm','-f',name]).returncode==0)
