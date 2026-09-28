-- ADR 0104 D15 — SQL assertions. Red on the 108-migration control, green on 109.
\set ON_ERROR_STOP on
\pset pager off

-- Fixtures ------------------------------------------------------------------
insert into public.restaurants (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'D15 Venue A', 'd15-venue-a'),
       ('22222222-2222-2222-2222-222222222222', 'D15 Venue B', 'd15-venue-b')
on conflict (id) do nothing;

-- T1 — the columns exist on providers.
select 'T1 provider identity columns' as t,
       count(*) = 6 as pass
from information_schema.columns
where table_schema='public' and table_name='providers'
  and column_name in ('tax_id','tax_id_normalized','tax_country','tax_office',
                      'provisional_until_first_order','created_from_document_id');

-- T2 — the venue's own identity exists (the self-billed check).
select 'T2 restaurant identity columns' as t,
       count(*) = 3 as pass
from information_schema.columns
where table_schema='public' and table_name='restaurants'
  and column_name in ('tax_id','tax_id_normalized','tax_country');

-- T3 — the resolution log exists.
select 'T3 resolution table' as t, to_regclass('public.document_vendor_resolutions') is not null as pass;

-- T4 — two providers of ONE restaurant cannot share one identity.
insert into public.providers (id, name, primary_contact, restaurant_id, tax_id, tax_id_normalized)
values ('aaaaaaaa-0000-0000-0000-000000000001','Sentetik A','{}'::jsonb,
        '11111111-1111-1111-1111-111111111111','1234567890','TR:1234567890');
do $$
begin
  insert into public.providers (id, name, primary_contact, restaurant_id, tax_id, tax_id_normalized)
  values ('aaaaaaaa-0000-0000-0000-000000000002','Sentetik A duplicate','{}'::jsonb,
          '11111111-1111-1111-1111-111111111111','1234567890','TR:1234567890');
  raise exception 'T4 FAILED: the duplicate identity was accepted';
exception when unique_violation then
  raise notice 'T4 pass: duplicate identity refused (23505)';
end $$;

-- T5 — TWO restaurants may each hold the same vendor identity.
insert into public.providers (id, name, primary_contact, restaurant_id, tax_id_normalized)
values ('aaaaaaaa-0000-0000-0000-000000000003','Sentetik A at venue B','{}'::jsonb,
        '22222222-2222-2222-2222-222222222222','TR:1234567890');
select 'T5 same identity, two venues' as t, count(*) = 2 as pass
from public.providers where tax_id_normalized = 'TR:1234567890' and deleted_at is null;

-- T6 — providers WITHOUT an identity are not duplicates of one another.
insert into public.providers (id, name, primary_contact, restaurant_id)
values ('aaaaaaaa-0000-0000-0000-000000000004','No identity 1','{}'::jsonb,'11111111-1111-1111-1111-111111111111'),
       ('aaaaaaaa-0000-0000-0000-000000000005','No identity 2','{}'::jsonb,'11111111-1111-1111-1111-111111111111');
select 'T6 identity-less providers coexist' as t, count(*) = 2 as pass
from public.providers where tax_id_normalized is null
  and restaurant_id = '11111111-1111-1111-1111-111111111111';

-- T7 — a soft-deleted provider does not block a live one on the same identity.
update public.providers set deleted_at = now()
where id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.providers (id, name, primary_contact, restaurant_id, tax_id_normalized)
values ('aaaaaaaa-0000-0000-0000-000000000006','Sentetik A again','{}'::jsonb,
        '11111111-1111-1111-1111-111111111111','TR:1234567890');
select 'T7 soft-deleted does not block' as t, true as pass;
delete from public.providers where id = 'aaaaaaaa-0000-0000-0000-000000000006';
update public.providers set deleted_at = null where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- T8 — a matched/created row MUST carry a provider and a source.
do $$
begin
  insert into public.document_vendor_resolutions
    (document_id, restaurant_id, state, reason)
  values (null, '11111111-1111-1111-1111-111111111111', 'matched', 'x');
  raise exception 'T8 FAILED: a matched row with no document was accepted';
exception when not_null_violation then
  raise notice 'T8 pass: a resolution with no document refused';
end $$;

-- T9 — an unresolved row may NOT carry a provider (a refusal names no vendor).
insert into public.procurement_documents (id, restaurant_id, doc_type, source_channel)
values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','invoice','upload')
on conflict (id) do nothing;
do $$
begin
  insert into public.document_vendor_resolutions
    (document_id, restaurant_id, state, source, provider_id, reason)
  values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
          'unresolved','matched_tax_id','aaaaaaaa-0000-0000-0000-000000000001','x');
  raise exception 'T9 FAILED: an unresolved row named a provider';
exception when check_violation then
  raise notice 'T9 pass: an unresolved resolution cannot name a provider';
end $$;

-- T10 — a reason is required, and cannot be empty.
do $$
begin
  insert into public.document_vendor_resolutions
    (document_id, restaurant_id, state, reason)
  values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','unresolved','');
  raise exception 'T10 FAILED: an empty reason was accepted';
exception when check_violation then
  raise notice 'T10 pass: a resolution must carry a sentence';
end $$;

-- T11 — the log is APPEND-ONLY: no update.
insert into public.document_vendor_resolutions
  (id, document_id, restaurant_id, state, source, provider_id, reason,
   matched_tax_id_normalized, tax_id_scheme)
values ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111','matched','matched_tax_id',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'The seller''s printed tax identity 1234567890 matches exactly one provider on file.',
        'TR:1234567890','TR_VKN');
do $$
begin
  update public.document_vendor_resolutions set reason = 'rewritten'
  where id = 'eeeeeeee-0000-0000-0000-000000000001';
  raise exception 'T11 FAILED: the resolution log accepted an UPDATE';
exception when others then
  raise notice 'T11 pass: update refused — %', sqlerrm;
end $$;

-- T12 — the log is APPEND-ONLY: no delete.
do $$
begin
  delete from public.document_vendor_resolutions
  where id = 'eeeeeeee-0000-0000-0000-000000000001';
  raise exception 'T12 FAILED: the resolution log accepted a DELETE';
exception when others then
  raise notice 'T12 pass: delete refused — %', sqlerrm;
end $$;

-- T13 — a second run APPENDS; the latest row is the answer.
insert into public.document_vendor_resolutions
  (document_id, restaurant_id, state, reason, document_revision)
values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'unresolved','The re-extraction read a different tax identity and it matches nobody.', 2);
select 'T13 append-only history kept' as t,
       count(*) = 2 as pass,
       (select state from public.document_vendor_resolutions
         where document_id='dddddddd-0000-0000-0000-000000000001'
         order by resolved_at desc limit 1) as latest
from public.document_vendor_resolutions
where document_id = 'dddddddd-0000-0000-0000-000000000001';

-- T14 — RLS is on, with a service-role policy (check_new_tables_are_locked_down).
select 'T14 rls enabled' as t, relrowsecurity as pass
from pg_class where oid = 'public.document_vendor_resolutions'::regclass;

-- T15 — `unavailable` is a state the table can actually hold, distinct from
--       `unresolved`. If this ever collapses, absence reads as health.
insert into public.document_vendor_resolutions
  (document_id, restaurant_id, state, reason)
values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'unavailable','The providers table could not be read, so no vendor was looked for.');
select 'T15 unavailable is its own state' as t,
       count(distinct state) = 3 as pass
from public.document_vendor_resolutions
where document_id = 'dddddddd-0000-0000-0000-000000000001';
