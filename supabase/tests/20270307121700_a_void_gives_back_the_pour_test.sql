-- G11; psql -v ON_ERROR_STOP=1, rolled back. Without the migration: 42883.
-- Main books V1 as 2700 ml where 1500 ml stood.

begin;

create function pg_temp.it(n int) returns uuid language sql as $$
  select ('a2000000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.h() returns uuid language sql as $$
  select 'a2000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.st(p uuid) returns text language sql as $$
  select string_agg(qty || '+' || open_bottle_ml, ' | ' order by received_at, created_at, id)
    from public.inventory_lots where inventory_id = p and stock_state = 'live' $$;
create function pg_temp.ml(p uuid) returns bigint language sql as $$
  select coalesce(sum(open_bottle_ml), 0) + coalesce(sum(qty), 0) * 750
    from public.inventory_lots where inventory_id = p and stock_state = 'live' $$;
create function pg_temp.rets(p uuid) returns bigint language sql as $$
  select count(*) from public.inventory_transactions where inventory_id = p and transaction_type = 'return' $$;
create function pg_temp.lot(n int, q int, o int, d int) returns void language sql as $$
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
  select restaurant_id, id, master_wine_id, q, o, now() - make_interval(days => d)
    from public.restaurant_inventory where id = pg_temp.it(n) $$;
create function pg_temp.sell(n int, g int, k text) returns void language sql as $$
  select public.record_glass_pour(pg_temp.it(n), g, 150, null, 'pos', null, 'a2 test', k) $$;
create function pg_temp.vd(n int, k text, g int, vk text, ts timestamptz default null) returns jsonb language sql as $$
  select public.return_glass_pour(pg_temp.h(), pg_temp.it(n), k, g, vk, ts) $$;

do $$
declare i int;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.h(), 'A2 test house', 'a2-test-house');
  for i in 1..6 loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (('a2000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'A2-TEST-' || i, 'A2 wine ' || i, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (pg_temp.it(i), pg_temp.h(), ('a2000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 750, 150);
  end loop;
  perform pg_temp.lot(1, 2, 0, 3); -- V1-V4
  perform pg_temp.lot(2, 1, 0, 3); -- V5: never sold
  perform pg_temp.lot(3, 0, 100, 9); perform pg_temp.lot(3, 1, 0, 3); -- V6: straddle
  perform pg_temp.lot(4, 2, 0, 3); -- V7
  perform pg_temp.lot(5, 0, 700, 3); -- V8
  perform pg_temp.lot(6, 1, 0, 3); -- V9
  perform pg_temp.sell(1, 2, 'a2:s1');
  assert pg_temp.st(pg_temp.it(1)) = '1+450', 'setup: the sale did not open one bottle';
end $$;

-- V1 300 ml back; the bottle the sale opened is sealed again.
do $$
declare r jsonb; t record; it uuid := pg_temp.it(1);
begin
  r := pg_temp.vd(1, 'a2:s1', 2, 'a2:s1:void', '2026-11-06T21:00:00Z');
  assert pg_temp.ml(it) = 1500, format('V1 FAIL %s ml', pg_temp.ml(it));
  assert pg_temp.st(it) = '2+0', 'V1 FAIL lots';
  assert (r->>'returned_ml')::int = 300 and (r->>'bottles_folded')::int = 1 and (r->>'overflow_ml')::int = 0,
    format('V1 FAIL result %s', r);
  select * into t from public.inventory_transactions where inventory_id = it and transaction_type = 'return';
  assert t.quantity_change = 1 and t.quantity_after = 2 and t.idempotency_key = 'a2:s1:void', 'V1 FAIL return row';
  assert t.transaction_date = '2026-11-06T21:00:00Z'::timestamptz, 'V1 FAIL date';
  assert (select pours from public.pour_events where idempotency_key = 'a2:s1:void') = -2, 'V1 FAIL pour row';
end $$;

-- V2 a replayed void moves nothing.
do $$
declare r jsonb := pg_temp.vd(1, 'a2:s1', 2, 'a2:s1:void');
begin
  assert (r->>'idempotent')::boolean, format('V2 FAIL not idempotent: %s', r);
  assert pg_temp.st(pg_temp.it(1)) = '2+0' and pg_temp.rets(pg_temp.it(1)) = 1, 'V2 FAIL replay moved stock';
end $$;

-- V3 another house, or none, cannot void it (ADR 0141).
do $$
begin
  perform pg_temp.sell(1, 1, 'a2:s3');
  begin
    perform public.return_glass_pour(gen_random_uuid(), pg_temp.it(1), 'a2:s3', 1, 'a2:s3:void');
    raise exception 'V3 FAIL another house voided the pour';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.return_glass_pour(null, pg_temp.it(1), 'a2:s3', 1, 'a2:s3:void');
    raise exception 'V3 FAIL no house accepted';
  exception when sqlstate '42501' then null;
  end;
  assert pg_temp.st(pg_temp.it(1)) = '1+600', 'V3 FAIL lots moved';
end $$;

-- V4 the void's key must not be the sale's key (ADR 0093 D5).
do $$
begin
  perform pg_temp.vd(1, 'a2:s3', 1, 'a2:s3');
  raise exception 'V4 FAIL sale key accepted';
exception when sqlstate '22023' then null;
end $$;

-- V5 no sale pour for this item moves nothing.
do $$
declare r jsonb;
begin
  r := pg_temp.vd(2, 'a2:never', 2, 'a2:never:void');
  assert r->>'reason' = 'no sale pour found' and pg_temp.st(pg_temp.it(2)) = '1+0', format('V5 FAIL %s', r);
  assert not exists (select 1 from public.pour_events where idempotency_key = 'a2:never:void'), 'V5 FAIL pour row';
  r := pg_temp.vd(2, 'a2:s1', 2, 'a2:other:void');  -- another item's sale
  assert r->>'reason' = 'no sale pour found', 'V5 FAIL another item''s sale';
end $$;

-- V6 a sale across two bottles: every ml and the sealed count come back.
do $$
begin
  perform pg_temp.sell(3, 2, 'a2:s6');
  assert pg_temp.st(pg_temp.it(3)) = '0+0 | 0+550', 'V6 setup';
  perform pg_temp.vd(3, 'a2:s6', 2, 'a2:s6:void');
  assert pg_temp.ml(pg_temp.it(3)) = 850 and pg_temp.st(pg_temp.it(3)) = '0+0 | 1+100',
    format('V6 FAIL lots %s', pg_temp.st(pg_temp.it(3)));
end $$;

-- V7 six glasses opened two bottles; both are sealed again.
do $$
begin
  perform pg_temp.sell(4, 6, 'a2:s7');
  perform pg_temp.vd(4, 'a2:s7', 6, 'a2:s7:void');
  assert pg_temp.st(pg_temp.it(4)) = '2+0', format('V7 FAIL lots %s', pg_temp.st(pg_temp.it(4)));
  assert (select quantity_change from public.inventory_transactions
           where inventory_id = pg_temp.it(4) and transaction_type = 'return') = 2, 'V7 FAIL return row';
end $$;

-- V8 more than the container holds is named, not added.
do $$
declare r jsonb;
begin
  perform pg_temp.sell(5, 1, 'a2:s8');
  update public.inventory_lots set open_bottle_ml = 700 where inventory_id = pg_temp.it(5);  -- a count
  r := pg_temp.vd(5, 'a2:s8', 1, 'a2:s8:void');
  assert (r->>'overflow_ml')::int = 100 and r->>'reason' = 'void above container cap', format('V8 FAIL %s', r);
  assert pg_temp.st(pg_temp.it(5)) = '0+750', format('V8 FAIL lots %s', pg_temp.st(pg_temp.it(5)));
end $$;

-- V9 never more glasses back than the sale poured.
do $$
declare r jsonb;
begin
  perform pg_temp.sell(6, 2, 'a2:s9');
  r := pg_temp.vd(6, 'a2:s9', 5, 'a2:s9:void');
  assert (r->>'returned_ml')::int = 300 and pg_temp.ml(pg_temp.it(6)) = 750, format('V9 FAIL %s', r);
end $$;

rollback;
