**[2026-10-06 ~00:33Z, coordinator] Re-headed at `b93e67183`.** It merges `origin/main` `63ce97e62`, bringing in everything merged since this branch last took main. The newest of that is #607 `1884dea38`, #647 `8e16fbcef` and #646 `63ce97e62`. Conflicts resolved by the coordinator: README index rows (both kept) and the INSIGHT_GENERATOR_VERSION history: main's 5 line is kept, the placeholder narrows to cap's 6 (#609), and this branch's 7 line stays. The version stays **7**, so **#609 must merge first**. Guards at the new head: migration order, versions unique, OD ids and conflict markers all 0. `ownership_between(origin/main, HEAD)` = `[]`. Decision claims and ADR-number uniqueness are left to CI. Lines below that name an older head describe this PR before the merge. This is a first audit pass; the merge turn re-heads and re-audits.

Branch `fix/stockout-counts-open-ml`. The lane's last call (**SHIP**) was at 5806d9bd7, which contained origin/main 1aa4dcb8c. The coordinator then merged origin/main 28d32de36 (#595) in at 36eb73df8 with no conflicts, re-ran the ADR, OD and claims guards (all PASS) and pushed it. 15 files against main.

## What was wrong for the owner

The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only, production) found AW29 / A-025:

- **"What to buy back" listed eight wines at exactly 61%** (0.6098340419302315; `raw/sl-stockout-tie.digest.json`). Pierre Ferrand came first, though the walk's truth gives it 45.0 days of cover. Jameson (24.4 days), Beefeater (18.5) and Metaxa (17.9) also sat in the tie.
- **The insight said** *"Jameson Irish Whiskey ranks #1 of 134 by stockout risk (61.0%). Only 0 bottles on hand vs its demand pattern"*.
- **A "Tonight" card told the owner to order Pierre Ferrand.** The lane brief records 0.75 bottles and 45 days of cover for it.
- **Only 11 of the 27 truly short SKUs were listed.**

There were two causes, and either one alone produces wrong rows:

1. **On hand counted sealed bottles only.** The register read `live_qty ?? stock_live` and never read `inventory_lot_rollup.open_ml` (`supabase/migrations/20260902150000_lot_cost_truth.sql:499`). The walk digest gives Pierre Ferrand 950 ml open, and it read as 0 bottles. Wine-360 and the stockout #1 insight had the same gap.
2. **Every demand series held one import day (F-129).** Zero-filled over 90 days, that gives CV = √90 = 9.49 for all 103 demand rows. With nothing sealed, every such wine reads P = 1 − Φ(−√(7/90)) = 0.6098 at a 7-day lead time, whatever it sells. No site required any history before stating a risk, a safety stock or a reorder point.

ADR 0272 (#602, on main) withholds a tied #1 and keeps ties at a cut. It does not touch either cause: one wine with a one-day series still printed "#1 by stockout risk (61.0%)".

## What changed and why

ADR 0299 (Proposed). The 14-day floor, the bottle-size rule and the unmeasured-row rule are the build's picks under the locked ADR 0020, not founder answers.

1. **On hand = sealed + open ml ÷ bottle size** (`engine/inventory-science.ts`, `bottlesOnHand`).
   - The size is the one the writer pours from, `COALESCE(bottle_size_ml, 750)` (`20261217112500_a_short_pour_opens_the_next_bottle.sql:102`). A size of 0 or less, which the writer refuses (`:117`), converts nothing.
   - Sealed counts still drive cost, inventory value and ABC.
2. **A risk needs a measured history** (`MIN_DEMAND_DAYS = 14` days with a sale in the zero-filled window; the same floor as `MIN_TREND_OBSERVED`).
   - Below the floor, stdev, CV, XYZ, safety stock, reorder point and stockout probability are null, and the basis says why.
   - Mean, days of cover and mean lead-time demand stay, because they need only the mean.
3. **An unmeasured wine is listed when its bottles do not cover the mean lead-time demand.** This is provable without the swing at a service level of 0.5 or more (z ≥ 0). A wine with no sale is listed only at nothing on hand, as before; its risk is now null rather than 0%.
4. **One engine reading (`restockReading`) for the register, Wine-360 and the stockout #1.**
   - A CLAIMS sweep fails on any other direct `stockoutProbability(` call in non-spec gateway code.
   - The insight ranks only measured wines. It reads `open_ml` itself (`readOpenMl`); if that read fails, the insight is silent and logs the failure instead of ranking sealed counts.
   - `INSIGHT_GENERATOR_VERSION` becomes 7.
5. **The page and the export say why a figure is a dash.**
   - A dash in risk or reorder-at beside a cover figure now reads as "sold on fewer than 14 days in the window". A dash with no cover keeps "no measured demand".
   - When a listed row has no risk, both name the order ("highest measured risk first, then the fewest days of cover").
   - The page draws no bars when no listed row has a risk. The params gain `minDemandDays`.
6. **No ordering rule changed.** ADR 0272's comparator, its 25-row cut and its 14-bar expression are byte-identical. `comparisons.ts` is not in the diff.

**What Tuzlu's eight rows become** (fixture arithmetic from the walk digests, not re-measured on production):

- Pierre Ferrand (0.95 bottles against 0.31 lead-time demand), Beefeater (0.6 against 0.31) and Metaxa (0.6 against 0.23) leave the list.
- Sonoma, Tekirdağ, Yeni Rakı (0 bottles), Jameson (0.05 bottles, 0.9 days) and Efe Black (0.33 bottles, 2.3 days) stay, by days of cover, with no percentage.
- The stockout #1 and the "Tonight" card (`stockout_imminent`, `recommendations.service.ts:312-313`, which reads a null risk as 0) go silent until a wine has 14 dated sale days.

**Last call (5806d9bd7, prose only).**

- ADR 0299's Status line and two brackets in ADR 0272 said the founder's answers "are built" on a follow-up branch that does not exist yet. They now say "owed".
- ADR 0272's Status line said fork 3 "stays open". A bracket now says it is answered and not yet built.
- ADR 0299 now names the "Tonight" card going silent, and records that a failed rollup read degrades the register and Wine-360 to sealed counts while the insight is silent. tech-debt.d gained that entry as OPEN.

## Tests and guards

**Fail before the fix.** The builder's tests-only commit e3066ea74 was re-run by the verifier, with the six source files checked out at it:

- `stockout-counts-open-ml.spec.ts`: 13 failed, 1 passed (the control).
- `ReportsNext.test.tsx`: 2 failed, 78 passed (the 2 are the new AW29 cases).

**At HEAD** (run at last call on c8c88c049's code; 5806d9bd7 changes only prose):

| Run | Result |
|---|---|
| Gateway, targeted: stockout-counts-open-ml, restock-cut-keeps-ties, insight-rankings-significance, `src/reports/exports`, `src/recommendations`, `src/analytics/engine` (`--runInBand --forceExit`) | 19 suites, 284 tests passed |
| Gateway, broad: `src/analytics`, `src/consultants` | 55 suites, 832 tests passed |
| Verifier's broad run: analytics, reports, recommendations, consultants | 61 suites, 939 tests passed |
| Web: `vitest run src/pages/reports` | 5 files, 134 tests passed |
| Gateway `tsc --noEmit -p tsconfig.spec.json` | 0 errors besides the pre-existing `@simplewebauthn/server` |
| Web `tsc` | only the pre-existing `@simplewebauthn/browser` error |
| Gateway eslint | 0 errors. 60 warnings, all there before the branch: 59 prettier in `report-export-cuttings.ts`, 1 in `analytics.service.ts` |
| Web eslint (web-lint plugin dir) | rc 0 |

**Fixture checks.**

- The two sig fixtures (`restock-cut-keeps-ties`, `insight-rankings-significance`) now spread demand over 14 days so they still reach the tie paths. Their assertions are unchanged.
- I re-checked the new tie comment ("about 87%, more than one bit pattern"): the eight risks are 0.8705982157959979, …998 and …982.

**Guards, all exit 0.** Each was run normally; the builder and verifier also ran `--self-test` where one exists.

- check_windowed_figures, check_analytics_cost_honesty, check_read_errors_not_swallowed, check_read_columns_exist, check_queried_tables_exist, check_web_reads_gateway_dto_keys
- check_citation_pairing, check_od_ids_exist, check_no_conflict_markers, check_money_states_its_currency, check_route_exposure, check_deploy_own_pushes
- check_adr_numbers_unique: "OK -- introduced by this ref: 0299", 1685 refs.
- `env LC_ALL=C bash scripts/check_decision_claims.sh`: **856 checked, 856 holding**.
- The 4 new claims rows each fail against a `git archive` of origin/main, which the verifier ran.
- The builder made 21 mutations plus a sweep mutation. All failed, with 0 no-ops.

**Local Postgres: not run.** No SQL or migration changed, and the slot 20261220150000 was not used, so `pgtest.sh` had nothing to prove.

## ADR / CLAIMS touched

- **New:** `.planning/decisions/0299-stockout-risk-counts-the-open-bottle-and-needs-a-measured-history.md` (Proposed), plus its README row.
- **Amended with dated brackets:** ADR 0272.
  - Decision 4: the 0% group is now a null group, and neither cut extends through a null edge.
  - Status and fork 3: answered, owed on the follow-up.
- **New claims:** `.planning/decisions/claims.d/fix-stockout-counts-open-ml.jsonl`. Rows STOCKOUT-OPEN-ML-COUNTED, STOCKOUT-RISK-NEEDS-14-SALE-DAYS, STOCKOUT-DASH-SAYS-WHY and STOCKOUT-GENERATOR-VERSION, all `resolved`.
- **New:** `.planning/tech-debt.d/2026-10-04-fix-stockout-counts-open-ml.md`. AW29 is FIXED; the follow-up is OWED; four residuals are OPEN.

## Founder answers

Both are quoted verbatim in ADR 0299 from the lane brief. Both are binding, and **both are assigned to a follow-up branch stacked on this one, not to this PR**:

- **"What to buy back" order** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Soonest to run out (Recommended)"*: "days of cover for every row, percentage breaks ties; built on a follow-up branch stacked on this one (~5 files) amending ADR 0272 Decision 4 and its claims rows with brackets. This lane's own PR changes no ordering rule."
- **ADR 0272 fork 3** (AskUserQuestion, 2026-10-04 ~21:30Z): *"Out of both, say a count"*: "the 0% group (no measured demand in the window, nothing on hand) leaves BOTH the restock table and the 14 bars; one line carries them: 'N more below their reorder point have no demand to judge.'" Under ADR 0299 that group carries a null risk, so the follow-up keys it on "no sale in the window and nothing on hand".

## Forks deferred

- None taken here. The two founder answers above are owed on the follow-up branch. It amends ADR 0272 D4 and its two claims rows, the server cut (`analytics.service.ts`, `reorderList: E.cutKeepingTies(`) and the web bars and table (`rp-registers-house.tsx`).
- Which bottle-size fallback is right (the row, then the library, then 750; or the row, then 750) belongs to AW15 / ADR 0115. It was handed there and not asked.
- Postime's F2 re-dating of the legacy one-day rows is the founder's open call under ADR 0281.

## Merge-order notes

- **Order:** lane postime (#603) first, then cap (#609) and rec (#607) in either order, then this PR. Sig (#602) is on main already.
- **Postime:** shares no file with this branch. Its sale-time dating is what lets a wine earn 14 sale days again.
- **Shared files.** A `git merge-tree` dry run against cap and rec conflicts only in:
  - `.planning/decisions/README.md`: keep both rows by number.
  - `insight-generator.service.ts`, only in the `INSIGHT_GENERATOR_VERSION` header. Rec has 5 and cap has 6. Whichever lands later takes main's version + 1 and keeps every history line, and STOCKOUT-GENERATOR-VERSION moves with it.

  `analytics.service.ts`, `advanced-analytics.service.ts` and `insight-rankings-significance.spec.ts` (all three also touched by cap) auto-merge.
- **Units (ADR 0297, unbuilt):** that lane plans an ml-to-bottles helper. Whichever lands second folds `bottlesOnHand` into it.
- **Stacking:** this branch merged `fix/insights-significance-gates` before #602 was squash-merged. Its commits show in `git log origin/main..HEAD` but add no content beyond main (the diff is these 15 files). The branch is stacked on no open lane.

## Not covered (CLAUDE.md §0.5)

**Owed work**

- **The founder's two answers are not built here.** Order and fork 3 are owed on the follow-up branch, and that branch does not exist yet.

**Not measured or checked**

- **Nothing was re-measured on production** (no production reads allowed). Tuzlu's eight-row outcome is fixture arithmetic from the walk digests. The recall figure (11 of 27 truly short SKUs listed) was not re-measured. The Malagousia figure (8 bottles, 45 days) is the plan's.
- **The page was not rendered in a browser.** Its copy and bars are proven through the catalogue `view()` in `ReportsNext.test.tsx` only.
- **No test pins the "Tonight" card going silent.** It was confirmed by reading `recommendations.service.ts:312-313`.
- **`check_house_item_invariants` and `check_migration_ledger` exit 2 ("could not check: no database").** They need a live DB, and no SQL is in scope.
- **Web prettier was not run;** the specified eslint command was used instead. CI has not run, because nothing is pushed.

**Residuals and accepted consequences**

- **Slow sellers lose figures:** fewer than 14 sale days in 90 means no percentage, reorder point or safety stock, though days of cover are kept. The intermittent-demand model (ADR 0299 Option 6) is left for later.
- **Mixed series:** one that mixes legacy one-day rows with dated sales passes the floor distorted until postime's F2 runs.
- **Jameson stays listed** on its stranded-lot count (about 0.78 bottles true; the AW08 repair under ADR 0285 is unrun).
- **Open bottles are not valued.**
- **/inventory's `days_of_cover` still counts sealed bottles only** (the `inventory_analytics` view, baseline `:3344`, `:3375-3377`). It can disagree with "What to buy back" by up to one bottle, and fixing it needs a view migration.
- **Two bottle-size fallback rules** exist (`inventory.service.ts:80-82` against the writer's `:102`). A 1 L spirit with a NULL size reads at 750 ml.
- **The insight's sealed source** (`stock_live`) differs from the register's (`live_qty` first).
- **A failed rollup read** degrades the register and Wine-360 to sealed counts but silences the insight.
- **The insight's new rollup read is unpaged.** It matches the register's existing read, and Tuzlu has 134 rows, but a house with more than about 1,000 inventory rows would hit PostgREST's default cap.
- **Wine-360's `demand` changes shape**, to `{mean, stdev, cv, demandDays, measured}`. No client reads it today.
- **The register's `onHand` is now a decimal** to the hundredth.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

