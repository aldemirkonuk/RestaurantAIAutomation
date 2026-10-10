-- F-644 / F-646 b (sim wave 21, 2026-10-09): a bottle that comes back onto the
-- books (a voided sale, a count that finds more) used to come back with no
-- cost and no place, and a take-off that named a place drained the oldest lot
-- anywhere. Migration a_returned_bottle_keeps_its_cost fixes both inside
-- apply_stock_movement.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a build
-- without that migration (T2: the voided bottle has no cost) and PASS with it.
-- One transaction, rolled back. All fixtures are SYNTHETIC, keyed by fresh
-- uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()),
  ('cellar', gen_random_uuid()), ('bar', gen_random_uuid()),
  ('void', gen_random_uuid()), ('count', gen_random_uuid()), ('avg', gen_random_uuid()),
  ('never', gen_random_uuid()), ('buy', gen_random_uuid()), ('place', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC returned-bottle house', 'syn-retcost-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- One wine per item (an item is unique per house and wine); each wine's id is
-- its item's id, so the fixtures stay one row per key.
insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-RC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Yakut ' || k, 'red'
  from t_fx where k in ('void', 'count', 'avg', 'never', 'buy', 'place');

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select v, (select v from t_fx where k = 'house'), initcap(k), 100
  from t_fx where k in ('cellar', 'bar');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select v, (select v from t_fx where k = 'house'), v, 750, 150
  from t_fx where k in ('void', 'count', 'avg', 'never', 'buy', 'place');

create function pg_temp.fx(text) returns uuid language sql as $$ select v from t_fx where k = $1 $$;
create function pg_temp.mv(p_item text, p_delta int, p_type text, p_key text,
                           p_cost numeric default null, p_prov text default null,
                           p_loc text default null) returns uuid language sql as $$
  select public.apply_stock_movement(
    p_inventory_id => pg_temp.fx(p_item), p_stock_state => 'live', p_delta => p_delta,
    p_transaction_type => p_type, p_source => case when p_type in ('sale','return') then 'pos' else 'manual' end,
    p_unit_cost => p_cost, p_cost_provenance => p_prov,
    p_location_id => case when p_loc is null then null else pg_temp.fx(p_loc) end,
    p_idempotency_key => 'retcost-' || p_key || '-' || pg_temp.fx(p_item)::text,
    p_restaurant_id => pg_temp.fx('house'))
$$;

-- T1 still exactly one apply_stock_movement.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'apply_stock_movement';
  assert n = 1, format('T1 FAIL %s overloads of apply_stock_movement', n);
end $$;

-- T2 the last bottle is sold, the check is voided: the bottle comes back at
-- the invoiced price, invoiced, settled, in the cellar it left -- and the
-- rollup has a WAC again.
do $$
declare r record; t record;
begin
  perform pg_temp.mv('void', 1, 'purchase', 'in', 40, 'invoice', 'cellar');
  perform pg_temp.mv('void', -1, 'sale', 'sale');
  select metadata into t from public.inventory_transactions
   where idempotency_key = 'retcost-sale-' || pg_temp.fx('void')::text;
  assert jsonb_array_length(t.metadata->'lots_taken') = 1
     and (t.metadata->'lots_taken'->0->>'unit_cost')::numeric = 40,
    format('T2 FAIL the sale did not record the lot it took: %s', t.metadata);
  perform pg_temp.mv('void', 1, 'return', 'void');
  select unit_cost, cost_provenance, cost_state, location_id into r
    from public.inventory_lots where inventory_id = pg_temp.fx('void');
  assert r.unit_cost = 40, format('T2 FAIL the voided bottle came back at %s, expected 40', r.unit_cost);
  assert r.cost_provenance = 'invoice' and r.cost_state = 'final',
    format('T2 FAIL provenance/state %s/%s, expected invoice/final', r.cost_provenance, r.cost_state);
  assert r.location_id = pg_temp.fx('cellar'), 'T2 FAIL the voided bottle has no place or the wrong one';
  select wac, has_invoice_cost into r from public.inventory_lot_rollup where inventory_id = pg_temp.fx('void');
  assert r.wac = 40 and r.has_invoice_cost, format('T2 FAIL rollup wac %s has_invoice_cost %s', r.wac, r.has_invoice_cost);
  select metadata->>'cost_carried_from' as f into r from public.inventory_transactions
   where idempotency_key = 'retcost-void-' || pg_temp.fx('void')::text;
  assert r.f = 'lot_taken', format('T2 FAIL cost_carried_from %s', r.f);
end $$;

-- T3 the books reach 0, a count finds 2 at the bar: record_stock_count's
-- surplus carries the bar lot's cost and place.
do $$
declare r record; c jsonb;
begin
  perform pg_temp.mv('count', 2, 'purchase', 'in', 30, 'invoice', 'bar');
  perform pg_temp.mv('count', -2, 'sale', 'sale');
  c := public.record_stock_count(pg_temp.fx('count'), 2, 'retcost-count-' || pg_temp.fx('count')::text);
  assert (c->>'variance_qty')::int = 2, format('T3 FAIL variance %s', c);
  select unit_cost, cost_provenance, location_id into r
    from public.inventory_lots where inventory_id = pg_temp.fx('count');
  assert r.unit_cost = 30 and r.cost_provenance = 'invoice' and r.location_id = pg_temp.fx('bar'),
    format('T3 FAIL counted surplus came back %s/%s/%s', r.unit_cost, r.cost_provenance, r.location_id);
end $$;

-- T4 when live costed lots remain, a surplus carries their average.
do $$
declare r record;
begin
  perform pg_temp.mv('avg', 1, 'purchase', 'a', 20, 'invoice', 'cellar');
  perform pg_temp.mv('avg', 1, 'purchase', 'b', 30, 'invoice', 'cellar');
  perform pg_temp.mv('avg', 1, 'adjustment', 'found');
  select wac, wac_qty, live_qty into r from public.inventory_lot_rollup where inventory_id = pg_temp.fx('avg');
  assert r.wac = 25 and r.wac_qty = 3 and r.live_qty = 3,
    format('T4 FAIL wac %s over %s of %s', r.wac, r.wac_qty, r.live_qty);
end $$;

-- T5 a wine that never had a cost stays uncosted -- nothing is invented.
do $$
declare r record;
begin
  perform pg_temp.mv('never', 1, 'initial', 'open');
  perform pg_temp.mv('never', 1, 'reconciliation', 'up');
  select count(*) filter (where unit_cost is not null) as costed,
         bool_and(cost_provenance = 'estimated') as est into r
    from public.inventory_lots where inventory_id = pg_temp.fx('never');
  assert r.costed = 0 and r.est, format('T5 FAIL an uncosted wine gained a cost (%s costed)', r.costed);
end $$;

-- T6 a purchase is not a return: an unpriced purchase stays unpriced even when
-- the wine has a costed lot.
do $$
declare n int;
begin
  perform pg_temp.mv('buy', 1, 'purchase', 'a', 50, 'invoice');
  perform pg_temp.mv('buy', 1, 'purchase', 'b');
  select count(*) into n from public.inventory_lots
   where inventory_id = pg_temp.fx('buy') and unit_cost is null;
  assert n = 1, format('T6 FAIL an unpriced purchase borrowed a price (%s unpriced lots)', n);
end $$;

-- T7 (F-646 b) a breakage at the bar comes off the bar, not the older cellar
-- lot; one with no place named is FIFO as before.
do $$
declare r record;
begin
  perform pg_temp.mv('place', 3, 'purchase', 'cellar', 10, 'invoice', 'cellar');
  perform pg_temp.mv('place', 2, 'purchase', 'bar', 10, 'invoice', 'bar');
  update public.inventory_lots set received_at = now() - interval '30 days'
   where inventory_id = pg_temp.fx('place') and location_id = pg_temp.fx('cellar');
  perform pg_temp.mv('place', -1, 'waste', 'broke', null, null, 'bar');
  select sum(qty) filter (where location_id = pg_temp.fx('bar')) as bar,
         sum(qty) filter (where location_id = pg_temp.fx('cellar')) as cellar into r
    from public.inventory_lots where inventory_id = pg_temp.fx('place');
  assert r.bar = 1 and r.cellar = 3, format('T7 FAIL bar %s cellar %s, expected 1 and 3', r.bar, r.cellar);
  perform pg_temp.mv('place', -1, 'waste', 'fifo');
  select sum(qty) filter (where location_id = pg_temp.fx('cellar')) as cellar into r
    from public.inventory_lots where inventory_id = pg_temp.fx('place');
  assert r.cellar = 2, format('T7 FAIL an unplaced take-off was not FIFO: cellar %s', r.cellar);
end $$;

rollback;
