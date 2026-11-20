# cost-math: invoice to cost to margin, and table sale to COGS

Read-only audit of `origin/main` at `e26a5152d`, 2026-11-07. All code was read through `git show origin/main:<path>`. No tests were run, no runtime was observed and production was not touched. Every number below comes from reading code.

This audit builds on two earlier documents and does not repeat their intake findings (G1-G12 there):
- `p4-scratch/sw-menu-receipts/receipt-upload-audit.md`
- `p4-scratch/sw-menu-receipts/proposal-receipt.md`

## 1. What the software is for, in the house's words

> "When the wine arrives and I check the paper, I want to know what each bottle really cost me, after the case price, the discount, the freight and the shortage. If he shorted me, I want that money back, not hidden in my cost. Then when a guest orders a glass at table 7, I want the bottle to go down and that glass's cost to land in what the night cost me. At the end of the week the report should say what I sold, what it cost me and what I kept, net of KDV, the way my accountant counts it."

The job has two halves that must meet on one number, the unit cost of a lot.

- **New goods.** An invoice line becomes a lot whose unit cost is correct. The price must be in the right unit, net of allowances and discounts, carry a fair share of freight, follow the house's tax basis, leave claimed money out, and keep deposits separate. Corrections must reach the lots, the item cost, the menu margin and the reports.
- **Table side.** A closed check line, from the POS or the Floor Checker, removes the right volume through a recipe or mapping. It stamps the cost of what left, so COGS is "what sold, times what it cost", not "what was bought".

## 2. Path map (origin/main)

### 2a. Upload, lot, cost (order model: DoorNext / ReceivingWorkspace)

| Step | Where |
|---|---|
| Paper read → `procurement_documents` + `procurement_document_lines` (`unit_price`, `qty_bottles`, `price_base_qty/uom`, `discount_total`, freight fields) | intake: `apps/api-gateway/src/procurement/documents/document-intake.service.ts:1071,1124,1558` (`discount_total` stored); price base columns: `supabase/migrations/20260904120000_document_lines_price_base_and_printed.sql` |
| Screen: receive desk | `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx` (1187 lines). Picks the document at `apps/web/src/services/api/documents.ts:409-426`. Charges at `:436-445`, used at `ReceivingWorkspace.tsx:403`. Prefill at `:425-440`. Payload at `:616-634` |
| Client call | `apps/web/src/services/api/orders.ts:597` POST `/verify-receipt` |
| Controller | `apps/api-gateway/src/procurement/procurement.controller.ts:661-678` |
| Service | `ProcurementService.verifyReceipt` `procurement.service.ts:6195`. Builds matchInput (`allocatedCharges: body.allocatedCharges ?? 0` at `:6444`) |
| Match math | `invoice-match.ts` `computeMatch` `:582-783`: `billableReceived` `:597`, `unitsOwed` `:742`, `creditAmount` `:745`, `effectiveUnitCost` `:750` |
| Stock + cost | `applyReceiptAdjustment` `procurement.service.ts:5996`. Calls `apply_stock_movement` (delta), then `revalue_lot` at `:6138`. Zero lots matched only logs a warning, at `:6165` |
| Claim | `openCreditClaim` `procurement.service.ts:5759` → `procurement/documents/credit-ledger.ts` |
| Price series | `recordPriceHistory` `procurement.service.ts:1672`, called at `:6879-6885` with `price: match.effectiveUnitCost ?? body.invoiceUnitPrice` |
| Mirrors | web `apps/web/src/lib/invoiceMatch.ts:76` (includes charges); mobile `apps/mobile/src/lib/invoiceMatch.ts:96-98` (no charges) |

### 2b. Upload, lot, cost (delivery model: DoorFrame, ADR 0103 "stock at the door, cost at VERIFIED")

| Step | Where |
|---|---|
| Door booking, provisional lot, no price | `canonical/delivery-stock.service.ts:179` `bookAtTheDoor` → `apply_stock_movement` (lot `cost_state` provisional unless invoice/manual, `20261222100000_a_pos_sale_is_dated_by_its_check.sql:183`) |
| VERIFIED | `finaliseAtVerified` `delivery-stock.service.ts:375-446` |
| Price per item | `agreedPrices` `:656-803`. Reads `procurement_document_lines.unit_price` `:730`, uses it as the bottle cost `:746-757` (`byItem.set`). An accepted `delivery_proposals.unit_price_proposed` overrides it `:767-790` |
| Cost write | `finalise_delivery_cost` `20260906233000_stock_at_the_door_cost_at_verified.sql:285`. Loops live lots of that delivery with `qty > 0`, writes `inventory_lot_revaluations`, sets `final` |

### 2c. Cost, item cost, margin, reports

| Reader | Where | Cost source |
|---|---|---|
| Lot WAC view | `inventory_lot_rollup` `20260902150000_lot_cost_truth.sql:486-506` | live, non-sample, costed lots, provisional and final mixed |
| Item unit cost | `analytics/inventory-cost.ts:124-156` `resolveUnitCost` | WAC if `has_invoice_cost`, else `restaurant_inventory.last_purchase_price` |
| Pricing basis | `analytics/engine/cost-basis.ts:107` `latestLotCost`, `:155` `weightedAverageCostBasis`, `:225` `costDrift` | lots |
| Menu margin advice | `pricing/margin-to-target.ts:12-13,123` (margin = (price − cost)/price; glass cost `:112`) via `pricing/margin-advice.service.ts:254` | `last_purchase_price` / lot |
| Glass vs bottle profit | `analytics/analytics.service.ts:351-392` | `last_purchase_price` × qty |
| P&L / turnover / DIO | `analytics/analytics.service.ts:31` (doc), `loadDeliveredOrders` `:203-228`, `const cogs` `:496`, `:513-519`, payload `:603-621` | **delivered `procurement_orders.total_cost`**, not sales |
| Report export | `reports/exports/report-export-cuttings.ts:596` "Cost of goods (365d)" | same |
| Web | `rp-registers-house.tsx:158-203`, `metric-registry.ts:64-81` | same |
| Sales-side function | `public.pos_item_sales` `20270301170000_cost_of_goods_reads_what_sold.sql` | returns sales, units, `bottles_out`; **no cost; no caller in app code** |

### 2d. Table order, depletion, COGS

| Step | Where |
|---|---|
| POS hub (canonical) | `pos-hub/pos-hub.service.ts` (2009 lines). Mapping read `:1181`. ADR 0011 volume resolution `:438-523`. Closed checks only `:695`. Per item: `record_glass_pour` `:1440` or `apply_stock_movement` `:1480-1484` (void → `+qty`, `return`) |
| Toast (parallel) | `toast/toast.service.ts:503-690`. Per line: mapping query `:533-540`, fallback query `:551-557`, then RPC `:654/:672/:683` |
| Ledger | `apply_stock_movement` `20261222100000_...:94`. A negative delta FIFO-deletes or decrements lots `:220-233`. Writes `inventory_transactions.unit_cost = p_unit_cost` `:236-242`, NULL for a sale. A positive delta inserts a new lot `:215-219` |
| Glass | `record_glass_pour` `20261222100000_...:292` |
| Floor Checker | No gateway module on main. `packages/floor-core/src/freshness.ts` + `index.ts` only. PR #757 (score) open |
| Recipes / BOM | None. No `recipe*` table in `supabase/migrations`; only `scripts/synth/recipes.py` |

## 3. How it performs today (from reading the code)

- **verifyReceipt** is one order and one item per call. It runs sequential awaits (`apply_stock_movement` → `revalue_lot` → claim → price history → paper writes). Latency is fine for one wine. A 20-line invoice becomes 20 desk round trips, because the server cannot take a multi-line invoice (G8).
- **finaliseAtVerified** loops per item and makes one `finalise_delivery_cost` RPC each (`delivery-stock.service.ts:375-446`). For a 30-line delivery that is a 30-RPC waterfall. It is not in one transaction, so a mid-loop failure leaves a half-final delivery.
- **Toast ingest** is N+1 per check line: up to two `.maybeSingle()` lookups plus an RPC (`toast.service.ts:533-557, 683`). A 6-line check costs about 18 round trips. pos-hub reads mappings once per batch (`:1181`) and is better.
- **Analytics** reads 365 days of delivered orders and the full inventory for each financial summary (`analytics.service.ts:203-228`). This is cheap at one tenant and grows linearly. The `inventory_lot_rollup` view is an unindexed GROUP BY over all lots per read.
- **Web weight.** `ReceivingWorkspace.tsx` (1187 lines) and `ReceiptsNext` (about 2127 lines) are route chunks, and I did not measure their bundle size (no build was run). The receive desk fetches the order, then the documents, then derives the prefill: a three-step waterfall before the form is usable.

## 4. Gaps

Severities: **blocker** means the number is wrong or missing for every house; **major** means it is wrong in common cases; **minor** means it is wrong in edge cases or affects hygiene.

**G1. COGS is purchases, not what sold. Blocker.**
- `analytics.service.ts:31` documents "Purchases / COGS ← procurement_orders (delivered)". `loadDeliveredOrders` `:203-228` costs each order at `total_cost || final_price`. `cogs` at `:496` feeds margin, turnover and DIO (`:513-519`) and the export at `report-export-cuttings.ts:596`.
- ADR 0298, which would change this, is still Proposed. Its readers (#617, #703) are closed.
- `pos_item_sales` (`20270301170000`) returns `bottles_out` but **no cost**, and nothing calls it.
- Effect: a month with a big buy shows a terrible margin, and a month that sells down the cellar shows a great one. ADR 0298's measurement: $39,302.50 shown vs about $47,914 ledger cost.

**G2. A sale's cost is never stamped, so COGS cannot be rebuilt from the ledger. Blocker.**
- `apply_stock_movement` FIFO-**deletes** consumed lots (`20261222100000_...:224-233`) and writes the sale row with `unit_cost = p_unit_cost` (`:236-242`). That is NULL for every POS/Toast sale (`pos-hub.service.ts:1480-1484`, `toast.service.ts:683-690` pass no cost).
- Once a lot is gone, the cost of the bottles that left is gone with it. Any later "units × cost" must use today's WAC of the *remaining* bottles. That is not FIFO, and it is null when the item has sold out.
- This is the missing link between side (a) and side (b).

**G3. No recipe/BOM; food has no cost and no depletion. Blocker (for food).**
- No recipe or BOM table exists in `supabase/migrations`.
- The ledger cannot hold food: `inventory_lots.master_wine_id` is NOT NULL (OD-113).
- `pos_item_sales` counts food lines as sales with nothing out (ADR 0298 names food as excluded).
- A cocktail, or a bottle used in a dish, can only map to one inventory row (`pos_item_mappings.inventory_id`).

**G4. The delivery path costs a case price as a bottle price. Blocker for case-billed paper.**
- `agreedPrices` takes `procurement_document_lines.unit_price` as the per-bottle `unitCost` (`delivery-stock.service.ts:746-757`). It ignores `price_base_qty/uom`, which state the price is *per* `KS(12)` (`20260904120000_...`). `142,00 / KS(12)` lands as 142 per bottle, 12× too high.
- `byItem.set` keeps the **last** line for an item, so two lines for one wine (two vintages, or a free-goods line at 0) leave one price silently.
- Open PR #666 fixes price-as-printed only on the order path (`invoice-match.ts`, `procurement.service.ts`, mirrors). It does not touch `delivery-stock.service.ts`.

**G5. Claimed money is counted twice: in the lot cost and in the credit claim. Major.**
- `effectiveUnitCost = (invoiceQty × invoiceUnitPrice + allocatedCharges) / acceptedQty` (`invoice-match.ts:750`).
- `creditAmount = unitsOwed × invoiceUnitPrice` for the same short or rejected units (`:742-748`).
- Example: billed 12 at $22, 10 accepted. The lot is costed at $26.40 a bottle (+$44 across the lots) *and* a $44 claim is opened. If the vendor pays, the house's cost stays inflated. If the vendor does not pay, the loss is already in cost and the claim double-states it.
- The cost should be the invoiced value of the accepted units (net) plus charges. The shortfall should live only in the claim.

**G6. A settled credit never corrects lot cost. Major.**
- `revalue_lot` has exactly one caller, `procurement.service.ts:6138` inside verifyReceipt. The credit ledger (`procurement/documents/credit-ledger.ts`) reaches `credited` without restating any lot.
- A price-correction credit, such as an overcharge refund, therefore never lowers cost. Together with G5, an over-billed and refunded bottle stays at the over-billed cost forever.
- Open PR #678 touches credit-ledger wording only.

**G7. Freight is added in full to every order on the same invoice. Major.**
- `allocatedChargesFor(doc)` sums the whole document's freight, fuel, split-case, delivery and other charges (`documents.ts:436-445`). `ReceivingWorkspace.tsx:403` sends that full amount as one order's `allocatedCharges`.
- One invoice covering N orders, or N wines (G8), loads the full freight N times. Nothing apportions it by value, quantity or volume.

**G8. A multi-line invoice is costed as one wine. Major.**
- The prefill sums `qtyBottles` over **all** invoice lines and takes the **first** priced line's `unitPrice` (`ReceivingWorkspace.tsx:425-440`). verifyReceipt handles one `orderRow.inventory_id` per call.
- A three-wine invoice therefore produces a wrong received quantity, a wrong verdict (a phantom short or over) and a wrong cost for the order's single wine. The other wines on the paper get no cost from this path.

**G9. Discounts and allowances never reach cost. Major.**
- Intake stores header `discount_total` (`document-intake.service.ts:1071,1124,1558`), but `allocatedChargesFor` leaves it out (`documents.ts:436-445`).
- The prefill's `unitPrice` is the gross line price (`ReceivingWorkspace.tsx:425-440`). `agreedPrices` reads gross `unit_price` (`delivery-stock.service.ts:746-757`).
- Agreed allowances, deposits and freight from the agreement (`20260905073000_the_agreement_names_the_money_outside_the_price.sql`) are only noted at verify time, not costed.
- Effect: every discounted invoice overstates cost and understates margin.

**G10. No tax basis: lot cost may be KDV-gross while menu margin divides by a gross menu price. Major.**
- No `tax_basis` column or stamp exists anywhere on main. The founder ruling of 2026-10-12 (per-house basis, stamp cost with its basis, no backfill) is unbuilt.
- The cost path excludes tax only by omission, reading `unit_price`. Whether a TR `unit_price` is KDV-inclusive depends on the paper.
- Margin advice computes `(price − cost)/price` (`margin-to-target.ts:12`) on `menu_price_current`, which in Turkey is a KDV-inclusive shelf price. Net cost against a gross price inflates the shown margin by the KDV rate.

**G11. Price corrections on bottles already sold are dropped. Major.**
- `finalise_delivery_cost` only revalues live lots with `qty > 0` (`20260906233000_...` loop). `applyReceiptAdjustment` logs "corrected no stock" when `lots_matched = 0` (`procurement.service.ts:6165`).
- If the invoice arrives after the bottles sold, which is common for fast movers, the gap between the estimated and the true cost of the sold bottles is posted nowhere, in neither COGS nor a variance row. G2 makes this worse, because the sold rows carry no cost to restate.

**G12. A void or return brings bottles back as new, uncosted, newest stock. Major.**
- A positive delta inserts a fresh lot with `unit_cost = p_unit_cost` (`20261222100000_...:215-219`). Void paths pass no cost: `pos-hub.service.ts:1480-1484` (`p_delta: +qty`, `return`) and `toast.service.ts:683-690`.
- Effects:
  - the bottle loses its cost;
  - it goes to the back of FIFO;
  - it raises `unpriced_qty` (`lot_cost_truth.sql:486-506`), which can flip `resolveUnitCost` to `invoice_lot_wac_partial` (`inventory-cost.ts:129-147`).

**G13. Toast is a second depletion path with weaker unit rules. Major.**
- `toast.service.ts:533-547` reads `sale_unit` only, not `sale_volume_ml` (ADR 0011 volume). Its own comment says an unmapped sale unit "falls back to bottle", so an unmapped glass can deplete a whole bottle.
- It runs N+1 queries per line (§3) and skips the pos-hub checks (`pos-bridge.md` §7). OD-244 (which amount a line's price counts) can differ between the two adapters.

**G14. The fallback cost column `last_purchase_price` has no writer on main. Major.**
- It is read as cost by:
  - `resolveUnitCost` (`inventory-cost.ts:149-153`), whenever there is no invoiced WAC;
  - glass vs bottle profit (`analytics.service.ts:389-392`);
  - margin advice (`margin-advice.service.ts:254`);
  - the reporting agent, which falls back to `custom_price` (`services/agent-orchestrator/agents/reporting_agent.py:404-409`).
- A grep of `apps/api-gateway/src`, `supabase/migrations`, `services`, `apps/web/src` and `apps/mobile/src` finds no write to it. Verified receipts do not update it.
- This is a grep result, not a production query: a trigger or out-of-repo writer would not show.

**G15. The WAC averages estimates and invoices but is labelled invoice cost. Minor.**
- `inventory_lot_rollup.wac` averages every live, non-sample, costed lot, `estimated` and provisional included (`lot_cost_truth.sql:486-500`).
- `resolveUnitCost` labels it `invoice_lot_wac` whenever **any** live bottle is invoice-costed (`inventory-cost.ts:129-147`). The `_partial` suffix only appears when some bottles carry no cost at all.

**G16. The price series stores landed cost as the vendor's price. Minor.**
- `recordPriceHistory({price: match.effectiveUnitCost ?? body.invoiceUnitPrice, source: "receipt_verified"})` (`procurement.service.ts:6879-6885`). `effectiveUnitCost` includes freight and the shortage load (G5, G7).
- Vendor price trends and "price went up" alerts therefore move on freight and shortages, not on the vendor's actual price.

**G17. The mobile match mirror leaves out charges. Minor.**
- `apps/mobile/src/lib/invoiceMatch.ts:96-98` computes `effectiveUnitCost` without `allocatedCharges`. Web (`apps/web/src/lib/invoiceMatch.ts:76`) and the server (`invoice-match.ts:750`) include them.
- The phone shows a different cost than the one that gets saved. There are three copies of the math (receipt audit G10).

**G18. Floor Checker sales do not reach depletion on main. Major.**
- No floor module exists in `apps/api-gateway/src`. `packages/floor-core` holds freshness only (`packages/floor-core/src/freshness.ts`). The port (ADRs 0345-0353) is local or in #757.
- Floor sales therefore produce no `inventory_transactions`, no `bottles_out` and no COGS.

**G19. Deposits are not tracked as money owed back. Minor.**
- Deposits are carried as a document charge (BG-21, code 7161, per `.planning/08-softwares/receipts-invoice-match.md`). They are kept out of cost, but nothing records the returnable deposit or the empties returned.
- This is right for cost and missing for cash.

### Open PR overlap
- #666: price as printed, order path only (G4 remains on the delivery path).
- #678: credit claim reason (does not address G6).
- #664 and #668: receiving.
- #656: first menu.
- #757: floor-core.
- #722, #725, #730: days-of-stock sales gate.
- Closed: #617 and #703 (ADR 0298 COGS readers, G1).

### Not verified
- Behaviour was not checked by tests or runtime. Production data was not queried.
- The bundle sizes are not measured.
- The `last_purchase_price` "no writer" finding (G14) is a grep result.
- The latest bodies of `revalue_lot` and migration `20261223060000` were not re-read line by line.
