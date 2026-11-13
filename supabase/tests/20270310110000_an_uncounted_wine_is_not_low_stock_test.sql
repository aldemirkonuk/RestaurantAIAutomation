-- OD-161 (rule half): migration an_uncounted_wine_is_not_low_stock makes
-- v_low_stock_items keep only rows that have been counted at least once.
--
-- Self-asserting: every block raises on a failure, so
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run it on a database
-- built from supabase/migrations. It must FAIL on a build without that
-- migration (T1: the never-counted row is in the view) and PASS with it.
-- One transaction, rolled back. All fixtures are SYNTHETIC. NEVER run it
-- against production.

begin;

insert into public.restaurants (id, name, slug)
values ('0d161000-0000-4000-8000-000000000001', 'SYNTHETIC OD-161 house', 'synthetic-od161');

insert into public.master_wine_library (id, wine_id, name, primary_type) values
  ('0d161000-0000-4000-8000-0000000000b1', 'SYN-OD161-1', 'SYNTHETIC Never Counted Red', 'red'),
  ('0d161000-0000-4000-8000-0000000000b2', 'SYN-OD161-2', 'SYNTHETIC Counted Empty White', 'white'),
  ('0d161000-0000-4000-8000-0000000000b3', 'SYN-OD161-3', 'SYNTHETIC Counted At Par Red', 'red');

-- c1: what menu linking writes today: no stock (default 0), no count, the
--     house's default par (3).
-- c2: the same wine shape, counted, and the count said 0.
-- c3: counted, at par (threshold 0, stock 0 is not below it).
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, threshold_min, last_counted_at) values
  ('0d161000-0000-4000-8000-0000000000c1', '0d161000-0000-4000-8000-000000000001', '0d161000-0000-4000-8000-0000000000b1', 3, null),
  ('0d161000-0000-4000-8000-0000000000c2', '0d161000-0000-4000-8000-000000000001', '0d161000-0000-4000-8000-0000000000b2', 3, now()),
  ('0d161000-0000-4000-8000-0000000000c3', '0d161000-0000-4000-8000-000000000001', '0d161000-0000-4000-8000-0000000000b3', 0, now());

-- T0 the fixture is what it claims: every row reads stock_live = 0.
do $$
declare n integer;
begin
  select count(*) into n from public.restaurant_inventory
   where restaurant_id = '0d161000-0000-4000-8000-000000000001' and stock_live = 0;
  assert n = 3, format('T0 FAIL expected 3 rows at stock_live = 0, found %s', n);
end $$;

-- T1 a wine nobody counted is not low stock.
do $$
declare n integer;
begin
  select count(*) into n from public.v_low_stock_items
   where id = '0d161000-0000-4000-8000-0000000000c1';
  assert n = 0, 'T1 FAIL a never-counted row at stock_live = 0 is in v_low_stock_items';
end $$;

-- T2 a wine counted at 0 below its par is still low stock.
do $$
declare n integer;
begin
  select count(*) into n from public.v_low_stock_items
   where id = '0d161000-0000-4000-8000-0000000000c2';
  assert n = 1, 'T2 FAIL a counted row at 0 below par is missing from v_low_stock_items';
end $$;

-- T3 a counted wine at par is not low stock.
do $$
declare n integer;
begin
  select count(*) into n from public.v_low_stock_items
   where id = '0d161000-0000-4000-8000-0000000000c3';
  assert n = 0, 'T3 FAIL a counted row at par is in v_low_stock_items';
end $$;

-- T4 the view still runs as the caller (od72_revoke_client_grants).
do $$
begin
  assert exists (
    select 1 from pg_class
     where oid = 'public.v_low_stock_items'::regclass
       and 'security_invoker=true' = any (reloptions)
  ), 'T4 FAIL v_low_stock_items lost security_invoker';
end $$;

-- T5 anon and authenticated still cannot read it (od72_revoke_client_grants).
do $$
begin
  assert not has_table_privilege('anon', 'public.v_low_stock_items', 'SELECT'),
    'T5 FAIL anon can read v_low_stock_items';
  assert not has_table_privilege('authenticated', 'public.v_low_stock_items', 'SELECT'),
    'T5 FAIL authenticated can read v_low_stock_items';
end $$;

rollback;
