-- AW08 (analytics walk, 2026-10-03): when a glass sale's lot held an open
-- bottle with less than one pour and no sealed bottle, record_glass_pour
-- raised "insufficient stock for a full pour" even though other lots of the
-- item held sealed bottles. Every later glass sale failed the same way and the
-- bottles stayed in the book. Migration a_short_pour_opens_the_next_bottle
-- (ADR 0285) finishes the open bottle and opens the next from any lot.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or a
-- RAISE naming the test), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite
-- harness stops at the first one. Run it on a database built from
-- supabase/migrations. Synthetic fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT that migration and without a_pos_sale_is_dated_by_its_check
-- (ADR 0281, which re-creates the function on this migration's body), T1, T2,
-- T3, T4, T5 and T12 FAIL. T5n, T6, T7, T8, T9 and T10 pass on both builds:
-- they pin what the migration keeps. T11 pins the signature
-- a_pos_sale_is_dated_by_its_check left (see T11).

begin;

-- Setup: one house, one item per test (each its own wine), two locations.
create function pg_temp.aw08_state(p uuid) returns text language sql as $$
  select string_agg(qty || '+' || open_bottle_ml, ' | ' order by received_at, created_at, id)
    from public.inventory_lots where inventory_id = p and stock_state = 'live'
$$;
create function pg_temp.aw08_ml(p uuid) returns bigint language sql as $$
  select coalesce(sum(l.open_bottle_ml), 0) + coalesce(sum(l.qty), 0) * max(coalesce(ri.bottle_size_ml, 750))
    from public.inventory_lots l join public.restaurant_inventory ri on ri.id = l.inventory_id
   where l.inventory_id = p and l.stock_state = 'live'
$$;
create function pg_temp.aw08_sales(p uuid) returns bigint language sql as $$
  select count(*) from public.inventory_transactions where inventory_id = p and transaction_type = 'sale'
$$;
create function pg_temp.aw08_pours(p uuid) returns bigint language sql as $$
  select count(*) from public.pour_events where inventory_id = p
$$;
create function pg_temp.aw08_lot(p_item uuid, p_qty int, p_open int, p_days int, p_loc uuid default null)
returns void language sql as $$
  insert into public.inventory_lots
    (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at, location_id)
  select ri.restaurant_id, ri.id, ri.master_wine_id, p_qty, p_open, now() - make_interval(days => p_days), p_loc
    from public.restaurant_inventory ri where ri.id = p_item
$$;

do $$
declare
  h uuid := 'a0080000-0000-4000-8000-000000000001';
  i int;
begin
  insert into public.restaurants (id, name, slug) values (h, 'AW08 test house', 'aw08-test-house');
  for i in 1..12 loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (('a0080000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
            'AW08-TEST-' || i, 'AW08 test wine ' || i, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (('a0080000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, h,
            ('a0080000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 750, 150);
  end loop;
  insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles) values
    ('a0080000-0000-4000-8000-000000000301', h, 'AW08 bar', 100),
    ('a0080000-0000-4000-8000-000000000302', h, 'AW08 cellar', 100);

  -- T1/T2: a stranded open lot (0 sealed + 25 ml) next to 3 sealed.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000201', 0, 25, 10);
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000201', 3, 0, 5);
  -- T3: six pours across three lots.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000202', 0, 100, 9);
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000202', 1, 0, 6);
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000202', 1, 0, 3);
  -- T4: a 1000 ml pour from 750 ml bottles.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000203', 2, 0, 3);
  -- T5/T5n: refused pours.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000204', 1, 300, 3);
  -- T6: the remainder within one lot.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000205', 2, 100, 3);
  -- T7/T10: the open bottle covers the pour.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000206', 1, 300, 3);
  -- T8: the whole item is short; and an item with nothing at all.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000207', 0, 25, 9);
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000208', 0, 0, 9);
  -- T9: an open bottle elsewhere (older) and a sealed one at the bar.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000209', 0, 300, 9, 'a0080000-0000-4000-8000-000000000302');
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000209', 1, 0, 3, 'a0080000-0000-4000-8000-000000000301');
  -- T12: the bar's lot is stranded; the cellar holds sealed bottles.
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000210', 0, 25, 9, 'a0080000-0000-4000-8000-000000000301');
  perform pg_temp.aw08_lot('a0080000-0000-4000-8000-000000000210', 3, 0, 3, 'a0080000-0000-4000-8000-000000000302');

  assert pg_temp.aw08_state('a0080000-0000-4000-8000-000000000201') = '0+25 | 3+0', 'setup: item 1 lots';
  assert (select stock_live from public.restaurant_inventory where id = 'a0080000-0000-4000-8000-000000000201') = 3,
    'setup: item 1 stock_live is not projected from its lots';
end $$;

-- T1 the stranded case: a 150 ml pour takes the 25 ml and opens a bottle
-- from the other lot.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000201';
  r jsonb;
  s text;
  t record;
begin
  begin
    r := public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t1');
  exception when others then
    raise exception 'T1 FAIL the pour was refused: % %', sqlstate, sqlerrm;
  end;
  s := pg_temp.aw08_state(it);
  assert s = '0+0 | 2+625', format('T1 FAIL lots are %s, expected 0+0 | 2+625', s);
  assert (select stock_live from public.restaurant_inventory where id = it) = 2, 'T1 FAIL stock_live is not 2';
  assert (r->>'bottles_opened')::int = 1, format('T1 FAIL bottles_opened %s, expected 1', r->>'bottles_opened');
  assert pg_temp.aw08_sales(it) = 1, 'T1 FAIL expected one sale ledger row';
  select quantity_change, quantity_before, quantity_after into t
    from public.inventory_transactions where inventory_id = it and transaction_type = 'sale';
  assert t.quantity_change = -1 and t.quantity_before = 3 and t.quantity_after = 2,
    format('T1 FAIL ledger row %s %s->%s, expected -1 3->2', t.quantity_change, t.quantity_before, t.quantity_after);
  assert (r->>'txn')::uuid is not null, 'T1 FAIL the result carries no ledger txn';
end $$;

-- T2 the next pours keep flowing and the millilitres are conserved; the next
-- bottle comes from the same lot once its open bottle runs short.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000201';
  g int;
  s text;
begin
  for g in 1..4 loop
    begin
      perform public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t2-' || g);
    exception when others then
      raise exception 'T2 FAIL pour % was refused: % %', g, sqlstate, sqlerrm;
    end;
  end loop;
  s := pg_temp.aw08_state(it);
  assert s = '0+0 | 2+25', format('T2 FAIL lots are %s, expected 0+0 | 2+25', s);
  assert pg_temp.aw08_ml(it) = 2275 - 750, format('T2 FAIL %s ml left, expected 1525', pg_temp.aw08_ml(it));
  assert pg_temp.aw08_sales(it) = 1, 'T2 FAIL a pour the open bottle covered wrote a ledger row';
  perform public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t2-5');
  s := pg_temp.aw08_state(it);
  assert s = '0+0 | 1+625', format('T2 FAIL lots are %s after the fifth pour, expected 0+0 | 1+625', s);
  assert pg_temp.aw08_sales(it) = 2, 'T2 FAIL the fifth pour opened a bottle but wrote no ledger row';
  assert (select stock_live from public.restaurant_inventory where id = it) = 1, 'T2 FAIL stock_live is not 1';
end $$;

-- T3 six pours in one call, across three lots: one ledger row of -2.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000202';
  r jsonb;
  s text;
  t record;
begin
  begin
    r := public.record_glass_pour(it, 6, null, null, 'pos', null, 'aw08 test', 'aw08-test:t3');
  exception when others then
    raise exception 'T3 FAIL the pour was refused: % %', sqlstate, sqlerrm;
  end;
  s := pg_temp.aw08_state(it);
  assert s = '0+0 | 0+0 | 0+700', format('T3 FAIL lots are %s, expected 0+0 | 0+0 | 0+700', s);
  assert (r->>'bottles_opened')::int = 2, format('T3 FAIL bottles_opened %s, expected 2', r->>'bottles_opened');
  assert pg_temp.aw08_sales(it) = 1, 'T3 FAIL expected one sale ledger row';
  select quantity_change, quantity_before, quantity_after into t
    from public.inventory_transactions where inventory_id = it and transaction_type = 'sale';
  assert t.quantity_change = -2 and t.quantity_before = 2 and t.quantity_after = 0,
    format('T3 FAIL ledger row %s %s->%s, expected -2 2->0', t.quantity_change, t.quantity_before, t.quantity_after);
  assert (select count(*) from public.inventory_lots where inventory_id = it) = 3,
    'T3 FAIL a drained lot was deleted (ADR 0115 R6 keeps it at 0)';
end $$;

-- T4 a pour larger than a bottle opens as many bottles as it needs.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000203';
  r jsonb;
  s text;
begin
  begin
    r := public.record_glass_pour(it, 1, 1000, null, 'manual', null, 'aw08 test', 'aw08-test:t4');
  exception when others then
    raise exception 'T4 FAIL the pour was refused: % %', sqlstate, sqlerrm;
  end;
  s := pg_temp.aw08_state(it);
  assert s = '0+500', format('T4 FAIL lots are %s, expected 0+500', s);
  assert (r->>'bottles_opened')::int = 2, format('T4 FAIL bottles_opened %s, expected 2', r->>'bottles_opened');
end $$;

-- T5 a pour of 0 ml or less is refused 22023, and nothing moves.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000204';
  ml int;
  s text;
begin
  foreach ml in array array[-150, 0] loop
    begin
      perform public.record_glass_pour(it, 1, ml, null, 'manual', null, 'aw08 test', 'aw08-test:t5:' || ml);
      raise exception 'T5 FAIL a % ml pour was recorded; lots now %', ml, pg_temp.aw08_state(it);
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  s := pg_temp.aw08_state(it);
  assert s = '1+300', format('T5 FAIL lots are %s, expected 1+300', s);
  assert pg_temp.aw08_pours(it) = 0, 'T5 FAIL a refused pour left a pour_events row';
end $$;

-- T5n a missing pour count is refused 22004 (it was before, from the FOR loop).
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000204';
begin
  begin
    perform public.record_glass_pour(it, null, null, null, 'manual', null, 'aw08 test', 'aw08-test:t5n');
    raise exception 'T5n FAIL a null pour count was recorded; lots now %', pg_temp.aw08_state(it);
  exception when null_value_not_allowed then
    null;
  end;
  assert pg_temp.aw08_state(it) = '1+300', 'T5n FAIL lots moved';
end $$;

-- T6 unchanged: the remainder within one lot still opens that lot's bottle.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000205';
  s text;
begin
  perform public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t6');
  s := pg_temp.aw08_state(it);
  assert s = '1+700', format('T6 FAIL lots are %s, expected 1+700', s);
  assert pg_temp.aw08_sales(it) = 1, 'T6 FAIL expected one sale ledger row';
end $$;

-- T7 unchanged: an open bottle that covers the pour opens nothing and writes
-- no ledger row, but does write the pour.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000206';
  r jsonb;
  s text;
begin
  r := public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t7');
  s := pg_temp.aw08_state(it);
  assert s = '1+150', format('T7 FAIL lots are %s, expected 1+150', s);
  assert (r->>'bottles_opened')::int = 0 and r->'txn' = 'null'::jsonb,
    format('T7 FAIL result %s, expected bottles_opened 0 and txn null', r);
  assert pg_temp.aw08_sales(it) = 0, 'T7 FAIL a covered pour wrote a ledger row';
  assert pg_temp.aw08_pours(it) = 1, 'T7 FAIL the pour has no pour_events row';
end $$;

-- T8 unchanged (ADR 0285, fork 1): when the whole item holds less than the
-- call, it raises and nothing moves; an item with nothing raises too.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000207';
  empty uuid := 'a0080000-0000-4000-8000-000000000208';
  msg text;
begin
  begin
    perform public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t8');
    raise exception 'T8 FAIL a short item poured; lots now %', pg_temp.aw08_state(it);
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like 'insufficient stock for a full pour on inventory %', format('T8 FAIL refused with: %s', msg);
  end;
  assert pg_temp.aw08_state(it) = '0+25', 'T8 FAIL lots moved';
  assert pg_temp.aw08_pours(it) = 0, 'T8 FAIL a refused pour left a pour_events row';
  begin
    perform public.record_glass_pour(empty, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t8-empty');
    raise exception 'T8 FAIL an empty item poured';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    assert msg like 'no stock to pour for inventory %', format('T8 FAIL empty item refused with: %s', msg);
  end;
end $$;

-- T9 unchanged: at a location, that location's sealed bottle is opened before
-- an older open bottle elsewhere.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000209';
  s text;
begin
  perform public.record_glass_pour(it, 1, null, 'a0080000-0000-4000-8000-000000000301', 'pos', null, 'aw08 test', 'aw08-test:t9');
  s := pg_temp.aw08_state(it);
  assert s = '0+300 | 0+600', format('T9 FAIL lots are %s, expected 0+300 | 0+600', s);
end $$;

-- T10 unchanged: a replayed idempotency key (T7's) moves nothing.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000206';
  before_state text := pg_temp.aw08_state(it);
  before_sales bigint := pg_temp.aw08_sales(it);
  r jsonb;
begin
  r := public.record_glass_pour(it, 1, null, null, 'pos', null, 'aw08 test', 'aw08-test:t7');
  assert (r->>'idempotent')::boolean, format('T10 FAIL a replay was not recognised: %s', r);
  assert pg_temp.aw08_state(it) = before_state, 'T10 FAIL a replay moved stock';
  assert pg_temp.aw08_sales(it) = before_sales, 'T10 FAIL a replay wrote a ledger row';
end $$;

-- T11 structural: exactly one overload, the identity arguments, jsonb,
-- SECURITY INVOKER. Since a_pos_sale_is_dated_by_its_check (ADR 0281, fork F3:
-- it owns p_occurred_at and merged after this file) the one overload takes a
-- 9th argument, so on a build with only this migration T11 fails by design.
do $$
declare
  n int;
  o oid;
begin
  select count(*), min(p.oid) into n, o
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'record_glass_pour';
  assert n = 1, format('T11 FAIL %s overloads of public.record_glass_pour', n);
  assert pg_get_function_identity_arguments(o) =
    'p_inventory_id uuid, p_pours integer, p_pour_ml integer, p_location_id uuid, p_source text, p_performed_by uuid, p_reason text, p_idempotency_key text, p_occurred_at timestamp with time zone',
    format('T11 FAIL identity arguments are %s', pg_get_function_identity_arguments(o));
  assert (select prorettype from pg_proc where oid = o) = 'jsonb'::regtype, 'T11 FAIL it no longer returns jsonb';
  assert not (select prosecdef from pg_proc where oid = o), 'T11 FAIL it became SECURITY DEFINER';
end $$;

-- T12 at a location whose lot is stranded, the pour takes its 25 ml and opens
-- a sealed bottle from another location.
do $$
declare
  it uuid := 'a0080000-0000-4000-8000-000000000210';
  s text;
begin
  begin
    perform public.record_glass_pour(it, 1, null, 'a0080000-0000-4000-8000-000000000301', 'pos', null, 'aw08 test', 'aw08-test:t12');
  exception when others then
    raise exception 'T12 FAIL the pour was refused: % %', sqlstate, sqlerrm;
  end;
  s := pg_temp.aw08_state(it);
  assert s = '0+0 | 2+625', format('T12 FAIL lots are %s, expected 0+0 | 2+625', s);
end $$;

rollback;
