-- inventory_analytics after inventory_analytics_reads_one_houses_lots.
-- Self-asserting, rolled back; `psql -v ON_ERROR_STOP=1 -f` on a database
-- built from supabase/migrations (CI runs no supabase/tests file). Ids are
-- synthetic.
--
-- What must hold:
--   1. one house's read of the view takes its lots by house: the plan's
--      inventory_lots scan carries a restaurant_id condition (it was a scan
--      of every house's lots, filtered only after the GROUP BY);
--   2. each house's on_hand is its own lots, and another house's lots never
--      reach it;
--   3. a lot filed under another house than its good's is not counted for
--      the good's house;
--   4. the view's columns are unchanged and the patched join is in place.

begin;
set local timezone = 'UTC';
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('a1170000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid
$$;

insert into public.restaurants (id, name, slug) values
  (pg_temp.u('1'), 'Lots test house A', 'lots-test-house-a'),
  (pg_temp.u('2'), 'Lots test house B', 'lots-test-house-b');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance, is_active)
values
  (pg_temp.u('11'), pg_temp.u('1'), 'food', 'g', 'A flour', 'house_declared', true),
  (pg_temp.u('12'), pg_temp.u('1'), 'food', 'g', 'A sugar', 'house_declared', true),
  (pg_temp.u('21'), pg_temp.u('2'), 'food', 'g', 'B flour', 'house_declared', true);

insert into public.inventory_lots (restaurant_id, inventory_id, qty, stock_state, unit_cost, cost_provenance)
values
  (pg_temp.u('1'), pg_temp.u('11'), 500, 'live', 0.002, 'invoice'),
  (pg_temp.u('1'), pg_temp.u('11'), 250, 'live', 0.002, 'invoice'),
  (pg_temp.u('1'), pg_temp.u('12'), 300, 'live', 0.001, 'invoice'),
  (pg_temp.u('2'), pg_temp.u('21'), 9000, 'live', 0.002, 'invoice'),
  -- Filed under house B, pointing at house A's flour.
  (pg_temp.u('2'), pg_temp.u('11'), 7000, 'live', 0.002, 'invoice');

do $$
declare
  v_plan json;
  v_lot_nodes text;
begin
  -- 2. Each house reads its own lots.
  assert (select on_hand from public.inventory_analytics where inventory_id = pg_temp.u('11') and restaurant_id = pg_temp.u('1')) = 750,
    'A flour reads A''s two lots (750), not B''s stray 7000';
  assert (select on_hand from public.inventory_analytics where inventory_id = pg_temp.u('12')) = 300, 'A sugar reads 300';
  assert (select on_hand from public.inventory_analytics where inventory_id = pg_temp.u('21')) = 9000, 'B flour reads 9000';
  -- 3. The stray lot adds a row to no one: one row per good.
  assert (select count(*) from public.inventory_analytics where inventory_id = pg_temp.u('11')) = 1,
    'A flour is one row; the stray lot under B does not add a second';
  assert (select count(*) from public.inventory_analytics where restaurant_id = pg_temp.u('1')) = 2, 'A has two goods';

  -- 1. The lot read is by house. Seq scans off so the plan shape, not the
  -- table size, decides; the condition must sit on the inventory_lots node.
  set local enable_seqscan = off;
  execute format('explain (format json) select * from public.inventory_analytics where restaurant_id = %L', pg_temp.u('1'))
    into v_plan;
  select string_agg(n::text, ' ') into v_lot_nodes
    from jsonb_path_query(v_plan::jsonb, 'lax $.**? (@."Relation Name" == "inventory_lots")') n;
  assert v_lot_nodes is not null, 'the plan reads inventory_lots';
  assert v_lot_nodes ~ 'restaurant_id', format('the inventory_lots read carries the house: %s', v_lot_nodes);
  reset enable_seqscan;

  -- 4. Columns and the join.
  assert pg_get_viewdef('public.inventory_analytics'::regclass, false) ~ 'r\.restaurant_id = ri\.restaurant_id',
    'the rollup join names the house';
  assert (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
           where a.attrelid = 'public.inventory_analytics'::regclass and a.attnum > 0 and not a.attisdropped)
       = 'inventory_id,restaurant_id,on_hand,sold_30d,sold_90d,last_sold_at,velocity_per_day,days_of_cover,reorder_point,reorder_suggested,abc_class,dead_stock,days_since_sale,usage_source,usage_since,usage_until,usage_qty',
    'the view keeps its columns in order';
end $$;

rollback;
