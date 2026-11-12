# Round 7 — end-to-end seams audit

Read at `origin/main` = `7221901d6` (fetched 2026-11-07), via `git archive` into `/private/tmp/claude-501/seam/` (shared checkout untouched; only `node_modules` was symlinked read-only to run jest). All `file:line` below are in that tree, under `apps/api-gateway/src/` unless stated.

Story traced: menu upload -> dishes/recipes -> goods in inventory -> reorder suggestion -> order to vendor -> vendor mail reply -> receiving -> invoice scan -> landed cost -> recipe cost/margin -> POS sale depletes stock -> dashboard/report number -> notification.

Contract docs: `SOFTWARE-CONTRACT.md` defines no seams (it defines a note anatomy). The seam list lives in `.planning/04-specs/ECOSYSTEM-PLAN.md` §2 (10-hop spine) and the per-software notes (`inventory-command.md:174`: "deplete->reorder is unwired"). Hop states below are re-checked against current code, not copied.

## Executed (pure/unit level; no DB, no dev server, no prod)

Probe specs are saved in `round7-probes/` (run with the api-gateway jest config; they need the repo's node_modules).

1. `price-base.spec.ts` — real `DeliveryStockService.agreedPrices` against a fake DB. Invoice line `142 @ price base 12 bottles` returned unitCost **142**; invoice line `2 cases @ 264/case, pack 12, qty_bottles 24` returned unitCost **264**. The document layer's own `lineNetFromPrice` gives net 528 for the same line (so 22/bottle is knowable). Result: lot cost per bottle is wrong by the pack/price-base factor (see B1).
2. `day.spec.ts` — real `netSalesByHouseDay`, Istanbul, check opened 23:50 local, closed 00:10 next day: dashboard files it on the **close** day (2026-11-06) with net 100 (subtotal). The sale-record notification reads the same check by **opened_at** and sums `total` (see G1).
3. Not executed: SQL functions (`finalise_delivery_cost`, `apply_stock_movement`, `v_low_stock_items`) — read only, no database available. Production row shapes not checked. Python agent consumers were read for field names only, not run.

## Hand-off table

| # | Hand-off | Carrier | Shape match | Failure visible? | Cross-module test? |
|---|---|---|---|---|---|
| 1 | menu upload -> dishes/recipes | none for food; `menu_items` + `restaurant_inventory` for wine only (`menus.service.ts:1911` keeps only lines with `wine_library_id`) | n/a — no dish/recipe tables exist; `cocktail_ingredients` (`20260817090000_cocktails.sql:60`) is written by `beverages.service.ts:690-744` and read by nothing | n/a | none |
| 2 | menu -> goods in inventory | `restaurant_inventory` insert (`menus.service.ts:1943-1950`), price via `set_house_menu_price` | wine only. Row seeded with `stock_live` default 0 NOT NULL (baseline:3264) and `threshold_min` default (`:1946`); an existing row is matched with no `is_active`/`deleted_at` filter and never reactivated (`:1921`) | insert/read failure is named per line (`priceSync`), good | menus specs mock the DB |
| 3 | inventory -> reorder suggestion | alert: `v_low_stock_items` -> `low-stock-alerts.service.ts`; quantity-to-par is computed in the web only (`InventorySheets.tsx` `suggestedToPar`) | par rule is one definition, lockstep fixture web/api (`common/stock-status.ts`); unit hard-coded `'bottle'` (`InventorySheets.tsx:611`, `BottleLeaf.tsx:213`) | alert delivery recorded (`alert-ledger-records-what-happened.spec.ts`) | below-par fixture shared by both suites |
| 4 | reorder -> order to vendor | `POST /procurement/orders`, `approveOrder` -> RabbitMQ `procurement.events / procurement.conversation_request` (`procurement.service.ts:4204-4226`) | field names match the Python consumer (`provider_conversation_agent.py:811-835` reads provider_id, restaurant_id, order_id, intent_type); price fields do not (G4) | publish failure caught and logged only (`:4224`); approve still returns success | none on the JS side pins the payload; Python pins routing keys only (`test_event_topology.py:136`) |
| 5 | vendor mail reply | Postmark/inbound webhook -> `email.inbound.received` (`inbound-email.controller.ts:54-117`) -> bridge `handleInboundEmail` -> `conversations` row + `conversation_attachments` | normalised to the Gmail event shape; order attribution by thread, with an explicit refusal to guess for attachments (`rabbitmq-bridge.service.ts:948-967`) | webhook answers HTTP 200 `{status:"error"}` when publish fails (`:117`) | `inbound-email-html-body.spec.ts` covers body normalisation only |
| 6 | receiving | door count -> `delivery-stock.service` -> `apply_stock_movement`, lots provisional | bottles are integers; order unit conversion tested (`order-units.spec.ts`, `door-count.spec.ts`) | failed reads return `ok:false` (ADR 0067), not empty | many service specs, all with mocked rows |
| 7 | invoice scan | `conversation_attachments` -> cron `sweepUningestedAttachments` (`document-intake.service.ts:2120-2121`) -> `procurement_documents` + `procurement_document_lines` | `unit_price` stored as printed, with `uom`, `pack_size`, `price_base_qty/uom` beside it (`:1331-1341`) | sweep skips silently on download error (`:2158`) and only looks at the newest 200 attachments (`:2129`) | `document-intake.service.spec.ts:246` (correlation scope) |
| 8 | landed cost | `delivery-stock.service.agreedPrices` -> `finalise_delivery_cost(p_unit_cost)` -> `inventory_lots.unit_cost numeric(10,2)` | **mismatch**: raw invoice `unit_price` is passed as a per-bottle cost (B1); freight/fuel/split-case/delivery fee/deposit never enter lot cost (BUG-2) | an unpriced item stays `provisional` with a named reason (good) | `lot-cost-truth.spec.ts`, `delivery-stock.service.spec.ts` — neither covers uom, pack or price base (grep: no `price_base`/`case` hit) |
| 9 | recipe cost / margin | `analytics/inventory-cost.ts resolveUnitCost`: lot WAC -> last purchase price -> unknown | cost is a bare number, labelled "Dollars per bottle" (`:58`); no recipe or plate cost anywhere | unknown stays null, never 0 (good, ADR 0051) | `inventory-cost` specs; no recipe seam exists |
| 10 | POS sale depletes stock | pos-hub `ingest` -> `pos_checks` upsert -> `applyStockEffects` -> `record_glass_pour` / `apply_stock_movement` (`pos-hub.service.ts:1298-1560`) | wine lines only (`:1365`); sale volume resolved or queued, never defaulted; dated by `closed_at` (ADR 0281) | unmapped / no-volume lines queued to `pos_unresolved_lines`; per-import report returned; low-stock re-check is fire-and-forget with an empty catch (`:1572`) | 14 pos-hub specs, strong; Toast path is separate (B3) |
| 11 | dashboard / report number | `pos_checks.subtotal`, voided=false, house day (`dashboard.service.ts:296-345,448-451`) | net sales by close day; procurement spend sums `total_cost \|\| final_price` with no currency (`:868`) | spend query error returns zeros (`:839-860`) | `dashboard.spend.spec.ts` checks naming only (no currency, error or month-edge case) |
| 12 | notification | `notification-producers.service` crons; `sale-record.producer`, `invoice-confirmed.producer`, `delivery-recorded.producer` | sale record sums `total` by `opened_at` and writes `currency:"USD"` (G1); invoice note uses `doc.currency \|\| "USD"` (H2) | a failed read throws to `runPerTenant` (good) | per-producer specs, no spec compares a producer's figure with the dashboard's |

## Findings

Class key: BLOCKER = the story cannot complete or a headline number is wrong by a large factor; BUG = wrong or dropped data at a seam; HARM = misleading or silent but bounded; SMOOTH = seam verified working; IMPROVE = cleanup / gap.

### BLOCKER

**B1. Invoice price never becomes a per-bottle lot cost.** `procurement/canonical/delivery-stock.service.ts:201` selects only `qty_bottles, unit_price`; `:751` and `:418` pass `unit_price` straight to `finalise_delivery_cost(p_unit_cost)`. The row's `uom`, `pack_size`, `price_base_qty`, `price_base_uom` are never read. `unit_price` is stored "as printed" (`documents/document-intake.service.ts:1331-1341`; `documents/parsed-document.ts:109-127`). Executed: 264/case with pack 12 books 264 per bottle (22 is right); `142 / KS(12)` books 142. Everything downstream inherits it: WAC (`inventory_lot_rollup`), margin, vendor price compare, the "landed" claim in ECOSYSTEM-PLAN hop 8. The matcher gets this right (`invoice-match.ts`, `agreedPricePerBottleForDoor` at `procurement.service.ts:5107,6389`); only the cost path does not. Untested (see table row 8). Fix direction: reuse `lineNetFromPrice` / `agreed-price.ts` to derive per-bottle cost before the RPC. Production rows not checked, so how many lots are already wrong is unknown.

**B2. The food half of the story has no code.** No dish, recipe, plate-cost or food-inventory table exists (`rg recipe|dish` in gateway = nothing relevant; only `cocktails` / `cocktail_ingredients`). Menu import keeps wine lines only for inventory (`menus.service.ts:1911`). POS skips every non-wine line (`pos-hub.service.ts:1365`, comment cites register A11). Cocktail recipes can be written (`beverages.service.ts:690-744`) but no reader depletes a base spirit or costs a drink. So "menu -> recipes -> recipe cost/margin -> POS depletes ingredients" cannot run end to end for any food or cocktail line. This is a missing seam, not a defect in existing code.

**B3. Toast is a second, divergent POS pipeline.** `toast/toast.service.ts:491` runs `applyOrderSaleEffects` on its own: no `pos_checks` write (dashboard, sale-record, goals, basket analytics stay blind), no `wine_consumption_log` (demand series blind), `saleUnit ?? "bottle"` at `:638` (the 5x over-depletion default ADR 0011 removed from pos-hub), `p_pour_ml: null` at `:675`, no `closed_at` dating (no `p_occurred_at`), failures only `logger.warn` (`:700-705`). Idempotency keys differ from pos-hub's (`toast_sale_<guid>_<menu>` vs `pos:<source>:<check>:<item>:<line>`), so a house reachable by both the Toast door and the pos-hub Toast adapter (`pos-adapters.ts:229`) would deplete twice. ECOSYSTEM-PLAN hop 1 named this on 2026-09-01; it is still in the tree. Blocker for any Toast house; I did not check which houses are on Toast.

### BUG

- **BUG-1 / G1. The same service day has three revenue definitions.** Dashboard: `subtotal`, by close day, house zone (`dashboard.service.ts:296-345`). Sale-record notification: sum of `total`, filtered by `opened_at` (`notifications/producers/sale-record.producer.ts:233,236`), `currency:"USD"` hard-coded (`:180`). Goals and analytics: `total` (`analytics.controller.ts:1187`). A late check lands on different days with different amounts (executed, probe 2). The notification links to `/reports` as "Open reports", so the user sees two numbers for one day. The dashboard file itself says the shared `houseDayOf` is "unmerged" (`dashboard.service.ts:308-313`).
- **BUG-2. "Landed" cost is invoice price only.** `freight`, `fuel_surcharge`, `split_case_fee`, `delivery_fee`, `deposit_total` live on `procurement_documents` (`document-intake.service.ts:2216`) and line `allowance`/`deposit` on lines, but `agreedPrices` reads none of them; they feed tie-out only. Lot `unit_cost` is therefore purchase price, not landed cost, while the hop table calls it landed.
- **BUG-3 / G3. `approveOrder` reports success when the vendor-letter request failed.** Status set to APPROVED and shadow stock reserved (`procurement.service.ts:4186`), then the publish error is caught and logged (`:4224`); the response is the order. No state, sweep or alert shows "approved, nothing asked of the vendor" (ECOSYSTEM-PLAN hop 5 says the same; no change found). Mitigation: the create-time letter path (`order_letter_door.py`, `stage_order_letter`) may already have drafted; not verified for every order path.
- **BUG-4 / G2. A vendor reply is lost when the broker is down.** `inbound-email.controller.ts:115-117` catches the publish failure and still answers HTTP 200 with `{status:"error"}`. Postmark-style providers do not retry a 200, so the vendor's reply, price change or invoice attachment never reaches the bridge. The shared secret may also arrive as `?secret=` (`:59`), which lands in access logs. No test covers the failure branch.
- **BUG-5 / G4. The price in the order event has no unit or currency.** `procurement.service.ts:4214-4219` sends `target_price = negotiatedPrice || quotedPrice || 0` and `max_acceptable_price = that * 1.1`. Orders carry `price_uom`/`pack_size`/`currency` (ADR 0119), none are sent. The consumer compares a parsed vendor price to `max_acceptable_price` (`provider_conversation_agent.py:4025-4030`); with price 0 the key is present as 0, so `.get(..., inf)` never applies and every parsed price becomes `counter_offer`. A per-case quote against a per-bottle target misclassifies the same way. The fallback template prints `$` and `/bottle` (`:2346`).
- **BUG-6 / G5. A scanned menu seeds every wine as empty and below par.** New rows get `stock_live` 0 (NOT NULL default, baseline:3264) and `threshold_min` >= 1 (`menus.service.ts:1946`); the low-stock path has no "never counted" guard (`low-stock-alerts.service.ts:448-520` consumes `v_low_stock_items` rows as given; the view tests `stock_live < threshold_min`, baseline:6048). Unknown quantity and zero quantity are the same value, so the first menu import can raise a critical-alert flood for stock nobody has counted. Not run against a database; the view's behaviour is from the SQL text.
- **BUG-7 / G6. Re-import does not reactivate a discontinued wine.** `addToInventory` finds the row by house + `master_wine_id` with no `is_active` filter (`menus.service.ts:1921`) and links the menu line to it. `softDeleteItem` sets `is_active=false` (`inventory.service.ts:2051`); the low-stock view excludes inactive rows. The wine is on the current menu, mapped for POS, and invisible to par alerts. (The plan view at `menus.service.ts:1368` does report `active`, so the state is known there, just not acted on.)
- **BUG-8. POS lines that move no stock without saying so.** (a) A void that is the first sighting of a check returns `+qty` bottles for a sale this system never depleted (`pos-hub.service.ts:1480`; no check that a sale movement exists under the sale key). (b) `Math.round(Number(it.qty))` (`:1367`) turns a 0.5 quantity into 0 and the line is skipped as "not stock". (c) Known and recorded: a glass void returns a whole bottle (B19, comment at `:1451-1458`). (a) and (b) are from code reading; neither was executed.
- **BUG-9 / G8. Dashboard procurement spend.** `dashboard.service.ts:839-940`: a read error returns zeros (looks like a quiet month, against ADR 0067); `:868` sums `total_cost || final_price` across orders of different `currency` with no grouping (the receiving screen does group, `receiving.service.ts:1359-1373`); the month bucket compares the server-local month (`:878`) with the UTC string prefix of `delivered_at`, and never uses the house zone (the zone helper exists at `:531-540`). `dashboard.spend.spec.ts` asserts field names only.

### HARM

- **H1. Lot cost carries no currency.** `inventory_lots.unit_cost numeric(10,2)` has no currency column (baseline:3180) and `finalise_delivery_cost` takes none (migration `20260906233000`, `:309` onward, zero mentions of currency). A manager may deliberately change an invoice's currency (`documents.controller.ts:1813`), the cost then lands in the same column. Analytics labels the number "Dollars per bottle" (`analytics/inventory-cost.ts:58`). Two-decimal storage also loses the per-bottle fraction once B1 is fixed (142/12 = 11.83).
- **H2. Invoice note defaults to USD.** `notifications/producers/invoice-confirmed.producer.ts:132` `String(doc.currency || "USD")`, against the founder's 2026-09-06 rule (never USD as a default, `invoice-currency.ts` header).
- **H3. House zone silently falls back to UTC** in the dashboard (`dashboard.service.ts:539`) and in the producers (warn only, `notification-producers.service.ts:463-466`). A house with no zone gets UTC day edges and no flag.
- **H4. Invoice backfill sweep is lossy at the edges.** Looks only at the newest 200 attachments (`document-intake.service.ts:2129`), `continue`s silently on a storage error (`:2158`), and re-reads the same unparsed ones every 5 minutes, so an attachment that never yields a document costs a download (and possibly a model call) per tick with no counter.
- **H5. Low-stock re-check after a sale swallows its own failure.** `pos-hub.service.ts:1572` and `toast.service.ts:715`, `.catch(() => undefined)`; unlike the digest path there is no log line, so a broken alert hook is invisible. The instant-alert cooldown is an in-memory map (`low-stock-alerts.service.ts`, `lastInstantAt`), so it resets per instance and per deploy.

### SMOOTH (verified working at the seam)

- POS -> stock fails closed: unmapped, foreign-house and no-volume lines go to `pos_unresolved_lines`, a failed ownership read moves nothing, void has its own idempotency key, the sale and its stock share one `closed_at` (`pos-hub.service.ts:1298-1560`; specs `void-idempotency`, `sale-time`, `mapping-inventory-ids-belong-to-the-house`, `fail-open`).
- Below-par is one definition shared by api and web via a fixture (`common/stock-status.ts`).
- Menu prices reach the house through `set_house_menu_price` with dating and lock handling; per-line failures are named (`menus.service.ts:1898-1990`).
- Reorder sheet pre-fills quantity to par and refuses a made-up default; Ask-AI reorder validation caps and types the payload (`ask-ai-actions.ts:100-165`).
- Order approval needs a redeemed, money-hashed seal; the vendor letter has a single DB door so two agents cannot stage two drafts (`order_letter_door.py`, `stage_order_letter`).
- Inbound attachments are linked to an order only by thread, never by guess (`rabbitmq-bridge.service.ts:948-967`).
- Invoice vs PO comparison converts to bottle-equivalents (`invoice-match.ts`, `agreed-price.ts`); money-gate holds a document whose seen currency disagrees.
- Receiving at-risk totals are grouped per currency (`receiving.service.ts:1359-1373`).
- Dashboard net sales use one house-day rule and say how many checks stated a subtotal (`dashboard.service.ts:296-345`, executed).
- Analytics cost says "unknown" instead of inventing a number (`inventory-cost.ts`).

### IMPROVE

- **I1. Deplete -> reorder is still unwired** (ECOSYSTEM-PLAN hop 4; `inventory-command.md:174`). A crossing produces a notification; the quantity suggestion exists only in the browser. No gateway code turns a crossing into a draft order.
- **I2.** `uiStore.pendingReorder` (`apps/web/src/stores/uiStore.ts:12,40,124`) has no setter caller or reader outside the store: the "WineLibrary -> Orders" hand-off it was built for does not exist.
- **I3.** Order units on the reorder path are hard-coded `bottle` (`InventorySheets.tsx:611`, `BottleLeaf.tsx:213`), so a case-priced vendor cannot be ordered in cases from there.
- **I4.** No spec crosses a module boundary: every seam test feeds hand-written rows to one side. The two seams that fail above (B1, G1) each have passing unit suites on both sides. A contract fixture per hand-off (row shape in, row shape out) would have caught both.
- **I5.** Software map findings still open: `reports` (10 endpoints) and `contacts` have no web caller; `one-tap-actions` and `ux-optimizer` are not called from either recommendations page (`SOFTWARE-MAP.md` findings 4-5), so hop 10 (recommendation -> par/menu price) has no path.
- **I6.** `SOFTWARE-CONTRACT.md` has no section for hand-offs. §3 says "name the seam if the module is shared" but nothing lists what each software consumes and produces; the 10-hop table in ECOSYSTEM-PLAN is the only seam register and predates several fixes (hop 7 "estimated cost" and hop 8 "estimated->landed" read as done; B1 and BUG-2 say otherwise).

## Seams the docs promise that have no code

1. Menu -> dishes -> recipes (food). No tables, no extractor, no UI.
2. Recipe -> ingredient depletion at POS (food and cocktails). `cocktail_ingredients` is write-only.
3. Recipe cost / plate margin (food and cocktails).
4. Deplete -> reorder proposal in the gateway (hop 4); the Python `procurement_agent` path is documented as ungated/dormant and was not re-verified.
5. Freight/fee/deposit allocation into lot cost (landed cost proper).
6. Recommendation -> par / menu price write-back (hop 10).
7. Beer, spirits and soft drinks: scanned menu lines are stored but get no inventory row (wine library match only), and POS skips them, so no stock seam for them either.
8. Customer division (consent, guest links): zero application code per ECOSYSTEM-PLAN; outside this story.

## Counts

BLOCKER 3 · BUG 9 · HARM 5 · SMOOTH 10 · IMPROVE 6 · missing seams 8 · hand-offs traced 12 · probes executed 2 spec files (3 behaviours observed)

## Limits stated per CLAUDE.md §0.5

- No database: SQL functions and views were read, not run; BUG-6 and BUG-8 rest on the SQL text and code reading.
- Production data not queried; how many lots or checks already carry the B1 / B3 errors is unmeasured.
- Python consumers read for field names only; the agent paths for hop 4 and the inbound responder were not traced to the end.
- 12 hand-offs were traced by the main path; edge variants (keg, sample bottles, split deliveries, recurring orders) were not.
