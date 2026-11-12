-- a_verified_invoice_settles_sold_bottles: verifyReceipt's revalue_lot costs
-- a bottle sold before the invoice was verified, exactly as
-- finalise_delivery_cost does for a delivery.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, rolled back.
-- Control: on a tree without the migration V1 fails with
-- "V1 FAIL: 2 unpriced sales settled to <NULL>, expected 50.00".

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c0c20000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.o(x text) returns uuid language sql immutable as $$ select pg_temp.u('4' || x || '0') $$;
-- Bottles in against item x's ORDER (no delivery): unpriced, or at a price and provenance.
create function pg_temp.book(x text, q int, c numeric default null, p text default null) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'purchase', p_source => 'manual', p_reason => 'verify settle test',
    p_unit_cost => c, p_order_id => pg_temp.o(x), p_cost_provenance => p);
end $$;
create function pg_temp.sell(x text, q int) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => -q,
    p_transaction_type => 'sale', p_source => 'pos')
$$;
create function pg_temp.rev(x text, c numeric, p text default 'invoice') returns jsonb language sql as $$
  select public.revalue_lot(pg_temp.i(x), pg_temp.o(x), c, p)
$$;
create function pg_temp.settled(t uuid[]) returns numeric language sql as $$
  select sum(settled_cost_total) from public.inventory_transaction_settled_cost where txn_id = any(t)
$$;
create function pg_temp.rows(x text) returns bigint language sql as $$
  select count(*) from public.inventory_lot_draw_settlements where inventory_id = pg_temp.i(x)
$$;
create function pg_temp.state(x text) returns text language sql as $$
  select string_agg(distinct cost_state, ',') from public.inventory_lots where inventory_id = pg_temp.i(x)
$$;

do $$
declare x text;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Verify settle house', 'verify-settle-house');
  foreach x in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'VERIFY-SETTLE-' || upper(x), 'Verify settle wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
  end loop;
end $$;

-- V1: 6 unpriced bottles, 2 sold singly, the invoice verified at 25.00 ->
-- each sale settles to 25.00 (50.00), the lot is final, a later sale is
-- stamped final at 25.00. V2: the same verify again writes nothing.
do $$
declare t uuid[] := '{}'; r jsonb; later uuid; n bigint;
begin
  perform pg_temp.book('a', 6);
  t := t || pg_temp.sell('a', 1) || pg_temp.sell('a', 1);
  r := pg_temp.rev('a', 25.00);
  assert pg_temp.settled(t) = 50.00,
    format('V1 FAIL: 2 unpriced sales settled to %s, expected 50.00', coalesce(pg_temp.settled(t)::text, '<NULL>'));
  assert (r->>'draws_settled')::int = 2 and (r->>'lots_matched')::int = 1 and (r->>'bottles_matched')::int = 4,
    format('V1 FAIL: receipt %s', r);
  assert pg_temp.state('a') = 'final', format('V1 FAIL: lot cost_state %s after an invoice verify, expected final', pg_temp.state('a'));
  later := pg_temp.sell('a', 1);
  assert (select cost_state from public.inventory_lot_draws where txn_id = later) = 'final'
     and pg_temp.settled(array[later]) = 25.00,
    'V1 FAIL: a sale after the verify is not stamped final at 25.00';
  n := pg_temp.rows('a');
  r := pg_temp.rev('a', 25.00);
  assert (r->>'lots_revalued')::int = 0 and (r->>'draws_settled')::int = 0 and pg_temp.rows('a') = n,
    format('V2 FAIL: a repeated verify wrote %s', r);
end $$;

-- V3: an estimate of 9.00 (provisional), 1 sold, verified at 10.00 -> the sale
-- settles by 1.00 to 10.00.
do $$
declare s uuid; d numeric;
begin
  perform pg_temp.book('b', 4, 9.00, 'estimated');
  s := pg_temp.sell('b', 1);
  perform pg_temp.rev('b', 10.00);
  select difference into d from public.inventory_lot_draw_settlements where txn_id = s;
  assert d = 1.00 and pg_temp.settled(array[s]) = 10.00,
    format('V3 FAIL: an estimated sale settled by %s to %s, expected 1.00 to 10.00', d, pg_temp.settled(array[s]));
end $$;

-- V4: a delivery sold out before its invoice was verified -> nothing on hand
-- (lots_matched 0), the empty lot is restated and both sales settle to 30.00;
-- a second verify writes nothing.
do $$
declare t uuid[] := '{}'; r jsonb;
begin
  perform pg_temp.book('c', 2);
  t := t || pg_temp.sell('c', 1) || pg_temp.sell('c', 1);
  r := pg_temp.rev('c', 30.00);
  assert (r->>'lots_matched')::int = 0 and (r->>'empty_lots_revalued')::int = 1 and (r->>'draws_settled')::int = 2,
    format('V4 FAIL: receipt %s', r);
  assert pg_temp.settled(t) = 60.00, format('V4 FAIL: sold-out sales settled to %s, expected 60.00', pg_temp.settled(t));
  r := pg_temp.rev('c', 30.00);
  assert (r->>'lots_revalued')::int = 0 and (r->>'draws_settled')::int = 0, format('V4 FAIL: repeat wrote %s', r);
end $$;

-- V5: a lot the old body restated (price 20.00 invoice, still provisional, the
-- sale unsettled) heals on the next verify of the same price.
do $$
declare s uuid; r jsonb;
begin
  perform pg_temp.book('d', 3);
  s := pg_temp.sell('d', 1);
  update public.inventory_lots set unit_cost = 20.00, cost_provenance = 'invoice'
   where inventory_id = pg_temp.i('d');
  assert pg_temp.state('d') = 'provisional', 'V5 setup: the lot should still read provisional';
  r := pg_temp.rev('d', 20.00);
  assert (r->>'lots_revalued')::int = 1 and (r->>'draws_settled')::int = 1 and pg_temp.state('d') = 'final'
     and pg_temp.settled(array[s]) = 20.00,
    format('V5 FAIL: receipt %s, state %s, settled %s', r, pg_temp.state('d'), pg_temp.settled(array[s]));
end $$;

-- V6: an invoice price at the door is final; a re-verify at 42.00 restates
-- the lot and does not reopen the sale stamped final at 40.00.
do $$
declare s uuid; r jsonb;
begin
  perform pg_temp.book('e', 3, 40.00, 'invoice');
  s := pg_temp.sell('e', 1);
  r := pg_temp.rev('e', 42.00);
  assert (r->>'lots_revalued')::int = 1 and (r->>'draws_settled')::int = 0 and pg_temp.settled(array[s]) = 40.00,
    format('V6 FAIL: receipt %s, sale settled %s', r, pg_temp.settled(array[s]));
end $$;

-- V7: an estimated restatement keeps the lot provisional and settles the sale
-- at the estimate; the invoice then settles the chain on to 16.00.
do $$
declare s uuid; r jsonb;
begin
  perform pg_temp.book('f', 2);
  s := pg_temp.sell('f', 1);
  r := pg_temp.rev('f', 15.00, 'estimated');
  assert r->>'cost_state' = 'provisional' and pg_temp.state('f') = 'provisional' and pg_temp.settled(array[s]) = 15.00,
    format('V7 FAIL: estimate receipt %s, settled %s', r, pg_temp.settled(array[s]));
  r := pg_temp.rev('f', 16.00);
  assert pg_temp.state('f') = 'final' and pg_temp.settled(array[s]) = 16.00 and pg_temp.rows('f') = 2,
    format('V7 FAIL: invoice after estimate: state %s, settled %s, rows %s', pg_temp.state('f'), pg_temp.settled(array[s]), pg_temp.rows('f'));
end $$;

select 'a_verified_invoice_settles_sold_bottles: V1-V7 pass' as result;
rollback;
