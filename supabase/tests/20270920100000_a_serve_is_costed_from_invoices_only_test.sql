-- public.inventory_lot_invoice_cost, migration a_serve_is_costed_from_invoices_only
-- (r28 recipes audit, gap 3). Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f`
-- on a database built from supabase/migrations. Synthetic fixtures, one
-- transaction, rolled back.
begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('ae510000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;

do $$
declare r record;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Invoice cost house', 'invoice-cost-house');
  -- a: the audit's case, 10 invoiced at 100 + 90 estimated at 60
  -- b: invoiced, part settled and part not yet verified
  -- c: invoiced at 0 beside invoiced at 30
  -- d: samples, shadow, empty and hand-entered lots around one invoice
  -- e: invoiced at 0 only
  -- f: a fractional average (six places kept)
  for r in select x from unnest(array['a','b','c','d','e','f']) x loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || r.x), 'IC-TEST-' || upper(r.x), 'Invoice cost wine ' || upper(r.x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || r.x), pg_temp.u('1'), pg_temp.u('1' || r.x), 750, 150);
  end loop;

  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, unit_cost, cost_provenance, cost_state) values
    (pg_temp.u('1'), pg_temp.u('2a'), pg_temp.u('1a'), 'live', 10, 100.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2a'), pg_temp.u('1a'), 'live', 90, 60.00, 'estimated', 'provisional'),
    (pg_temp.u('1'), pg_temp.u('2b'), pg_temp.u('1b'), 'live', 4, 10.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2b'), pg_temp.u('1b'), 'live', 2, 13.00, 'invoice', 'provisional'),
    (pg_temp.u('1'), pg_temp.u('2c'), pg_temp.u('1c'), 'live', 5, 0.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2c'), pg_temp.u('1c'), 'live', 5, 30.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 3, 20.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 2, 0.00, 'sample', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'shadow', 7, 5.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 0, 99.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2d'), pg_temp.u('1d'), 'live', 1, 40.00, 'manual', 'final'),
    (pg_temp.u('1'), pg_temp.u('2e'), pg_temp.u('1e'), 'live', 4, 0.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2f'), pg_temp.u('1f'), 'live', 1, 10.00, 'invoice', 'final'),
    (pg_temp.u('1'), pg_temp.u('2f'), pg_temp.u('1f'), 'live', 2, 10.01, 'invoice', 'final');
end $$;

do $$
declare r record;
begin
  select * into r from public.inventory_lot_invoice_cost where inventory_id = pg_temp.u('2a');
  assert r.invoice_wac = 100.000000, format('I1 FAIL invoice_wac=%s, wanted 100 (the estimate at 60 must not blend in)', r.invoice_wac);
  assert r.invoice_qty = 10 and r.stock_qty = 100 and r.settled_qty = 10,
    format('I1 FAIL invoice_qty=%s stock_qty=%s settled_qty=%s, wanted 10 / 100 / 10', r.invoice_qty, r.stock_qty, r.settled_qty);

  select * into r from public.inventory_lot_invoice_cost where inventory_id = pg_temp.u('2b');
  assert r.invoice_wac = 11.000000, format('I2 FAIL invoice_wac=%s, wanted 11 ((4x10 + 2x13) / 6)', r.invoice_wac);
  assert r.invoice_qty = 6 and r.stock_qty = 6 and r.settled_qty = 4,
    format('I2 FAIL invoice_qty=%s stock_qty=%s settled_qty=%s, wanted 6 / 6 / 4', r.invoice_qty, r.stock_qty, r.settled_qty);

  select * into r from public.inventory_lot_invoice_cost where inventory_id = pg_temp.u('2c');
  assert r.invoice_wac = 30.000000, format('I3 FAIL invoice_wac=%s, wanted 30 (a 0 invoice is no price)', r.invoice_wac);
  assert r.invoice_qty = 5 and r.stock_qty = 10,
    format('I3 FAIL invoice_qty=%s stock_qty=%s, wanted 5 / 10', r.invoice_qty, r.stock_qty);

  select * into r from public.inventory_lot_invoice_cost where inventory_id = pg_temp.u('2d');
  assert r.invoice_wac = 20.000000 and r.invoice_qty = 3 and r.stock_qty = 4,
    format('I4 FAIL wac=%s invoice_qty=%s stock_qty=%s, wanted 20 / 3 / 4 (samples, shadow and empty lots out; the hand-entered unit is stock, not invoice)',
      r.invoice_wac, r.invoice_qty, r.stock_qty);

  select * into r from public.inventory_lot_invoice_cost where inventory_id = pg_temp.u('2e');
  assert r.invoice_wac is null and r.invoice_qty = 0 and r.stock_qty = 4,
    format('I5 FAIL wac=%s invoice_qty=%s stock_qty=%s, wanted null / 0 / 4', r.invoice_wac, r.invoice_qty, r.stock_qty);

  select * into r from public.inventory_lot_invoice_cost where inventory_id = pg_temp.u('2f');
  assert r.invoice_wac = 10.006667, format('I8 FAIL invoice_wac=%s, wanted 10.006667 (six places kept)', r.invoice_wac);

  assert (select reloptions::text from pg_class where oid = 'public.inventory_lot_invoice_cost'::regclass) like '%security_invoker=true%',
    'I6 FAIL view is not security_invoker';
  assert not has_table_privilege('anon', 'public.inventory_lot_invoice_cost', 'select'), 'I7 FAIL anon can read the view';
  assert not has_table_privilege('authenticated', 'public.inventory_lot_invoice_cost', 'select'), 'I7 FAIL authenticated can read the view';
  raise notice 'PASS invoice-cost I1-I8';
end $$;

rollback;
