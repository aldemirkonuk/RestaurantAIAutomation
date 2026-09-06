-- SQL tests for 20260905232000_delivery_agreement_and_timers.sql.
--
-- HOW TO RUN. Plain psql assertions against a throwaway Postgres built from
-- supabase/migrations in filename order (recipe: pgvector/pgvector:pg17 +
-- postgresql-17-postgis-3, the Supabase roles and schemas, pgcrypto/uuid-ossp in
-- `extensions`, pg_trgm/btree_gist/vector/postgis in `public`, an `auth.users`
-- stub, the PostGIS revokes). Then:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20260905232000_delivery_agreement_and_timers_test.sql
--
-- Every assertion RAISEs on failure. The whole file runs in one transaction that
-- is ROLLED BACK. NEVER run it against production. All fixtures are SYNTHETIC.

begin;

insert into public.restaurants (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'SYNTHETIC Meyhane A', 'synthetic-a');

insert into public.providers (id, name, primary_contact, is_custom)
values ('33333333-3333-3333-3333-333333333333', 'SYNTHETIC Distributor',
        '{"email":"ops@example.invalid"}'::jsonb, true);

insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, source_channel)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'invoice', 'email'),
       ('45454545-4545-4545-4545-454545454545', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'receiving_advice', 'manual');

insert into public.deliveries (id, restaurant_id, provider_id, state)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'DELIVERED');

-- ---------------------------------------------------------------------------
-- T20 — the D1 state CHECK, on the states this stop's doors actually write.
--       Slice 1's T6 proved PAID and a lowercase literal are refused; this one
--       proves every state the agree / verify / lapse doors move THROUGH is
--       accepted, so a door cannot be written against a literal the column
--       would reject at runtime and CI would never see.
-- ---------------------------------------------------------------------------
do $$
declare s text; refused boolean;
begin
  foreach s in array array['ORDERED','ACKNOWLEDGED','IN_TRANSIT','DELIVERED',
                           'RECONCILING','AGREED','VERIFIED','INVOICE_FILED',
                           'LAPSED','LAPSED_AMENDED','CANCELLED','REJECTED']
  loop
    update public.deliveries set state = s
     where id = '66666666-6666-6666-6666-666666666666';
  end loop;

  refused := false;
  begin
    update public.deliveries set state = 'AGREED_PENDING'
     where id = '66666666-6666-6666-6666-666666666666';
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'T20 FAILED: deliveries.state accepted a literal outside ADR 0103 D1';
  end if;
  update public.deliveries set state = 'DELIVERED'
   where id = '66666666-6666-6666-6666-666666666666';
  raise notice 'T20 ok — all 12 D1 states accepted, an invented one refused';
end;
$$;

-- ---------------------------------------------------------------------------
-- T21 — agreed_rule names WHICH D3 rule fired, and refuses anything else.
--       "We agreed" with no rule named is unauditable; a third literal would be
--       a rule nobody wrote.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false;
begin
  update public.deliveries set agreed_rule = 'both_sides_recorded'
   where id = '66666666-6666-6666-6666-666666666666';
  update public.deliveries set agreed_rule = 'signed_ticket_is_final'
   where id = '66666666-6666-6666-6666-666666666666';
  begin
    update public.deliveries set agreed_rule = 'assumed'
     where id = '66666666-6666-6666-6666-666666666666';
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'T21 FAILED: agreed_rule accepted a rule that does not exist';
  end if;
  update public.deliveries set agreed_rule = null
   where id = '66666666-6666-6666-6666-666666666666';
  raise notice 'T21 ok — agreed_rule holds exactly the two D3 rules';
end;
$$;

-- ---------------------------------------------------------------------------
-- T22 — a counter points at the proposal it answers, and the thread survives
--       the answered proposal being unlinked (ON DELETE SET NULL, never CASCADE:
--       a vendor's counter is evidence in its own right).
-- ---------------------------------------------------------------------------
insert into public.delivery_proposals
  (id, delivery_id, side, reason, qty_proposed, money_at_risk, note, status)
values ('77777777-0000-0000-0000-000000000001',
        '66666666-6666-6666-6666-666666666666', 'restaurant', 'SHORT_SHIP',
        10, 284.00, 'we counted ten of twelve', 'open');

insert into public.delivery_proposals
  (id, delivery_id, side, reason, money_at_risk, note, counters_proposal_id, status)
values ('77777777-0000-0000-0000-000000000002',
        '66666666-6666-6666-6666-666666666666', 'vendor', 'SHORT_SHIP',
        142.00, 'credit of 142,00 issued', '77777777-0000-0000-0000-000000000001', 'open');

do $$
declare linked uuid;
begin
  select counters_proposal_id into linked from public.delivery_proposals
   where id = '77777777-0000-0000-0000-000000000002';
  if linked is distinct from '77777777-0000-0000-0000-000000000001' then
    raise exception 'T22 FAILED: the counter does not point at the proposal it answers';
  end if;
  raise notice 'T22 ok — a counter names the proposal it answers';
end;
$$;

-- ---------------------------------------------------------------------------
-- T23 — ONE timer per (delivery, document, clock), and a delivery-level clock
--       (document_id NULL) does not collide with itself. The poller's
--       idempotency rests on this index: without it a catch-up run after a
--       missed tick would write a second timer and notify twice.
-- ---------------------------------------------------------------------------
insert into public.delivery_timers (restaurant_id, delivery_id, clock, basis, due_at)
values ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
        'door_correction', 'delivery_date', now() + interval '1 day');

do $$
declare refused boolean := false;
begin
  begin
    insert into public.delivery_timers (restaurant_id, delivery_id, clock, basis, due_at)
    values ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
            'door_correction', 'delivery_date', now() + interval '2 day');
  exception when unique_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'T23 FAILED: a second door_correction timer was written for one delivery';
  end if;
  raise notice 'T23 ok — one timer per (delivery, document, clock)';
end;
$$;

-- A document-scoped clock on the SAME delivery is a different timer.
insert into public.delivery_timers (restaurant_id, delivery_id, document_id, clock, basis, due_at)
values ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
        '44444444-4444-4444-4444-444444444444', 'objection_window',
        'document_issue_date', now() + interval '8 day');

-- ---------------------------------------------------------------------------
-- T24 — THE UNKNOWN CLOCK IS A ROW, NOT AN ABSENCE (ADR 0103 D4 / A8).
--       A NULL due_at with state `blocked_unknown` is storable, and the poller's
--       own index does not select it — so it is visible, it asks, and it can
--       never fire. An absent row would have rendered as "no deadline".
-- ---------------------------------------------------------------------------
insert into public.delivery_timers
  (restaurant_id, delivery_id, document_id, clock, basis, basis_at, due_at, state)
values ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
        '45454545-4545-4545-4545-454545454545', 'response_window',
        'unknown', null, null, 'blocked_unknown');

do $$
declare n integer; due integer;
begin
  select count(*) into n from public.delivery_timers
   where delivery_id = '66666666-6666-6666-6666-666666666666'
     and state = 'blocked_unknown';
  if n <> 1 then
    raise exception 'T24 FAILED: expected 1 blocked_unknown timer, found %', n;
  end if;

  -- What the poller sees: the due-at query never returns the blocked one.
  select count(*) into due from public.delivery_timers
   where state in ('open','notified_half','escalated')
     and due_at is not null
     and delivery_id = '66666666-6666-6666-6666-666666666666';
  if due <> 2 then
    raise exception 'T24 FAILED: the poller''s query returned % timers, expected 2', due;
  end if;
  raise notice 'T24 ok — an unknown clock is a visible row the poller never fires';
end;
$$;

-- ---------------------------------------------------------------------------
-- T25 — the timer state vocabulary is closed, and RLS is on with a service_role
--       policy. A table arrives locked down or it does not arrive.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false; rls boolean; pol integer;
begin
  begin
    insert into public.delivery_timers (restaurant_id, delivery_id, clock, basis, state)
    values ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
            'payment', 'delivery_date', 'snoozed');
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'T25 FAILED: delivery_timers.state accepted an invented rung';
  end if;

  select relrowsecurity into rls from pg_class
   where oid = 'public.delivery_timers'::regclass;
  if not rls then
    raise exception 'T25 FAILED: RLS is not enabled on delivery_timers';
  end if;
  select count(*) into pol from pg_policies
   where schemaname = 'public' and tablename = 'delivery_timers';
  if pol < 1 then
    raise exception 'T25 FAILED: delivery_timers has no policy';
  end if;
  raise notice 'T25 ok — closed state vocabulary, RLS on with a policy';
end;
$$;

-- ---------------------------------------------------------------------------
-- T26 — the order link is nullable and SET NULL on delete: an UNORDERED
--       delivery is the case ADR 0103 D5 exists for, and deleting an order must
--       never delete the record that goods arrived.
-- ---------------------------------------------------------------------------
do $$
declare nullable text; del text;
begin
  select is_nullable into nullable from information_schema.columns
   where table_schema='public' and table_name='deliveries' and column_name='order_id';
  if nullable is null then
    raise exception 'T26 FAILED: deliveries.order_id does not exist';
  end if;
  if nullable <> 'YES' then
    raise exception 'T26 FAILED: order_id must be nullable — UNORDERED is a real case';
  end if;
  select confdeltype into del from pg_constraint
   where conname = 'deliveries_order_id_fkey';
  if del is distinct from 'n' then
    raise exception 'T26 FAILED: order_id delete behaviour is %, expected SET NULL', coalesce(del,'<none>');
  end if;
  raise notice 'T26 ok — order_id is nullable and SET NULL on delete';
end;
$$;

rollback;
