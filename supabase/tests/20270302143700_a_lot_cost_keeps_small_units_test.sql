-- G24 / proposal F-C (inventory walk #7, lane I5): a lot kept in grams stores
-- its cost PER GRAM, and inventory_lots.unit_cost was numeric(10,2), so
-- 0.035 TRY/g was stored as 0.04 (a 14% error) and every WAC, COGS and stock
-- value read from it carried that error. inventory_transactions.unit_cost,
-- which apply_stock_movement fills with the same p_unit_cost, rounded the same
-- way, and both lot views rounded WAC to 2 places on top.
-- Migration a_lot_cost_keeps_small_units widens both columns to numeric(14,6)
-- and the views' WAC rounding to 6 places, keeping everything else as it was.
--
-- Self-asserting: every block raises on a failure (assert -> P0004), so
-- `psql -v ON_ERROR_STOP=1` stops at the first one. It must FAIL on a build
-- without the migration (T1: numeric(10,2); T2: 0.04) and PASS with it.
-- T5 passes on both builds: it pins what the migration must NOT change.
-- One transaction, rolled back. Fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('flour', gen_random_uuid()), ('salt', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC lot cost house', 'syn-lotcost-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- Two food items kept in grams: house items with no wine-library link.
insert into public.restaurant_inventory
  (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
select (select v from t_fx where k = i), (select v from t_fx where k = 'house'),
       null, 'food', 'g', n, 'house_declared'
  from (values ('flour', 'SYNTHETIC flour'), ('salt', 'SYNTHETIC salt')) as x(i, n);

-- T1 both cost columns hold six decimal places.
do $$
declare
  t text;
begin
  select format_type(atttypid, atttypmod) into t from pg_attribute
   where attrelid = 'public.inventory_lots'::regclass and attname = 'unit_cost';
  assert t = 'numeric(14,6)', format('T1 FAIL inventory_lots.unit_cost is %s, expected numeric(14,6)', t);
  select format_type(atttypid, atttypmod) into t from pg_attribute
   where attrelid = 'public.inventory_transactions'::regclass and attname = 'unit_cost';
  assert t = 'numeric(14,6)', format('T1 FAIL inventory_transactions.unit_cost is %s, expected numeric(14,6)', t);
end $$;

-- T2 receiving 1000 g at 0.035/g through apply_stock_movement keeps 0.035 on
-- the lot AND on the ledger row it writes.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'flour');
  v_house uuid := (select v from t_fx where k = 'house');
  v_txn uuid;
  c numeric;
begin
  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 1000,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 0.035, p_cost_provenance => 'invoice',
    p_idempotency_key => 'lotcost-t2-' || v_item::text, p_restaurant_id => v_house);
  select unit_cost into c from public.inventory_lots where inventory_id = v_item;
  assert c = 0.035, format('T2 FAIL the lot stored %s per gram, expected 0.035', c);
  select unit_cost into c from public.inventory_transactions where id = v_txn;
  assert c = 0.035, format('T2 FAIL the ledger row stored %s per gram, expected 0.035', c);
end $$;

-- T3 a single-lot item's WAC is the lot's cost, in both views.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'flour');
  w numeric;
begin
  select wac into w from public.inventory_lot_rollup where inventory_id = v_item;
  assert w = 0.035, format('T3 FAIL inventory_lot_rollup.wac is %s, expected 0.035', w);
  select wac into w from public.inventory_location_breakdown where inventory_id = v_item;
  assert w = 0.035, format('T3 FAIL inventory_location_breakdown.wac is %s, expected 0.035', w);
end $$;

-- T4 a blended WAC keeps six places: (1000*0.035 + 2000*0.036) / 3000
-- = 0.0356666..., which is 0.035667 (2 places would say 0.04).
do $$
declare
  v_item uuid := (select v from t_fx where k = 'salt');
  v_house uuid := (select v from t_fx where k = 'house');
  w numeric;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 1000,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 0.035, p_cost_provenance => 'invoice',
    p_idempotency_key => 'lotcost-t4a-' || v_item::text, p_restaurant_id => v_house);
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 2000,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 0.036, p_cost_provenance => 'invoice',
    p_idempotency_key => 'lotcost-t4b-' || v_item::text, p_restaurant_id => v_house);
  select wac into w from public.inventory_lot_rollup where inventory_id = v_item;
  assert w = 0.035667, format('T4 FAIL blended inventory_lot_rollup.wac is %s, expected 0.035667', w);
  select sum(qty::numeric * wac) / sum(qty) into w
    from public.inventory_location_breakdown where inventory_id = v_item;
  assert round(w, 6) = 0.035667, format('T4 FAIL blended inventory_location_breakdown.wac is %s, expected 0.035667', w);
end $$;

-- T5 kept behaviour: the three rebuilt views have exactly the columns, order
-- and types they had on origin/main, and inventory_analytics still answers
-- for the items above.
do $$
declare
  got text;
  n integer;
begin
  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) into got
    from pg_attribute a where a.attrelid = 'public.inventory_lot_rollup'::regclass and a.attnum > 0 and not a.attisdropped;
  assert got = 'inventory_id uuid, restaurant_id uuid, master_wine_id uuid, live_qty bigint, shadow_qty bigint, wac numeric, has_invoice_cost boolean, live_lot_count bigint, live_location_count bigint, open_ml bigint, sample_qty bigint, wac_qty bigint, invoice_qty bigint, unpriced_qty bigint',
    format('T5 FAIL inventory_lot_rollup columns changed: %s', got);
  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) into got
    from pg_attribute a where a.attrelid = 'public.inventory_location_breakdown'::regclass and a.attnum > 0 and not a.attisdropped;
  assert got = 'inventory_id uuid, restaurant_id uuid, master_wine_id uuid, location_id uuid, stock_state character varying(10), qty bigint, wac numeric',
    format('T5 FAIL inventory_location_breakdown columns changed: %s', got);
  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) into got
    from pg_attribute a where a.attrelid = 'public.inventory_analytics'::regclass and a.attnum > 0 and not a.attisdropped;
  assert got = 'inventory_id uuid, restaurant_id uuid, on_hand bigint, sold_30d bigint, sold_90d bigint, last_sold_at timestamp with time zone, velocity_per_day numeric, days_of_cover numeric, reorder_point numeric, reorder_suggested boolean, abc_class text, dead_stock boolean, days_since_sale integer',
    format('T5 FAIL inventory_analytics columns changed: %s', got);
  select count(*) into n from public.inventory_analytics
   where inventory_id in (select v from t_fx where k in ('flour', 'salt')) and on_hand > 0;
  assert n = 2, format('T5 FAIL inventory_analytics answers for %s of 2 stocked items', n);
  -- inventory_analytics kept OD-72's invoker semantics through the rebuild.
  select count(*) into n from pg_class
   where oid = 'public.inventory_analytics'::regclass and 'security_invoker=true' = any(reloptions);
  assert n = 1, 'T5 FAIL inventory_analytics lost security_invoker=true';
  -- No client role gained a grant on any of the three.
  select count(*) into n from unnest(array['inventory_analytics', 'inventory_lot_rollup', 'inventory_location_breakdown']) v
   where has_table_privilege('anon', 'public.' || v, 'SELECT') or has_table_privilege('authenticated', 'public.' || v, 'SELECT');
  assert n = 0, format('T5 FAIL %s lot view(s) readable by anon/authenticated', n);
end $$;

rollback;
