-- A recipe sale books its draw (inventory r28 gap 1, slice 3b; migration
-- 20271020110000_a_recipe_sale_books_its_draw.sql). W1-W9 are the slice 3
-- migrations' invariants.
--
-- Run on a database built from supabase/migrations; one transaction, rolled
-- back. One row per case (id, ok, detail); every ok must be true. Without the
-- migration the first draw errors (no record_recipe_draw), which is the control.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

-- Fixture: two houses; goods kept in bottles, grams, eaches and ml.
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


-- D1: 7.5 g of salt books 7 g and carries half a gram; the ledger row carries the sale's key.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-1', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '7500000000')));
  insert into _t select 'D1',
    r ->> 'status' = 'booked'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 993
    and pg_temp.carry('d3a00000-0000-4000-8000-000000000102') = 500000000
    and exists (select 1 from public.inventory_transactions t
                 where t.idempotency_key = 'sale-1:r:d3a00000-0000-4000-8000-000000000102:book'
                   and t.quantity_change = -7 and t.transaction_type = 'sale'
                   and t.transaction_date < now() - interval '50 minutes'),
    r::text;
end $$;

-- D2 (W1): four more sales of 7.5 g book 8, 7, 8, 7. Five sales: 37 g booked, half a gram carried.
do $$ declare i int; begin
  for i in 2..5 loop
    perform pg_temp.draw('sale-' || i, jsonb_build_array(
      pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '7500000000')));
  end loop;
  insert into _t select 'D2',
    pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 963
    and pg_temp.carry('d3a00000-0000-4000-8000-000000000102') = 500000000
    and (select string_agg(units::text, ',' order by sale_key) from public.recipe_draws
          where inventory_id = 'd3a00000-0000-4000-8000-000000000102') = '7,8,7,8,7',
    (select string_agg(units::text, ',' order by sale_key) from public.recipe_draws
      where inventory_id = 'd3a00000-0000-4000-8000-000000000102');
end $$;

-- D3 (W4): the same sale key again books nothing and moves no carry.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-1', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '7500000000')));
  insert into _t select 'D3',
    r ->> 'status' = 'replay'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 963
    and pg_temp.carry('d3a00000-0000-4000-8000-000000000102') = 500000000,
    r::text;
end $$;

-- D4: 45 ml of gin pours from the open container: one bottle opened, 655 ml left in it.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-gin', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000101', 'pour', 'ml10', '10', '450000000')));
  insert into _t select 'D4',
    r ->> 'status' = 'booked'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000101') = 1
    and pg_temp.open_ml('d3a00000-0000-4000-8000-000000000101') = 655
    and exists (select 1 from public.pour_events p
                 where p.idempotency_key = 'sale-gin:r:d3a00000-0000-4000-8000-000000000101:pour' and p.pour_ml = 45),
    r::text;
end $$;

-- D5 (W3): gin is there but 50 lemons are not, so the line takes nothing at all.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-short', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000101', 'pour', 'ml10', '10', '450000000'),
         pg_temp.d('d3a00000-0000-4000-8000-000000000103', 'book', 'each_milli', '1000', '50000000000')));
  insert into _t select 'D5',
    r ->> 'status' = 'short'
    and r -> 'short' -> 0 ->> 'inventory_id' = 'd3a00000-0000-4000-8000-000000000103'
    and (r -> 'short' -> 0 ->> 'need')::int = 50 and (r -> 'short' -> 0 ->> 'have')::int = 20
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000101') = 1
    and pg_temp.open_ml('d3a00000-0000-4000-8000-000000000101') = 655
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000103') = 20
    and not exists (select 1 from public.recipe_draws where sale_key = 'sale-short')
    and not exists (select 1 from public.recipe_draw_carry where inventory_id = 'd3a00000-0000-4000-8000-000000000103'),
    r::text;
end $$;

-- D6 (W3): a bottle with no size cannot be poured; the line waits and the gin is untouched.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-nosize', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000101', 'pour', 'ml10', '10', '450000000'),
         pg_temp.d('d3a00000-0000-4000-8000-000000000105', 'pour', 'ml10', '10', '300000000')));
  insert into _t select 'D6',
    r ->> 'status' = 'wait'
    and r -> 'waits' = jsonb_build_array(jsonb_build_object(
          'inventory_id', 'd3a00000-0000-4000-8000-000000000105', 'reason', 'no_container_size'))
    and pg_temp.open_ml('d3a00000-0000-4000-8000-000000000101') = 655
    and not exists (select 1 from public.recipe_draws where sale_key = 'sale-nosize'),
    r::text;
end $$;

-- D7 (W6): a plan made when salt was kept in mg does not book grams as mg.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-changed', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1', '7500000000')));
  insert into _t select 'D7',
    r ->> 'status' = 'wait' and r -> 'waits' -> 0 ->> 'reason' = 'changed'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 963,
    r::text;
end $$;

-- D8: a good the house removed waits.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-removed', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000106', 'book', 'ml10', '10', '10000000')));
  insert into _t select 'D8', r ->> 'status' = 'wait' and r -> 'waits' -> 0 ->> 'reason' = 'removed', r::text;
end $$;

-- D9 (W5): another house's gin is refused 42501, and the line's own salt is not drawn either.
do $$ begin
  begin
    perform pg_temp.draw('sale-foreign', jsonb_build_array(
      pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '1000000000'),
      pg_temp.d('d3a00000-0000-4000-8000-000000000107', 'pour', 'ml10', '10', '450000000')));
    insert into _t values ('D9', false, 'another house''s good was drawn');
  exception when sqlstate '42501' then
    insert into _t select 'D9',
      pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 963
      and pg_temp.qty('d3a00000-0000-4000-8000-000000000107') = 3
      and not exists (select 1 from public.recipe_draws where sale_key = 'sale-foreign'),
      'refused 42501';
  end;
end $$;

-- D10: a line that names one good twice, or sends its amount as a JSON number, is refused.
do $$ declare n int := 0; begin
  begin
    perform pg_temp.draw('sale-twice', jsonb_build_array(
      pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '1000000000'),
      pg_temp.d('d3a00000-0000-4000-8000-000000000102', 'book', 'mg', '1000', '1000000000')));
  exception when sqlstate 'RDR00' then n := n + 1;
  end;
  begin
    perform pg_temp.draw('sale-number', jsonb_build_array(jsonb_build_object(
      'inventory_id', 'd3a00000-0000-4000-8000-000000000102', 'via', 'book', 'base_unit', 'mg',
      'base_per_unit', '1000', 'exact_micro', 1000000000)));
  exception when sqlstate 'RDR00' then n := n + 1;
  end;
  insert into _t select 'D10', n = 2 and pg_temp.qty('d3a00000-0000-4000-8000-000000000102') = 963, n || ' refused';
end $$;

-- D11: a dash under one ml books nothing yet and is carried.
do $$ declare r jsonb; begin
  r := pg_temp.draw('sale-dash', jsonb_build_array(
         pg_temp.d('d3a00000-0000-4000-8000-000000000104', 'book', 'ml10', '10', '5000000')));
  insert into _t select 'D11',
    r ->> 'status' = 'booked'
    and pg_temp.qty('d3a00000-0000-4000-8000-000000000104') = 5000
    and pg_temp.carry('d3a00000-0000-4000-8000-000000000104') = 5000000
    and (select units from public.recipe_draws where sale_key = 'sale-dash') = 0
    and not exists (select 1 from public.inventory_transactions
                     where inventory_id = 'd3a00000-0000-4000-8000-000000000104' and transaction_type = 'sale'),
    r::text;
end $$;

-- C6: no client role can call the writer.
insert into _t
select 'C6',
  not has_function_privilege('anon', 'public.record_recipe_draw(uuid, text, uuid, uuid, jsonb, timestamptz, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_recipe_draw(uuid, text, uuid, uuid, jsonb, timestamptz, text)', 'execute'),
  'client grants';

select id, ok, detail from _t order by id;

rollback;
