-- QA round 11b, residual 4 of PR #839: migration a_used_up_lot_is_kept
-- recreates inventory_lot_rollup and inventory_location_breakdown. PR #839
-- (migration a_lot_cost_keeps_small_units) rounds their WAC to 6 places; if
-- this migration ran after it with `round(..., 2)`, a per-gram cost would read
-- 0.04 again. Both now round to 6, so either merge order leaves 6.
--
-- Self-asserting: every block raises on a failure (assert -> P0004), so
-- `psql -v ON_ERROR_STOP=1` stops at the first one. W1 must FAIL on a build
-- where these views round WAC to 2 places (origin/main: 1.67) and PASS with
-- this migration. W2 pins the migration's own purpose: a lot sold to zero is
-- kept, and the views still read only lots holding something.
-- One transaction, rolled back. Fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid()), ('salt', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC used-up lot house', 'syn-usedup-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.restaurant_inventory
  (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
select (select v from t_fx where k = 'salt'), (select v from t_fx where k = 'house'),
       null, 'food', 'g', 'SYNTHETIC salt', 'house_declared';

-- W1 a blended WAC keeps six places in both views:
-- (1 x 1.00 + 2 x 2.00) / 3 = 1.666666..., which is 1.666667 (2 places: 1.67).
do $$
declare
  v_item uuid := (select v from t_fx where k = 'salt');
  v_house uuid := (select v from t_fx where k = 'house');
  w numeric;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 1,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 1.00, p_cost_provenance => 'invoice',
    p_idempotency_key => 'usedup-w1a-' || v_item::text, p_restaurant_id => v_house);
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 2,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 2.00, p_cost_provenance => 'invoice',
    p_idempotency_key => 'usedup-w1b-' || v_item::text, p_restaurant_id => v_house);
  select wac into w from public.inventory_lot_rollup where inventory_id = v_item;
  assert w = 1.666667, format('W1 FAIL inventory_lot_rollup.wac is %s, expected 1.666667', w);
  select sum(qty::numeric * wac) / sum(qty) into w
    from public.inventory_location_breakdown where inventory_id = v_item;
  assert round(w, 6) = 1.666667, format('W1 FAIL inventory_location_breakdown.wac is %s, expected 1.666667', w);
end $$;

-- W2 selling the first lot to zero keeps it (qty 0, depleted), and the views
-- then read only the lot still holding stock: WAC 2.000000 on 2 units.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'salt');
  v_house uuid := (select v from t_fx where k = 'house');
  n integer;
  w numeric;
  q bigint;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'manual',
    p_idempotency_key => 'usedup-w2-' || v_item::text, p_restaurant_id => v_house);
  select count(*) into n from public.inventory_lots
   where inventory_id = v_item and qty = 0 and status = 'depleted' and depleted_at is not null;
  assert n = 1, format('W2 FAIL %s used-up lot(s) kept, expected 1', n);
  select wac, live_qty into w, q from public.inventory_lot_rollup where inventory_id = v_item;
  assert w = 2.000000 and q = 2, format('W2 FAIL inventory_lot_rollup reads wac %s on %s units, expected 2.000000 on 2', w, q);
end $$;

rollback;
