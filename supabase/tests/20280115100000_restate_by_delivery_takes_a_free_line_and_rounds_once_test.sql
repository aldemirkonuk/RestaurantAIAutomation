-- #2507 x #2532: restate_sale_cost is re-created by 20280115100000 (after
-- 20271229204500), and the last CREATE OR REPLACE
-- wins. #2507's rules must survive that: a free invoice line (cost 0) is a
-- real cost and restates; a negative or unknown cost does not; the unit is
-- rounded once to the column's six places so a retry restates nothing and
-- appends no second audit row; and a part carries the rounded unit.
-- Self-asserting; synthetic; one transaction, rolled back.

begin;

do $$
declare
  h uuid := 'a0109020-0000-4000-8000-000000000001';
  inv uuid := 'a0109020-0000-4000-8000-000000000201';
  ordz uuid := 'a0109020-0000-4000-8000-000000000302'; -- a free line
  ordr uuid := 'a0109020-0000-4000-8000-000000000303'; -- an unrounded unit, retried
  ordp uuid := 'a0109020-0000-4000-8000-000000000304'; -- a sale with parts
  r jsonb;
  c numeric;
  u numeric;
begin
  insert into public.restaurants (id, name, slug) values (h, 'FD test house', 'fd-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0109020-0000-4000-8000-000000000101', 'FD-TEST-1', 'FD test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0109020-0000-4000-8000-000000000101', 750, 150);

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts)
  values
    ('a0109020-0000-4000-8000-000000000411', h, inv, 'w', 'bottle', 1, 750, 'pos', 10, 'last_purchase_price', 10, ordz, null),
    ('a0109020-0000-4000-8000-000000000421', h, inv, 'w', 'bottle', 1, 750, 'pos', 10, 'last_purchase_price', 10, ordr, null),
    ('a0109020-0000-4000-8000-000000000431', h, inv, 'w', 'bottle', 1, 750, 'pos', 8, 'last_purchase_price', 8, ordp,
       jsonb_build_array(jsonb_build_object('order_id', ordp::text, 'lot_id', 'lot-p', 'qty', 10, 'unit_cost', 8, 'invoiced', false)));

  begin
    perform public.restate_sale_cost(h, inv, ordz, -1);
    raise exception 'FD1: a negative cost was accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.restate_sale_cost(h, inv, ordz, null);
    raise exception 'FD2: a null cost was accepted';
  exception when sqlstate '22023' then null; end;

  r := public.restate_sale_cost(h, inv, ordz, 0);
  if (r->>'rows_restated')::int <> 1 then raise exception 'FD3: a free line (cost 0) must restate the sale, got %', r; end if;
  select cost_at_sale into c from public.wine_consumption_log where id = 'a0109020-0000-4000-8000-000000000411';
  if c <> 0 then raise exception 'FD4: a free line should cost 0, got %', c; end if;

  r := public.restate_sale_cost(h, inv, ordr, 125::numeric / 12);
  if (r->>'rows_restated')::int <> 1 then raise exception 'FD5: expected 1 row restated, got %', r; end if;
  r := public.restate_sale_cost(h, inv, ordr, 125::numeric / 12);
  if (r->>'rows_restated')::int <> 0 then raise exception 'FD6: a retry at an unrounded cost must restate nothing, got %', r; end if;
  if (select count(*) from public.wine_consumption_cost_restatements where source_order_id = ordr) <> 1 then
    raise exception 'FD7: a retry must not append a second audit row';
  end if;
  select cost_unit_at_sale into u from public.wine_consumption_log where id = 'a0109020-0000-4000-8000-000000000421';
  if u <> round(125::numeric / 12, 6) then raise exception 'FD8: the unit is written at six places, got %', u; end if;

  r := public.restate_sale_cost(h, inv, ordp, 125::numeric / 12);
  if (r->>'rows_restated')::int <> 1 then raise exception 'FD9: the sale with parts restates, got %', r; end if;
  select (cost_parts->0->>'unit_cost')::numeric into u from public.wine_consumption_log where id = 'a0109020-0000-4000-8000-000000000431';
  if u <> round(125::numeric / 12, 6) then raise exception 'FD10: a part carries the rounded unit, got %', u; end if;
end $$;

rollback;
