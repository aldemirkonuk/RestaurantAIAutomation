-- public.inventory_lot_last_known_cost, migration a_sold_out_good_keeps_its_last_cost
-- (r36 recipes audit, gap 1). Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f`
-- on a database built from supabase/migrations. Synthetic fixtures, one
-- transaction, rolled back.
begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('1a570000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;

do $$
declare r record;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Last cost house', 'last-cost-house');
  -- a: sold out; two invoiced deliveries, both used up
  -- b: the newest lot is an estimate with stock; an older invoice is used up
  -- c: the newest lot was costed by hand (final), used up
  -- d: nothing that is a known cost: samples (at 0 and at a price), shadow stock, an invoice at 0, an estimate
  -- e: two lots of one delivery, same moment, different prices
  -- f: the newest invoice is delivered and not yet verified, used up
  for r in select x from unnest(array['a','b','c','d','e','f']) x loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || r.x), 'LC-TEST-' || upper(r.x), 'Last cost wine ' || upper(r.x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || r.x), pg_temp.u('1'), pg_temp.u('1' || r.x), 750, 150);
  end loop;

  insert into public.inventory_lots (id, restaurant_id, inventory_id, master_wine_id, stock_state, qty, unit_cost, cost_provenance, cost_state, received_at, created_at) values
    (pg_temp.u('3a1'), pg_temp.u('1'), pg_temp.u('2a'), pg_temp.u('1a'), 'live', 0, 10.00, 'invoice', 'final', '2026-10-01', '2026-10-01'),
    (pg_temp.u('3a2'), pg_temp.u('1'), pg_temp.u('2a'), pg_temp.u('1a'), 'live', 0, 12.50, 'invoice', 'final', '2026-11-01', '2026-11-01'),
    (pg_temp.u('3b1'), pg_temp.u('1'), pg_temp.u('2b'), pg_temp.u('1b'), 'live', 0, 11.00, 'invoice', 'final', '2026-10-01', '2026-10-01'),
    (pg_temp.u('3b2'), pg_temp.u('1'), pg_temp.u('2b'), pg_temp.u('1b'), 'live', 5, 9.00, 'estimated', 'provisional', '2026-11-01', '2026-11-01'),
    (pg_temp.u('3c1'), pg_temp.u('1'), pg_temp.u('2c'), pg_temp.u('1c'), 'live', 0, 11.00, 'invoice', 'final', '2026-10-01', '2026-10-01'),
    (pg_temp.u('3c2'), pg_temp.u('1'), pg_temp.u('2c'), pg_temp.u('1c'), 'live', 0, 7.00, 'manual', 'final', '2026-11-01', '2026-11-01'),
    (pg_temp.u('3d1'), pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 0, 0.00, 'sample', 'final', '2026-11-01', '2026-11-01'),
    (pg_temp.u('3d2'), pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'shadow', 0, 5.00, 'invoice', 'final', '2026-11-02', '2026-11-02'),
    (pg_temp.u('3d3'), pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 0, 0.00, 'invoice', 'final', '2026-11-03', '2026-11-03'),
    (pg_temp.u('3d4'), pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 0, 6.00, 'estimated', 'provisional', '2026-11-04', '2026-11-04'),
    (pg_temp.u('3d5'), pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 0, 50.00, 'sample', 'final', '2026-11-05', '2026-11-05'),
    (pg_temp.u('3e1'), pg_temp.u('1'), pg_temp.u('2e'), pg_temp.u('1e'), 'live', 0, 30.00, 'invoice', 'final', '2026-11-01', '2026-11-01'),
    (pg_temp.u('3e2'), pg_temp.u('1'), pg_temp.u('2e'), pg_temp.u('1e'), 'live', 0, 20.00, 'invoice', 'final', '2026-11-01', '2026-11-01'),
    (pg_temp.u('3f1'), pg_temp.u('1'), pg_temp.u('2f'), pg_temp.u('1f'), 'live', 0, 11.00, 'invoice', 'final', '2026-10-01', '2026-10-01'),
    (pg_temp.u('3f2'), pg_temp.u('1'), pg_temp.u('2f'), pg_temp.u('1f'), 'live', 0, 15.00, 'invoice', 'provisional', '2026-11-01', '2026-11-01');
end $$;

do $$
declare r record;
begin
  select * into r from public.inventory_lot_last_known_cost where inventory_id = pg_temp.u('2a');
  assert r.last_unit_cost = 12.500000, format('L1 FAIL last_unit_cost=%s, wanted 12.5 (the newest of two used-up invoices)', r.last_unit_cost);
  assert r.last_settled and r.last_from_invoice and r.last_received_at = '2026-11-01'::timestamptz,
    format('L1 FAIL settled=%s invoice=%s at=%s', r.last_settled, r.last_from_invoice, r.last_received_at);
  assert r.restaurant_id = pg_temp.u('1'), 'L1 FAIL restaurant_id';

  select * into r from public.inventory_lot_last_known_cost where inventory_id = pg_temp.u('2b');
  assert r.last_unit_cost = 11.000000, format('L2 FAIL last_unit_cost=%s, wanted 11 (an estimate is never a known cost)', r.last_unit_cost);

  select * into r from public.inventory_lot_last_known_cost where inventory_id = pg_temp.u('2c');
  assert r.last_unit_cost = 7.000000 and r.last_settled and not r.last_from_invoice,
    format('L3 FAIL cost=%s settled=%s invoice=%s, wanted 7 / true / false (a price entered by hand is known)', r.last_unit_cost, r.last_settled, r.last_from_invoice);

  assert not exists (select 1 from public.inventory_lot_last_known_cost where inventory_id = pg_temp.u('2d')),
    'L4 FAIL a sample, shadow stock, an invoice at 0 or an estimate gave a known cost';

  select * into r from public.inventory_lot_last_known_cost where inventory_id = pg_temp.u('2e');
  assert r.last_unit_cost = 20.000000, format('L5 FAIL last_unit_cost=%s, wanted 20 (same moment: the higher id wins, every time)', r.last_unit_cost);

  select * into r from public.inventory_lot_last_known_cost where inventory_id = pg_temp.u('2f');
  assert r.last_unit_cost = 15.000000 and not r.last_settled and r.last_from_invoice,
    format('L6 FAIL cost=%s settled=%s, wanted 15 / false (an invoice not yet verified still prices)', r.last_unit_cost, r.last_settled);

  assert (select count(*) from public.inventory_lot_last_known_cost where restaurant_id = pg_temp.u('1')) = 5,
    'L7 FAIL one row per good with a known cost';
  assert (select reloptions::text from pg_class where oid = 'public.inventory_lot_last_known_cost'::regclass) like '%security_invoker=true%',
    'L8 FAIL view is not security_invoker';
  assert not has_table_privilege('anon', 'public.inventory_lot_last_known_cost', 'select'), 'L9 FAIL anon can read the view';
  assert not has_table_privilege('authenticated', 'public.inventory_lot_last_known_cost', 'select'), 'L9 FAIL authenticated can read the view';
  raise notice 'PASS last-known-cost L1-L9';
end $$;

rollback;
