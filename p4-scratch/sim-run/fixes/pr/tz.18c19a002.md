**[2026-10-06 ~00:33Z, coordinator] Re-headed at `18c19a002`.** It merges `origin/main` `63ce97e62`, bringing in everything merged since this branch last took main. The newest of that is #607 `1884dea38`, #647 `8e16fbcef` and #646 `63ce97e62`. Conflicts resolved by the coordinator: README index rows (both kept). Guards at the new head: migration order, versions unique, OD ids and conflict markers all 0. `ownership_between(origin/main, HEAD)` = `[]`. Decision claims and ADR-number uniqueness are left to CI. Lines below that name an older head describe this PR before the merge. This is a first audit pass; the merge turn re-heads and re-audits.

## What was wrong for the owner

These findings come from the read-only analytics walk on Tuzlu Rüzgar (production, 2026-10-03), lane `tz`: F-086 (cluster C02), A-027.

**A-027 (major): the /reports till filed each check under its UTC closing date.** Tuzlu keeps Los Angeles time (UTC−7 in summer), so every check that closed after 17:00 there landed on the next day. At `origin/main` e2cbe426a the cut was `(c.closed_at || c.opened_at || "").substring(0, 10)` (`goals.service.ts:915`, `:920`, `:955`), inside a window built on UTC dates (`:850-851`, `:1009-1013`). What Tuzlu's owner saw:
- **Jul 1, opening day**, read $1,636.50 (9 lunch checks). The house took 52 checks and $10,945 that day. The dinners went to Jul 2.
- **Wed Jul 22, when the house was shut**, read $6,950.40, which was Tuesday's dinner. The capped 90-day view showed $5,431.02; its size is lane cap's finding.
- **The $4,201.10 street-fair booth check of Aug 22** showed on Aug 23.
- **One day's figure moved with the window.** The read filtered on `opened_at` and filed by `closed_at`, so Aug 23 read $26,564.91 at `days=43` and $22,363.81 at `days=42`. The difference is the booth check.
- **There was a phantom Aug 31** of $9,571.32 (Aug 30's dinner).
- **The heat map called Sunday the busiest day** ($17,099) and Tuesday the quietest. On the house's days, Saturday is busiest ($17,067) and Monday quietest ($6,112).

The same UTC cut fed goal progress and pace, the per-wine consumption breakdown beside the till, the till export and the scenario verifier. The verifier saw the split and reported it as "unverifiable … two UTC day buckets" instead of a mismatch.

**Scope of this PR.** This is PR-1 of three under one rule (lane plan `cont/tz-plan.json`; one PR would be 21+ files). It fixes A-027 and moves the till, goals, the consumption breakdown, the export and the verifier onto house days. **It closes F-086 for those readers only.** /calendar (A-026), the insight bundle's daily series (A-060) and the recommendations ribbon are PR-2's. /logs (A-056) is PR-3's. Until those PRs land, the surfaces disagree about a check's day (see Not covered).

## What changed and why

The rule is one function in one new file, and every reader in scope goes through it.

- **`common/house-day.ts` (new).**
  - `houseDayOf(subject, zone)` is the rule. Handed a check, it files it by when it closed, else when it opened. Handed an instant (a delivery, a consumption line, a goal's creation), it files that instant. The day ends at midnight on the house's clock. The formatter is cached per zone.
  - `checkInstant` (closed-else-opened) is not exported, so no reader can file a check by its other timestamp without visibly going around the rule.
  - `readHouseZone` reads `restaurants.timezone, country` by primary key and resolves the zone through `houseFrame`: the house's own zone, else its country's only zone (ADR 0207 q6), else none. **A read error throws.** It is never folded into "no zone".
  - `houseDayBounds` gives DST-correct midnights through `service-day.ts` `localMidnight`. `houseToday`, `shiftHouseDay`, `HOUSE_DAY_LOOKBACK_MS` (24 h) and the one sentence `HOUSE_ZONE_UNSET` complete the file.
  - No new time maths: it reuses `house-frame.ts` and `service-day.ts`.
- **`goals.service.ts`.**
  - **`computeMetricWithSeries` takes the zone.** All six windowed metrics read from 24 h before the first house midnight up to the end of the last house day. A shared `fileByHouseDay` then files each row through `houseDayOf` and drops rows outside `[from, to]`, so a day reads the same in every window. Checks are handed to the rule whole. Orders are filed by `delivered_at || created_at`, and consumption lines by `created_at`.
  - **With no zone it throws `HOUSE_ZONE_UNSET` outside the metric's `catch`.** That `catch` turns errors into 0, and a house with no zone set is not a house that sold nothing.
  - **`getPosRevenueWindow` reads the zone alongside the `hasPosHistory` probe.** It ends the window on the house's today and adds `timezone` and `zoneUnset` to the payload. With no zone it answers `zoneUnset: true` with `null` figures, `null` `from`/`to` and no window read. "No POS" still answers first.
  - **Goal progress:** a goal opens on the house date it was created, its pace runs between house midnights, and `periodStart` counts on the house calendar. `createGoal` takes its baseline the same way and refuses a windowed metric when the house has no zone. `listGoalsWithProgress` reads the zone once for the whole list.
- **`analytics.service.ts` `getPosConsumptionBreakdown`** takes `[startIso, endIso)` on the same house days as the till.
- **`analytics.controller.ts` (pos-revenue).** It passes the zone. When `zoneUnset`, it skips the consumption read and answers `consumption: null`, which means not known. `[]` would read as "sold no wine".
- **`report-export-cuttings.ts` `writeTill`.** On `zoneUnset` it says the sentence and withholds Taken, Checks and Average check with it as the reason. The basis line names the zone.
- **`scenario-verify.service.ts`.** It asks for one spare day, so a house ahead of UTC (Istanbul after 21:00 UTC) still covers `service_date`. On `zoneUnset` it reports `unverifiable` with the sentence. Its split message no longer claims GoalsService buckets on "the UTC date of closed_at".
- **Web `rp-registers-trade.tsx`.** `TillWindow` gains `timezone` and `zoneUnset`. The no-zone view draws no figure and links `/settings?tab=time-zone`. The basis line names the zone. A payload from an older gateway, which sends neither key, renders as before.
- **`goal-source-rule.spec.ts`** gives its fake house a zone, because `createGoal` now reads one. This is the 15th file.

**Performance.** Each request adds one primary-key read of `restaurants`, run in parallel with the existing probe. The fold is O(rows), with no N+1. Reads stay bounded at 365 house days plus 24 h.

## Tests, guards and harness

**Last call, run at HEAD `cfa9876d7`** (origin/main `1aa4dcb8c`, unmoved after a fresh fetch; worktree clean; 15 files):
- **Gateway jest:** pos-revenue, goal-source-rule, report-export-cuttings, scenario-verify and goal-scenarios, plus all of `src/notifications`. 33 suites, **558/558 pass**.
- **Web vitest, `src/pages/reports`:** 6 files, **136/136 pass**, including the new `rp-registers-trade.test.tsx` (5).
- **Typecheck:** gateway `tsc --noEmit -p tsconfig.spec.json` is clean apart from the known `@simplewebauthn` lines. Web `tsc --noEmit` shows only the pre-existing `@simplewebauthn/browser` error in `passkeys.ts`, which this PR does not touch.
- **eslint:** 0 errors on every changed gateway and web file (see Not covered for warnings).
- **Guards:**
  - `check_adr_numbers_unique` reports 0296 as introduced by this ref and the only owner of its number.
  - `env LC_ALL=C bash scripts/check_decision_claims.sh` checks 855 claims, and all 855 hold.
  - `check_citation_pairing`, `check_read_errors_not_swallowed`, `check_web_reads_gateway_dto_keys` and `check_no_conflict_markers` pass.
  - All three claims rows of this branch, run directly, exit 0.
- **Mutations, last call.** Each file was restored byte-identical with `cmp`, and the worktree stayed clean.
  - `houseDayOf` keyed on the UTC date: 8 tests fail, in pos-revenue (a), (b), (c), (d), (j) and the unit tests, and the verifier's LA pass.
  - `HOUSE_DAY_LOOKBACK_MS = 0`: 3 tests fail.
  - The controller answering `[]` instead of `null` for no zone: 1 test fails, (i).
  - The no-zone throw swallowed as a 0 result: 2 tests fail (the goal is not scored, and `createGoal` refuses).

**Builder's run** (8 suites, 189/189). These mutations were each killed:
- `checkInstant` flipped to opened-first;
- `houseDayOf` filing by `opened_at`;
- the goals fold handing `houseDayOf` `c.opened_at`, killed by the new (c2).

Each of the three anchors of the claim `ADR-0296-SALES-FILED-ON-THE-HOUSE-DAY` fails the claim when mutated alone.

**Verifier's run:**
- `src/analytics`, `src/notifications`, `src/simpos`, `src/reports`, `src/common` and `src/calendar`: 148 suites, **2433/2433 pass**.
- Web `src/pages/reports` and `src/pages/recommendations`: 23 files, **464/464 pass**.
- **Fail without the fix.** With the five gateway sources swapped for origin/main's, 19 tests fail in the four touched specs. With main's `rp-registers-trade.tsx`, 4 of 5 web tests fail.
- **Hand checks.** In the new tests, Jul 1 is 52 checks and $10,945 on one day, the shut Jul 22 stays empty, the booth check sits on Aug 22, and one day reads the same in a 7-day and an 8-day window. The ADR's cites were checked.

**Local Postgres harness (`pgtest.sh`): does not apply.** This lane has no migration and no SQL change, so there is no `tz-local-pg.txt` to quote.

## ADR / CLAIMS touched

- **ADR 0296, "A sale belongs to the house's day"** (new). The ruling is Locked on the founder's pick and the method is Proposed. It covers the rule, the zone, the window, the readers moved, no-zone behaviour, the payload change, six rejected options, consequences, the owed list (PR-2 and PR-3) and the review trail.
- **`.planning/decisions/README.md`**: one row for 0296.
- **`claims.d/fix-sales-belong-to-the-house-day.jsonl`**: three static rows, each failing on origin/main's copies and holding on the branch.
  - `ADR-0296-SALES-FILED-ON-THE-HOUSE-DAY`;
  - `ADR-0296-NO-ZONE-STATES-NO-FIGURE`;
  - `ADR-0296-VERIFIER-READS-HOUSE-DAYS`.

## Founder answers (verbatim, built)

- **House day** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Midnight, by close (Recommended)"*. Midnight on the house's clock; each check is filed by when it closed, else when it opened; one function (`houseDayOf`) holds the rule. This is built as worded and quoted in ADR 0296.
- **Merging** (2026-10-04 ~00:15Z): *"Merge when audited (Recommended)"*. This PR merges only after the ADR 0090 three-role audit passes and CI is green, serially on strict main.
- **Followed, not new:** DASH-G2, *"Follow rule, follow-up PR (Recommended)"* (R1b; quoted in ADR 0290). A house with no zone reads as unknown, never UTC. It rests on the 2026-09-03 call *"an unset value reads as unknown"* (ADR 0116 :181; migration `a_default_is_not_an_answer`).

## For the founder before merge

1. **The real tenant will read "time zone not set" until its zone is set.** Its `restaurants.timezone` was cleared on 2026-09-03, and the US has many zones, so `houseFrame` gives none (ADR 0207 q10). After merge:
   - the /reports till and its export state no figure and give the reason;
   - `createGoal` refuses (400) all six windowed metrics;
   - existing windowed goals read "could not be scored" with the sentence, and the per-goal progress route answers 500 with the sentence;
   - the recommendations ribbon reads every day `unknown` and gives no reason until PR-2;
   - the hourly goal-reached and ceiling-held producers count each windowed goal as `failed`, with a `GOAL_PROGRESS_UNREADABLE` warning on every tick.

   One setting clears all of it: Settings → Time zone. ADR 0207 q10 already recommends setting the zone, as a data fix on your word. Tuzlu Rüzgar has `America/Los_Angeles` and is unaffected.
2. **Extending "no zone reads as unknown" to every windowed goal is the agent's reading of your rule, not your ruling.** It covers `purchase_spend` and `bottles_sold`, which do not read `pos_checks` but are filed on house days too. It follows the 2026-09-03 rule. If you want those two scored on another basis, that is a change to `computeMetricWithSeries`.

## Forks deferred (not made here)

- **The read-side as-of control** (F-128 / A-061: the till opens on 30 days ending today) was not asked and is out of scope. This PR only makes the window end on the house's today.
- **`sale-record.producer.ts` files by `opened_at`.** Aligning it with "by close" is owed to PR-2 under the ruling. No new fork.
- **Whether to set the real tenant's zone now** (ADR 0207 q10) is a data fix on your word. Nothing here writes it.

## Merge-order notes

The coordinator's order: **cap → (netsales | tz PR-1, whichever passes audit first; the other rebases) → caltakings → sig/rec/booth → tz PR-2 → logs → tz PR-3.** Dash can go in any order. I measured each lane with `git merge-tree` against this HEAD:
- **cap** (`fix/analytics-reads-past-row-cap`, ADR 0292) conflicts in `goals.service.ts`, `analytics.service.ts` and `README.md`. Cap merges first. Resolve by keeping cap's `readWholeWindow` wrapper and putting tz's house bounds (`sinceIso`/`untilIso` from `houseDayBounds`) and the `fileByHouseDay` fold inside its builder closures.
- **netsales** (`fix/owner-sales-read-net`, AW17) conflicts in `goals.service.ts`, `pos-revenue.spec.ts`, `report-export-cuttings.ts`, `scenario-verify.service.ts`, `rp-registers-trade.tsx` and `README.md`. The overlap is mechanical: netsales changes the summed column (total → subtotal) and tz changes the day key and the bounds. **The merged basis line, on both the page and the export, must name both "net" and the zone.**
- **booth and proxies** conflict only in `README.md`. Their `report-export-cuttings.*` and `analytics.service.ts` hunks merge cleanly. **sig** merges clean.
- **`README.md`** is append-only. Keep both rows by number.
- **PR-2** stacks on this branch, after caltakings (ADR 0287) and cap. **PR-3** stacks on `fix/logs-jump-to-a-date` (ADR 0277).

## Not covered (CLAUDE.md §0.5)

- **No Browser-pane check.** The plan called for the /reports till on a local seed, once with a zone and once without, with screenshots. That was not done, by the builder, the verifier or me. Only jsdom tests cover the no-zone sentence, the Settings link (`/settings?tab=time-zone`; the tab exists and `SettingsNext` reads `?tab=`) and the basis line.
- **F-086 is half-closed until PR-2 and PR-3.** /calendar (`recorded-days.service.ts`), the insight series and the ribbon still file on UTC, and /logs on the browser's day. Before this PR the till, goals, the verifier and /calendar agreed, all on UTC and all wrong. For a Los Angeles house they now differ for every check that closes after 17:00 local. The comment at `recorded-days.service.ts:91-93`, that the calendar and goal progress "can never disagree", is false until PR-2.
- **The ribbon, with a zone, gains two `unknown` cells until PR-2**, because it still keys its own "today" on the UTC date:
  - a Los Angeles house: the cell marked today, from 17:00 local (16:00 in winter) to midnight;
  - an Istanbul house: the 1st of the month on screen, after 21:00 UTC.
- **Synthetic fixtures only.** The tests are shaped on Tuzlu's figures; nothing read the real feed, by rule. Nothing was deployed or checked in production.
- **A check opened more than 24 h before the window and closed inside it is missed** (`HOUSE_DAY_LOOKBACK_MS`). ADR 0296 states this.
- **The `day > untilDate` guard in `fileByHouseDay` is untested.** Deleting it survives all 30 pos-revenue tests. It is defensive only: `untilDate` is always the house's today, so no wrong figure is possible today.
- **Scenario verifier edge:** a `service_date` exactly 365 days back now reads `unverifiable` (span 366 > 365) where it was verifiable before. The message says why. ADR 0296 does not mention it.
- **Status codes for a house with no zone:**
  - The per-goal progress route answers **500** with the zone sentence. That is a settings gap reported with a server-error status, because the route maps every error to 500.
  - `createGoal`'s controller maps every error to 400, so a failed `restaurants` read during `createGoal` reads as 400.
- **The plan's `house-day.spec.ts` was folded into `pos-revenue.spec.ts`** (`describe("house-day — the one rule (ADR 0296)")`), to keep the 15-file cap.
- **Lint warnings:**
  - `report-export-cuttings.spec.ts` gains 5 prettier warnings on new lines (37 on main, 42 here). CI's `pnpm run lint` runs `--fix` with no warning cap.
  - `goals.service.ts` has 4 prettier warnings and `analytics.controller.ts` 6, none on changed lines.
- **Suites not run:** the full gateway jest (the verifier ran six directories, 148 suites) and the repo-wide vitest (reports and recommendations only).
- **Guards that cannot run here:** six CI guards need `.env` or a database: `check_beverage_identity_parity`, `check_beverage_kind_regression`, `check_display_name_parity`, `check_definer_functions_closed`, `check_house_item_invariants` and `check_migration_ledger`. They are unrelated to this diff and were not compared on origin/main.
- **CI has not run.** Nothing is pushed.
- **Out of lane, and still wrong for Tuzlu:**
  - the consumption breakdown beside the till files on `created_at`, which is Tuzlu's Oct 2 import day (F-129), so a Jul–Aug window still shows no per-wine lines until the backfill;
  - A-057, A-058, A-059 and A-061;
  - the other UTC readers in ADR 0296's Owed list (`advanced-analytics.service.ts`, `analytics.service.ts` `loadConsumption`/`toDailySeries`, `inventory.service.ts` item activity, the dashboard's `getSalesChart` and month).
- **Retire-to-write (CLAUDE.md §4).** The branch adds ADR 0296 and a claims fragment and retires nothing. They are the records §5 and §5b require.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

