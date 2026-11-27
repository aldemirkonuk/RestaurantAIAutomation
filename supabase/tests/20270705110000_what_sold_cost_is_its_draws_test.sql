-- what_sold_cost_is_its_draws (cost-math lane 3.1): pos_cost_of_goods sums the
-- cost the till's bottles carried when they left, nets a matched void, adds
-- what a verify settled on the window's own sales, names apart (and leaves out
-- of cost) what a verify in the window settled on sales before it, and counts
-- every bottle whose cost is unknown instead of adding it as 0.
--
-- Self-asserting (assert -> P0004); run with `psql -v ON_ERROR_STOP=1 -f` on a
-- database built from supabase/migrations. CI runs no supabase/tests file
-- (claim SUPABASE-TESTS-RUN-IN-CI). Synthetic fixtures, rolled back.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('c06d0000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.house(h text) returns uuid language sql immutable as $$ select pg_temp.u('1' || h) $$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
create function pg_temp.book(x text, q int, c numeric default null) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'purchase', p_source => 'manual', p_reason => 'cogs test', p_unit_cost => c,
    p_cost_provenance => case when c is null then null else 'estimated' end,
    p_reference_type => 'delivery', p_reference_id => pg_temp.u('3' || x || '0'));
end $$;
create function pg_temp.sell(x text, q int, k text default null, src text default 'pos',
                             ty text default 'sale', at timestamptz default null) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => -q,
    p_transaction_type => ty, p_source => src, p_idempotency_key => k, p_occurred_at => at)
$$;
create function pg_temp.void(x text, q int, k text, sale text default null) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'return', p_source => 'pos', p_idempotency_key => k,
    p_metadata => case when sale is null then null else jsonb_build_object('sale_key', sale) end)
$$;
create function pg_temp.fin(x text, c numeric) returns jsonb language sql as $$
  select public.finalise_delivery_cost(pg_temp.u('3' || x || '0'), pg_temp.i(x), c, 'invoice')
$$;
create function pg_temp.cogs(h text default 'a') returns jsonb language sql as $$
  select public.pos_cost_of_goods(pg_temp.house(h), now() - interval '365 days')
$$;
create function pg_temp.item(x text, h text default 'a') returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.cogs(h) -> 'items') e
   where (e ->> 'inventory_id')::uuid = pg_temp.i(x)
$$;

do $$
declare x text; h text;
begin
  foreach h in array array['a', 'b'] loop
    insert into public.restaurants (id, name, slug) values (pg_temp.house(h), 'COGS house ' || h, 'cogs-house-' || h);
  end loop;
  foreach x in array array['a', 'b', 'c', 'd', 'e', 'f', '7', '8', '9', 'a1'] loop
    h := case when x = '9' then 'b' else 'a' end;
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'COGS-' || upper(x), 'COGS wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.house(h), pg_temp.u('1' || x || '0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3' || x || '0'), pg_temp.house(h), 'DELIVERED');
  end loop;
end $$;

-- G0: the grant is service_role only, and the function is SECURITY INVOKER.
do $$
declare v_oid oid := to_regprocedure('public.pos_cost_of_goods(uuid, timestamptz)');
begin
  assert v_oid is not null, 'G0 FAIL: public.pos_cost_of_goods does not exist';
  assert not has_function_privilege('anon', v_oid, 'EXECUTE')
     and not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     and has_function_privilege('service_role', v_oid, 'EXECUTE'),
    'G0 FAIL: pos_cost_of_goods is reachable by a client role, or not by service_role';
  assert not (select prosecdef from pg_proc where oid = v_oid), 'G0 FAIL: SECURITY DEFINER';
end $$;

-- C1: FIFO cost. 2 @ 10 then 5 @ 12; the till sells 3 -> 2 x 10 + 1 x 12 = 32.
do $$
declare e jsonb;
begin
  perform pg_temp.book('a', 2, 10.00);
  perform pg_temp.book('a', 5, 12.00);
  perform pg_temp.sell('a', 3, 'cogs-a-1');
  e := pg_temp.item('a');
  assert (e ->> 'cost')::numeric = 32 and (e ->> 'bottles_out')::int = 3
     and (e ->> 'uncosted_out')::int = 0 and (e ->> 'uncosted_back')::int = 0
     and (e ->> 'in_house')::boolean,
    format('C1 FAIL: %s', e);
end $$;

-- C2: a matched void gives back its sale's last-drawn bottle at that bottle's
-- cost: sell 2 more of a (12 + 12), void 1 of that sale -> 32 + 24 - 12 = 44.
do $$
declare e jsonb;
begin
  perform pg_temp.sell('a', 2, 'cogs-a-2');
  perform pg_temp.void('a', 1, 'cogs-a-2-v', 'cogs-a-2');
  e := pg_temp.item('a');
  assert (e ->> 'cost')::numeric = 44 and (e ->> 'bottles_out')::int = 5 and (e ->> 'bottles_back')::int = 1
     and (e ->> 'uncosted_back')::int = 0,
    format('C2 FAIL: %s', e);
end $$;

-- C3: a void that names no sale gives its bottle back at an unknown cost:
-- counted, never netted as 0.
do $$
declare e jsonb;
begin
  perform pg_temp.book('b', 4, 9.00);
  perform pg_temp.sell('b', 2, 'cogs-b-1');
  perform pg_temp.void('b', 1, 'cogs-b-1-v');
  e := pg_temp.item('b');
  assert (e ->> 'cost')::numeric = 18 and (e ->> 'uncosted_back')::int = 1 and (e ->> 'uncosted_out')::int = 0,
    format('C3 FAIL: %s', e);
end $$;

-- C4: bottles from an unpriced lot are uncosted_out and add nothing to cost.
do $$
declare e jsonb;
begin
  perform pg_temp.book('c', 1, 7.50);
  perform pg_temp.book('c', 3);
  perform pg_temp.sell('c', 3, 'cogs-c-1');
  e := pg_temp.item('c');
  assert (e ->> 'cost')::numeric = 7.5 and (e ->> 'uncosted_out')::int = 2,
    format('C4 FAIL: %s', e);
end $$;

-- C5: a verify after the sale settles it: 2 sold at the estimate 10, verified
-- at 11.25 -> cost 22.5, of which 2.5 settled after the sale; an unpriced
-- bottle sold before verification is costed once settled.
do $$
declare e jsonb;
begin
  perform pg_temp.book('d', 3, 10.00);
  perform pg_temp.sell('d', 2, 'cogs-d-1');
  perform pg_temp.fin('d', 11.25);
  e := pg_temp.item('d');
  assert (e ->> 'cost')::numeric = 22.5 and (e ->> 'settled_after_sale')::numeric = 2.5
     and (e ->> 'uncosted_out')::int = 0,
    format('C5 FAIL: %s', e);
  perform pg_temp.book('e', 2);
  perform pg_temp.sell('e', 1, 'cogs-e-1');
  assert (pg_temp.item('e') ->> 'uncosted_out')::int = 1, format('C5 FAIL (before verify): %s', pg_temp.item('e'));
  perform pg_temp.fin('e', 0.333333);
  e := pg_temp.item('e');
  assert (e ->> 'cost')::numeric = 0.333333 and (e ->> 'uncosted_out')::int = 0,
    format('C5 FAIL (after verify): %s', e);
end $$;

-- C6: not the till's sale: a waste row, a manual sale and a sale dated before
-- the window are left out; another house's sale is never in this house's.
do $$
declare e jsonb;
begin
  perform pg_temp.book('f', 10, 5.00);
  perform pg_temp.sell('f', 1, 'cogs-f-w', 'pos', 'waste');
  perform pg_temp.sell('f', 1, 'cogs-f-m', 'manual');
  perform pg_temp.sell('f', 1, 'cogs-f-old', 'pos', 'sale', now() - interval '400 days');
  assert pg_temp.item('f') is null, format('C6 FAIL: f moved off-till only, read %s', pg_temp.item('f'));
  perform pg_temp.book('9', 2, 100.00);
  perform pg_temp.sell('9', 1, 'cogs-9-1');
  assert pg_temp.item('9', 'a') is null and (pg_temp.item('9', 'b') ->> 'cost')::numeric = 100,
    format('C6 FAIL: house b''s sale leaked: a=%s b=%s', pg_temp.item('9', 'a'), pg_temp.item('9', 'b'));
end $$;

-- C7: a till row written before draws existed (unpriced_qty NULL) is all
-- unknown, and counted in rows_unstamped.
do $$
declare e jsonb; before_ int := (pg_temp.cogs() ->> 'rows_unstamped')::int;
begin
  perform pg_temp.book('7', 4, 6.00);
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, transaction_type, source, quantity_change, quantity_before, quantity_after, stock_type, transaction_date)
  values (pg_temp.house('a'), pg_temp.i('7'), 'sale', 'pos', -2, 4, 2, 'live', now() - interval '1 day');
  e := pg_temp.item('7');
  assert (e ->> 'uncosted_out')::int = 2 and (e ->> 'cost')::numeric = 0,
    format('C7 FAIL: %s', e);
  assert (pg_temp.cogs() ->> 'rows_unstamped')::int = before_ + 1,
    format('C7 FAIL: rows_unstamped %s, was %s', pg_temp.cogs() ->> 'rows_unstamped', before_);
end $$;

-- C8: a glass pour that opens a bottle writes a till sale row, and since
-- a_glass_pour_carries_its_cost it stamps that bottle's draw: the bottle's
-- cost is its lot's 40, and nothing is unknown (flipped as the batch review
-- of 2026-11-11 asked, in the commit that lands the stamp).
do $$
declare e jsonb;
begin
  perform pg_temp.book('8', 2, 40.00);
  perform public.record_glass_pour(p_inventory_id => pg_temp.i('8'), p_pours => 1, p_pour_ml => 150,
    p_source => 'pos', p_idempotency_key => 'cogs-8-1');
  e := pg_temp.item('8');
  assert (e ->> 'bottles_out')::int = 1
     and (e ->> 'uncosted_out')::int = 0 and (e ->> 'cost')::numeric = 40,
    format('C8 FAIL: %s', e);
end $$;

-- C9: a house the till never moved reads an empty list, not a zero item.
do $$
declare r jsonb := public.pos_cost_of_goods(pg_temp.u('1e'), now() - interval '365 days');
begin
  assert r -> 'items' = '[]'::jsonb and (r ->> 'rows')::int = 0 and r -> 'first_move_at' = 'null'::jsonb,
    format('C9 FAIL: %s', r);
end $$;

-- C10: the house's cost is the six-place sum over its in-house items, and the
-- other house's sale is not in it.
do $$
declare r jsonb := pg_temp.cogs('a'); s numeric;
begin
  select sum((e ->> 'cost')::numeric) into s from jsonb_array_elements(r -> 'items') e where (e ->> 'in_house')::boolean;
  assert (r ->> 'cost')::numeric = s and (r ->> 'cost')::numeric > 0
     and (r ->> 'settled_after_sale')::numeric = 2.5 + 0.333333,
    format('C10 FAIL: cost %s vs items %s, settled %s', r ->> 'cost', s, r ->> 'settled_after_sale');
end $$;

-- C11: a price settled in the window on bottles sold before it is named in
-- this window (settled_on_earlier_sales, proposal F6) and is NOT in its cost:
-- those bottles' sales are not in this window's revenue (batch review
-- 2026-11-11, finding 1). A window that starts after the settlement does not
-- see it; a window that holds the sale counts it in cost.
do $$
declare e jsonb; later jsonb; wide jsonb; cost_before numeric := (pg_temp.cogs('a') ->> 'cost')::numeric;
begin
  perform pg_temp.book('a1', 3, 10.00);
  perform pg_temp.sell('a1', 2, 'cogs-a1-old', 'pos', 'sale', now() - interval '400 days');
  assert pg_temp.item('a1') is null, format('C11 FAIL (before verify): %s', pg_temp.item('a1'));
  perform pg_temp.fin('a1', 12.00);
  e := pg_temp.item('a1');
  assert (e ->> 'bottles_out')::int = 0 and (e ->> 'cost')::numeric = 0
     and (e ->> 'settled_after_sale')::numeric = 0
     and (e ->> 'settled_on_earlier_sales')::numeric = 4
     and (e ->> 'uncosted_out')::int = 0,
    format('C11 FAIL: %s', e);
  assert (pg_temp.cogs('a') ->> 'cost')::numeric = cost_before,
    format('C11 FAIL (house cost moved): %s, was %s', pg_temp.cogs('a') ->> 'cost', cost_before);
  assert (pg_temp.cogs('a') ->> 'settled_after_sale')::numeric = 2.5 + 0.333333
     and (pg_temp.cogs('a') ->> 'settled_on_earlier_sales')::numeric = 4,
    format('C11 FAIL (house): %s', pg_temp.cogs('a'));
  later := public.pos_cost_of_goods(pg_temp.house('a'), now() + interval '1 second');
  assert later -> 'items' = '[]'::jsonb, format('C11 FAIL (later window): %s', later);
  wide := (select e2 from jsonb_array_elements(
             public.pos_cost_of_goods(pg_temp.house('a'), now() - interval '401 days') -> 'items') e2
            where (e2 ->> 'inventory_id')::uuid = pg_temp.i('a1'));
  assert (wide ->> 'bottles_out')::int = 2 and (wide ->> 'cost')::numeric = 24
     and (wide ->> 'settled_after_sale')::numeric = 4
     and (wide ->> 'settled_on_earlier_sales')::numeric = 0,
    format('C11 FAIL (window holding the sale): %s', wide);
end $$;

rollback;
