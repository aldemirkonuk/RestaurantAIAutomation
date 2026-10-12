-- F-777 (sim wave 29): two counts of one item taken offline and sent later,
-- oldest first. record_stock_count dated both by arrival, so the gateway's
-- F-249 check refused the newer one and the older count stood. Migration
-- a_queued_count_is_dated_when_it_was_counted gives record_stock_count an
-- optional p_counted_at and dates the count and its movement by it.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.
--
-- now() is the transaction's start time and does not move inside it, so
-- "sent at 20:00" is now() and the counts are dated hours before it.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('item', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC queued-count house', 'syn-qcount-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-QC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Narince', 'white'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

-- T1 exactly one record_stock_count, ending with p_counted_at DEFAULT NULL.
do $$
declare
  n integer;
  args text;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_stock_count';
  assert n = 1, format('T1 FAIL %s overloads of record_stock_count, expected 1', n);
  select pg_get_function_arguments(p.oid) into args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_stock_count';
  -- F-1524 (20270109000000) appends p_unit_cost and p_cost_provenance after it.
  assert args like '%p_counted_at timestamp with time zone DEFAULT NULL::timestamp with time zone%',
    format('T1 FAIL record_stock_count has no p_counted_at DEFAULT NULL: %s', args);
end $$;

-- T2 two queued counts, sent oldest first: 12 at -6h, then 10 at -5h30.
-- Between them the gateway asks what F-249 asks (a count or a movement
-- after the newer count's time); nothing may answer yes, and 10 stands.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_house uuid := (select v from t_fx where k = 'house');
  v_a timestamptz := now() - interval '6 hours';
  v_b timestamptz := now() - interval '5 hours 30 minutes';
  r jsonb;
  n integer;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 14,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'qcount-t2-in-' || v_item::text,
    p_restaurant_id => v_house, p_occurred_at => now() - interval '2 days');

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 12,
    p_idempotency_key => 'count:' || v_item::text || ':A', p_counted_at => v_a);
  assert (r->>'counted_at')::timestamptz = v_a,
    format('T2 FAIL count A is dated %s, expected %s', r->>'counted_at', v_a);
  assert (select transaction_date from public.inventory_transactions
           where id = (r->>'transaction_id')::uuid) = v_a,
    'T2 FAIL count A''s movement is not dated when it was counted';

  select count(*) into n from public.stock_counts
   where inventory_id = v_item and stock_state = 'live' and counted_at > v_b;
  assert n = 0, 'T2 FAIL count A reads as newer than count B, so B would be refused';
  select count(*) into n from public.inventory_transactions
   where inventory_id = v_item and stock_type = 'live' and transaction_date > v_b;
  assert n = 0, 'T2 FAIL count A''s movement reads as after count B, so B would be refused';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 10,
    p_idempotency_key => 'count:' || v_item::text || ':B', p_counted_at => v_b);
  assert (r->>'counted_at')::timestamptz = v_b, 'T2 FAIL count B is not dated when it was counted';
  assert (select coalesce(sum(qty), 0) from public.inventory_lots
           where inventory_id = v_item and stock_state = 'live') = 10,
    'T2 FAIL the newer count (10) does not stand';
  assert (select last_counted_at from public.restaurant_inventory where id = v_item) = v_b,
    'T2 FAIL last_counted_at is not the newer count''s time';
end $$;

-- T3 an older count arriving after a newer one does not pull last_counted_at
-- back; NULL is now(); a future time is clamped to now().
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 10,
    p_idempotency_key => 'count:' || v_item::text || ':old', p_counted_at => now() - interval '9 hours');
  assert (select last_counted_at from public.restaurant_inventory where id = v_item)
         = now() - interval '5 hours 30 minutes',
    'T3 FAIL an older count moved last_counted_at backwards';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 10,
    p_idempotency_key => 'count:' || v_item::text || ':live');
  assert (r->>'counted_at')::timestamptz = now(), 'T3 FAIL an undated count is not dated now()';
  assert (select last_counted_at from public.restaurant_inventory where id = v_item) = now(),
    'T3 FAIL an undated count does not stamp last_counted_at now()';

  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 9,
    p_idempotency_key => 'count:' || v_item::text || ':future', p_counted_at => now() + interval '3 hours');
  assert (r->>'counted_at')::timestamptz = now(), 'T3 FAIL a future count time is not clamped to now()';
  assert (select transaction_date from public.inventory_transactions
           where id = (r->>'transaction_id')::uuid) = now(),
    'T3 FAIL a future count''s movement is not clamped to now()';
end $$;

rollback;
