-- F-686 / F-687 (wave-23 sim, forecast/par/reorder): inventory_analytics
-- counted a POS void as demand and divided a three-day-old wine's sales by 30.
-- Migration velocity_nets_voids_and_counts_a_new_wines_days nets POS returns
-- out of sold_30d / sold_90d and divides by LEAST(30, days on the list),
-- appending velocity_days and is_new.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` or the PGlite harness stops at the first one. It must
-- FAIL on a build without that migration (T1: the void still counts) and PASS
-- with it. One transaction, rolled back. All fixtures are SYNTHETIC, keyed by
-- fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()),
  ('wine_old', gen_random_uuid()), ('item_old', gen_random_uuid()),
  ('wine_new', gen_random_uuid()), ('item_new', gen_random_uuid()),
  ('wine_seed', gen_random_uuid()), ('item_seed', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC velocity house', 'syn-velocity-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-VT-' || left(replace(v::text, '-', ''), 12),
       case k when 'wine_old' then 'SYNTHETIC Narince' when 'wine_seed' then 'SYNTHETIC Kalecik' else 'SYNTHETIC Boğazkere' end, 'red'
  from t_fx where k in ('wine_old', 'wine_new', 'wine_seed');

-- The old wine has been on the list for 60 days; the new one for two and a
-- half (day 3 of its life, counting the listing day as day 1).
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml, created_at)
select (select v from t_fx where k = i), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = w), 750, 150, now() - age
  from (values ('item_old', 'wine_old', interval '60 days'),
               ('item_new', 'wine_new', interval '2 days 12 hours'),
               ('item_seed', 'wine_seed', interval '60 days')) as x(i, w, age);

do $$
declare
  v_house uuid := (select v from t_fx where k = 'house');
  v_old uuid := (select v from t_fx where k = 'item_old');
  v_new uuid := (select v from t_fx where k = 'item_new');
  v_seed uuid := (select v from t_fx where k = 'item_seed');
begin
  -- F-1516: a rate starts no earlier than the house's first recorded sale.
  -- This house has sold since 50 days ago (another wine), so the windows
  -- below are the wines' own.
  perform public.apply_stock_movement(
    p_inventory_id => v_seed, p_stock_state => 'live', p_delta => 2,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'vt-seed-in-' || v_seed::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '55 days');
  perform public.apply_stock_movement(
    p_inventory_id => v_seed, p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'vt-seed-sale-' || v_seed::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '50 days');
  perform public.apply_stock_movement(
    p_inventory_id => v_old, p_stock_state => 'live', p_delta => 20,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'vt-old-in-' || v_old::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '40 days');
  -- Six rung up ten days ago; four of them voided the next day.
  perform public.apply_stock_movement(
    p_inventory_id => v_old, p_stock_state => 'live', p_delta => -6,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'vt-old-sale-' || v_old::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '10 days');
  perform public.apply_stock_movement(
    p_inventory_id => v_old, p_stock_state => 'live', p_delta => 4,
    p_transaction_type => 'return', p_source => 'pos',
    p_idempotency_key => 'vt-old-sale-' || v_old::text || ':void',
    p_restaurant_id => v_house, p_occurred_at => now() - interval '9 days');
  -- A bottle brought back by hand is not an undone sale: it stays out of demand.
  perform public.apply_stock_movement(
    p_inventory_id => v_old, p_stock_state => 'live', p_delta => 1,
    p_transaction_type => 'return', p_source => 'manual',
    p_idempotency_key => 'vt-old-manual-' || v_old::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '8 days');

  perform public.apply_stock_movement(
    p_inventory_id => v_new, p_stock_state => 'live', p_delta => 20,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'vt-new-in-' || v_new::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '2 days');
  perform public.apply_stock_movement(
    p_inventory_id => v_new, p_stock_state => 'live', p_delta => -6,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'vt-new-sale-' || v_new::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '1 day');
end $$;

-- T1 (F-686) a POS void nets out of demand; a hand-booked return does not.
do $$
declare
  r record;
begin
  select * into r from public.inventory_analytics where inventory_id = (select v from t_fx where k = 'item_old');
  assert r.sold_30d = 2, format('T1 FAIL sold_30d %s, expected 2 (6 sold, 4 voided)', r.sold_30d);
  assert r.sold_90d = 2, format('T1 FAIL sold_90d %s, expected 2', r.sold_90d);
  assert r.velocity_per_day = round(2 / 30.0, 3), format('T1 FAIL velocity %s, expected 2/30', r.velocity_per_day);
  assert r.last_sold_at = now() - interval '10 days', format('T1 FAIL last_sold_at %s is not the sale', r.last_sold_at);
end $$;

-- T2 (F-687) a wine on the list for three days is averaged over three days,
-- and says it is new; a 60-day-old wine keeps the 30-day window.
do $$
declare
  r record;
begin
  select * into r from public.inventory_analytics where inventory_id = (select v from t_fx where k = 'item_new');
  assert r.velocity_days = 3, format('T2 FAIL velocity_days %s, expected 3', r.velocity_days);
  assert r.velocity_per_day = 2.000, format('T2 FAIL velocity %s, expected 6 / 3 = 2', r.velocity_per_day);
  assert r.is_new, 'T2 FAIL a three-day-old wine is not marked new';
  assert r.days_of_cover = 7, format('T2 FAIL days_of_cover %s, expected 14 / 2 = 7', r.days_of_cover);

  select * into r from public.inventory_analytics where inventory_id = (select v from t_fx where k = 'item_old');
  assert r.velocity_days = 30, format('T2 FAIL old wine velocity_days %s, expected 30', r.velocity_days);
  assert not r.is_new, 'T2 FAIL a 60-day-old wine is marked new';
end $$;

-- T3 a void that outweighs the window's sales floors demand at 0, never below.
do $$
declare
  v_house uuid := (select v from t_fx where k = 'house');
  v_old uuid := (select v from t_fx where k = 'item_old');
  r record;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_old, p_stock_state => 'live', p_delta => 5,
    p_transaction_type => 'return', p_source => 'pos',
    p_idempotency_key => 'vt-old-bigvoid-' || v_old::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '1 day');
  select * into r from public.inventory_analytics where inventory_id = v_old;
  assert r.sold_30d = 0, format('T3 FAIL sold_30d %s, expected 0', r.sold_30d);
  assert r.velocity_per_day = 0, format('T3 FAIL velocity %s, expected 0', r.velocity_per_day);
end $$;

rollback;
