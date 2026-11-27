-- An invoice line may be in US units (r36 invoices R4, 2026-11-13).
--
-- WHY. A US food invoice prints `10 LB`, `16 OZ`, `4 GAL` or `64 FL OZ`. The
-- line vocabulary held only metric and container units, so the reader filed
-- such a line as `each`, and the door booked `10 LB` of chicken into an item
-- kept in grams as 10 g. Its lot cost was then refused, so it stayed uncosted.
--
-- WHAT. `procurement_document_lines.uom` and `price_base_uom` accept `lb`,
-- `oz` (weights) and `gal`, `floz` (volumes) beside the units
-- 20270727120000 allows. The gateway reads `lb` and `oz` from this change
-- on, and `gal` and `floz` from the volumes change stacked on it; the CHECK
-- takes all four at once so the line vocabulary moves in one step. Nothing
-- else widens. The house item stays metric
-- (ADR 0070: `restaurant_inventory.uom` is unchanged); the gateway converts a
-- US line into the item's g, mg, kg, ml or l by the exact legal definitions
-- (`document-types.ts`, `massFactor`, `volumeFactor`, `inItemUnit`). Orders,
-- order items, agreed prices and receipt events keep their container units,
-- and the gateway refuses a US unit on those paths by name, as it does a kg.
--
-- Additive and re-runnable: each constraint is dropped and re-added with a
-- superset of its values, so every row that held before still holds.

alter table public.procurement_document_lines
  drop constraint if exists procurement_document_lines_uom_check,
  add  constraint procurement_document_lines_uom_check
       check (uom::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter','kg','g',
         'lb','oz','gal','floz']));

alter table public.procurement_document_lines
  drop constraint if exists procurement_document_lines_price_base_uom_check,
  add  constraint procurement_document_lines_price_base_uom_check
       check (price_base_uom is null or price_base_uom in
              ('bottle','case','keg','pack','split_case','each','liter','kg','g',
               'lb','oz','gal','floz'));

comment on constraint procurement_document_lines_uom_check
  on public.procurement_document_lines is
  'The seven container units, the weights kg, g, lb and oz, and the volumes liter, gal (US) and floz (US) (R8 2026-11-11, r36 R4 2026-11-13). A weight or volume converts only into the house item''s own metric unit (ADR 0070), never into bottles.';
