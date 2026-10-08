> **[2026-10-07 21:49Z, fixer, push note for local head `b69daa588`]**
>
> This is the only note. The earlier notes (12:35Z, 14:12Z, 20:02Z) are superseded and kept, unedited, in `note-tablesins.superseded-2026-10-07.md` beside this file.
>
> Not pushed (the coordinator pushes). The live PR head is `1a62bec78` (`gh pr view 625 --json headRefOid,body`, read 2026-10-07 21:30Z), an ancestor of `b69daa588`. Its GitHub base is still `feat/tables-learned-from-the-pos`; the coordinator retargets it to `main`. Against `origin/main` (`a323cc80b`) the PR has 11 files (`git diff --name-only origin/main...HEAD | wc -l`). No SQL file is in the diff.
>
> **Commits since the live head `1a62bec78`** (`git log --first-parent 1a62bec78..b69daa588`, oldest first):
> - `0792e1f94`: merges #621's last tip `cc0935f18`. Three conflicts; each kept #621's later text plus this PR's hunks.
> - `8477ab318`: merges `origin/main` at `42fe1252b`, after #621 squash-merged as `4528b9689`.
> - `12468fc92`: the founder's first ruling, *"F-test at alpha (Recommended)"* (asked 2026-10-06 19:57:41Z, answered 2026-10-07 04:15:17Z). Adds `fUpperTail`, `regularizedIncompleteBeta` and `regressionSignificance` to `engine/comparisons.ts`.
> - `f70f9a738`: the founder's second ruling, *"F-test + r² > 0.15 (Recommended)"* (answered 2026-10-07 12:02:43Z; rejected *"F-test only"*). Adds `driverSentencePrints`, `DRIVER_MIN_R2` and `DRIVER_AVERAGES_REL_TOL`.
> - `de7cc484a`: merges `origin/main` at `5e6c0684e` (#620). No conflict.
> - `57b4bde7b`: merges `origin/main` at `b270a45b8` (#609). One conflict, the version history: main's 6 kept verbatim, a line holding 7 for #619, this branch's 8.
> - `919a6c4a0`: answers the verify of `de7cc484a`. Three call-site spec cases (k, the test's n, the record's n), item 3's r² gaps re-measured, and the driver claims row pins `n: fitRows.length`.
> - `11bc4e8ea`: merges `origin/main` at `ca3582988` (#649). One conflict, in `claims.d/feat-tables-learned-from-the-pos.jsonl`: the waiter-control row was taken whole from main, and this branch's four rows follow it.
> - `1181f3dc5`: answers the verify of `919a6c4a0`, ADR prose only. Adds ruling residual 6 and brackets item 3's "three times".
> - `1b54b553f` (new): merges `origin/main` at `a323cc80b` (#613). No conflict. It shares no file with this PR: it brought `organizations/*`, `settings-audit/*`, the location editor, ADR #613's file, its README row and `claims.d/feat-house-state-in-location-editor.jsonl` (7 rows).
> - `b69daa588` (new): answers the verify of `1181f3dc5`, ADR 0303 prose only. Both changes are brackets added in place, with the old words kept:
>   - Ruling residual 6. The weight is exactly 0 only when the column's computed standard deviation is exactly 0 (`engine/regression.ts:105`). A distance that is not exact in binary gives 0, or a weight of order 1e-48 to 1e-39 of either sign. It prints as "(+0.00)" or "(−0.00)".
>   - Counted in k, the constant column raises p, or at n − k − 1 < 1 removes the test and the sentence. Item 3's generic "only raise p" is narrowed the same way.
>   - The residual round's review-trail row gets a bracket naming what the #649 merge brought, and a new trail row records this round.
>
> **The throwaway test** (task item 2). A spec through the real generator was run, then deleted from the worktree (`git status` clean). A copy and its output are kept in `p4-scratch/sim-run/fixes/probes/tablesins-residual6-2026-10-07/`.
> - (a) Each constant was run on 5 to 40 fitted tables: 0.1, 2.675, 7.3, 16.89, 42.2 and 123.45 m, plus 4 m as a control. Each fixture also had one kitchen-only ranked table and one bar-only ranked table at another distance, so bar distance is kept. That makes 252 fits, and every one printed.
>   - Of the 216 non-exact fits, 158 gave a non-zero bar weight and 83 of those were negative. The largest |weight| was 1.88e-39 and the smallest non-zero was 3.2e-48.
>   - Every fit on 9 tables or fewer gave exactly 0. The 4 m control gave 0 on all 36.
>   - The sentence named bar distance "(+0.00)" or "(−0.00)" and no other figure.
>   - r² equalled the kitchen-only fit bit for bit on all 252. p was 31 to 582 times higher.
>   - The column's computed spread for 16.89 m (node, the engine's `mean`/`variance` order): 0 over 5 and 9 rows, 3.7e-15 over 10 and 12. For 42.2 m it was 7.5e-15 over 9 rows.
> - (b) Five fitted tables with kitchen distance and seats varying, bar 4 m and outdoor false print *"kitchen distance (+0.82), seats (+0.44)"* at r² 0.99986, p 0.00014 on (2, 2). Add a sixth ranked table recording only bar 9 m and outdoor true, and k becomes 4 on n = 5: `regressionSignificance` is null and nothing prints.
> - **No printed nonsense magnitude.** The printed sign of a zero is arbitrary: "(−0.00)" printed in 83 of 216 fits. No code was changed. Whether "(−0.00)" counts as a nonsense weight is the coordinator's call (see notDone).
>
> **Results at `b69daa588`:**
> - Gateway jest, `cd apps/api-gateway && env LC_ALL=C npx jest src/analytics src/common/read-whole-window.spec.ts`: Test Suites 58 passed, 58 total; Tests 940 passed, 940 total.
>   - `hidden-tables-leave-insights.spec.ts` alone: 26/26.
>   - With `tables-learned-from-the-pos.spec.ts`: 2 suites, 54/54.
>   - `jest --findRelatedTests` on the merged gateway files does list `tables-learned-from-the-pos.spec.ts` and `read-whole-window.spec.ts` (transitive imports). Both are in the run above and pass.
> - Web vitest, `cd apps/web && env LC_ALL=C npx vitest run src/pages/settings/next/tables-learned-from-the-pos.test.tsx`: 15/15.
> - tsc:
>   - Gateway (`-p tsconfig.spec.json`): only the 2 known `@simplewebauthn/server` TS2307 in `passkeys.service.ts`.
>   - Web: only the known `@simplewebauthn/browser` TS2307 in `src/services/api/passkeys.ts`.
> - eslint:
>   - Gateway: rc 0 on the generator, its spec, `engine/comparisons.ts`, `table-analytics.service.ts`, `tables-learned-from-the-pos.spec.ts` and `analytics.controller.ts`. The controller shows 6 prettier warnings, at lines 87, 99, 354, 458, 861 and 1416.
>   - Web: rc 0 on `PosSection.tsx` and its test (`--resolve-plugins-relative-to p4-scratch/web-lint`).
> - `prettier --check`: the controller, `PosSection.tsx` and the web test are flagged, and the same three are flagged at `origin/main` (checked via stdin with each path's config). The other five changed TypeScript files are clean.
> - Content guards: all eight pass their run and `--self-test`. They are `check_read_columns_exist`, `check_queried_tables_exist`, `check_windowed_figures`, `check_analytics_cost_honesty`, `check_read_errors_not_swallowed`, `check_a_count_is_recorded`, `check_web_reads_gateway_dto_keys` and `check_route_exposure`.
> - `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers` and `check_adr_numbers_unique`: `--self-test` rc 0.
> - `cd /Users/aldemirkonuk/Projects && bash p4-scratch/sim-run/fixes/tools/lanecheck.sh wt-fix-tablesins`: exit 0.
>   - rc=0 on all six checks: migration order, migration versions unique, OD ids, conflict markers, citation pairing, ADR numbers.
>   - files=11; ownership `[]`; merge-base `a323cc80b`.
> - Two guards still cannot run here:
>   - `check_beverage_identity_parity` fails with `No module named 'psycopg2'`.
>   - `check_definer_functions_closed` exits 2 (CANNOT CHECK).
> - **Not run:** `scripts/check_decision_claims.sh`. This round was told not to run it. The last run was 925 checked, 925 holding, PASS, at `1181f3dc5`. Since then this branch changed no claims row, and the #613 merge added 7 rows in a file this PR does not touch.
>
> **What the delta re-audit must check:**
> 1. `1b54b553f` is a clean merge of `origin/main` at `a323cc80b`. Check that `git diff --name-only 1181f3dc5 1b54b553f` shares no path with `git diff --name-only origin/main...b69daa588` (the 11).
> 2. `b69daa588` touches one file (`git show --stat`). `git diff --word-diff=porcelain 1b54b553f b69daa588` should remove no word; the only two `-` tokens are `p,` and `spread),`, where a bracket was inserted before the punctuation.
> 3. Residual 6's figures reproduce:
>    - Copy `probes/tablesins-residual6-2026-10-07/zz-throwaway-residual6.spec.ts` into `apps/api-gateway/src/analytics/insights/`.
>    - Run it with `PROBE_OUT=… PROBE_OUT_B=…`, then delete it.
>    - Expected: 216/158/83, max 1.88e-39, r² equal on all 252, p ratio 31-582, and (b) printing without the sixth table and nothing with it.
>    - Separately: is the claim "only the two distances can do this" (seats and outdoor are whole numbers) true for every way `TABLE_DRIVERS` reads them? `recordedNumber` takes `Number(v)` of whatever the row holds.
> 4. Item 3's bracket ("or, when they leave n − k − 1 < 1, leave no test and no sentence") reads true against `regressionSignificance` (`comparisons.ts:638`) and `driverSentencePrints`.
> 5. Every replacement below matches the live body as `gh pr view 625` returns it, and no replacement drops an old word.
> 6. Run `check_decision_claims.sh` at `b69daa588`. It was not run this round.
>
> **Stale live-body lines and their exact replacements** (39 lines, plus two lines added after L91). Line numbers are from the live body read at 21:30Z. Each block is the whole new line. It is the old line with a dated bracket inserted, and nothing else changed. `p4-scratch/sim-run/fixes/probes/tablesins-residual6-2026-10-07/build_replacements.py`, run against a snapshot of the live body in the same folder, checked this: removing each inserted bracket gives back the live line byte for byte.
>
> **L1**, whole new line:
> ```
> > **Stacked on #621** (`feat/tables-learned-from-the-pos`, head b440d85fa). [2026-10-07: #621 squash-merged as 4528b9689. This branch merged #621's last tip cc0935f18 (0792e1f94) and then origin/main, last at a323cc80b (#613, 1b54b553f). Base: main.]
> ```
> **L2**, whole new line:
> ```
> > - Open this PR against #621's branch, or against main once #621 has squash-merged and this branch has been rebased with `git rebase --onto origin/main b440d85fa`. [2026-10-07: retarget to main. No rebase was done or is needed: the branch merged main instead, and `git diff origin/main...HEAD` is this PR's own change.]
> ```
> **L3**, whole new line:
> ```
> > - Branch `fix/hidden-tables-leave-insights` is at 1a62bec78 [2026-10-07: now at b69daa588; lane commits since 1a62bec78: 12468fc92, f70f9a738, 919a6c4a0, 1181f3dc5, b69daa588; merges 0792e1f94, 8477ab318, de7cc484a, 57b4bde7b, 11bc4e8ea, 1b54b553f], with two lane commits: 29b571592 (the fix) and 1a62bec78 (prose and comments from the last call). Pushed 2026-10-05 by the fix-lane coordinator; CI runs once this PR is retargeted to `main`.
> ```
> **L4**, whole new line:
> ```
> > - The lane's own diff is 9 files. Against main it is 17 while stacked, because 15 of those are #621's. [2026-10-07: against origin/main (a323cc80b) the PR is 11 files: the nine, plus ADR 0272 and `engine/comparisons.ts`.]
> ```
> **L29**, whole new line:
> ```
>   - The r² > 0.15 gate is kept. [2026-10-07: kept, with an F-test beside it, on the founder's two rulings. The sentence prints only when four things hold: the fitted tables' averages vary (beyond `DRIVER_AVERAGES_REL_TOL`, 1e-9 of the largest), the fit leaves a residual degree of freedom (n − k − 1 ≥ 1), its overall F-test passes at `SIGNIFICANCE_ALPHA` (0.05), and r² > `DRIVER_MIN_R2` (0.15). `driverSentencePrints` decides it (ADR 0303, *Ruling 2026-10-07*).]
> ```
> **L30**, whole new line:
> ```
> - **`INSIGHT_GENERATOR_VERSION` is 8** (ADR 0191), so stored rows from before are recomputed rather than served. [2026-10-07: main is at 6 (a323cc80b), and 7 is held for #619 (open, d96dcbf56). The two 2026-10-07 rulings stay at 8: version 8 has never been on main, so no version-8 row has been served.]
> ```
> **L44**, whole new line:
> ```
> - **Gateway: the new `hidden-tables-leave-insights.spec.ts`, 10 cases.** [2026-10-07: 26 cases now: 10 from the amendment, 7 from the first ruling, 6 from the floor round and 3 from the wiring round.]
> ```
> **L45**, whole new line:
> ```
>   - With this branch's generator, all 10 pass. [2026-10-07: 26 of 26 pass at b69daa588.]
> ```
> **L46**, whole new line:
> ```
>   - With b440d85fa's generator swapped in (from a `cp -p` snapshot, then restored and checked with `cmp`), 8 fail. The builder and the verifier each ran this. The 2 waiter-control cases pass on the base, which pins the kept behaviour. [2026-10-07: those are the first 10 cases. Against 12468fc92's generator, 6 of the floor round's 23 fail. The three call-site mutations (k as kept.length + 1, the test's averages from withAttrs, the record's n as withAttrs.length) each pass the 23-case spec at de7cc484a and fail the 26-case spec (2, 1 and 1 cases).]
> ```
> **L47**, whole new line:
> ```
>   - Mutations of the generator, each failing at least one case: the builder ran eight and the verifier ran ten. [2026-10-07: the later rounds add their own. The first ruling added six: the old gate back (4 fail), the equal-averages check dropped (1), n − k residual degrees of freedom (3), the beta's arguments swapped (5), alpha 0.2 (1) and n + 1 rows (2). The floor round added eleven and the wiring round three (ADR 0303 Evidence).] They cover:
> ```
> **L58**, whole new line:
> ```
> - **Gateway: the wider suites, re-run at 1a62bec78.** [2026-10-07, at b69daa588: `cd apps/api-gateway && env LC_ALL=C npx jest src/analytics src/common/read-whole-window.spec.ts`: Test Suites 58 passed, 58 total; Tests 940 passed, 940 total.] `src/analytics/insights`, `tables-learned-from-the-pos.spec.ts` and `table-analytics.service.spec.ts`: 15 suites, 196 tests, all pass. Earlier in the builder's session, order-schema-drift, goal-source-rule, pos-revenue, recommendation-round3 and dev-truth.controller also passed: 5 suites, 82 tests.
> ```
> **L60**, whole new line:
> ```
>   - `tsc --noEmit -p tsconfig.spec.json` reports only the known `@simplewebauthn/server` errors. [2026-10-07: the same at b69daa588: two TS2307 in `passkeys.service.ts`.]
> ```
> **L61**, whole new line:
> ```
>   - eslint returns rc 0 on the generator, its spec, `table-analytics.service.ts` and `tables-learned-from-the-pos.spec.ts`. [2026-10-07: rc 0 at b69daa588 on those four, `engine/comparisons.ts` and `analytics.controller.ts`.]
> ```
> **L62**, whole new line:
> ```
>   - The controller has 6 prettier warnings, the same count as on the base and all on lines this branch does not touch. [2026-10-07: still 6 at b69daa588, at lines 87, 99, 354, 458, 861 and 1416; this PR changes line 626. `prettier --check` flags the controller, `PosSection.tsx` and the web test, and it flags the same three at origin/main. The other five changed TypeScript files are clean.]
> ```
> **L64**, whole new line:
> ```
>   - `tables-learned-from-the-pos.test.tsx`: 14 of 14 pass (re-run at the last call) [2026-10-07: 15 of 15 at b69daa588]. The new case fails against b440d85fa's `PosSection.tsx`.
> ```
> **L65**, whole new line:
> ```
>   - `tsc` reports only the known `@simplewebauthn/browser` TS2307. [2026-10-07: the same at b69daa588, in `src/services/api/passkeys.ts`.]
> ```
> **L66**, whole new line:
> ```
>   - eslint returns rc 0. [2026-10-07: rc 0 at b69daa588 on `PosSection.tsx` and the test, run with `--resolve-plugins-relative-to` a scratch directory holding `eslint-plugin-jsx-a11y`.]
> ```
> **L68**, whole new line:
> ```
>   - Each of these passes its `--self-test` and its normal run: `check_read_columns_exist`, `check_queried_tables_exist`, `check_windowed_figures`, `check_analytics_cost_honesty`, `check_read_errors_not_swallowed`, `check_a_count_is_recorded`, `check_web_reads_gateway_dto_keys`, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_route_exposure` and `check_adr_numbers_unique`. [2026-10-07: all twelve again at b69daa588: the eight content guards, run and `--self-test`; the other four, `--self-test` and their run in `lanecheck.sh` (exit 0, with `check_migration_order` and `check_migration_versions_unique`).]
> ```
> **L69**, whole new line:
> ```
>   - The doc guards were re-run at 1a62bec78. [2026-10-07: and at b69daa588, above.]
> ```
> **L70**, whole new line:
> ```
>   - `env LC_ALL=C bash scripts/check_decision_claims.sh`: 866 checked, 866 holding (re-run at 1a62bec78). [2026-10-07: 925 checked, 925 holding, PASS, at 1181f3dc5 (`PATH=/usr/local/bin:$PATH`, run alone). It was not re-run at b69daa588. Since 1181f3dc5 this branch has changed no claims row; the #613 merge brought `claims.d/feat-house-state-in-location-editor.jsonl` (7 rows), which this PR does not touch.]
> ```
> **L71**, whole new line:
> ```
> - **Ownership.** `ownership_between` in `scripts/pr_audit_gate.py` returns released against both b440d85fa and origin/main (verifier). [2026-10-07: `lanecheck.sh`, by origin/main's classifier: ownership [] between merge-base a323cc80b and b69daa588.] No existing README row is touched.
> ```
> **L79**, whole new line:
> ```
>   - a new review-trail row. [2026-10-07: added since: the dated section *Ruling 2026-10-07* (both questions, the picks and the rejected options verbatim; items 1-9; residuals 4, closed, 5 and 6); in-place brackets on items 2-4 (item 3: "three times" is now about three times, 3.004 measured, and "only raise p" is narrowed), on residual 1, the Consequences and residual 6 (its zero weight and its k, corrected after the verify of 1181f3dc5); review-trail rows for the re-head, both rulings and their builds, and the floor, wiring, residual and zero-weight rounds. ADR 0272 gains one dated bracket stating the two-gate rule.]
> ```
> **L81**, whole new line:
> ```
>   The README row for 0303 belongs to #621 and is not touched. [2026-10-07: #621 has merged. Its row (README.md:212 at b69daa588) still says the insight-generator part "is owed to `fix/hidden-tables-leave-insights`". That goes stale when this PR merges. The row is not in this PR and needs a bracket after the merge.]
> ```
> **L85**, whole new line:
> ```
>   - Mutation checks: the builder ran 15 and the verifier ran 11. Each fails the row for the clause it breaks. [2026-10-07: `ADR-0303-THE-INSIGHT-DRIVERS-READ-ONLY-WHAT-WAS-RECORDED` now pins `driverSentencePrints`, both gates, the tolerance, the residual-df rule, the incomplete-beta tail, the call site's k and n, and the record's `n: fitRows.length`. It fails on 42fe1252b, 8477ab318 and 12468fc92, and under seventeen mutations (fourteen in the floor round, three in the wiring round). `ADR-0303-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES` is main's row as #649 rewrote it (11bc4e8ea took it whole); this PR does not change it.]
> ```
> **After L91**, add these two lines:
> ```
> - [Added 2026-10-07] Driver-fit significance rule (asked 2026-10-06 19:57:41Z, answered 2026-10-07 04:15:17Z): *"F-test at alpha (Recommended)"*; rejected *"Keep r² > 0.15"* and *"≥3 tables per attribute"*.
> - [Added 2026-10-07] Effect floor (answered 2026-10-07 12:02:43Z): *"F-test + r² > 0.15 (Recommended)"*; rejected *"F-test only"*.
> ```
> **L93**, whole new line:
> ```
> ## Forks deferred (the founder's call, not made here) [2026-10-07: none open. The one below was answered twice; see Founder answers.]
> ```
> **L95**, whole new line:
> ```
> - **The driver fit has no significance rule.** The r² > 0.15 gate is kept, as the spec says, but it is not a significance test: 5 tables and up to 4 attributes can fit almost exactly. This is recorded as amendment residual 1. The base was looser and fitted as few as 4 tables on 4 zero-filled attributes. [Answered 2026-10-07: first (c), *"F-test at alpha (Recommended)"*, then *"F-test + r² > 0.15 (Recommended)"*, which keeps (a)'s gate beside the test as an effect floor. Built in 12468fc92 and f70f9a738. One method choice was not asked: whether a kept attribute that is constant inside the fit's rows should leave k and the sentence (ADR 0303 residual 6). It is not fixed here.]
> ```
> **L101**, whole new line:
> ```
> 1. **#621 first.** This branch is stacked on it, and the select names `hidden_at`, which only #621's migration adds. Against a database without that column, the tables slice fails with 42703. The failure is logged and the table insights go silent rather than wrong. The waiter adjustment still runs. After #621 squash-merges, run `git rebase --onto origin/main b440d85fa`. The 1a62bec78 hunks in #621's two files are comment-only. [2026-10-07: #621 has merged (4528b9689), with the migration that adds `hidden_at`. This branch merged it and main instead of rebasing. This lane did not check whether production has applied that migration.]
> ```
> **L102**, whole new line:
> ```
> 2. **#607 (version 5), #609 (6) and #619 (7) before this PR,** because this PR takes version 8. [2026-10-07: #607 (1884dea38) and #609 (b270a45b8) have merged, and main is at 6. #619 (7, head d96dcbf56) is open. If it lands first, this PR stays at 8; if this lands first, #619 takes 9, as this PR's version comment says.]
> ```
> **L103**, whole new line:
> ```
>    - All four PRs add a line to the same version-history comment above `INSIGHT_GENERATOR_VERSION`. Expect a conflict there and keep every line. [2026-10-07: #609's conflict was resolved in 57b4bde7b (main's 6 kept verbatim, a line holding 7 for #619). A `git merge-tree` of #619, #624 and #626 into b69daa588 conflicts in the generator only in regions where each already conflicts with main. This PR enlarges one of them, the version history, and adds no other.]
> ```
> **L104**, whole new line:
> ```
>    - #609's `readWholeWindow` hunk ends three lines above this PR's `restaurant_tables` select change. They are adjacent but do not overlap. [2026-10-07: #609 is merged in (57b4bde7b), and its reads and this PR's select merged without conflict.]
> ```
> **L105**, whole new line:
> ```
> 3. **Version-number collisions with unopened lanes.** These need the coordinator to sequence them. [2026-10-07: both lanes are now open PRs.]
> ```
> **L106**, whole new line:
> ```
>    - The units lane (`fix/a-glass-is-not-a-bottle`, `wt-fix-units`, ADR 0297, at e209d4148) also sets `INSIGHT_GENERATOR_VERSION = 8`, with its own history line. [2026-10-07: now PR #626, head d9b87752d, base `fix/analytics-reads-past-row-cap`. It still sets 8.]
> ```
> **L107**, whole new line:
> ```
>    - The stockcut lane (`fix/what-to-buy-back-runs-out-first`, `wt-fix-stockcut`, at 8d2a225b5) sets 7, which is #619's number. [2026-10-07: now PR #624, head 8d2a225b5, stacked on #619's branch `fix/stockout-counts-open-ml`. Its own diff does not touch the generator; the 7 comes from #619's commits beneath it.]
> ```
> **L108**, whole new line:
> ```
>    - Two branches that both change the constant from 7 to 8 merge silently on that line. Only the history block may conflict, and this PR's claim row checks `>= 8`, so it would not catch the clash. [2026-10-07: main is at 6, so this PR and #626 both change it from 6 to 8. #626 (d9b87752d) adds no claims row on the version.]
> ```
> **L110**, whole new line:
> ```
> 4. **Other overlaps.** #616 also edits `analytics.controller.ts` (around lines 1040 and 1063), well away from the PATCH description changed here. No other open PR touches `PosSection.tsx`, the web test, ADR 0303 or its claims file, except #621. [2026-10-07, open PRs read ~21:35Z: #616 (ae079c377) edits the controller at lines 1062 and 1085 of its merge base, and #564 (eadb562df) at lines 779-894; this PR changes line 626. #615 (6f2f063ef) edits `table-analytics.service.ts`. #619 and #624 edit ADR 0272, and #624 also edits `engine/comparisons.ts`. #619, #624 and #626 edit the generator (item 2). A `git merge-tree` of each into b69daa588 shows no conflict in any of this PR's files that it does not already have with main, except the version history. #621 has merged, and no open PR touches `PosSection.tsx`, the web test, ADR 0303 or its claims file.]
> ```
> **L115**, whole new line:
> ```
> - **Two guards could not run** in this worktree. `check_beverage_identity_parity` needs a `.env`. `check_definer_functions_closed` exits 2 (CANNOT CHECK) without a DB URL. Neither guard's scope is touched. [2026-10-07, at b69daa588: still not run. `check_beverage_identity_parity` now stops earlier, on `No module named 'psycopg2'`; `check_definer_functions_closed` still exits 2.]
> ```
> **L117**, whole new line:
> ```
> - **A kept attribute can be constant inside the fit's rows.** An attribute is kept on its variation across all ranked tables, but the fit runs over the tables that carry every kept value. Within those tables a kept column can be constant. It is then listed as a driver with weight 0 [Corrected 2026-10-07: the weight is exactly 0 only when the column's computed spread is exactly 0. A distance that is not exact in binary gives 0, or a weight of order 1e-48 to 1e-39 of either sign, which prints as "(+0.00)" or "(−0.00)" when among the first three (216 generator fits; no other figure printed). The column is still counted in the F-test's k, which leaves r² as it is and raises p, or at n − k − 1 < 1 removes the test and the sentence (ADR 0303, Ruling 2026-10-07, residual 6).]: no NaN, but a zero-weight name in the evidence. This is part of the deferred method fork above [2026-10-07: that fork was answered twice (Founder answers); this zero-weight name was part of neither question and is not fixed here.], and is no worse than the base [2026-10-07: with the F-test it is also counted in k, so it can withhold a sentence that the same fit without it would print; not compared with the base again.].
> ```
> **L119**, whole new line:
> ```
> - **The bundle's `restaurant_tables` read is unpaged,** so PostgREST's 1,000-row cap applies. This is amendment residual 3. Tuzlu is expected to have about 26 tables, which was not measured on production. [2026-10-07: the coordinator's read-only production dry run (round 2, 2026-10-05; ADR 0303 Consequences) measured 24 tables learned for Tuzlu under the digit rule (t1-t24); its 2 "booth" checks keep the word with no table. This lane did not read the table count after #621's backfill ran.]
> ```
> **L121**, whole new line:
> ```
> - **The 1a62bec78 changes were not independently verified.** They are comment and ADR prose only, made at the last call. They were checked with the analytics specs, eslint, the claims run and the doc guards, but no second agent reviewed them. [2026-10-07: every round since has had an independent verify. The last was of 1181f3dc5 ("should": two prose findings, answered in b69daa588). b69daa588 and the 1b54b553f merge have not been verified by a second agent.]
> ```
>
> Every other live-body line is still true at `b69daa588`: L5-28, L31-43, L48-57, L59, L63, L67, L72-78, L80, L82-84, L86-92, L94, L96-100, L109, L111-114, L116, L118, L120, L122-123. L96-97 (the options and the recommendation) stand as history under the bracketed L95.
>
> **Not done or not verified in this round:**
> - Nothing is pushed, and the live body is not edited (the replacements above are for the coordinator).
> - `check_decision_claims.sh` was not run (instruction).
> - No spec case pins residual 6 (no code change was asked).
> - The verify's own fixtures, its [0.9996, 0] and its 16.89-on-twelve weight of -6.9e-43, were not re-run. My 16.89-on-twelve fixture gave exactly 0, because the weight also depends on the averages.
> - README.md:212 (#621's row) goes stale on merge and is not touched (not in this PR).
> - No local Postgres run (no SQL). No Browser-pane check (no screen changed).
> - Production's `hidden_at` column was not checked.
> - The F-test's assumptions (ruling residual 5) are still stated, not measured.
