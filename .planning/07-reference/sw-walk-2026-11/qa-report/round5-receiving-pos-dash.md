# Round 5 QA: Receiving, POS Bridge, Dashboard Home

Read-only walk of `origin/main` at `c93d6115c`, extracted with `git archive` to
`/private/tmp/claude-501/scratch5/x/` (the checkout is behind). No repo edits, no dev server, no
production, no real POS. All `file:line` below are `origin/main` paths.

Judged as a receiving clerk with a driver waiting, and as a GM opening the dashboard at 7am.

Counts: **2 BLOCKER, 14 BUG, 6 HARM, 9 IMPROVE, 10 SMOOTH.**

## How this was checked

- Existing suites run in the scratch extract.
  - `receiving*` + `dashboard*`: 12 suites, 240 tests, all pass.
  - `pos-hub` + `toast`: 17 suites, 382 pass, 2 fail. Both failures are in `toast-dead-surface.spec.ts`
    and only because the scratch tree lacks `services/agent-orchestrator/api`. It is not a product defect.
  - `apps/web` vitest was not run.
- Repros are throwaway specs, not in the repo. Each prints its result.
  - `/private/tmp/claude-501/scratch5/x/apps/api-gateway/src/pos-hub/zz-qa.spec.ts` (repros A to G below)
  - `/private/tmp/claude-501/scratch5/x/apps/api-gateway/src/procurement/zz-qa.spec.ts` (repro R)
  - `/private/tmp/claude-501/scratch5/dst.ts` (DST midnights)
- Not verified: real Postgres RPC behaviour (read from migrations only), any live POS (the docs say
  SimPOS is the only live producer), and whether the websocket fires on a food-only POS sale.
- The three entry docs are dated 2026-09-01. Several claims in them predate the code (for example
  Toast "never produces a canonical check" is true of the webhook path, but a `toast` adapter exists
  in the hub too). Findings below follow the code.

## Scenario sweep

| # | Scenario | Verdict |
|---|---|---|
| 1 | Short delivery (truck 1 of 2, driver waiting) | Door flow is good: running total from events, "14 of 16", suggested outcome `short` (SMOOTH-1). Once truck 1 is bottle-counted, truck 2 vanishes from the unverified list (REC-1). |
| 2 | Damaged case | Photo promised, no photo control (REC-3). No credit draft (REC-5). Damage counted in whole boxes (REC-5). |
| 3 | Wrong item | `refused` plus `wrong_wine` reason works and books nothing (SMOOTH-2). Only whole-delivery refusal exists. |
| 4 | Delivery after close / phone offline | Outbox parks, retries, dates by tap time within 72h (SMOOTH-3, SMOOTH-4). |
| 5 | Delivery for a cancelled or completed order | Stock booked, order refused the status, caller is told nothing (REC-2). |
| 6 | Legacy order with no bottles_total | Case count booked as bottles, with a success message (REC-6). |
| 7 | One-tap "delivered", then door count lower | "stock would go negative" gives a 503 that retries forever (REC-4). |
| 8 | POS item unmapped | Queued, but nothing ever replays or closes it (POS-2). |
| 9 | POS void | Generic path reverses stock. Toast, Square and Clover adapters never read void (POS-1). Glass void returns a whole bottle (POS-9). Void with no sale adds stock (POS-4). |
| 10 | POS refund / comp | Not representable in `CanonicalCheck`. Square returns ignored (POS-1, POS-10). |
| 11 | Split check | Each split is its own check, which is fine. Nothing links parent and child, so there is no double-count guard. Not provable either way here. |
| 12 | Tip | Stored beside the total, not in `subtotal`. Square `subtotal` includes the tip (POS-10). |
| 13 | Tax-inclusive price (Turkey) | No tax field exists, so "net sales" cannot be ex-VAT (POS-10). |
| 14 | POS sync gap overnight | Trailing days show unknown (SMOOTH-8). A mid-month gap shows measured zero (DASH-4). `getStatus` has no staleness signal (POS-13). |
| 15 | Duplicate webhook | Stock is idempotent (SMOOTH-5). Replaying a sale after its void un-voids revenue and not stock (POS-3). |
| 16 | Clock skew | Future `closed_at` clamped to now. Phone clock handled by `fact-time` (SMOOTH-4). Zone-less strings use the gateway's zone, not the house's (POS-6). |
| 17 | Dashboard number vs drill-down | Day panel says "Showing X of Y" (SMOOTH-9). KPI "today" and calendar "today" can use different zones (DASH-2). KPI tiles stop being right past 1000 orders (DASH-1). |
| 18 | Today vs yesterday at midnight / DST | NY, London, Istanbul, Sydney correct (SMOOTH-7). Page left open overnight shows yesterday (DASH-3). |
| 19 | Empty house | Unset zone gives null and "unknown", not 0 (SMOOTH-8). Stats fall back to UTC instead (DASH-2). |
| 20 | 10k checks | Calendar keyset-pages `pos_checks` correctly (SMOOTH-10). KPI `getStats` does not page (DASH-1). |
| 21 | Waiter sees own money line only | Not on these surfaces. Dashboard staff get counts only, `/summary` is 403, stats and calendar null the money (SMOOTH-6). Any "own money line" lives elsewhere and was not walked. |

## BLOCKER

**POS-1. Void and refund are invisible to the Toast, Square and Clover adapters.**
`apps/api-gateway/src/pos-hub/pos-adapters.ts`: only `genericAdapter` sets `voided` (`:98`). Toast
(`:232-259`), Square (`:128-170`) and Clover (`:176-225`) never do. `pos-hub.service.ts:1086` then
stores `voided: false`, and `:1327` only reverses stock when `check.voided === true`.
Repro F: a Toast check with `voided: true` and a closed date, 2 bottles. Stock goes 12 to 10 and the
stored row has `voided=false`, so it also counts as revenue. Repro G: a Square order with `returns[]`
leaves stock at 10 and the refunded sale in net sales. The GM's "sales" and "stock" are both wrong
for the first real house on any of these three POSes.
Fix direction: map each provider's void, cancel and return fields to `voided` and a refund line.

**POS-2. The unresolved-line queue is write-only: mapping an item later never heals stock.**
`pos-hub.service.ts:1598-1637` inserts to `pos_unresolved_lines`. Nothing in `apps/api-gateway/src`
ever updates `resolved`. The only matches for `resolved_at` are the catalog-matcher proposal rows
(`catalog-matcher.service.ts:453,513`). The controller only reads it (`pos-hub.controller.ts:374`).
Repro: ring 3 days of an unmapped wine, then map it. The 3 days of pours stay off the ledger, the
queue row stays open, and the partial unique index swallows later duplicates as 23505, which is
counted as "queued". Stock reads high permanently; the shrinkage will look like theft.
Why BLOCKER: this is the documented path for 92 existing mappings with a null `sale_unit`. Reclassify
if the founder has decided backfill is out of scope.

## BUG

**POS-3. Replaying a sale after its void un-voids the revenue but not the stock.** Repro A:
sale, void, sale-replay gives stock 12 (correct, returned) and `voided` flags `[false, true, false]`.
`pos-hub.service.ts:1086` writes `voided: check.voided === true` on every upsert, so a late retry of
the original webhook flips the check back to revenue. `D5` made the stock side idempotent; the row
side is not. The HMAC has no timestamp, so a captured payload can be replayed forever (POS-12).

**POS-4. A void for a check whose sale was never ingested adds phantom stock.** Repro B: void-only
check, 2 bottles gives stock 12 to 14. `:1477-1496` returns `qty` to stock with no test that the sale
key exists. A lost or out-of-order sale webhook turns the later void into free bottles.

**POS-5. Line index is in the depletion key, so a re-sent edited check double-depletes.**
`pos-hub.service.ts:1425`: `pos:{source}:{check}:{item}:{lineNo}`. Repro C: check A(2) at line 0,
re-sent as [B(1), A(2)] goes 12 to 7 (should be 9). Any till that re-sends a changed check (an item
added after close, a merge) shifts indices.

**POS-6. A zone-less `closed_at` is read in the gateway's zone, not the house's.**
`pos-hub.service.ts:149-151,195`. Repro E: `2026-11-06 23:30:00` was stored as `2026-11-07T04:30Z` on
this Eastern machine. On a UTC gateway an Antalya 23:30 sale lands at 02:30 local the next day, so it
is filed on the wrong business day on the calendar and in stock dating. The ADR 0281 comment says this
is deliberate for gateway/database consistency; it does not choose the house zone.

**POS-7. Toast webhook path loses depletion permanently on any stock failure.**
`toast.service.ts:464-491` inserts the `events` row first, then `applyOrderSaleEffects`. RPC failures
are only logged (`:695-706`). A Toast redelivery of the same `eventId` hits 23505 at `:480` and
returns, so the failed or crashed depletion is never retried, and the 200 tells Toast all is well.

**POS-8. Toast webhook path under-depletes and defaults the unit to a bottle.**
`toast.service.ts:640`: key is `toast_sale_{order}_{menuGuid}`, so a second selection of the same
item on one order, or an item added after `order.paid`, is deduped away. `:638` is
`saleUnit ?? "bottle"`, the exact fallback ADR 0011 removed from pos-hub. The glass path passes
`p_pour_ml: null` and no `p_occurred_at` (`:672-680`).

**REC-1. Second truck vanishes from the unverified list; the count shown is gross.**
`receiving.service.ts:1058-1059` sets `verified=true` for the whole order on any `bottle_count` or
`reconciled` event. `:1049-1054` keeps only the latest `case_count` and uses `counted_qty_bottles`
with no rejected subtracted. Repro R: PO-1 (truck 1 bottle-counted 48h ago, truck 2 with 72 bottles
2h ago) is absent. PO-2 (72 counted, 24 refused) is listed as 72. Truck 2's stock is on the shelf
(estimated cost) and nobody is asked to verify it.

**REC-2. A door receipt against a cancelled or completed order books stock and says nothing.**
`receiving.service.ts:655-678`: a class-23 refusal of `PARTIALLY_RECEIVED` is logged, `statusWritten`
goes false, `delivered_at` is skipped, but the result (`:747-760`) has no field for it. The order is
excluded from the unverified list (`:1093`), so the manager never sees the stock that was booked.
Reachable by a vendor shipping a cancelled order, or truck 2 arriving after the desk completed the
order (`COMPLETED>PARTIALLY_RECEIVED` is not an allowed transition, migration
`20260905230000_an_order_changes_state_by_the_table.sql`).

**REC-3. The door tells the clerk to photograph damage; there is no way to.**
`DoorNext.tsx:700-704` shows "Photograph the damage if you can". The only photo control uploads the
paperwork (`documentId`). `damagePhotoPath` is declared in `services/api/receiving.ts:42` and never
sent, and the server stores a null (`receiving.service.ts:364`). The vendor scorecard reads
`damage_photo_path` (`vendor-scorecard.service.ts:382`), so every damage claim is "unphotographed".

**REC-4. A lower door count after a one-tap delivery can wedge in the outbox forever.**
First door receipt books `accepted - alreadyBookedElsewhere` (`receiving.service.ts:504`). If the
shelf was already sold down, `apply_stock_movement` raises "stock would go negative"
(`20261222100000_a_pos_sale_is_dated_by_its_check.sql:213-214`). The service turns any RPC error
into a 503 (`:602-636`), which `doorOutbox` treats as transient. The receipt retries forever and the
clerk sees "saved on this phone".

**DASH-1. KPI `getStats` reads every order and every inventory row with no paging.**
`dashboard.service.ts:1174-1189` (`procurement_orders`, `restaurant_inventory`) has no range, order or
loop, and `supabase/config.toml:18` has `max_rows = 1000`. Past 1000 orders the page silently gets an
arbitrary 1000, so today, week and month spend, `pendingOrders` and the delivery counts are wrong while
the calendar (keyset-paged by `readAll`) is right. Same for a cellar over 1000 active SKUs
(`totalWines`, `totalBottles`). Repro: seed 1,200 orders, `GET /dashboard/stats/:id`.

**DASH-2. KPI tiles and calendar bucket "today" in different zones.**
`dashboard.service.ts:539` `houseZone` falls back to `"UTC"`; the calendar uses `houseFrame`
(`:1161`: house zone, else the country's only zone, else null). Repro: `timezone` null and country
Turkey, an order delivered `2026-11-06T22:30Z`. The calendar files it on 7 Nov Istanbul, the tile on
6 Nov. With neither set the calendar says "zone unset" while the tiles show UTC figures. The web page
takes its zone from `stats.timezone` (`useDashboardNextData.ts:211`), so the page "zone" is UTC.

**DASH-3. The page's clock is frozen at mount.**
`DashboardNext.tsx:99`: `const now = useMemo(() => new Date(), [])`. A wall display left open past
midnight keeps yesterday's date line and "Good evening" at 7am while the numbers refetch every
5 minutes (`useDashboardNextData.ts:263`).

**DASH-4. A POS feed outage mid-month reads as a measured zero day.**
`dashboard.service.ts:1071-1085` and `readMonthTakings:432-501`: days between the first and last
check are "counted", and a day with no checks inside that span is `0`, not unknown. If the bridge is
down on Tuesday, Tuesday shows 0 net sales and 0 checks, and nothing else says the register was
silent.

## HARM

**REC-5. Accepted-with-breakage opens no claim, and damage can only be entered in whole boxes.**
`DoorModel.ts:431` `creditDraft` returns null for `accepted`; `doorFacts:574` sends `broken` in boxes.
Nothing in `recordDoorReceipt` creates a `procurement_credits` row. One cracked bottle in a 12-case is
entered as 1 box, which removes 12 bottles from live stock (11 sellable) and asks the vendor for 12.
`matchLine(counted)` uses the gross count, so it reads "even".

**REC-6. Pack size silently becomes 1 for orders without a pack ratio.**
The door always sends `countedUom: 'case'` and no `packSize` (`DoorNext.tsx:449-468`).
`resolvePackSize` (`receiving.service.ts:1400-1412`) falls back to 1 and `unit_type` is selected
(`:274`) but never used. A legacy order of 5 cases with `bottles_total` null or equal to `quantity`
books 5 bottles, and returns `stockBooked: true`. The comment says under-count is the safe error; it
is still silent and no one is told.

**POS-9. A glass void returns a whole bottle (B19, OD-67, known).**
`pos-hub.service.ts:1452-1458,1480`. Voiding 1 glass of a 150 ml pour returns 1 x 750 ml. Left open
by decision; repeated here because it inflates stock by 5x per voided glass.

**POS-10. Net sales basis and missing fields.**
`CanonicalCheck` (`pos-types.ts`) has no tax, discount, comp or refund field. Square
`subtotal = net_amounts.total_money` (`pos-adapters.ts:153`), which includes tax and tip in Square's
model (repro G: subtotal equals total, tip also 20). The calendar's "net sales" sums `subtotal`
(`dashboard.service.ts:255-299`). A tax-inclusive house (Turkey) cannot get a net-of-VAT number from
any adapter.

**DASH-5. Open or never-closed checks count as net sales.**
`houseDayOf` falls back to `opened_at` (`dashboard.service.ts:313-330`). `readMonthTakings` filters
only `voided=false`. A check that never closes (lost close webhook, test check) is revenue forever
on its opening day.

**REC-7. The manager queue truncates without saying so.**
`receiving.service.ts:1222` `.limit(100)` on discrepancy orders, `:1231` `.limit(200)` on open claims
with no ordering. No `capped` flag (the sibling reads have one), so `totalAtRisk` is a floor shown as
a total.

## IMPROVE

- **REC-8.** No server plausibility check on the count: `DoorReceiptDto.countedQty` is `@Min(0)` only
  (`receiving.controller.ts:66-69`), so 120 for 12 books 1,440 bottles at once. `rejected > counted`
  is stored as sent (`receiving.service.ts:328-336,492`).
- **REC-9.** The fallback idempotency key includes `new Date().toISOString()` (`:346-350`). A caller
  without a key that retries after a timeout books twice. The web door always sends a key.
- **POS-11.** `Math.round(qty)` (`pos-hub.service.ts:1367`): 0.4 is dropped as "not stock" with no
  queue entry, 0.5 rounds up to 1 (repro D).
- **POS-12.** Webhook HMAC signs the body only, no timestamp or nonce (`pos-hub.controller.ts:79-110`).
  Combined with POS-3, a replay is not harmless.
- **POS-13.** `getStatus` returns the latest `opened_at` per source and counts but no "silent for N
  hours" signal (`pos-hub.service.ts:1964-2007`).
- **DASH-6.** The month ledger is cached per mount and only refreshed by `ws:dashboard-invalidate`
  (`useDashboardNextData.ts:395-406`). Wine depletion triggers stock events; a food-only check may
  not, so "today's" net sales can sit stale. Needs a live check.
- **DASH-7.** The approvals queue awaits `orderUnderTest` per row in sequence when any rule is on
  (`procurement.service.ts:7188`), which is the first thing the dashboard fetches.
- **DASH-8.** `getSalesChart` (`dashboard.service.ts:1524`) groups by UTC date strings over rolling
  windows, ignores an orders-read error (`:1587-1592`), and is not called by any page on main.
  Dead, but a trap for whoever wires it.
- **DASH-9.** `localMidnight` for a zone whose DST gap is at 00:00 (Havana, 2026-03-08) returns an
  instant that is still the previous local day (`dst.ts`). Affects only month starts on that date.

## SMOOTH (checked, holds up)

1. Running total from `procurement_receipt_events`, "14 of 16 with the earlier 8", never rounded;
   unit fail-closed (`unknown_counted_uom`) rather than guessing 12x (`receiving.service.ts:298-312`).
2. Whole-delivery refusal with a reason books zero and records the signature and driver
   (`DoorModel.ts:574`).
3. Door outbox parks permanent refusals rather than deleting, retries 401/408/429/5xx
   (`doorOutbox.ts:364-367,588-600`).
4. Time is decided once (`fact-time.ts:84-128`): future taps clamp, 72h rule, retries reuse the stored
   time, `delivered_at` only moves forward (`receiving.service.ts:687-704`).
5. Stock writes are idempotent on a derived key, and the void has its own key (`:1425,1484`; spec
   `pos-hub.void-idempotency.spec.ts`).
6. Staff see no money on the dashboard: `/summary` and `/sales-chart` 403, stats and calendar null the
   spend (`amounts-for-role.ts:44-68`); the queue and history routes are owner/manager only
   (`receiving.controller.ts:364-366,387-389`).
7. DST: New York, London, Istanbul, Sydney and Lord Howe midnights resolve to the right local date
   (`dst.ts` output).
8. An unset zone or an unread register gives null and "unknown", not 0; trailing days after the last
   check are unknown (`dashboard.service.ts:1076-1085`).
9. Day panel states "Showing X of the day's N deliveries" instead of silently truncating
   (`DayDetail.tsx:405-408`).
10. The calendar pages `pos_checks` and orders by id (`providers/vendor-menu-supply.ts:126-155`), so
    10k checks is about 10 sequential reads, not a truncated month; foreign inventory ids are queued,
    not poured (`pos-hub.service.ts:1389-1398`).

## Suggested order

1. POS-1 and POS-3/4/5 together (one change to how a check's state and lines are keyed).
2. POS-2 (replay or close on mapping), then POS-6.
3. DASH-1 and DASH-2 (same service file, small, high visibility at 7am).
4. REC-1, REC-2, REC-3, REC-5.
