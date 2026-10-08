## fix: count a glass as its share of a bottle in every demand reader (AW02, ADR 0297)

**Stacked on #609** (`fix/analytics-reads-past-row-cap`, ADR 0292). Open or rebase this PR after #609 merges; until then the diff against `main` also carries #609's files (23 files, not 15). See *Merge order*.

### What was wrong for the owner

The read-only analytics walk on Tuzlu Rüzgar (2026-10-03, @661068ab3) filed **AW02**. It also covers the glass halves of **A-032** and **A-025**.

The POS mirror writes `wine_consumption_log.quantity` as a count in the line's own mode (ADR 0011, `pos-hub.service.ts:1018-1022`, `:1060`):

- a bottle sale is a `bottle` row of `quantity` bottles;
- a glass, single or carafe is a `glass` row of `quantity` pours, with their millilitres in `volume_ml`.

Every demand reader took `quantity` as bottles. Their old fallback, `c.quantity || volume_ml / 750`, never fired for a POS row. So:

- a 150 ml glass counted as a whole bottle, five times what it poured;
- a 50 ml rakı single counted as a bottle, about fifteen times what it poured.

At Tuzlu that inflated:

- **A-032, menu engineering.** The register read 752 "units" across 76 rows (Çankaya 70 units, 0.778/day, plowhorse). It counted every glass and single as a bottle. That inflated velocity, and through it the quadrant and the action. The row cap behind A-032 is #609's half.
- **A-025, the restock list and inventory science.** Daily demand, days of cover, reorder point, stockout chance and EOQ were built on pours read as bottles, so every glass and single seller was over-ordered. The tie at 61% and the import-day spike are AW08/AW03 halves, not this one.
- The same error ran through seasonality, Wine 360, the risk profile, the demand forecast, the insight feed (movers, concentration, forecast gap, stockout #1) and the Bottles sold goal.

How many of Tuzlu's lines are glass lines was **not measured**, because production reads are out of scope for this lane. A read-only count is under *Production*.

### What changed and why

There is one converter: `apps/api-gateway/src/analytics/consumption-units.ts`, `bottlesOf`.

- A `bottle` line is its `quantity`, whatever its size.
- A `glass` line is its `volume_ml` over the item's stated `restaurant_inventory.bottle_size_ml`. A size counts only if it is positive, which is pos-hub's own test.
- A glass line of an item with no stated size rests on the **750 ml stand-in** (`STOCK_STAND_IN_BOTTLE_ML`). This is fork 1 (a), the same stand-in the item's stock already moves by (`record_glass_pour`'s `COALESCE(..., 750)`, pos-hub's `RPC_DEFAULT_BOTTLE_ML`).
  - It is labelled. Every figure built on consumption lines carries the counts of the lines and items resting on it (`summarizeUnits`, `unitsBasisSentence`, `unitsLabel`).
  - It is dropped per item as soon as a size is stated, because the size is read live and no code change is needed.
- A line with **no bottle figure** gets null, never 1 and never 0. That is a line with no mode, a glass line with no positive ml, or a bottle line with a negative quantity. Figures that rest on it are null and named.
- `quantity` keeps its ADR 0011 meaning. `master_wine_library.bottle_size_ml` (a default, ADR 0124) is never read.

The readers changed:

| Reader | File | What it does now |
|---|---|---|
| Menu engineering | `advanced-analytics.service.ts` | Velocity in bottles/day. `items[].sizeStandIn`, `unitsCoverage`, `counts.unmeasured`, `basis.unitsDerived`. A costed wine with an uncounted line has null velocity, quadrant and action. Medians are over known velocities only. |
| Seasonality | same | Counted lines only; `basis.units` names the gap. |
| Wine 360 | same | Demand, forecast, model and trend are null for a wine with an uncounted line. That wine leaves the peer ranks. `basis.demand` gives coverage. |
| Inventory science / restock | `analytics.service.ts` | Bottles/day. A wine with an uncounted line gets `demandUnknown: true` and null demand, cover, reorder point and risk, and is never reordered on a guess. Adds `unassessed` and `unitsCoverage`. Dead stock still means "moved" by servings or millilitres. |
| Risk profile | same | Counted lines only; new `basis.demand`. |
| Demand forecast | same | One wine with an uncounted line has no projection and no accuracy, and `basis.model` says why. The house-wide series projects from counted lines and names the gap. |
| Insight feed | `insights/insight-generator.service.ts` | Bottles per line. Every consumption record carries `evidence.units`, and the response carries `units`. A day holding an uncounted line is unobserved. Movers and the stockout #1 skip wines holding one. Concentration and the Holt-Winters gap are withheld while one is present. `INSIGHT_GENERATOR_VERSION` goes to 8, so stored rows below 8 are recomputed, not served. |
| Bottles sold goal | `goals.service.ts` | Bottles per line. Each goal carries `units`. A window holding an uncounted line throws `UncountedConsumptionError`, so the goal reads "could not be read/scored" instead of summing short. |
| Report exports | `reports/exports/report-export-cuttings.ts` | The quadrant cutting no longer calls an unmeasured wine uncosted, and "No quadrant" counts both reasons. The week, goals and reading exports carry the stand-in label. |

Small spec fixes (fake rows gain `consumption_type`): `absent-not-zero.spec.ts`, `cost-honesty.spec.ts`, `forecast-accuracy-honesty.spec.ts`, `insights/insight-rankings-significance.spec.ts`, `common/read-whole-window.spec.ts`.

### Tests, guards and harness

These were measured at the PR head, after merging `origin/main` 1c9eeff00 into the branch:

- **New spec** `consumption-units.spec.ts`: 38 of 38 pass. With the five reader files reverted to the stack base efd8de7ea, **28 of 38 fail**. The 10 that still pass test the new pure module itself. The files were snapshotted first, restored byte-identical, and the worktree was clean afterwards.
- **Gateway jest** `src/analytics src/reports src/common`: 105 of 105 suites, 1704 of 1704 tests pass.
- The verifier also ran the neighbouring suites: communications, procurement, inventory and pos-hub, 169 suites and 3337 tests, plus 67 more suites and 1182 tests, all passing.
- **Mutation testing** was the builder's scratchpad runner. Every mutant was killed except M5a and M7a. Those are equivalent mutants: `qty ?? 0` in seasonality and in the risk profile, where `toDailySeries` zero-fills every day anyway (`analytics.service.ts:295`). The `?? 1` and `?? servings` variants are killed by S1 and RP1.
- **tsc** `--noEmit -p tsconfig.spec.json` is clean apart from the pre-existing `@simplewebauthn/server` errors.
- **eslint** on the 7 changed source files: 0 errors, 64 prettier warnings. The builder measured each file's count equal to the base.
- **Decision claims** (`check_decision_claims.sh`): 869 checked, 869 holding.
- **Guards**: exit 0 with `--self-test` 0 for `adr_numbers_unique`, `citation_pairing`, `od_ids_exist`, `no_conflict_markers`, `quantity_units`, `windowed_figures`, `analytics_cost_honesty`, `read_columns_exist`, `web_reads_gateway_dto_keys`, `read_errors_not_swallowed`, `queried_tables_exist`, `migration_versions_unique` and `migration_order`.
  - The builder ran all 61 `check_*.py`: 53 exit 0.
  - 8 could not run, and none is counted as a pass. Three need a `.env` (beverage_identity_parity, beverage_kind_regression, display_name_parity). Three need a DSN (definer_functions_closed, house_item_invariants, migration_ledger). Two read production (deployed_sha, web_deployed_sha).
- **Gate ownership classifier** (`pr_audit_gate.ownership_between(origin/main, HEAD)`): `[]`, released.
- **Local Postgres harness**: not applicable. The lane has no migration and no SQL function change, so nothing was appended to `audits/units-local-pg.txt`.

### ADR and claims

- **ADR 0297**, `.planning/decisions/0297-a-glass-is-not-a-bottle.md`, is new and Proposed. Forks 1 and 2 are answered and quoted verbatim. It has one new row in `.planning/decisions/README.md`; no existing row is edited.
- `claims.d/fix-a-glass-is-not-a-bottle.jsonl` adds 5 rows:
  - `AW02-NO-750-DIVISOR` (resolved): no reader takes `quantity || …/750` as bottles.
  - `AW02-ONE-CONVERTER` (resolved): the four readers import and call `bottlesOf`.
  - `AW02-STAND-IN-IS-THE-STOCKS` (resolved): the constant equals `record_glass_pour`'s and pos-hub's 750, so it fails if R7 changes the stock's stand-in.
  - `AW02-DASH-CHART-GLASSES` (open).
  - `AW02-WEEKLY-SOLD-MIXED` (open, fork 2 owed).

### Founder answers (verbatim, AskUserQuestion 2026-10-04 ~20:50Z)

- **Fork 1**, a glass line of an unsized wine: *"750 ml stand-in (Recommended)"*. Built: labelled, with the counts of the lines and items resting on it, and switching to the true size once one is stated.
- **Fork 2**, the weekly email's Sold column: *"Bottles · glasses (Recommended)"*. Per his answer this is its own PR in /communications after R2's pause lifts. It is **not in this PR**; it is recorded as owed in ADR 0297 and as open claim `AW02-WEEKLY-SOLD-MIXED`.
- Leaned on and quoted in the ADR: **R7** *"One wine at a time (Recommended)"* (ADR 0115 lock, PR #589, unmerged), **AW14** *"Door-checked, labelled (Recommended)"*, and **dash F5** *"Keep out, say so (Recommended)"*. The last is the shape used for a line with no bottle figure.

### Forks deferred

None new. Fork 2 is answered and owed as its own PR, as above.

### Production

- **No migration and no row changes at merge.** The deploy changes figures, not data. After it:
  - every glass or single seller's demand and velocity drop to its bottle-equivalent;
  - the restock list and the menu-engineering quadrants move with them.
- Stored insight rows below version 8 are recomputed on the next read, in the runtime's normal insight write.
- A read-only count of how much of each house rests on what, for the coordinator to run if wanted (not run here):

```sql
SELECT wcl.restaurant_id,
       count(*)                                                     AS lines,
       count(*) FILTER (WHERE wcl.consumption_type = 'glass')       AS glass_lines,
       count(*) FILTER (WHERE wcl.consumption_type = 'glass'
                          AND NOT (COALESCE(ri.bottle_size_ml, 0) > 0)) AS stand_in_lines,
       count(DISTINCT wcl.inventory_id) FILTER (WHERE wcl.consumption_type = 'glass'
                          AND NOT (COALESCE(ri.bottle_size_ml, 0) > 0)) AS stand_in_items,
       sum(wcl.quantity)                                            AS units_read_before,
       sum(CASE WHEN wcl.consumption_type = 'bottle' AND wcl.quantity >= 0 THEN wcl.quantity
                WHEN wcl.consumption_type = 'glass' AND wcl.volume_ml > 0
                  THEN wcl.volume_ml / CASE WHEN ri.bottle_size_ml > 0 THEN ri.bottle_size_ml ELSE 750 END
           END)                                                     AS bottles_read_after,
       count(*) FILTER (WHERE (wcl.consumption_type = 'glass'
                               AND (wcl.volume_ml <= 0 OR wcl.volume_ml = 'NaN'::float8 OR wcl.volume_ml = 'Infinity'::float8))
                           OR (wcl.consumption_type = 'bottle' AND wcl.quantity < 0)) AS no_bottle_figure_lines
FROM wine_consumption_log wcl
LEFT JOIN restaurant_inventory ri ON ri.id = wcl.inventory_id
GROUP BY 1;
```

### Merge order

- **After #609.** This branch carries #609 at 12d1d9e6f, its current head, through merge efd8de7ea. Against `main` + #609 the diff is **15 files**. Against `main` alone it is 23.
- Textual conflicts were checked with `git merge-tree` against each open PR's head:
  - **#607** (rec): `insight-generator.service.ts`, README rows.
  - **#619** (stockout, ADR 0299): `advanced-analytics.service.ts`, `analytics.service.ts`, `insight-generator.service.ts` (computeInventoryFamily: the stockout #1's `withUnits` wrap and `wineId`), `insight-rankings-significance.spec.ts`, README rows.
  - **#615** (netsales): `goals.service.ts` (computeMetricWithSeries now returns `units`, plus the getGoalProgress return). `table-analytics.service.ts` conflicts through #609's hunks, not this lane's.
  - **#616** (tz): `analytics.service.ts`, `goals.service.ts`.
  - **#617** (proxies): `analytics.service.ts`, `cost-honesty.spec.ts`.
  - **README only:** #612, #613, #614, #618, #620, #621. Keep both rows by number.
  - Clean: #603, #605, #608, #611. Conflicts other PRs show on `scripts/sql_outside_migrations.txt` and `recorded-days.service.ts` come from those PRs being behind `main` or from #609, not from this lane.
- **INSIGHT_GENERATOR_VERSION.** The sequence is `main` 4, #607 5, #609 6, #619 7, this PR 8. Whichever of #619 and this PR merges later takes one past `main`'s version at its merge.
- **Trailer.** Commit dc8d5963b carries `Co-Authored-By: Claude Opus 5.5`, and the merge commit 481a534fb has git's default message with no trailer. History is not rewritten, so the squash message should end `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

### Not covered (CLAUDE.md §0.5)

1. **Web /reports registers are unchanged.** The 15-file cap blocks a 16th file. All of this is recorded in ADR 0297 *Not fixed* #6 and owed as a follow-up PR.
   - `rp-registers-house.tsx:61` reads a null velocity as 0, so an unmeasured wine plots and prints at 0 bottles/day.
   - "No quadrant" ignores `counts.unmeasured`.
   - The restock register's empty answer ("…a real answer about N wines", `:661`) ignores `unassessed`.
   - All of these need a `manual` or `ai_agent` line with no bottle figure. The POS writer cannot write one.
   - The count of affected lines is the `no_bottle_figure_lines` column above, which was not run.
2. **The dashboard sales chart** (`dashboard.service.ts:893`) still adds every line into "glasses". No page calls it. It is open claim `AW02-DASH-CHART-GLASSES`.
3. **The weekly email's Sold column** is fork 2, owed (see above).
4. **Three related defects are named in the ADR and not fixed here:**
   - the 90-day divisor over a shorter history (`advanced-analytics.service.ts:285`; Tuzlu has 60 days);
   - master-wine demand set against per-row stock (`analytics.service.ts:635-651`);
   - glass revenue per bottle-equivalent in the menu-engineering margin.
5. **No test pins the select column lists.** The specs' fake client ignores `select`.
   - Dropping `consumption_type` from a reader's select would turn every line into "no bottle figure", which is loud: everything goes null.
   - Dropping the `restaurant_inventory(bottle_size_ml)` embed would quietly put every glass line on the labelled stand-in.
   - `check_read_columns_exist` proves the columns exist, not that they are selected.
6. **The stand-in's residual error** for unsized items whose true size is not 750 ml is labelled, not removed: 70 cl reads 7% low, 100 cl 33% high, 37.5 cl 50% low.
7. **Nothing was measured on production.** Tuzlu's glass-line, stand-in and no-figure counts are unknown. The SQL above was not run.
8. **No browser check.** The change is gateway-only, and no page was opened against a local gateway with data. The web reads were checked by code (`rp-registers-house.tsx`, `rp-registers-goals.tsx`, `GoalsMargin.tsx`) and by the `web_reads_gateway_dto_keys` guard.
9. **Guard and mutation coverage gaps.** 8 of 61 guards could not run here (listed above). Mutation testing was the builder's run; the last call re-ran only the reverted-readers check.
10. **Last-call fixes, docs only.** The last call corrected ADR 0297's prose in two commits so it says what the code does:
    - an uncounted day is *unobserved*, not dropped;
    - concentration is withheld on an uncounted *wine*, and the forecast gap on an uncounted *dated line*;
    - a negative bottle quantity also has no figure;
    - the sales-chart client is re-exported, not only exported;
    - the restock empty-answer gap is now named;
    - the dry-run SQL now covers every line the converter refuses.

    No code changed in the last call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
