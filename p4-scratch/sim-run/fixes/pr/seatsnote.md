> **Stacked on #621** (`feat/tables-learned-from-the-pos`, head `f5cbccdd4`, not yet on main). The lane was first built on #621's earlier head `0863ae2d2`:
> - `b16bf2ac8` is the fix.
> - `001b68b7f` corrects the ADR prose: the room has four sentences for a window in which no table took a check, not three.
> - `c5aa43a57` is fix round 1. The fix had turned #621's own room test red, so that test's table now has a seat count, and the seats note's place is pinned beside it.
>
> Fix round 2 merged #621's current head `f5cbccdd4` in (`d5a2c5d71`). That head moves #621's migration `tables_learned_from_the_pos` from version 20261220110000 to 20261222160000, past main's newest (20261222120000). Round 2 also added `ef8c08605`, where the ADR trail records the merge. **The head is `ef8c08605`**, on `origin/main` `155960b59`.
>
> **Open this PR after #621 merges.** Against `origin/main` the diff is 17 files, over the 15-file cap. 12 of those files belong to #621 alone. This lane's own delta over #621 is 5 files: ADR 0303, the claims fragment, `rp-registers-house.tsx`, `ReportsNext.test.tsx` and `tables-learned-from-the-pos.test.tsx`. Basing the PR on #621's branch would also leave the audit gate unable to check it, because its ownership step only reads a PR whose base is `main` (`scripts/pr_audit_gate.py:1310`). So after #621 squash-merges, merge main into this branch (see Merge-order notes) and open the PR against main.

## What was wrong for the owner

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03) raised AW30 / A-055: the /reports room register told the owner to map and draw a room, and no screen can draw one. #621 (ADR 0303) answers that by learning tables from the till.

On production, #621's backfill links 3,591 of Tuzlu's checks to **24 learned tables** (t1-t24). That figure is the coordinator's read-only dry run, round 2, recorded in ADR 0303's Consequences. Every learned table is inserted with `seats` NULL, because the till never says how many seats a table has and no screen asks:
- the migration drops `seats NOT NULL` at `supabase/migrations/20261222160000_tables_learned_from_the_pos.sql:107`;
- the learn INSERT writes `NULL` at `:252-255`.

So once #621 merges, none of Tuzlu's tables has a seat count (ADR 0303, residual 14). Two problems followed:

- **The seats scatter was an empty frame.** The room register (`apps/web/src/pages/reports/next/rp-registers-house.tsx`, the seats analysis) plots seats against average check. It only plots tables that took a check and have a seat count (`withCheck`). For Tuzlu that list was empty, so `points.data` was `[]`. A reader who drew the room as a scatter got an empty `.rp-plot` frame, and nothing said why. The founder's fork-3 answer (below) asks for that explanation.
- **The copy still called the tables "mapped".** The four sentences for a window in which no table took a check opened *"N tables are mapped"*. That is the residue of A-055 in this register.
  - The note on tables that took no check read *"N mapped tables took no check in the window, and is drawn at no height rather than left off the chart."*
  - That note was also false. The bars only draw tables that took a check (`served.slice(0, 14)`), so such a table was left off the chart, and it never had a point on the scatter.

## What changed and why

The only code change is in `rp-registers-house.tsx`, in the seats analysis's `view`. There is no SQL, no gateway change and no seats field. One of #621's test files is edited too (see Tests).

The notes below count only the tables that took a check in the window.

**None of them has a seat count.**
- The scatter series is now absent instead of empty. `rp-view.ts` rule 2 says *"A missing series is not an empty series"*. So `Cutting.tsx` prints its existing sentence that the register cannot be drawn as a scatter, and no frame is drawn.
- A note, printed under every drawing, says: *"Seat counts are not recorded yet for any table that took a check, so the scatter has no seats to set against average check and plots nothing. Per-seat figures are withheld for the same reason, not read as zero."*
- The bars (takings) and the table are still true without seats, so they still draw. A `say` would have hidden them as well, so the register does not use one here.

**Some of them have no seat count.** The scatter draws the tables that have one. A note counts the rest: *"2 tables that took a check are left off the scatter because their seat counts are not recorded yet; their per-seat figures are withheld, not read as zero."* With one such table, it reads *"1 table that took a check is left off the scatter because its seat count is not recorded yet; its per-seat figures are withheld, not read as zero."*

**All of them have one.** Nothing changes, and no note is added. A table that has no seat count and took no check is not counted in either note.

**Per-seat figures.** The gateway already returns `revenuePerSeat`, `seatUtilization` and the other per-seat fields as null whenever `seats` is not above 0 (`table-analytics.service.ts:387-393`, `t.seats > 0`). The web register shows no per-seat column. So these notes are the register's only statement about per-seat figures, and they say the figures are withheld, not zero.

**"Mapped" is gone from the register.**
- The four sentences for a window in which no table took a check now open *"The room has N tables"*. For example: *"The room has 1 table, and not one of the 5 checks in the last 90 days was attributed to any of them — that is an absent attribution, not an empty room."*
- The no-check note now reads *"1 table in the room took no check in the window, so it has no bar and no point."* With more than one such table, it reads *"2 tables in the room took no check in the window, so they have no bar and no point."*

**The grep the brief asked for.** I searched `apps/web/src` for "mapped", "map the room", "draw the room", "room has to be drawn" and "floor plan" near table, room or seat words. Outside this register, no web room or tables surface calls a table mapped or asks for a room to be drawn. A last-call re-grep found only this branch's own test comments. The cellar's `FloorStrip.tsx` says the opposite: it will not draw a floor plan. Outside the web app there are these hits:
- `apps/api-gateway/src/reports/exports/report-export-cuttings.ts` `writeSeats`, the report export of this same register. Line 610 builds *"N tables are mapped"*, and lines 622, 625, 626 and 627 open their sentences with it. The line numbers are the same at `ef8c08605`.
- `apps/api-gateway/src/reports/exports/report-export-cuttings.spec.ts:301` and `:305` pin two of those export sentences.

The brief puts any gateway change out of scope, so these are listed here instead of changed (see "Not covered"). The export draws no scatter, and its Seats column already writes *"seats not recorded for this table"* on each row.

## Tests and guards

All of these ran in `/Users/aldemirkonuk/Projects/wt-fix-seatsnote`.

**Web tests.**
- `npx vitest run src/pages/reports/next/ReportsNext.test.tsx src/pages/settings/next/tables-learned-from-the-pos.test.tsx`: 2 files, 97 passed (83 + 14). Re-run at the last call at `ef8c08605`.
- `npx vitest run src/pages/settings src/pages/reports`: 17 files, 316 passed.
- The whole web suite (`npx vitest run` in `apps/web`), run before fix round 2: 5,304 tests passed in 360 files. 2 files fail to load, `Login.signInNote.test.tsx` and `authPages.publicDesign.test.tsx`, with *"Failed to resolve import \"@simplewebauthn/browser\""*. That module is missing from the worktree, and this branch does not touch either file. The suite was not re-run after round 2, because the round-2 merge changed no web file.

**What the new cases cover.**
- A new describe, *"the room says why its scatter is empty (ADR 0303)"*, has 6 cases.
- The A-040 room case is updated to the new opening.
- In #621's `tables-learned-from-the-pos.test.tsx`, the room-notes case's one table now has `seats: 4`, and a 14th case pins the seats note.

**Fix round 1.** The first run only covered `src/pages/reports/next`. It missed that the seats note had turned #621's case *"notes both counts beside the tables it shows"* red. That case's one table took a check with `seats: null`, so a third note came first and `toEqual` failed: 1 of 13 failed at `001b68b7f`. Since that case pins the two room counts, its table now has a seat count. The new 14th case keeps `seats: null` and pins the order: the seats note, then both counts, and no scatter series.

**Fail-before, re-measured at the last call.** I copied the register from #621's head `f5cbccdd4` (the stacked base, which has the same register as `0863ae2d2`) over this branch's version, ran the two files, then restored the file from a snapshot. The worktree was clean afterwards. Result: **6 failed, 91 passed**. The 6 failures are:
- the A-040 room case: expected *"The room has 1 table. No POS check…"*, received *"1 table is mapped. No POS check…"*;
- no seat count at all: `points` was `{ data: [], … }`, expected undefined;
- some unseated: the note is missing;
- the no-check note: *"1 table in the room took no check…"* is missing;
- the render case: expected `<div class="rp-plot">` to be null, and the empty frame was there;
- #621's new 14th case: the seats note is missing.

**Two cases pin behaviour that is kept.** They pass on the base as well: every table seated gives no note, and an unseated table that took no check is not counted. Each fails under its own mutation:
- Showing the note even when every table is seated fails both cases.
- Counting `unseated` over every table, instead of the tables that took a check, fails the second. The first run of this mutation survived because the regex was case-sensitive (`/seat count/` against "Seat counts"). The regex is now `/seat count/i`, and the mutation fails the case.

The verifier also ran three mutations of its own and restored the file each time:
- removing the `withCheck.length > 0` guard on `points` fails 3 tests;
- counting `unseated` over all tables fails 1;
- leaving `seatsNote` out of `notes` fails 4.

**Web typecheck.** `npx tsc --noEmit | grep -v '^../../packages'` prints only `src/services/api/passkeys.ts(14,81): Cannot find module '@simplewebauthn/browser'`. That error already exists in every worktree, and this branch does not touch the file. Re-run at the last call.

**Web lint.** `npx eslint --quiet --resolve-plugins-relative-to /Users/aldemirkonuk/Projects/p4-scratch/web-lint` on the three changed `.tsx` files exits 0. Re-run at the last call.

**Gateway.** `npx jest src/analytics/tables-learned-from-the-pos.spec.ts src/reports/exports/report-export-cuttings.spec.ts --runInBand --forceExit`: 2 suites, 55 passed (the verifier's run). This branch changes no gateway file. #621's spec on its own gives 28 passed after the renumber.

**Claims.** `env LC_ALL=C bash scripts/check_decision_claims.sh`: *"880 checked, 880 holding"*, PASS. Re-run at the last call.

**This lane's claims row.**
- At the last call I ran its verify against copies of the two files at `f5cbccdd4` and at `HEAD`. It exits 1 on `f5cbccdd4` and 0 on `HEAD`.
- It also exits 1 under each of five mutations: `'mapped'` put back, the guard removed, `unseated` counted over all tables, the note left out, and the `.rp-plot` assertion removed.

**Guards.** Each of these passes, both the run and its `--self-test`, with exit 0:
- `check_adr_numbers_unique` (re-run at the last call: *"introduced by this ref: 0303"*, *"Checked against 1726 refs"*)
- `check_citation_pairing`
- `check_od_ids_exist`
- `check_no_conflict_markers`
- `check_windowed_figures`
- `check_analytics_cost_honesty`
- `check_a_count_is_recorded`
- `check_read_errors_not_swallowed`
- `check_web_reads_gateway_dto_keys` (no new key is read)
- `check_money_states_its_currency`
- `check_no_seeded_defaults`

**Migration guards (#621's file, carried by the stack).**
- `check_migration_order.py` exits 0 at the last call: *"OK -- 1 migration(s) added since the merge base 155960b59: 20261222160000_tables_learned_from_the_pos.sql. Newest on origin/main (155960b59): 20261222120000"*. Before fix round 2 it exited 1 with *"OUT OF ORDER"*.
- `check_migration_versions_unique.py` exits 0: *"Checked against origin/main + 77 other open PR(s). No version wears two filenames."*
- `check_migrations_single_home.py` exits 0. It has no `--self-test`.
- `check_migration_ledger.py` exits 2: *"CANNOT CHECK -- no database connection string"*. It reads the production database, which this lane must not touch, so it was not run against one.

**Audit-gate ownership.** At the last call I ran `ownership_between` from `scripts/pr_audit_gate.py` locally. Against both `f5cbccdd4` and `155960b59` it returns RELEASED (no reasons). Every added line and the claims row were also run through the gate's `GATE_RULE_RE` and `GATE_SUBJECT_RE`: 0 hits.

**Local Postgres harness.** Not run, because this lane changes no SQL. That is why `p4-scratch/sim-run/fixes/audits/seatsnote-local-pg.txt` does not exist.
- The only SQL in the branch is #621's migration and its test. #621's round-2 head renamed both files with 0 content lines changed.
- Their harness proof is #621's: `p4-scratch/sim-run/fixes/audits/tables-local-pg.txt`.

## ADR / CLAIMS touched

**ADR 0303** (`.planning/decisions/0303-tables-learned-from-the-pos.md`) is amended. There is no new ADR.
- A dated section is added at the end of the file: *"2026-10-05: the room says why its scatter is empty (lane `seatsnote`)"*. It holds:
  - the founder's answer, verbatim;
  - what the register now says, each sentence verbatim;
  - the statement on per-seat figures;
  - the "mapped" re-wording and the corrected no-check note;
  - what was not built (the export, and a seats field);
  - the evidence, and a trail line that records the round-2 merge of `f5cbccdd4`.
- The section stands on its own, so the sibling lane `addtable` and #625 can each add their own section beside it.
- Two in-place brackets mark the work as built: the Decision's **Seats** bullet (line 53) and residual 14 (line 91).
- One Evidence bracket says #621's web test file now has 14 cases.
- The Status line's *"two follow-up lanes are owed"* is left unchanged, because the sibling lane will edit the same line.
- No README row is added or changed. The ADR's metadata does not name the audit gate.

**CLAIMS.** A new fragment, `.planning/decisions/claims.d/fix-seats-chart-says-why-it-is-empty.jsonl`, holds the row `ADR-0303-THE-ROOM-SAYS-WHY-ITS-SCATTER-IS-EMPTY` (resolved).
- Its verify is static Python over the register's seats slice and over the test file.
- It holds at `ef8c08605`. It exits 1 on the base (`0863ae2d2` and `f5cbccdd4`), and under the five mutations listed above.

## Founder answers (verbatim)

Fork 3 of #621, 2026-10-05 ~16:00Z (AskUserQuestion). His pick: **"Explain the empty chart now (Recommended)"**.

The option text read: *"A small follow-up: the report says why the chart is empty ('seat counts are not recorded yet'). Add a seats field later if you want per-seat figures."*

He rejected *"Add a seats field"* and *"Both"*, so no seats field is added.

## Forks deferred (the founder's call, not made here)

None. The new wording carries out his option text. Re-wording the export is a matter of scope, not a fork (see "Not covered").

## Merge-order notes

**1. #621 first.** This branch is stacked on #621's head `f5cbccdd4`, merged in at `d5a2c5d71`. The lane was first built on `0863ae2d2`.
- The branch carries #621's migration only under its current version, 20261222160000.
- If #621 renumbers or changes again before it merges, merge its new head into this branch first.
- After #621 squash-merges, the coordinator brings this branch onto main **by a merge**, never a rebase or a force-push. Expect conflicts in the three files both branches touch: `rp-registers-house.tsx`, `tables-learned-from-the-pos.test.tsx` and ADR 0303. The squash holds #621's text, and this branch holds #621's text plus this lane's changes, so take this branch's side wherever #621 has not changed since `f5cbccdd4`.
- After that merge, the diff against main is this lane's 5 files.

**2. #615 netsales (`fix/owner-sales-read-net`) also edits the seats register.** Resolve by later truth. A trial `git merge-tree` at the last call, comparing this branch with #621 against #615, shows:
- **`rp-registers-house.tsx`** already conflicts between #621 and #615, and this branch adds hunks in the same region. Resolve them like this:
  - keep this branch's `points: withCheck.length > 0 ? { … } : undefined` shape, with #615's `yLabel: s.net ? 'average check (net)' : 'average check'` inside it;
  - in `notes`, keep this branch's `...(seatsNote ? [seatsNote] : [])` next to #615's `partialNote` entry and its `.filter(...)`;
  - in the no-attribution sentences, keep this branch's `inRoom` opening;
  - the basis line is for #621 and #615 to settle.
- **`ReportsNext.test.tsx`** is the one new conflict this branch adds. Both branches append a describe after the A-040 describe at the end of the file. Keep both.
- The other conflicts with #615 (`README.md`, `table-analytics.service.ts`, `report-export-cuttings.ts`) are #621's, and this branch does not change them.

**3. #617, #619 and #624** touch the same two web files in other registers. A trial merge at the last call shows that this branch adds no conflict with any of them beyond #621's own `README.md` and `sql_outside_migrations.txt`.

**4. #625 (`fix/hidden-tables-leave-insights`, based on #621's branch)** also edits ADR 0303 and `tables-learned-from-the-pos.test.tsx`. A trial merge shows that this branch adds no conflict with #625 beyond #621's own.
- The sibling lane `addtable` (`feat/add-a-table-by-hand`) has no PR or remote branch yet.
- Each of these appends its own section to the end of ADR 0303. When they meet, keep every section side by side.
- This branch's two in-place brackets each sit one unchanged line away from the neighbouring Add-a-table bullet and residual 12.

## Not covered (CLAUDE.md §0.5)

- **The export still says "mapped".**
  - `report-export-cuttings.ts` `writeSeats` builds *"N tables are mapped"* at line 610 and opens four sentences with it, at lines 622, 625, 626 and 627. Its spec pins two of them (`report-export-cuttings.spec.ts:301`, `:305`).
  - These are gateway files, outside this lane's scope (brief: *"any gateway/SQL change"* is out). So the screen and the export now word the same fact differently.
  - The export has no scatter, and it already writes *"seats not recorded for this table"* on each row.
  - The re-wording is owed to a small follow-up on the export (2 files) for the coordinator to track. The independent verifier confirmed the lines and the row text.
- **No Browser-pane check.** The render case drives the real `ReportsNext` page in jsdom. It swaps in the room, draws it as a scatter, and asserts that no `.rp-plot` frame is drawn and that both sentences are present. Nobody has looked at a rendered page in a browser.
- **The merge commit `d5a2c5d71` has git's default message**, with no body and no Co-Authored-By trailer. The brief prescribes `--no-edit` for merges and forbids rewriting history, so it stays as it is.
- **Some earlier commit bodies name `0863ae2d2` as #621's head**, which was true when they were written. History is not rewritten, so this header and the ADR trail carry the current head instead.
- **The grammar is left as it was.** *"The room has 1 table, and … attributed to any of them"* keeps the old *"any of them"* even for a single table. Changing it would widen the hunk that #615 already conflicts on.
- **The whole web suite was not re-run after fix round 2.** That merge changed no web file. The targeted files, plus `src/pages/reports` and `src/pages/settings`, were re-run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
