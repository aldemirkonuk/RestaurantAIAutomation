-- F-1524 (sim 50): migration an_opening_count_keeps_the_files_cost.
--   An opening count with the file's cost per bottle costs a wine that has no
--   live costed lot, and never overwrites one that has.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (record_stock_count takes no cost). One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()),
  ('w_menu_item', gen_random_uuid()), ('w_bare_item', gen_random_uuid()), ('w_costed_item', gen_random_uuid()),
  ('menu_item', gen_random_uuid()), ('bare_item', gen_random_uuid()), ('costed_item', gen_random_uuid()),
  ('cellar', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC opening-cost house', 'syn-opcost-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-OC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Okuzgozu ' || k, 'red'
  from t_fx where k like 'w\_%';

-- Three house wines, one per case.
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = i), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'w_' || i), 750, 150
  from (values ('menu_item'), ('bare_item'), ('costed_item')) as x(i);

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = 'cellar'), (select v from t_fx where k = 'house'), 'Cellar', 100;

-- bare_item: 4 bottles already on the books with no cost.
insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, unit_cost, cost_provenance, cost_state)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'bare_item'),
       (select v from t_fx where k = 'w_bare_item'), 'live', 4, null, 'estimated', 'provisional';

-- costed_item: 3 bottles invoiced at 12.00.
insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, unit_cost, cost_provenance, cost_state)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'costed_item'),
       (select v from t_fx where k = 'w_costed_item'), 'live', 3, 12.00, 'invoice', 'final';

-- T1 a menu-first wine (no lots at all) counted to 6 at 14.50 from the file:
-- the 6 bottles are booked at 14.50, typed by a person, settled.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'menu_item');
  r jsonb;
  l record;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 6, p_idempotency_key => 'syn-opcost-t1-' || v_item::text,
    p_source => 'import', p_transaction_type => 'initial', p_reason => 'SYNTHETIC opening stock',
    p_location_id => (select v from t_fx where k = 'cellar'),
    p_unit_cost => 14.50, p_cost_provenance => 'manual');
  assert (r->>'cost_applied')::boolean is true, format('T1 FAIL cost_applied is %s, expected true', r->>'cost_applied');
  select sum(qty) as q, min(unit_cost) as lo, max(unit_cost) as hi,
         min(cost_provenance) as prov, min(cost_state) as st
    into l from public.inventory_lots where inventory_id = v_item and stock_state = 'live';
  assert l.q = 6 and l.lo = 14.50 and l.hi = 14.50 and l.prov = 'manual' and l.st = 'final',
    format('T1 FAIL lots are %s bottles at %s-%s (%s, %s), expected 6 at 14.50 (manual, final)', l.q, l.lo, l.hi, l.prov, l.st);
end $$;

-- T2 a wine with 4 uncosted bottles counted to 6 at 10.00: every live bottle
-- is costed, and the 4 that had no price are logged as revalued from nothing.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'bare_item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 6, p_idempotency_key => 'syn-opcost-t2-' || v_item::text,
    p_source => 'import', p_transaction_type => 'initial', p_reason => 'SYNTHETIC opening stock',
    p_unit_cost => 10.00, p_cost_provenance => 'manual');
  assert (r->>'cost_applied')::boolean is true, 'T2 FAIL cost_applied is not true';
  assert (select count(*) from public.inventory_lots
           where inventory_id = v_item and stock_state = 'live' and qty > 0 and unit_cost is distinct from 10.00) = 0,
    'T2 FAIL a live bottle of the uncosted wine was left without the file''s cost';
  assert (select sum(qty) from public.inventory_lots where inventory_id = v_item and stock_state = 'live') = 6,
    'T2 FAIL the wine is not at 6 bottles';
  assert (select count(*) from public.inventory_lot_revaluations
           where inventory_id = v_item and prior_unit_cost is null and new_unit_cost = 10.00
             and new_cost_provenance = 'manual' and qty_at_revaluation = 4) = 1,
    'T2 FAIL the 4 uncosted bottles were costed with no revaluation row';
end $$;

-- T3 a wine with a real cost (3 invoiced at 12.00) counted to 5 at 20.00:
-- the invoiced lot keeps 12.00, the file's cost is not applied and says so.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'costed_item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 5, p_idempotency_key => 'syn-opcost-t3-' || v_item::text,
    p_source => 'import', p_transaction_type => 'initial', p_reason => 'SYNTHETIC opening stock',
    p_unit_cost => 20.00, p_cost_provenance => 'manual');
  assert (r->>'cost_applied')::boolean is false, format('T3 FAIL cost_applied is %s, expected false', r->>'cost_applied');
  assert (select count(*) from public.inventory_lots where inventory_id = v_item and unit_cost = 20.00) = 0,
    'T3 FAIL the file''s cost reached a wine that already had a real cost';
  assert (select count(*) from public.inventory_lots
           where inventory_id = v_item and unit_cost = 12.00 and cost_provenance = 'invoice' and qty = 3) = 1,
    'T3 FAIL the invoiced lot was changed';
  assert (select count(*) from public.inventory_lot_revaluations where inventory_id = v_item) = 0,
    'T3 FAIL a revaluation was written for a wine that kept its cost';
end $$;

-- T4 a cost on an ordinary (non-opening) count is refused, and nothing is counted.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'costed_item');
  v_refused boolean := false;
begin
  begin
    perform public.record_stock_count(
      p_inventory_id => v_item, p_counted_qty => 9, p_idempotency_key => 'syn-opcost-t4-' || v_item::text,
      p_unit_cost => 1.00, p_cost_provenance => 'manual');
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'T4 FAIL a cost was accepted on a count that is not an opening count';
  assert (select count(*) from public.stock_counts where idempotency_key = 'syn-opcost-t4-' || v_item::text) = 0,
    'T4 FAIL the refused count was recorded';
end $$;

-- T5 kept behaviour: an opening count with no cost books uncosted bottles and
-- reports no cost decision.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'menu_item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 7, p_idempotency_key => 'syn-opcost-t5-' || v_item::text,
    p_source => 'import', p_transaction_type => 'initial');
  assert r ? 'cost_applied' and jsonb_typeof(r->'cost_applied') = 'null',
    format('T5 FAIL cost_applied is %s, expected null', r->'cost_applied');
  assert (select sum(qty) from public.inventory_lots where inventory_id = v_item and stock_state = 'live') = 7,
    'T5 FAIL the uncosted opening count did not reach 7';
end $$;

rollback;
