-- a_settlement_keeps_six_places (QA round 21, #932 residuals): a sale settled
-- after its delivery is verified costs exactly qty x the agreed price, however
-- the bottles were sold, and nothing is summed as a float.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, rolled back.
-- Self-guarding: X1 needs #909 (inventory_lots.unit_cost at scale 6) for a
-- six-place estimate; without it X1 is skipped with a NOTICE.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c0c10000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
-- Bottles in against item x's delivery at an estimate (provisional), or unpriced.
create function pg_temp.book(x text, q int, c numeric default null) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(pg_temp.i(x), 'live', q, 'purchase', 'manual', null, 'six settle test',
    c, null, null, null, case when c is null then null else 'estimated' end, 'delivery', pg_temp.u('3' || x || '0'));
end $$;
create function pg_temp.sell(x text, q int, k text default null) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => -q,
    p_transaction_type => 'sale', p_source => 'pos', p_idempotency_key => k)
$$;
create function pg_temp.void(x text, q int, k text, sale text) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'return', p_source => 'pos', p_idempotency_key => k,
    p_metadata => jsonb_build_object('sale_key', sale))
$$;
create function pg_temp.fin(x text, c numeric) returns jsonb language sql as $$
  select public.finalise_delivery_cost(pg_temp.u('3' || x || '0'), pg_temp.i(x), c, 'invoice')
$$;
create function pg_temp.settled(t uuid[]) returns numeric language sql as $$
  select sum(settled_cost_total) from public.inventory_transaction_settled_cost where txn_id = any(t)
$$;
create function pg_temp.ty(rel text, col text) returns text language sql as $$
  select format_type(a.atttypid, a.atttypmod) from pg_attribute a
   where a.attrelid = ('public.' || rel)::regclass and a.attname = col and not a.attisdropped
$$;

do $$
declare x text;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Six settle house', 'six-settle-house');
  foreach x in array array['a', 'b', 'c', 'd', 'e'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'SIX-SETTLE-' || upper(x), 'Six settle wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3' || x || '0'), pg_temp.u('1'), 'DELIVERED');
  end loop;
end $$;

-- F1 (no float, anywhere on the path): every settled money column is
-- numeric(16,6), and a sum over the view is numeric. A float mutant changes a
-- type here and leaves float residue in X1/X2's exact sums.
do $$
begin
  assert pg_temp.ty('inventory_lot_draw_settlements', 'prior_total') = 'numeric(16,6)'
     and pg_temp.ty('inventory_lot_draw_settlements', 'settled_total') = 'numeric(16,6)'
     and pg_temp.ty('inventory_lot_draw_settlements', 'difference') = 'numeric(16,6)',
    format('F1 FAIL: settlement totals are %s / %s / %s, expected numeric(16,6)',
      pg_temp.ty('inventory_lot_draw_settlements', 'prior_total'),
      pg_temp.ty('inventory_lot_draw_settlements', 'settled_total'),
      pg_temp.ty('inventory_lot_draw_settlements', 'difference'));
  assert pg_temp.ty('inventory_transaction_settled_cost', 'settled_difference') = 'numeric(16,6)'
     and pg_temp.ty('inventory_transaction_settled_cost', 'settled_cost_total') = 'numeric(16,6)',
    format('F1 FAIL: settled view columns are %s / %s, expected numeric(16,6)',
      pg_temp.ty('inventory_transaction_settled_cost', 'settled_difference'),
      pg_temp.ty('inventory_transaction_settled_cost', 'settled_cost_total'));
  assert (select pg_typeof(sum(settled_cost_total))::text from public.inventory_transaction_settled_cost) = 'numeric',
    'F1 FAIL: a sum of settled_cost_total is not numeric';
end $$;

-- X2 (any tree): 200 bottles at an estimated 10.00 sold one at a time, the
-- delivery verified at 10.0049 -> each single keeps its 0.0049 and the 200
-- settle to 200 x 10.0049 = 2000.98, the same as one 200-bottle sale.
-- X3: re-verified at 10.0051 -> the chain stays exact, 2001.02 (one bottle
-- stays in lot a: 20270502100100 never reopens a sold-out final lot).
do $$
declare i int; t uuid[] := '{}'; s numeric; d numeric; one uuid;
begin
  perform pg_temp.book('a', 201, 10.00);
  for i in 1..200 loop t := t || pg_temp.sell('a', 1); end loop;
  perform pg_temp.book('b', 200, 10.00);
  one := pg_temp.sell('b', 200);
  perform pg_temp.fin('a', 10.0049);
  perform pg_temp.fin('b', 10.0049);
  s := pg_temp.settled(t);
  select difference into d from public.inventory_lot_draw_settlements where txn_id = t[1];
  assert d = 0.0049, format('X2 FAIL: a one-bottle sale before verification settled by %s, expected 0.0049', d);
  assert s = 2000.98, format('X2 FAIL: 200 one-bottle sales settle to %s, expected 2000.98', s);
  assert s = pg_temp.settled(array[one]), format('X2 FAIL: 200 singles %s vs one 200-bottle sale %s', s, pg_temp.settled(array[one]));
  perform pg_temp.fin('a', 10.0051);
  s := pg_temp.settled(t);
  assert s = 2001.02, format('X3 FAIL: re-verified at 10.0051 the 200 singles settle to %s, expected 2001.02', s);
end $$;

-- X4 (any tree): 3 unpriced bottles sold singly, verified at 0.333333 ->
-- 0.999999, not 3 x 0.33 = 0.99.
do $$
declare t uuid[] := '{}'; s numeric;
begin
  perform pg_temp.book('c', 3);
  t := t || pg_temp.sell('c', 1) || pg_temp.sell('c', 1) || pg_temp.sell('c', 1);
  perform pg_temp.fin('c', 0.333333);
  s := pg_temp.settled(t);
  assert s = 0.999999, format('X4 FAIL: 3 unpriced singles at 0.333333 settle to %s, expected 0.999999', s);
end $$;

-- X5 (any tree): a single sold and voided before verification nets to 0 at any
-- agreed price; the sale alone keeps 0.0049.
do $$
declare s uuid; r uuid;
begin
  perform pg_temp.book('d', 5, 10.00);
  s := pg_temp.sell('d', 1, 'six-settle-d');
  r := pg_temp.void('d', 1, 'six-settle-d-v', 'six-settle-d');
  perform pg_temp.fin('d', 10.0049);
  assert pg_temp.settled(array[s]) = 10.0049 and pg_temp.settled(array[s, r]) = 0,
    format('X5 FAIL: sale %s, sale + void %s', pg_temp.settled(array[s]), pg_temp.settled(array[s, r]));
end $$;

-- X1 (merged tree, #909): 13 bottles at an estimated 9.230769 (120.00 / 13),
-- sold one at a time, verified at 9.50 -> exactly 13 x 9.50 = 123.50, each
-- sale 9.500000 (QA round 21 measured 123.509997).
do $$
declare i int; t uuid[] := '{}'; s numeric;
begin
  if (select numeric_scale from information_schema.columns
       where table_schema = 'public' and table_name = 'inventory_lots' and column_name = 'unit_cost') < 6 then
    raise notice 'X1 skipped: #909 not applied (a lot cost keeps two places)';
    return;
  end if;
  perform pg_temp.book('e', 13, 9.230769);
  for i in 1..13 loop t := t || pg_temp.sell('e', 1); end loop;
  perform pg_temp.fin('e', 9.50);
  s := pg_temp.settled(t);
  assert s = 123.50, format('X1 FAIL: 13 sales settle to %s, expected 123.50', s);
  assert not exists (select 1 from public.inventory_transaction_settled_cost
                      where txn_id = any(t) and settled_cost_total <> 9.50),
    'X1 FAIL: a single sale did not settle to 9.50';
end $$;

select 'a_settlement_keeps_six_places: F1, X1-X5 pass' as result;
rollback;
