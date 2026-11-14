-- a_sale_carries_its_cost (cost-math lane 2.2): stock that leaves a lot
-- through apply_stock_movement writes one inventory_lot_draws row per lot it
-- touched, stamped with that lot's cost, and its ledger row carries
-- cost_total and unpriced_qty.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, one transaction,
-- rolled back. House N is u('N'), item x u('2x0'), wine u('1x0').

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c2200000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
-- A stock write through the real path, keyed 'sc-test:<k>'; returns the ledger row id.
create function pg_temp.mv(l text, q int, ty text, src text, k text, cost numeric default null, prov text default null)
returns uuid language sql as $$
  select public.apply_stock_movement(pg_temp.u('2' || l || '0'), 'live', q, ty, src, null, 'sc test', cost, null, null, 'sc-test:' || k, prov)
$$;
-- The lot of item l just added (received now, in this one transaction) is
-- dated `ago` back, so FIFO order is fixed.
create function pg_temp.age(l text, ago interval) returns void language sql as $$
  update public.inventory_lots set received_at = now() - ago
   where inventory_id = pg_temp.u('2' || l || '0') and received_at = now()
$$;
create function pg_temp.txn(k text) returns public.inventory_transactions language sql as $$
  select * from public.inventory_transactions where idempotency_key = 'sc-test:' || k
$$;

do $$
declare
  x text;
  t public.inventory_transactions;
  d record;
  v_id uuid;
  v_n int;
  v_older uuid;
begin
  insert into public.restaurants (id, name, slug) values
    (pg_temp.u('1'), 'SC test house 1', 'sc-test-house-1'),
    (pg_temp.u('2'), 'SC test house 2', 'sc-test-house-2');
  foreach x in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'SC-TEST-' || upper(x), 'SC test wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || x || '0'), pg_temp.u(case when x = 'f' then '2' else '1' end), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;

  -- A: lots 2 @ 10.00 (older) and 5 @ 12.00. Adding stock draws nothing.
  perform pg_temp.mv('a', 2, 'purchase', 'order', 'in-a1', 10.00, 'invoice');
  perform pg_temp.age('a', interval '2 days');
  perform pg_temp.mv('a', 5, 'purchase', 'order', 'in-a2', 12.00, 'invoice');
  perform pg_temp.age('a', interval '1 day');
  t := pg_temp.txn('in-a1');
  assert t.cost_total is null and t.unpriced_qty is null, 'a positive movement carries no cost_total and no unpriced_qty';
  assert not exists (select 1 from public.inventory_lot_draws where txn_id in ((pg_temp.txn('in-a1')).id, (pg_temp.txn('in-a2')).id)),
    'a positive movement writes no draw';

  -- Sell 3: 2 from the older lot at 10.00, 1 from the newer at 12.00
  -- = 20.00 + 12.00 = 32.00. (The lane brief and proposal 2.2 test (a) say 34;
  -- that is 1 @ 10 + 2 @ 12, newest first. FIFO gives 32.)
  v_id := pg_temp.mv('a', -3, 'sale', 'pos', 'sale-a');
  t := pg_temp.txn('sale-a');
  assert t.id = v_id;
  assert t.cost_total = 32.00, format('sell 3 from 2 @ 10 and 5 @ 12, oldest first, costs 32.00, got %s', t.cost_total);
  assert t.unpriced_qty = 0, format('every bottle priced: unpriced_qty 0, got %s', t.unpriced_qty);
  assert (select count(*) from public.inventory_lot_draws where txn_id = v_id) = 2, 'two lots touched, two draws';
  select l.id into v_older from public.inventory_lots l
   where l.inventory_id = pg_temp.u('2a0') order by l.received_at limit 1;
  select * into d from public.inventory_lot_draws where txn_id = v_id and lot_id = v_older;
  assert d.qty = 2 and d.unit_cost = 10.00 and d.cost_state = 'final' and d.cost_provenance = 'invoice'
     and d.restaurant_id = pg_temp.u('1') and d.inventory_id = pg_temp.u('2a0'),
    format('2 @ 10.00 from the older lot, got %s', row_to_json(d));
  select * into d from public.inventory_lot_draws where txn_id = v_id and lot_id <> v_older;
  assert d.qty = 1 and d.unit_cost = 12.00, format('1 @ 12.00 from the newer lot, got %s', row_to_json(d));
  -- The older lot was sold to zero: it still exists, depleted, and its draw points at it.
  assert (select qty = 0 and status = 'depleted' and depleted_at is not null
            from public.inventory_lots where id = v_older), 'a lot sold to zero is kept at 0, depleted (R6)';

  -- Replay with the same key: the same ledger row, still exactly its two draws, no stock moved.
  v_n := (select count(*) from public.inventory_lot_draws);
  assert pg_temp.mv('a', -3, 'sale', 'pos', 'sale-a') = v_id, 'a replay returns the first ledger row';
  assert (select count(*) from public.inventory_lot_draws) = v_n, 'a replay writes no new draw';
  assert (select count(*) from public.inventory_lot_draws where txn_id = v_id) = 2;
  assert (select sum(qty) from public.inventory_lots where inventory_id = pg_temp.u('2a0')) = 4, 'a replay moves no stock';

  -- B: one lot with no price; sell it out.
  perform pg_temp.mv('b', 1, 'adjustment', 'manual', 'in-b');
  v_id := pg_temp.mv('b', -1, 'sale', 'pos', 'sale-b');
  t := pg_temp.txn('sale-b');
  assert t.cost_total is null, format('no priced bottle left: cost_total NULL, never 0; got %s', t.cost_total);
  assert t.unpriced_qty = 1, format('one unpriced bottle, got %s', t.unpriced_qty);
  select * into d from public.inventory_lot_draws where txn_id = v_id;
  assert d.qty = 1 and d.unit_cost is null and d.cost_provenance = 'estimated', format('one draw with no price, got %s', row_to_json(d));
  assert (select count(*) from public.inventory_lot_draws where txn_id = v_id) = 1;
  assert (select qty = 0 and status = 'depleted' from public.inventory_lots where id = d.lot_id),
    'the unpriced lot sold out is kept, and its draw points at it';

  -- C: mixed. 1 @ 8.00 (older) then 2 with no price; sell 3 -> 8.00, 2 unpriced.
  perform pg_temp.mv('c', 1, 'purchase', 'order', 'in-c1', 8.00, 'manual');
  perform pg_temp.age('c', interval '2 days');
  perform pg_temp.mv('c', 2, 'adjustment', 'manual', 'in-c2');
  perform pg_temp.age('c', interval '1 day');
  v_id := pg_temp.mv('c', -3, 'waste', 'manual', 'waste-c');
  t := pg_temp.txn('waste-c');
  assert t.cost_total = 8.00 and t.unpriced_qty = 2,
    format('mixed: cost_total is the priced part only (8.00), 2 unpriced; got %s, %s', t.cost_total, t.unpriced_qty);
  assert (select count(*) from public.inventory_lot_draws where txn_id = v_id) = 2;
  assert (select count(*) from public.inventory_lot_draws where txn_id = v_id and unit_cost is null and qty = 2) = 1;

  -- D: a provisional price is stamped as provisional, and a later revaluation of
  -- the lot does not move what was stamped.
  perform pg_temp.mv('d', 2, 'purchase', 'order', 'in-d', 9.50, 'estimated');
  v_id := pg_temp.mv('d', -1, 'sale', 'pos', 'sale-d');
  select * into d from public.inventory_lot_draws where txn_id = v_id;
  assert d.unit_cost = 9.50 and d.cost_state = 'provisional' and d.cost_provenance = 'estimated',
    format('the draw keeps the lot''s state and provenance, got %s', row_to_json(d));
  update public.inventory_lots set unit_cost = 99.00 where id = d.lot_id;
  assert (select unit_cost from public.inventory_lot_draws where txn_id = v_id) = 9.50, 'the draw is stamped when the bottle left';
  assert (pg_temp.txn('sale-d')).cost_total = 9.50;

  -- E: a transfer moves stock inside the house and draws nothing.
  insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
    values (pg_temp.u('31'), pg_temp.u('1'), 'SC bar', 100);
  perform pg_temp.mv('e', 3, 'purchase', 'order', 'in-e', 5.00, 'invoice');
  v_n := (select count(*) from public.inventory_lot_draws);
  perform public.transfer_stock(pg_temp.u('2e0'), null, pg_temp.u('31'), 1);
  assert (select count(*) from public.inventory_lot_draws) = v_n, 'transfer_stock writes no draw';
  assert (select count(*) from public.inventory_transactions
           where inventory_id = pg_temp.u('2e0') and transaction_type = 'transfer' and cost_total is not null) = 0;

  -- Every negative movement's draws add up to the bottles it moved.
  assert not exists (
    select 1 from public.inventory_transactions t2
     where t2.restaurant_id = pg_temp.u('1') and t2.quantity_change < 0 and t2.transaction_type <> 'transfer'
       and -t2.quantity_change <> (select coalesce(sum(qty), 0) from public.inventory_lot_draws where txn_id = t2.id)),
    'each negative movement''s draws sum to its quantity';

  -- F: house 2 sells one bottle.
  perform pg_temp.mv('f', 2, 'purchase', 'order', 'in-f', 20.00, 'invoice');
  perform pg_temp.mv('f', -1, 'sale', 'pos', 'sale-f');
  assert (select count(*) from public.inventory_lot_draws where restaurant_id = pg_temp.u('1')) = 6;
  assert (select count(*) from public.inventory_lot_draws where restaurant_id = pg_temp.u('2')) = 1;
end $$;

-- Append-only: UPDATE, DELETE and TRUNCATE are refused, even for the owner.
do $$
declare
  v_id uuid := (select id from public.inventory_lot_draws where restaurant_id = pg_temp.u('1') limit 1);
  v_ok boolean;
begin
  v_ok := false;
  begin update public.inventory_lot_draws set qty = qty + 1 where id = v_id;
  exception when object_not_in_prerequisite_state then v_ok := true; end;
  assert v_ok, 'UPDATE of a draw is refused';
  v_ok := false;
  begin delete from public.inventory_lot_draws where id = v_id;
  exception when object_not_in_prerequisite_state then v_ok := true; end;
  assert v_ok, 'DELETE of a draw is refused';
  v_ok := false;
  begin truncate public.inventory_lot_draws;
  exception when object_not_in_prerequisite_state then v_ok := true; end;
  assert v_ok, 'TRUNCATE of the draws is refused';
  assert (select count(*) from public.inventory_lot_draws where restaurant_id in (pg_temp.u('1'), pg_temp.u('2'))) = 7;
end $$;

-- service_role (the gateway) reads them and has no grant to change them.
set local role service_role;
do $$
declare v_ok boolean := false;
begin
  assert (select count(*) from public.inventory_lot_draws where restaurant_id = pg_temp.u('1')) = 6, 'service_role reads the draws';
  begin update public.inventory_lot_draws set qty = qty where restaurant_id = pg_temp.u('1');
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'service_role has no UPDATE grant';
end $$;
reset role;

-- Another house's member, as a client role, reads none: no grant at all ...
set local role authenticated;
set local request.jwt.claims = '{"sub":"c2200000-0000-4000-8000-000000000099","role":"authenticated"}';
do $$
declare v_ok boolean := false;
begin
  begin perform 1 from public.inventory_lot_draws;
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'a client role has no grant on the draws';
end $$;
reset role;
-- ... and RLS is the second gate: with a stray SELECT grant, no policy lets a client row through.
grant select on public.inventory_lot_draws to authenticated;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.inventory_lot_draws) = 0, 'RLS shows a client role no draw';
end $$;
reset role;
revoke select on public.inventory_lot_draws from authenticated;

-- A house deleted takes its draws with it (the referential action is the one
-- delete the append-only trigger allows); the other house's draws stay.
do $$ begin
  delete from public.restaurants where id = pg_temp.u('2');
  assert (select count(*) from public.inventory_lot_draws where restaurant_id = pg_temp.u('2')) = 0, 'a deleted house takes its draws';
  assert (select count(*) from public.inventory_lot_draws where restaurant_id = pg_temp.u('1')) = 6;
end $$;

select 'a_sale_carries_its_cost: all assertions passed' as result;
rollback;
