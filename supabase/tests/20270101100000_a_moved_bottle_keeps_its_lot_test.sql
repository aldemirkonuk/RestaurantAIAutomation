-- F-427 / F-428 (sim S64, inventory-count-waste findings 1-2). A location
-- transfer re-inserted a bare lot (no delivery_id, received_at = now(),
-- cost_state 'provisional'), and transfer_stock / apply_stock_movement deleted
-- a lot whose sealed bottles ran out together with its open bottle's ml.
-- Migration a_moved_bottle_keeps_its_lot splits or re-points the lot and keeps
-- a used-up lot that still holds open ml.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1`
-- stops at the first one. Synthetic fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT the migration, T1, T2, T3, T4, T5 and T6 FAIL. T7 passes
-- on both builds: it pins what the migration keeps (a used-up lot with no open
-- bottle is still deleted, and the transfer's ledger pair is unchanged).

begin;

create function pg_temp.mb_state(p uuid, p_loc uuid) returns text language sql as $$
  select coalesce(string_agg(qty || '+' || open_bottle_ml, ' | ' order by received_at, created_at, id), '')
    from public.inventory_lots
   where inventory_id = p and stock_state = 'live' and location_id is not distinct from p_loc
$$;
create function pg_temp.mb_ml(p uuid) returns bigint language sql as $$
  select coalesce(sum(open_bottle_ml), 0) + coalesce(sum(qty), 0) * 750
    from public.inventory_lots where inventory_id = p and stock_state = 'live'
$$;

do $$
declare
  h uuid := 'f4270000-0000-4000-8000-000000000001';
  i int;
begin
  insert into public.restaurants (id, name, slug) values (h, 'F427 test house', 'f427-test-house');
  for i in 1..6 loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (('f4270000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
            'F427-TEST-' || i, 'F427 test wine ' || i, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (('f4270000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, h,
            ('f4270000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 750, 150);
  end loop;
  insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles) values
    ('f4270000-0000-4000-8000-000000000301', h, 'F427 cellar', 100),
    ('f4270000-0000-4000-8000-000000000302', h, 'F427 bar', 100);
  insert into public.deliveries (id, restaurant_id, state) values
    ('f4270000-0000-4000-8000-000000000401', h, 'DELIVERED');

  -- T1/T2: 12 bottles booked at the door, provisional, 30 days old, in the cellar.
  insert into public.inventory_lots (id, restaurant_id, inventory_id, master_wine_id, location_id, qty,
                                     received_at, delivery_id, cost_state, cost_provenance, vintage)
  select 'f4270000-0000-4000-8000-000000000501', h, ri.id, ri.master_wine_id, 'f4270000-0000-4000-8000-000000000301', 12,
         now() - interval '30 days', 'f4270000-0000-4000-8000-000000000401', 'provisional', 'estimated', 2019
    from public.restaurant_inventory ri where ri.id = 'f4270000-0000-4000-8000-000000000201';
  -- T2: the same shape on its own item, so T2 does not lean on T1's move.
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, qty,
                                     received_at, delivery_id, cost_state, cost_provenance)
  select h, ri.id, ri.master_wine_id, 'f4270000-0000-4000-8000-000000000301', 12,
         now() - interval '30 days', 'f4270000-0000-4000-8000-000000000401', 'provisional', 'estimated'
    from public.restaurant_inventory ri where ri.id = 'f4270000-0000-4000-8000-000000000206';
  -- T3: a final-cost lot (60 days, cellar, 2) and a newer one (5 days, bar, 2).
  insert into public.inventory_lots (id, restaurant_id, inventory_id, master_wine_id, location_id, qty,
                                     received_at, cost_state, cost_provenance, unit_cost)
  select x.id, h, ri.id, ri.master_wine_id, x.loc, 2, now() - make_interval(days => x.d), 'final', 'invoice', x.c
    from public.restaurant_inventory ri,
         (values ('f4270000-0000-4000-8000-000000000502'::uuid, 'f4270000-0000-4000-8000-000000000301'::uuid, 60, 10.00),
                 ('f4270000-0000-4000-8000-000000000503'::uuid, 'f4270000-0000-4000-8000-000000000302'::uuid, 5, 20.00)) x(id, loc, d, c)
   where ri.id = 'f4270000-0000-4000-8000-000000000202';
  -- T4/T5: the bar lot holds 3 sealed + 600 ml open.
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, qty, open_bottle_ml, received_at)
  select h, ri.id, ri.master_wine_id, 'f4270000-0000-4000-8000-000000000302', 3, 600, now() - interval '10 days'
    from public.restaurant_inventory ri where ri.id = 'f4270000-0000-4000-8000-000000000203';
  -- T6: 2 sealed + 300 ml open, counted / adjusted down to 0 sealed.
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
  select h, ri.id, ri.master_wine_id, 2, 300, now() - interval '10 days'
    from public.restaurant_inventory ri where ri.id = 'f4270000-0000-4000-8000-000000000204';
  -- T7: no open bottle anywhere.
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, qty, received_at)
  select h, ri.id, ri.master_wine_id, 'f4270000-0000-4000-8000-000000000301', 2, now() - interval '10 days'
    from public.restaurant_inventory ri where ri.id = 'f4270000-0000-4000-8000-000000000205';
end $$;

-- T1 a partial transfer: the moved bottles keep their delivery, date, cost
-- state, provenance and vintage.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000201';
  src record; dst record;
begin
  perform public.transfer_stock(it, 'f4270000-0000-4000-8000-000000000301', 'f4270000-0000-4000-8000-000000000302', 6, null, 'f427 t1');
  select * into src from public.inventory_lots where inventory_id = it and location_id = 'f4270000-0000-4000-8000-000000000301';
  select * into dst from public.inventory_lots where inventory_id = it and location_id = 'f4270000-0000-4000-8000-000000000302';
  assert src.id = 'f4270000-0000-4000-8000-000000000501' and src.qty = 6, format('T1 FAIL source lot %s qty %s', src.id, src.qty);
  assert dst.qty = 6, format('T1 FAIL bar lot qty %s, expected 6', dst.qty);
  assert dst.delivery_id is not distinct from 'f4270000-0000-4000-8000-000000000401'::uuid,
    format('T1 FAIL the moved bottles lost their delivery (delivery_id %s)', dst.delivery_id);
  assert dst.received_at = src.received_at,
    format('T1 FAIL the moved bottles were re-dated %s, received %s', dst.received_at, src.received_at);
  assert dst.cost_state = 'provisional' and dst.cost_provenance = 'estimated' and dst.vintage = 2019,
    format('T1 FAIL moved lot %s/%s/%s', dst.cost_state, dst.cost_provenance, dst.vintage);
  assert dst.open_bottle_ml = 0, 'T1 FAIL the copy carries open ml it was not given';
end $$;

-- T2 the invoice verified after a move prices both halves.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000206';
  r jsonb;
  n int;
begin
  perform public.transfer_stock(it, 'f4270000-0000-4000-8000-000000000301', 'f4270000-0000-4000-8000-000000000302', 6, null, 'f427 t2');
  r := public.finalise_delivery_cost('f4270000-0000-4000-8000-000000000401', it, 15.00, 'invoice', null, 'f427 t2');
  select count(*) into n from public.inventory_lots
   where inventory_id = it and qty > 0 and (cost_state <> 'final' or unit_cost is distinct from 15.00);
  assert n = 0, format('T2 FAIL %s lot(s) still uncosted after VERIFIED: %s', n, r);
end $$;

-- T3 a whole lot moved keeps its id, its date and its final cost, and FIFO
-- still drains it first.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000202';
  l record;
begin
  perform public.transfer_stock(it, 'f4270000-0000-4000-8000-000000000301', 'f4270000-0000-4000-8000-000000000302', 2, null, 'f427 t3');
  select * into l from public.inventory_lots where id = 'f4270000-0000-4000-8000-000000000502';
  assert l.id is not null, 'T3 FAIL the moved lot was deleted and re-inserted (its id is gone)';
  assert l.location_id = 'f4270000-0000-4000-8000-000000000302' and l.qty = 2 and l.cost_state = 'final' and l.unit_cost = 10.00,
    format('T3 FAIL moved lot at %s qty %s %s %s', l.location_id, l.qty, l.cost_state, l.unit_cost);
  perform public.apply_stock_movement(it, 'live', -1, 'sale', 'manual', null, 'f427 t3 sale');
  assert (select qty from public.inventory_lots where id = 'f4270000-0000-4000-8000-000000000502') = 1
     and (select qty from public.inventory_lots where id = 'f4270000-0000-4000-8000-000000000503') = 2,
    'T3 FAIL the sale did not take the oldest bottle (FIFO flipped by the move)';
end $$;

-- T4 moving every sealed bottle off a lot with an open bottle: the open
-- bottle stays at the bar, no ml are lost.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000203';
  bar uuid := 'f4270000-0000-4000-8000-000000000302';
  cellar uuid := 'f4270000-0000-4000-8000-000000000301';
  s text;
begin
  perform public.transfer_stock(it, bar, cellar, 3, null, 'f427 t4');
  s := pg_temp.mb_state(it, bar);
  assert s = '0+600', format('T4 FAIL bar lots are "%s", expected 0+600', s);
  s := pg_temp.mb_state(it, cellar);
  assert s = '3+0', format('T4 FAIL cellar lots are "%s", expected 3+0', s);
  assert pg_temp.mb_ml(it) = 3 * 750 + 600, format('T4 FAIL %s ml on the books, expected 2850', pg_temp.mb_ml(it));
  assert (select stock_live from public.restaurant_inventory where id = it) = 3, 'T4 FAIL stock_live is not 3';
end $$;

-- T5 the next glass at the bar comes out of that open bottle.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000203';
  r jsonb;
begin
  r := public.record_glass_pour(it, 1, null, 'f4270000-0000-4000-8000-000000000302', 'pos', null, 'f427 t5', 'f427-test:t5');
  assert (r->>'bottles_opened')::int = 0, format('T5 FAIL the glass opened a new bottle: %s', r);
  assert pg_temp.mb_state(it, 'f4270000-0000-4000-8000-000000000302') = '0+450', 'T5 FAIL bar open bottle not 450 ml';
end $$;

-- T6 a count / breakage that empties a lot's sealed bottles keeps its open ml.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000204';
  s text;
begin
  perform public.apply_stock_movement(it, 'live', -2, 'waste', 'manual', null, 'f427 t6 breakage');
  s := pg_temp.mb_state(it, null);
  assert s = '0+300', format('T6 FAIL lots are "%s", expected 0+300 (the open bottle vanished)', s);
  assert (select stock_live from public.restaurant_inventory where id = it) = 0, 'T6 FAIL stock_live is not 0';
end $$;

-- T7 kept: a used-up lot with no open bottle is still deleted, and a transfer
-- still writes one balanced out/in pair.
do $$
declare
  it uuid := 'f4270000-0000-4000-8000-000000000205';
  n int;
begin
  perform public.transfer_stock(it, 'f4270000-0000-4000-8000-000000000301', 'f4270000-0000-4000-8000-000000000302', 2, null, 'f427 t7');
  select count(*) into n from public.inventory_transactions
   where inventory_id = it and transaction_type = 'transfer'
   group by metadata->>'transfer_group' having sum(quantity_change) = 0;
  assert n = 2, format('T7 FAIL expected one balanced transfer pair, got %s', n);
  perform public.apply_stock_movement(it, 'live', -2, 'sale', 'manual', null, 'f427 t7 sale');
  select count(*) into n from public.inventory_lots where inventory_id = it;
  assert n = 0, format('T7 FAIL an empty lot with no open bottle was kept (%s rows)', n);
end $$;

rollback;
