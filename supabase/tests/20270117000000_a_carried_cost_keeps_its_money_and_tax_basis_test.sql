-- F-1653 / F-1655 (sim 54): migration a_carried_cost_keeps_its_money_and_tax_basis.
--   F-1653: a take-off writes each lot's money (and tax basis) into
--           lots_taken, so the month close never adds a EUR cost into lira.
--   F-1655: a bottle that comes back carries its cost's money and tax basis,
--           from the live lots or from the lot it was taken off; live lots in
--           two moneys carry no average; transfer_stock's split copy keeps both.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1, T2, T3, T4 and T5 FAIL. One transaction, rolled back. All
-- fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()),
  ('wa', gen_random_uuid()), ('wb', gen_random_uuid()), ('wc', gen_random_uuid()),
  ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('c', gen_random_uuid()),
  ('cellar', gen_random_uuid()), ('bar', gen_random_uuid());

insert into public.restaurants (id, name, slug, currency)
select v, 'SYNTHETIC carried-cost house', 'syn-carry-' || left(replace(v::text, '-', ''), 16), 'TRY'
  from t_fx where k = 'house';

-- One wine per item: a house holds a wine once.
insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-CC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Okuzgozu ' || k, 'red'
  from t_fx where k in ('wa', 'wb', 'wc');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = i), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'w' || i), 750, 150
  from (values ('a'), ('b'), ('c')) as x(i);

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = l), (select v from t_fx where k = 'house'), z, 100
  from (values ('cellar', 'Cellar'), ('bar', 'Bar')) as x(l, z);

-- a: 6 bottles from a EUR invoice, pre-tax. b: 3 in EUR and 3 in TRY.
-- c: 4 bottles from a EUR invoice, pre-tax, in the Cellar.
insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state,
                                   qty, received_at, unit_cost, cost_provenance, cost_state,
                                   unit_cost_currency, unit_cost_tax_basis)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = i),
       (select v from t_fx where k = 'w' || i), (select v from t_fx where k = 'cellar'), 'live',
       q, now() - d, c, 'invoice', 'final', cur, tax
  from (values ('a', 6, interval '9 days', 20.00, 'EUR', 'excludes_tax'),
               ('b', 3, interval '9 days', 20.00, 'EUR', 'excludes_tax'),
               ('b', 3, interval '3 days', 600.00, 'TRY', 'includes_tax'),
               ('c', 4, interval '9 days', 25.00, 'EUR', 'excludes_tax')) as x(i, q, d, c, cur, tax);

-- T1 (F-1653) a breakage writes the lot's money and tax basis into lots_taken.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'a');
  v_txn uuid;
  taken jsonb;
begin
  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'waste', p_source => 'manual', p_reason => 'SYNTHETIC breakage',
    p_idempotency_key => 'syn-carry-t1-' || v_item::text);
  select metadata->'lots_taken' into taken from public.inventory_transactions where id = v_txn;
  assert jsonb_array_length(taken) = 1
         and taken->0->>'unit_cost_currency' = 'EUR'
         and taken->0->>'unit_cost_tax_basis' = 'excludes_tax',
    format('T1 FAIL lots_taken is %s, expected the lot''s EUR and excludes_tax', taken);
end $$;

-- T2 (F-1655) a count that finds one more carries the live lots' cost with
-- their money and tax basis.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'a');
  l record;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 1,
    p_transaction_type => 'reconciliation', p_source => 'manual', p_reason => 'SYNTHETIC count over',
    p_idempotency_key => 'syn-carry-t2-' || v_item::text);
  select unit_cost, unit_cost_currency, unit_cost_tax_basis into l
    from public.inventory_lots where inventory_id = v_item and qty = 1;
  assert l.unit_cost = 20.00,
    format('T2 FAIL the returned bottle carries %s, expected 20.00', l.unit_cost);
  assert l.unit_cost_currency = 'EUR' and l.unit_cost_tax_basis = 'excludes_tax',
    format('T2 FAIL the returned bottle states %s / %s, expected EUR / excludes_tax',
           l.unit_cost_currency, l.unit_cost_tax_basis);
end $$;

-- T3 (F-1653) live lots in two moneys have no average: the bottle comes back
-- uncosted, never at a sum of euros and lira.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'b');
  l record;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 1,
    p_transaction_type => 'reconciliation', p_source => 'manual', p_reason => 'SYNTHETIC count over',
    p_idempotency_key => 'syn-carry-t3-' || v_item::text);
  select unit_cost, unit_cost_currency into l
    from public.inventory_lots where inventory_id = v_item and qty = 1;
  assert l.unit_cost is null,
    format('T3 FAIL the returned bottle carries %s %s, averaged over EUR and TRY lots',
           l.unit_cost, l.unit_cost_currency);
end $$;

-- T4 (F-1655) every bottle gone, one comes back: it carries the taken lot's
-- cost with that lot's money and tax basis.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'c');
  l record;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => -4,
    p_transaction_type => 'waste', p_source => 'manual', p_reason => 'SYNTHETIC breakage',
    p_idempotency_key => 'syn-carry-t4a-' || v_item::text);
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 2,
    p_transaction_type => 'correction', p_source => 'manual', p_reason => 'SYNTHETIC entered wrong',
    p_idempotency_key => 'syn-carry-t4b-' || v_item::text);
  select unit_cost, unit_cost_currency, unit_cost_tax_basis into l
    from public.inventory_lots where inventory_id = v_item and qty = 2;
  assert l.unit_cost = 25.00 and l.unit_cost_currency = 'EUR' and l.unit_cost_tax_basis = 'excludes_tax',
    format('T4 FAIL the returned bottles carry %s %s / %s, expected 25.00 EUR / excludes_tax',
           l.unit_cost, l.unit_cost_currency, l.unit_cost_tax_basis);
end $$;

-- T5 (F-1655) moving part of a lot keeps the copy's money and tax basis.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'a');
  l record;
begin
  perform public.transfer_stock(v_item, (select v from t_fx where k = 'cellar'),
                                (select v from t_fx where k = 'bar'), 2, null, 'SYNTHETIC to the bar');
  select unit_cost, unit_cost_currency, unit_cost_tax_basis into l
    from public.inventory_lots
   where inventory_id = v_item and location_id = (select v from t_fx where k = 'bar') and qty = 2;
  assert l.unit_cost = 20.00 and l.unit_cost_currency = 'EUR' and l.unit_cost_tax_basis = 'excludes_tax',
    format('T5 FAIL the moved bottles state %s %s / %s, expected 20.00 EUR / excludes_tax',
           l.unit_cost, l.unit_cost_currency, l.unit_cost_tax_basis);
end $$;

rollback;
