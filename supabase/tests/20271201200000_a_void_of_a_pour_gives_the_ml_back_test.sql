-- r57 table side D1: a void of a pour returns the poured ml to the open bottle
-- and rolls a whole bottle only when the open ml cross a bottle. Before this
-- migration a void put WHOLE bottles back (five voided glasses = five bottles).
--
-- Self-asserting: every block asserts (P0004) or raises naming the test. Run on
-- a database built from supabase/migrations. Synthetic fixtures, one
-- transaction, rolled back.

begin;

create function pg_temp.rv_state(p uuid) returns text language sql as $$
  select coalesce(string_agg(qty || '+' || open_bottle_ml, ' | ' order by received_at, created_at, id), 'none')
    from public.inventory_lots where inventory_id = p and stock_state = 'live'
$$;
create function pg_temp.rv_ml(p uuid) returns bigint language sql as $$
  select coalesce(sum(l.open_bottle_ml), 0) + coalesce(sum(l.qty), 0) * max(coalesce(ri.bottle_size_ml, 750))
    from public.inventory_lots l join public.restaurant_inventory ri on ri.id = l.inventory_id
   where l.inventory_id = p and l.stock_state = 'live'
$$;
create function pg_temp.rv_lot(p_item uuid, p_qty int, p_open int, p_days int)
returns void language sql as $$
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
  select ri.restaurant_id, ri.id, ri.master_wine_id, p_qty, p_open, now() - make_interval(days => p_days)
    from public.restaurant_inventory ri where ri.id = p_item
$$;

do $$
declare
  h uuid := 'a0090000-0000-4000-8000-000000000001';
  h2 uuid := 'a0090000-0000-4000-8000-000000000002';
  i int;
begin
  insert into public.restaurants (id, name, slug) values (h, 'RV test house', 'rv-test-house'), (h2, 'RV other house', 'rv-other-house');
  for i in 1..12 loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (('a0090000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'RV-TEST-' || i, 'RV test wine ' || i, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (('a0090000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, h,
            ('a0090000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 750, 150);
  end loop;
  -- 1: six sealed. 2: 1 sealed + 600 open. 3: 2 sealed. 4: old sealed + newer open.
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000201', 6, 0, 5);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000202', 1, 600, 5);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000203', 2, 0, 5);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000204', 2, 0, 9);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000204', 0, 300, 3);
  -- 5: nothing at all. 6: idempotency. 7: wrong house. 8: round trips. 9: dating.
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000206', 3, 0, 5);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000207', 3, 0, 5);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000208', 4, 0, 5);
  perform pg_temp.rv_lot('a0090000-0000-4000-8000-000000000209', 3, 0, 5);
end $$;

-- R1: five voided 150 ml glasses give 750 ml back, not five bottles.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000201'; h uuid := 'a0090000-0000-4000-8000-000000000001'; r jsonb;
begin
  perform public.record_glass_pour(p_inventory_id => it, p_pours => 5, p_pour_ml => 150, p_idempotency_key => 'rv-r1-sale');
  assert pg_temp.rv_ml(it) = 6 * 750 - 750, format('R1 setup: %s ml after the sale', pg_temp.rv_ml(it));
  r := public.return_glass_pour(p_inventory_id => it, p_pours => 5, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r1-sale:void');
  assert pg_temp.rv_ml(it) = 6 * 750, format('R1 FAIL a void of 5 glasses left %s ml, expected 4500 (not whole bottles)', pg_temp.rv_ml(it));
  assert pg_temp.rv_state(it) = '6+0', format('R1 FAIL lots read %s, expected 6+0', pg_temp.rv_state(it));
end $$;

-- R2: a pour that opened a bottle and its return leave the lots as they were.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000203'; h uuid := 'a0090000-0000-4000-8000-000000000001';
begin
  perform public.record_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_idempotency_key => 'rv-r2-sale');
  assert pg_temp.rv_state(it) = '1+600', format('R2 setup: %s', pg_temp.rv_state(it));
  perform public.return_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r2-sale:void');
  assert pg_temp.rv_state(it) = '2+0', format('R2 FAIL the closed bottle did not roll back: %s', pg_temp.rv_state(it));
  assert (select quantity_change from public.inventory_transactions where inventory_id = it and transaction_type = 'return') = 1,
    'R2 FAIL the rolled bottle is not one return ledger row of +1';
end $$;

-- R3: a part-glass return stays in the open bottle and writes no ledger row.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000202'; h uuid := 'a0090000-0000-4000-8000-000000000001';
begin
  perform public.return_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 50, p_restaurant_id => h, p_idempotency_key => 'rv-r3');
  assert pg_temp.rv_state(it) = '1+650', format('R3 FAIL %s, expected 1+650', pg_temp.rv_state(it));
  assert not exists (select 1 from public.inventory_transactions where inventory_id = it and transaction_type = 'return'),
    'R3 FAIL a return that rolled no bottle wrote a ledger row';
end $$;

-- R4: open ml crossing a bottle roll one whole bottle and keep the rest.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000202'; h uuid := 'a0090000-0000-4000-8000-000000000001';
begin
  perform public.return_glass_pour(p_inventory_id => it, p_pours => 2, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r4');
  assert pg_temp.rv_state(it) = '2+200', format('R4 FAIL %s, expected 2+200 (650 open + 300 = 950 = 1 bottle + 200)', pg_temp.rv_state(it));
end $$;

-- R5: a replayed return gives nothing back twice.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000206'; h uuid := 'a0090000-0000-4000-8000-000000000001'; r jsonb; before_ml bigint;
begin
  perform public.record_glass_pour(p_inventory_id => it, p_pours => 2, p_pour_ml => 150, p_idempotency_key => 'rv-r5-sale');
  perform public.return_glass_pour(p_inventory_id => it, p_pours => 2, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r5-sale:void');
  before_ml := pg_temp.rv_ml(it);
  r := public.return_glass_pour(p_inventory_id => it, p_pours => 2, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r5-sale:void');
  assert (r->>'idempotent')::boolean, 'R5 FAIL a replay was not answered as idempotent';
  assert pg_temp.rv_ml(it) = before_ml, 'R5 FAIL a replayed return moved ml again';
  assert (select count(*) from public.pour_events where idempotency_key = 'rv-r5-sale:void') = 1, 'R5 FAIL two return rows for one key';
end $$;

-- R6: an item that is not the named house's is refused and nothing moves.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000207'; h2 uuid := 'a0090000-0000-4000-8000-000000000002'; st text := 'none';
begin
  begin
    perform public.return_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_restaurant_id => h2, p_idempotency_key => 'rv-r6');
  exception when others then st := sqlstate;
  end;
  assert st = '42501', format('R6 FAIL the other house was not refused (sqlstate %s)', st);
  assert pg_temp.rv_state(it) = '3+0', 'R6 FAIL a refused return moved stock';
  assert not exists (select 1 from public.pour_events where idempotency_key = 'rv-r6'), 'R6 FAIL a refused return wrote a pour_events row';
end $$;

-- R7: an item with no live lot raises and writes nothing.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000205'; h uuid := 'a0090000-0000-4000-8000-000000000001'; ok boolean := false;
begin
  begin
    perform public.return_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r7');
  exception when others then ok := position('no live lot' in sqlerrm) > 0;
  end;
  assert ok, 'R7 FAIL a return with no lot to take it did not raise its own refusal';
  assert not exists (select 1 from public.pour_events where idempotency_key = 'rv-r7'), 'R7 FAIL it still wrote a pour_events row';
end $$;

-- R8: the ml go to the lot already holding an open bottle, not the oldest sealed one.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000204'; h uuid := 'a0090000-0000-4000-8000-000000000001';
begin
  perform public.return_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r8');
  assert pg_temp.rv_state(it) = '2+0 | 0+450', format('R8 FAIL %s, expected 2+0 | 0+450', pg_temp.rv_state(it));
end $$;

-- R9: pour then return, any size, conserves ml; the ledger row is dated by the check.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000208'; h uuid := 'a0090000-0000-4000-8000-000000000001';
  start_ml bigint := pg_temp.rv_ml('a0090000-0000-4000-8000-000000000208'); k int;
begin
  for k in 1..25 loop
    perform public.record_glass_pour(p_inventory_id => it, p_pours => k % 4 + 1, p_pour_ml => 40 + k * 7, p_idempotency_key => 'rv-r9-s' || k);
    perform public.return_glass_pour(p_inventory_id => it, p_pours => k % 4 + 1, p_pour_ml => 40 + k * 7, p_restaurant_id => h, p_idempotency_key => 'rv-r9-s' || k || ':void');
    assert pg_temp.rv_ml(it) = start_ml, format('R9 FAIL after pour+return %s the item holds %s ml, started %s', k, pg_temp.rv_ml(it), start_ml);
    assert (select max(open_bottle_ml) from public.inventory_lots where inventory_id = it) < 750, 'R9 FAIL open ml reached a bottle without rolling it';
  end loop;
end $$;

do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000209'; h uuid := 'a0090000-0000-4000-8000-000000000001'; d timestamptz := now() - interval '3 days';
begin
  perform public.record_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_idempotency_key => 'rv-r9d-sale');
  perform public.return_glass_pour(p_inventory_id => it, p_pours => 1, p_pour_ml => 150, p_restaurant_id => h, p_idempotency_key => 'rv-r9d-sale:void', p_occurred_at => d);
  assert (select transaction_date from public.inventory_transactions where inventory_id = it and transaction_type = 'return') = d,
    'R9 FAIL the return ledger row is not dated by the check';
  assert (select pours from public.pour_events where idempotency_key = 'rv-r9d-sale:void') = -1, 'R9 FAIL the return is not recorded as negative pours';
end $$;

-- R10: guards. A null count is refused, zero is a no-op, and the API roles cannot call it.
do $$
declare it uuid := 'a0090000-0000-4000-8000-000000000209'; st text := 'none'; r jsonb;
begin
  begin
    perform public.return_glass_pour(p_inventory_id => it, p_pours => null);
  exception when others then st := sqlstate;
  end;
  assert st = '22004', format('R10 FAIL a null count gave sqlstate %s', st);
  r := public.return_glass_pour(p_inventory_id => it, p_pours => 0);
  assert (r->>'returned')::int = 0, 'R10 FAIL zero pours was not a no-op';
  assert not has_function_privilege('anon', 'public.return_glass_pour(uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz)', 'EXECUTE'), 'R10 FAIL anon can call it';
  assert not has_function_privilege('authenticated', 'public.return_glass_pour(uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz)', 'EXECUTE'), 'R10 FAIL authenticated can call it';
end $$;

rollback;
