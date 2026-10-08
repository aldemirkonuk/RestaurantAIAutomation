> **[2026-10-06 ~17:03Z, coordinator, push]** Pushed head **`bcad327e2`**, as the lane's last call below describes. Since the PASS at `c05c41f4c`, `4cac6efc3` changes code (ADR 0292 fork 3). So this head gets a re-audit before any merge, and the PASS at `c05c41f4c` does not carry over.
>
> At this head:
> - fast guards (migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers) all exit 0;
> - 15 files against origin/main `5c07cfb23`;
> - gate ownership `[]`;
> - decision claims PASS, 915 of 915 holding (run with Python 3.11: `/usr/bin/python3` here is 3.9, which cannot run ADR 0224's host check).

**[2026-10-06, lane cap, last call] Head `bcad327e2`, with origin/main `5c07cfb23` merged in. 15 files, no SQL. Verdict: SHIP.**

The head is four commits on `c05c41f4c`, the head of the last audit:

- **`4cac6efc3`** builds the founder's answer to ADR 0292 fork 3. `analytics.service.ts` `loadConsumption` no longer turns a refused or failed pour read into `[]`.
- **`284e9ab9e`** merges origin/main `4528b9689` (#621, ADR 0303). It was clean.
- **`7f0d534ac`** merges origin/main `5c07cfb23` (#622, ADR 0290, lane dash). It was clean.
- **`0ce61d967` and `bcad327e2`** are doc-only. They re-point one tech-debt cite that #622 shifted, and they record #622's new month read as owed to the guard's PR (see Merge-order notes).

ADR 0292 is **Locked** on the founder's answers of 2026-10-06, quoted below. An independent verifier passed `4cac6efc3` (round 1) with six minors, all of them disclosed below. The last call re-ran the tests and guards at this head, after both merges.

---

## What was wrong for the owner

Tuzlu Rüzgar's analytics read at most 1,000 rows of `pos_checks` or `wine_consumption_log` per request. The cap is the Supabase API's `max_rows = 1000` (`supabase/config.toml:18` locally). Production's cap is inferred from 10 responses at exactly 1,000. A window holding more came back as a 200 with a thousand rows, and the page printed that sample as the total, with no notice (F-131, cluster C15). Measured on the read-only production walk of 2026-10-03:

- **A-005 (critical).** The 90-day /reports till counted **1,000 of 3,313 checks**: **$187,474 against $625,944**, with no day after Aug 15.
- **A-006 (critical).** "Who served it" ranked the floor on **1,000 of 3,341 checks**: $186,389, 29.6% of $630,579. It put Maya first, though she was last by takings. The basket view counted 1,000 transactions.
- **A-004 (critical).** The /recommendations "Tonight" card said Saturday Aug 15 sales fell **97% ($274 vs $10.8k)**. The feed says about **14.6%**: $14,539 against a $17,026 average over four Saturdays.
- **A-032 (major).** Menu engineering classified the list on **752 units against about 8,445** sold.
- **A-033 (major).** Seasonality, Wine 360, the till list and the dashboard sales chart read one capped slice of consumption: 1,020 of about 8,445 units.
- **A-031 (major, modelled).** A /calendar month reads at most 1,000 of its 1,910 checks (Jul) or 2,121 (Aug). About half of each month would read "covers not recorded" on days that traded.

## What changed and why

**A new helper, `apps/api-gateway/src/common/read-whole-window.ts`.** `readWholeWindow(what, build, { pageSize?, ceiling? })` returns the window whole or throws `WholeReadError`. It never returns a prefix. `WholeReadError` is a `ServiceUnavailableException` that carries a sentence.

- **Keyset paging on `id`.** Page 0 is `order(id).limit(1000)`, and each later page adds `.gt("id", last)`. Offset paging was rejected, because it skips or repeats rows when a check lands mid-read.
- **An exact count proves the read whole.** Page 0's count is the window's size. Each later page's count must equal the size minus the rows already read. On a mismatch the helper re-reads once from the top, then refuses with `unstable`. At the end, the distinct ids must equal the size.
- **Other refusals:**
  - an error on any page (`read_failed`);
  - an id seen twice, or an empty page while rows are still counted (`cursor_stalled`);
  - rows without ids, or a page longer than asked (`malformed_page`);
  - a count above `WHOLE_READ_CEILING = 100,000` (`row_ceiling`), refused before a second page is asked for (fork 1).
- **A server cap lower than 1,000** is adopted from a short page.

**Every reader in ADR 0292's readers table now reads through it.** Other reads of these tables are not changed here (see Not covered).

| Reader | Finding | On refusal |
|---|---|---|
| `goals.service.ts` `computeMetricWithSeries`: the check metrics (the /reports till, the ribbon, goal progress) and `bottles_sold` | A-005, the ribbon, A-033 | Rethrown past the metric's old catch-and-return-0, so the till route errors instead of reporting a slice. `getGoalProgress` writes no `current_value`, and `createGoal` stores no baseline. `items` is fetched only for `wine_revenue` and `wine_attach_rate`. |
| `table-analytics.service.ts` `loadChecks` ("Who served it", tables, basket) | A-006 | A 503 with #599's sentence |
| `insight-generator.service.ts` `loadBundle`, both window reads | A-004 | Logged as rejected. The slice reads `[]` inside the bundle. Every family that reads that slice is gated on it, so no insight is generated from it and no figure is stated. `generate()` still answers, so /recommendations does not name `insights` in `sourcesUnread`. That was already so on main for a failed slice. Kept on the coordinator's reading of fork 3 (see Forks deferred). |
| `advanced-analytics.service.ts` `loadConsumption` (menu engineering, seasonality, Wine 360 demand) | A-032, A-033 | Propagates. The overview's `allSettled` makes that lens null. |
| `analytics.service.ts` `getPosConsumptionBreakdown` (the till list) | A-033 | Propagates, as a failed read already did |
| `analytics.service.ts` `loadConsumption` (financial summary, risk, inventory science, the 120-day forecast) | A-033 | **Propagates (fork 3, the founder's answer of 2026-10-06).** It used to log and return `[]`, and the four lenses then computed as if nothing had been poured. Each consumer already had a "could not be read" path, so no web file changes:<br>• the `financial`, `inventory-science`, `risk` and `forecast` routes answer a 500 that carries the sentence (from their own catch), and /reports prints its failure line;<br>• the overview holds the three lenses `null`;<br>• /recommendations names them in `sourcesUnread`;<br>• a `days_of_inventory` goal is `unreadable`;<br>• Wine 360 refuses;<br>• an export is "Not written";<br>• the MCP `financial` tool answers `isError`;<br>• the consultants' evidence carries `null`. |
| `dashboard.service.ts` `getSalesChart` | A-033 | Rethrown, instead of drawing glasses = 0 |
| `calendar/recorded-days.service.ts` `windowFor` | A-031 | The existing refusal path, worded "could not be read whole, so no day is drawn from part of it" |

**The insight generator moves to version 6.** A stored insight below version 6 may hold a sentence computed from the 1,000-row slice, such as the "97% lower" card. Every cache reader refuses those rows, and the hourly sweep recomputes them. Sig (#602) took version 4 and rec (#607) took 5, both on main, so this change is 6. The open PRs #619 and #624 take 7, and #625 takes 8.

**The guard ships separately**, in its own PR, because of the 15-file cap. `scripts/check_window_reads_are_whole.py`, its two `ci.yml` steps and its claim are on the local branch `fix/analytics-window-reads-guard` (`dcdbed2cc`). That branch is one commit stacked on `c0664cb04`, a pre-merge head of this branch. It is not opened as a PR yet. **Until it merges, CI does not block a new unranged read of these tables.** It also needs a change before it can land (see Merge-order notes).

## Tests and guards

**At this head** (`bcad327e2`; jest at `0ce61d967`, and the last commit is one `.md` file), with origin/main `5c07cfb23` merged in:

- **Jest, the lane set and its neighbours.** Command: `env LC_ALL=C npx jest src/common/read-whole-window.spec.ts src/analytics src/calendar src/dashboard src/reports/exports src/mcp-server src/beverages/beverages.service.spec.ts src/notifications/producers __tests__/dashboard.service.spec.ts --runInBand --forceExit`. Result: **98 suites, 1,678/1,678 passed**.
- **Jest, the three named specs** (`read-whole-window.spec.ts`, `insight-rankings-significance.spec.ts`, `beverages.service.spec.ts`): **3 suites, 86/86 passed**. The lane spec has **44 cases**: 14 on the helper and 30 on the readers.
- **Red without the fix.** This was run at `284e9ab9e`, after the #621 merge. Two files were written over with their pre-fix copies:
  - `table-analytics.service.ts` with origin/main's copy;
  - `analytics.service.ts` with `54f833e4b`'s copy.

  Then `read-whole-window.spec.ts` was run: **14 failed, 30 passed of 44**. The failures are both A-006 cases ("reads all 3,341 checks and puts Maya last", "a refused read is a 503"), the till-list and `loadConsumption` whole-read cases, and every fork-3 case: the four lenses, the four routes, the overview nulls, `sourcesUnread` and the days-of-stock goal. Both files were restored with `git checkout HEAD --`, and `git status` was empty afterwards.
- **Red in earlier rounds.** Every reader was put back to main, one at a time. The failures per reader were: goals 6, table-analytics 2, advanced-analytics 3, analytics.service 4, insight-generator 2, dashboard 2 and recorded-days 3. The verifier also reverted all 7 source files at once (30 of 44 failed) and then fork 3 alone (9 of 44 failed).
- **Typecheck.** `npx tsc --noEmit -p tsconfig.spec.json` reports 0 errors other than the existing `@simplewebauthn/server` ones.
- **Lint.** `npx eslint` on the 10 changed `.ts` files gives **0 errors** and 6 warnings. Each of the 6 warnings is also on origin/main's copy of the same file (prettier in `analytics.service.ts` and `goals.service.ts`, and an unused `consumption` in `dashboard.service.ts` `getStats`).
- **Guards.** Every `scripts/check_*.py|sh` named in `ci.yml`, with its `--self-test` where it has one: **78 invocations, all exit 0**, after both doc commits.
  - Also: `env LC_ALL=C bash scripts/check_decision_claims.sh`: **915 checked, 915 holding**.
  - Also: `check_adr_numbers_unique.py`: OK, with 0292 introduced and 1,732 refs checked. Its `--self-test` is OK.
  - Skipped: `check_gateway_boots.sh`, because the diff changes no module, provider or DI constructor (its one `constructor(` is `WholeReadError`'s), and `check_migration_order.py --event`, which needs the CI event.
- **Gate ownership.** `ownership_between('.', 'origin/main', 'HEAD')` returned `[]`.
- **The stacked guard, run over this head** from a scratch root (the guard file from `dcdbed2cc`, plus this tree's `apps/` and `supabase/`). It **FAILS**: `dashboard.service.ts:322 reads pos_checks with no bound` (32 reads: 11 whole, 8 bounded, 5 allowlisted, 7 baselined). Its `--self-test` passes. The read it flags is **#622's**, merged from main, and not this PR's code (see Merge-order notes). Over `4cac6efc3`, before that merge, the verifier ran it to a PASS (29 reads).
- **Local Postgres:** not run. `git diff --name-only origin/main...HEAD -- supabase/` is empty, so the lane has no migration and no `supabase/tests` file. This is noted in `fixes/audits/cap-local-pg.txt`.
- **Earlier rounds, kept as history:**
  - 151 suites over analytics, calendar, common, dashboard, notifications, reports and simpos: 2,449/2,449 at `c0664cb04`.
  - The full gateway suite at `c0664cb04`: 612 suites passed. The 9 that failed were all passkeys, health or auth, on the missing `@simplewebauthn/server`.
  - The verifier at `4cac6efc3`: 111 suites / 1,810 tests and 63 suites / 1,355 tests.

## ADR / CLAIMS touched

- **ADR 0292**, "Analytics reads the whole window, page by page, or refuses". It is new and **Locked** on the founder's answers of 2026-10-06, quoted verbatim in its "Founder answers" section. The sentences fork 3 made false are corrected in place with dated brackets. Its README row is added in number order.
- **New claims** (`claims.d/fix-analytics-reads-past-row-cap.jsonl`):
  - `TD-2026-10-03-ANALYTICS-READS-WHOLE-WINDOW` (narrowed to the readers table);
  - `TD-2026-10-03-WHOLE-READ-HELPER-PROVES-COUNT`;
  - `ADR-0292-F3-A-REFUSED-POUR-READ-IS-NOT-EMPTY`. Mutation-tested: it fails on `c05c41f4c`'s copy, on origin/main's copy, on a call-site `.catch(() => [])` and on an `= []` inside the body.
- **Corrected in place:** `REPORTS-2026-10-03-POS-CHECK-READ-FAILURE-IS-NOT-EMPTY` (#599's `claims.d/fix-reports-fractions-and-empty-register.jsonl`). It now reads `loadChecks`'s `WholeReadError` catch, which throws the same 503.
- **Tech-debt note:** `tech-debt.d/2026-10-03-fix-analytics-reads-past-row-cap.md`. It lists:
  - the seven reads still capped;
  - fork 3 as built, with what it owes;
  - #627's `readTillPages` and #622's `readMonthTakings` (both added this day);
  - the unmeasured latency;
  - the adjacent defects.

  The `getStats` cite moved from `:521-522` to `:1014-1015` after #622.

## Founder answers (verbatim; asked about 04:13Z, answered by 04:16Z, 2026-10-06)

1. **Q:** "#609 makes the till and pour reads take the whole date range instead of silently stopping at 1,000 rows. If a range holds more than 100,000 rows (about 4.6× a year of Tuzlu's checks), what should the page do?" **A:** "Refuse and say so (Recommended)". The option read: "As built. The figure says it could not be read: too many rows. A partial figure is never shown. No extra work." Rejected: "Show a labelled partial".
2. **Q:** "A year-long range is read about 70 pages at a time (roughly 4 seconds, estimated, not measured). Keep that, or build database-side totals now?" **A:** "Keep page by page (Recommended)". The option read: "As built. Measure the real time after merge, and build database totals only if it is slow. No extra work now." Rejected: "Database totals now".
3. **Q:** "If the pour read is refused (a timeout or past the ceiling), the financial summary, risk, stock science and 120-day forecast currently compute as if nothing was poured. Only a server log notes it. What should the owner see?" **A:** "Say 'could not be read' (Recommended)". The option read: "Those figures say they could not be read instead of showing numbers that leave out pours, matching 'an unknown is not a zero'. Rare in practice. It is a small change to #609 and one more audit." Rejected: "Keep as built" ("Figures show without pours and the page does not say so; a matching insight family stays silent. No extra work, but the page can show a wrong number with nothing to warn the owner.").
4. **Q:** "Seven older reads are still capped, held in a list that CI checks. When a PR fixes one of them but leaves its row on the list, should CI fail or just warn?" **A:** "Fail CI (Recommended)". The option read: "As built (in the guard's PR). The PR that fixes a capped read must also remove it from the list, so the list never claims a read is capped when it is not." Rejected: "Warn only".

How each answer is built:

- **Forks 1 and 2** ratify the build.
- **Fork 3** is built in `4cac6efc3`.
- **Fork 4** lives in the guard's stacked branch.

## Forks deferred (the founder's call, not made here)

Building fork 3 left two questions open:

1. **Refuse by lens, or by figure?**
   - **Now:** a refused pour read withholds whole lenses. That includes figures that need no pours: inventory value, COGS, the ratios, days of stock (so a `days_of_inventory` goal), and the risk profile's vendor and revenue concentration.
   - **(a) Keep as built.** This is the "small change to #609" the answer promised, and it is how every other reader here refuses.
   - **(b) Split each lens.** Pour figures would be null with a reason, and pour-free figures would stand. That is a larger change, with new wording on every page.
   - **Recommendation:** (a).
2. **The insight bundle's silent family.**
   - The rejected option named it ("a matching insight family stays silent"), so the pick can be read as rejecting that silence too.
   - **As built:** the family stays silent. It states no wrong figure. But /recommendations can still say every source answered when only a bundle slice was refused, and the explorer's `getAvailability` reads the slice as missing data. Both were already so on main for a slice that failed with an error.
   - **(b) Build now:** name `insights` in `sourcesUnread` when a bundle slice is refused. It is small, but it is new behaviour on /recommendations.
   - **Recommendation:** keep as built in #609, and do (b) as a follow-up.

## Merge-order notes

Overlap was checked against every open non-dependabot PR, with `gh pr view N --json files` and `git merge-tree` against this head and against origin/main.

- **Conflicts this PR adds** (they are not on main):
  - **#610** (caltakings) in `recorded-days.service.ts`. It was already set to land after #609.
  - **#615** (netsales) in `goals.service.ts`.
  - **#616** (tz) in `analytics.service.ts` and `goals.service.ts`.
  - **#619** (stockout) in `insight-generator.service.ts`: the version-history comment, where this PR takes 6 and #619 takes 7. Keep every line.
  - **#626** (units). It is stacked on this branch, and its `loadConsumption` hunk has `data = [];` as context, which fork 3 removes. Resolve it by taking this branch's propagating read and re-applying #626's own lines. After this squash-merges, retarget #626 and run `git rebase --onto origin/main <this head> fix/a-glass-is-not-a-bottle`.
- **Shared files with no conflict from this PR:**
  - #617 (`analytics.service.ts`) merges clean.
  - #579 (`dashboard.service.ts`) conflicts only with main's #622.
  - #624 and #625 conflict with main already, because their bases are #619 and #621's pre-squash branch.
- **`.planning/decisions/README.md`** is touched by most open lanes. Keep every row, in number order. This PR adds only the 0292 row.
- **`analytics.controller.ts`** is not touched here. #625, #616 and #564 touch it, and the 500-to-503 follow-up belongs with them.
- **The guard's stacked branch** (`fix/analytics-window-reads-guard`) lands after this PR, by `git rebase --onto origin/main c0664cb04 fix/analytics-window-reads-guard`. **It now fails on main's code.** #622's `readMonthTakings` reads `pos_checks` through `vendor-menu-supply.ts` `readAll`: keyset pages of 1,000 that stop at a short page, with no exact count. Before the guard opens, one of these must happen:
  - that read moves onto `readWholeWindow`;
  - the guard learns `readAll`, through an allowlist or a baseline row that names the blind spot.

  Recorded in the tech-debt note.
- **#579 (R1b, paused)** removes `getStats`' `wine_consumption_log` read. Whichever PR lands second between it and the guard must delete that read's baseline row (fork 4 makes a stale row fail CI).

## Not covered (CLAUDE.md §0.5)

- **The guard is not in this PR.** CI blocks no new unranged read until the stacked guard PR merges. That PR is not opened, and as noted above it fails over this head on #622's read. The brief's last requirement is met only once it lands.
- **Seven reads are still capped**, baselined in the guard:
  - `dashboard.service.ts` `getStats` consumption;
  - `pos-hub.service.ts` `getStatus`;
  - the weekly top-sellers digest in `scheduled-tasks.service.ts`;
  - `dev-truth.service.ts` `asOf`, two reads;
  - `sale-record.producer.ts` (latent: it reads one day of checks);
  - `pos-mapping-review.service.ts`, where `checkLimit` can be up to 2,000. It is clipped to 1,000 today, and its `checks_scanned` is honest about that.
- **Two keyset pagers have no count, and neither is fixed here.**
  - #627's `readTillPages` (`beverages.service.ts:1147-1175`) is owed to the cellar lane.
  - #622's `readMonthTakings` (`dashboard.service.ts:320-330`) is owed to the guard's PR.

  Each is whole only while its page of 1,000 is at or under `max_rows`. The hosted `max_rows` cannot be read from the repo.
- **The four lens routes answer 500, not 503.** Their own catch wraps every error. The sentence is in the response body, and /reports prints axios's status line either way. This is owed to a controller PR.
- **`createGoal` maps a refused baseline to a 400**, not a 503.
- **Latency was never measured.** That covers the 365-day ribbon (estimated at about 4 s), `/analytics/overview` (about 60 page requests) and `/recommendations` (about 78), locally and in production. On the founder's fork 2 answer, measure after merge.
- **No refusal state was rendered in a browser.** The web paths were read from code only: `rp-format.ts` `failureOf` and `failureLine`, the /recommendations quiet tier, and goals' `unreadable`. No web file changed, and no web vitest was run.
- **The full gateway suite was not re-run at this head.** Only the 98-suite lane and neighbour set and the named specs were run. The last full run was at `c0664cb04`.
- **The latest commits are not independently verified.** The verifier passed `4cac6efc3`. The two merges after it and the two doc commits were checked by this last call only (tests, red run, guards and ownership above).
- **Two merge commits carry no trailer.** `284e9ab9e` and `7f0d534ac` carry git's default message, with no body and no `Co-Authored-By` trailer, as `c05c41f4c` did. The lane task's own `git merge --no-edit` produced them, and history is not rewritten.
- **The sig spec's double was changed in another lane's merged file** (`insight-rankings-significance.spec.ts`). The change is test-only: the double now honours `order("id")`, `gt` and `limit`. It was made because the merged tree was red. Sig's author has not reviewed it.
- **Findings this paging does not fix:**
  - AW01, the "Tonight" urgency on an old day (lane rec);
  - AW02, a glass counted as a bottle, and the 90-day divisor;
  - C02 / F-129, UTC-day bucketing;
  - AW24, booth checks in server stats (lane booth). They were already in the old sample; the whole window adds the ones past the cap;
  - AW27, the /cellar tile (lane cellar).
- **No production call was made**, and nothing is pushed. The coordinator pushes this head.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
