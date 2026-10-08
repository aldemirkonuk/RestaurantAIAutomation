> **Status, 2026-10-04 (re-run of the last call):** merged as **#600**, squash `fb862aa57`, at 18:30Z, from head `23c520dda`. That head is `ecdec6d1b` plus a merge of origin/main `c3b1a227e`. `git diff origin/main 23c520dda` is empty, so there is nothing left to open. The ADR 0090 audit at `23c520dda` gave PASS (`audits/600-23c520dda/report.md`), and every CI check was green. The body below is the one #600 was opened with (a copy is kept at `pr/glasspour.as-opened-600.md`). Only the evidence, merge-order and "Not covered" lines are brought up to date.

## What was wrong for the owner

The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only, production) found three numbers on the owner's screens that were far from the shelf. AW08 traced all three to one database function.

- **A-001 (critical), /inventory.** Yakut showed 159 bottles, 2.0 btl/day, 80 days of cover and no reorder. The app's own inputs give about 31 bottles, the ledger about 16, and the truth cover was 4.71 days. Çankaya showed 110 bottles and 33 days, against about 30 bottles. Monkey 47 showed 3 bottles + 25 ml, against about 1.3.
- **A-012 (major), dashboard.** "In the cellar 1,250". About 210 of those bottles are the Yakut, Çankaya and Monkey 47 bottles that glass pours never took out, about 207 bottle-equivalents of lost pours. The rest of the gap to the shelf (truth: about 742 on hand at Aug 30, or about 777 with W10's wine) is usage the POS feed never sent. That part is not an app defect.
- **AW08, the cause.** `record_glass_pour` poured each glass from one lot, the lot holding the open bottle, and opened a new bottle only from that same lot (`baseline_from_production.sql:1156-1173` at `8c673db4b`). When that lot had no sealed bottle and less than one pour left, the call raised "insufficient stock for a full pour" (`:1175`), even though other lots of the item held sealed bottles. Nothing ever cleared that remainder. `apply_stock_movement` reads only lots with `qty > 0`, and `sync_lots_from_inventory` has no trigger. So every later glass sale of the item failed, and the gateway only logged it (`pos-hub.service.ts:880-883`). No pour row, ledger row or consumption row was written, so the bottles stayed in `stock_live`. The cellar total sums `stock_live`, and cover and velocity read it too. The walk reproduced this by replay (104 of 116 rows) and counted about 752 lost Jul-Aug glass lines. Neither the lots nor the gateway logs were read to observe it directly.

The same probe found two more defects in the function:
- A pour larger than a bottle (1000 ml from 750 ml bottles) failed on `inventory_lots_open_bottle_ml_check` (23514). ADR 0011 had said it "does not raise".
- A manual pour of −150 ml **added** stock: an open 300 ml read 450 ml.

## What changed and why

**One new migration, `a_short_pour_opens_the_next_bottle`** (version `20261217112500`; the final version is assigned at merge). It replaces `public.record_glass_pour` with CREATE OR REPLACE and leaves the baseline untouched.

- **The founder's ruling, built.** A glass sale finishes open bottles first, oldest lot first. Then it opens sealed bottles, oldest lot first, across every live lot of the item. The leftover of the last bottle opened becomes that lot's open bottle.
- **One total-ml draw for the whole call.** Need = pours × pour_ml. This gives the same result as pouring glass by glass. The verifier's fuzz checked it against an independent per-glass oracle with 0 mismatches.
- **Location tiers kept.** With `p_location_id`, that location's lots (open, then sealed) are drawn before all other lots.
- **A pour larger than a bottle** opens as many bottles as it needs.
- **New refusals.** A pour of 0 ml or less, or a bottle size of 0 ml or less, is refused with 22023. A null pour count is refused with 22004, the same code the old FOR loop raised.
- **Unchanged.** The 8-argument signature, the jsonb keys, SECURITY INVOKER, grants, the error texts and the idempotency early return. Also unchanged: the single `sale` ledger row of −bottles_opened (before/after over all live lots) and the `pour_events` row. When the whole item holds less than the call, the function still raises and moves nothing (fork 1 below).
- **Drained lots stay** at 0 sealed / 0 ml. None is ever deleted, which is consistent with ADR 0115 R6.
- **A closing DO block** reads only the catalog. It asserts there is exactly one `record_glass_pour`, the same identity arguments, a jsonb return, SECURITY INVOKER, and the cross-lot loop in the body. A second overload would make the gateway's PostgREST call ambiguous, so pours would fail and only be logged (AW08 again). That is why the block is fatal.

There is no gateway or web change. The cellar total, /inventory cover, velocity and reorder all read `stock_live` (projected from the lots by trigger) and the `sale` ledger, so they track pours again once this is live. Test T1 asserts that `stock_live` follows the pour.

## Tests and guards

All of these ran in `wt-fix-glasspour`. The migration and the test file are byte-identical between `1997ce4bc` and the merged head `23c520dda`. Of the later commits, `ecdec6d1b` changes docs only, and the merge of `c3b1a227e` adds no migration.

- **Local Postgres 17 in Docker** (`db/pgtest.sh`, container `fixlane-pg`, template built from origin/main `c3b1a227e`): the fixed database passes. The control database, built without the migration, fails at T1 with "insufficient stock for a full pour" (`audits/600-local-pg.txt`, 18:13Z). The audit's final call re-ran this and got the same result. The control run stops at the first failure, so T2-T5 and T12 failing without the fix are shown only on PGlite (next bullet).
- **Re-run at the last call** (2026-10-04, at `23c520dda`, which has the same tree as main `fb862aa57`): PGlite fixed gives 285/285, one overload, T1-T12 and T5n PASS, a clean re-apply and run 2 PASS. PGlite control fails T1, T2, T3, T4 (23514), T5 and T12, and passes T5n and T6-T11. The claims row exits 0.

- **SQL test** `supabase/tests/20261217112500_a_short_pour_opens_the_next_bottle_test.sql`, on a PGlite build of every migration (`p4-scratch/sim-run/fixes/glasspour/run_sql_test.mjs`):
  - Fixed build (285/285, one overload): T1-T12 and T5n pass. The migration re-applies cleanly, and the second run passes.
  - Control build (284, without the migration): T1, T2, T3 and T12 fail with P0001 "insufficient stock for a full pour". T4 fails with 23514. T5 fails with "a -150 ml pour was recorded; lots now 1+450". T5n and T6-T11 pass on both builds and pin what is kept.
- **The verifier's fuzz:** 600 random scenarios against a per-glass cross-lot oracle. The fixed build gave 502 exact matches, 98 refusals with lots unchanged, and 0 mismatches. The control build gave 177 mismatches.
- **Claim mutation** (the claims.d `verify`, run on scratch copies): rc 0 unmutated. rc 1 for each mutation: migration deleted, 0 ml guard removed, cross-lot loop removed, later redefinition with the old single-lot branch. The verifier also covered the short-item refusal and the null-count guard.
- **Gateway sanity** (no gateway code changed): `npx jest src/pos-hub src/inventory/inventory.service.spec.ts src/inventory/stock-wrappers-refuse-foreign-items.spec.ts --runInBand` gives 13 suites and 180 tests passed.
- **Guards, all rc 0:**
  - Claims: `check_decision_claims.sh` (837 checked, 837 holding) and `test_check_decision_claims.sh` (PASS).
  - Migrations: `check_migration_versions_unique` (origin/main + 40 open PRs), `check_migration_order` (plain, and `--event pull_request --base-ref main`), `check_migrations_single_home`, `check_migration_probe_safety` (+ `--self-test`).
  - Decisions and citations: `check_adr_numbers_unique` (+ `--self-test`; 1653 refs, 0285 unique), `check_citation_pairing` (+ `--self-test`), `check_od_ids_exist`, `check_no_conflict_markers`.
  - Schema and stock: `check_new_tables_are_locked_down`, `check_grant_writes_are_ledgered`, `check_lot_cost_provenance`, `check_quantity_units`, `check_no_quantity_received_column`, `check_fk_targets_exist`, `check_read_columns_exist`, `check_queried_tables_exist`, `check_no_seeded_defaults`, `check_money_states_its_currency`, `check_a_count_is_recorded`, `check_stock_wrappers_check_ownership`, `check_no_direct_stock_writes.sh`.
  - The verifier also ran the remaining `--self-test`s and `check_flag_readby_anchors`, `check_task_types_are_graded`, `check_web_reads_gateway_dto_keys` and `check_read_errors_not_swallowed`, all rc 0.
- `git diff --check` is clean. origin/main `c3b1a227e` (#599) was merged into the branch at `23c520dda` with no conflict, and #599 adds no migration.
- **CI on #600 at `23c520dda`:** every check passed, including CI Complete, "Fresh database equals remote" and "An ADR number names one decision". Supabase Preview was skipped (`audits/600-23c520dda/checks.json`).

## ADR, CLAIMS and docs touched (8 files)

- `supabase/migrations/20261217112500_a_short_pour_opens_the_next_bottle.sql` (new).
- `supabase/tests/20261217112500_a_short_pour_opens_the_next_bottle_test.sql` (new). It is listed in `scripts/sql_outside_migrations.txt`.
- `.planning/decisions/0285-a-short-pour-opens-the-next-bottle.md` (new). The ruling is **Locked** (the founder's pick). The method is **Proposed** for his review.
- `.planning/decisions/README.md`: index row for 0285.
- `.planning/decisions/0011-pos-sale-volume-contract.md`: 1b's "does not raise" is corrected in place, bracketed, with a review-trail row. The queue guard is unchanged.
- `.planning/decisions/claims.d/fix-a-short-pour-opens-the-next-bottle.jsonl`: one `resolved` row. It reads the last migration that defines the function, so a later redefinition that drops the cross-lot draw or a guard fails CI.
- `.planning/tech-debt.d/2026-10-04-fix-a-short-pour-opens-the-next-bottle.md` has four entries:
  - AW08 FIXED in code, with the repair OWED.
  - The negative pour FIXED.
  - The `apply_stock_movement` open-ml delete OPEN.
  - Two stale pos-hub comments OPEN.

## Founder answers

The brief has no "FOUNDER ANSWERS" section. Its binding ruling is the AskUserQuestion pick of 2026-10-04 ~00:15Z, verbatim: **"Finish it, open next (Recommended)"**. The option text was: *"Take the remainder and pour the rest from a newly opened bottle, even one in another lot, as a bartender does. Stock matches the shelf, and it fits ADR 0115 A6 (stock in ml)."* It is built and covered by T1-T4 and T12, and quoted in ADR 0285's Status line.

## Forks deferred (the founder's)

- **Fork 1: the whole item is short.** This covers no sealed bottle anywhere and too few open ml. The call still raises all-or-nothing, and nothing moves (T8). ADR 0115 R26 ("take to zero, name the gap", PR #589) replaces this in D3. Its variance row and feed shape are D3's to design, so this PR does not pre-empt them.
- **Fork 2: the Tuzlu repair.** It is written and unrun at `p4-scratch/sim-run/fixes/repair/glasspour-tuzlu-stranded-pours.sql`, outside the repo:
  - §0 preconditions.
  - §1 a read-only dry run.
  - §2 an apply block that replays each lost line in `closed_at` order, backdates the ledger and pour rows, and ends in ROLLBACK.
  - The options are: (a) the SQL replay (recommended, after this migration is live), (b) a Jul-Aug re-import through the gateway, or (c) leave the past as it is.
- **The method in ADR 0285** waits for his lock.

## Merge-order notes

- **Lane `postime`** (`fix/pos-sales-dated-at-sale-time`, HEAD `f02e38650`, unpushed): its migration `a_pos_sale_is_dated_by_its_check` drops the 8-argument `record_glass_pour` and creates a 9-argument one (`p_occurred_at`) from the **baseline** body. Both orders were measured on PGlite:
  - If postime's version sorts first, this migration halts on its assertion ("found 2").
  - If it sorts after, the build passes but loses the cross-lot draw, and only this PR's claims row catches it (CI red).
  - Whichever lane merges second rebuilds on the other's body. The recommendation is to merge glasspour first (A-001 is critical), with postime then keeping this draw and its guards under `p_occurred_at`.
  - **Resolved after the merge (checked 2026-10-04):** glasspour merged first. Postime's local HEAD `3d4782241` (unpushed, no PR) has merged `fb862aa57`. It renamed its migration to `20261218101500_a_pos_sale_is_dated_by_its_check`, which sorts after this one. That file carries `FOR v_tier IN 0..v_tiers LOOP`, and postime's PR body says it moves ADR 0285's T11 to the 9-argument identity.
- **`scripts/sql_outside_migrations.txt`**: #591 and lanes `postime`, `cellar` and `events` also append to its tail. Expect a trivial textual conflict.
- **`.planning/decisions/README.md` index rows** are shared with:
  - PRs #533, #566, #577, #589, #596 and #598.
  - Lanes caltakings, cap, dash, doortime, events, logs, postime, rec, recregisters, sig, sighting and stateeditor.
  - These conflicts are textual and resolved at merge.
- **#589 (ADR 0115 drinks lock):** when it merges, its D3 row should mark R19's "the last ml below one measure" as shipped by ADR 0285.
- **Migration version:** `20261217112500` collides with nothing on origin/main, in the open PRs or in any `wt-*` worktree. The final number is assigned at merge.

## Not covered (shortcuts, stated)

- **Tuzlu's numbers are not corrected by this PR.** Yakut 159, Çankaya 110, Monkey 47, the cellar's 1,250 and the 80-day cover keep the about 752 lost Jul-Aug lines until fork 2 is answered. Only new pours are right. Once this migration is live, any re-import or redelivery of an old closed check also pours its failed line, because `pos-hub.service.ts:538` re-runs stock effects on every upsert. That pour is dated now(), not `closed_at`, which inflates velocity. So no Jul-Aug re-import should run before fork 2. ADR 0285 and the tech-debt fragment say so.
- **Production numbers were not re-measured** (159, 110, 1,250, 752 lines), because production access is off-limits to this lane. The AW08 reproduction on Tuzlu is by replay, not observed in `inventory_lots` or gateway logs.
- **The SQL test ran on PGlite** (PG 18 WASM, superuser, no Supabase platform) and on a local Docker Postgres 17 built from the migrations, but never through `supabase db reset`. No CI job runs `supabase/tests`. On Docker the control side stops at its first failure (T1).
- **The production apply is not verified.** Migrations apply when a PR merges, and the closing DO block makes a failed apply loud. Nobody in this lane read production to confirm the new body is live, because production access is off-limits (audit follow-up 2).
- **The audit's open follow-ups (none blocked the merge):**
  - (4) A POS volume line that rounds to 0 ml is now refused with 22023 and only logged.
  - (6) SQL tests are still missing for a lot with no location when a location is given, a pour exactly equal to the bottle size, and ties on `received_at`.
  - (7) The claims row would accept the marker string inside a comment, and it skips a definition spelled `"public"."record_glass_pour"`.
- **The repair was exercised only on a synthetic house in PGlite.** Neither its dry run nor its apply has touched production.
- **Fork 1 is unbuilt.** A wholly short item still refuses, and the gateway still only logs the failure. Lane postime makes that failure visible.
- **Lot order changed.** Sealed bottles now open from the oldest lot, not from the lot that holds the open bottle. Totals are identical. Per-lot history differs, and nothing records which lots one call drew from (`lot_id` and the decomposition record are ADR 0115 R19/D3).
- **Left OPEN in the tech-debt fragment:**
  - `apply_stock_movement` deletes a lot together with its open ml (ADR 0115 M1).
  - The stale comments at `pos-hub.service.ts:86-90` and `pos-hub.sale-volume.spec.ts:292-294` stay, because lane postime holds that file.
- **The manual stock route still has no input validation** (`inventory.controller.ts:492-495`). The RPC is now the guard.
- **TS typecheck and lint were not run.** No `.ts` or `.tsx` file changed.
- **The lane verifier never saw the last-call commit `ecdec6d1b`.** It is docs only. It narrows the sentence in ADR 0285 and the tech-debt fragment about re-sent checks, following the verifier's own finding. The claims and docs guards were re-run on it, and the #600 audit read the whole head `23c520dda`, which includes it.
- **Commit trailers read `Claude Opus 5`,** as the lane task specified.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
