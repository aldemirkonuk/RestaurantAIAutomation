<!-- Drafted 2026-10-07 ~21:48Z (date -u read 21:47:53Z) for branch fix/a-line-pairs-only-with-its-own-house at e21525d39, base origin/main a323cc80b. -->

## What was wrong (verified at origin/main a323cc80b)

`POST /procurement/documents/:id/lines/:lineId/link` (`documents.controller.ts:1589-1621`) calls `DocumentIntakeService.confirmLineMatch` (`document-intake.service.ts:1841-1956`). The method reads the document line filtered on `id`, `document_id` and the caller's `restaurant_id` (`:1850-1858`). It then writes the body's `orderLineId` into `procurement_document_lines.order_line_id` (`:1912-1945`) without reading the order line. Nothing below the gateway refuses it either. The column has only a foreign key to `procurement_order_items(id)` (`supabase/migrations/20260805000000_baseline_from_production.sql:13062`), and no later migration adds a check. So a house could pair its own invoice line with another house's order line.

**What such a pairing would do today.** I checked the gateway readers that follow `order_line_id`:

- `CanonicalDocumentService.resolveLines` reads `procurement_order_items` by id alone (`canonical-document.service.ts:764-766`). A line with no shelf of its own takes the order line's `inventory_id` (`:817`, `inventoryIdSource: "order"`) and `master_wine_id` (`:844`). So the paired line on house A's canonical document would carry house B's item and wine ids.
- The price-provenance read (`procurement.service.ts:2865-2871`) filters document lines on the caller's `restaurant_id`. Ask-readings (`reading-sources.ts:49-54`, `:61-67`) reads only order lines of orders the house owns and drops child rows of another house. Neither shows a cross-house pairing to either house: it is simply not there for them.
- The cellar's `house_door_checked` is on the unmerged branch `fix/cellar-door-checked-cost`, not on main. Its third `NOT EXISTS` also filters `l.restaurant_id = p_restaurant_id`. So house A's pairing would not make house B's door row step aside.

So I found one gateway reader on main that would show another house's data: the canonical document, above. The other two readers would ignore the pairing.

**Why this is fixed first.** ADR 0261:186 decides W42's "ask a person to pick the delivery when nothing matches". The 2026-10-07 unlinked-invoice audit (`p4-scratch/sim-run/fixes/audits/unlinked-invoice-fork-2026-10-07.json:51`) names this route as the one that already pairs an invoice line with any order line. A person's pick that reaches this route would reach this gap.

## The fix

Before the pairing write, `confirmLineMatch` reads the order line (`document-intake.service.ts:1895-1918` at e21525d39):

- `.from("procurement_order_items").select("id, procurement_orders!inner(restaurant_id)").eq("id", orderLineId).eq("procurement_orders.restaurant_id", restaurantId).maybeSingle()`, and then
- it requires the embedded order's `restaurant_id` to equal the caller's house. If PostgREST ever returned the row without applying the inner filter, the order line would still be refused.

Ownership is read through the order because `procurement_orders.restaurant_id` is `NOT NULL` (baseline `:4517`) and `procurement_order_items.restaurant_id` is nullable (`:4504`). Another house's order line and an id that does not exist both throw `ORDER_LINE_NOT_FOUND`. The route maps that to 404 "This restaurant has no order line with that id, so the line was not paired." (`documents.controller.ts:1617-1623`), with nothing written. A failed read throws its message, which the route answers 500, like the method's other failed reads. `orderLineId: null` (unpair) returns before the new read and is unchanged. The route's `@ApiOperation` description gains one sentence saying the same.

**Other gateway writers of `order_line_id`. None needed a change** (details in `tech-debt.d/2026-10-07-fix-a-line-pairs-only-with-its-own-house.md`):

- `document-intake.service.ts:1321`, `:1343`: intake writes `null`.
- `:1716` (`matchDocumentLines`) and `:1783` (the suggestions upsert): candidates come from order items filtered on the item's `restaurant_id` (`:1678`), within orders linked to the house (`:1661-1666`).
- `:1866`: unpair writes `null`.
- `editLine`'s restore (`:2583-2586`) writes back only patch columns (`:2486-2517`), and none of them is `order_line_id`.

A grep for `order_line_id` in `services/`, `apps/web/src` and `apps/mobile` finds no writer. The web hits are reads and types.

No ADR: this is a defect fix, and no decided rule changes.

## Tests

Targeted files only (machine load):

- `npx jest src/procurement/documents/proposal-preservation.spec.ts src/procurement/documents/line-route-uuid-guard.spec.ts` at e21525d39: **2 suites, 26/26 pass**.
- New describe block in `proposal-preservation.spec.ts:534` ("confirmLineMatch — a line pairs only with its own house's order line"), **6 cases**. The fixture models the `!inner` embed: without `!inner`, a row whose order is not the house's comes back with `procurement_orders: null`.
  - refuses another house's order line and writes nothing (no line update, no suggestion update);
  - a missing id gets exactly the same error as another house's;
  - the ownership read selects `procurement_orders!inner(restaurant_id)` and filters `id` and `procurement_orders.restaurant_id`;
  - accepts the house's own order line;
  - unpair (null) reads no order line and still clears the line;
  - the controller's `linkLine` answers 404 for another house's order line.
- With origin/main a323cc80b's `document-intake.service.ts` and `documents.controller.ts` swapped in, **4 of the 6 new cases fail** (refusal, same answer, ownership read, 404). The accept and unpair cases pass there. The 9 existing ADR 0059 L1/L2 cases still pass. Their L1 fixture now answers the order-line read for `ol-1`/`ol-9` as house `rest-1`.
- `npx tsc --noEmit -p apps/api-gateway/tsconfig.json`: no errors in the touched files. It does report 2 errors, both TS2307 for `@simplewebauthn/server` in `src/passkeys/passkeys.service.ts`, a module missing from the linked `node_modules`. They are unrelated to this change.
- `eslint` on the three touched files: 0 errors. The prettier warnings left are all outside this diff's hunks.

**CLAIMS:** `claims.d/fix-a-line-pairs-only-with-its-own-house.jsonl:1` (`DOCUMENT-LINE-PAIRS-ONLY-WITH-ITS-OWN-HOUSE`, `resolved`). It is a static Python check: the ownership read and the owner check come before `.update(update)` inside `confirmLineMatch`, the controller maps `ORDER_LINE_NOT_FOUND` to 404, and the spec holds the cases. Results:

- exit 0 at e21525d39;
- exit 1 with empty stderr against a `git archive` of origin/main a323cc80b's three files;
- each of 9 mutations fails it: dropping `!inner`, dropping the house filter, dropping the owner comparison, removing the throw, renaming the controller mapping, renaming a spec case, moving the check after the write, renaming the method (`cannot open`), and deleting the service file (`No such file or directory`).

`scripts/check_decision_claims.sh` was **not** run here; the coordinator runs it. `lanecheck.sh wt-fix-linepair`: all six guards rc=0, files=5, ownership `[]`.

## What is not covered

- **Pairings stored before this fix.** I did not query production. The read-only count query is in the tech-debt entry.
- **`resolveLines` still reads order items by id alone** (`canonical-document.service.ts:764-766`). Now that the write is closed, only a row stored before the fix could show another house's item there. A house filter on that read is left for a follow-up (tech-debt entry, Open 2).
- **No database constraint or trigger.** The rule is enforced only in this route. A writer outside the gateway, or a future one, is not stopped by the schema.
- **A malformed `orderLineId` in the body** (not a uuid) is not validated before the read. Postgres rejects it and the route answers 500. By reading the code, not by running it: before this fix the update failed the same way.
- **The route test calls the controller method directly** over a mocked client. No HTTP-level test through Nest's pipeline and no SQL test was run.
- `matchDocumentLines` scopes candidates by the item's own `restaurant_id`, not the order's. This is left unchanged: the only gateway insert into `procurement_order_items` (`procurement.service.ts:1629-1631`) writes both ids from one call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
