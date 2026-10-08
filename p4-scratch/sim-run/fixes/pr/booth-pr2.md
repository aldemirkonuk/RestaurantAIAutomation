**Booth lane, PR 2 of 2.** This branch is `feat/booth-and-event-checks-own-row`, **stacked on `feat/a-check-carries-its-channel`** (booth PR 1, body in `pr/booth.md`). It has 13 files of its own. Against `main`, before PR 1 merges, it shows 25. **Do not merge it until PR 1 has merged and `pos_checks.channel` is confirmed live in production.** This PR selects that column, so without it every analytics read fails with 42703.

## What was wrong for the owner

On Tuzlu Rüzgar, the street-fair booth's sales were scored as one server's table service. This is finding **A-050**, fork **AW24**, from the read-only analytics walk of 2026-10-03.

- **The checks.** The booth's 2 checks were rung up under Kerem: **$4,201.10 on 22 Aug** and **$3,508.42 on 23 Aug**. Neither had covers, and the tip was 0. An event check (**$5,283.47**, 60 covers, 17 Sep) gave Owen, who is not one of the five servers, a server row of his own.
- **At 42 days.** Kerem's average check read **$248.16, +27.6% over the staff mean**, and his tip rate **9.82%**. Without the booth those are **$192.25** and **12.87%**. He ranked #1 because of the booth.
- **Over the true 90 days.** He tops revenue at **$134,007, against Priya's $127,689**. Without the booth he has $126,298. His tip rate reads 12.08%, against the others' 12.80–12.82%.
- **Latent today.** The 1,000-check sample leaves the booth out. Lane cap (#609) reads the whole window and turns it on.

The causes, cited at `e2cbe426a`:

- `/analytics/waiters` credited every check with a server name to that server (`table-analytics.service.ts:418-444`). The same check fed the table-adjusted fit.
- The insight loop added every check to its table and its server (`insight-generator.service.ts:1111-1155`). The peer block ranked on those sums (`:1283-1322`), and hot tables took every check (`:1350-1395`).

## What changed, and why

ADR 0302, method 6: **a `booth_event` check leaves every server and table figure, is shown once as "Booth & events", and stays in takings.** Each skip is one added line, so the money-basis change in the same loops (lane netsales) merges around it.

- **`analytics/booth-and-events.ts`** is a pure helper, with no query.
  - `isBoothOrEvent` is an exact test, `channel === 'booth_event'`. Nothing is read from the table ref.
  - `boothAndEventsRow` folds the booth checks exactly as `getWaiterPerformance` folds a server's: takings, average check, wine attach, the tip rate over checks with a tip, and revenue per cover.
  - A parity test re-reads the same checks as one server's row and requires the same figures. A basis change on one side alone therefore fails a test.
- **`table-analytics.service.ts`**
  - `loadChecks` selects `channel` (:116).
  - The table loop skips booth checks (:228). So does the server loop (:424), which also keeps them out of the peer ranking and the table-adjusted fit.
  - Both registers return `boothAndEvents` (:392, :498).
  - Hot tables skip booth checks in the closed-pace history (:552) and in the open list (:566).
  - The basket is unchanged.
- **`insights/insight-generator.service.ts`**
  - The select carries `channel` (:669).
  - The check loop pushes the basket transaction first, then skips a booth check before any table or server sum (:1188). That one skip removes it from the server and table peer rankings, the table-adjusted fit, the correlations and the drivers.
  - Hot tables filter booth checks out of the open list (:1478) and the pace history (:1496).
  - **`INSIGHT_GENERATOR_VERSION` 4 → 7.** The exclusions change what a peer-rank or hot-table sentence claims, so stored rows below 7 are recomputed rather than served. Lane rec (#607) holds 5 and lane cap (#609) holds 6, and both are open; their history lines are placeholders here.
- **/reports "The room" and "Who served it" (`rp-registers-house.tsx`) and both exports (`report-export-cuttings.ts` `writeSeats` / `writeService`)** share their wording.
  - When the key is present, they add the basis sentence *"Booth and event checks count in takings, and in no server or table figure."*
  - They append one "Booth & events" row at the foot of the table, with a note that names it. On the page the row is marked `apart` and ruled off: `rp-view.ts` `TableSpec.apart`, `rp-plot.tsx` `data-apart`, and one CSS rule. It is never a bar or a point.
  - When the window's only checks are booth checks, the row is still drawn, and the empty-state sentence becomes a note that counts only the other checks.
  - **A payload without the key, from an older gateway, renders exactly as before.** That makes a web deploy before the gateway skew-safe.
- **Deviations from the plan, all method-level:**
  - An open booth check no longer counts in hot tables' `openChecks`.
  - A table the house mapped and named "BOOTH" still lists, with 0 checks. Hiding it would be a guess from its name.
  - With no tables mapped, the room keeps its sentence, and a note counts the booth checks.

**Every gateway reader of `pos_checks` was swept.** Only these two group by server or table. scenario-verify reads per-table counts through `getTablePerformance` (`scenario-verify.service.ts:1710`). Scenario checks carry no channel, so its comparisons hold unchanged. The Python services do not read `pos_checks`, and no SQL view or function groups it by server.

## Tests, guards and the local Postgres run

The code runs below are at `9369c19cc`. The two commits after it touch only ADR 0302's prose, and so do the merges of PR 1 into this branch.

- **Gateway jest**, over `src/analytics`, `src/reports`, `src/pos-hub` and `src/simpos`: **75 suites, 1,136 / 1,136**. The builder and the verifier each ran it.
  - At the last call I re-ran 17 suites (booth, export, pos-hub channel and adapters, `analytics/insights`, `table-analytics`): **229 / 229**.
- **New tests: 29.** `booth-and-events.spec.ts` has 14, `report-export-cuttings.spec.ts` gained 8, and `rp-booth-and-events.test.tsx` has 7.
  - **The invariant.** With booth checks present, every server and table figure must deep-equal the figures without them.
  - **The insight case.** #602's gates left a small fixture printing no #1 at all. The insight case therefore uses a 240-check crossed fixture. Without the booth it prints **Priya** and **Table 3** as #1, and the test asserts both by name.
- **They fail without the fix.**
  - With `table-analytics.service.ts`, `insight-generator.service.ts` and `report-export-cuttings.ts` reverted to `main`, **15 tests fail**. Only the no-channel pins, the basket case and the helper's own cases pass.
  - Deleting just the insight loop's skip fails the ranking test: it expected 2 insights (Table 3, Priya) and received [].
  - With `rp-registers-house.tsx` reverted, **6 of 7** web tests fail. The one that passes is the no-key pin.
- **Web vitest**, `src/pages/reports/next`, re-run at the last call: **6 files, 138 / 138**.
- **Typecheck.** Gateway `tsc` is clean apart from the known `@simplewebauthn/server` errors. Web `tsc` shows only the known `@simplewebauthn/browser` error.
- **Lint.**
  - Web eslint `--quiet` is clean.
  - Gateway eslint gives 0 errors. It shows **15 new prettier warnings in `report-export-cuttings.spec.ts`** (37 on `main`, 52 here), plus 59 pre-existing warnings in `report-export-cuttings.ts`, unchanged.
- **Browser pane.** "Who served it" and "The room" were rendered by the real `Cutting` component with `mudavym.css` and `reports-next.css`. The fixture had five servers, six tables and the $7,709.52 booth row. The row sits at the foot of each table, with a 1px `--ink-4` top rule.
- **Guards.** At the last call these pass:
  - `check_decision_claims.sh`: **859 / 859**;
  - `check_adr_numbers_unique` (0302 is unique across 1,685 refs);
  - `check_migration_versions_unique` (against `main` and 53 open PRs);
  - `check_read_columns_exist`, `check_read_errors_not_swallowed`, `check_web_reads_gateway_dto_keys`, `check_citation_pairing`, `check_od_ids_exist` and `check_migrations_single_home`.
  - The verifier also ran their self-tests, which pass.
- **CLAIMS mutations.** Deleting the server-loop skip (:424) fails `ADR-0302-BOOTH-CHECKS-LEAVE-EVERY-SERVER-AND-TABLE-FIGURE`. Setting the version to 6 fails `ADR-0302-GENERATOR-VERSION-AFTER-THE-BOOTH-EXCLUSION`.
- **Local Postgres.** This PR adds no SQL; `supabase/` is byte-identical to PR 1's. The harness run at this head, saved to `p4-scratch/sim-run/fixes/audits/booth-local-pg.txt`:
  ```
  [fix] PASS 20261220100000_a_check_carries_its_channel_test.sql
  [ctl] FAIL 20261220100000_a_check_carries_its_channel_test.sql: ERROR:  T1 FAIL pos_checks.channel is absent, expected text
  ```

## ADR, CLAIMS and the register

- **ADR 0302** gains *As built (PR-2)*, the deviations, two review-trail rows and the cites above. They were re-read at this head.
- **`claims.d/feat-booth-and-event-checks-own-row.jsonl`** has 4 rows:
  - the readers skip booth checks, and the basket keeps them;
  - the row is folded on the server basis;
  - /reports and the exports draw the row apart;
  - the generator version is at least 7, with its history line.

## Founder answers (verbatim, binding)

- AW24, AskUserQuestion, 2026-10-04 00:25Z: *"Own row, POS field (Recommended)"*. Option text: *"Booth/event checks show as their own row ('Booth & events') in staff and table figures and still count in takings. The channel is read from the POS order type where the adapter has one (Clover orderType), else the check counts as table service."* This PR builds the own row, in staff and table figures, still in takings.
- Order types, 2026-10-04 20:50Z: *"Wait, then owner maps (Recommended)"*. Nothing here reads an order type.
- "Merge when audited (Recommended)": this PR waits for the ADR 0090 audit and green CI.

## Forks deferred

- **Take-out and delivery** are filed as OD-TBD by PR 1, and **not asked**: do they count as a server's table service? They still do. The coordinator should ask the founder.
- **The owner's order-type mapping** is answered as "later", in its own PR.

## Merge order

1. Cap (#609), netsales (#615), tz (#616) and postime (#603) go first, as the plan has it.
2. Booth PR 1 merges.
3. Someone with production access confirms `pos_checks.channel` exists: `information_schema.columns`, `public.pos_checks.channel`.
4. Then this PR. **It should follow cap closely**, because cap is what puts the booth checks into the window.

**Stacking.** Open this PR with base `feat/a-check-carries-its-channel`. After PR 1 squash-merges, merge `origin/main` into this branch (PR 1's files arrive with identical content) and retarget the base to `main`. The diff is then these 13 files. Nothing is rebased.

**Measured conflicts.** These come from `git merge-tree` against the open PR heads at `9369c19cc`; later commits touch only the ADR.

- **`table-analytics.service.ts`** conflicts with #609 cap and #615 netsales.
  - Cap rewrites `loadChecks` into `readWholeWindow`. Add the `channel` token to its select.
  - Netsales moves the money basis. `booth-and-events.ts` must follow it, and the parity test fails until it does.
- **`insight-generator.service.ts`** conflicts with #609 cap (the select) and #607 rec. The version line has rec at 5, cap at 6 and this PR at 7. Whichever merges later takes the next free number. If this one has to move, its CLAIMS row text moves with it.
- **`report-export-cuttings.ts`, its spec and `rp-registers-house.tsx`** conflict with #615 netsales. Its labels change in the same registers. Resolve by later truth: the booth row inherits "net".
- **`.planning/decisions/README.md`** has row conflicts with most open lanes. Keep both rows, in number order.

## Not covered (shortcuts, named)

- **Tuzlu's numbers do not move on merge.** The fix acts only on checks that carry `channel = 'booth_event'`. Tuzlu's two booth checks and its event check carry none, because the sim's `gen.py` sends none. By the founder's pick, a check that names no channel is table service.
  - Kerem keeps reading $248.16 at 42 days until two steps happen: `gen.py` sends the channel, and 22 Aug, 23 Aug and 17 Sep are re-posted.
  - The re-post is a production write, outside this lane.
  - The tests use Tuzlu's three checks (their amounts, Kerem and Owen, tables BOOTH, t1 and none). They do not reproduce the production figures.
- **The liveness check before merge is a production read.** This lane cannot make it. `check_read_columns_exist` proves only that the column is declared in the tree.
- **Not the live /reports page.** The Browser-pane check was a static render of the real components, served on 127.0.0.1. No gateway was started and no one signed in.
- **Placeholder history lines.** The version history carries lines for 5 and 6 that belong to lanes not yet merged. If this PR somehow merged before rec and cap, `main` would name them before they exist.
- **15 new prettier warnings** in `report-export-cuttings.spec.ts`. CI's gateway lint is warnings-only and runs `--fix`. They were not reformatted, to keep hunks small next to netsales' edits in the same file.
- **Scenario checks.** A scenario that posts a `booth_event` check would need its expected table counts to leave that check out. No scenario can name a channel today.
- **Not every suite was run.** The full gateway jest suite was not run, only the four folders above. The 8 guards that need production, `.env` or a deploy URL were not run.
- **The last call's own edits were not re-verified by a separate verifier.** They are prose only:
  - the four insight-generator cites, re-read;
  - scenario-verify's reads, named;
  - Clover's `customerIdMethod`, named;
  - both fork questions, quoted as the founder saw them.
  
  Claims and the doc guards were re-run after them.
- **Audit.** One independent verify round passed, with minor issues only, all addressed here. The ADR 0090 three-role audit is owed before merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
