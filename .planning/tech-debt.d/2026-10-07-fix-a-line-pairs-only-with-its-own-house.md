## A document line could be paired with another house's order line — OPEN (two follow-ups) — 2026-10-07

Filed by `fix/a-line-pairs-only-with-its-own-house`. Claim: `../decisions/claims.d/fix-a-line-pairs-only-with-its-own-house.jsonl:1`.

**What was wrong at `a323cc80b`.** `POST /procurement/documents/:id/lines/:lineId/link` (`apps/api-gateway/src/procurement/documents/documents.controller.ts:1589`) calls `DocumentIntakeService.confirmLineMatch` (`document-intake.service.ts:1841`). The method read the DOCUMENT line under the caller's house and then wrote the body's `orderLineId` into `procurement_document_lines.order_line_id` without reading the order line. The column carries only a foreign key to `procurement_order_items(id)` (`supabase/migrations/20260805000000_baseline_from_production.sql:13062`), so nothing below the gateway refused another house's order line.

**Fixed on this branch.** Before the pairing write, `confirmLineMatch` reads the order line through `procurement_orders!inner(restaurant_id)` filtered to the caller's house and requires the embedded order's `restaurant_id` to match. Another house's line and a missing id both answer 404 with nothing written. Ownership is read through the order because `procurement_orders.restaurant_id` is `NOT NULL` and `procurement_order_items.restaurant_id` is nullable (baseline `:4504` and `:4517`; no later migration changes either column).

**Other gateway writers of `order_line_id`, checked at `a323cc80b`. None needed a change.**

- `document-intake.service.ts:1321` and `:1343`: intake inserts lines with `order_line_id: null`.
- `document-intake.service.ts:1716` (`matchDocumentLines`) and `:1783` (the suggestions upsert): candidate order lines come from `procurement_order_items` filtered on the item's own `restaurant_id` (`:1678`) and on order ids from `procurement_document_links` filtered to the house (`:1661-1666`). An item whose `restaurant_id` is NULL is left out, not crossed. The only gateway insert into `procurement_order_items` (`procurement.service.ts:1629-1631`, row built at `:1558-1559`) writes `order_id` and `restaurant_id` from the same call's arguments; the table's two gateway updates (`procurement.service.ts:9584`, `inbound-responder.service.ts:1332`) set only `final_unit_price`.
- `document-intake.service.ts:1866`: the unpair branch writes `null`.
- `editLine`'s restore (`document-intake.service.ts:2583-2586`) writes back only the columns of `update`, and `update` is built from the patch fields at `:2486-2517`, none of which is `order_line_id`.

**Open 1: pairings stored before the fix.** Production was not queried. This read-only query counts them:

```sql
select count(*)
from procurement_document_lines l
join procurement_order_items oi on oi.id = l.order_line_id
join procurement_orders o on o.id = oi.order_id
where o.restaurant_id <> l.restaurant_id;
```

**Open 2: a reader that follows `order_line_id` without a house filter.** `CanonicalDocumentService.resolveLines` (`apps/api-gateway/src/procurement/canonical/canonical-document.service.ts:741`) reads `procurement_order_items` by id alone (`:764-766`), and a line with no shelf of its own takes the order line's `inventory_id` (`:817`). With the write closed, only a row stored before the fix (Open 1) could carry another house's item onto a canonical line. Adding a house filter there was left out of this branch to keep it to the write.
