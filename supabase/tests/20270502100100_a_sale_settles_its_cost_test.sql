-- public.inventory_lot_draw_settlements and finalise_delivery_cost, migration
-- a_sale_settles_its_cost (QA round 15 finding 2): a bottle sold before its
-- delivery was VERIFIED is settled at the agreed price, append-only.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, one transaction,
-- rolled back. House u('1'); item x is u('2x0'), wine u('1x0'), delivery u('3x0').

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c0990000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
-- Bottles in through the real path, booked against item x's delivery (provisional).
create function pg_temp.book(l text, q int, cost numeric default null) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(pg_temp.u('2' || l || '0'), 'live', q, 'purchase', 'manual', null, 'settle test',
    cost, null, null, null, case when cost is null then null else 'estimated' end, 'delivery', pg_temp.u('3' || l || '0'));
end $$;
-- A sale through the real path: writes the draws.
create function pg_temp.sell(l text, q int) returns uuid language sql as $$
  select public.apply_stock_movement(pg_temp.u('2' || l || '0'), 'live', -q, 'sale', 'manual', null, 'settle test')
$$;
create function pg_temp.fin(l text, cost numeric) returns jsonb language sql as $$
  select public.finalise_delivery_cost(pg_temp.u('3' || l || '0'), pg_temp.u('2' || l || '0'), cost, 'invoice')
$$;
create function pg_temp.lot(l text) returns uuid language sql as $$
  select id from public.inventory_lots where inventory_id = pg_temp.u('2' || l || '0')
$$;

do $$
declare x text;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Settle test house', 'settle-test-house');
  foreach x in array array['a', 'b', 'd'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'SETTLE-TEST-' || upper(x), 'Settle test wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2' || x || '0'), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3' || x || '0'), pg_temp.u('1'), 'DELIVERED');
  end loop;
end $$;

-- S1: 10 bottles, no price; 4 sold; verified at 12.50 -> 4 x 12.50 = 50.00 owed.
do $$
declare r jsonb; t uuid; n int; s record; v record;
begin
  perform pg_temp.book('a', 10);
  t := pg_temp.sell('a', 4);
  r := pg_temp.fin('a', 12.50);
  select count(*) into n from public.inventory_lot_draw_settlements where lot_id = pg_temp.lot('a');
  assert n = 1, format('S1 FAIL: expected 1 settlement, got %s (finalise said %s)', n, r);
  select * into s from public.inventory_lot_draw_settlements where lot_id = pg_temp.lot('a');
  assert s.qty = 4 and s.prior_unit_cost is null and s.prior_total is null and s.settled_total = 50.00 and s.difference = 50.00,
    format('S1 FAIL: settlement %s', row_to_json(s));
  select * into v from public.inventory_transaction_settled_cost where txn_id = t;
  assert v.cost_total is null and v.settled_cost_total = 50.00 and v.unpriced_qty_remaining = 0,
    format('S1 FAIL: view %s', row_to_json(v));
  -- S6: the settlement is the lot's house.
  assert s.restaurant_id = (select restaurant_id from public.inventory_lots where id = pg_temp.lot('a')),
    format('S6 FAIL: settlement house %s', s.restaurant_id);
end $$;

-- S2: 4 bottles at an estimated 10.00, all sold; verified at 12.00 -> the empty
-- lot is finalised and 4 x (12 - 10) = 8.00 owed. S3: again at 12.00 -> nothing.
do $$
declare r jsonb; n int; s record; l record; nr int;
begin
  perform pg_temp.book('b', 4, 10.00);
  perform pg_temp.sell('b', 4);
  r := pg_temp.fin('b', 12.00);
  select * into l from public.inventory_lots where id = pg_temp.lot('b');
  assert l.qty = 0 and l.cost_state = 'final' and l.unit_cost = 12.00,
    format('S2 FAIL: lot %s (finalise said %s)', row_to_json(l), r);
  assert (r ->> 'empty_lots_finalised')::int = 1 and (r ->> 'lots_matched')::int = 0,
    format('S2 FAIL: receipt %s', r);
  select count(*) into n from public.inventory_lot_draw_settlements where lot_id = pg_temp.lot('b');
  select * into s from public.inventory_lot_draw_settlements where lot_id = pg_temp.lot('b');
  assert n = 1 and s.difference = 8.00 and s.prior_total = 40.00 and s.settled_total = 48.00,
    format('S2 FAIL: %s settlements, %s', n, row_to_json(s));
  select count(*) into nr from public.inventory_lot_revaluations where lot_id = pg_temp.lot('b');
  r := pg_temp.fin('b', 12.00);
  assert (select count(*) from public.inventory_lot_revaluations where lot_id = pg_temp.lot('b')) = nr
     and (select count(*) from public.inventory_lot_draw_settlements where lot_id = pg_temp.lot('b')) = 1
     and (r ->> 'draws_settled')::int = 0,
    format('S3 FAIL: a re-verify at the same price wrote something (%s)', r);
end $$;

-- S4: 10 provisional bottles (no price); 3 sold; verified at 12.00; 2 more sold
-- at final 12.00; re-verified at 13.00 -> the 3 settle again by 3 x 1 = 3.00,
-- the 2 get nothing.
do $$
declare t3 uuid; t2 uuid; n3 int; n2 int; d numeric;
begin
  perform pg_temp.book('d', 10);
  t3 := pg_temp.sell('d', 3);
  perform pg_temp.fin('d', 12.00);
  t2 := pg_temp.sell('d', 2);
  perform pg_temp.fin('d', 13.00);
  select count(*) into n3 from public.inventory_lot_draw_settlements where txn_id = t3;
  select count(*) into n2 from public.inventory_lot_draw_settlements where txn_id = t2;
  select difference into d from public.inventory_lot_draw_settlements where txn_id = t3 order by seq desc limit 1;
  assert n3 = 2 and d = 3.00, format('S4 FAIL: provisional draw has %s settlements, last difference %s', n3, d);
  assert n2 = 0, format('S4 FAIL: a draw taken at final cost was settled (%s rows)', n2);
  assert (select settled_cost_total from public.inventory_transaction_settled_cost where txn_id = t3) = 39.00,
    'S4 FAIL: settled cost of the 3 is not 39.00';
end $$;

-- S5: both tables refuse UPDATE and DELETE.
do $$

begin
  begin update public.inventory_lot_draw_settlements set qty = qty; raise exception 'S5 FAIL: settlement UPDATE allowed';
  exception when sqlstate '55000' then null; end;
  begin delete from public.inventory_lot_draw_settlements; raise exception 'S5 FAIL: settlement DELETE allowed';
  exception when sqlstate '55000' then null; end;
  begin update public.inventory_lot_draws set qty = qty; raise exception 'S5 FAIL: draw UPDATE allowed';
  exception when sqlstate '55000' then null; end;
  begin delete from public.inventory_lot_draws; raise exception 'S5 FAIL: draw DELETE allowed';
  exception when sqlstate '55000' then null; end;
end $$;

select 'a_sale_settles_its_cost: S1-S6 pass' as result;
rollback;
