> **[2026-10-07 12:30Z, coordinator, push]** Pushed head **`d96dcbf56`**. It is `8a2c0f7e9` plus two clean merges of origin/main: `e9bc1ca36` (`42fe1252b`, #651) and `d96dcbf56` (`5e6c0684e`, #620). Nothing from the branch changed. At this head the fast guards all exit 0, the branch is 15 files, gate ownership is `[]`, and decision claims hold 922/922 (Python 3.11). This head is not audited. The BLOCK at `b93e67183` stands until a fresh full audit.

> **[2026-10-06 ~17:03Z, coordinator, push]** Pushed head **`8a2c0f7e9`**: this body's head `1f3b821d3` plus one merge of origin/main `5c07cfb23` (#622). The merge was clean (`git merge-tree` exit 0). At this head:
> - fast guards (migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers) all exit 0;
> - 15 files against origin/main;
> - gate ownership `[]` by origin/main's classifier;
> - decision claims PASS, 916 of 916 holding (run with Python 3.11: `/usr/bin/python3` here is 3.9, which cannot run ADR 0224's host check).
>
> This head is not audited. The BLOCK at `b93e67183` stands until a fresh full audit of this head checks that its blocker is fixed.
>
> **Founder ruling, 2026-10-06 ~16:55Z (AskUserQuestion), on the gap the last audit raised (a wine with fewer than 14 dated sale days gets no risk, so the "Tonight" card stays silent even at 0 bottles):** verbatim pick *"Fire on an empty shelf (Recommended)"*. A wine at 0 bottles that sold in the window gets the card, citing its last sale and its days of cover, with no percentage. That is built in a follow-up PR (rule, test, and an ADR 0299 amendment quoting the pick); this PR merges as built.

**Head `1f3b821d3`** (local; the remote PR head stays `b93e67183` until the coordinator pushes). Branch `fix/stockout-counts-open-ml`, 15 files against `origin/main` `4528b9689`, which this branch contains (merged at `0de3faa34` with no conflicts, bringing in #621). Nothing has changed behaviour since `c8c88c049`. Every later commit is prose, a test pin, or a merge of `main`.

## What was wrong for the owner

The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only, production) found AW29 / A-025:

- **"What to buy back" listed eight wines at exactly 61%** (0.6098340419302315; `raw/sl-stockout-tie.digest.json`).
  - Pierre Ferrand came first, though the walk's truth gives it 45.0 days of cover.
  - Jameson (24.4 days), Beefeater (18.5) and Metaxa (17.9) were also in the tie.
- **The insight said** *"Jameson Irish Whiskey ranks #1 of 134 by stockout risk (61.0%). Only 0 bottles on hand vs its demand pattern"*.
- **A "Tonight" card told the owner to order Pierre Ferrand.** The lane brief records 0.75 bottles and 45 days of cover for it.
- **Only 11 of the 27 truly short SKUs were listed.**

There were two causes, and either one alone produces wrong rows:

1. **On hand counted sealed bottles only.**
   - The register read `live_qty ?? stock_live` and never read `inventory_lot_rollup.open_ml` (`supabase/migrations/20260902150000_lot_cost_truth.sql:499`).
   - The walk digest gives Pierre Ferrand 950 ml open, and it read as 0 bottles.
   - Wine-360 and the stockout #1 insight had the same gap.
2. **Every demand series held one import day (F-129).**
   - Zero-filled over 90 days, one day of sales gives CV = √90 = 9.49. That held for all 103 demand rows.
   - With nothing sealed, every such wine reads P = 1 − Φ(−√(7/90)) = 0.6098 at a 7-day lead time, whatever it sells.
   - No site required any history before stating a risk, a safety stock or a reorder point.

ADR 0272 (#602, on `main`) withholds a tied #1 and keeps ties together at a cut. It does not touch either cause: one wine with a one-day series still printed "#1 by stockout risk (61.0%)".

## What changed and why

ADR 0299 (Proposed). The 14-day floor, the bottle-size rule and the unmeasured-row rule are the build's picks under the locked ADR 0020. They are not founder answers.

1. **On hand = sealed + open ml ÷ bottle size** (`engine/inventory-science.ts`, `bottlesOnHand`).
   - The size is the one the writer pours from, `COALESCE(bottle_size_ml, 750)`. Since #603, `record_glass_pour` is defined by `20261222100000_a_pos_sale_is_dated_by_its_check.sql`, which has this rule at `:318`.
   - A size of 0 or less, which the writer refuses (`:333`), converts nothing.
   - Sealed counts still drive cost, inventory value and ABC.
2. **A risk needs a measured history**: `MIN_DEMAND_DAYS = 14` days with a sale in the zero-filled window. It is the same floor as `MIN_TREND_OBSERVED`.
   - Below the floor, stdev, CV, safety stock, reorder point and stockout probability are null, and the basis says why.
   - The register's XYZ class is the string `"unknown"`, not null (`xyzClassify` of a null CV).
   - Mean, days of cover and mean lead-time demand stay, because they need only the mean.
3. **An unmeasured wine is listed when its bottles do not cover the mean lead-time demand.**
   - This can be shown without the swing at a service level of 0.5 or more (z ≥ 0).
   - A wine with no sale is listed only when nothing is on hand, as before. Its risk is now null rather than 0%.
4. **One engine reading, `restockReading`, serves the register, Wine-360 and the stockout #1.**
   - A CLAIMS sweep fails on any other direct `stockoutProbability(` call in non-spec gateway code.
   - The insight ranks only measured wines. It reads `open_ml` itself (`readOpenMl`). If that read fails, the insight logs the failure and stays silent instead of ranking sealed counts.
   - Its sentence prints on hand to the tenth: 250 of 750 ml reads "0.3".
   - `INSIGHT_GENERATOR_VERSION` becomes 7.
5. **The page and the export say why a figure is a dash.**
   - A dash in risk or reorder-at beside a cover figure reads as "sold on fewer than 14 days in the window". A dash with no cover keeps "no measured demand".
   - The export names the order ("highest measured risk first, then the fewest days of cover") in its table title whenever a listed row has no risk.
   - The page names the order only in the line under a list cut short (more wines below the reorder point than listed), and there only when a listed row has no risk. When every such wine is listed, the page states no order. The follow-up #624 replaces this order and rewrites that line.
   - The page draws no bars when no listed row has a risk. The params gain `minDemandDays`.
6. **No ordering rule changed.** ADR 0272's comparator, its 25-row cut and its 14-bar expression are byte-identical. `comparisons.ts` is not in the diff.

**What Tuzlu's eight rows become.** This is fixture arithmetic from the walk digests, not re-measured on production.

- Three wines leave the list:
  - Pierre Ferrand: 0.95 bottles against 0.31 lead-time demand.
  - Beefeater: 0.6 against 0.31.
  - Metaxa: 0.6 against 0.23.
- Five stay, ordered by days of cover, with no percentage:
  - Sonoma, Tekirdağ and Yeni Rakı, at 0 bottles.
  - Jameson, at 0.05 bottles and 0.9 days.
  - Efe Black, at 0.33 bottles and 2.3 days.
- Two outputs go silent until a wine has 14 dated sale days:
  - The stockout #1.
  - The "Tonight" card: rule `stockout_imminent`, `recommendations.service.ts:456-459` since #607, which reads a null risk as 0.

## Review rounds (none changed behaviour)

- **Last call `5806d9bd7`.** Prose: the follow-up answers are owed, not built. Also named the "Tonight" card going silent and the failed-read asymmetry.
- **Coordinator re-head `b93e67183`.** Merged `origin/main` `63ce97e62`. The version header kept main's 5, narrowed the placeholder to cap's 6, and left this branch at 7.
- **`7a50f13b9`.** Dated brackets for:
  - the "Tonight" card cite (`:312-313`, now `:456-459`);
  - the follow-up's existence (#624);
  - ADR 0281 being merged;
  - the writer's new defining migration;
  - the server cut's line;
  - postime F2, answered and run (#647);
  - units, open as #626.
- **Fix round 1, `a4452d95e`** (after merging `54f833e4b`, #627):
  - Decision 5 narrowed: the page names the order only under a list cut short.
  - Decision 2: the XYZ class is `"unknown"`.
  - The version header and STOCKOUT-GENERATOR-VERSION now hold in either merge order with cap.
- **Last call, `4f7351411` and `1f3b821d3`:**
  - The comment above `attributeReading` gave 300 of 750 ml as the case its rounding guards. But 300 / 750 is exactly 0.4 in double arithmetic, so the spec's "Only 0.4 bottles" case passed without `Math.round`. The spec's measured wine now holds 250 of 750 ml and expects "Only 0.3 bottles". Unrounded, that prints "0.3333333333333333". The comment uses the same input.
  - ADR 0299's cite to ADR 0124 is bracketed to `:91-94`.
  - Merged `origin/main` `4528b9689` (#621) at `0de3faa34`, with no conflicts. That merge moved Wine-360's only caller, so its cite is bracketed to `analytics.controller.ts:1051`.
  - A review-trail row records all three.

## Tests and guards

**Fail before the fix.** The builder's tests-only commit `e3066ea74` was re-run with the six source files checked out at it. The fix-round-1 verifier repeated this against `origin/main` source.

- `stockout-counts-open-ml.spec.ts`: 13 failed, 1 passed (the control).
- `ReportsNext.test.tsx`: 2 failed, 78 passed (the 2 are the new AW29 cases).

**Rounding pin (last call).** With `Math.round` removed from `attributeReading`, `stockout-counts-open-ml.spec.ts` gives 1 failed, 13 passed. It received "Only 0.3333333333333333 bottles on hand". The file was restored and the tree is clean.

**At HEAD `1f3b821d3`** (after the #621 merge):

| Run | Result |
|---|---|
| Gateway, targeted: stockout-counts-open-ml, restock-cut-keeps-ties, `src/analytics/insights`, `src/reports/exports` (`--runInBand --forceExit`) | 19 suites, 263 tests passed |
| Gateway, broad: `src/analytics`, `src/reports` | 63 suites, 991 tests passed |
| Web: `vitest run src/pages/reports` | 5 files, 134 tests passed (`ReportsNext.test.tsx` 80) |
| Gateway `tsc --noEmit -p tsconfig.spec.json` | 0 errors besides the pre-existing `@simplewebauthn/server` |
| Web `tsc` | only the pre-existing `@simplewebauthn/browser` error |
| Gateway eslint, the two files changed at last call | rc 0 |
| Gateway eslint, whole branch (verifier, at `a4452d95e`) | 0 errors; 60 pre-existing prettier warnings, none on added lines |
| Web eslint (web-lint plugin dir), `rp-registers-house.tsx`, `ReportsNext.test.tsx` | rc 0 |

**Fixture checks.**

- The two sig fixtures (`restock-cut-keeps-ties`, `insight-rankings-significance`) now spread demand over 14 days so they still reach the tie paths. Their assertions are unchanged.
- The eight tied risks in the new comment ("about 87%, more than one bit pattern") are 0.8705982157959979, …998 and …982.

**Guards at HEAD, all exit 0, and each `--self-test` exits 0:**

- check_read_columns_exist, check_queried_tables_exist, check_read_errors_not_swallowed, check_web_reads_gateway_dto_keys
- check_windowed_figures, check_analytics_cost_honesty
- check_citation_pairing, check_no_conflict_markers, check_od_ids_exist
- check_adr_numbers_unique: "OK -- introduced by this ref: 0299", 1729 refs.

**Other checks at HEAD:**

- `env LC_ALL=C bash scripts/check_decision_claims.sh`: **904 checked, 904 holding**.
- The 4 new claims rows each fail against a `git archive` of `origin/main` and pass at HEAD (verifier).
- The two rows rewritten in fix round 1 were mutation-tested: 14 cases, 0 wrong.
- `pr_audit_gate.ownership_between('.', origin/main, HEAD)` = `[]`.
- GATE_SUBJECT_RE, GATE_RULE_RE and GATE_TEXT_RE match nothing in ADR 0299, the claims file or the tech-debt entry.

**Local Postgres: not run.** No SQL or migration is in the diff, so `pgtest.sh` had nothing to prove and nothing was appended to `audits/stockout-local-pg.txt`.

## ADR / CLAIMS touched

- **New:** `.planning/decisions/0299-stockout-risk-counts-the-open-bottle-and-needs-a-measured-history.md` (Proposed), plus its one appended README row. No existing README row is edited.
- **Amended with dated brackets:** ADR 0272.
  - Decision 4: the 0% group is now a null group, and neither cut extends through a null edge.
  - Status and fork 3: answered, and owed on the follow-up.
- **New claims:** `.planning/decisions/claims.d/fix-stockout-counts-open-ml.jsonl`. Its rows are STOCKOUT-OPEN-ML-COUNTED, STOCKOUT-RISK-NEEDS-14-SALE-DAYS, STOCKOUT-DASH-SAYS-WHY and STOCKOUT-GENERATOR-VERSION, all `resolved`.
- **New:** `.planning/tech-debt.d/2026-10-04-fix-stockout-counts-open-ml.md`.
  - AW29 is FIXED.
  - The follow-up is OWED; it is open as #624.
  - Five residuals are OPEN.

## Founder answers

Both answers are quoted verbatim in ADR 0299 from the lane brief, and both are binding. The brief assigns **both to the follow-up branch stacked on this one, not to this PR**:

- **"What to buy back" order** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Soonest to run out (Recommended)"*: "days of cover for every row, percentage breaks ties; built on a follow-up branch stacked on this one (~5 files) amending ADR 0272 Decision 4 and its claims rows with brackets. This lane's own PR changes no ordering rule."
- **ADR 0272 fork 3** (AskUserQuestion, 2026-10-04 ~21:30Z): *"Out of both, say a count"*: "the 0% group (no measured demand in the window, nothing on hand) leaves BOTH the restock table and the 14 bars; one line carries them: 'N more below their reorder point have no demand to judge.'" Under ADR 0299 that group carries a null risk, so the follow-up keys it on "no sale in the window and nothing on hand".

Both are built on #624 (`fix/what-to-buy-back-runs-out-first`), which is open and not merged.

## Forks deferred

- **None taken here.** The two founder answers above are owed on #624.
- **Which bottle-size fallback is right**: the row, then the library, then 750; or the row, then 750. This belongs to AW15 / ADR 0115. It was handed there and not asked.
- **Postime's F2 re-dating** of the legacy one-day rows is answered and done: built in #647 `8e16fbcef`, and ADR 0281's F2 amendment records that it ran on production on 2026-10-05. Nothing is deferred here for it.

## Merge-order notes

**`INSIGHT_GENERATOR_VERSION`**

- The versions are: `main` 5, cap (#609) 6, this PR 7, and tables-insights (#625) and units (#626) 8 each.
- **Cap (#609) should merge before this PR.**
- If this PR merges first, cap takes 8 (main's 7 + 1) and keeps every history line. The `6` line here already says 6 would then go unused. #625 and #626 then move up the same way.
- STOCKOUT-GENERATOR-VERSION (history line at least 7, constant at least the history line) holds in either order. It fails if a conflict resolution leaves the constant below 7.
- Re-check the version at every merge.

**Dry-run `git merge-tree` of HEAD against each overlapping open PR's current head:**

- **#609 cap** conflicts only in `insight-generator.service.ts`, in the version header. `analytics.service.ts`, `advanced-analytics.service.ts` and `insight-rankings-significance.spec.ts` auto-merge.
- **#616 tz** conflicts in `.planning/decisions/README.md` only.
- **#617 proxies** conflicts in `.planning/decisions/README.md` only. Its `scripts/sql_outside_migrations.txt` conflict is with `main` (#621), not with this branch. `analytics.service.ts`, `report-export-cuttings.ts`, `rp-registers-house.tsx` and `ReportsNext.test.tsx` auto-merge.
- **#615 netsales** reports conflicts in README, `report-export-cuttings.ts` and `rp-registers-house.tsx`.
  - #615 already conflicts with `main` in those same files (plus `table-analytics.service.ts`) since #621.
  - Its hunks are in the till, seats and service registers; this branch's are in restock.
  - Whether any conflict remains with this branch is settled when #615 re-heads.
- **#625 tables-insights** conflicts with `main` across its files since #621's squash. Its version header will also conflict with this branch (8 against 7).
- **#626 units** (stacked on #609) overlaps for real: README, `advanced-analytics.service.ts`, `analytics.service.ts`, `insight-generator.service.ts` and `insight-rankings-significance.spec.ts`. Whichever lands second folds `bottlesOnHand` into units' ml-to-bottles helper.
- **#624 follow-up** is stacked on this branch at `b93e67183`. It conflicts in:
  - ADR 0299, the claims file and the tech-debt entry;
  - `analytics.service.ts` and `rp-registers-house.tsx`.

  The cause is that this branch edited the same lines after #624 was cut: the review brackets, and the two cut comments that name the null risk. After this PR merges, rebase it onto `main` and resolve by later-truth. #624's order rewrite supersedes this branch's `more:` line and Decision 5's bracket.

**Other notes**

- **README:** the same append-point conflict comes up with most open lanes. Keep both rows by number.
- **Already merged:** postime (#603), rec (#607), sig (#602) and tables (#621) are on `main`, and this branch contains them.
- **Stacking:** this branch is stacked on no open lane. It merged `fix/insights-significance-gates` before #602 was squash-merged, so those commits show in `git log origin/main..HEAD`, but they add no content beyond `main`. The diff is these 15 files.

## Not covered (CLAUDE.md §0.5)

**Owed work**

- **The founder's two answers are not built here.** The order and fork 3 are owed on #624, which is open and stacked on this branch.

**Not measured or checked**

- **Nothing was re-measured on production**, because no production reads were allowed.
  - Tuzlu's eight-row outcome is fixture arithmetic from the walk digests.
  - The recall figure (11 of 27 truly short SKUs listed) was not re-measured.
  - The Malagousia figure (8 bottles, 45 days) is the plan's.
- **The page was not rendered in a browser.** Its copy and bars are proven only through the catalogue `view()` in `ReportsNext.test.tsx`.
- **No test pins the "Tonight" card going silent.** It was confirmed by reading the rule `stockout_imminent` (`recommendations.service.ts:456-459`).
- **Two guards need a live database and were not run at this head:** `check_house_item_invariants` and `check_migration_ledger`. Earlier rounds got exit 2 ("could not check: no database"). No SQL is in scope.
- **Web prettier was not run.** The specified eslint command was used instead.
- **CI has not run on this head**, because nothing is pushed. The remote PR body still needs this draft applied.
- **The commit body of `c8c88c049`** still states the broader page-order sentence. History is not rewritten; ADR 0299's fix-round row and this body supersede it.
- **ADR 0272's line cites are not re-bracketed.**
  - Several already miss their code on `main`, for example `rp-registers-house.tsx:596` and `insight-generator.service.ts:330-338`.
  - This branch's insertions move two more: `analytics.service.ts:694` to `:696`, and `advanced-analytics.service.ts:575-576` to `:582-583`.
  - They were left alone because #624 rewrites the adjacent Decision 4 lines, and a bracket there would add a conflict. ADR 0299's own cites were re-checked at this head.

**Residuals and accepted consequences**

- **Slow sellers lose figures.** A wine with fewer than 14 sale days in 90 gets no percentage, reorder point or safety stock, though its days of cover are kept. The intermittent-demand model (ADR 0299 Option 6) is left for later.
- **Mixed series can still pass the floor distorted.** F2 re-dating ran on production on 2026-10-05 (#647). But a row it cannot tie to exactly one closed, readable check keeps its import date, so a series that mixes such rows with dated sales can still pass. Tuzlu's series were not re-measured.
- **Jameson stays listed** at 0.05 bottles and 0.9 days in the fixture, against the walk's 24.4 days of cover. The cause is stranded-lot stock: about 0.78 bottles true. The AW08 repair under ADR 0285 is unrun. So the brief's Jameson row is only partly cured.
- **Open bottles are not valued.**
- **/inventory's `days_of_cover` still counts sealed bottles only.** It comes from the `inventory_analytics` view (baseline `:3344`, `:3375-3377`). It can disagree with "What to buy back" by up to one bottle, and fixing it needs a view migration.
- **Two bottle-size fallback rules exist**: `inventory.service.ts:80-82` against the writer's. So a 1 L spirit with a NULL size reads at 750 ml.
- **The insight's sealed source differs from the register's.** The insight uses `stock_live`; the register uses `live_qty` first.
- **A failed rollup read** degrades the register and Wine-360 to sealed counts, but silences the insight.
- **The open-ml reads have two limits:**
  - They keep the last rollup row per inventory row, so where one row's lots name two wines, `open_ml` is one row's, not the sum.
  - They read one unpaged page. Tuzlu has 134 rows, but a house with more than `max_rows = 1000` rollup rows would read only part of it.
- **Wine-360's `demand` changes shape**, to `{mean, stdev, cv, demandDays, measured}`. No client reads it today.
- **The register's `onHand` is now a decimal** to the hundredth.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

