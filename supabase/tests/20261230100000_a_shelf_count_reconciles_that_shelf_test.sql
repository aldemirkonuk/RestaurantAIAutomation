-- F-291 (bulletproof wave 4, /inventory counts): a spot count of one shelf
-- wiped the other shelves, because record_stock_count compared the number with
-- the lot sum of every location and drained the oldest lots anywhere.
-- Migration a_shelf_count_reconciles_that_shelf adds p_location_id: with a
-- shelf, the expected figure and the correction are that shelf only; without
-- one, nothing changes.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a build without
-- that migration (T1: no p_location_id) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other_house', gen_random_uuid()),
  ('wine', gen_random_uuid()), ('item', gen_random_uuid()),
  ('cellar', gen_random_uuid()), ('bar', gen_random_uuid()), ('foreign', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC shelf-count house', 'syn-shelfcount-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other_house');

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-SC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Narince', 'white'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = l), (select v from t_fx where k = h), z, 100
  from (values ('cellar', 'house', 'Cellar'), ('bar', 'house', 'Bar'),
               ('foreign', 'other_house', 'Their cellar')) as x(l, h, z);

-- Cellar holds 8, Bar holds 3. The Bar's lot is the OLDER one, so a count that
-- drains "the oldest lots anywhere" would take from the Bar first.
insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, received_at)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       (select v from t_fx where k = 'wine'), (select v from t_fx where k = l), 'live', q, now() - d
  from (values ('bar', 3, interval '30 days'), ('cellar', 8, interval '1 day')) as x(l, q, d);

create or replace function pg_temp.shelf(p_k text) returns int language sql as $$
  select coalesce(sum(qty), 0)::int from public.inventory_lots
   where inventory_id = (select v from t_fx where k = 'item') and stock_state = 'live'
     and location_id = (select v from t_fx where k = p_k)
$$;

-- T1 exactly one record_stock_count, and it takes p_location_id defaulting to NULL.
do $$
declare n integer; args text;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_stock_count';
  assert n = 1, format('T1 FAIL %s overloads of record_stock_count, expected 1', n);
  select pg_get_function_arguments(p.oid) into args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_stock_count';
  assert args like '%p_location_id uuid DEFAULT NULL::uuid',
    format('T1 FAIL record_stock_count has no p_location_id DEFAULT NULL: %s', args);
end $$;

-- T2 the cellar counter finds 6: expected is the cellar's 8, the cellar drops
-- to 6, and the Bar's older lot is untouched.
do $$
declare r jsonb; t record; c record;
begin
  r := public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 6,
         p_idempotency_key => 'syn-shelf-t2-' || gen_random_uuid(),
         p_location_id => (select v from t_fx where k = 'cellar'));
  assert (r->>'expected_qty')::int = 8, format('T2 FAIL expected %s, want 8 (the cellar only)', r->>'expected_qty');
  assert (r->>'variance_qty')::int = -2, format('T2 FAIL variance %s, want -2', r->>'variance_qty');
  assert pg_temp.shelf('cellar') = 6, format('T2 FAIL cellar holds %s, want 6', pg_temp.shelf('cellar'));
  assert pg_temp.shelf('bar') = 3, format('T2 FAIL bar holds %s, want 3 (a cellar count must not touch it)', pg_temp.shelf('bar'));
  select * into t from public.inventory_transactions where id = (r->>'transaction_id')::uuid;
  assert t.quantity_change = -2 and t.quantity_before = 11 and t.quantity_after = 9,
    format('T2 FAIL ledger row %s / %s -> %s', t.quantity_change, t.quantity_before, t.quantity_after);
  assert t.from_location_id = (select v from t_fx where k = 'cellar'), 'T2 FAIL ledger row does not name the cellar';
  assert t.transaction_type = 'reconciliation', format('T2 FAIL type %s', t.transaction_type);
  select * into c from public.stock_counts where id = (r->>'count_id')::uuid;
  assert c.location_id = (select v from t_fx where k = 'cellar') and c.transaction_id = t.id,
    'T2 FAIL the count row does not name the cellar and its movement';
end $$;

-- T3 the bar counter finds 5: expected is the bar's 3, the two extra land on
-- the Bar, and the cellar stays at 6.
do $$
declare r jsonb;
begin
  r := public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 5,
         p_idempotency_key => 'syn-shelf-t3-' || gen_random_uuid(),
         p_location_id => (select v from t_fx where k = 'bar'));
  assert (r->>'expected_qty')::int = 3 and (r->>'variance_qty')::int = 2,
    format('T3 FAIL expected %s variance %s, want 3 / +2', r->>'expected_qty', r->>'variance_qty');
  assert pg_temp.shelf('bar') = 5, format('T3 FAIL bar holds %s, want 5', pg_temp.shelf('bar'));
  assert pg_temp.shelf('cellar') = 6, format('T3 FAIL cellar holds %s, want 6', pg_temp.shelf('cellar'));
end $$;

-- T4 a shelf count that agrees is recorded with variance 0 and moves nothing.
do $$
declare r jsonb;
begin
  r := public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 6,
         p_idempotency_key => 'syn-shelf-t4-' || gen_random_uuid(),
         p_location_id => (select v from t_fx where k = 'cellar'));
  assert (r->>'variance_qty')::int = 0 and r->>'transaction_id' is null,
    format('T4 FAIL agreeing shelf count gave %s', r);
  assert exists (select 1 from public.stock_counts where id = (r->>'count_id')::uuid and variance_qty = 0),
    'T4 FAIL the agreeing count was not recorded';
end $$;

-- T5 another house's shelf is refused and nothing is written.
do $$
declare before_counts int; refused boolean := false;
begin
  select count(*) into before_counts from public.stock_counts
   where inventory_id = (select v from t_fx where k = 'item');
  begin
    perform public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 0,
         p_idempotency_key => 'syn-shelf-t5-' || gen_random_uuid(),
         p_location_id => (select v from t_fx where k = 'foreign'));
  exception when sqlstate '42501' then refused := true;
  end;
  assert refused, 'T5 FAIL a foreign shelf was accepted';
  assert (select count(*) from public.stock_counts where inventory_id = (select v from t_fx where k = 'item')) = before_counts,
    'T5 FAIL a refused count left a row';
  assert pg_temp.shelf('cellar') = 6 and pg_temp.shelf('bar') = 5, 'T5 FAIL a refused count moved stock';
end $$;

-- T6 without a shelf, nothing changed: expected is every shelf (11), and a
-- shortfall drains the oldest lot anywhere (the Bar's), as before.
do $$
declare r jsonb;
begin
  r := public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 10,
         p_idempotency_key => 'syn-shelf-t6-' || gen_random_uuid());
  assert (r->>'expected_qty')::int = 11 and (r->>'variance_qty')::int = -1,
    format('T6 FAIL expected %s variance %s, want 11 / -1', r->>'expected_qty', r->>'variance_qty');
  assert pg_temp.shelf('bar') = 4 and pg_temp.shelf('cellar') = 6,
    format('T6 FAIL bar %s cellar %s, want 4 / 6 (oldest lot first)', pg_temp.shelf('bar'), pg_temp.shelf('cellar'));
  assert (select location_id from public.stock_counts where id = (r->>'count_id')::uuid) is null,
    'T6 FAIL an every-shelf count names a shelf';
end $$;

-- T7 a replayed shelf count returns the original and moves nothing again.
do $$
declare v_key text := 'syn-shelf-t7-' || gen_random_uuid(); r1 jsonb; r2 jsonb;
begin
  r1 := public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 2,
         p_idempotency_key => v_key, p_location_id => (select v from t_fx where k = 'cellar'));
  r2 := public.record_stock_count(
         p_inventory_id => (select v from t_fx where k = 'item'), p_counted_qty => 2,
         p_idempotency_key => v_key, p_location_id => (select v from t_fx where k = 'cellar'));
  assert (r2->>'replayed')::boolean and r2->>'count_id' = r1->>'count_id', 'T7 FAIL replay was not recognised';
  assert pg_temp.shelf('cellar') = 2 and pg_temp.shelf('bar') = 4,
    format('T7 FAIL cellar %s bar %s, want 2 / 4', pg_temp.shelf('cellar'), pg_temp.shelf('bar'));
end $$;

rollback;
