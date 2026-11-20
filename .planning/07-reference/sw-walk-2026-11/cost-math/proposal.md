# Cost math: change proposal (invoice → lot cost → margin, and table sale → depletion → cost of goods)

- **Date:** 2026-11-07. **Code read:** `origin/main` at `e26a5152d` only, through `git show` / `git grep`, plus `gh pr list/view/diff` for open PRs. Nothing in the repo was edited, staged or run. No production system was touched.
- **Inputs:** `audit.md` (G1–G19), `sota.md`, and the verified-gap verdicts. Refuted claims were dropped. Where a verdict narrowed a gap, its `corrected_claim` replaces the audit's text. Builds on `p4-scratch/sw-menu-receipts/receipt-upload-audit.md` and `proposal-receipt.md`. Their intake lanes (1.1–3.7) are not repeated here, and their Decision 12 (tax basis) and Decision 14 (deposits) are answered in §4.
- **Authority:** the founder's /goal of 2026-11-07, *"Do not ask me any questions I approve you decide them all"*. Every fork in §4 is **the session's call**. ADRs and retire-to-write are cited, but they are not treated as binding. Founder rulings found in records are followed unless §4 says why not.
- **Abbreviations:**
  - `PS` = `apps/api-gateway/src/procurement/procurement.service.ts`
  - `IM` = `apps/api-gateway/src/procurement/invoice-match.ts`
  - `DS` = `apps/api-gateway/src/procurement/canonical/delivery-stock.service.ts`
  - `AN` = `apps/api-gateway/src/analytics/analytics.service.ts`
  - `LEDGER` = `supabase/migrations/20261222100000_a_pos_sale_is_dated_by_its_check.sql`
  - `LCT` = `supabase/migrations/20260902150000_lot_cost_truth.sql`
  - `PH` = `apps/api-gateway/src/pos-hub/pos-hub.service.ts`
  - `TS` = `apps/api-gateway/src/toast/toast.service.ts`
  - `RW` = `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx`

---

## 1. Verdict

**The two halves of cost math do not meet.**
- The receive side computes a lot cost, though with the wrong unit on the delivery path (G4), with freight unapportioned (G7), with discounts ignored (G9 narrowed), and with no tax basis (G10).
- The table side moves bottles but never records what they cost. `apply_stock_movement` deletes a used-up lot (`LEDGER:228`), and every sale row's `unit_cost` is the caller's NULL (`LEDGER:236-250`; `PH:1480-1495`, `TS:683-690`). So the reports cost "what was bought", not "what sold": `AN:31`, `AN:212-224`, `cogs` at `AN:496`.

**The fix runs in three stages, server first.**
1. A **landed-cost rule** turns a paper line into the unit cost of the accepted bottles. The shortfall lives only in the claim. Charges are apportioned by value. Discounts come off. Deposits and KDV stay out.
2. **Lots are never deleted.** Every bottle or ml that leaves stamps its draw cost on the ledger, and a void puts it back at that cost.
3. **Cost of goods becomes the sum of those stamps** plus named variances (a price settled after sale, a claim written off). Margin then divides by the menu price net of KDV, under the house's tax basis.

That is **21 lanes, plus one parked behind food design**. The first 9 are server-only, and none needs a production read to start.

---

## 2. Target experience

Rules that hold on every screen:
- No confidence number reaches a person (ADR 0104 D4). Coverage is a **count** ("cost known for 41 of 44 wines sold"), never a percentage of certainty.
- Staff never see money (ADR 0104 D11; `doorEchoOf` unchanged). Waiters see no cost on any floor screen (founder 2026-10-30, Round 2: *"Waiter phone view: NOTHING for now"*).
- Tokens come from `apps/web/src/styles/mudavym.css`:
  - `--seal` (`:142`) for a final, invoice-backed cost;
  - `--warn` (`:185`) for provisional or estimated;
  - `--alarm` (`:163`) for a refusal that blocks;
  - `--ink-1..4` and `--paper-0..2` for everything else.
  - There is no green "good margin" colour: a margin is a number with words, not a traffic light.
- People pages stay simple. Only the receive desk's cost build and the report export are dense (the sketch-style memory).
- Every new or changed screen gets a before/after sketch that the session's UI judge reviews before its build PR.

### 2a. Door (staff, phone width: DoorNext / DoorFrame)
Unchanged. The count books provisional stock (ADR 0103 A1). No money is shown.

### 2b. Receive desk (owner or manager, `/inventory` receive workspace; technical, dense)
After the invoice is read, each wine on the paper shows one **cost build**, top to bottom:

| Row | Example |
|---|---|
| As printed | ₺1.704,00 / koli (12) |
| Per bottle | ₺142,00 |
| Discount on this paper | − ₺7,10 (5 % of the paper, shared by value) |
| Freight on this paper | + ₺3,40 (shared by value) |
| **Cost per bottle** | **₺138,30** · before KDV · `--warn` until verified, `--seal` after |
| Short 2 bottles | ₺284,00 asked back as a claim, not in the cost |

The desk never sums every line into one wine. When the paper has several lines and none is linked to this order's wine, it says: *"This paper has 3 lines. Which one is this wine?"* (G8). The phone receive screen shows the count verdict only. It shows no cost, because the server decides cost (G17).

### 2c. `/receipts` sheet (owner or manager)
After VERIFIED, each line gains one quiet column: *Cost per bottle ₺138,30 (before KDV)*. A line that cannot be reconciled shows *"The line does not add up: ₺1.704 × 1 minus ₺50 allowance is not the printed ₺1.680. Check it before the cost is final."* (`--alarm`).

### 2d. `/cellar` row record (owner or manager)
**Paid** keeps ADR 0301's door-checked or paper price with its label. **Cost** is added beside it: the landed, before-KDV cost of the bottles on hand. Each column has a one-line definition on hover. This keeps the founder's AW14 ruling intact while showing the number margins use.

### 2e. `/reports` (owner or manager; simple)
One card replaces "Cost of goods (365d)":

> **Sold** ₺412.800 · **What it cost** ₺131.900 · **Kept** ₺280.900 (68 %)
> Before KDV. Cost known for 41 of 44 wines sold; 3 have no invoice yet: [names].
> Changes after the sale: + ₺2.140 (2 invoices settled late) · − ₺380 (1 claim credited).

When a cost gap exists, the founder's ruling *"Withhold, say N of M"* (ADR 0298 decision 1) still holds. "What it cost" and "Kept" become a dash with the sentence, never a smaller number. Purchases move to their own line, **Bought** (ADR 0298 decision 6 naming), which feeds no ratio.

### 2f. `/recommendations` and `/menu` (margin advice)
Every margin says **"before KDV"** for a TR house with a tax basis. For a house with no basis set, it says: *"Margin needs the house's tax setting. Prices on this menu include KDV?"* That sentence links to Settings and shows no margin (G10). A glass margin waits for the house's pour size, as now (`apps/api-gateway/src/pricing/margin-to-target.ts:24-27`).

### 2g. Floor (in-SPA port, `/floor`)
No cost and no stock movement. The till's closed check marks a table Paid (founder Round 4). Stock and cost follow the till alone (§4 F8).

### 2h. What goes away
- The client-side freight total sent as `allocatedCharges` (`RW:403`, `apps/web/src/services/api/documents.ts:436-445`). The server computes it.
- The mobile cost preview (`apps/mobile/src/lib/invoiceMatch.ts:96-98`).
- Toast's separate depletion loop (`TS:503-690`, lane 4.1).
- The "Cost of goods" figure built from delivered orders (`AN:212-224`, `AN:496`).

---

## 3. Phased build plan

The rules here are the same as `proposal-receipt.md` §3:
- ≤ 15 files and ≤ 30 KB of diff per PR.
- Migrations take their version at merge and are cited by slug. The newest version on main is `20270301170000`.
- New claims go in `.planning/decisions/claims.d/<branch-slug>.jsonl`.
- `supabase/tests/` is not run by CI, so every proof that matters is a gateway jest spec, with the SQL run pasted as supplementary evidence.
- Every guard is mutation-tested. **"Fails on main"** means the named spec is red against `origin/main` and green on the branch.

### Phase 0: land what the lanes stand on (merge word plus the ADR 0090 gate)

| PR | State (gh, 2026-11-07) | Why it gates |
|---|---|---|
| **#666** price as printed | MERGEABLE, 15 files (IM, PS, both mirrors, RW) | Its `readInvoicePrice` / `pricePer` is the unit converter lanes 1.1–1.5 reuse. All of them edit IM, PS or RW |
| #664 → #678 → #682 | MERGEABLE (stacked by citation) | #678 and #682 edit `credit-ledger.ts` and PS. Lane 2.4 edits both |
| #668 paper owed | CONFLICTING | Overlaps receiving. Lands before lane 1.5 |
| #689 receive-desk test flake | MERGEABLE | Edits `ReceivingWorkspace.test.tsx`. Lands before lane 1.5 |
| #615 owner sales read net | UNKNOWN | Edits `report-export-cuttings.ts`, `rp-registers-house.tsx`, `net-sales.ts`. The sales side of every margin. Before 3.1/3.2 |
| #619, #624 | UNKNOWN / CONFLICTING | Edit AN and `report-export-cuttings.ts`. Rebase cost for 3.1/3.2 |
| #541, #543 | CONFLICTING / MERGEABLE | Edit PS. Rebase cost for 1.3 |
| **#589** ADR 0115 drinks lock (docs) | UNKNOWN | It records the founder's picks R6 (lots never deleted), R19 (record how a sale decomposed), R49 (void returns to the sale's lot), "voids return volume" (supersedes B19), R8 (cost per ml) and F11 (pour cost on price without KDV). Lanes 2.1–2.3 and 3.5 build those picks. The lanes cite the PR's verbatim rows and do not wait on its merge (§4 F5) |
| #757 floor-core score | MERGEABLE | No overlap: floor-core holds no sales (§4 F8) |

### Phase 1: receive-side math (server first)

| # | Branch | Gaps | What changes | Files | Fails on main → passes after | Depends on |
|---|---|---|---|---|---|---|
| 1.1 | `fix/delivery-cost-reads-the-printed-unit` | G4 | `agreedPrices` selects `price_base_qty`/`uom` (migration `document_lines_price_base_and_printed`) and converts with #666's `readInvoicePrice`. Several invoice lines for one item give a **quantity-weighted** price, not last-wins (`DS:749-750`). A price-0 free-goods line is skipped today (`DS:748`); now its bottles dilute the paid lines' cost | DS; `delivery-stock.service.spec.ts`; `claims.d` (3) | (a) "₺142 / KS(12)", 24 bottles → final unit cost 11.8333, not 142. (b) Lines 12 @ 10 and 6 @ 13 for one item → 11.00, not 13. (c) 12 paid @ 10 + 1 free → 9.2308 | #666 |
| 1.2 | `feat/landed-cost-one-rule` | G5, G7, G9, G19 (cost half) | A new **pure** module `procurement/landed-cost.ts` (described below this table). No wiring | new module + spec; `claims.d` (3) | New spec cases: freight 100 on lines 600/400 → 60/40. Discount 50 on the same → −30/−20. A line_total that is already net is not reduced twice. A mismatch is unresolved. Deposit and tax never reach value. Free goods dilute. **Mutation:** drop the reconcile step, and the double-allowance case fails | — |
| 1.3 | `fix/verify-receipt-costs-what-arrived` | G5, G7, G9, G16, G14 | `verifyReceipt` reads the order's linked invoice document **server-side** and costs the order's item through 1.2. `effectiveUnitCost` = landed value of the **accepted** units ÷ accepted (`IM:750-753` changes). `creditAmount` is unchanged (`IM:742-748`). Body `allocatedCharges` is ignored and logged when it differs (`PS:6444`). `recordPriceHistory` gets the vendor's net per-bottle price, not landed (`PS:6879-6885`). VERIFIED writes `restaurant_inventory.last_purchase_price` = landed per bottle (G14: no writer on main) | PS; IM; `invoice-match.spec.ts`; `verify-receipt.spec.ts`; `claims.d` (5) | (a) Billed 12 × 22, 10 accepted → lot 22.00 (not 26.40), claim 44.00. (b) One invoice, two orders, freight 100 → each order gets its value share, not 100. (c) `discount_total` 50 lowers the cost. (d) The price-history row is 22.00. (e) `last_purchase_price` is set | #666, 1.2; rebase over #678, #543 |
| 1.4 | `fix/delivery-path-uses-landed-cost` | G4, G9, §3 perf | `finaliseAtVerified` (`DS:375-446`) prices through 1.2. **One** new RPC, `finalise_delivery_costs(delivery, jsonb)`, finalises every item in **one transaction**. Today a loop makes one RPC per item, and a mid-loop failure leaves a half-final delivery | DS; spec; migration; SQL test; `claims.d` (5) | (a) A 3-item delivery where item 2's write fails → nothing final (today items before it stay final). (b) Discount and freight reach the delivery path | 1.1, 1.2 |
| 1.5 | `fix/desk-prefill-reads-its-own-line` | G8, G17 | The RW prefill takes the invoice line whose `inventory_id` is the order's item, else the only line, else none, and asks the §2b question (`RW:425-440`). It stops sending `allocatedCharges` (`RW:403`). The mobile receive screen drops its cost figure and keeps the count verdict | RW + test; `documents.ts`; `orders.ts`; mobile `invoiceMatch.ts` + test (6) | (a) A 3-line paper → `invoiceQty` is this wine's line, not the sum. (b) The payload carries no `allocatedCharges`. (c) Mobile renders no money | #666, #689, 1.3 |

**What `landed-cost.ts` (lane 1.2) computes.** It takes the document header (subtotal, `discount_total`, freight, fuel, split-case, delivery, other, `deposit_total`, tax: `baseline:4443-4451`), its lines (qty, uom, pack, price base, `unit_price`, `line_total`, `allowance`, `deposit`: `baseline:4391-4394`), the accepted bottles per line, and the house's tax basis. For each line it returns:
- the net line value;
- the discount share and charge share, both by net value;
- the landed value, and the landed cost per bottle;
- a `basis` in words;
- or `unresolved` with a sentence.

The net line value is `line_total` when the paper prints one. The allowance comes off only when `line_total` equals qty × price (the gross). The value comes from qty × price ÷ price base − allowance only when no `line_total` is printed. Any other mismatch is unresolved. Deposits and tax are never value. Free goods add bottles and no value.

### Phase 2: the cost of what leaves (SQL first)

| # | Branch | Gaps | What changes | Files | Fails on main → passes after | Depends on |
|---|---|---|---|---|---|---|
| 2.1 | `fix/lots-are-never-deleted` | G2 (precondition), R6 | `apply_stock_movement` sets a used-up lot to `qty = 0, depleted_at = now()` instead of `DELETE` (`LEDGER:228`). `inventory_lot_rollup` counts lots `WHERE qty > 0 OR open_bottle_ml > 0` (`LCT:486-506`, `live_lot_count`). Every gateway reader of `inventory_lots` that counts rows is audited with `git grep` in the PR body | migration; SQL test; `lot-rollup` gateway spec; `scripts/sql_outside_migrations.txt`; `claims.d` (5) | A lot sold to zero still exists with its `unit_cost`, and `live_lot_count` does not count it | — |
| 2.2 | `feat/a-sale-carries-its-cost` | **G2** | New table `inventory_lot_draws(txn_id → inventory_transactions, lot_id → inventory_lots, qty, open_ml, unit_cost, cost_state, cost_provenance)`, append-only. `apply_stock_movement` (negative delta, the FIFO loop at `LEDGER:221-233`) and `record_glass_pour` (each bottle opened, `LEDGER:368-381`) write one draw per lot touched. The ledger row gets `cost_total` (Σ priced draws) and `unpriced_qty`, and `unit_cost` = `cost_total` ÷ priced qty. A `p_unit_cost` sent on a negative delta is refused (22023): the lots decide | migration; SQL test; gateway spec over the RPC contract; `claims.d` (4) | (a) Sell 3 from lots 2 @ 10 and 5 @ 12 → `cost_total` 34, two draws. (b) A glass pour opening 1 bottle of a ₺20 lot → `cost_total` 20. (c) A NULL-cost lot → `unpriced_qty` 1, excluded from `cost_total` | 2.1 |
| 2.3 | `fix/a-void-returns-to-its-sale` | **G12**, G13 (void half) | A return names the sale it reverses (`p_reverses_key`). It restores qty onto that sale's drawn lots, newest draw first, at their cost, capped at what was drawn (R49). Any excess is a `cost_variances` row of kind `void_excess`. A glass void returns **ml** to the open bottle, not whole bottles: this supersedes B19 per the founder's pick *"Kegs; voids return volume"* (#589, group 5). PH passes the sale's key (`PH:1480-1495`); TS does the same (`TS:650-690`) | migration; SQL test; PH; TS; `pos-hub.void-idempotency.spec.ts`; `toast.service.spec.ts`; `claims.d` (7) | (a) Sale then void → the lot's qty and cost are restored, and no new lot exists (today a new lot at the back of FIFO with NULL cost, `LEDGER:215-219`). (b) Voiding 5 glasses returns 750 ml, not 5 bottles (`PH:1452-1457` B19). (c) A Toast glass void no longer adds bottles (`TS:650-660`) | 2.2 |
| 2.4 | `feat/late-price-reaches-sold-bottles` | **G11**, **G6** | New table `cost_variances(kind, qty, amount, inventory_id, source_order_id, delivery_id, credit_id, txn_id, occurred_at, reason)`, append-only. `revalue_lot` and `finalise_delivery_cost` also post `price_settled_after_sale` = Σ drawn qty × (new − old) for the draws of the restated lots. Today they loop only lots with qty > 0 (`20260906233000:333-341`), and PS only warns (`PS:6160-6166`). In `credit-ledger.ts`, `credited` on a **price** claim restates the order's lots plus their draws, and `written_off` on a **shortage** claim posts `claim_written_off`. `credited` stays terminal (`credit-ledger.ts:67-77`) | migration; SQL test; `credit-ledger.ts` + spec; PS; DS; `verify-receipt.spec.ts`; `claims.d` (8) | (a) An invoice verified after every bottle sold → one variance row equal to the gap (today a warning). (b) A credited overcharge lowers the remaining lots and posts a negative variance. (c) A written-off shortage posts its amount | 2.2, 1.3, #678, #682 |

### Phase 3: readers (cost of goods, labels, tax basis, per-item margin)

| # | Branch | Gaps | What changes | Files | Fails on main → passes after | Depends on |
|---|---|---|---|---|---|---|
| 3.1 | `fix/cost-of-goods-is-what-sold` | **G1**, G20 | New function `cost_of_goods(house, since)`: one jsonb, SECURITY INVOKER, `service_role` only, ADR 0298 d8's shape. It returns Σ draw cost on POS sale/return rows plus Σ variances by kind, coverage (items sold, items costed, unpriced bottles) and the two clocks. AN's financial summary reads it. `cogs` withholds "N of M" (ADR 0298 d1 ruling). The delivered-orders figure (`AN:212-224`) is renamed `deliveredPurchases` and feeds no ratio. The shelf-value "revenue" (`AN:502-506`) is renamed `shelfValueAtMenuPrice` (G20) | migration; SQL test; AN; `financial-summary` spec; `claims.d` (5) | (a) A month with a big buy and few sales → `cogs` equals the stamped cost of what sold. (b) One sold item with no cost → `cogs` null, coverage "41 of 42". (c) `marginDollars` no longer equals shelf minus stock | 2.2, 2.4; rebase over #615/#619/#624 |
| 3.2 | `fix/reports-say-what-sold-cost` | G1 (surfaces) | The §2e card, the export label (`report-export-cuttings.ts:596`), `metric-registry.ts:64-81` `computed` flags and `rp-registers-house.tsx:158-203` | 4 + tests (≤ 8) | Export prints "What sold cost (365d)" from 3.1. The registry test maps every `computed: true` to a served field | 3.1, #615 |
| 3.3 | `fix/cost-label-says-what-it-averages` | G15 | The rollup adds `final_invoice_qty`. `resolveUnitCost` says `invoice_lot_wac` only when every averaged bottle is final and invoiced, else `lot_wac_partly_estimated` (`apps/api-gateway/src/analytics/inventory-cost.ts:129-147`). The web label map gets the words | migration (view); `inventory-cost.ts` + spec; web label map + test (5) | 10 invoiced + 10 estimated bottles → `partly_estimated` (today `invoice_lot_wac`) | 2.1 |
| 3.4 | `docs/adr-house-tax-basis` | G10 | One ADR records the founder's picks of 2026-10-12 (F1 per-house basis, F2 no backfill, F3 stamp cost with its basis; memory only so far), F11 (*"Pour cost uses the price without KDV, taken from dated KDV bands"*, #589) and §4 F4 here. It answers `proposal-receipt.md` Decision 12 | ADR; README row in its own PR; `claims.d` | — (docs) | — |
| 3.5a | `feat/house-tax-basis-and-cost-stamp` | G10 | `restaurants.tax_basis` ∈ {`prices_include_kdv`, `prices_exclude_kdv`, `no_vat`, `unset`} and `reclaims_input_kdv`. `inventory_lots.cost_tax_basis` is stamped at VERIFIED by 1.2 and 1.4. No backfill (F2): lots before the switch read `unknown` | migration; SQL test; PS; DS; `landed-cost.ts`; specs; `claims.d` (≤ 9) | A TR house that reclaims gets a net lot stamped `net`. A house that does not reclaim gets net + the line's KDV share stamped `gross_cost`. US or unset houses are unchanged | 3.4, 1.3, 1.4 |
| 3.5b | `feat/margin-reads-price-before-kdv` | G10 | `kdv_rate_bands(category, valid_from, valid_to, rate)` with a sourced seed. `margin-advice.service.ts:250-258` and `margin-to-target.ts` divide by the menu price net of KDV for `prices_include_kdv` houses. An `unset` TR house gets `margin_needs_tax_basis` and no number | migration + seed; margin files + specs; web `LockedPrices.tsx` / `rec-format.ts` words (≤ 9) | A ₺1.200 KDV-inclusive bottle at 20 % with cost ₺400 → margin 60 % (today 66.7 %) | 3.5a |
| 3.6 | `feat/each-sold-item-has-its-margin` | task (b) "COGS per sold item" | The per-item reader joins `pos_item_sales` (net sales, ADR 0298 d8) to 3.1's stamped cost by item: sold, cost, kept, coverage. It feeds `/recommendations` and the `/cellar` row record | migration (function); SQL test; reader + spec (≤ 6) | An item with 3 sales costed from 2 lots → its cost equals Σ its draws | 3.1; OD-244 (§4 F12) |

### Phase 4: paths, recipes, cash

| # | Branch | Gaps | What changes | Depends on |
|---|---|---|---|---|
| 4.1 | `chore/toast-through-pos-hub` | G13 | The Toast adapter emits pos-hub lines. Its own loop is removed: today that is up to 3 reads per line (`TS:534`, `:555`, `:597`) plus an RPC, a unit fallback to bottle (`TS:547-549`) and `p_pour_ml: null` (`TS:675`). One depletion path keeps ADR 0011 volume and the batch mapping read (`PH:1181`) | 2.3 |
| 4.2 | `feat/house-serve-recipes` | G3 (beverage) | A cocktail or house serve sale explodes into ingredient draws by ml, through the house-serve tables the founder approved (#589 F1: *"In its own table with child tables. `public.cocktails` stays the reference recipe book"*). R63: no guess, so a serve with no volume queues. R81: tenths of ml land first | #589 lock, R81 lane, 2.2 |
| 4.3 | `feat/deposits-owed-back` | G19 | A per-vendor refundable deposit balance, fed by `deposit` / `deposit_total` at VERIFIED and reduced by an empties-returned act. It never enters cost | 1.2 |
| U1 | `feat/receive-desk-shows-the-cost-build` | UI | §2b, from 1.3's response (`landed` block). Browser-pane check at 1440 and 390 px | 1.3, 1.5, sketch |
| U3 | `feat/margin-before-kdv-words` | UI | §2f words on `/recommendations` and `/menu`, plus the Settings tax-basis field | 3.5b, sketch |
| U4 | `feat/cellar-shows-paid-and-cost` | UI | §2d Paid and Cost columns on the row record | 3.3, 3.6, sketch |
| — | *parked* `food-recipes` | G3 (food) | Food BOM and depletion wait for OD-219's food design and OD-113. Food is "received and counted" only (#589 group 1, *"Now, receive + count"*) | OD-219 |

**Count:** 21 build lanes (1.1–1.5, 2.1–2.4, 3.1–3.4, 3.5a, 3.5b, 3.6, 4.1–4.3, U1, U3, U4) plus one parked.

**Order:** 1.2 and 2.1 can start today. 1.1, 1.3 and 1.5 wait on #666. 2.2 → 2.3 → 2.4. 3.1 waits on 2.2 and 2.4. The UI lanes come last.

---

## 4. Forks: the session's calls

Each fork gives the call, the alternatives rejected and why, and one attempt to kill the call.

**F1. Where the cost of goods comes from.**
- **Call:** stamp the cost at the moment stock leaves a lot (2.1 + 2.2). Cost of goods = Σ stamped draws + Σ named variances (3.1). ADR 0298 keeps its rulings (withhold "N of M", net label) but changes its source.
- **Rejected:**
  - (B) ADR 0298 option 1, POS bottles out × today's `resolveUnitCost`. It prices yesterday's bottles at today's average and is null once an item sells out. ADR 0298 itself calls write-time FIFO "the long-term answer" (option 5).
  - (C) Opening + purchases − closing. Counts are sparse. This becomes the AvT cross-check later.
  - (D) Status quo: delivered purchases. It is wrong in every month that does not sell exactly what it bought.
- **Kill attempt:** it touches the hottest write path (every sale) in two functions, and it collides with the ADR 0115 lane that owns R6. On collision: 2.1 *is* R6, built to the founder's verbatim row, so there is one owner. On cost: one extra insert per lot touched (usually 1). Production held 4,197 `pos_checks` rows on 2026-11-01 (ADR 0298 migration header, `20270301170000:44-47`), so the volume is trivial. **Survived.**

**F2. Short or rejected units: in the lot cost, or only in the claim?**
- **Call:** only in the claim. The lot is costed at the billed value of the **accepted** units plus their charge share (1.3). A claim later `written_off` posts a `claim_written_off` variance (2.4).
- **Rejected:**
  - (B) Keep the provisional spread (`IM:750-753`) and restate on credit. This is the G5 verdict's "provisional, not double". But every bottle sold before the vendor pays carries an inflated cost, and the restatement then needs the sold-bottle machinery anyway.
  - (C) Spread and never restate. That is today, made permanent.
- **Kill attempt:** "the house really did pay ₺264 for 10 bottles until the credit arrives". True for cash, not for cost: the ₺44 is a receivable with its own ledger (ADR 0230), and SOTA practice treats a credit memo as a separate cost-updating event (`sota.md` §4). Write-off is the only path where cost truly rises, and it is posted, named and dated. **Survived.**

**F3. How charges and discounts are shared across lines.**
- **Call:** by net line value, over the paper's stocked lines. Deposits and tax are excluded. A line allowance comes off its own line, and a header discount is shared like a charge (1.2).
- **Rejected:**
  - (B) By quantity: a bottle of water absorbs as much freight as a magnum of Champagne.
  - (C) By volume (ml): physically truest for freight, but food and supply lines have no ml (OD-113), and it cannot be said in one sentence.
  - (D) A per-house choice: a setting nobody will set.
- **Kill attempt:** freight is physical, so value allocation overstates expensive wines. In the beverage-first scope (memory: all beverages, then foods) bottle sizes cluster, so value and volume differ little, and value keeps the markup uniform: "freight adds 2 % to every bottle on this paper". **Survived.** It is revisited if a keg or food vendor's freight dominates.

**F4. The tax basis of cost and margin.**
- **Call:** cost is stored **before KDV** when the house reclaims input KDV. When it does not, the line's KDV is added and the lot is stamped `gross_cost`. Margin divides by the menu price **net of KDV**, using dated KDV bands, for `prices_include_kdv` houses. An `unset` TR house gets no margin and one sentence. There is no backfill, and the switch date is marked (3.4, 3.5a/b).
  - This follows the founder's 2026-10-12 picks F1–F3 (memory) and #589 F11, and answers receipt Decision 12 option A (write it as an ADR).
- **Rejected:**
  - (B) Assume TR menu prices include KDV, with no setting. That is an inference the G10 verdict refused.
  - (C) Gross cost against gross price. This is wrong whenever input KDV is reclaimed.
  - (D) Backfill old lots. The founder refused it (F2).
- **Kill attempt:** "a house with no basis set loses its margin advice". It does, for the minutes it takes to answer one question, and showing a margin inflated by the KDV rate (60 % shown as 66.7 %, 3.5b's test) is worse than a dash. **Survived.**

**F5. Voids, and building on #589's unmerged rulings.**
- **Call:** a void returns to its own sale's lots at their cost, capped, with the excess as a named variance (R49). A glass void returns ml ("voids return volume", superseding ADR 0011's B19, which `PH:1452-1457` itself calls "wrong"). Lanes 2.1–2.3 cite #589's verbatim rows and do not wait for its merge.
- **Rejected:**
  - (B) Today: a new uncosted lot at the back of FIFO (`LEDGER:215-219`).
  - (C) A void queued for a person: R49's rejected option.
  - (D) Wait for #589 to merge first. That blocks the core cost fix behind a docs PR whose content is already the founder's answer.
- **Kill attempt:** "a ruling in an unmerged PR is not a decision" (CLAUDE.md §0.1). The /goal of 2026-11-07 delegates every fork to the session, and these rows are verbatim founder picks with timestamps. So the session adopts them as its own call and cites both sources. **Survived**, on the condition that each lane's PR body quotes the row it builds.

**F6. A price that settles after the bottles sold.**
- **Call:** post a dated `price_settled_after_sale` variance in the period it becomes known (2.4). Sale draws stay immutable.
- **Rejected:**
  - (B) Rewrite the old draws' cost: a report already read would change underneath its reader.
  - (C) Drop it: today's behaviour (`PS:6160-6166`).
- **Kill attempt:** month A's margin is then wrong forever. It is: it was the best number known at the time. Month B shows the correction by name, which is how an accountant's adjusting entry works. **Survived.**

**F7. The fallback cost when no lot cost exists.**
- **Call:** VERIFIED writes `last_purchase_price` as the landed cost per bottle (1.3), and `resolveUnitCost` keeps it as the second source (`inventory-cost.ts:149-153`).
- **Rejected:**
  - (B) Remove the fallback. Margin advice goes blank for every wine whose lots sold out.
  - (C) Leave it unwritten. Today it is a column that nothing in the repo writes (G14, grep only).
- **Kill attempt:** "a single last price ignores the stock on hand". It is read only when no costed lot exists, and the label says so. **Survived.**

**F8. Is Floor Checker a sales source?**
- **Call:** **No.** The till is the only source of sales, depletion and cost. Floor reads the till: a closed check marks a table Paid (founder Round 4; ADR 0347:25). A Floor "Paid" tap never moves stock.
- **Rejected:** (B) Floor taps deplete stock. Floor taps carry no items, and a house with a till would deplete twice.
- **Kill attempt:** "a house without a till gets no cost of goods". True. Such a house gets a count-based cost of goods (opening + purchases − closing) once counts are regular, the same AvT cross-check as F1(C). **Survived.** G18's premise was not established (verdict), so G18 needs no lane.

**F9. One depletion path or two.**
- **Call:** Toast is routed through pos-hub (4.1), and its loop is deleted (the delete-legacy-once goal).
- **Rejected:** (B) Fix Toast in place: a second copy of ADR 0011 to keep in step.
- **Kill attempt:** production has no Toast check (OD-244 row, read 2026-11-01), so this is low value now. Agreed: it is Phase 4. The kill fails only on priority, not on direction. **Survived.**

**F10. The cost unit.**
- **Call:** a draw stamps **money** (`cost_total`), and `unit_cost` stays per bottle on lots for these lanes. The per-ml lot cost (R8, `numeric(14,6)`) lands with the ADR 0115 format lanes, and it changes no reader of `cost_total`.
- **Rejected:** (B) Migrate lots to per-ml now. It doubles 2.1–2.2's blast radius and collides with the format lanes.
- **Kill attempt:** a glass draw from an open bottle has no per-bottle meaning. The draw records `open_ml` and the bottle's cost, and cost is stamped when a bottle is **opened**. That is ADR 0298's "glass pours as the bottles they opened", and the till's glasses are compared to it as pour variance later. **Survived.**

**F11. A multi-line paper on the order path (G8).**
- **Call:** the server costs the order's item from its own line (1.3), and the desk prefills that line only, or asks (1.5).
- **Rejected:** (B) A `lines[]` verify-receipt that verifies the whole paper in one call. That is right eventually, but it cuts across OD-125 ("stay on orders") and receipt lane 2.5 (linking).
- **Kill attempt:** the other wines on the paper still get no cost from this path. They get it when their own order is verified, or at VERIFIED on the delivery path. **Survived.**

**F12. OD-244 (which amount a POS line's price counts), needed by 3.6.**
- **Call:** (a) net for every provider, with each stored line recording its basis (`list` / `net`). Margin per item reads net sales against net cost.
- **Rejected:** (b) list price for every provider: modifiers and discounts would vanish from margin. (c) Leave it open: the first Toast, Square or Clover house decides it silently (OD-244's own warning).
- **Kill attempt:** Square and Clover adapters read list price today (OD-244). So 3.6 labels their lines `list` until an adapter change, and the margin sentence names it. **Survived** as a call. The adapter change is outside this software.

**F13. The label on the average cost.**
- **Call:** "Invoice cost" only when every averaged bottle is final and invoiced, else "partly estimated" (3.3).
- **Rejected:** (B) Exclude estimated lots from the average. Margin would then ignore half the stock.
- **Kill attempt:** none found. **Survived.**

**F14. Deposits.**
- **Call:** receipt Decision 14 option A. A per-vendor refundable balance (4.3), never in cost.
- **Rejected:** (B) Deposits into cost of goods: the money comes back. (C) Ask the accountant first: delegated, and A is reversible.
- **Kill attempt:** where intake files a 7161 deposit (`deposit_total` or `other_charges`) is unproven (G19 verdict). If it lands in `other_charges`, then charges = cost. So 1.2 reads `deposit_total` plus any line `deposit`, and its spec pins a 7161 fixture to `deposit_total`. **Survived, with that test as the guard.**

---

## 5. Integration contract

| Neighbour | What crosses | Invariants tests must hold |
|---|---|---|
| **Receipt upload / intake** (`document-intake.service.ts`) | `procurement_documents` header money, and `procurement_document_lines` with price base, `line_total`, `allowance`, `deposit` | Intake writes no cost. A line whose numbers do not reconcile never becomes a final cost (1.2 `unresolved`). Tax and deposits are never value |
| **Door / delivery** (`DS`, ADR 0103) | Provisional lots at the door, finalised at VERIFIED | Cost goes final only at VERIFIED (A1). One transaction per delivery (1.4). A case price is never a bottle price (1.1) |
| **Orders / verify** (PS, IM, `invoiceMatch` mirrors) | `effectiveUnitCost`, `creditAmount` | Accepted units carry cost. Owed units carry the claim, never both (1.3). The server computes charges, and a client value is ignored |
| **Credits** (`credit-ledger.ts`, ADR 0230) | A price credit settles → revaluation plus variance. A shortage written off → variance | `credited` stays terminal. A settled claim restates exactly once (2.4) |
| **Vendors / price history** (`recordPriceHistory`, ADR 0117) | The vendor's net price per bottle and as printed | Freight and shortage never move a vendor's price trend (1.3) |
| **Inventory / lots** (`LEDGER`, `LCT`) | Lots, draws, variances | A lot is never deleted (2.1). Every draw names its lot and cost. A NULL-cost draw is counted in `unpriced_qty`, never as 0 |
| **POS hub / Toast** (PH, TS) | Sale, glass pour and void movements, with the check's time (ADR 0281) | A void names its sale. A glass void returns ml. One depletion path (4.1) |
| **Floor Checker** (`/floor`, floor-core) | Reads closed checks to mark Paid | Never calls `apply_stock_movement` or `record_glass_pour`. Shows no cost (F8) |
| **Menu / pricing** (`margin-to-target.ts`, `margin-advice.service.ts`) | Lot cost (`resolveUnitCost`) and the menu price net of KDV | A margin is shown only when cost and price share a tax basis (3.5b). A glass waits for its pour |
| **Analytics / reports / export / MCP / agent** (AN, `report-export-cuttings.ts`, `reporting_agent.py:404-409`) | `cost_of_goods(house, since)` | A failed read is null, never ₺0 (ADR 0067). A cost gap withholds with "N of M" (ADR 0298 d1). Purchases feed no ratio. The Python agent's `custom_price` fallback is retired in 3.1 or listed in its PR as left |
| **Cellar** (ADR 0301) | Paid (paper) and Cost (landed) | The two are never merged into one column (§2d) |
| **Counts** (stock count, phone count rulings 2026-10-12) | An adjustment is a draw of kind `count` | A count shortfall is costed at the lots it removes, which is the actual side of AvT later |
| **Tax settings** | `restaurants.tax_basis`, `reclaims_input_kdv` | Unset means unknown, never a guessed default. No backfill |

---

## 6. What stays unverified

- **No test or runtime was run.** Every behaviour above is read from code at `e26a5152d`. "Fails on main" is a prediction until each lane runs its spec on main.
- **G14 (`last_purchase_price` has no writer)** is a grep of the repo. A trigger or an out-of-repo writer in production would not show.
- **Toast's idempotency key** is `toast_{sale|void}_{order.guid}_{line.guid}` (`TS:640`; `menuGuid = line.guid`, `TS:525`). If `line.guid` names the menu item rather than the selection, two selections of one item on a check book once. The DTO shape was not checked against Toast's API.
- **Whether a printed line `unit_price` is already net of its line allowance** is not shown by code (G9 verdict). 1.2's reconcile rule handles both readings and refuses the ambiguous case. Its fixtures are synthetic, not real TR papers.
- **Where intake files a 7161 deposit** (`deposit_total` or `other_charges`) was not traced (G19 verdict). 1.2's spec pins it.
- **The KDV rate bands** (3.5b) need a primary source per category and date. None was fetched here.
- **#589's rulings** (R6, R19, R49, R8, F11, "voids return volume") were read from the PR diff, not from merged records. The lanes quote them verbatim (F5).
- **The 2026-10-12 tax-basis picks** exist only in project memory until 3.4 writes the ADR.
- **The size of each lane** (≤ 15 files, ≤ 30 KB) is an estimate. 2.4 and 3.5a are the likeliest to need a split.
- **Bundle and latency effects** of the new reads were not measured. 1.4's single-transaction RPC is expected to remove an N-RPC waterfall, but no timing was taken.
- **Production row counts** for lots and checks are cited from ADR text (`20270301170000:44-47`; the OD-113 row), not queried.
