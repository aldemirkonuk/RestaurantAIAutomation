-- SQL tests for 20260903160000_canonical_document_and_delivery.sql.
--
-- HOW TO RUN. These are plain psql assertions, not pgTAP: they run against a
-- throwaway Postgres built from supabase/migrations in filename order (the
-- recipe is pgvector/pgvector:pg17 + postgresql-17-postgis-3, the Supabase roles
-- and schemas, pgcrypto/uuid-ossp in `extensions`, pg_trgm/btree_gist/vector/
-- postgis in `public`, an `auth.users` stub, and the PostGIS revokes). Then:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20260903160000_canonical_document_and_delivery_test.sql
--
-- Every assertion RAISEs on failure, so ON_ERROR_STOP makes a red run loud. The
-- whole file runs inside one transaction that is ROLLED BACK at the end: it
-- writes fixtures and leaves nothing behind. NEVER run it against production —
-- it inserts restaurants, providers and documents.
--
-- All fixture data below is SYNTHETIC.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Two restaurants, because the dedupe key is per tenant (ADR 0104 S2).
-- ---------------------------------------------------------------------------
insert into public.restaurants (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'SYNTHETIC Meyhane A', 'synthetic-a'),
       ('22222222-2222-2222-2222-222222222222', 'SYNTHETIC Meyhane B', 'synthetic-b');

insert into public.providers (id, name, primary_contact, is_custom)
values ('33333333-3333-3333-3333-333333333333', 'SYNTHETIC Distributor', '{"email":"ops@example.invalid"}'::jsonb, true);

insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, source_channel)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'invoice', 'email'),
       ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'credit_memo', 'email');

insert into public.deliveries (id, restaurant_id, provider_id, state)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'DELIVERED'),
       ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'RECONCILING');

-- ---------------------------------------------------------------------------
-- T1 — document_revisions is append-only: UPDATE is refused (ADR 0104 D5).
-- ---------------------------------------------------------------------------
insert into public.document_revisions (document_id, revision, layer1, source)
values ('44444444-4444-4444-4444-444444444444', 1, '{"header":{}}'::jsonb, 'extracted');

do $$
declare refused boolean := false;
begin
  begin
    update public.document_revisions set source = 'human_corrected'
     where document_id = '44444444-4444-4444-4444-444444444444';
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'T1 FAILED: an UPDATE on document_revisions was allowed';
  end if;
  raise notice 'T1 ok — document_revisions refuses UPDATE';
end $$;

-- ---------------------------------------------------------------------------
-- T2 — document_revisions is append-only: DELETE is refused.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false;
begin
  begin
    delete from public.document_revisions
     where document_id = '44444444-4444-4444-4444-444444444444';
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'T2 FAILED: a DELETE on document_revisions was allowed';
  end if;
  raise notice 'T2 ok — document_revisions refuses DELETE';
end $$;

-- ---------------------------------------------------------------------------
-- T3 — document_corrections is append-only on both verbs.
-- ---------------------------------------------------------------------------
insert into public.document_corrections (document_id, revision, field_path, before, after)
values ('44444444-4444-4444-4444-444444444444', 2, 'lines[0].BT-129',
        '{"value":10}'::jsonb, '{"value":12}'::jsonb);

do $$
declare upd_refused boolean := false; del_refused boolean := false;
begin
  begin
    update public.document_corrections set field_path = 'tampered'
     where document_id = '44444444-4444-4444-4444-444444444444';
  exception when others then upd_refused := true; end;
  begin
    delete from public.document_corrections
     where document_id = '44444444-4444-4444-4444-444444444444';
  exception when others then del_refused := true; end;
  if not (upd_refused and del_refused) then
    raise exception 'T3 FAILED: document_corrections allowed update=% delete=%',
      not upd_refused, not del_refused;
  end if;
  raise notice 'T3 ok — document_corrections refuses UPDATE and DELETE';
end $$;

-- ---------------------------------------------------------------------------
-- T4 — INSERT still works after the trigger exists (the trigger must not be a
-- blanket refusal). A revision 2 lands beside revision 1.
-- ---------------------------------------------------------------------------
insert into public.document_revisions (document_id, revision, layer1, source)
values ('44444444-4444-4444-4444-444444444444', 2, '{"header":{}}'::jsonb, 'human_corrected');

do $$
declare n integer;
begin
  select count(*) into n from public.document_revisions
   where document_id = '44444444-4444-4444-4444-444444444444';
  if n <> 2 then
    raise exception 'T4 FAILED: expected 2 revisions, found %', n;
  end if;
  raise notice 'T4 ok — appending a revision still works';
end $$;

-- ---------------------------------------------------------------------------
-- T5 — (document_id, revision) is unique: the same revision cannot be written
-- twice, which is what makes "the next revision number" meaningful.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false;
begin
  begin
    insert into public.document_revisions (document_id, revision, layer1, source)
    values ('44444444-4444-4444-4444-444444444444', 2, '{}'::jsonb, 'computed');
  exception when unique_violation then refused := true; end;
  if not refused then
    raise exception 'T5 FAILED: a duplicate (document_id, revision) was accepted';
  end if;
  raise notice 'T5 ok — (document_id, revision) is unique';
end $$;

-- ---------------------------------------------------------------------------
-- T6 — the delivery state CHECK rejects a state that is not in ADR 0103 D1.
-- `PAID` is the deliberate one: ADR 0103 A3 moved payment onto the invoice.
-- ---------------------------------------------------------------------------
do $$
declare refused_paid boolean := false; refused_junk boolean := false;
begin
  begin
    insert into public.deliveries (restaurant_id, state)
    values ('11111111-1111-1111-1111-111111111111', 'PAID');
  exception when check_violation then refused_paid := true; end;
  begin
    insert into public.deliveries (restaurant_id, state)
    values ('11111111-1111-1111-1111-111111111111', 'delivered');
  exception when check_violation then refused_junk := true; end;
  if not (refused_paid and refused_junk) then
    raise exception 'T6 FAILED: state CHECK accepted PAID=% lowercase=%',
      not refused_paid, not refused_junk;
  end if;
  raise notice 'T6 ok — deliveries.state CHECK rejects PAID and a lowercase state';
end $$;

-- ---------------------------------------------------------------------------
-- T7 — provenance, jurisdiction, proposal reason, paid_by and intake_verdict
-- CHECKs all reject an off-vocabulary value.
-- ---------------------------------------------------------------------------
do $$
declare failures text[] := array[]::text[];
begin
  begin
    insert into public.deliveries (restaurant_id, state, provenance)
    values ('11111111-1111-1111-1111-111111111111', 'ORDERED', 'GUESSED');
    failures := failures || 'provenance';
  exception when check_violation then null; end;

  begin
    insert into public.deliveries (restaurant_id, state, jurisdiction)
    values ('11111111-1111-1111-1111-111111111111', 'ORDERED', 'US-NY');
    failures := failures || 'jurisdiction';
  exception when check_violation then null; end;

  begin
    insert into public.delivery_proposals (delivery_id, side, reason)
    values ('66666666-6666-6666-6666-666666666666', 'restaurant', 'JUST_WRONG');
    failures := failures || 'proposal.reason';
  exception when check_violation then null; end;

  begin
    insert into public.delivery_proposals (delivery_id, side, reason)
    values ('66666666-6666-6666-6666-666666666666', 'accountant', 'SHORT_SHIP');
    failures := failures || 'proposal.side';
  exception when check_violation then null; end;

  begin
    update public.procurement_documents set paid_by = 'venmo'
     where id = '44444444-4444-4444-4444-444444444444';
    failures := failures || 'paid_by';
  exception when check_violation then null; end;

  begin
    update public.procurement_documents set intake_verdict = 'looks_fine'
     where id = '44444444-4444-4444-4444-444444444444';
    failures := failures || 'intake_verdict';
  exception when check_violation then null; end;

  if array_length(failures, 1) is not null then
    raise exception 'T7 FAILED: these CHECKs accepted junk: %', failures;
  end if;
  raise notice 'T7 ok — provenance/jurisdiction/reason/side/paid_by/intake_verdict all reject junk';
end $$;

-- ---------------------------------------------------------------------------
-- T8 — the widened doc_type CHECK: every OLD literal still inserts, and each of
-- the five new ones inserts. A narrowing would break existing rows.
-- ---------------------------------------------------------------------------
do $$
declare t text; refused boolean := false;
begin
  foreach t in array array['purchase_order','packing_slip','delivery_receipt','invoice',
                           'credit_memo','statement','unknown',
                           'receiving_advice','price_list','portal_export',
                           'delivery_note','informal_note'] loop
    insert into public.procurement_documents (restaurant_id, doc_type, source_channel)
    values ('11111111-1111-1111-1111-111111111111', t, 'upload');
  end loop;

  begin
    insert into public.procurement_documents (restaurant_id, doc_type, source_channel)
    values ('11111111-1111-1111-1111-111111111111', 'irsaliye', 'upload');
  exception when check_violation then refused := true; end;
  if not refused then
    raise exception 'T8 FAILED: doc_type CHECK accepted an unknown literal';
  end if;
  raise notice 'T8 ok — 12 doc_type literals accepted, an unlisted one refused';
end $$;

-- ---------------------------------------------------------------------------
-- T9 — the join is many-to-many IN BOTH DIRECTIONS (ADR 0104 S5 / 0103 A2):
-- one document on two deliveries (the consolidated weekly invoice) and two
-- documents on one delivery (invoice + credit memo).
-- ---------------------------------------------------------------------------
insert into public.document_deliveries (document_id, delivery_id, role) values
  ('44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666', 'invoice'),
  ('44444444-4444-4444-4444-444444444444', '77777777-7777-7777-7777-777777777777', 'invoice'),
  ('55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666', 'credit_memo');

do $$
declare deliveries_for_doc integer; docs_for_delivery integer; dup_refused boolean := false;
begin
  select count(*) into deliveries_for_doc from public.document_deliveries
   where document_id = '44444444-4444-4444-4444-444444444444';
  select count(*) into docs_for_delivery from public.document_deliveries
   where delivery_id = '66666666-6666-6666-6666-666666666666';
  if deliveries_for_doc <> 2 or docs_for_delivery <> 2 then
    raise exception 'T9 FAILED: doc->deliveries=% delivery->docs=%',
      deliveries_for_doc, docs_for_delivery;
  end if;

  -- and the PK still stops the SAME pair being written twice
  begin
    insert into public.document_deliveries (document_id, delivery_id, role)
    values ('44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666', 'other');
  exception when unique_violation then dup_refused := true; end;
  if not dup_refused then
    raise exception 'T9 FAILED: the same (document, delivery) pair was accepted twice';
  end if;
  raise notice 'T9 ok — many-to-many both ways, pair still unique';
end $$;

-- ---------------------------------------------------------------------------
-- T10 — the dedupe key is PER TENANT (ADR 0104 S2). A duplicate within one
-- restaurant is refused; the SAME key at a sibling restaurant is accepted —
-- that is the sibling-locations case the key exists to keep apart.
-- ---------------------------------------------------------------------------
insert into public.deliveries (restaurant_id, state, dedupe_key)
values ('11111111-1111-1111-1111-111111111111', 'DELIVERED', 'sha256:synthetic-key');

do $$
declare refused boolean := false; siblings integer;
begin
  begin
    insert into public.deliveries (restaurant_id, state, dedupe_key)
    values ('11111111-1111-1111-1111-111111111111', 'DELIVERED', 'sha256:synthetic-key');
  exception when unique_violation then refused := true; end;
  if not refused then
    raise exception 'T10 FAILED: a duplicate (restaurant_id, dedupe_key) was accepted';
  end if;

  insert into public.deliveries (restaurant_id, state, dedupe_key)
  values ('22222222-2222-2222-2222-222222222222', 'DELIVERED', 'sha256:synthetic-key');

  select count(*) into siblings from public.deliveries where dedupe_key = 'sha256:synthetic-key';
  if siblings <> 2 then
    raise exception 'T10 FAILED: expected the same key at 2 restaurants, found %', siblings;
  end if;
  raise notice 'T10 ok — dedupe key collides within a tenant, not across tenants';
end $$;

-- ---------------------------------------------------------------------------
-- T11 — NULL dedupe_key does not collide with itself (the index is partial),
-- because most deliveries have no primary document yet.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  insert into public.deliveries (restaurant_id, state) values
    ('11111111-1111-1111-1111-111111111111', 'ORDERED'),
    ('11111111-1111-1111-1111-111111111111', 'ORDERED');
  select count(*) into n from public.deliveries
   where restaurant_id = '11111111-1111-1111-1111-111111111111' and dedupe_key is null;
  if n < 2 then
    raise exception 'T11 FAILED: NULL dedupe_keys collided (n=%)', n;
  end if;
  raise notice 'T11 ok — NULL dedupe_key rows coexist';
end $$;

-- ---------------------------------------------------------------------------
-- T12 — vendor_terms holds EXACTLY the two seeded platform rows, and the
-- Turkish response-window / invoice-issuance rows are ABSENT (ADR 0103 A8).
-- This asserts an absence on purpose: a 7-day row seeded before a YMM answers
-- would be a legal deadline invented by an agent.
-- ---------------------------------------------------------------------------
do $$
declare platform_rows integer; tr_response integer; ca_days integer; ca_basis text;
begin
  select count(*) into platform_rows from public.vendor_terms
   where restaurant_id is null and provider_id is null;
  select count(*) into tr_response from public.vendor_terms
   where jurisdiction = 'TR' and clock in ('response_window','invoice_issuance');
  select days, basis into ca_days, ca_basis from public.vendor_terms
   where jurisdiction = 'US-CA' and clock = 'payment' and beverage_class = 'alcohol';

  if platform_rows <> 2 then
    raise exception 'T12 FAILED: expected exactly 2 seeded platform rows, found %', platform_rows;
  end if;
  if tr_response <> 0 then
    raise exception 'T12 FAILED: % Turkish response/issuance row(s) were seeded; A8 holds them open', tr_response;
  end if;
  if ca_days <> 30 or ca_basis <> 'delivery_date' then
    raise exception 'T12 FAILED: CA alcohol payment clock is % days basis %', ca_days, ca_basis;
  end if;
  raise notice 'T12 ok — 2 platform rows, CA 30d/delivery_date, no invented TR window';
end $$;

-- ---------------------------------------------------------------------------
-- T13 — one clock per scope: a second platform row for the same
-- (jurisdiction, beverage_class, document_type, clock) is refused even though
-- restaurant_id and provider_id are both NULL. A plain UNIQUE would not catch
-- this, because NULLs never collide in a b-tree unique constraint.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false;
begin
  begin
    insert into public.vendor_terms (jurisdiction, beverage_class, document_type, clock, days, basis)
    values ('US-CA', 'alcohol', 'invoice', 'payment', 45, 'delivery_date');
  exception when unique_violation then refused := true; end;
  if not refused then
    raise exception 'T13 FAILED: two platform rows for the same clock were accepted';
  end if;
  -- a TENANT override of the same clock is a different scope and must be allowed
  insert into public.vendor_terms (restaurant_id, jurisdiction, beverage_class, document_type, clock, days, basis, source)
  values ('11111111-1111-1111-1111-111111111111', 'US-CA', 'alcohol', 'invoice', 'payment',
          21, 'delivery_date', 'SYNTHETIC tenant override');
  raise notice 'T13 ok — one platform row per clock, tenant override allowed beside it';
end $$;

-- ---------------------------------------------------------------------------
-- T14 — the stock columns exist with the right defaults and CHECK, and NOTHING
-- in this slice writes them. `final` is the default because every existing lot
-- predates the door/verification split.
-- ---------------------------------------------------------------------------
do $$
declare d text; refused boolean := false; has_col boolean;
begin
  select column_default into d from information_schema.columns
   where table_name = 'inventory_lots' and column_name = 'cost_state';
  if d is null or d not like '%final%' then
    raise exception 'T14 FAILED: inventory_lots.cost_state default is %', d;
  end if;

  select exists (select 1 from information_schema.columns
                  where table_name = 'inventory_transactions' and column_name = 'delivery_id')
    into has_col;
  if not has_col then
    raise exception 'T14 FAILED: inventory_transactions.delivery_id is missing';
  end if;

  -- The CHECK itself, asserted by definition rather than by inserting a lot:
  -- inventory_lots requires a master_wine_id and this file must not fabricate a
  -- wine to prove a constraint that pg_constraint states exactly.
  if not exists (
    select 1 from pg_constraint
     where conname = 'inventory_lots_cost_state_check'
       and pg_get_constraintdef(oid) like '%provisional%'
       and pg_get_constraintdef(oid) like '%final%') then
    raise exception 'T14 FAILED: inventory_lots_cost_state_check is missing or does not name both states';
  end if;
  raise notice 'T14 ok — cost_state defaults to final with a two-value CHECK, delivery_id exists';
end $$;

-- ---------------------------------------------------------------------------
-- T15 — RLS is on for every new table. A table arrives locked or it does not
-- arrive (the OD-73 house rule).
-- ---------------------------------------------------------------------------
do $$
declare t text; unlocked text[] := array[]::text[]; policyless text[] := array[]::text[];
begin
  foreach t in array array['deliveries','document_deliveries','delivery_proposals',
                           'vendor_terms','document_revisions','document_corrections'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      unlocked := unlocked || t;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      policyless := policyless || t;
    end if;
  end loop;
  if array_length(unlocked, 1) is not null then
    raise exception 'T15 FAILED: RLS off on %', unlocked;
  end if;
  if array_length(policyless, 1) is not null then
    raise exception 'T15 FAILED: RLS enabled with no policy on % (closed only by absence)', policyless;
  end if;
  raise notice 'T15 ok — RLS enabled with a service_role policy on all six new tables';
end $$;

rollback;
