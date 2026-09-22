from pathlib import Path
import subprocess,time,json,datetime
name='mudavym-arrival-validation-20260913'
b=Path(__file__).resolve().parents[4]/'supabase/migrations'
a=(b/'20260922190000_arrival_configuration_book.sql').read_text();undo=(b/'20260922190100_arrival_configuration_undo.sql').read_text()
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
 grants=json.loads(sql("SELECT json_agg(json_build_object('role',r,'record',has_function_privilege(r,'public.arrival_record_folio(uuid,uuid,text,text,jsonb,uuid)','EXECUTE'),'undo',has_function_privilege(r,'public.arrival_restore_entry(uuid,uuid,uuid,uuid,text)','EXECUTE'),'batches',has_table_privilege(r,'public.configuration_batches','SELECT'))) FROM unnest(ARRAY['anon','authenticated','service_role']) r;"))
 for g in grants:
  assert all(g[k] for k in ['record','undo','batches']) if g['role']=='service_role' else not any(g[k] for k in ['record','undo','batches'])
 result={'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':'Disposable PostgreSQL17; network none; tmpfs only','grants':grants,'assertions':'Atomic skip/audit; failed audit rolls back folio; currency undo and newer-write conflict; absent-preference restore; reverse sibling preferences; menu/zero-stock undo; later inventory/menu/composite FK use refuses removal; separate undo audit correlation; actual service-role invoker call; expired/foreign-house undo refusal','limit':'Minimal schema matching referenced columns, not a full production-history replay. No production writes.'}
 Path(__file__).with_name('postgres-validation.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
finally:
 print('Disposable container removed:',run(['docker','rm','-f',name]).returncode==0)
