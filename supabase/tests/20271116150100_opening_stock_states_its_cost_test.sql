-- opening_stock_states_its_cost (r36 invoices R1): stock from no delivery
-- can be given its cost, and what was already sold from it settles at it.
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
  select ('c0c20000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;
create function pg_temp.i(x text) returns uuid language sql immutable as $$ select pg_temp.u('2' || x || '0') $$;
-- Opening stock: bottles in from no delivery and no order, with no cost.
create function pg_temp.open(x text, q int) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => q,
    p_transaction_type => 'purchase', p_source => 'manual', p_reason => 'opening shelf');
end $$;
-- A delivery's bottles at an estimate (provisional), as the door books them.
create function pg_temp.door(x text, q int, c numeric) returns void language plpgsql as $$
begin
  perform public.apply_stock_movement(pg_temp.i(x), 'live', q, 'purchase', 'manual', null, 'door',
    c, null, null, null, 'estimated', 'delivery', pg_temp.u('3' || x || '0'));
end $$;
create function pg_temp.sell(x text, q int) returns uuid language sql as $$
  select public.apply_stock_movement(p_inventory_id => pg_temp.i(x), p_stock_state => 'live', p_delta => -q,
    p_transaction_type => 'sale', p_source => 'pos')
$$;
create function pg_temp.state(h text, x text, c numeric) returns jsonb language sql as $$
  select public.state_opening_lot_cost(pg_temp.u(h), pg_temp.i(x), c)
$$;

do $$
declare x text;
begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Opening cost house', 'opening-cost-house');
  insert into public.restaurants (id, name, slug) values (pg_temp.u('9'), 'Other house', 'opening-cost-other');
  foreach x in array array['a', 'b'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1' || x || '0'), 'OPEN-COST-' || upper(x), 'Opening wine ' || upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.i(x), pg_temp.u('1'), pg_temp.u('1' || x || '0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3' || x || '0'), pg_temp.u('1'), 'DELIVERED');
  end loop;
end $$;

-- O1: 6 opening bottles, 2 then 1 sold before anyone knew their cost; stated
-- at 18, the lot is final at 18 and the sales settle at exactly 36.00 and 18.00.
do $$
declare t uuid; t2 uuid; r jsonb; v numeric;
begin
  perform pg_temp.open('a', 6);
  t := pg_temp.sell('a', 2);
  t2 := pg_temp.sell('a', 1);
  r := pg_temp.state('1', 'a', 18);
  assert (r ->> 'lots_stated')::int = 1, 'O1: one opening lot stated, got ' || r::text;
  assert (r ->> 'units_stated')::int = 3, 'O1: the 3 left on the shelf, got ' || r::text;
  assert (r ->> 'draws_settled')::int = 2, 'O1: both earlier sales are settled, got ' || r::text;
  assert not exists (select 1 from public.inventory_lots where inventory_id = pg_temp.i('a')
                      and (unit_cost is distinct from 18 or cost_state <> 'final' or cost_provenance <> 'manual')),
    'O1: every opening lot is final at 18, manual';
  select settled_cost_total into v from public.inventory_transaction_settled_cost where txn_id = t;
  assert v = 36, 'O1: the 2 sold settle at 36.00, got ' || coalesce(v::text, 'null');
  select settled_cost_total into v from public.inventory_transaction_settled_cost where txn_id = t2;
  assert v = 18, 'O1: the 1 sold settles at 18.00, got ' || coalesce(v::text, 'null');
  assert exists (select 1 from public.inventory_lot_revaluations where inventory_id = pg_temp.i('a') and prior_unit_cost is null),
    'O1: the prior (no) cost is kept';
end $$;

-- O2: a retry states nothing, and says so.
do $$ declare r jsonb; begin
  r := pg_temp.state('1', 'a', 18);
  assert (r ->> 'lots_stated')::int = 0, 'O2: a retry states nothing, got ' || r::text;
  r := pg_temp.state('1', 'a', 20);
  assert (r ->> 'lots_stated')::int = 0, 'O2: a final cost is not corrected here, got ' || r::text;
end $$;

-- O3: a delivery's lot and an order's lot are never touched; their paper
-- settles them.
do $$ declare r jsonb; begin
  perform pg_temp.door('b', 5, 9);
  perform public.apply_stock_movement(p_inventory_id => pg_temp.i('b'), p_stock_state => 'live', p_delta => 2,
    p_transaction_type => 'purchase', p_source => 'manual', p_unit_cost => 10, p_cost_provenance => 'estimated',
    p_order_id => pg_temp.u('5b0'));
  perform pg_temp.open('b', 3);
  r := pg_temp.state('1', 'b', 12);
  assert (r ->> 'lots_stated')::int = 1, 'O3: only the opening lot, got ' || r::text;
  assert exists (select 1 from public.inventory_lots where inventory_id = pg_temp.i('b')
                  and delivery_id = pg_temp.u('3b0') and unit_cost = 9 and cost_state = 'provisional'),
    'O3: the delivery lot keeps its estimate and stays provisional';
  assert exists (select 1 from public.inventory_lots where inventory_id = pg_temp.i('b')
                  and source_order_id = pg_temp.u('5b0') and unit_cost = 10 and cost_state = 'provisional'),
    'O3: the order lot keeps its estimate and stays provisional';
end $$;

-- O4: another house's caller, and a cost of nothing, are refused.
do $$ begin
  begin
    perform pg_temp.state('9', 'b', 12);
    assert false, 'O4: another house must not reach this item';
  exception when raise_exception then null;
  end;
  begin
    perform pg_temp.state('1', 'b', 0);
    assert false, 'O4: a cost of nothing is refused';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- O5: no client role may call it.
do $$ begin
  assert not has_function_privilege('anon', 'public.state_opening_lot_cost(uuid, uuid, numeric, uuid, text, text)', 'EXECUTE'),
    'O5: anon cannot state a cost';
  assert not has_function_privilege('authenticated', 'public.state_opening_lot_cost(uuid, uuid, numeric, uuid, text, text)', 'EXECUTE'),
    'O5: authenticated cannot state a cost';
end $$;

rollback;
