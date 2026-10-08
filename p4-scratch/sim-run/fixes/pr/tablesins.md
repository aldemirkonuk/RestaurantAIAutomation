> **Stacked on #621** (`feat/tables-learned-from-the-pos`, head b440d85fa).
> - Open this PR against #621's branch, or against main once #621 has squash-merged and this branch has been rebased with `git rebase --onto origin/main b440d85fa`.
> - Branch `fix/hidden-tables-leave-insights` is at 1a62bec78, with two lane commits: 29b571592 (the fix) and 1a62bec78 (prose and comments from the last call). Pushed 2026-10-05 by the fix-lane coordinator; CI runs once this PR is retargeted to `main`.
> - The lane's own diff is 9 files. Against main it is 17 while stacked, because 15 of those are #621's.

## What was wrong for the owner

Tuzlu Rüzgar's POS feed names 24 tables, T1 to T24, plus BOOTH. Before #621, `restaurant_tables` was empty, so all 3,593 checks had no table (A-051, A-055). #621 learns those tables from the till and lets an owner or manager hide one.

The founder ruled on F2 (2026-10-04 ~20:50Z), verbatim *"Out of every figure (Recommended)"*. The option text was *"Hidden means out of every table figure and ranking, insights included."* #621 built the room's part. The insight generator (`apps/api-gateway/src/analytics/insights/insight-generator.service.ts` @b440d85fa) did not:

- `byTable` took every check with a `table_id`, so a hidden table such as BOOTH, or a retired one, could be ranked #1. A retired table is not in the bundle's active-table read, so it had no label and printed as "Top table".
- The surge watch paced an open check with no table against every other table-less check, and printed it as "A table".
- The ridge driver step zero-filled the distances and the seat count (`?? 0`, :1303-1305) and read a NULL outdoor flag as indoors (:1306). On #621's learned tables, all of these values are NULL. With nothing recorded, the zero-filled fit had r² 0 and stayed under the gate. Once some tables record a distance and the learned ones do not, the zeros were fitted as if measured. On six synthetic tables this gave r² 0.30, above the gate (ADR 0303 residual 1).

## What changed and why

- **The table insights read only the tables the house shows.**
  - The one existing `restaurant_tables` read now also selects `hidden_at`. No query is added.
  - `shownTableIds` is the set of tables that are active and not hidden. It gates the per-table aggregate, which feeds `table.avg_check.peer_rank`, `.attribute_correlation` and `.driver_weights`. It also gates `table.revenue.hot_entity_live`.
  - Checks at a retired table, and checks with no table, leave these insights too, as they leave the room.
- **The waiter adjustment keeps hidden tables in its control.** The founder answered on 2026-10-05 (~01:39Z), verbatim *"Keep them in the control (Recommended)"*.
  - `byWaiter` takes every check that has a server, whatever its table.
  - The table-adjusted fit's observations (`waiterObs`) take every check with a server that also has a `table_id`, hidden or retired.
  - `engine/regression.ts` is unchanged.
- **The driver fit reads only recorded values (ADR 0051, ADR 0053).** The lane spec offered two ways, and this does both, as the room does:
  - An attribute is left out when it is recorded on fewer than 5 ranked tables (`DRIVER_MIN_RECORDED`, the room's number), or when it has the same value on all of them.
  - The fit runs only over the tables that carry every attribute kept, and needs at least 5 of them.
  - The r² > 0.15 gate is kept.
- **`INSIGHT_GENERATOR_VERSION` is 8** (ADR 0191), so stored rows from before are recomputed rather than served.
- **Copy.** Settings → Point of sale and the PATCH description now say three things: a hidden table leaves every table figure, the insights included; its checks stay in takings; and its checks stay in the servers' figures.
- **Last-call fixes (1a62bec78, comments and ADR only).**
  - The generator comment and the ADR amendment no longer say that a check with no table sits in the waiter control. Neither says any longer that `byWaiter` takes "every check with a `table_id`".
  - Three comments in #621's files (`table-analytics.service.ts` :88 and :320, `tables-learned-from-the-pos.spec.ts` :29) called the insights' part "owed, ADR 0303 residual 1". They now point at the 2026-10-05 amendment.

**For Tuzlu, after #621's backfill:**
- No seat count, distance or outdoor flag is recorded, so no driver insight is fitted.
- A table the owner hides, such as BOOTH or EVENT, leaves the ranking and the surge watch.

The verifier checked this with a throwaway spec shaped like Tuzlu: 24 learned tables with nothing recorded, BOOTH and EVENT hidden, and open checks at hidden tables and with no table. The result had no driver, correlation or surge insight, and no BOOTH or EVENT in any sentence. The rank still read "Table T7 ranks #1 of 24". The spec was deleted afterwards.

## Tests and guards

- **Gateway: the new `hidden-tables-leave-insights.spec.ts`, 10 cases.**
  - With this branch's generator, all 10 pass.
  - With b440d85fa's generator swapped in (from a `cp -p` snapshot, then restored and checked with `cmp`), 8 fail. The builder and the verifier each ran this. The 2 waiter-control cases pass on the base, which pins the kept behaviour.
  - Mutations of the generator, each failing at least one case: the builder ran eight and the verifier ran ten. They cover:
    - the control drops hidden tables;
    - the rank keeps hidden tables;
    - the surge watch keeps hidden tables;
    - a threshold of 4;
    - a NULL read as 0;
    - a NULL outdoor flag read as indoors;
    - a constant attribute kept;
    - the fit keeps a table that is missing a kept value;
    - version 7;
    - the select drops `hidden_at`.
- **Gateway: the wider suites, re-run at 1a62bec78.** `src/analytics/insights`, `tables-learned-from-the-pos.spec.ts` and `table-analytics.service.spec.ts`: 15 suites, 196 tests, all pass. Earlier in the builder's session, order-schema-drift, goal-source-rule, pos-revenue, recommendation-round3 and dev-truth.controller also passed: 5 suites, 82 tests.
- **Gateway typecheck and lint.**
  - `tsc --noEmit -p tsconfig.spec.json` reports only the known `@simplewebauthn/server` errors.
  - eslint returns rc 0 on the generator, its spec, `table-analytics.service.ts` and `tables-learned-from-the-pos.spec.ts`.
  - The controller has 6 prettier warnings, the same count as on the base and all on lines this branch does not touch.
- **Web.**
  - `tables-learned-from-the-pos.test.tsx`: 14 of 14 pass (re-run at the last call). The new case fails against b440d85fa's `PosSection.tsx`.
  - `tsc` reports only the known `@simplewebauthn/browser` TS2307.
  - eslint returns rc 0.
- **Guards.**
  - Each of these passes its `--self-test` and its normal run: `check_read_columns_exist`, `check_queried_tables_exist`, `check_windowed_figures`, `check_analytics_cost_honesty`, `check_read_errors_not_swallowed`, `check_a_count_is_recorded`, `check_web_reads_gateway_dto_keys`, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_route_exposure` and `check_adr_numbers_unique`.
  - The doc guards were re-run at 1a62bec78.
  - `env LC_ALL=C bash scripts/check_decision_claims.sh`: 866 checked, 866 holding (re-run at 1a62bec78).
- **Ownership.** `ownership_between` in `scripts/pr_audit_gate.py` returns released against both b440d85fa and origin/main (verifier). No existing README row is touched.
- **Local Postgres.** This lane changes no SQL, so it has no harness run of its own. The verifier ran `pgtest.sh lane … tablesins` on #621's test (template 28d32de36): `[fix] PASS 20261220110000_tables_learned_from_the_pos_test.sql`, and `[ctl]` FAILs with `column table_ref of relation pos_checks does not exist`, as expected.

## ADR / CLAIMS touched

- **ADR 0303:**
  - a dated section, *Amendment 2026-10-05*, that quotes both answers verbatim;
  - in-place brackets on the Decision "Hidden" bullet, the recorded-only bullet and residual 1;
  - a new review-trail row.
  
  The README row for 0303 belongs to #621 and is not touched.
- **`claims.d/feat-tables-learned-from-the-pos.jsonl`:**
  - Four new rows: `ADR-0303-HIDDEN-TABLES-LEAVE-THE-INSIGHTS`, `ADR-0303-THE-INSIGHTS-WAITER-CONTROL-KEEPS-HIDDEN-TABLES`, `ADR-0303-THE-INSIGHT-DRIVERS-READ-ONLY-WHAT-WAS-RECORDED` and `ADR-0303-INSIGHT-GENERATOR-VERSION-8`.
  - The claim text of `ADR-0303-THE-ROOM-COUNTS-WHAT-IT-LEAVES-OUT` now points at the first new row.
  - Mutation checks: the builder ran 15 and the verifier ran 11. Each fails the row for the clause it breaks.
  - All four new rows fail on the b440d85fa generator.

## Founder answers (verbatim)

- F2, 2026-10-04 ~20:50Z: *"Out of every figure (Recommended)"*. The option text was *"Hidden means out of every table figure and ranking, insights included."*
- Hidden tables in the waiter adjustment's control, 2026-10-05 ~01:39Z: *"Keep them in the control (Recommended)"*.

## Forks deferred (the founder's call, not made here)

- **The driver fit has no significance rule.** The r² > 0.15 gate is kept, as the spec says, but it is not a significance test: 5 tables and up to 4 attributes can fit almost exactly. This is recorded as amendment residual 1. The base was looser and fitted as few as 4 tables on 4 zero-filled attributes.
  - **Options:** (a) keep the r² gate; (b) require degrees of freedom, for example at least 3 tables per kept attribute; (c) an F-test on the fit at the program's `SIGNIFICANCE_ALPHA`, as ADR 0272 does for rankings and pairings.
  - **Recommendation:** (c). It matches how ADR 0272 already gates the other table sentences.

## Merge-order notes

1. **#621 first.** This branch is stacked on it, and the select names `hidden_at`, which only #621's migration adds. Against a database without that column, the tables slice fails with 42703. The failure is logged and the table insights go silent rather than wrong. The waiter adjustment still runs. After #621 squash-merges, run `git rebase --onto origin/main b440d85fa`. The 1a62bec78 hunks in #621's two files are comment-only.
2. **#607 (version 5), #609 (6) and #619 (7) before this PR,** because this PR takes version 8.
   - All four PRs add a line to the same version-history comment above `INSIGHT_GENERATOR_VERSION`. Expect a conflict there and keep every line.
   - #609's `readWholeWindow` hunk ends three lines above this PR's `restaurant_tables` select change. They are adjacent but do not overlap.
3. **Version-number collisions with unopened lanes.** These need the coordinator to sequence them.
   - The units lane (`fix/a-glass-is-not-a-bottle`, `wt-fix-units`, ADR 0297, at e209d4148) also sets `INSIGHT_GENERATOR_VERSION = 8`, with its own history line.
   - The stockcut lane (`fix/what-to-buy-back-runs-out-first`, `wt-fix-stockcut`, at 8d2a225b5) sets 7, which is #619's number.
   - Two branches that both change the constant from 7 to 8 merge silently on that line. Only the history block may conflict, and this PR's claim row checks `>= 8`, so it would not catch the clash.
   - Whichever lane lands second must move to the next free number and update its history line and its claims row.
4. **Other overlaps.** #616 also edits `analytics.controller.ts` (around lines 1040 and 1063), well away from the PATCH description changed here. No other open PR touches `PosSection.tsx`, the web test, ADR 0303 or its claims file, except #621.

## Not covered (CLAUDE.md §0.5)

- **No Browser-pane check of the Settings copy.** It is covered only by the vitest render.
- **Two guards could not run** in this worktree. `check_beverage_identity_parity` needs a `.env`. `check_definer_functions_closed` exits 2 (CANNOT CHECK) without a DB URL. Neither guard's scope is touched.
- **No local Postgres harness run for this lane,** because no SQL changed. Nothing was appended to `audits/tablesins-local-pg.txt`. The only run is the verifier's run of #621's test, quoted above.
- **A kept attribute can be constant inside the fit's rows.** An attribute is kept on its variation across all ranked tables, but the fit runs over the tables that carry every kept value. Within those tables a kept column can be constant. It is then listed as a driver with weight 0: no NaN, but a zero-weight name in the evidence. This is part of the deferred method fork above, and is no worse than the base.
- **`getHotTables` (the room) still lists a retired table's open checks, unlabelled.** The surge insight no longer watches them. This is amendment residual 2.
- **The bundle's `restaurant_tables` read is unpaged,** so PostgREST's 1,000-row cap applies. This is amendment residual 3. Tuzlu is expected to have about 26 tables, which was not measured on production.
- **`availability` still counts every active table,** hidden ones included. It is left as an upper bound on purpose.
- **The 1a62bec78 changes were not independently verified.** They are comment and ADR prose only, made at the last call. They were checked with the analytics specs, eslint, the claims run and the doc guards, but no second agent reviewed them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
