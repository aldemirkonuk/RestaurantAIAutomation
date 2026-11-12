# Round 8 - PR re-test: landed cost (#780, #812, #787) and one pour size (#809)

Heads tested: #812 a3b168e79 (stacked on #780 45eb84336), #809 543b2404d, #787 3af82c199 (read only). origin/main 259feea3f.
Method: `git worktree add --detach` under /private/tmp/claude-501/qa-wt-812 and qa-wt-809, node_modules symlinked, both removed afterwards. Shared checkout only fetched `pull/N/head`. No comments, no merges.
Probes: `round8-probes/812-landed-cost-probe.spec.ts` (+ `812-landed-cost-results.json`), `round8-probes/809-pour-probe.mjs` (PGlite full-corpus build, superuser, platform stubbed).

## Answer to the key question

**The round-7 BLOCKER 1 (case price 264 / 12 bottles booked at 264 a bottle) is STILL OPEN.** No open PR in #770-#812 changes it. Landed cost is still pure and unwired.

- On origin/main `canonical/delivery-stock.service.ts:747-751` still does `Number(line.unit_price)` and `unitCost: price`; `:730` selects `qty_bottles, unit_price` and no price base or pack. `agreedPrices` (`:656`) feeds `finalise_delivery_cost` the raw printed price.
- `git grep landedCost|landed-cost` on origin/main: no importer (only an unrelated `analytics/engine/finance.ts:277`). On #812, `git grep landed-cost` finds no importer either; the only touched files are the module, its spec, a claim and a tech-debt note. `git diff origin/main..a3b168e79 -- procurement/canonical` is empty of the delivery-stock file.
- I listed every open PR #770-#812 and filtered file lists for `delivery-stock|landed|finalise|agreed|price.?base|lot`: only #780, #812 (the pure module) and #783 (lots kept at zero, not cost) match. #787 (`procurement.service.ts`, `shelf-received.ts`, one migration) is receipt-verify idempotency; it does not touch lot cost.
- Outside the range, #666 (open, older, mergeable UNKNOWN) "read the invoice price in the unit it is printed in" is the intended unit fix, but its files are `invoice-match.ts`, `procurement.service.ts`, web/mobile receiving; it does not touch `delivery-stock.service.ts` either. Lane 1.3/1.4 (calling `landedCost` after #666's `readInvoicePrice`) is not on any branch.

## #812 (with #780 under it): PARTIAL

Verdict on its own claim (tax basis per line, house reclaim): FIXED. Verdict on the blocker: NOT FIXED, and it cannot be: the module is not called.

Test fails without the fix: yes. With `landed-cost.ts` swapped to #780's 45eb84336, `landed-cost.spec.ts` gives 10 failed / 12 passed (22 total), including the QA-round-4 KDV case. With the fix 22/22 (also 23/23 with my probe).

Executed matrix (`landedCost`, results in the JSON; per-bottle then stamp):

| Case | Result |
|---|---|
| 2 cases at 264, total 528, caller lists 24 bottles | 22.00 net |
| 24 bottles at 22 | 22.00 net |
| 12 bottles, 142 per price base 12, no total | 11.8333 (full precision) |
| KDV 18 % inside (118 for 10), house reclaims | 10.00 net |
| KDV outside (100 for 10, 18 %), house reclaims | 10.00 net |
| Same two papers, house does not reclaim | 11.80 gross_cost, both |
| Rate printed 0 %, includes_tax, reclaims | 11.80 net (correct) |
| Rate 100 | unresolved, "not a rate" |
| Freight 10 on a 100 line, reclaim house | 11.00, stamp **null** |
| Freight 100 + discount 50 over 600/400 lines | 52.50 and 42.00 (shared by value, right), stamp **null** |
| Two lines, 8 % and 18 %, freight 10, reclaim | 10.50 and 10.50, both null |
| 12 bottles, total 4.00 | 0.33333 unrounded; x12 = 4.00; rounded to 0.33 x12 = 3.96 |
| qty 0, listed 0 | unresolved "does not say how many bottles" |
| qty 0, listed 12 | costed 0.00 net (reads as free goods) |
| qty -2, price -22, freight -5, NaN price | all unresolved with a sentence |
| accepted 0 | per bottle null, stamp net |

Findings that survive:
1. **The per-bottle seam is moved to the caller, not closed.** `pack_size` is declared (`landed-cost.ts:63`) and never read. Per-bottle = landed value / `listed_bottles`, which the caller must convert. With qty 24 bottles at price 264 per case, no base and no total, the module returns **264 a bottle** (probe `seam_qty24_bottles_price264_percase_no_base`); with `listed_bottles` = 2 cases it also returns 264. The one thing that catches it is a printed line total: qty 24 x 264 with total 528 is unresolved "does not add up". A paper with no total, or a caller that sets the base wrongly, reproduces the blocker exactly. Suggest: a pack-vs-listed_bottles cross-check when `uom` is a case and `pack_size` is set.
2. **A freight line makes the stamp null on every paper.** `landed-cost.ts:~487` hard-codes `headerStamps = [null]`; charges and discount tax are "not read yet" (follow-up `feat/landed-cost-paper-tax`, not on any open PR). So the ordinary delivered invoice (freight or fuel or discount) yields a lot cost whose `cost_tax_basis` is unknown even for a reclaiming house. The PR states this; it is why the verdict is PARTIAL.
3. **No rounding, no currency.** No rounding step or constant for `inventory_lots.unit_cost numeric(10,2)` (12 x 0.33 = 3.96 against a 4.00 paper). The word `currency` does not appear in the module; two lines in different currencies on one paper are summed without a flag (probe `mixed_currency_same_paper` returns 22 net). Round-7 H1 (lot cost carries no currency) is therefore untouched. Both are disclosed as open in the PR body (QA item 2) except currency.
4. A fully rejected line still carries its freight share (disclosed, QA item 3). `qty 0` with listed bottles is costed 0.00 rather than flagged.
5. ADR 0359 is Proposed (PR #784), not locked; `reclaims_input_tax`, `price_tax_basis` and `vat_rate_percent` are not columns, so even a wired caller has nothing to read today.

## #780: PARTIAL (context)
Pure module, as titled. Same status as #812 for the blocker: not wired, NOT FIXED. Its own `left_out` sentence was false under KDV-inclusive prices (QA round 4); #812 fixes that.

## #787: not a cost PR (context)
Receipt-verify claims its money once (H-1). Unrelated to the per-bottle seam; not executed in this round. NOT FIXED for the blocker, by design.

## #809: PARTIAL, and a REGRESSION risk is not shown, but the headline fix leaks

Claim: a house pour (confirmed) is used before 150 ml when a glass has no stated pour; house pour bounded 10..500; pour route needs a key and a 10..500 integer.

Test fails without the fix: yes.
- jest `inventory.service.spec.ts` with service/dto/controller restored to the merge base 7221901d6: 6 failed / 38 passed (no key, null key, blank key, 9 ml, 501 ml, fractional); with the branch: 54/54 across it and `stock-wrappers-refuse-foreign-items.spec.ts`.
- Web vitest `volumeUtils.test.ts` + `MeasurementSection.test.tsx`: 7/7 on the branch.
- PGlite: with the migration, an item whose `pour_size_ml` is NULL in a house that confirmed 125 pours **125**; on the control build (migration removed) it pours **150**. House CHECK `restaurants_default_pour_is_a_pour` refuses 9, 501 and NaN, accepts 10 and 500.

What fails (the important one):
- **Items that never state a pour ignore the house pour.** `restaurant_inventory.pour_size_ml` still has `DEFAULT 150` (baseline:3314; probe `column_default = 150` after the migration). The new chain is `COALESCE(p_pour_ml, ri.pour_size_ml, <confirmed house>, 150)` (migration `20270301180000`, the SELECT in the function body), so step 2 is non-NULL for any item inserted without naming the column and the house value is never reached. Probe: item inserted with no `pour_size_ml`, house confirmed 125: **pours 150**, both with and without the migration. The PR's pgtest inserts `pour_size_ml` as an explicit NULL (test setup lines "case when i = 2 then 100 else null end"), so T1 passes and hides this. Paths that omit the column: `inventory.service.ts:1076` and `:1432` (`if dto.pourSizeMl !== undefined`), and the menu seed insert (`menus.service.ts`, no `pour_size_ml`). The web add-wine modal defaults `pourSizeMl` to 150 (`AddWineToInventoryModal.tsx:99`) and sends it when glass fields show (`:194`), so those items also state 150 and win. Net: the fix only reaches items whose pour was explicitly set to NULL, which no create path does. Fix would be to backfill/NULL the default (or make the default NULL) in the same migration.
- Display and draw disagree for an unconfirmed house with a non-150 default: `inventory.service.ts:90-92` reads `default_pour_ml ?? 150` regardless of confirmation, the draw ignores it. Probe: unconfirmed 175 pours 150. Only reachable by a direct SQL write today (no writer sets it without confirmation), so low.
- A non-integer house pour (125.5) passes the CHECK and pours 126 (stored `pour_ml` integer), so the recorded pour differs from the house's stated number.
- An item's own `pour_size_ml = 9` is still accepted at the DB (no CHECK on the item unless confirmed); the 10 minimum is enforced only in the DTO.

Two glass sizes / change mid-service (PGlite, with migration): the item with its own 100 pours 100, an explicit 60 pours 60, and items with NULL follow the house. After the house moves 125 -> 175, the next NULL-item pour is 175; earlier `pour_events.pour_ml` (125) and the ledger metadata (125) are not rewritten. So history is stable. The house model is one default plus per-item overrides, which is how a house gets two sizes; there is no second house-level size.
Existing sales/recipes: POS sales pass the catalog volume as `p_pour_ml` (pos-hub), so they are unaffected; no recipe table reads the pour. No mobile or service caller of the pour route was found, so making the key required breaks no in-repo caller (the web client mints one).

## Verdicts

| PR | Verdict | Per-bottle blocker |
|---|---|---|
| #812 | PARTIAL (tax-basis claim FIXED, test red without it 10 of 22; nothing wired; freight makes stamp null; no rounding or currency) | OPEN |
| #780 | PARTIAL (pure, unwired) | OPEN |
| #787 | NOT FIXED for this blocker (unrelated; not run) | OPEN |
| #809 | PARTIAL (route checks and CHECK work, test red without; house pour unreachable for items on the column DEFAULT 150) | n/a |
| Any open PR #770-#812 fixing `agreedPrices` | none | OPEN |

Not done: #787 and #780 suites not re-run; no production read, so how many live items sit on the 150 default is unmeasured; DB behaviour is PGlite, superuser, no Supabase platform.
