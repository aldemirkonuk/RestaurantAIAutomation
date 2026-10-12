-- F-620 / F-1537 (founder 2026-10-12, S218: F1 build it, F2 only from now,
-- F3 stamp cost basis): migration house_tax_basis_and_rates.
--   A house states whether its till prices include tax, once, with who and
--   when; its rates are kept by date, append-only, versioned per house; a
--   check records the basis it was written under; a cost says whether tax is
--   inside it, and loses that when the figure changes unstated.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 FAILS (there is no tax_basis). One transaction, rolled back.
-- All fixtures are SYNTHETIC, keyed by fixed uuids under f6200000-, and every
-- name starts with "Zqtx", so rows already in a populated database cannot
-- match.

begin;

insert into public.restaurants (id, name, slug) values
  ('f6200000-0000-4000-8000-000000000001', 'Zqtx Kadikoy house', 'zqtx-kadikoy-house'),
  ('f6200000-0000-4000-8000-000000000002', 'Zqtx Brooklyn house', 'zqtx-brooklyn-house');
insert into public.users (user_id, email, name, role, restaurant_id) values
  ('f6200000-0000-4000-8000-0000000000a1', 'zqtx-owner@example.invalid', 'Zqtx owner', 'owner',
   'f6200000-0000-4000-8000-000000000001');
insert into public.providers (id, name, primary_contact, restaurant_id) values
  ('f6200000-0000-4000-8000-0000000000b1', 'Zqtx Vendor', '{}'::jsonb, 'f6200000-0000-4000-8000-000000000001');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('f6200000-0000-4000-8000-0000000000c1', 'f6200000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqtx Okuzgozu', 'house_declared'),
  ('f6200000-0000-4000-8000-0000000000c2', 'f6200000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqtx Narince', 'house_declared');

-- T1: every house starts unset, with no confirmation (the strict no-op state).
do $$
declare r record;
begin
  select tax_basis, tax_basis_confirmed_by, tax_basis_confirmed_at into r
    from public.restaurants where id = 'f6200000-0000-4000-8000-000000000002';
  if r.tax_basis is distinct from 'unset' then
    raise exception 'T1 FAIL: a new house reads tax_basis %, not unset', r.tax_basis;
  end if;
  if r.tax_basis_confirmed_by is not null or r.tax_basis_confirmed_at is not null then
    raise exception 'T1 FAIL: an unset house carries a confirmation';
  end if;
end $$;

-- T2: a basis is one of four, comes with who and when, and a change moves the when.
do $$
declare refused boolean;
begin
  refused := false;
  begin
    update public.restaurants set tax_basis = 'prices_include_tax'
     where id = 'f6200000-0000-4000-8000-000000000001';
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T2 FAIL: a basis was stated with nobody confirming it'; end if;

  refused := false;
  begin
    update public.restaurants
       set tax_basis = 'kdv_dahil', tax_basis_confirmed_by = 'f6200000-0000-4000-8000-0000000000a1',
           tax_basis_confirmed_at = now()
     where id = 'f6200000-0000-4000-8000-000000000001';
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T2 FAIL: a fifth basis was accepted'; end if;

  update public.restaurants
     set tax_basis = 'prices_include_tax', tax_basis_confirmed_by = 'f6200000-0000-4000-8000-0000000000a1',
         tax_basis_confirmed_at = '2027-01-10 09:00+03'
   where id = 'f6200000-0000-4000-8000-000000000001';

  refused := false;
  begin
    update public.restaurants set tax_basis = 'not_vat_charging'
     where id = 'f6200000-0000-4000-8000-000000000001';
  exception when check_violation then refused := sqlerrm like '%new confirmation%';
  end;
  if not refused then raise exception 'T2 FAIL: the basis changed under the old confirmation moment'; end if;

  update public.restaurants
     set tax_basis = 'not_vat_charging', tax_basis_confirmed_at = '2027-01-11 09:00+03'
   where id = 'f6200000-0000-4000-8000-000000000001';
  update public.restaurants
     set tax_basis = 'prices_include_tax', tax_basis_confirmed_at = '2027-01-12 09:00+03'
   where id = 'f6200000-0000-4000-8000-000000000001';
end $$;

-- T3: rates are versioned per house, effective-dated, append-only.
insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by) values
  ('f6200000-0000-4000-8000-000000000001', 'pos_category', 'Food', 0.10, '2023-07-10', 'f6200000-0000-4000-8000-0000000000a1');
insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by) values
  ('f6200000-0000-4000-8000-000000000001', 'house_item', 'f6200000-0000-4000-8000-0000000000c1', 0.20, '2023-07-10', 'f6200000-0000-4000-8000-0000000000a1');
insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, effective_to, created_by) values
  ('f6200000-0000-4000-8000-000000000001', 'house', '', 0.08, '2020-01-01', '2023-07-10', 'f6200000-0000-4000-8000-0000000000a1');
insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by) values
  ('f6200000-0000-4000-8000-000000000001', 'pos_category', 'Food', null, '2027-02-01', 'f6200000-0000-4000-8000-0000000000a1');
insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by) values
  ('f6200000-0000-4000-8000-000000000002', 'house', '', 0.00, '2027-01-01', 'f6200000-0000-4000-8000-0000000000a1');

do $$
declare
  refused boolean;
  vs int[];
  v2 int;
begin
  select array_agg(version order by version) into vs from public.house_tax_rates
   where restaurant_id = 'f6200000-0000-4000-8000-000000000001';
  if vs is distinct from array[1, 2, 3, 4] then
    raise exception 'T3 FAIL: versions read %, not 1..4', vs;
  end if;
  select version into v2 from public.house_tax_rates where restaurant_id = 'f6200000-0000-4000-8000-000000000002';
  if v2 is distinct from 1 then
    raise exception 'T3 FAIL: a second house''s first rate is version %, not 1', v2;
  end if;

  refused := false;
  begin
    insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, version, created_by)
    values ('f6200000-0000-4000-8000-000000000001', 'house', '', 0.20, '2027-01-01', 2, 'f6200000-0000-4000-8000-0000000000a1');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a rate claimed a version that was not the house''s next'; end if;

  refused := false;
  begin
    update public.house_tax_rates set rate = 0.18 where restaurant_id = 'f6200000-0000-4000-8000-000000000001';
  exception when others then refused := sqlerrm like '%append-only%';
  end;
  if not refused then raise exception 'T3 FAIL: a rate could be edited'; end if;

  refused := false;
  begin
    delete from public.house_tax_rates where restaurant_id = 'f6200000-0000-4000-8000-000000000001';
  exception when others then refused := sqlerrm like '%append-only%';
  end;
  if not refused then raise exception 'T3 FAIL: a rate could be deleted'; end if;

  refused := false;
  begin
    insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by)
    values ('f6200000-0000-4000-8000-000000000001', 'house', '', 1.00, '2027-01-01', 'f6200000-0000-4000-8000-0000000000a1');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a 100%% rate was accepted'; end if;

  refused := false;
  begin
    insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, effective_to, created_by)
    values ('f6200000-0000-4000-8000-000000000001', 'house', '', 0.20, '2027-01-01', '2027-01-01', 'f6200000-0000-4000-8000-0000000000a1');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: an empty span was accepted'; end if;

  refused := false;
  begin
    insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by)
    values ('f6200000-0000-4000-8000-000000000001', 'house_item', 'Okuzgozu', 0.20, '2027-01-01', 'f6200000-0000-4000-8000-0000000000a1');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a house_item key that is not an item id was accepted'; end if;

  refused := false;
  begin
    insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by)
    values ('f6200000-0000-4000-8000-000000000001', 'house', 'Food', 0.20, '2027-01-01', 'f6200000-0000-4000-8000-0000000000a1');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a house-wide rate carried a key'; end if;

  refused := false;
  begin
    insert into public.house_tax_rates (restaurant_id, key_kind, key, rate, effective_from, created_by)
    values ('f6200000-0000-4000-8000-000000000001', 'pos_category', ' Food', 0.20, '2027-01-01', 'f6200000-0000-4000-8000-0000000000a1');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a category key with stray space was accepted'; end if;
end $$;

-- T4: the rates table is locked down: RLS on, no client grant.
do $$
declare
  rls boolean;
  grants int;
begin
  select relrowsecurity into rls from pg_class where oid = 'public.house_tax_rates'::regclass;
  if not rls then raise exception 'T4 FAIL: house_tax_rates has row level security off'; end if;
  select count(*) into grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'house_tax_rates'
     and grantee in ('anon', 'authenticated');
  if grants > 0 then raise exception 'T4 FAIL: house_tax_rates holds % client grant(s)', grants; end if;
end $$;

-- T5: a check written as today carries no basis; a stamped one is checked.
insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, total)
values ('f6200000-0000-4000-8000-000000000002', 'generic', 'zqtx-us-1', now(), 100.00, 108.88);

do $$
declare
  r record;
  refused boolean;
begin
  select subtotal, total, gross_subtotal, tax_basis, tax_rate_version into r
    from public.pos_checks
   where restaurant_id = 'f6200000-0000-4000-8000-000000000002' and external_check_id = 'zqtx-us-1';
  if r.subtotal <> 100.00 or r.total <> 108.88 then
    raise exception 'T5 FAIL: a check written as today read back % / %', r.subtotal, r.total;
  end if;
  if r.gross_subtotal is not null or r.tax_basis is not null or r.tax_rate_version is not null then
    raise exception 'T5 FAIL: a check written as today was given a tax stamp';
  end if;

  refused := false;
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, tax_basis, tax_rate_version)
    values ('f6200000-0000-4000-8000-000000000002', 'generic', 'zqtx-us-2', now(), 100.00, 'prices_exclude_tax', 1);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T5 FAIL: a tax-exclusive check named a rate version'; end if;

  refused := false;
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, tax_basis)
    values ('f6200000-0000-4000-8000-000000000002', 'generic', 'zqtx-us-3', now(), 100.00, 'gross');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T5 FAIL: a check took an unknown basis'; end if;

  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, gross_subtotal, tax_basis, tax_rate_version)
  values ('f6200000-0000-4000-8000-000000000001', 'generic', 'zqtx-tr-1', now(), 500.00, 600.00, 'prices_include_tax', 4);
end $$;

-- T6: a cost says whether tax is inside it, and loses that when it changes unstated.
insert into public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
   final_price, total_cost, status, requested_at, currency, currency_source) values
  ('f6200000-0000-4000-8000-000000000101', 'ZQTX-1', 'f6200000-0000-4000-8000-000000000001',
   'f6200000-0000-4000-8000-0000000000c1', 'f6200000-0000-4000-8000-0000000000b1',
   12, 12, 200.00, 2400.00, 'PENDING', now(), 'TRY', 'typed');
insert into public.procurement_order_items
  (id, order_id, restaurant_id, inventory_id, wine_name, quantity, final_unit_price, line_total, price_tax_basis) values
  ('f6200000-0000-4000-8000-000000000201', 'f6200000-0000-4000-8000-000000000101',
   'f6200000-0000-4000-8000-000000000001', 'f6200000-0000-4000-8000-0000000000c1',
   'Zqtx Okuzgozu', 12, 200.00, 2400.00, 'excludes_tax');

insert into public.inventory_lots (id, restaurant_id, inventory_id, stock_state, qty, unit_cost, cost_provenance, source_order_id) values
  ('f6200000-0000-4000-8000-000000000301', 'f6200000-0000-4000-8000-000000000001', 'f6200000-0000-4000-8000-0000000000c1',
   'live', 12, 200.00, 'estimated', 'f6200000-0000-4000-8000-000000000101'),
  -- no order: stays unstated, exactly as a lot is booked today.
  ('f6200000-0000-4000-8000-000000000302', 'f6200000-0000-4000-8000-000000000001', 'f6200000-0000-4000-8000-0000000000c2',
   'live', 6, 300.00, 'manual', null),
  ('f6200000-0000-4000-8000-000000000303', 'f6200000-0000-4000-8000-000000000001', 'f6200000-0000-4000-8000-0000000000c2',
   'live', 4, 330.00, 'manual', null);

do $$
declare
  b text;
  refused boolean;
begin
  select unit_cost_tax_basis into b from public.inventory_lots where id = 'f6200000-0000-4000-8000-000000000301';
  if b is distinct from 'excludes_tax' then
    raise exception 'T6 FAIL: a lot booked from a line stated excludes_tax reads %', coalesce(b, 'NULL');
  end if;
  select unit_cost_tax_basis into b from public.inventory_lots where id = 'f6200000-0000-4000-8000-000000000302';
  if b is not null then raise exception 'T6 FAIL: a lot with no order was given basis %', b; end if;

  -- an invoice overwrites the order price, saying nothing of tax: unknown.
  update public.inventory_lots set unit_cost = 236.00, cost_provenance = 'invoice'
   where id = 'f6200000-0000-4000-8000-000000000301';
  select unit_cost_tax_basis into b from public.inventory_lots where id = 'f6200000-0000-4000-8000-000000000301';
  if b is not null then raise exception 'T6 FAIL: a changed cost kept the old basis %', b; end if;

  -- a write that states the basis with the figure keeps it.
  update public.inventory_lots set unit_cost = 236.00, unit_cost_tax_basis = 'includes_tax'
   where id = 'f6200000-0000-4000-8000-000000000301';
  update public.inventory_lots set unit_cost = 200.00, unit_cost_tax_basis = 'excludes_tax'
   where id = 'f6200000-0000-4000-8000-000000000301';
  select unit_cost_tax_basis into b from public.inventory_lots where id = 'f6200000-0000-4000-8000-000000000301';
  if b is distinct from 'excludes_tax' then raise exception 'T6 FAIL: a restated basis read %', coalesce(b, 'NULL'); end if;

  -- a write that touches neither leaves it.
  update public.inventory_lots set qty = 11 where id = 'f6200000-0000-4000-8000-000000000301';
  select unit_cost_tax_basis into b from public.inventory_lots where id = 'f6200000-0000-4000-8000-000000000301';
  if b is distinct from 'excludes_tax' then raise exception 'T6 FAIL: a qty write cleared the basis'; end if;

  update public.procurement_order_items set negotiated_unit_price = 190.00
   where id = 'f6200000-0000-4000-8000-000000000201';
  select price_tax_basis into b from public.procurement_order_items where id = 'f6200000-0000-4000-8000-000000000201';
  if b is not null then raise exception 'T6 FAIL: a changed line price kept the old basis %', b; end if;

  update public.restaurant_inventory set last_purchase_price = 200.00, last_purchase_price_tax_basis = 'includes_tax'
   where id = 'f6200000-0000-4000-8000-0000000000c1';
  update public.restaurant_inventory set last_purchase_price = 210.00
   where id = 'f6200000-0000-4000-8000-0000000000c1';
  select last_purchase_price_tax_basis into b from public.restaurant_inventory where id = 'f6200000-0000-4000-8000-0000000000c1';
  if b is not null then raise exception 'T6 FAIL: a changed last price kept the old basis %', b; end if;

  refused := false;
  begin
    update public.inventory_lots set unit_cost_tax_basis = 'kdv_dahil' where id = 'f6200000-0000-4000-8000-000000000302';
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T6 FAIL: a lot took an unknown cost basis'; end if;
end $$;

-- T7: the rollup counts what of its WAC is proven pre-tax, and keeps its WAC.
do $$
declare r record;
begin
  select wac, wac_qty, wac_pre_tax_qty, wac_tax_included_qty into r
    from public.inventory_lot_rollup where inventory_id = 'f6200000-0000-4000-8000-0000000000c1';
  if r.wac <> 200.00 or r.wac_qty <> 11 or r.wac_pre_tax_qty <> 11 or r.wac_tax_included_qty <> 0 then
    raise exception 'T7 FAIL: proven item reads wac % qty % pre-tax % incl %', r.wac, r.wac_qty, r.wac_pre_tax_qty, r.wac_tax_included_qty;
  end if;
  select wac, wac_qty, wac_pre_tax_qty, wac_tax_included_qty into r
    from public.inventory_lot_rollup where inventory_id = 'f6200000-0000-4000-8000-0000000000c2';
  if r.wac <> 312.00 or r.wac_qty <> 10 or r.wac_pre_tax_qty <> 0 or r.wac_tax_included_qty <> 0 then
    raise exception 'T7 FAIL: unstated item reads wac % qty % pre-tax % incl %', r.wac, r.wac_qty, r.wac_pre_tax_qty, r.wac_tax_included_qty;
  end if;
  if not exists (
    select 1 from pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) o
     where c.oid = 'public.inventory_lot_rollup'::regclass and o in ('security_invoker=true', 'security_invoker=on')
  ) then
    raise exception 'T7 FAIL: inventory_lot_rollup no longer reads as its caller';
  end if;
end $$;

rollback;
