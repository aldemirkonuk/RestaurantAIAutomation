-- A-007 / A-009 (analytics walk on Tuzlu Rüzgar, 2026-10-03): a POS check that
-- reached the hub late had its stock dated on the day it was typed in, because
-- apply_stock_movement and record_glass_pour stamped the ledger row with now().
-- Migration a_pos_sale_is_dated_by_its_check gives both functions an optional
-- p_occurred_at and dates transaction_date LEAST(COALESCE(p_occurred_at,
-- now()), now()) (ADR 0281).
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without that migration (T1: neither function has
-- p_occurred_at) and PASS with it. One transaction, rolled back: it leaves
-- nothing behind. All fixtures are SYNTHETIC, keyed by fresh uuids, so a
-- populated database cannot collide with them.
--
-- now() is the transaction's start time and does not move inside it, which is
-- what lets T2 compare a clamped value to now() exactly.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('other_house', gen_random_uuid()),
  ('wine', gen_random_uuid()), ('item', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC postime house', 'syn-postime-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'other_house');

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-PT-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Kalecik Karası', 'red'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

-- T1 exactly one of each function, each with p_occurred_at defaulting to NULL.
do $$
declare
  n integer;
  args text;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'apply_stock_movement';
  assert n = 1, format('T1 FAIL %s overloads of apply_stock_movement, expected 1', n);
  select pg_get_function_arguments(p.oid) into args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'apply_stock_movement';
  assert args like '%p_restaurant_id uuid DEFAULT NULL::uuid, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone',
    format('T1 FAIL apply_stock_movement does not end with p_occurred_at DEFAULT NULL: %s', args);

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_glass_pour';
  assert n = 1, format('T1 FAIL %s overloads of record_glass_pour, expected 1', n);
  select pg_get_function_arguments(p.oid) into args
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_glass_pour';
  assert args like '%p_idempotency_key text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone',
    format('T1 FAIL record_glass_pour does not end with p_occurred_at DEFAULT NULL: %s', args);
end $$;

-- T2 apply_stock_movement: a past instant dates the ledger row; a future one
-- is clamped to now(); NULL is now(). created_at stays entry time.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_house uuid := (select v from t_fx where k = 'house');
  v_past timestamptz := now() - interval '13 days 3 hours';
  v_txn uuid;
  r record;
begin
  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 6,
    p_transaction_type => 'purchase', p_source => 'manual',
    p_unit_cost => 10, p_cost_provenance => 'manual',
    p_idempotency_key => 'postime-t2-in-' || v_item::text,
    p_restaurant_id => v_house);
  select transaction_date, created_at into r from public.inventory_transactions where id = v_txn;
  assert r.transaction_date = now(), format('T2 FAIL an undated movement is dated %s, expected now()', r.transaction_date);

  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'postime-t2-past-' || v_item::text,
    p_restaurant_id => v_house, p_occurred_at => v_past);
  select transaction_date, created_at into r from public.inventory_transactions where id = v_txn;
  assert r.transaction_date = v_past, format('T2 FAIL a sale closed at %s is dated %s', v_past, r.transaction_date);
  assert r.created_at = now(), format('T2 FAIL created_at %s is not entry time', r.created_at);

  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => -1,
    p_transaction_type => 'sale', p_source => 'pos',
    p_idempotency_key => 'postime-t2-future-' || v_item::text,
    p_restaurant_id => v_house, p_occurred_at => now() + interval '2 days');
  select transaction_date into r from public.inventory_transactions where id = v_txn;
  assert r.transaction_date = now(), format('T2 FAIL a future instant was not clamped: %s', r.transaction_date);

  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => 1,
    p_transaction_type => 'return', p_source => 'pos',
    p_idempotency_key => 'postime-t2-null-' || v_item::text,
    p_restaurant_id => v_house, p_occurred_at => null);
  select transaction_date into r from public.inventory_transactions where id = v_txn;
  assert r.transaction_date = now(), format('T2 FAIL a NULL instant is dated %s, expected now()', r.transaction_date);
end $$;

-- T3 record_glass_pour: a pour that opens a bottle writes its ledger row dated
-- by the sale; a pour that does not open one writes no ledger row (unchanged).
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_past timestamptz := now() - interval '20 days';
  v_res jsonb;
  v_rows_before integer;
  v_rows_after integer;
  r record;
begin
  -- T2 left five sealed bottles on the lots and none open.
  v_res := public.record_glass_pour(
    p_inventory_id => v_item, p_pours => 1, p_pour_ml => 150,
    p_source => 'pos', p_reason => 'SYNTHETIC glass',
    p_idempotency_key => 'postime-t3-open-' || v_item::text,
    p_occurred_at => v_past);
  assert (v_res->>'bottles_opened')::int = 1, format('T3 setup: expected one bottle opened, got %s', v_res);
  select transaction_date, created_at into r
    from public.inventory_transactions where id = (v_res->>'txn')::uuid;
  assert r.transaction_date = v_past, format('T3 FAIL the opened bottle is dated %s, expected %s', r.transaction_date, v_past);
  assert r.created_at = now(), format('T3 FAIL created_at %s is not entry time', r.created_at);

  select count(*) into v_rows_before from public.inventory_transactions where inventory_id = v_item;
  v_res := public.record_glass_pour(
    p_inventory_id => v_item, p_pours => 1, p_pour_ml => 150,
    p_idempotency_key => 'postime-t3-noopen-' || v_item::text,
    p_occurred_at => v_past);
  select count(*) into v_rows_after from public.inventory_transactions where inventory_id = v_item;
  assert (v_res->>'bottles_opened')::int = 0 and v_rows_after = v_rows_before,
    format('T3 FAIL a pour from the open bottle wrote %s ledger row(s)', v_rows_after - v_rows_before);

  -- The old 8-argument named call (the gateway in the deploy window) still
  -- resolves, and dates now().
  v_res := public.record_glass_pour(
    p_inventory_id => v_item, p_pours => 4, p_pour_ml => 150,
    p_location_id => null, p_source => 'pos', p_performed_by => null,
    p_reason => 'SYNTHETIC window', p_idempotency_key => 'postime-t3-old-' || v_item::text);
  assert (v_res->>'bottles_opened')::int = 1, format('T3 setup: expected one bottle opened, got %s', v_res);
  select transaction_date into r from public.inventory_transactions where id = (v_res->>'txn')::uuid;
  assert r.transaction_date = now(), format('T3 FAIL an undated pour is dated %s, expected now()', r.transaction_date);
end $$;

-- T4 the positional callers still resolve: set_stock_absolute and
-- record_stock_count call apply_stock_movement with 11 positional arguments.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_txn uuid;
  r record;
begin
  v_txn := public.apply_stock_movement(
    v_item, 'live', 2, 'adjustment', 'manual', null, 'SYNTHETIC positional',
    null, null, null, 'postime-t4-' || v_item::text);
  assert v_txn is not null, 'T4 FAIL the 11-argument positional call wrote nothing';
  select transaction_date into r from public.inventory_transactions where id = v_txn;
  assert r.transaction_date = now(), format('T4 FAIL a positional movement is dated %s', r.transaction_date);
end $$;

-- T5 ADR 0141's refusal survived the copy: a dated movement that names the
-- wrong house still raises 42501 and writes nothing.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_before integer;
  v_after integer;
  v_state text;
begin
  select count(*) into v_before from public.inventory_transactions where inventory_id = v_item;
  begin
    perform public.apply_stock_movement(
      p_inventory_id => v_item, p_stock_state => 'live', p_delta => -1,
      p_transaction_type => 'sale', p_source => 'pos',
      p_idempotency_key => 'postime-t5-' || v_item::text,
      p_restaurant_id => (select v from t_fx where k = 'other_house'),
      p_occurred_at => now() - interval '1 day');
    raise exception 'T5 FAIL a movement naming the wrong house was accepted';
  exception when insufficient_privilege then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  select count(*) into v_after from public.inventory_transactions where inventory_id = v_item;
  assert v_state = '42501' and v_after = v_before,
    format('T5 FAIL refusal state %s, ledger rows %s -> %s', v_state, v_before, v_after);
end $$;

rollback;
