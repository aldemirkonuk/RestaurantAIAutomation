**[2026-10-06 04:40Z, lane netsales, last call] HOLD at `ebfccc6e1`. The lane's work is complete. Only the re-head onto #621 is blocked.**

- **What holds.** Every in-scope finding is fixed at `ebfccc6e1`, against its merge base `54f833e4b` (#627):
  - A-019, A-047 and AW17 / F-135.
  - The founder's AW17, F1 (with one gap, named under *Not covered*), F3 and "Merge when audited". F2 is built in PR-2, as his pick says.
  - The specs fail before the change and pass after it, the verifier passed, and the docs are true. The PR has 15 files and the worktree is clean.
- **Why it is held.** `origin/main` moved to `4528b9689` (#621, tables learned from the POS, ADR 0303) during this last call.
  - This branch now conflicts with main in `table-analytics.service.ts`, `report-export-cuttings.ts` and `rp-registers-house.tsx`.
  - A trial merge resolved all three by hand, so the conflicts themselves are mechanical. The result is saved at `p4-scratch/sim-run/fixes/audits/netsales-rehead-621-trial.patch`, and the trial was aborted.
  - The merged tree then fails two of #621's own records, because both assume the gross total:
    - **Three tests in `tables-learned-from-the-pos.spec.ts` fail:** "reads an unrecorded distance as absent", "keeps a feature recorded on enough tables" and "fits the table control over the checks at a hidden table too". Their `check()` fixture carries `total` and no `subtotal`, so under ADR 0295 no table and no server has a net check.
    - **The claims guard regresses ADR-0303-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES.** Its verify pins the exact gross line `if (c.table_id) { obs.y.push(c.total || 0); … }`. This PR must change that line to `if (c.table_id && net !== null) { obs.y.push(net); … }`.
  - Fixing both means editing two files outside this PR, which makes **17 files, over the 15-file cap**. A plain `merge_main.sh` re-head cannot land this PR.
- **Proposed path (the coordinator's call; nothing here is a product choice):**
  1. **Precursor PR P0, two files, inert on main.**
     - `tables-learned-from-the-pos.spec.ts`: the `check()` fixture gains `subtotal: over.total ?? 100`. In the trial, that one line took the spec to 28/28.
     - `claims.d/feat-tables-learned-from-the-pos.jsonl`: ADR-0303-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES's verify accepts either the gross push or the net push (`const net = tallySale(a, c);` and `if (c.table_id && net !== null) { obs.y.push(net); … }`). It still fails if `hidden` appears in `getWaiterPerformance`, or if the push gains any other guard.
     - A prototype is at `p4-scratch/sim-run/fixes/audits/netsales-rehead-621-claim-verify.py`. It exits 0 on main's gross code and on the merged net code. It exits 1 with an extra guard on the push and with a `hiddenIds` filter.
     - Once #615 lands, a later PR can tighten the verify to the net shape only.
  2. **Re-head #615 onto main + P0**, applying the trial resolution:
     - **`table-analytics.service.ts`.** Keep #621's shown/hidden/without-table counting, then tally with `tallySale` into a `Map<string, SalesTally>`. In hot tables, keep #621's hidden skip, then compute `netSalesOf` spend and pace. Keep both helper blocks (`SalesTally` … `salesOf`, and #621's `recorded()`).
     - **The seats basis line in the export and the web.** It becomes "Checks the till attributed to a shown table over the last N days; voided checks left out." followed by the net basis sentence. This keeps #621's pinned words "the till attributed to a shown table" and drops "Non-voided pos_checks", which ADR-0295-REPORTS-LABEL-NET-IN-OWNER-WORDS forbids in the export.
     - **`rp-registers-house.tsx`.** Keep both the `net` flag and #621's four counts in the interface and the select. The notes are `...roomNotes` plus the partial-net note, null-filtered.
     - With P0's two changes in the trial tree:
       - the four PR specs plus #621's spec: 108/108;
       - `ReportsNext.test.tsx` plus #621's `tables-learned-from-the-pos.test.tsx`: 95/95;
       - gateway `tsc`: 0 errors, `@simplewebauthn` aside;
       - web `tsc`: clean apart from that.
     - Not yet run on the trial: the claims guard with P0's verify in place (it regressed before P0), the wider suites, lint and the guards.
  3. **#609 cap still conflicts** in `goals.service.ts` and `table-analytics.service.ts` (select lines only; see *Merge order*). ADR 0295 has cap merging first, so #615 is re-headed again after #609 in any case.
  - Rejected alternatives:
    - **Ask for a 17-file exception for #615.** It mixes another ADR's records into this PR.
    - **Drop files from #615.** No file can move: the scenario verifier, the exports and the registers must change with the gateway, or each reports the old basis.

---

## What was wrong for the owner

On Tuzlu Rüzgar, every owner sales figure on /reports read `pos_checks.total`. That figure is the gross check: net sales plus 8.63% sales tax and a 4% surcharge, so it runs 12.63% over net on every check (the generator writes `total = round(sub*1.0863 + sub*0.04, 2)`). The till already stores the net figure in `pos_checks.subtotal`, written at ingest (`pos-hub.service.ts:516`), but no analytics reader selected it. /team reads `server_sales.net_sales`, so the same server had two sales figures about 11% apart, and neither page said which was which.

- **A-019 (major).** Over 35 days, the till register *Through the till* printed **'Taken' $23,680.47** and **'Average check' $180.77** across 131 checks.
  - Net sales over those same checks were **$21,025, or $160.50 a check**.
  - The 43-day window read $134,601.79 against a subtotal of $119,508.
  - The server table's 'Avg check' read $185.3 to $188.3 on the same gross basis.
  - The register said it answered "What guests actually paid", but it did not: guests paid $26,722.63 with tips.
  - No page showed net sales.
- **A-047 (minor).** The server table's 'Tip' divided tips by the gross total and read **12.75%**. Tips are **14.4% of net sales**.
- **AW17 / F-135.** The till's basis line printed the column name `pos_checks.total`.

## What changed and why

The founder ruled that owner sales figures read net sales (AW17). This PR builds that for the till window, the `avg_check` goal metric, the table, server and hot-table registers, the scenario verifier, and the three /reports registers and their exports. Every one of them goes through one fold.

- **One fold: `apps/api-gateway/src/analytics/net-sales.ts` (new).**
  - `netSalesOf(check)` reads only the subtotal. A subtotal that is missing, empty or not a number gives `null`, never 0 and never the total.
  - `foldNetSales(checks)` returns `{netSales, netChecks, checks}`. `netSales` is `null` ("not recorded") when there were checks and none carried a subtotal. It is `0` only when there were no checks.
  - `netAverage` divides by `netChecks`. This is F1, "Count and say".
  - `NET_SALES_BASIS` reads: *"Net sales: what the checks came to before tax and surcharge. Voided checks are left out."* That is AW17's wording. It claims nothing about discounts (F3).
- **The till window and the goal metric (`goals.service.ts`).**
  - `pos_revenue` selects `subtotal` instead of `total`, and folds by day and over the window.
  - `GET /analytics/pos-revenue` keeps the key `revenue`, which is now net. It adds `basis: 'net'` and `netCheckCount`. Each `dailySeries` row is `{date, revenue | null, checks, netChecks}`.
  - The `avg_check` goal metric is labelled "Average check (net)" and divides by `netChecks`.
  - When a window has checks and none carried a subtotal, `avg_check` refuses with a sentence instead of reading $0 or the gross figure:
    - `createGoal` answers with a 400.
    - The goals list marks the goal unreadable and gives the sentence (200).
    - The one-goal route `GET /analytics/goals/:rid/:goalId/progress` answers with a 500 (*Not covered*).
    - Both goal producers catch the throw.
- **The table, server and hot-table registers (`table-analytics.service.ts`).**
  - `loadChecks` selects `subtotal` instead of `total`.
  - One `SalesTally` replaces two copies of the tally. Revenue, average check, revenue per seat and revenue per cover are net.
  - **The tip rate is tips over the net of the checks that recorded a tip** (A-047), not over `totalWithTip`.
  - **Tips per seat counts every recorded tip**, whether or not the check carried a subtotal. Tips per seat is tips over seats, so the subtotal has no bearing on it. Spec g8c went from 0 to 6.
  - Standings need at least three checks that carried net. The waiter lift is fitted on net, and a check with no subtotal stays out of the fit instead of entering it at $0.
  - Hot-table pace is net per minute. An open check with no subtotal has `null` pace and spend.
  - `GET /analytics/table-performance`, `/analytics/waiters` and `/analytics/hot-tables` add `basis: 'net'`. Table and server rows add `netChecks`.
  - A mapped table that took no check now reads `revenuePerSeat` 0 where it read `null` (ADR 0295 rule 6). Nothing draws it.
- **The /reports registers (`rp-registers-trade.tsx`, `rp-registers-house.tsx`).**
  - They draw the net labels only when `basis === 'net'`: 'Taken (net)', 'Average check (net)', 'Avg check (net)' and 'Tip rate (on net)'.
  - The basis line is in the owner's words, and no column name reaches the page.
  - A partial figure says "from N of M checks". A day, table or server with checks but no net figure reads "not recorded".
  - The till's *answers* line reads "What the house sold, day by day, before tax and surcharge".
  - Gating the labels on `basis` keeps every label true while the web and the gateway deploy separately.
- **The exports (`report-export-cuttings.ts`).** The till, seats and service exports use the same labels and the same basis, and they add notes for partial rows. A payload without `basis` keeps the old words.
- **The scenario verifier (`scenario-verify.service.ts`).** `analytics.pos_revenue` now compares the window's net with the sum of the subtotals of the expected checks that were posted and not voided. Before, it compared with the gross `totals.revenue`. With no expected subtotal, it reports that it cannot verify.

### Why this shape

- **The PR keeps `revenue` and adds `basis` instead of renaming the key.** A rename would blank the deployed web between the gateway deploy and the web deploy.
- **It never falls back to `total`.** That would print a gross number under a net label, which is a fabricated figure (ADR 0020).
- **It counts partial checks instead of blanking the day.** Under all-or-nothing, a Clover house would show no sales at all. The founder picked counting (F1).

## Founder answers this PR builds (verbatim picks)

- **AW17**, AskUserQuestion 2026-10-04 ~00:15Z: *"Net sales (Recommended)"*. The option read: 'Use the subtotal before tax and surcharge, as /team already does and as restaurant P&Ls do. The tip rate is on net. Every figure is labelled net.'
- **F1**, AskUserQuestion 2026-10-04 ~20:50Z: *"Count and say (Recommended)"*. Sum the checks that carried a subtotal, and say "from N of M checks" when N < M and "not recorded" when none did. Averages divide by the counted checks only. This applies on every surface and supersedes ADR 0290 rule 2. It is built on every surface in this PR except the `avg_check` goal (*Not covered*).
- **F2**, same set: *"Read net, say why (Recommended)"*. No stored value changes, and the card says "set on totals with tax; now measured net". **This card is built in PR-2**, as the pick says.
- **F3**, AskUserQuestion ~01:49Z 2026-10-06, raised by the review at `6f2f063ef`: *"Ship now, PR-3 next (Recommended)"*. The option read: *"The #615 rework narrows the page sentence to your words ('before tax and surcharge', no 'after discounts' claim) and adds a check that keeps failing until PR-3 fixes SimPOS. Until then, discounted SimPOS checks read high, on sim houses only. Net sales reaches Tuzlu soonest."*
  - Both parts are built: the sentence in every copy, and the open claim `ADR-0295-SIMPOS-SUBTOTAL-AFTER-DISCOUNTS`.
  - He rejected "PR-3 first" and "Basis per till".
- **Merging**, 2026-10-03: *"Merge when audited (Recommended)"*.

## ADR and claims

- **ADR 0295** (`0295-owner-sales-read-net.md`, new). The rulings are Locked and quoted verbatim. The method is Proposed.
  - It supersedes ADR 0290 rule 2 and adopts ADR 0287 rule 3 house-wide.
  - *Limits* names each POS adapter's subtotal with `file:line`.
  - The rework corrected rules 1, 5, 6 and 8 in place, with dated brackets.
  - The last call (`ebfccc6e1`, docs only) added three brackets:
    - rule 6 names the `revenuePerSeat` change;
    - *Limits* names a Clover house's 'Busiest by takings';
    - *Scope* names the three items the PR-2 plan does not hold yet: F1 on the `avg_check` goal, the `rec-forward.ts` label, and the 500.
- **`.planning/decisions/README.md`**: one new row for 0295. No existing row is edited.
- **`claims.d/fix-owner-sales-read-net.jsonl`** (new): 5 rows, 4 resolved and 1 open.
  - The till and the goal metric read the subtotal, never the total.
  - The server table and the tip rate read net, and the tip is counted before the `net === null` return.
  - The /reports labels say net in the owner's words.
  - The verifier's yardstick is net.
  - **Open:** `ADR-0295-SIMPOS-SUBTOTAL-AFTER-DISCOUNTS`. Its verify exits 1 today, so the build passes. It exits 0 on each of four PR-3 fix shapes, so the build goes red until PR-3 strikes the row. A comment-only mutation stays at 1, and a renamed or missing method cannot run.

## Tests, guards, harness

**Before and after** (builder, reproduced by the verifier):
- With the six touched sources and `net-sales.ts` at `117b085c4` and the specs at the head:
  - **4 of 80** gateway tests fail: g4, g8, g8c, g11;
  - **2 of 81** in `ReportsNext.test.tsx` fail: w1, w4.
- With the sources at `origin/main`: **16 of 80** and **4 of 81** fail.
- All pass at the head.
- The fixtures are Tuzlu-shaped: `total = subtotal × 1.1263`.

**At `ebee52ca6`** (builder and verifier; the only commit since is the docs-only `ebfccc6e1`):
- Gateway jest on the four PR specs (`pos-revenue`, `table-analytics.service`, `report-export-cuttings`, `scenario-verify.service`): **80/80**.
- Gateway jest over analytics, reports, simpos, notifications, calendar and team: **118 suites, 2111/2111**.
- Web vitest `ReportsNext.test.tsx`: **81/81**. Over reports and recommendations: **22 files, 464/464**.
- Gateway `tsc -p tsconfig.spec.json`: 0 errors apart from `@simplewebauthn`. Web `tsc`: only the known `@simplewebauthn/browser` error.
- Gateway eslint on 9 files: 0 errors, and 0 warnings on changed lines. Web eslint `--quiet` on 3 files: clean.
- The three shell guards, `check_platform_operator_routes.cjs` and `test_check_decision_claims.sh` (31 ok): pass.

**Re-run at last call:**
- Four PR specs: 80/80, and `ReportsNext.test.tsx`: 81/81. Both ran at `ebee52ca6`, before the docs commit.
- These ran at `ebfccc6e1`:
  - `check_decision_claims.sh`: **898 checked, 898 holding**.
  - `check_adr_numbers_unique.py`: 0295 is introduced, with no collision across 1729 refs.
  - `ownership_between(merge-base 54f833e4b, HEAD)`: **`[]`**. Against the moved `origin/main` as a two-dot base, it reports a README "edit". That is main's new #621 row, not this branch.
  - `git diff --check`: clean.
- All **44** `scripts/check_*.py` in `ci.yml` exit 0 with the ADR edit in the tree (`check_migration_order` with `--event pull_request --base-ref main`).
- `scripts/check_gateway_boots.sh`: **could not check here.** The build cannot resolve `@simplewebauthn/server`, the known gap in the worktree's node_modules. This PR adds no Nest provider (`net-sales.ts` is pure functions). CI runs the guard.

**Local Postgres harness:** not run. This PR has no migration and no SQL change, and no `audits/netsales-local-pg.txt` was written.

## Merge order

- **#621 tables: merged at `4528b9689` during this last call.** See the HOLD note at the top for the conflicts and the P0 plan.
- **#609 cap** conflicts in `goals.service.ts` and `table-analytics.service.ts`, on the select lines only. ADR 0295 has cap merging first. When resolving:
  - cap's `readWholeWindow` selects become `"id, subtotal, opened_at, closed_at, items"` and `"id, subtotal, opened_at, closed_at"`;
  - cap's `loadChecks` select becomes `"id, table_id, server_name, server_external_id, opened_at, closed_at, covers, subtotal, tip, items"`;
  - cap's `WholeReadError` rethrow stays inside the catch, and this branch's `avg_check` refusal stays after it.
  - Claims 1 and 2 accept cap's `id, ` prefix, and both fail if `total` survives.
- **#616 tz (ADR 0296)** conflicts in `goals.service.ts`, `pos-revenue.spec.ts`, `report-export-cuttings.ts`, `scenario-verify.service.ts` and `rp-registers-trade.tsx`. Whichever lands second must bucket the net fold by house day (`houseDayOf`), not by `substring(0, 10)`.
- **#625 hidden tables** (`table-analytics.service.ts`, `report-export-cuttings.ts`, `rp-registers-house.tsx`) and **#626 glass** (`goals.service.ts`, `table-analytics.service.ts`) conflict with this branch beyond what they conflict with main.
- **#617, #619 and #624** share files with this branch, but `git merge-tree` finds no conflict with it beyond their own conflicts with main.
- Every lane that adds a README row resolves by keeping both rows, in number order.

## Forks deferred

None at founder level. AW17, F1, F2 and F3 are all answered.

- **F2's card sentence** is in PR-2, per his pick. Until then, an `avg_check` goal set on gross reads about 11% lower on a taxed house, with no note. Tuzlu has no goals, and other houses were not measured.
- **F3**: PR-3 (`fix/pos-subtotal-means-net`) follows this merge, and the open claim pins the gap until it lands.
- **The re-head path** (P0 or an exception) is the coordinator's process call, not a founder fork.

## Not covered (CLAUDE.md §0.5)

- **The re-head onto #621** (top of this body). The trial resolution was tested only in part: claims with P0's verify, the wider suites, lint and the guards were not run on it.
- **F1 on the `avg_check` goal.** The goal reads net over the checks that carried it, but never says "from N of M checks", because the goal payload carries no counts. It refuses only when N = 0. F1 says every surface, so this is owed. It is named in ADR 0295 *Scope* for the goal card with F2's note, but the PR-2 plan does not list it yet.
- **The 500 on `GET /analytics/goals/:rid/:goalId/progress`** for the `avg_check` refusal (controller `:882-893`; `createGoal` gives 400 at `:789-801`).
  - The mobile goal detail (`apps/mobile/src/api/queries.ts:353`) would get it on a house whose window has checks and no subtotal. Tuzlu always carries a subtotal.
  - Fixing it needs the controller, which would be a 16th file. ADR 0295 *Scope* puts it with PR-2's controller edit.
- **Readers that still read gross until PR-2:**
  - the insight generator's sales lines and ADR 0272's `sumSq` (`insight-generator.service.ts`);
  - the daily sale-record producer (`sale-record.producer.ts`). Its `revenueBasis` metadata at `:189` claims the same definition as `computeMetricWithSeries`, which is now untrue.
  - Until PR-2, an insight and the till disagree about the same days by 12.63% on Tuzlu.
- **Surfaces that show net without saying so, until PR-2:**
  - the recommendations ribbon, which also turns a `null` day into $0 (`useRecommendationsNextData.ts:910`; Tuzlu has no such day);
  - the web label 'Average check' at `rec-forward.ts:72`.
- **Sentences now untrue, in files this PR does not touch:**
  - `analytics.controller.ts:1040` (Swagger: "Sum of non-voided `pos_checks.total`");
  - `report-cuttings.ts:79` and `goal-scenarios.ts:204` ("What guests actually paid", while the web now says "before tax and surcharge");
  - `.planning/06-pages/reports.md:123`.
  - The basis sentence exists in `net-sales.ts` and in the web registers, and no test pins the copies equal. The specs pin each copy's wording.
- **A Clover house** (every subtotal null): the seats register's 'Busiest by takings' names whichever table that took a check comes first, because the gateway sorts a `null` net as 0. No production house runs Clover as far as the walk saw. Not fixed.
- **SimPOS** reads net above what a discounted or comped check took, until PR-3. The founder accepted this in F3. Per his ruling it affects sim houses only, it was not verified against production, and the open claim pins it.
  - Square (`pos-adapters.ts:113`) and Toast (`:203`): their subtotals are unmeasured.
  - Clover (`:159`) reads "not recorded".
- **/calendar and /dashboard** do not use `foldNetSales` yet. A convergence follow-up after ADRs 0287 and 0290 merge points them at it.
- **What stays gross on purpose:**
  - `dev-truth.service.ts`: dev only.
  - The scenario verifier's per-check comparison of stored `total` with expected `total`: it checks ingest, not a sales figure.
- **The row cap is separate.** Until #609, the 90-day registers are net but read at most 1,000 checks.
- **Deploy skew.**
  - An old web on a new gateway prints net figures under the old labels until the web deploys.
  - A new web on an old gateway is right, except for the till's fixed *answers* line.
- **Present before this branch, not changed here:**
  - `tipPerSeat` reads 0 for a till that sends no tips (SimPOS sends `tip: null`).
  - The correlation matrix's `Number(null)` turns a null measure into 0. #621's `recorded()` fixes that on main, and the fix arrives with the re-head.
- **Commit `1cd0d5880`'s body** says "Each of five PR-3 shapes exits 0". There were four fix shapes and one comment-only mutation (which stays at 1). History is not rewritten, and the ADR and claim text are exact.
- **Not run:**
  - a Browser-pane render (the vitest DOM tests w1 to w4 stand in for it);
  - `check_gateway_boots.sh` (it could not check here; see above);
  - the `scripts` pytest suite;
  - pgtest (no SQL);
  - any production read.
  - "Sim houses only" and "Tuzlu unaffected" rest on the `6f2f063ef` adjudication.
- **Memory pointer** ("AW17, F1, F2 and F3 are in ADR 0295") not written: memory is outside the lane worktree.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
