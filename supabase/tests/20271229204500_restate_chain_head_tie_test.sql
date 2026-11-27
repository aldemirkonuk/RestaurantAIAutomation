-- r110 invoices-8 (DD-r109-32): the base a restatement scales is the head of
-- the chain, also when two events share one created_at (one act, one stamp:
-- #2248 groups on it, so v2 stamps now(), not clock_timestamp()).
--
-- The priors are set by hand so the pick is visible: the event that was
-- restated INTO is given the SMALLER id, so ORDER BY created_at, id alone (the
-- version before 29ced8f64) picks it and fails CH2/CH4. Real chains differ
-- only by rounding; that drift is what the head pick stops compounding.
-- Self-asserting; synthetic; rolled back.

begin;

do $$
declare
  h uuid := 'a0110000-0000-4000-8000-000000000001';
  inv uuid := 'a0110000-0000-4000-8000-000000000201';
  oa uuid := 'a0110000-0000-4000-8000-000000000301';
  ob uuid := 'a0110000-0000-4000-8000-000000000302';
  oc uuid := 'a0110000-0000-4000-8000-000000000303';
  s1 uuid := 'a0110000-0000-4000-8000-000000000401'; -- tie in one stamp
  s2 uuid := 'a0110000-0000-4000-8000-000000000402'; -- tie, then a later act back to the first figure
  e_head uuid := 'a0110000-0000-4000-8000-0000000009f1';
  e_next uuid := 'a0110000-0000-4000-8000-0000000009e1'; -- smaller id than the head
  e_head2 uuid := 'a0110000-0000-4000-8000-0000000009f2';
  e_next2 uuid := 'a0110000-0000-4000-8000-000000000901'; -- smallest id of s2's chain
  e_late uuid := 'a0110000-0000-4000-8000-0000000009e8';
  t0 timestamptz := now() - interval '1 hour';
  parts jsonb;
  -- 30 bottles: A 10 @ 7.50 and B 12 @ 9.40 checked, C 8 on an estimate of 9, checked at 8.60.
  wac numeric := (10 * 7.5 + 12 * 9.4 + 8 * 8.6) / 30.0;
  want numeric;      -- the first booking (1.80 at 9) scaled to the new WAC
  from_next numeric; -- what scaling the restated-into event gives
  c numeric;
  b text;
begin
  insert into public.restaurants (id, name, slug) values (h, 'CH test house', 'ch-test-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0110000-0000-4000-8000-000000000101', 'CH-TEST-1', 'CH test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0110000-0000-4000-8000-000000000101', 750, 150);

  parts := jsonb_build_array(
    jsonb_build_object('order_id', oa::text, 'lot_id', 'lot-a', 'qty', 10, 'unit_cost', 7.5, 'invoiced', true),
    jsonb_build_object('order_id', ob::text, 'lot_id', 'lot-b', 'qty', 12, 'unit_cost', 9.4, 'invoiced', true),
    jsonb_build_object('order_id', oc::text, 'lot_id', 'lot-c', 'qty', 8, 'unit_cost', 9, 'invoiced', false));

  want := round(1.8 * wac / 9, 4);
  from_next := round(2.0 * wac / 9.5, 4);
  if abs(want - from_next) < 0.01 then
    raise exception 'CH0: the fixture must tell the head from the next event (% vs %)', want, from_next;
  end if;

  -- s1: one act restated it twice (A then B). Head: 1.80 @ 9 -> 2.00 @ 9.5.
  -- Next: 2.00 @ 9.5 -> 1.80 @ 9.5 (same cost, another unit: a cost-only
  -- match is not a chain link).
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts)
  values (s1, h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'invoice_lot_wac_partial', 9.5, oa, parts);
  insert into public.wine_consumption_cost_restatements
    (id, restaurant_id, inventory_id, consumption_id, source_order_id,
     prior_cost_at_sale, prior_cost_basis, prior_unit_cost, new_cost_at_sale, new_unit_cost, created_at)
  values
    (e_head, h, inv, s1, oa, 1.8, 'last_purchase_price', 9, 2.0, 9.5, t0),
    (e_next, h, inv, s1, ob, 2.0, 'invoice_lot_wac_partial', 9.5, 1.8, 9.5, t0);

  if e_next >= e_head then raise exception 'CH1: the next event must sort before the head by id'; end if;

  perform public.restate_sale_cost(h, inv, oc, 8.6);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s1;
  if abs(c - want) > 0.00005 or b <> 'invoice_restated' then
    raise exception 'CH2: two events in one stamp: scale the head (1.80 @ 9) to %, not % (the next event), got % %',
      want, from_next, c, b;
  end if;

  -- s2: the same tie an hour ago, then a later act took it back to 1.80 @ 9.
  -- A later stamp restating into the head does not make it a non-head.
  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_parts)
  values (s2, h, inv, 'w', 'glass', 1, 150, 'pos', 1.8, 'invoice_lot_wac_partial', 9, oa, parts);
  insert into public.wine_consumption_cost_restatements
    (id, restaurant_id, inventory_id, consumption_id, source_order_id,
     prior_cost_at_sale, prior_cost_basis, prior_unit_cost, new_cost_at_sale, new_unit_cost, created_at)
  values
    (e_head2, h, inv, s2, oa, 1.8, 'last_purchase_price', 9, 2.0, 9.5, t0),
    (e_next2, h, inv, s2, ob, 2.0, 'invoice_lot_wac_partial', 9.5, 1.7, 9.5, t0);
  insert into public.wine_consumption_cost_restatements
    (id, restaurant_id, inventory_id, consumption_id, source_order_id,
     prior_cost_at_sale, prior_cost_basis, prior_unit_cost, new_cost_at_sale, new_unit_cost, created_at)
  values (e_late, h, inv, s2, ob, 1.7, 'invoice_lot_wac_partial', 9.5, 1.8, 9, t0 + interval '30 minutes');

  if e_next2 >= e_head2 then raise exception 'CH3: the next event must sort before the head by id'; end if;

  perform public.restate_sale_cost(h, inv, oc, 8.6);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s2;
  if abs(c - want) > 0.00005 or b <> 'invoice_restated' then
    raise exception 'CH4: a later act back to 1.80 @ 9 must not unseat the head, want % not %, got % %',
      want, from_next, c, b;
  end if;
end $$;

rollback;
