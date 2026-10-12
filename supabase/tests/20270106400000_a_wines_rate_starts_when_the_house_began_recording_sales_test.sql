-- F-1516 (wave-49 sim, a new house's first 30 days): inventory_analytics
-- averaged a wine's sales over the days since it was listed, so a house that
-- loaded its stock three weeks before its till began read a rate many times
-- too low. Migration a_wines_rate_starts_when_the_house_began_recording_sales
-- takes the rate over the fewer of the listed days and the days since the
-- house's first recorded sale, and appends velocity_from_till.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` or the PGlite harness stops at the first one. It must
-- FAIL on a build without that migration (T1: 21 days, and no such column)
-- and PASS with it. One transaction, rolled back. All fixtures are SYNTHETIC,
-- keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('quiet', gen_random_uuid()),
  ('wine_a', gen_random_uuid()), ('item_a', gen_random_uuid()),
  ('wine_c', gen_random_uuid()), ('item_c', gen_random_uuid()),
  ('wine_q', gen_random_uuid()), ('item_q', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC till house ' || k, 'syn-till-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'quiet');

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-TL-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC ' || k, 'red'
  from t_fx where k in ('wine_a', 'wine_c', 'wine_q');

-- A: opening stock loaded 21 days ago (day 21 of its life). C: listed after
-- the till began. Q: a house that has recorded no sale at all.
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml, created_at)
select (select v from t_fx where k = i), (select v from t_fx where k = h),
       (select v from t_fx where k = w), 750, 150, now() - age
  from (values ('item_a', 'house', 'wine_a', interval '20 days 12 hours'),
               ('item_c', 'house', 'wine_c', interval '12 hours'),
               ('item_q', 'quiet', 'wine_q', interval '9 days 12 hours')) as x(i, h, w, age);

do $$
declare
  v_house uuid := (select v from t_fx where k = 'house');
  v_quiet uuid := (select v from t_fx where k = 'quiet');
  v_a uuid := (select v from t_fx where k = 'item_a');
  v_c uuid := (select v from t_fx where k = 'item_c');
  v_q uuid := (select v from t_fx where k = 'item_q');
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_a, p_stock_state => 'live', p_delta => 24,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'tl-a-in-' || v_a::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '20 days 12 hours');
  perform public.apply_stock_movement(
    p_inventory_id => v_q, p_stock_state => 'live', p_delta => 12,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'tl-q-in-' || v_q::text,
    p_restaurant_id => v_quiet, p_occurred_at => now() - interval '9 days 12 hours');
  perform public.apply_stock_movement(
    p_inventory_id => v_c, p_stock_state => 'live', p_delta => 12,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'tl-c-in-' || v_c::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '12 hours');
  -- The till's first check is a day and a half ago (day 2): four of A, then
  -- two more of A and one of C an hour ago.
  perform public.apply_stock_movement(
    p_inventory_id => v_a, p_stock_state => 'live', p_delta => -4,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'tl-a-sale1-' || v_a::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '1 day 12 hours');
  perform public.apply_stock_movement(
    p_inventory_id => v_a, p_stock_state => 'live', p_delta => -2,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'tl-a-sale2-' || v_a::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '1 hour');
  perform public.apply_stock_movement(
    p_inventory_id => v_c, p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'tl-c-sale-' || v_c::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '1 hour');
end $$;

-- T1 a wine stocked three weeks before the till is averaged over the till's
-- two days, and says so.
do $$
declare
  r record;
begin
  select * into r from public.inventory_analytics where inventory_id = (select v from t_fx where k = 'item_a');
  assert r.velocity_days = 2, format('T1 FAIL velocity_days %s, expected 2 (the till''s days, not 21)', r.velocity_days);
  assert r.velocity_per_day = 3.000, format('T1 FAIL velocity %s, expected 6 / 2 = 3', r.velocity_per_day);
  assert r.velocity_from_till, 'T1 FAIL velocity_from_till is not set';
  assert r.is_new, 'T1 FAIL two days of till is not too young to plan on';
  assert r.days_of_cover = 6, format('T1 FAIL days_of_cover %s, expected 18 / 3 = 6', r.days_of_cover);
end $$;

-- T2 a wine listed after the till began keeps its own days (control).
do $$
declare
  r record;
begin
  select * into r from public.inventory_analytics where inventory_id = (select v from t_fx where k = 'item_c');
  assert r.velocity_days = 1, format('T2 FAIL velocity_days %s, expected 1', r.velocity_days);
  assert not r.velocity_from_till, 'T2 FAIL a wine listed after the first sale is marked from the till';
end $$;

-- T3 a house that has recorded no sale keeps the listed days (control).
do $$
declare
  r record;
begin
  select * into r from public.inventory_analytics where inventory_id = (select v from t_fx where k = 'item_q');
  assert r.velocity_days = 10, format('T3 FAIL velocity_days %s, expected 10', r.velocity_days);
  assert not r.velocity_from_till, 'T3 FAIL a house with no sale is marked from the till';
  assert r.velocity_per_day = 0, format('T3 FAIL velocity %s, expected 0', r.velocity_per_day);
end $$;

-- T4 the replace kept the view reading as its caller (F-839).
do $$
begin
  assert exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'inventory_analytics'
       and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ), 'T4 FAIL inventory_analytics no longer reads as its caller';
end $$;

rollback;
