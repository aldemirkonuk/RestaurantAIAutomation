-- r102: restate_sale_cost moves a sale costed at the delivery's estimate to the
-- invoice's cost, keeps the old figure, leaves invoiced-lot sales alone, and is
-- idempotent. Self-asserting; synthetic fixtures; one transaction, rolled back.
-- NOT RUN in the authoring session (no local database); run on a database built
-- from supabase/migrations.

begin;

do $$
declare
  h uuid := 'a0102000-0000-4000-8000-000000000001';
  h2 uuid := 'a0102000-0000-4000-8000-000000000002';
  inv uuid := 'a0102000-0000-4000-8000-000000000201';
  ord uuid := 'a0102000-0000-4000-8000-000000000301';
  r jsonb;
  c numeric;
  b text;
begin
  insert into public.restaurants (id, name, slug) values (h, 'RS test house', 'rs-test-house'), (h2, 'RS other house', 'rs-other-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0102000-0000-4000-8000-000000000101', 'RS-TEST-1', 'RS test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0102000-0000-4000-8000-000000000101', 750, 150);

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id)
  values
    ('a0102000-0000-4000-8000-000000000401', h, inv, 'w', 'bottle', 2, 1500, 'pos', 20, 'last_purchase_price', 10, ord),
    ('a0102000-0000-4000-8000-000000000402', h, inv, 'w', 'glass', 1, 150, 'pos', 2, 'last_purchase_price', 10, ord),
    ('a0102000-0000-4000-8000-000000000403', h, inv, 'w', 'bottle', 1, 750, 'pos', 10, 'invoice_lot_wac', 10, ord),
    ('a0102000-0000-4000-8000-000000000404', h, inv, 'w', 'bottle', 0, 0, 'pos', 0, 'last_purchase_price', 10, ord);

  -- another house's item is refused
  begin
    perform public.restate_sale_cost(h2, inv, ord, 12);
    raise exception 'RS1: a foreign item was restated';
  exception when sqlstate '42501' then null; end;

  r := public.restate_sale_cost(h, inv, ord, 12);
  if (r->>'rows_restated')::int <> 2 then raise exception 'RS2: expected 2 rows restated, got %', r; end if;

  select cost_at_sale into c from public.wine_consumption_log where id = 'a0102000-0000-4000-8000-000000000401';
  if c <> 24 then raise exception 'RS3: two bottles at 12 should be 24, got %', c; end if;
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = 'a0102000-0000-4000-8000-000000000402';
  if c <> 2.4 or b <> 'invoice_restated' then raise exception 'RS4: a glass should be 2.4 restated, got % %', c, b; end if;
  select cost_at_sale into c from public.wine_consumption_log where id = 'a0102000-0000-4000-8000-000000000403';
  if c <> 10 then raise exception 'RS5: an invoiced-lot sale must not move, got %', c; end if;
  select cost_at_sale into c from public.wine_consumption_log where id = 'a0102000-0000-4000-8000-000000000404';
  if c <> 0 then raise exception 'RS6: a voided line must stay zero, got %', c; end if;

  if (select count(*) from public.wine_consumption_cost_restatements where source_order_id = ord) <> 2
     or (select prior_cost_at_sale from public.wine_consumption_cost_restatements
          where consumption_id = 'a0102000-0000-4000-8000-000000000401') <> 20 then
    raise exception 'RS7: the audit rows must keep the figure before';
  end if;

  r := public.restate_sale_cost(h, inv, ord, 12);
  if (r->>'rows_restated')::int <> 0 then raise exception 'RS8: a second run at the same cost must restate nothing, got %', r; end if;

  r := public.restate_sale_cost(h, inv, ord, 13);
  if (r->>'rows_restated')::int <> 2 then raise exception 'RS9: a corrected price restates again, got %', r; end if;
  select cost_at_sale into c from public.wine_consumption_log where id = 'a0102000-0000-4000-8000-000000000401';
  if c <> 26 then raise exception 'RS10: expected 26, got %', c; end if;
end $$;

-- r103: a free line (invoice price 0) restates; a negative or null cost does not;
-- and a unit cost with more than six places is rounded once, so a retry is a no-op.
do $$
declare
  h uuid := 'a0102000-0000-4000-8000-000000000001';
  inv uuid := 'a0102000-0000-4000-8000-000000000201';
  ordz uuid := 'a0102000-0000-4000-8000-000000000302';
  ordr uuid := 'a0102000-0000-4000-8000-000000000303';
  r jsonb;
  c numeric;
begin
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id)
  values
    ('a0102000-0000-4000-8000-000000000411', h, inv, 'w', 'bottle', 1, 750, 'pos', 10, 'last_purchase_price', 10, ordz),
    ('a0102000-0000-4000-8000-000000000421', h, inv, 'w', 'bottle', 1, 750, 'pos', 10, 'last_purchase_price', 10, ordr);

  begin
    perform public.restate_sale_cost(h, inv, ordz, -1);
    raise exception 'RS11: a negative cost was accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.restate_sale_cost(h, inv, ordz, null);
    raise exception 'RS12: a null cost was accepted';
  exception when sqlstate '22023' then null; end;

  r := public.restate_sale_cost(h, inv, ordz, 0);
  if (r->>'rows_restated')::int <> 1 then raise exception 'RS13: a free bottle (cost 0) must restate the sale, got %', r; end if;
  select cost_at_sale into c from public.wine_consumption_log where id = 'a0102000-0000-4000-8000-000000000411';
  if c <> 0 then raise exception 'RS14: a free bottle should cost 0, got %', c; end if;

  r := public.restate_sale_cost(h, inv, ordr, 125::numeric / 12);
  if (r->>'rows_restated')::int <> 1 then raise exception 'RS15: expected 1 row restated, got %', r; end if;
  r := public.restate_sale_cost(h, inv, ordr, 125::numeric / 12);
  if (r->>'rows_restated')::int <> 0 then raise exception 'RS16: a retry at an unrounded cost must restate nothing, got %', r; end if;
  if (select count(*) from public.wine_consumption_cost_restatements where source_order_id = ordr) <> 1 then
    raise exception 'RS17: a retry must not append a second audit row';
  end if;
end $$;

rollback;
