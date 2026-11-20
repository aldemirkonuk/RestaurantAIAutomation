# Round 19 - adversarial re-test of the landed-cost fix PRs (#908 #909 #911 #912 #913)

Date 2026-11-07. Method: `gh pr view/diff` read-only; one throwaway `git worktree add --detach` at `/private/tmp/claude-501/qa-wt-r19-21`
(stack head), node_modules symlinked, a second one (`-22`) only for the #845 integration run; both removed. Nothing checked out, merged, pushed
or commented in the shared checkout. Probes and raw outputs: `round19-probes-landed/` (sibling folder). Priors: `round15-test-landed-cost.md`,
`round17-pr-retest-cost-auth.md`.

Stack heads read: #909 `c337c21c9`, #911 `6cb4f2f44`, #912 `7e5d66d53`, #913 `93fc60c48`, #908 `633918d9e`. **#908's branch is stale against
#913**: it was cut from #913's older commit `36b72cdd9`, so at #908's own head `paper-landed-cost.spec.ts:336` fails (its two-currency case books 10
bottles against 20 listed). #913's later commit `93fc60c48` fixes that spec. I tested the merge of both (`7aac6d859`): 21 suites, 401 tests green
(`stackhead-procurement.raw`). Merge order is harmless, but #908 needs a rebase onto #913 before it can be green alone.

## Verdicts

| PR | Verdict | Without its source, its own tests |
|---|---|---|
| #908 tests pin wiring and cost note | FIXED | Each of 11 wiring/note mutations (M1-M11) turns >=1 of the two new specs red. |
| #909 landed lot cost keeps six places | FIXED (storage) | SQL tests red without the migration (2 of 2). Integration hazard with #845, below. |
| #911 landed cents add back to the invoice exactly | FIXED | 13 tests red across 4 suites with `landed-cost.ts` + `paper-landed-cost.ts` reverted. |
| #912 re-verify finishes a partial cost post | FIXED, one narrow overclaim | 7 red (4 in the new stock describe, 3 in delivery specs). |
| #913 foreign-money invoice never costed as the house's | PARTIAL | 11 red. Gap: house currency not named. |

Counts: FIXED 4, PARTIAL 1, NOT FIXED 0, REGRESSION 0.

## #911 FIXED - cents add back

- Property test `shareByLargestRemainder` (`landed-cost.ts:196-215`): 199,896 random trials (1..200 parts, zero weights, totals to 50k): every case sums to
  the cent exactly, no part is more than one cent from its exact share, zero-weight parts get 0. `floor(e + 1e-9)` (`:204`) never made floors exceed the
  total (400k trials, `floorHazard []`). Weird inputs: 1.005 -> 1.00 (half a cent lost, irrelevant to 2-place money), negative total shares as negative cents,
  NaN returns NaN (unreachable: `landedCost` refuses a non-number charge first, "negative or not a number").
- Allocation of freight, fuel, other, split-case, delivery fee and discount across n = 1, 2, 3, 7, 10, 25, 50, 100, 150, 200 lines, 40 random papers each:
  **0 of 2,000 runs off by a cent** (`alloc-results.json`, `sweepOff []`). Through `finaliseAtVerified` with the mock DB: n up to 200, charges only: 105/105 exact.
- Penny distribution is deterministic: identical input -> identical output; ties go to the earlier part. It is **order-dependent**: the same three equal lines give
  0.34/0.33/0.33 in order and 0.33/0.33/0.34 reversed (`determinism`). `landDelivery` follows array order, not `line_no`; the service orders by `line_no`
  (`delivery-stock.service.ts` `.order("line_no")`), so in practice stable. Re-numbering lines on a re-verify would move a penny.
- Negative / zero lines: a zero-quantity line, a negative-quantity (return) line, and a free line each hold or split as before. A zero-qty or credit line
  holds **every** item on that paper by name (`"Line 2 could not be priced, so this paper's charges ... cannot be shared out"`). Safe, but one credit line blocks
  the whole paper. Free line (1 free @ 0) holds only itself; its neighbour takes the whole freight share. Negative freight holds the whole paper (as round 15).
- Allowance, deposit: with allowance / deposit >= 0.05 and never both on one line, 100% exact up to 200 lines (`svc-results-sep5.json`).
  **Residual +-1 or 2 cents** (200 lines: 5 of 15 papers) when a line's allowance or deposit is 0.01, or the two on one line are within a cent of each other:
  `landed-cost.ts:288` accepts a total within `0.01 + |qty| x 0.00005` of a reading, so the first (wrong) reading wins and the net moves a cent. This is #886's reading
  tolerance, not #911's sharing; the shares themselves add back exactly (`dbg-results.json` shows net 1163.09 vs true 1163.08 on a 2.98 / 2.99 pair).
- Six places: `toLandedPrecision` (`paper-landed-cost.ts:156`) rounds half away from zero at 6 places; 10.0049 stays 10.0049, 120/13 -> 9.230769,
  9.9999995e7 rounds to 1e8 (overflows numeric(14,6); needs a 100-million-a-bottle cost, unreachable). `Math.round(unitCost x bottles x 100) !== valueCents`
  (`:654`) holds an item whose bottles cannot carry the cent: 30,000 @ 1.00 + 0.01 freight and 100,000 @ 0.05 + 0.03 are held with a sentence; 5,000 random
  papers of 1..400 bottles: 0 holds. A grams/ml item (G24) in the tens of thousands would hit it, and then reads "provisional by name", not wrong money.
- Mutations: drop leftover cents (X9) -> 5 red; six -> two places (X8) -> 9 red; remove the cent check (X10) -> 1 red; revert both source files -> 13 red.

## #909 FIXED (storage), with an integration hazard

- Migration `20270302143700_a_lot_cost_keeps_small_units.sql:123-124`. PGlite on all migrations: with it `inventory_lots.unit_cost` and `inventory_transactions.unit_cost`
  are numeric(14,6); a landed 10.0049 x 1000 is kept (`10.004900`), a repeat finalise is a no-op, **one** revaluation row, `inventory_lot_rollup.wac` reads `10.004900`.
  Without it: lot `10.00`, the second finalise re-writes (2 revaluation rows), wac `10.00` (`pglite-with.out` vs `pglite-without909.out`).
- Its two SQL tests: PASS with the migration, FAIL without (`T1 inventory_lots.unit_cost is numeric(10,2)`; `L1 the lot kept 10.00 ... (the freight vanished)`) -
  `sqltests.out`. 7-place input is rounded to storage and the second post of the rounded value is idempotent; 123,456,789 overflows (22003) as expected.
- Tenant: `finalise_delivery_cost(H1 delivery, H2 item)` matches 0 lots and writes nothing.
- **Hazard (not these five PRs, but the merged result is wrong):** merging #845 (open, `23d577345`) on top is a clean git merge, yet its later-dated migration
  `20270410100700_a_sale_carries_its_cost.sql` recreates the lot views with `round(..., 2)` (`:282`, `:297`) and adds `inventory_lot_draws.unit_cost numeric(10,2)` (`:42`)
  and `inventory_transactions.cost_total numeric(12,2)` (`:116`). Result on the combined tree (`pglite-with-845.out`): `inventory_lot_rollup.wac` is `10.00` again, every one-bottle sale
  is stamped `cost_total 10.00` (200 single sales = 2000.00 vs 2000.98; 13 sales of 9.230769 = 119.99 vs 120.00), so a freight share of 0.0049 a bottle never reaches
  COGS when bottles go out one at a time. The six-place lot is right; the cost of goods sold is rounded per draw. #857 / #858 (open) are the view/display fixes; #845's stamp has no six-place fix.

## #912 FIXED (finding 4), one narrow overclaim

- `finishProvisional` (`delivery-stock.service.ts:572`) selects live lots of this delivery with `cost_state = provisional` (`:586`, plus the JS re-filter and `qty > 0` at `:592`),
  and `finaliseAtVerified(..., only)` skips others (`:520`). `delivery.service.ts:914` calls it on a re-verify.
- Partial failure with 3 and with 25 lines (item 2 fails, then item n fails): the first pass stops at the first failure (1 lot final); re-verify posts exactly the
  other 2 / 24 items, never re-posts the one already final or a hand-set one (`postedFinalLotAgain false`), the second re-verify makes **0** RPC calls (`svc-results.json` S2).
  End to end through `DeliveryService.verify` (`e2e-results.json` E1): first note "...verifying the delivery again posts the cost of every item still provisional, once";
  re-verify 1 posts B once at 42; re-verify 2 posts nothing. The false "safe to retry" claim from round 15 is gone.
- Concurrent re-verify, real Postgres 17 (own throwaway container, removed), six-place cost, three sessions, one holding the row lock (`conc-result.txt`):
  same cost -> exactly **1** lot finalised, 2 no-ops, **1** revaluation row; changed cost (10.0049 then 10.0050) -> two rows, last writer wins (as round 15; no guard exists).
  At the service layer both concurrent re-verifies issue the RPC (2 calls) and both say "Cost posted now for 1 item(s)" (E3) - the RPC is idempotent, the sentence is not.
- **Overclaim:** the claim "a final or hand-revalued lot is never overwritten" holds per item, not per lot. `finalise_delivery_cost` rewrites every live lot of (item, delivery) with
  qty > 0 whatever its provenance (migration `20260906233000_stock_at_the_door_cost_at_verified.sql:335-348`), and `finishProvisional` selects at item level. Probe `mixedlots.out`: two lots at 55
  and one hand-set to 70 manual/final, plus a late 3-bottle recount in the same delivery (provisional) -> the re-verify re-posts 55 and **overwrites the 70** (3 revaluation rows). Needs a
  late booking after verify; pre-existing RPC behaviour, the PR's sentence is too strong.
- **Words gap:** `delivery.service.ts:920-921` reports only `finalised.length`; `stillProvisional` is ignored. A re-verify where an item stays provisional (EUR paper, USD house, E2) answers
  just "This delivery was already verified; a cost already posted is not posted twice." - it never says an item still has no cost.
- Revert `delivery-stock.service.ts` + `delivery.service.ts` to #911's: 7 red. `only` filter dropped (X6) -> 1 red; `finishProvisional` call removed (X7) -> 1 red (a mocked delivery spec);
  sold-out lots allowed (X5) -> 1 red. Dropping the `cost_state` filter (X4) gives 0 red but is an equivalent mutant (the JS filter repeats it).

## #913 PARTIAL - foreign money

Works (`svc-results.json` S3, 15 cases; 5 paper-level specs):
- EUR paper in USD house, TRY in USD, missing / empty currency in a USD house: posted nothing, item stays provisional with the sentence "its invoice is in EUR and this house keeps its
  costs in USD; no exchange rate is recorded, so a cost in EUR is not booked as USD" (`paper-landed-cost.ts:180-194`). Case-insensitive match (`usd`, ` USD `) costs normally.
- One item on a USD and a EUR paper: held ("costs in different currencies are never added together", `:623`). An accepted proposal on a EUR line: held with its own sentence
  (`delivery-stock.service.ts:1139`). Line-only fallback and the re-verify repair path never cost a foreign line (`:1088`; repair EUR-in-TRY: flagged, 0 posts).
- Unreadable house currency read: a 500 naming it, nothing posted (`:1018`). No exchange-rate table is read on this path; the only rate in the schema is the auction-lot carry
  (`20261116100900_...`), so "rate absent -> refused with a sentence" is the only branch.
- Tenant: every read in `agreedPrices` / `finishProvisional` carries the tenant (`restaurant_id` on documents, lines, lots; `id` on `restaurants`); a foreign delivery is 404 for both
  `finaliseAtVerified` and `finishProvisional`, 0 RPCs (S4). But see the spec gap below.
- Revert the source: 11 red. Bypass the guard (X1) 5 red; stop passing `houseCurrency` (X2) 2 red; drop the proposal check (X3) 1 red.

Gaps:
1. **A house with no currency named (NULL) still costs a foreign paper as its own.** EUR paper, house NULL: posted 62, `Costed in EUR, the invoice's currency` appears only in the ledger reason text
   (`paper-landed-cost.ts:686`). `unit_cost` carries no currency and is "read everywhere as the house's own money" (round 15 / founder 2026-09-21). Same for an invalid house value
   (`'tl'` -> treated as not named, posted) and for a paper with no currency in a NULL house. Since `20260905120000_a_house_names_its_money.sql` removed the default, a new house is NULL until a person
   answers, so this path is live. Rule 3 of that migration says a reader "refuses in words"; here it costs.
2. Real spellings are held, not converted: `TL`, `₺`, `US$` in a TRY / USD house are refused as "not a currency code" (safe, but a Turkish paper that writes TL in a TRY house can never be costed until intake normalises).
3. Second paper in the same delivery in the same foreign currency in a NULL house: costed in that currency (single-currency pooling), same as gap 1.

## #908 FIXED - tests fail when the code is reverted

Mutation per seam on the stack head, run over all 21 procurement suites (`mutation-results.txt`):

| Mutation | red | red in #908 specs |
|---|---|---|
| M1 landed price not wired | 35 | 7 |
| M2 held reasons not merged | 17 | 4 |
| M3 header select loses charge columns | 1 | 1 |
| M4 unreadable header swallowed | 2 | 1 |
| M5 booked not given to `landDelivery` | 34 | 6 |
| M6 repair ignores the printed case price | 8 | 3 |
| M7 repair has no line-only fallback | 2 | 1 |
| M8 basis not in ledger reason | 5 | 1 |
| M9 left-out sentence dropped | 4 | 3 |
| M10 tax sentence dropped | 2 | 1 |
| M11 repaired-landed sentence dropped | 2 | 1 |

All eleven fail at least one of its own tests; round 15's "only 1 of 94 fails without it" is no longer true. Remaining spec blindness (not PR defects): the mock DB ignores `.eq` filters, so
removing the tenant filter on the lots read (X11) or on the `restaurants` currency read `.eq("id", restaurantId)` (X12, `delivery-stock.service.ts:1018` region) turns **no** test red. I confirmed
the filters exist by spying on the chain (S4), but nothing would catch their removal; X12 would read another house's currency.

## What I did not do

No real Supabase roles/RLS (PGlite and a minimal Postgres 17 schema with the real RPC body, not the full migration set). The race was SQL-level, not through the TS service. The #845 combination was a local
detached merge only. COGS rounding is measured in PGlite on the combined tree, not through the app. Real extractor currency strings were not available; `TL`, `₺`, `US$` come from the guard's code path.
Allowance/deposit coincidence rates come from my own generator (30 percent of lines carry one), not production papers.

## Files
`round19-probes-landed/`: `r19-alloc.spec.ts`, `r19-svc.spec.ts`, `r19-e2e.spec.ts`, `r19-dbg.spec.ts`, `r19-pglite.mjs`, `r19-sqltests.mjs`, `r19-mixedlots.mjs`, `r19-mutate.py`, `conc-run.sh` + `conc-schema.sql`,
and the outputs (`alloc-results.json`, `svc-results*.json`, `e2e-results.json`, `pglite-*.out`, `sqltests.out`, `mixedlots.out`, `conc-result.txt`, `mutation-results.txt`, `revert-91*.out`, `pr91*-src.patch`).
