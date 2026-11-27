-- A voided recipe sale gives its draw back (inventory r28 gap 1, slice 3c;
-- migration 20271020120000_a_voided_recipe_sale_gives_its_draw_back.sql).
--
-- Run on a database built from supabase/migrations; one transaction, rolled
-- back. One row per case (id, ok, detail); every ok must be true. Without the
-- migration the first void errors (no reverse_recipe_draw), which is the control.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

-- Fixture: two houses; goods kept in bottles, grams, eaches and ml (as 3b's test).
create function pg_temp.good(p_id uuid, p_house uuid, p_name text, p_kind text, p_uom text, p_bottle integer)
returns void language sql as $$
  insert into public.restaurant_inventory
    (id, restaurant_id, kind, uom, display_name, identity_provenance, bottle_size_ml)
  values (p_id, p_house, p_kind, p_uom, p_name, 'house_declared', p_bottle)
$$;
create function pg_temp.lot(p_item uuid, p_qty integer, p_open integer, p_days integer)
returns void language sql as $$
  insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
  select ri.restaurant_id, ri.id, ri.master_wine_id, p_qty, p_open, now() - make_interval(days => p_days)
    from public.restaurant_inventory ri where ri.id = p_item
$$;
create function pg_temp.qty(p uuid) returns bigint language sql as $$
  select coalesce(sum(qty), 0) from public.inventory_lots where inventory_id = p and stock_state = 'live'
$$;
create function pg_temp.open_ml(p uuid) returns bigint language sql as $$
  select coalesce(sum(open_bottle_ml), 0) from public.inventory_lots where inventory_id = p and stock_state = 'live'
$$;
create function pg_temp.carry(p uuid) returns bigint language sql as $$
  select coalesce(sum(carry_micro), 0) from public.recipe_draw_carry where inventory_id = p
$$;
create function pg_temp.d(p_item uuid, p_via text, p_base text, p_bpu text, p_exact text) returns jsonb
language sql as $$
  select jsonb_build_object('inventory_id', p_item, 'via', p_via, 'base_unit', p_base,
                            'base_per_unit', p_bpu, 'exact_micro', p_exact)
$$;
create function pg_temp.draw(p_key text, p_draws jsonb) returns jsonb language sql as $$
  select public.record_recipe_draw('d3a00000-0000-4000-8000-000000000001', p_key,
    'd3a00000-0000-4000-8000-0000000000f1', null, p_draws, now() - interval '1 hour', null)
$$;
create function pg_temp.void(p_key text) returns jsonb language sql as $$
  select public.reverse_recipe_draw('d3a00000-0000-4000-8000-000000000001', p_key, null, null)
$$;

do $$
declare
  h uuid := 'd3a00000-0000-4000-8000-000000000001';
  h2 uuid := 'd3a00000-0000-4000-8000-000000000002';
begin
  insert into public.restaurants (id, name, slug) values
    (h, 'Draw test house', 'draw-test-house'), (h2, 'Other test house', 'draw-test-other');
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000101', h, 'Gin', 'spirit', 'bottle', 700);
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000102', h, 'Salt', 'food', 'g', null);
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000103', h, 'Lemon', 'food', 'each', null);
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000104', h, 'Syrup', 'food', 'ml', null);
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000105', h, 'Vermouth', 'spirit', 'bottle', null);
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000106', h, 'Old bitters', 'spirit', 'ml', null);
  perform pg_temp.good('d3a00000-0000-4000-8000-000000000107', h2, 'Their gin', 'spirit', 'bottle', 700);
  update public.restaurant_inventory set deleted_at = now() where id = 'd3a00000-0000-4000-8000-000000000106';
  perform pg_temp.lot('d3a00000-0000-4000-8000-000000000101', 2, 0, 5);
  perform pg_temp.lot('d3a00000-0000-4000-8000-000000000102', 1000, 0, 5);
  perform pg_temp.lot('d3a00000-0000-4000-8000-000000000103', 20, 0, 5);
  perform pg_temp.lot('d3a00000-0000-4000-8000-000000000104', 5000, 0, 5);
  perform pg_temp.lot('d3a00000-0000-4000-8000-000000000107', 3, 0, 5);
end $$;

-- Sales to void: five of 7.5 g of salt (booked 7, 8, 7, 8, 7) and 45 ml of gin poured.
do $$ declare i int; r jsonb; begin
  for i in 1..5 loop
    r := pg_temp.draw('sale-' || i, jsonb_build_array(
      pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '7500000000')));
    if r ->> 'status' <> 'booked' then raise exception 'setup sale % did not book: %', i, r; end if;
  end loop;
  r := pg_temp.draw('sale-gin', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000101', 'pour', 'ml10', '10', '450000000')));
  if r ->> 'status' <> 'booked' or pg_temp.open_ml('d3a00000-0000-4000-8000-000000000101') <> 655 then
    raise exception 'setup gin pour did not book: %', r;
  end if;
  -- A sale that waited (the vermouth has no bottle size): nothing booked to give back.
  r := pg_temp.draw('sale-short', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000105', 'pour', 'ml10', '10', '300000000')));
  if r ->> 'status' <> 'wait' then raise exception 'setup wait did not wait: %', r; end if;
end $$;


-- V8: another house cannot void this house's sale: it finds nothing booked under its own name.
do $$ declare r jsonb; begin
  r := public.reverse_recipe_draw('d3a00000-0000-4000-8000-000000000002', 'sale-3', null, null);
  insert into _t select 'V8',
    r ->> 'status' = 'nothing_booked'
    and (select voided_at is null from public.recipe_draws where sale_key = 'sale-3'),
    r::text;
end $$;

-- V1 (W7): voiding the gin pour puts the 45 ml back; the open bottle is whole again.
do $$ declare r jsonb; begin
  r := pg_temp.void('sale-gin');
  insert into _t select 'V1',
    r ->> 'status' = 'returned'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000101') = 2
    and pg_temp.open_ml('d3a00000-0000-4000-8000-000000000101') = 0
    and exists (select 1 from public.inventory_transactions t
                 where t.idempotency_key = 'sale-gin:r:d3a00000-0000-4000-8000-000000000101:pour:void'
                   and t.quantity_change = 1 and t.transaction_type = 'return')
    and (select units_returned from public.recipe_draws where sale_key = 'sale-gin') = 45,
    r::text;
end $$;

-- V2 (W4): the same void again gives back nothing.
do $$ declare r jsonb; begin
  r := pg_temp.void('sale-gin');
  insert into _t select 'V2',
    r ->> 'status' = 'replay' and pg_temp.qty('d3a00000-0000-4000-8000-000000000101') = 2,
    r::text;
end $$;

-- V3 (W8): a void of a sale that never booked gives back nothing.
do $$ declare r jsonb; begin
  r := pg_temp.void('sale-short');
  insert into _t select 'V3', r ->> 'status' = 'nothing_booked', r::text;
end $$;

-- V4 (W7, W1): sale-2 booked 8 g, but three sales of salt came after it. Its
-- void gives back 7 g, and booked plus carried still equals the standing draws.
do $$ declare r jsonb; begin
  r := pg_temp.void('sale-2');
  insert into _t select 'V4',
    r ->> 'status' = 'returned'
    and (select units_returned from public.recipe_draws where sale_key = 'sale-2') = 7
    and exists (select 1 from public.inventory_transactions
                 where idempotency_key = 'sale-2:r:d3a00000-0000-4000-8000-000000000102:book:void'
                   and transaction_type = 'return' and quantity_change = 7)
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 970
    and (select (sum(units) - sum(coalesce(units_returned, 0))) * 1000000000
                + pg_temp.carry('d3a00000-0000-4000-8000-000000000102')
           = sum(exact_micro) filter (where voided_at is null)
           from public.recipe_draws where inventory_id = 'd3a00000-0000-4000-8000-000000000102'),
    r::text;
end $$;

-- V5 (W7): a lemon and a half, voided at once, gives back the one lemon and puts the carry back at 0.
do $$ declare r jsonb; v jsonb; begin
  r := pg_temp.draw('sale-lemon', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000103', 'book', 'each_milli', '1000', '1500000000')));
  v := pg_temp.void('sale-lemon');
  insert into _t select 'V5',
    r ->> 'status' = 'booked' and v ->> 'status' = 'returned'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000103') = 20
    and pg_temp.carry('d3a00000-0000-4000-8000-000000000103') = 0
    and (select units = units_returned from public.recipe_draws where sale_key = 'sale-lemon'),
    r::text || ' / ' || v::text;
end $$;

-- V6: a voided pour that fits back in the open bottle restores no bottle and writes no ledger row.
do $$ declare r jsonb; begin
  perform pg_temp.draw('sale-gin2', jsonb_build_array(
    pg_temp.d('d3a00000-0000-4000-8000-000000000101', 'pour', 'ml10', '10', '450000000')));
  perform pg_temp.draw('sale-gin3', jsonb_build_array(
    pg_temp.d('d3a00000-0000-4000-8000-000000000101', 'pour', 'ml10', '10', '450000000')));
  r := pg_temp.void('sale-gin3');
  insert into _t select 'V6',
    r ->> 'status' = 'returned'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000101') = 1
    and pg_temp.open_ml('d3a00000-0000-4000-8000-000000000101') = 655
    and not exists (select 1 from public.inventory_transactions
                     where idempotency_key = 'sale-gin3:r:d3a00000-0000-4000-8000-000000000101:pour:void'),
    r::text;
end $$;

-- V7: with no lot left to take the ml back, the void waits and nothing is written.
do $$ declare r jsonb; begin
  delete from public.inventory_lots where inventory_id = 'd3a00000-0000-4000-8000-000000000101';
  r := pg_temp.void('sale-gin2');
  insert into _t select 'V7',
    r ->> 'status' = 'wait' and r -> 'waits' -> 0 ->> 'reason' = 'no_lot'
    and (select voided_at is null from public.recipe_draws where sale_key = 'sale-gin2'),
    r::text;
end $$;

-- V9: the ml go back to the lot whose bottle is open, not to a newer sealed lot.
do $$ declare h uuid := 'd3a00000-0000-4000-8000-000000000001'; rum uuid := 'd3a00000-0000-4000-8000-000000000108'; r jsonb; begin
  perform pg_temp.good(rum, h, 'Rum', 'spirit', 'bottle', 700);
  perform pg_temp.lot(rum, 0, 300, 10);
  perform pg_temp.lot(rum, 2, 0, 2);
  perform pg_temp.draw('sale-rum', jsonb_build_array(pg_temp.d(rum, 'pour', 'ml10', '10', '450000000')));
  r := pg_temp.void('sale-rum');
  insert into _t select 'V9',
    r ->> 'status' = 'returned'
    and (select string_agg(qty || '+' || open_bottle_ml, ' ' order by received_at) from public.inventory_lots
          where inventory_id = rum) = '0+300 2+0',
    r::text;
end $$;

-- V10: a poured good whose bottle size was taken off since the sale waits.
do $$ declare rum uuid := 'd3a00000-0000-4000-8000-000000000108'; r jsonb; begin
  perform pg_temp.draw('sale-rum2', jsonb_build_array(pg_temp.d(rum, 'pour', 'ml10', '10', '450000000')));
  update public.restaurant_inventory set bottle_size_ml = null where id = rum;
  r := pg_temp.void('sale-rum2');
  insert into _t select 'V10',
    r ->> 'status' = 'wait' and r -> 'waits' -> 0 ->> 'reason' = 'no_container_size', r::text;
end $$;

-- V11: another house's sale under the same key is not given back with this one's.
do $$ declare r jsonb; begin
  r := public.record_recipe_draw('d3a00000-0000-4000-8000-000000000002', 'sale-4',
    'd3a00000-0000-4000-8000-0000000000f1', null,
    jsonb_build_array(pg_temp.d('d3a00000-0000-4000-8000-000000000107', 'pour', 'ml10', '10', '450000000')));
  perform pg_temp.void('sale-4');
  insert into _t select 'V11',
    r ->> 'status' = 'booked'
    and (select voided_at is null from public.recipe_draws
          where sale_key = 'sale-4' and restaurant_id = 'd3a00000-0000-4000-8000-000000000002')
    and pg_temp.open_ml('d3a00000-0000-4000-8000-000000000107') = 655,
    r::text;
end $$;

-- W2: every carry is under one ledger unit of its good.
insert into _t
select 'W2', bool_and(c.carry_micro < x.base_per_unit * 1000000), count(*) || ' carry rows'
  from public.recipe_draw_carry c
  join public.restaurant_inventory ri on ri.id = c.inventory_id
  cross join lateral public.recipe_draw_route(c.base_unit, ri.uom, ri.bottle_size_ml) x;

-- C7: no client role can call the void.
insert into _t
select 'C7',
  not has_function_privilege('anon', 'public.reverse_recipe_draw(uuid, text, timestamptz, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.reverse_recipe_draw(uuid, text, timestamptz, text)', 'execute'),
  'client grants';

select id, ok, detail from _t order by id;

rollback;
