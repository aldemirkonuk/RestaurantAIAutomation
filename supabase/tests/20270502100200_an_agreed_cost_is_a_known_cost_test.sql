-- public.inventory_lot_agreed_cost, migration an_agreed_cost_is_a_known_cost
-- (QA round 15 finding 2). Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f`
-- on a database built from supabase/migrations. Synthetic fixtures, one
-- transaction, rolled back. unit_cost is numeric(10,2) on this branch, so the
-- six-place proof is a weighted average (10.00 x1 + 10.01 x2 = 10.006667), not
-- a stored six-place price.
begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('ae500000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;

do $$
declare r record;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Agreed cost house', 'agreed-cost-house');
  -- items a (agreed manual + provisional), b (fractional), c (sample only), d (mixed exclusions)
  for r in select x from unnest(array['a','b','c','d']) x loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || r.x), 'AC-TEST-' || upper(r.x), 'Agreed cost wine ' || upper(r.x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || r.x), pg_temp.u('1'), pg_temp.u('1' || r.x), 750, 150);
  end loop;

  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, unit_cost, cost_provenance, cost_state) values
    (pg_temp.u('1'), pg_temp.u('2a'), pg_temp.u('1a'), 'live', 6, 20.00, 'manual', 'final'),
    (pg_temp.u('1'), pg_temp.u('2a'), pg_temp.u('1a'), 'live', 6, 99.00, 'estimated', 'provisional'),
    (pg_temp.u('1'), pg_temp.u('2b'), pg_temp.u('1b'), 'live', 1, 10.00, 'manual', 'final'),
    (pg_temp.u('1'), pg_temp.u('2b'), pg_temp.u('1b'), 'live', 2, 10.01, 'manual', 'final'),
    (pg_temp.u('1'), pg_temp.u('2c'), pg_temp.u('1c'), 'live', 3, 0.00, 'sample', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 4, 30.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 2, 1.00, 'sample', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 5, null, 'manual', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'shadow', 7, 5.00, 'manual', 'final');
end $$;

do $$
declare r record;
begin
  select * into r from public.inventory_lot_agreed_cost where inventory_id = pg_temp.u('2a');
  assert r.agreed_wac = 20.000000, format('A1 FAIL agreed_wac=%s, wanted 20.000000 (provisional 99 must not blend in)', r.agreed_wac);
  assert r.agreed_qty = 6, format('A1 FAIL agreed_qty=%s, wanted 6', r.agreed_qty);
  assert r.has_agreed_cost, 'A1 FAIL has_agreed_cost not true';

  select * into r from public.inventory_lot_agreed_cost where inventory_id = pg_temp.u('2b');
  assert r.agreed_wac = 10.006667, format('A2 FAIL agreed_wac=%s, wanted 10.006667 (six places kept)', r.agreed_wac);
  assert r.agreed_qty = 3, format('A2 FAIL agreed_qty=%s, wanted 3', r.agreed_qty);

  assert not exists (select 1 from public.inventory_lot_agreed_cost where inventory_id = pg_temp.u('2c')),
    'A3 FAIL a sample-only item has an agreed cost';

  select * into r from public.inventory_lot_agreed_cost where inventory_id = pg_temp.u('2d');
  assert r.agreed_wac = 30.000000 and r.agreed_qty = 4,
    format('A4 FAIL sample/null-cost/shadow lots leaked in: wac=%s qty=%s, wanted 30 / 4', r.agreed_wac, r.agreed_qty);

  assert (select reloptions::text from pg_class where oid = 'public.inventory_lot_agreed_cost'::regclass) like '%security_invoker=true%',
    'A5 FAIL view is not security_invoker';
  assert not has_table_privilege('anon', 'public.inventory_lot_agreed_cost', 'select'), 'A6 FAIL anon can read the view';
  raise notice 'agreed-cost A1-A6 PASS';
end $$;

rollback;
