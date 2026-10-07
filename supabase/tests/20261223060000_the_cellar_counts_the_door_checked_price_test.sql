-- AW14 (2026-10-03 analytics walk, A-045): /cellar's First bought and Paid
-- read only filed invoice lines, so a house that checks the bill at the door
-- and files no paper read them blank. Migration
-- the_cellar_counts_the_door_checked_price (ADR 0301 §2; the founder's pick
-- "Door-checked, labelled (Recommended)") counts the door-checked price,
-- marked door-checked, until a filed invoice takes over.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. Synthetic fixtures only,
-- one transaction, rolled back: it leaves nothing behind. Every product name
-- starts with "Zqdc", so rows already in a populated database cannot match.
--
-- On a build WITHOUT the migration, T1-T11 and T13 FAIL: the ledger rows are
-- read as jsonb, so a block fails on its assertion (no door column, no door
-- row) rather than on a missing column, and the blocks that call
-- house_door_checked fail on the missing function. T12 fails too: it pins the
-- three appended columns behind the 31 that stay where they were.

begin;

insert into public.restaurants (id, name, slug) values
  ('a3014000-0000-4000-8000-000000000001', 'AW14 door house', 'aw14-door-house'),
  ('a3014000-0000-4000-8000-000000000002', 'AW14 other house', 'aw14-other-house');

insert into public.providers (id, name, primary_contact, restaurant_id) values
  ('a3014000-0000-4000-8000-0000000000b1', 'Zqdc Door Vendor', '{}'::jsonb, 'a3014000-0000-4000-8000-000000000001'),
  ('a3014000-0000-4000-8000-0000000000b2', 'Zqdc Paper Vendor', '{}'::jsonb, 'a3014000-0000-4000-8000-000000000001'),
  ('a3014000-0000-4000-8000-0000000000b3', 'Zqdc Other Vendor', '{}'::jsonb, 'a3014000-0000-4000-8000-000000000002');

insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqdc Shelf', 'house_declared'),
  ('a3014000-0000-4000-8000-0000000000c2', 'a3014000-0000-4000-8000-000000000002', 'wine', 'bottle', 'Zqdc Other Shelf', 'house_declared');

-- Orders. o1-o10 and o12 are this house's; o11 is the other house's. Every
-- one but o4 was checked at the door (match_verified_at set).
insert into public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
   final_price, total_cost, status, requested_at, match_verified_at) values
  ('a3014000-0000-4000-8000-000000000101', 'ZQDC-1', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 12, 12, 25, 300, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-03 10:00+00'),
  ('a3014000-0000-4000-8000-000000000102', 'ZQDC-2', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 24, 144, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-04 10:00+00'),
  ('a3014000-0000-4000-8000-000000000103', 'ZQDC-3', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 20, 120, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-04 11:00+00'),
  ('a3014000-0000-4000-8000-000000000104', 'ZQDC-4', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 20, 120, 'COMPLETED', '2026-07-30 09:00+00', null),
  ('a3014000-0000-4000-8000-000000000105', 'ZQDC-5', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 1, 12, 300, 300, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-05 10:00+00'),
  ('a3014000-0000-4000-8000-000000000106', 'ZQDC-6', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 30, 180, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-05 11:00+00'),
  ('a3014000-0000-4000-8000-000000000107', 'ZQDC-7', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 12, 12, 15, 180, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-06 10:00+00'),
  ('a3014000-0000-4000-8000-000000000108', 'ZQDC-8', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 18, 108, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-06 11:00+00'),
  ('a3014000-0000-4000-8000-000000000109', 'ZQDC-9', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 42, 252, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-10 10:00+00'),
  ('a3014000-0000-4000-8000-000000000110', 'ZQDC-10', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000c1', 'a3014000-0000-4000-8000-0000000000b1', 6, 6, 50, 300, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-12 18:00+00'),
  ('a3014000-0000-4000-8000-000000000111', 'ZQDC-11', 'a3014000-0000-4000-8000-000000000002', 'a3014000-0000-4000-8000-0000000000c2', 'a3014000-0000-4000-8000-0000000000b3', 6, 6, 99, 594, 'COMPLETED', '2026-07-30 09:00+00', '2026-08-02 10:00+00');

-- One line per order, except o7, which has two.
insert into public.procurement_order_items (id, order_id, restaurant_id, wine_name, producer, quantity, final_unit_price) values
  ('a3014000-0000-4000-8000-000000000201', 'a3014000-0000-4000-8000-000000000101', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Fords Gin', null, 12, 25),
  ('a3014000-0000-4000-8000-000000000202', 'a3014000-0000-4000-8000-000000000102', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Titos', null, 6, 24),
  ('a3014000-0000-4000-8000-000000000203', 'a3014000-0000-4000-8000-000000000103', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Aperol', null, 6, 20),
  ('a3014000-0000-4000-8000-000000000204', 'a3014000-0000-4000-8000-000000000104', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Campari', null, 6, 20),
  ('a3014000-0000-4000-8000-000000000205', 'a3014000-0000-4000-8000-000000000105', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Cointreau', null, 1, 300),
  ('a3014000-0000-4000-8000-000000000206', 'a3014000-0000-4000-8000-000000000106', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Hendricks', null, 6, 30),
  ('a3014000-0000-4000-8000-000000000207', 'a3014000-0000-4000-8000-000000000107', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Two Lines A', null, 6, 15),
  ('a3014000-0000-4000-8000-000000000217', 'a3014000-0000-4000-8000-000000000107', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Two Lines B', null, 6, 15),
  ('a3014000-0000-4000-8000-000000000208', 'a3014000-0000-4000-8000-000000000108', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Refused', null, 6, 18),
  ('a3014000-0000-4000-8000-000000000209', 'a3014000-0000-4000-8000-000000000109', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Monkey 47', null, 6, 42),
  ('a3014000-0000-4000-8000-000000000210', 'a3014000-0000-4000-8000-000000000110', 'a3014000-0000-4000-8000-000000000001', 'Zqdc Tie', null, 6, 50),
  ('a3014000-0000-4000-8000-000000000211', 'a3014000-0000-4000-8000-000000000111', 'a3014000-0000-4000-8000-000000000002', 'Zqdc Fords Gin', null, 6, 99);

-- The checked prices verifyReceipt writes (source receipt_verified, unit
-- bottle), plus rows the read must ignore.
insert into public.price_history (restaurant_id, order_id, provider_id, price, quantity, unit, effective_date, source, currency, created_at) values
  -- o1: an older verification at 30.00, the latest at 26.50 in TRY, then a
  -- case row and a manual row, both later, both ignored.
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'a3014000-0000-4000-8000-0000000000b1', 30.00, 12, 'bottle', '2026-08-02', 'receipt_verified', 'TRY', '2026-08-02 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'a3014000-0000-4000-8000-0000000000b1', 26.50, 12, 'bottle', '2026-08-03', 'receipt_verified', 'TRY', '2026-08-03 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'a3014000-0000-4000-8000-0000000000b1', 300.00, 1, 'case', '2026-08-03', 'receipt_verified', 'TRY', '2026-08-03 11:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'a3014000-0000-4000-8000-0000000000b1', 99.00, 1, 'bottle', '2026-08-03', 'manual', null, '2026-08-03 12:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000102', 'a3014000-0000-4000-8000-0000000000b1', 24.00, 6, 'bottle', '2026-08-04', 'receipt_verified', null, '2026-08-04 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000103', 'a3014000-0000-4000-8000-0000000000b1', 20.00, 6, 'bottle', '2026-08-04', 'receipt_verified', null, '2026-08-04 11:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000104', 'a3014000-0000-4000-8000-0000000000b1', 20.00, 6, 'bottle', '2026-08-04', 'receipt_verified', null, '2026-08-04 12:00+00'),
  -- o5: a case price only. No bottle price, so no door row.
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000105', 'a3014000-0000-4000-8000-0000000000b1', 300.00, 1, 'case', '2026-08-05', 'receipt_verified', null, '2026-08-05 10:00+00'),
  -- o6: none at all (the 'unmatched' verdict writes no price).
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000107', 'a3014000-0000-4000-8000-0000000000b1', 15.00, 12, 'bottle', '2026-08-06', 'receipt_verified', null, '2026-08-06 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000108', 'a3014000-0000-4000-8000-0000000000b1', 18.00, 6, 'bottle', '2026-08-06', 'receipt_verified', null, '2026-08-06 11:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000109', 'a3014000-0000-4000-8000-0000000000b1', 42.00, 6, 'bottle', '2026-08-10', 'receipt_verified', null, '2026-08-10 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000110', 'a3014000-0000-4000-8000-0000000000b1', 50.00, 6, 'bottle', '2026-08-12', 'receipt_verified', null, '2026-08-12 18:00+00'),
  ('a3014000-0000-4000-8000-000000000002', 'a3014000-0000-4000-8000-000000000111', 'a3014000-0000-4000-8000-0000000000b3', 99.00, 6, 'bottle', '2026-08-02', 'receipt_verified', null, '2026-08-02 10:00+00'),
  -- T13: a row stamped with the OTHER house against this house's o1, later
  -- than o1's own. A mis-scoped write; the read must not take it.
  ('a3014000-0000-4000-8000-000000000002', 'a3014000-0000-4000-8000-000000000101', 'a3014000-0000-4000-8000-0000000000b3', 77.00, 3, 'bottle', '2026-08-03', 'receipt_verified', null, '2026-08-03 13:00+00');

-- The reconciled events verifyReceipt writes: counted = the accepted bottles,
-- invoice_qty_bottles = what the bill charged for (NULL on a counts-only
-- confirmation).
insert into public.procurement_receipt_events
  (restaurant_id, order_id, stage, counted_qty, counted_uom, counted_qty_bottles, rejected_qty_bottles, invoice_qty_bottles, occurred_at) values
  -- o1: an older verification, then the latest (12 billed, 10 accepted: a
  -- short delivery), then a later counts-only confirmation of 11.
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'reconciled', 12, 'bottle', 12, 0, 12, '2026-08-02 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'reconciled', 10, 'bottle', 10, 2, 12, '2026-08-03 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000101', 'reconciled', 11, 'bottle', 11, 0, null, '2026-08-04 09:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000102', 'reconciled', 6, 'bottle', 6, 0, 6, '2026-08-04 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000103', 'reconciled', 6, 'bottle', 6, 0, 6, '2026-08-04 11:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000104', 'reconciled', 6, 'bottle', 6, 0, 6, '2026-08-04 12:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000105', 'reconciled', 12, 'bottle', 12, 0, 12, '2026-08-05 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000106', 'reconciled', 6, 'bottle', 6, 0, null, '2026-08-05 11:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000107', 'reconciled', 12, 'bottle', 12, 0, 12, '2026-08-06 10:00+00'),
  -- o8: everything refused at the door. Nothing was bought.
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000108', 'reconciled', 0, 'bottle', 0, 6, 6, '2026-08-06 11:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000109', 'reconciled', 6, 'bottle', 6, 0, 6, '2026-08-10 10:00+00'),
  ('a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-000000000110', 'reconciled', 6, 'bottle', 6, 0, 6, '2026-08-12 18:00+00'),
  ('a3014000-0000-4000-8000-000000000002', 'a3014000-0000-4000-8000-000000000111', 'reconciled', 6, 'bottle', 6, 0, 6, '2026-08-02 10:00+00'),
  -- T13: the same mis-scoped write on the event side.
  ('a3014000-0000-4000-8000-000000000002', 'a3014000-0000-4000-8000-000000000101', 'reconciled', 3, 'bottle', 3, 0, 3, '2026-08-03 13:00+00');

-- Filed invoices. d3 carries a line paired with o3's line (order_line_id) and
-- is linked to no order. d9 and d10 are invoices for the same products as o9
-- and o10, filed separately (no link, no pairing).
insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, source_channel, status, direction, doc_date) values
  ('a3014000-0000-4000-8000-0000000000d3', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000b2', 'invoice', 'manual', 'verified', 'issued_by_vendor', '2026-08-04'),
  ('a3014000-0000-4000-8000-0000000000d9', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000b2', 'invoice', 'manual', 'verified', 'issued_by_vendor', '2026-08-01'),
  ('a3014000-0000-4000-8000-0000000000da', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000b2', 'invoice', 'manual', 'verified', 'issued_by_vendor', '2026-08-12');

insert into public.procurement_document_lines
  (document_id, restaurant_id, line_no, description, qty, uom, pack_size, qty_bottles, free_goods_qty, unit_price, line_total, order_line_id) values
  ('a3014000-0000-4000-8000-0000000000d3', 'a3014000-0000-4000-8000-000000000001', 1, 'Zqdc Aperol One Litre', 6, 'bottle', 1, 6, 0, 20, 120, 'a3014000-0000-4000-8000-000000000203'),
  ('a3014000-0000-4000-8000-0000000000d9', 'a3014000-0000-4000-8000-000000000001', 1, 'Zqdc Monkey 47', 6, 'bottle', 1, 6, 0, 40, 240, null),
  ('a3014000-0000-4000-8000-0000000000da', 'a3014000-0000-4000-8000-000000000001', 1, 'Zqdc Tie', 6, 'bottle', 1, 6, 0, 50, 300, null);

create function pg_temp.aw14_row(p_label text)
returns jsonb
language sql as $$
  select to_jsonb(l)
    from public.house_beverage_ledger('a3014000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = p_label
$$;

-- T1 a door-checked order with no invoice fills First bought, Last bought,
-- Paid and Bottles, each marked door-checked. It is still not invoiced:
-- invoice_lines stays 0 and the invoice book does not name it.
do $$
declare r jsonb := pg_temp.aw14_row('Zqdc Fords Gin');
begin
  assert r is not null, 'T1 FAIL Fords Gin has no ledger row';
  assert (r->>'first_bought') = '2026-08-03', format('T1 FAIL first_bought = %s, expected 2026-08-03 (the door check)', r->>'first_bought');
  assert (r->>'last_bought') = '2026-08-03', format('T1 FAIL last_bought = %s, expected 2026-08-03', r->>'last_bought');
  assert (r->>'door_checked_lines')::int = 1, format('T1 FAIL door_checked_lines = %s, expected 1', r->>'door_checked_lines');
  assert (r->>'first_bought_door_checked')::boolean, 'T1 FAIL first_bought is not marked door-checked';
  assert (r->>'last_bought_door_checked')::boolean, 'T1 FAIL last_bought is not marked door-checked';
  assert (r->>'invoice_lines')::int = 0, format('T1 FAIL invoice_lines = %s, expected 0: a door check is not an invoice', r->>'invoice_lines');
  assert not (r->'books') ? 'invoice', format('T1 FAIL the invoice book names it: %s', r->'books');
  assert (r->'books') ? 'order', format('T1 FAIL the order book lost it: %s', r->'books');
  assert (r->>'last_unit_price')::numeric = 26.50, format('T1 FAIL last_unit_price = %s, expected 26.50', r->>'last_unit_price');
  assert (r->>'last_bought_from') = 'Zqdc Door Vendor', format('T1 FAIL last_bought_from = %s', r->>'last_bought_from');
end $$;

-- T2 Paid is the checked price times the ACCEPTED bottles. 12 were billed and
-- 10 accepted: 26.50 x 10 = 265, never 26.50 x 12 = 318.
do $$
declare r jsonb := pg_temp.aw14_row('Zqdc Fords Gin');
begin
  assert (r->>'paid_total')::numeric = 265, format('T2 FAIL paid_total = %s, expected 265 (26.50 x 10 accepted)', r->>'paid_total');
  assert (r->>'bottles_bought')::numeric = 10, format('T2 FAIL bottles_bought = %s, expected 10 accepted', r->>'bottles_bought');
end $$;

-- T3 house_door_checked takes the LATEST receipt_verified price in bottles
-- (26.50, not the older 30.00; never the later case or manual row) and the
-- accepted count of the latest verification that carried the bill's quantity
-- (10, not the later counts-only 11 or the billed 12). It carries the price's
-- own currency.
do $$
declare d record; n integer;
begin
  select count(*) into n from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id = 'a3014000-0000-4000-8000-000000000101';
  assert n = 1, format('T3 FAIL o1 has %s door rows, expected 1', n);
  select * into d from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id = 'a3014000-0000-4000-8000-000000000101';
  assert d.unit_price = 26.50, format('T3 FAIL unit_price = %s, expected 26.50', d.unit_price);
  assert d.bottles = 10, format('T3 FAIL bottles = %s, expected 10', d.bottles);
  assert d.paid = 265, format('T3 FAIL paid = %s, expected 265', d.paid);
  assert d.currency = 'TRY', format('T3 FAIL currency = %s, expected TRY', d.currency);
  assert d.door_checked_on = '2026-08-03'::date, format('T3 FAIL door_checked_on = %s', d.door_checked_on);
  assert d.order_line_id = 'a3014000-0000-4000-8000-000000000201', 'T3 FAIL wrong order line';
  assert d.house_key = public.beverage_house_key(null, 'Zqdc Fords Gin'), format('T3 FAIL house_key = %s', d.house_key);
end $$;

-- T4 filing an invoice for the order takes over: before, Titos is a door row;
-- once an invoice is linked to o2, the door row is gone, the marks are false
-- and the invoice line is the purchase.
do $$
declare r jsonb; n integer;
begin
  r := pg_temp.aw14_row('Zqdc Titos');
  assert (r->>'door_checked_lines')::int = 1, format('T4 FAIL before the invoice, door_checked_lines = %s, expected 1', r->>'door_checked_lines');
  assert (r->>'first_bought_door_checked')::boolean, 'T4 FAIL before the invoice, first_bought is not marked';

  insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, source_channel, status, direction, doc_date)
  values ('a3014000-0000-4000-8000-0000000000d2', 'a3014000-0000-4000-8000-000000000001', 'a3014000-0000-4000-8000-0000000000b2', 'invoice', 'manual', 'verified', 'issued_by_vendor', '2026-08-06');
  insert into public.procurement_document_lines
    (document_id, restaurant_id, line_no, description, qty, uom, pack_size, qty_bottles, free_goods_qty, unit_price, line_total)
  values ('a3014000-0000-4000-8000-0000000000d2', 'a3014000-0000-4000-8000-000000000001', 1, 'Zqdc Titos', 6, 'bottle', 1, 6, 0, 24, 144);
  insert into public.procurement_document_links (document_id, order_id, restaurant_id, link_method)
  values ('a3014000-0000-4000-8000-0000000000d2', 'a3014000-0000-4000-8000-000000000102', 'a3014000-0000-4000-8000-000000000001', 'manual');

  select count(*) into n from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id = 'a3014000-0000-4000-8000-000000000102';
  assert n = 0, 'T4 FAIL o2 is still a door row after its invoice was filed';
  r := pg_temp.aw14_row('Zqdc Titos');
  assert (r->>'door_checked_lines')::int = 0, format('T4 FAIL door_checked_lines = %s after the invoice, expected 0', r->>'door_checked_lines');
  assert (r->>'first_bought_door_checked') = 'false', format('T4 FAIL first_bought_door_checked = %s after the invoice, expected false', r->>'first_bought_door_checked');
  assert (r->>'last_bought_door_checked') = 'false', format('T4 FAIL last_bought_door_checked = %s after the invoice, expected false', r->>'last_bought_door_checked');
  assert (r->>'invoice_lines')::int = 1, format('T4 FAIL invoice_lines = %s, expected 1', r->>'invoice_lines');
  assert (r->>'paid_total')::numeric = 144, format('T4 FAIL paid_total = %s, expected 144 (counted once, from the invoice)', r->>'paid_total');
  assert (r->>'first_bought') = '2026-08-06', format('T4 FAIL first_bought = %s, expected the invoice date', r->>'first_bought');
  assert (r->'books') ? 'invoice', 'T4 FAIL the invoice book does not name it';
end $$;

-- T5 an invoice line paired with the order's line takes over too, even when
-- the invoice is linked to no order. Aperol's purchase is the invoice line's.
do $$
declare n integer; r jsonb;
begin
  select count(*) into n from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id = 'a3014000-0000-4000-8000-000000000103';
  assert n = 0, 'T5 FAIL o3 is a door row though an invoice line is paired with its line';
  r := pg_temp.aw14_row('Zqdc Aperol');
  assert r is not null, 'T5 FAIL Aperol has no ledger row';
  assert (r->>'door_checked_lines')::int = 0, format('T5 FAIL door_checked_lines = %s, expected 0', r->>'door_checked_lines');
  assert (r->>'first_bought') is null, format('T5 FAIL first_bought = %s, expected none on the order''s key', r->>'first_bought');
end $$;

-- T6 an order that was never checked at the door (no match_verified_at)
-- contributes nothing, whatever else is written about it.
do $$
declare n integer; r jsonb;
begin
  select count(*) into n from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id = 'a3014000-0000-4000-8000-000000000104';
  assert n = 0, 'T6 FAIL o4 is a door row without a door check';
  r := pg_temp.aw14_row('Zqdc Campari');
  assert r is not null, 'T6 FAIL Campari has no ledger row (the order book names it)';
  assert (r->>'door_checked_lines')::int = 0, format('T6 FAIL door_checked_lines = %s, expected 0', r->>'door_checked_lines');
  assert (r->>'first_bought') is null and (r->>'paid_total') is null,
    format('T6 FAIL bought filled without a door check: %s / %s', r->>'first_bought', r->>'paid_total');
end $$;

-- T7 a door check with no checked price in bottles contributes nothing: o5
-- has only a case-unit row, o6 has none (a check that saw no bill).
do $$
declare n integer;
begin
  select count(*) into n from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id in ('a3014000-0000-4000-8000-000000000105', 'a3014000-0000-4000-8000-000000000106');
  assert n = 0, format('T7 FAIL %s door rows without a bottle price, expected 0', n);
  assert (pg_temp.aw14_row('Zqdc Cointreau')->>'door_checked_lines')::int = 0, 'T7 FAIL Cointreau counted a case price';
  assert (pg_temp.aw14_row('Zqdc Hendricks')->>'door_checked_lines')::int = 0, 'T7 FAIL Hendricks counted with no price';
end $$;

-- T8 an order with two lines (the price belongs to no line in particular) and
-- an order that accepted no bottle (nothing was bought) contribute nothing.
do $$
declare n integer;
begin
  select count(*) into n from public.house_door_checked('a3014000-0000-4000-8000-000000000001'::uuid)
   where order_id in ('a3014000-0000-4000-8000-000000000107', 'a3014000-0000-4000-8000-000000000108');
  assert n = 0, format('T8 FAIL %s door rows for a two-line or all-refused order, expected 0', n);
  assert (pg_temp.aw14_row('Zqdc Refused')->>'first_bought') is null, 'T8 FAIL an all-refused delivery reads as bought';
end $$;

-- T9 invoice and door together: the first date is the invoice's (unmarked),
-- the last is the door's (marked), and Paid adds both: 240 + 42 x 6 = 492.
do $$
declare r jsonb := pg_temp.aw14_row('Zqdc Monkey 47');
begin
  assert (r->>'first_bought') = '2026-08-01', format('T9 FAIL first_bought = %s, expected the invoice''s 2026-08-01', r->>'first_bought');
  assert (r->>'first_bought_door_checked') = 'false', format('T9 FAIL first_bought_door_checked = %s, expected false (the invoice gave the first date)', r->>'first_bought_door_checked');
  assert (r->>'last_bought') = '2026-08-10', format('T9 FAIL last_bought = %s, expected the door check''s 2026-08-10', r->>'last_bought');
  assert (r->>'last_bought_door_checked')::boolean, 'T9 FAIL the door check''s last date is not marked';
  assert (r->>'paid_total')::numeric = 492, format('T9 FAIL paid_total = %s, expected 492', r->>'paid_total');
  assert (r->>'bottles_bought')::numeric = 12, format('T9 FAIL bottles_bought = %s, expected 12', r->>'bottles_bought');
  assert (r->>'invoice_lines')::int = 1 and (r->>'door_checked_lines')::int = 1,
    format('T9 FAIL invoice_lines %s / door_checked_lines %s, expected 1 / 1', r->>'invoice_lines', r->>'door_checked_lines');
  assert (r->>'last_unit_price')::numeric = 42, format('T9 FAIL last_unit_price = %s, expected the door''s 42', r->>'last_unit_price');
  assert (r->>'last_bought_from') = 'Zqdc Door Vendor', format('T9 FAIL last_bought_from = %s', r->>'last_bought_from');
  assert (r->'books') ? 'invoice', 'T9 FAIL the invoice book lost it';
end $$;

-- T10 on the same day, the invoice line wins the mark: paper outranks the door.
do $$
declare r jsonb := pg_temp.aw14_row('Zqdc Tie');
begin
  assert (r->>'door_checked_lines')::int = 1, format('T10 FAIL door_checked_lines = %s, expected 1', r->>'door_checked_lines');
  assert (r->>'first_bought') = '2026-08-12' and (r->>'last_bought') = '2026-08-12', 'T10 FAIL the dates moved';
  assert (r->>'first_bought_door_checked') = 'false' and (r->>'last_bought_door_checked') = 'false',
    format('T10 FAIL the marks are %s / %s, expected false / false: an invoice line gives the same date', r->>'first_bought_door_checked', r->>'last_bought_door_checked');
  assert (r->>'last_unit_price')::numeric = 50 and (r->>'last_bought_from') = 'Zqdc Paper Vendor',
    format('T10 FAIL the last price is not the invoice''s: %s from %s', r->>'last_unit_price', r->>'last_bought_from');
end $$;

-- T11 the browser roles cannot execute house_door_checked or the ledger made
-- again; service_role can.
do $$
declare f text;
begin
  foreach f in array array['public.house_door_checked(uuid)',
                           'public.house_beverage_ledger(uuid, integer)'] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('T11 FAIL anon can execute %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('T11 FAIL authenticated can execute %s', f);
    assert has_function_privilege('service_role', f, 'EXECUTE'), format('T11 FAIL service_role cannot execute %s', f);
  end loop;
end $$;

-- T12 the signature is unchanged and the 31 columns keep their names and
-- places; the three door columns come after them.
do $$
declare args text; names text[]; ncols integer;
begin
  select pg_get_function_identity_arguments(p.oid),
         p.proargnames[p.pronargs + 1 : array_length(p.proargnames, 1)],
         coalesce(array_length(p.proallargtypes, 1), 0) - p.pronargs
    into args, names, ncols
    from pg_proc p
   where p.oid = 'public.house_beverage_ledger(uuid, integer)'::regprocedure;
  assert args = 'p_restaurant_id uuid, p_limit integer', format('T12 FAIL the signature changed: %s', args);
  assert ncols = 34, format('T12 FAIL the return shape has %s columns, expected 34', ncols);
  assert names[1:31] = array['house_key','label','books','first_seen','menu_lines','menu_bottle_price',
    'menu_glass_price','menu_sections','invoice_lines','first_bought','last_bought','bottles_bought',
    'paid_total','last_unit_price','last_bought_from','order_lines','last_ordered_at','last_order_price',
    'last_ordered_from','quote_count','last_quote_at','last_quote_price','last_quote_source',
    'last_quote_from','pos_lines','poured_qty','poured_revenue','first_poured','last_poured',
    'beverage_id','match_method'], format('T12 FAIL the first 31 columns moved: %s', names[1:31]);
  assert names[32:34] = array['door_checked_lines','first_bought_door_checked','last_bought_door_checked'],
    format('T12 FAIL the appended columns are %s', names[32:34]);
end $$;

-- T13 another house's door check never reaches this one. The other house
-- door-checked a "Zqdc Fords Gin" at 99.00, and a price row and an event
-- stamped with the other house point at this house's o1; this house's row is
-- unchanged (T1-T3 hold the same numbers), and house_door_checked for the
-- other house returns only its own order.
do $$
declare r jsonb := pg_temp.aw14_row('Zqdc Fords Gin'); n integer; o uuid;
begin
  assert (r->>'door_checked_lines')::int = 1 and (r->>'paid_total')::numeric = 265,
    format('T13 FAIL this house''s Fords Gin reads %s door rows, paid %s', r->>'door_checked_lines', r->>'paid_total');
  select count(*), min(order_id::text)::uuid into n, o
    from public.house_door_checked('a3014000-0000-4000-8000-000000000002'::uuid);
  assert n = 1 and o = 'a3014000-0000-4000-8000-000000000111',
    format('T13 FAIL the other house reads %s door rows (%s)', n, o);
end $$;

rollback;
