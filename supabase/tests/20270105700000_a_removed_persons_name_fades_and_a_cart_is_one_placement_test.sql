-- F-704: a removed person's name and position outlived the five-year purge in
-- the removal's audit row. Migration
-- a_removed_persons_name_fades_and_a_cart_is_one_placement gives the nightly
-- job forget_expired_removal_names(), which keeps the event and replaces the
-- name with 'Former staff member'. F-731: the same migration adds
-- procurement_orders.placement_id, the cart id the first-to-vendor rule reads.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration and PASS with it. One transaction, rolled
-- back. All fixtures are SYNTHETIC, keyed by fixed uuids.

begin;

insert into public.restaurants (id, name, slug)
values ('7b000000-0000-4000-8000-000000000001', 'SYNTHETIC Audit House', 'f704-audit-test-house');
-- Someone still on the roster, whose old removal row must not be touched.
insert into public.team_members (id, restaurant_id, display_name, position)
values ('7b000000-0000-4000-8000-0000000000b1', '7b000000-0000-4000-8000-000000000001', 'SYNTHETIC Still Here', 'Bar');

insert into public.system_audit_log
  (id, actor_type, actor_id, action, entity_type, entity_id, changes, restaurant_id, created_at)
values
  -- R1: removed six years ago: name and position go, the rest stays.
  ('7b000000-0000-4000-8000-0000000000e1', 'user', '7b000000-0000-4000-8000-0000000000f1',
   'team_member_removed', 'team_member', '7b000000-0000-4000-8000-0000000000a1',
   '{"display_name":"SYNTHETIC Ayse Gone","position":"Sommelier","user_id":null,"access_role":{"from":"staff","to":null},"self_leave":false}',
   '7b000000-0000-4000-8000-000000000001', now() - interval '6 years'),
  -- R2: removed a year ago: kept as it is.
  ('7b000000-0000-4000-8000-0000000000e2', 'user', '7b000000-0000-4000-8000-0000000000f1',
   'team_member_removed', 'team_member', '7b000000-0000-4000-8000-0000000000a2',
   '{"display_name":"SYNTHETIC Recent Leaver","position":"Server"}',
   '7b000000-0000-4000-8000-000000000001', now() - interval '1 year'),
  -- R3: an old removal row whose id is on the roster again: kept.
  ('7b000000-0000-4000-8000-0000000000e3', 'user', '7b000000-0000-4000-8000-0000000000f1',
   'team_member_removed', 'team_member', '7b000000-0000-4000-8000-0000000000b1',
   '{"display_name":"SYNTHETIC Still Here","position":"Bar"}',
   '7b000000-0000-4000-8000-000000000001', now() - interval '6 years'),
  -- R4: another kind of old row naming someone: not this rule's row.
  ('7b000000-0000-4000-8000-0000000000e4', 'user', '7b000000-0000-4000-8000-0000000000f1',
   'member_role_changed', 'team_member', '7b000000-0000-4000-8000-0000000000a1',
   '{"display_name":"SYNTHETIC Ayse Gone","position":"Sommelier"}',
   '7b000000-0000-4000-8000-000000000001', now() - interval '6 years');

-- T1 the old removal row is rewritten, and only it.
do $$
declare
  n bigint;
  c jsonb;
begin
  select names_forgotten into n from public.forget_expired_removal_names();
  if n <> 1 then
    raise exception 'T1 FAIL expected 1 row rewritten, got %', n;
  end if;
  select changes into c from public.system_audit_log
   where id = '7b000000-0000-4000-8000-0000000000e1';
  if c->>'display_name' is distinct from 'Former staff member' then
    raise exception 'T1 FAIL name not replaced: %', c;
  end if;
  if c->'position' is distinct from 'null'::jsonb then
    raise exception 'T1 FAIL position not cleared: %', c;
  end if;
  if c->'access_role' is distinct from '{"from":"staff","to":null}'::jsonb
     or c->>'self_leave' is distinct from 'false' then
    raise exception 'T1 FAIL the event lost its other keys: %', c;
  end if;
end $$;

-- T2 the event row is kept, with who acted.
do $$
begin
  if not exists (
    select 1 from public.system_audit_log
     where id = '7b000000-0000-4000-8000-0000000000e1'
       and action = 'team_member_removed'
       and actor_id = '7b000000-0000-4000-8000-0000000000f1') then
    raise exception 'T2 FAIL the removal event or its actor is gone';
  end if;
end $$;

-- T3 a recent removal, a roster id and another action keep their names.
do $$
begin
  if (select changes->>'display_name' from public.system_audit_log
       where id = '7b000000-0000-4000-8000-0000000000e2') <> 'SYNTHETIC Recent Leaver' then
    raise exception 'T3 FAIL a removal inside five years lost its name';
  end if;
  if (select changes->>'display_name' from public.system_audit_log
       where id = '7b000000-0000-4000-8000-0000000000e3') <> 'SYNTHETIC Still Here' then
    raise exception 'T3 FAIL a row about someone on the roster lost its name';
  end if;
  if (select changes->>'display_name' from public.system_audit_log
       where id = '7b000000-0000-4000-8000-0000000000e4') <> 'SYNTHETIC Ayse Gone' then
    raise exception 'T3 FAIL a row of another action was rewritten';
  end if;
end $$;

-- T4 a second run the same night rewrites nothing.
do $$
declare
  n bigint;
begin
  select names_forgotten into n from public.forget_expired_removal_names();
  if n <> 0 then
    raise exception 'T4 FAIL second run rewrote % rows', n;
  end if;
end $$;

-- T5 only the service role may run it.
do $$
begin
  if has_function_privilege('authenticated', 'public.forget_expired_removal_names()', 'execute')
     or has_function_privilege('anon', 'public.forget_expired_removal_names()', 'execute') then
    raise exception 'T5 FAIL a signed-in or anonymous caller may run the purge';
  end if;
end $$;

-- T6 (F-731) an order carries the cart it was placed with.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'procurement_orders'
       and column_name = 'placement_id' and data_type = 'uuid' and is_nullable = 'YES') then
    raise exception 'T6 FAIL procurement_orders.placement_id (uuid, nullable) is missing';
  end if;
end $$;

rollback;
