# Round 9 - PR re-test: per-bottle lot cost (#816) and landed-cost paper tax (#815)

Heads: #816 46493a0fe (base origin/main 259feea3f, 2 commits), #815 0f8822b8d (stacked on #812 a3b168e79, 1 commit).
Method: `git worktree add --detach` at /private/tmp/claude-501/qa-wt-816 and qa-wt-815, node_modules symlinked, both removed afterwards (the other qa-wt-8xx worktrees belong to other sessions, untouched). Shared checkout: only `git fetch` of `pull/N/head` into temporary refs/qa/* (deleted). No checkout, merge, push or comment.
Probes: `round9-probes/816-perbottle-probe.spec.ts` (+ `816-results.json`), `round9-probes/815-paper-tax-probe.spec.ts` (+ `815-results.json`). #816 probes drive the real `DeliveryStockService.finaliseAtVerified` over the repo's own `makeMockDb`; #815 probes drive the real `landedCost`. DB behaviour was read from migration SQL, not executed (no PGlite this round).

## Answer to the key question

**BLOCKER 1 is CLOSED for the exact case I filed, and not closed for its neighbours.** Case price 264 / pack 12, uom case, with or without a total, now books 22 a bottle (probe p01, `finalise_delivery_cost.p_unit_cost = 22`), and `142 / KS(12)` books 11.83. Three routes to the same wrong number are still open: (1) a row stored as `uom bottle`, qty 24, `unit_price 264` whose paper meant per case still books 264 even when a `line_total` of 528 on the row contradicts it (p03b); (2) an accepted proposal overrides the converted invoice price and posts its raw number with no unit (p14); (3) lots already finalised at a printed price stay wrong, unflagged and uncorrected (see Backfill). Landed cost (#815/#812/#780) remains unwired, so freight, fees and discounts still never reach a lot.

## #816 - cost a delivered lot per bottle: PARTIAL (BLOCKER 1 fixed for the filed case; three residual routes open)

Test fails without the fix: **yes**. With `delivery-stock.service.ts` restored to 259feea3f and the PR's spec kept: 4 failed / 19 passed (the four B1 tests). With the PR: `src/procurement/canonical` 17 suites, 285 tests pass. The two claim verifies in `claims.d` exit 0. (I did not mutation-test the claim; my sed mutation did not apply on macOS and I did not retry.)

Where the fix is: `delivery-stock.service.ts` `agreedPrices` reads `uom, pack_size, price_base_qty, price_base_uom` (select at ~:741) and calls `perBottleLotCost` (`canonical/lot-unit-cost.ts:94-160`); `finaliseAtVerified` posts `price.unitCost` (:444).

Executed matrix (cost = what reaches `finalise_delivery_cost`):

| Case | Result |
|---|---|
| 264 per case, uom case, pack 12, no base, no total | 22, reason "264 per case of 12 = 22.0000 per bottle" |
| 22 per bottle, uom bottle | 22 as-is |
| price base missing, case line | per one case, 22 |
| price base missing, row uom **bottle**, qty 24, price 264 (paper meant per case), line_total 528 | **264** as-is (p03b). `line_total` is not selected or compared. Same with pack 1 (p03c) |
| pack_size null / undefined / 0 / 1 / -1 / "abc" on a case price | refused by name, lot stays provisional, nothing posted |
| pack_size "12" (PostgREST string), 6, 1.5 | 22, 44, 176 (1.5 cannot occur: column is integer) |
| bottle-uom line with pack_size 0 | 22 as-is (pack not needed) |
| mixed case line (item A) and bottle line (item B) on one paper | A 22, B 31.5, each on its own basis |
| same item on a case line and a bottle line | last line wins (25), no blend; disclosed fork 5 |
| magnum case of 6 at 390 / half-bottle each 9.5 / half-case of 24 at 192 | 65 / 9.5 / 8: cost per physical unit, no volume scaling, which is the lot's unit |
| KDV inclusive vs exclusive 264 | identical 22: no tax input exists on this path |
| freight line (no inventory_id, uom each, 40) beside a priced item line | item 22; freight ignored (not landed) |
| item line **unpriced** + one unattached freight line 40, one booked item | item booked at **40** as-is (p09b). The one-item fallback treats freight as the item's price. Same on main, so not a regression; the PR's "booked as-is" now words it as a bottle price |
| discount line (negative price) | skipped, item 22 |
| two unattached lines | provisional, named |
| 1 per 3 bottles / 100 per 3 / case of 7 at 100 | 0.33 (x3 = 0.99) / 33.33 (x3 = 99.99) / 14.29 (x7 = 100.03). Disclosed (fork 4); the exact figure sits in the reason; H1 widening still open |
| 0.004 per bottle | refused, rounds to 0.00 |
| 1e9 per bottle | posts 1000000000 into `numeric(10,2)`: the RPC will raise; `finaliseAtVerified` returns at the first RPC error so later items on that delivery are not finalised. Absurd input, low |
| 1e21 | refused (NaN), but the message says "rounds to NaN" |
| currency mix | no currency is selected or carried; TRY and EUR numbers post into the same column. H1 untouched |
| partial delivery, 12 ordered 6 booked | cost per bottle 22 independent of count (p12). Quantity untouched |
| credit note as document role `credit_note` | ignored; lot stays provisional with "no agreed price" |
| credit note filed as role `invoice`, negative qty, positive unit price | posts 22 (a price is a price); negative unit price skipped |
| accepted proposal at 264 on a case line | **264** posted, provenance manual, no basis (p14); PR's own open entry |
| keg per keg / keg priced per bottle / case priced per keg | 300 as-is / refused / refused |
| allowance 24, deposit 36, free goods 2 on the line | all ignored; cost stays 22 (landed cost not wired) |
| "142,00" as a comma string | `no_price` (PostgREST never sends it; not a bug) |

Backfill / flag for lots already booked wrong: **none, and none possible from this PR.** The PR changes three files in `canonical/` plus two docs, no migration, no script. The tech-debt entry says production "was not queried". Re-verify does not repair: `delivery.service.ts:907-916` returns `alreadyVerified` without calling `finaliseAtVerified`, so a lot finalised at 264 stays 264 until someone calls `revalue_lot` by hand. Nothing marks such a lot (the revaluation reason only carries a basis suffix on new rows). Candidate query is written in the tech-debt entry, not run. This is the main reason the verdict is not FIXED: every lot already in production from a case or base-priced invoice carries the error into WAC, margin, pour cost and the dashboard until revalued.

Downstream consumers: those that read `inventory_lots` / `inventory_lot_rollup` (analytics `cost-basis.ts`, `analytics.service.ts:148`, `margin-advice.service.ts:182,339`, POS depletion) now see correct numbers for lots finalised after this lands, and wrong ones for earlier lots. Consumers of the printed price directly were not touched and not fixed: the cellar ledger `inv` CTE (`20261223060000_...sql:271`, reads `l.unit_price` beside `qty_bottles` with no basis), and `vendor-comparison.service.ts:902-913` (selects `unit_price, qty, uom`, no pack or base). The legacy order-verify path (`procurement.service.ts:5443, 6680`) already uses per-bottle figures (`perBottle`, `effectiveUnitCost`), so it is not the same defect. I found no recipe-cost reader of `procurement_document_lines`.

Findings that survive:
1. **B1-residual, bottle-counted case price (p03b/p03c).** The row shape that round 8 named is still booked at 264. `lineNetFromPrice` can see it when a total is printed (24 x 264 is not 528) and `perBottleLotCost` is not given `line_total`. Cheap closure: select `line_total` and `qty` and refuse when `qty x unit_price / base` disagrees with the total beyond tolerance.
2. **Accepted proposal still posts a raw number (p14).** Open in the PR; nothing in-repo writes `unitPriceProposed` (only the API DTO and `apps/web/src/services/api/deliveries.ts:118` type it), so low reach today.
3. **No backfill, no flag, re-verify is a no-op** (above). High for any house that already has verified deliveries.
4. One-item fallback books a freight line's price as the item's cost when the item line itself has no price (p09b). Pre-existing, now labelled "as-is".
5. A per-bottle cost above `numeric(10,2)` stops finalising every later item on the delivery (loop returns on first RPC error). Low.
6. 1/3 and case-of-7 rounding drift is real money on large lots (disclosed).

Verdict **#816: PARTIAL.** Not a REGRESSION: no probe produced a worse number than main; every changed output is either the correct per-bottle figure or a named refusal that leaves the lot provisional.

## #815 - landed cost reads the tax on a paper's charges and checks its printed tax: FIXED for its own claim; does not touch BLOCKER 1

Test fails without the fix: **yes.** With `landed-cost.ts` swapped to #812's a3b168e79: 2 failed / 22 passed (the two new tests: header tax mismatch, freight with KDV inside). With the PR: 24/24. Both `claims.d` verifies exit 0.

Scope check on your phrase "checks its principal": the PR checks the paper's printed **tax** (BT-110) against the lines' rates. It does **not** check a principal, subtotal or grand total. `LandedCostHeader.subtotal` is declared (`landed-cost.ts:46`) and read nowhere; probe t17 (`subtotal 5000` against lines worth 100) is costed without complaint. `pack_size` is also declared (`:67`) and never read.

Executed matrix (house reclaims unless stated; line = 10 bottles at 10 excl. 18 %):

| Case | Result |
|---|---|
| freight 10 excl. 18 %, charges basis stated | 11.00/bottle, stamp **net** (was null) |
| freight 11.80 incl. 18 %, reclaim | 11.00, net, share 10.00 |
| same, house does not reclaim | 12.98, gross_cost |
| freight 10, charges basis null | 11.00, stamp null (honest unknown) |
| freight, basis stated, rate null | 11.00, null |
| freight, house reclaim unset | 11.00, null |
| discount 11.80 incl. 18 % | 9.00, net, share -10.00 |
| freight 10 + discount 5, excl. 18 % | 10.50, net |
| freight incl. and discount excl. on one paper | **cannot be stated**: one `charges_tax_basis` and one rate for freight, fuel, fees and discount (disclosed in tech-debt) |
| charges rate 0 incl. | 11.00, net |
| charges rate 100 / negative freight | unresolved with a sentence |
| printed tax 18.00 / 18.01 / 18.02 on one line | costed (tolerance 0.01 per part plus header) |
| printed tax 20 / 0 / 19.80 for lines that come to 18 / 18 / 16.20 | every line unresolved with "The paper prints tax of X, but its lines' rates come to Y" |
| two rates 8 % + 18 %, tax 34 correct / 35 wrong | costed / unresolved |
| two lines each a penny off | costed |
| check with a line unresolved, a line not stock, or a line rate missing | check skipped, other lines costed even with tax 999 (disclosed: only when every line is stock and costed) |
| check under a non-reclaiming house, under unset house | runs the same (unresolved at 20) |
| discount tax direction: tax 16.20 vs 19.80 | 16.20 accepted, 19.80 refused (sign handled correctly) |
| tax 18 printed on a line with allowance 10 (net 90, tax 16.20) | **unresolved** (t16). If a paper taxes the gross before allowance this is a false refusal. Not provable without papers |
| credit note (negative price, negative tax) | unresolved: "negative or not a number" (unchanged; credit notes unsupported) |

Regression read: the only behaviour changes against #812 are (a) stamp now `net`/`gross_cost` instead of null when a charge or discount is present and its basis is stated, and (b) a new unresolved outcome when the printed tax disagrees. (b) can turn a costed paper unresolved, but only where the printed tax and the stated rates disagree beyond a cent per part, which is the stated intent. I found no case where a paper that carried a null basis got worse: null basis still costs and stamps null. Residual risk is t16 (allowance basis) and the single charges basis.

Per-bottle seam through the module (BLOCKER 1 shape): `qty 24 bottles, price 264 per case, no base, no total` still returns **264** a bottle (s01), exactly as in round 8. `pack_size` is never used, and `git grep` finds no importer of `landed-cost` outside its spec and my probe. So #815 cannot close BLOCKER 1 and does not claim to; it needs a caller that converts to bottles, and none exists on any open branch.

Verdict **#815: FIXED for its own claim (paper tax read and checked); BLOCKER 1 not addressed; module still unwired, so no lot benefits yet.** Not a regression.

## Verdicts

| PR | Verdict | Fails without the fix | BLOCKER 1 |
|---|---|---|---|
| #816 | PARTIAL | yes, 4 of 23 (delivery-stock spec at 259feea3f) | closed for 264/12 case lines and price bases; open for bottle-counted case price, accepted proposals, existing lots |
| #815 | FIXED (own claim only; checks tax, not a principal) | yes, 2 of 24 (landed-cost spec at a3b168e79) | not addressed; landed cost unwired |

BLOCKER 1 overall: **closed for new deliveries whose invoice line states its price unit; not closed for lots already booked, which have no backfill and no flag.**

## Not done
- No DB execution (no PGlite or Postgres): `finalise_delivery_cost` behaviour, `numeric(10,2)` overflow and the revaluation write were read from `20260906233000_stock_at_the_door_cost_at_verified.sql:285-387`, not run.
- Production not queried; the count of lots already wrong is unmeasured.
- Claim mutation test for `QA-R7C-B1-LOT-COST-IS-PER-BOTTLE` not completed.
- `tsc --noEmit` in the worktree shows only the unrelated missing `@simplewebauthn/server` module (symlinked node_modules); I did not run a full typecheck of the PR.
- #816 touches `delivery-stock.service.ts` only; the cellar ledger and vendor-comparison readers of the printed price were identified, not executed.
