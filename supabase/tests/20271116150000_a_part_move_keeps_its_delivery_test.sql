-- a_part_move_keeps_its_delivery: when only part of a delivery's lot moves,
-- the part that moved still belongs to the delivery, keeps its date and its
-- estimate, and VERIFIED settles it with the rest.
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
  select ('c0c30000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;

do $$ begin
  insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Part move house', 'part-move-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (pg_temp.u('2'), 'PART-MOVE-A', 'Part move wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (pg_temp.u('3'), pg_temp.u('1'), pg_temp.u('2'), 750, 150);
  insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('4'), pg_temp.u('1'), 'DELIVERED');
  insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles) values (pg_temp.u('5'), pg_temp.u('1'), 'Bar', 100);
  -- The door books 6 bottles at an estimate of 9, provisional.
  perform public.apply_stock_movement(pg_temp.u('3'), 'live', 6, 'purchase', 'manual', null, 'door',
    9, null, null, null, 'estimated', 'delivery', pg_temp.u('4'));
end $$;

-- P1: 2 of the 6 move to the bar. Both halves keep the delivery, the date
-- and the estimate's state.
do $$ declare v_at timestamptz; begin
  -- Received three days ago: the whole test is one transaction, so now() alone
  -- could not tell a kept date from a new one.
  update public.inventory_lots set received_at = now() - interval '3 days' where inventory_id = pg_temp.u('3');
  select received_at into v_at from public.inventory_lots where inventory_id = pg_temp.u('3');
  perform public.transfer_stock(pg_temp.u('3'), null, pg_temp.u('5'), 2);
  assert (select count(*) from public.inventory_lots where inventory_id = pg_temp.u('3')) = 2,
    'P1: a part move splits the lot';
  assert (select qty from public.inventory_lots where inventory_id = pg_temp.u('3') and location_id = pg_temp.u('5')) = 2,
    'P1: 2 bottles are at the bar';
  assert not exists (select 1 from public.inventory_lots where inventory_id = pg_temp.u('3')
                      and (delivery_id is distinct from pg_temp.u('4') or cost_state <> 'provisional'
                           or received_at is distinct from v_at)),
    'P1: both halves keep the delivery, the estimate and the date';
end $$;

-- P2: VERIFIED at 11 settles all 6, the 2 at the bar included.
do $$ begin
  perform public.finalise_delivery_cost(pg_temp.u('4'), pg_temp.u('3'), 11, 'invoice');
  assert not exists (select 1 from public.inventory_lots where inventory_id = pg_temp.u('3')
                      and (unit_cost is distinct from 11 or cost_state <> 'final')),
    'P2: every bottle of the delivery is final at 11, wherever it stands';
end $$;

rollback;
