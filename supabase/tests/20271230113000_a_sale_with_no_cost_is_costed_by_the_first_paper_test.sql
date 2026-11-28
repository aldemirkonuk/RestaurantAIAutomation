-- r110 invoices-g3: a sale that sold with no cost is costed once, by the first
-- checked paper, at round(cost_share x unit cost, 4). A void, a row with no
-- share, a costed row and another house's item are not touched; a correction
-- of the same paper re-costs from the share and keeps the word.
-- (The two-sessions-at-once case is run by hand against two connections; see
-- the PR body. One session cannot interleave two seals.)
-- Self-asserting; synthetic; rolled back.

begin;

do $$
declare
  h uuid := 'a0110000-0000-4000-8000-000000000001';
  h2 uuid := 'a0110000-0000-4000-8000-000000000002';
  inv uuid := 'a0110000-0000-4000-8000-000000000201';
  inv2 uuid := 'a0110000-0000-4000-8000-000000000202'; -- the other house's good
  oa uuid := 'a0110000-0000-4000-8000-000000000301';
  ob uuid := 'a0110000-0000-4000-8000-000000000302';
  s1 uuid := 'a0110000-0000-4000-8000-000000000401'; -- a pour, no cost
  s2 uuid := 'a0110000-0000-4000-8000-000000000402'; -- two bottles, no cost
  s3 uuid := 'a0110000-0000-4000-8000-000000000403'; -- a void, no cost
  s4 uuid := 'a0110000-0000-4000-8000-000000000404'; -- no share (bottle size unknown)
  s5 uuid := 'a0110000-0000-4000-8000-000000000405'; -- already costed
  s6 uuid := 'a0110000-0000-4000-8000-000000000406'; -- a third of a bottle
  s7 uuid := 'a0110000-0000-4000-8000-000000000407'; -- a 0.75 ml taste
  r jsonb;
  c numeric;
  u numeric;
  b text;
  o uuid;
  n int;
begin
  insert into public.restaurants (id, name, slug) values
    (h, 'CA test house', 'ca-test-house'), (h2, 'CA other house', 'ca-other-house');
  insert into public.master_wine_library (id, wine_id, name, primary_type)
  values ('a0110000-0000-4000-8000-000000000101', 'CA-TEST-1', 'CA test wine', 'red');
  insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
  values (inv, h, 'a0110000-0000-4000-8000-000000000101', 750, 150),
         (inv2, h2, 'a0110000-0000-4000-8000-000000000101', 750, 150);

  insert into public.wine_consumption_log
    (id, restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source,
     cost_at_sale, cost_basis, cost_unit_at_sale, cost_source_order_id, cost_share)
  values
    (s1, h, inv, 'w', 'glass', 1, 150, 'pos', null, null, null, null, 0.2),
    (s2, h, inv, 'w', 'bottle', 2, 1500, 'pos', null, null, null, null, 2),
    (s3, h, inv, 'w', 'glass', 0, 0, 'pos', null, null, null, null, 0.2),
    (s4, h, inv, 'w', 'glass', 1, 150, 'pos', null, null, null, null, null),
    (s5, h, inv, 'w', 'bottle', 1, 750, 'pos', 9, 'last_purchase_price', 9, ob, 1),
    (s6, h, inv, 'w', 'glass', 1, 250, 'pos', null, null, null, null, 0.333333),
    (s7, h, inv, 'w', 'glass', 1, 1, 'pos', null, null, null, null, 0.001);

  -- CA1: the first paper (A at 7.77) costs every unpriced row once.
  r := public.cost_unpriced_sales(h, inv, oa, 7.77);
  if (r->>'rows_costed')::int <> 4 then
    raise exception 'CA1: the pour, the two bottles, the third and the taste are costed, got %', r;
  end if;
  select cost_at_sale, cost_unit_at_sale, cost_basis, cost_source_order_id into c, u, b, o
    from public.wine_consumption_log where id = s1;
  if c <> round(0.2 * 7.77, 4) or u <> 7.77 or b <> 'costed_after_sale' or o <> oa then
    raise exception 'CA1: the pour is round(0.2 x 7.77, 4) under costed_after_sale naming A, got % % % %', c, u, b, o;
  end if;
  select cost_at_sale into c from public.wine_consumption_log where id = s2;
  if c <> 15.54 then raise exception 'CA1: two bottles are 2 x 7.77, got %', c; end if;
  -- CA2: round4, not round2 and not the raw product
  select cost_at_sale into c from public.wine_consumption_log where id = s6;
  if c <> 2.5900 or c <> round(0.333333 * 7.77, 4) then
    raise exception 'CA2: a third is round(0.333333 x 7.77, 4) = 2.5900, got %', c;
  end if;

  -- CA3: the audit row has a null prior and the new figure.
  select count(*) into n from public.wine_consumption_cost_restatements
   where consumption_id = s1 and source_order_id = oa and prior_cost_at_sale is null
     and prior_cost_basis is null and prior_unit_cost is null and new_cost_at_sale = round(0.2 * 7.77, 4);
  if n <> 1 then raise exception 'CA3: one audit row with a null prior, got %', n; end if;

  -- CA4: a second paper (B at 9.99) costs nothing: first seal wins.
  r := public.cost_unpriced_sales(h, inv, ob, 9.99);
  if (r->>'rows_costed')::int <> 0 then raise exception 'CA4: a costed row is never re-costed, got %', r; end if;
  select cost_at_sale, cost_source_order_id into c, o from public.wine_consumption_log where id = s1;
  if c <> round(0.2 * 7.77, 4) or o <> oa then raise exception 'CA4: the first paper stays, got % %', c, o; end if;

  -- CA5: the void, the row with no share and the costed row are untouched.
  select cost_at_sale into c from public.wine_consumption_log where id = s3;
  if c is not null then raise exception 'CA5: a void is never costed, got %', c; end if;
  select cost_at_sale into c from public.wine_consumption_log where id = s4;
  if c is not null then raise exception 'CA5: no share, no cost (never guessed), got %', c; end if;
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s5;
  if c <> 9 or b <> 'last_purchase_price' then raise exception 'CA5: a costed row is left alone, got % %', c, b; end if;

  -- CA6: another house's item raises 42501 and costs nothing.
  begin
    perform public.cost_unpriced_sales(h, inv2, oa, 7.77);
    raise exception 'CA6: another house''s item must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cost_unpriced_sales(h, inv, oa, 0);
    raise exception 'CA6: a zero cost must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- CA7: a correction of paper A (8.15) re-costs from the share and keeps the word.
  r := public.restate_sale_cost(h, inv, oa, 8.15);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s6;
  if c <> round(0.333333 * 8.15, 4) or b <> 'costed_after_sale' then
    raise exception 'CA7: the correction is round(share x 8.15, 4) and stays costed_after_sale, got % %', c, b;
  end if;
  select cost_at_sale into c from public.wine_consumption_log where id = s2;
  if c <> 16.3 then raise exception 'CA7: two bottles re-cost to 16.30, got %', c; end if;
  -- the costed row of paper B is not paper A's
  select cost_at_sale into c from public.wine_consumption_log where id = s5;
  if c <> 9 then raise exception 'CA7: B''s row is not A''s correction, got %', c; end if;

  -- CA8: a second correction (12.34) re-costs from the share, not by scaling
  -- the rounded figure: 0.001 x 12.34 = 0.0123, where 0.0082 x 12.34 / 8.15
  -- would read 0.0124.
  r := public.restate_sale_cost(h, inv, oa, 12.34);
  select cost_at_sale into c from public.wine_consumption_log where id = s7;
  if c <> 0.0123 then raise exception 'CA8: the taste is round(0.001 x 12.34, 4) = 0.0123, got %', c; end if;

  -- CA9: the callers' own shape, five NAMED arguments, resolves to exactly one
  -- function (a second overload is 42725) and it still re-costs from the share.
  select count(*) into n from pg_proc
   where proname = 'restate_sale_cost' and pronamespace = 'public'::regnamespace;
  if n <> 1 then raise exception 'CA9: one restate_sale_cost, got % overloads', n; end if;
  r := public.restate_sale_cost(p_restaurant_id => h, p_inventory_id => inv,
         p_source_order_id => oa, p_unit_cost => 9.5, p_performed_by => null);
  select cost_at_sale, cost_basis into c, b from public.wine_consumption_log where id = s6;
  if c <> round(0.333333 * 9.5, 4) or b <> 'costed_after_sale' then
    raise exception 'CA9: five named arguments re-cost from the share and keep the word, got % %', c, b;
  end if;
end $$;

rollback;
