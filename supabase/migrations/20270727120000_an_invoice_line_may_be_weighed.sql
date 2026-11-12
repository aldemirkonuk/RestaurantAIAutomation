-- An invoice line may be weighed (R8, mail-receipts lane 2026-11-11).
--
-- WHY. The receipts walk filed a cheese invoiced `3 KGM @ 450` as `3 each`:
-- the line vocabulary had no weight, so the unit was dropped and the line read
-- as three pieces. ADR 0070 already keeps a house item in `kg`, `g` or `mg`
-- (`restaurant_inventory_uom_check`, 20260903171000); the paper could not say
-- the same thing, so nothing could carry a weight from the invoice to the shelf.
--
-- WHAT. `procurement_document_lines.uom` and `price_base_uom` accept `kg` and
-- `g` beside the seven container units. Nothing else widens: orders, order
-- items, agreed prices, receipt events and the price series keep the seven,
-- and the gateway refuses a weight on those paths by name
-- (`ORDER_UNIT_TYPES`, `PRICE_UOM_TYPES`). A weight converts only to another
-- weight, into the unit the house item is kept in; it is never a number of
-- bottles (`document-types.ts`, `massFactor`, `isMass`).
--
-- `mg` is not added to the paper: no invoice in hand prints one, and the item
-- side already has it for the dose-sized goods ADR 0070 names.
--
-- Additive and re-runnable: each constraint is dropped and re-added with a
-- superset of its values, so every row that held before still holds.

alter table public.procurement_document_lines
  drop constraint if exists procurement_document_lines_uom_check,
  add  constraint procurement_document_lines_uom_check
       check (uom::text = any (array[
         'bottle','case','keg','pack','split_case','each','liter','kg','g']));

alter table public.procurement_document_lines
  drop constraint if exists procurement_document_lines_price_base_uom_check,
  add  constraint procurement_document_lines_price_base_uom_check
       check (price_base_uom is null or price_base_uom in
              ('bottle','case','keg','pack','split_case','each','liter','kg','g'));

comment on constraint procurement_document_lines_uom_check
  on public.procurement_document_lines is
  'The seven container units plus the weights kg and g (R8, 2026-11-11). A weight converts only into the house item''s own weight unit (ADR 0070), never into bottles.';
