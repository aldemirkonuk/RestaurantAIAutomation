> **[2026-10-06 ~17:06Z, coordinator, push]** Pushed head **`ae079c377`**: this body's last-call head `93cccf2cc`, then `f01e5356f`, one merge of origin/main `5c07cfb23` (#622), which also brings `4528b9689` (#621); the merge was clean (`git merge-tree` exit 0). Then `ae079c377` quotes the founder's ruling below in ADR 0296 §5, with no code change. At this head:
> - fast guards (migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers) all exit 0;
> - 15 files against origin/main;
> - gate ownership `[]` by origin/main's classifier;
> - decision claims PASS, 912 of 912 holding (run with Python 3.11: `/usr/bin/python3` here is 3.9, which cannot run ADR 0224's host check).
>
> This head is not audited. The BLOCK at `18c19a002` stands until a fresh full audit of this head checks that its blocker is fixed. The three dropped claims rows (see CLAIMS below) are still owed in a follow-up PR.
>
> **Founder ruling, 2026-10-06 ~16:55Z (AskUserQuestion), on the pace fix at `d7adf1862`:** verbatim pick *"Say why, as built (Recommended)"*. A days-of-stock goal with a deadline, in a house with no zone, keeps saying its pace is not judged until the zone is set, with the Settings link. Rejected with it: judging the pace only when every possible zone agrees, and a UTC pace marked approximate. ADR 0296 §5 quotes it at `ae079c377`.

**[2026-10-06, last call, lane tz] Head `93cccf2cc`.** `a67e77d95` merges `origin/main` `54f833e4b` (#627). Its only conflict was the README index, resolved by keeping both rows in number order (0296, 0301). Since the first audit pass at `18c19a002`:
- `d7adf1862` fixes that pass's BLOCK: a goal with a deadline read "No deadline" in a house with no zone.
- `93cccf2cc` narrows three sentences in this branch's own records.

Nothing is pushed, so CI has not run on these commits. The PR is 15 files.

After that merge, `origin/main` moved to `4528b9689` (#621 tables). `git merge-tree` of this head with it is clean. #621 touches two of this PR's files, `analytics.controller.ts` (a new PATCH `tables` route) and `report-export-cuttings.ts` (`writeSeats`), in hunks this PR does not touch. The branch was not re-merged and the tests were not re-run on that tree. Lines below that name an older head describe the PR at that head. The previous body is saved as `pr/tz.18c19a002.md`.

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

**Scope of this PR.** This is PR-1 of three under one rule (lane plan `cont/tz-plan.json`; one PR would be 21+ files). It fixes A-027 and moves the till, goals, the consumption breakdown, the export and the verifier onto house days. **It closes F-086 for those readers only.** PR-2 owns /calendar (A-026), the insight bundle's daily series (A-060) and the recommendations ribbon. PR-3 owns /logs (A-056). Until those land, the surfaces disagree about a check's day (see Not covered). The plan places A-057, A-058, A-059 and A-061 outside this lane (F-128, F-129 and C02 back-dating).

## What changed and why

The rule is one function in one new file, and every reader in scope goes through it.

- **`common/house-day.ts` (new).**
  - `houseDayOf(subject, zone)` is the rule. Handed a check, it files the check by when it closed, else when it opened. Handed an instant (a delivery, a consumption line, a goal's creation), it files that instant. The day ends at midnight on the house's clock. The formatter is cached per zone.
  - `checkInstant` (closed-else-opened) is not exported, so no reader can file a check by its other timestamp without visibly going around the rule.
  - `readHouseZone` reads `restaurants.timezone, country` by primary key and resolves the zone through `houseFrame`: the house's own zone, else its country's only zone (ADR 0207 q6), else none. **A read error throws.** It is never folded into "no zone".
  - `houseDayBounds` gives the midnights through `service-day.ts` `localMidnight` (for the DST-at-midnight exception, see Not covered).
  - `houseToday`, `shiftHouseDay` and `HOUSE_DAY_LOOKBACK_MS` (24 h) complete the file, with two sentences:
    - `HOUSE_ZONE_UNSET`, for a withheld figure;
    - `HOUSE_ZONE_UNSET_PACE`, for a withheld pace.
  - It adds no time maths of its own: it reuses `house-frame.ts` and `service-day.ts`.
- **`goals.service.ts`.**
  - **`computeMetricWithSeries` takes the zone.** All six windowed metrics read from 24 h before the first house midnight up to the end of the last house day. A shared `fileByHouseDay` then files each row through `houseDayOf` and drops rows outside `[from, to]`, so a day reads the same in every window. Checks are handed to the rule whole. Orders are filed by `delivered_at || created_at`, and consumption lines by `created_at`.
  - **With no zone it throws `HOUSE_ZONE_UNSET` outside the metric's `catch`.** That `catch` turns errors into 0, and a house with no zone set is not a house that sold nothing.
  - **`getPosRevenueWindow` reads the zone alongside the `hasPosHistory` probe.** It ends the window on the house's today and adds `timezone` and `zoneUnset` to the payload. With no zone it answers `zoneUnset: true` with `null` figures, `null` `from`/`to` and no window read. "No POS" still answers first.
  - **Goal progress.**
    - A goal opens on the house date it was created, and its pace runs between house midnights.
    - `periodStart` counts on the house calendar.
    - `createGoal` takes its baseline the same way and refuses a windowed metric when the house has no zone.
    - `listGoalsWithProgress` reads the zone once for the whole list.
  - **A goal's pace in a house with no zone (`d7adf1862`, the fix for the BLOCK at `18c19a002`).**
    - Only a days-of-stock goal is scored with no zone: it is what is on the shelf now.
    - At `18c19a002`, `goals.service.ts:504` (`goal.deadline && zone && periodStart`) left its `onTrack` null, and every page read a null pace as "no deadline": the reports goals card, the On pace tile, the goals export and the recommendations margin.
    - Goal progress now answers `paceUnread` for a goal with a deadline and no zone, else `null`. It carries `HOUSE_ZONE_UNSET_PACE`, which names the missing zone and points to Settings.
- **`analytics.service.ts` `getPosConsumptionBreakdown`** takes `[startIso, endIso)` on the same house days as the till.
- **`analytics.controller.ts` (pos-revenue).** It passes the zone. When `zoneUnset`, it skips the consumption read and answers `consumption: null`, which means not known. `[]` would read as "sold no wine".
- **`report-export-cuttings.ts`.**
  - `writeTill`: on `zoneUnset` it says the sentence and withholds Taken, Checks and Average check with it as the reason. The basis line names the zone.
  - `writeGoals`: it withholds a goal's pace with `paceUnread` as the reason. When a goal carries a deadline, the summary says "no goal's pace was judged; each goal's row says why" instead of "no goal carries a deadline".
- **`scenario-verify.service.ts`.** It asks for one spare day, so a house ahead of UTC (Istanbul after 21:00 UTC) still covers `service_date`. On `zoneUnset` it reports `unverifiable` with the sentence. Its split message no longer claims GoalsService buckets on "the UTC date of closed_at".
- **Web `rp-registers-trade.tsx`.** `TillWindow` gains `timezone` and `zoneUnset`. The no-zone view draws no figure and links `/settings?tab=time-zone`. The basis line names the zone. A payload from an older gateway, which sends neither key, renders as before.
- **Web `rp-registers-goals.tsx`.**
  - The card's caption moves into `paceCaption(g)`. It prints `paceUnread`, or "The pace against this deadline was not computed." when a deadline has no pace and no reason. It says "No deadline" only of a goal with none.
  - "Not enough history to project" is drawn only under a judged pace.
  - When a goal carries a deadline, the On pace tile's note reads "no goal's pace was judged; each goal says why".
- **Web `rec-masthead.ts`.** A row carries the goal's `deadline`. `paceOf` answers "Pace unknown" for a goal with a deadline and no judgement, and "No deadline" only for a goal with none.
- **`goal-source-rule.spec.ts`** gives its fake house a zone, because `createGoal` now reads one.

**Performance.** Each pos-revenue or goal-list request adds one primary-key read of `restaurants`, run in parallel with an existing read. The fold is O(rows), with no N+1. Reads stay bounded at 365 house days plus 24 h. A `getGoalProgress` call without a known zone (the per-goal route, the two goal producers) reads the row once per call.

**The 15 files.**
- Records: `.planning/decisions/0296-a-sale-belongs-to-the-houses-day.md` (new) and `.planning/decisions/README.md` (one row).
- Gateway, `apps/api-gateway/src/`: `analytics/analytics.controller.ts`, `analytics/analytics.service.ts`, `analytics/goal-source-rule.spec.ts`, `analytics/goals.service.ts`, `analytics/pos-revenue.spec.ts`, `common/house-day.ts` (new), `reports/exports/report-export-cuttings.ts`, `simpos/scenario-verify.service.spec.ts` and `simpos/scenario-verify.service.ts`.
- Web, `apps/web/src/pages/`: `recommendations/next/rec-masthead.ts`, `reports/next/rp-registers-goals.tsx`, `reports/next/rp-registers-trade.test.tsx` and `reports/next/rp-registers-trade.tsx`.

Against `18c19a002`, `report-export-cuttings.spec.ts` (its till cases moved into `pos-revenue.spec.ts`) and the claims fragment left the PR. `rp-registers-goals.tsx` and `rec-masthead.ts` joined it.

## Tests, guards and harness

**Last call (`a67e77d95`, then `93cccf2cc`).** origin/main is `54f833e4b`, the worktree is clean and the PR is 15 files.
- **Gateway jest at `a67e77d95`:** `src/analytics`, `src/reports/exports`, `src/simpos`, `src/notifications/producers` and `src/common`, 117 suites, **1934/1934 pass**.
- **Gateway jest at `93cccf2cc`:** its only code change is a comment. `pos-revenue`, `goal-source-rule` and `scenario-verify` pass 67/67.
- **Web vitest:** `src/pages/reports` and `src/pages/recommendations`, 23 files, **471/471 pass**. That includes `rp-registers-trade.test.tsx` (11: 5 till, 6 goal-pace).
- **Typecheck:** gateway `tsc --noEmit -p tsconfig.spec.json` and web `tsc --noEmit` are clean apart from the known `@simplewebauthn` lines.
- **eslint:**
  - 0 errors on the 9 gateway and 4 web files.
  - The gateway warnings are all prettier, and each file has the same count as its `origin/main` copy: `analytics.controller` 6, `analytics.service` 1, `goal-source-rule.spec` 2, `goals.service` 4, `report-export-cuttings` 59, `scenario-verify.service.spec` 2. The other three have none.
  - Web `--quiet` is clean.
- **Guards at `a67e77d95`:**
  - All 44 Python guards named in `ci.yml` exit 0.
  - The `--self-test` of `adr_numbers_unique`, `web_reads_gateway_dto_keys`, `read_errors_not_swallowed`, `windowed_figures`, `citation_pairing` and `no_conflict_markers` passes.
  - The shell guards `no_direct_stock_writes`, `no_direct_type_attributes_access`, `model_calls_logged` and `decision_claims` exit 0.
- **Guards at `93cccf2cc`:**
  - `check_decision_claims.sh`: 893 checked, 893 holding.
  - `check_adr_numbers_unique` (0296 wears one slug across 1729 refs), `check_citation_pairing`, `check_no_conflict_markers` and `check_od_ids_exist` exit 0.
  - `pr_audit_gate.py` `ownership_between(origin/main, HEAD)` is `[]`.
- **Mutations.** Each file was restored byte-identical (`cmp`), and the worktree was clean after each.
  - Dropping the `paceUnread` assignment fails (k): 1 of 37 fail.
  - Two web mutations together fail 2 tests: `paceOf` answering "No deadline" for any null pace, and the desk caption ignoring `paceUnread`.
  - Deleting the fold's `day > untilDate` guard leaves 60/60 passing (see Not covered).

**Fix round (`d7adf1862`), builder.**
- With `18c19a002`'s `goals.service.ts` and `report-export-cuttings.ts`, 4 of 37 pos-revenue tests fail: (k), (k2), (k3) and the goals-export pace case. All 37 pass on the fix.
- With `18c19a002`'s `rp-registers-goals.tsx` and `rec-masthead.ts`, 6 of 11 web tests fail. All 11 pass on the fix.
- The DST bounds were re-measured with ts-node. Santiago 2026-09-06 gives 03:00Z, filed on Sep 5; São Paulo 2018-11-04 gives 02:00Z, filed on Nov 3. Los Angeles (23 h and 25 h days), Berlin and Santiago 2026-04-05 are correct.

**Verifier at `d7adf1862`: pass.**
- Gateway analytics, goals, reports, simpos and notifications suites pass 2252/2252, and web passes 471/471.
- Of 17 source mutations, the specs killed 15. The 2 survivors are equivalent mutants (redundant guards), and their stronger versions were killed.
- Its 10 notes are all minor:
  - this last call fixed two: the "one sentence" comment, and the producers missing from the ADR;
  - it resolved a third, the README conflict, in the merge;
  - the rest are under Not covered and Forks deferred.

**Earlier heads (`cfa9876d7`, `18c19a002`).** The same specs passed. Each of these mutations was killed:
- `houseDayOf` keyed on the UTC date (8 tests fail);
- opened-first instead of closed-first;
- the lookback set to 0;
- the controller answering `[]` for no zone;
- the no-zone throw swallowed as 0;
- the lower-day drop removed;
- a goal's `created_at` filed by its UTC date;
- the consumption bound `lt` changed to `lte`;
- the pace on UTC;
- the export's `zoneUnset` branch and its basis line.

Fail without the fix: with main's five gateway sources, 19 tests fail in the four touched specs. With main's `rp-registers-trade.tsx`, 4 of the 5 till tests fail. The first audit at `18c19a002` is in `audits/616-18c19a002/report.md`.

**Local Postgres harness (`pgtest.sh`): does not apply.** This PR has no migration and no SQL change, so there is no `tz-local-pg.txt` to quote.

## ADR / CLAIMS touched

- **ADR 0296, "A sale belongs to the house's day"** (new).
  - The ruling is Locked on the founder's pick; the method is Proposed.
  - It covers the rule, the zone, the window, the readers moved, no-zone behaviour (the pace included), the payload change (`timezone`, `zoneUnset`, `paceUnread`), six rejected options, consequences, the owed list (PR-2, PR-3) and a four-row review trail.
  - At `d7adf1862` §1 was narrowed (midnight-DST) and §5 narrowed (the pace needs a zone).
  - At `93cccf2cc`:
    - the "one sentence" line was corrected;
    - §5's heading became "No zone states nothing that is filed on a day";
    - the goal producers were added to Consequences.
- **`.planning/decisions/README.md`**: one row for 0296. At `93cccf2cc` its wording was narrowed to "states no figure filed on a day and points to Settings".
- **CLAIMS: none.** The three rows of `claims.d/fix-sales-belong-to-the-house-day.jsonl` were dropped at `d7adf1862` to keep the PR at 15 files: `ADR-0296-SALES-FILED-ON-THE-HOUSE-DAY`, `ADR-0296-NO-ZONE-STATES-NO-FIGURE` and `ADR-0296-VERIFIER-READS-HOUSE-DAYS`. The behaviour tests hold each row's anchors (see Forks deferred).

## Founder answers (verbatim)

- **House day** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Midnight, by close (Recommended)"*. Midnight on the house's clock; each check is filed by when it closed, else when it opened; one function (`houseDayOf`) holds the rule. It is built as worded and quoted in ADR 0296.
- **A house with no zone** (asked 2026-10-04 ~22:35Z, after this PR opened):
  - Q1: *"When a house signs up, when, whenever it adds a restaurant or anything else, when they type in their addresses, that also shows which time zone they are in. Unless they are want to change."*
  - Q2, purchase spend and bottles sold with no zone: *"we can ask for the location and use it for that if the time zone is not set i mean it's not possible since it's if it's an e restaurant otherwise all restaurants need a re other address right or we're just going to use system time zone that work"*
  - Follow-ups (~22:40Z): the system zone is *"The owner's device (Recommended)"*. This PR's timing is *"Merge #616 first (Recommended)"*.
  - **None of these is built here.** The zone from the address, with the owner's device as the fallback, is the zoneaddr lane's: ADR 0304 on #620, PR-1 of 5, open. Until that lane back-fills a house, the house reads "not set", as this PR builds it. ADR 0296's Consequences point to that lane's ADR.
- **Merging** (2026-10-04 ~00:15Z): *"Merge when audited (Recommended)"*.
- **Followed, not new:** DASH-G2, *"Follow rule, follow-up PR (Recommended)"* (R1b; quoted in ADR 0290 on #622). A house with no zone reads as unknown, never UTC. It rests on the 2026-09-03 call *"an unset value reads as unknown"* (migration `a_default_is_not_an_answer` :4; ADR 0116 :180-181).

## What a house with no zone sees after this PR (answered: merge first)

The real tenant (Meyhouse) has had no `restaurants.timezone` since 2026-09-03. The US has many zones, so `houseFrame` gives none (ADR 0207 q10). Tuzlu Rüzgar has `America/Los_Angeles` and is unaffected. Until the zoneaddr lane back-fills a zone, which needs a dry run and the founder's yes, or an owner sets one in Settings → Time zone:
- the /reports till and its export state no figure and give the reason;
- `createGoal` refuses (400) all six windowed metrics. Only a days-of-stock goal can be created;
- existing windowed goals read "could not be scored" with the sentence. The per-goal progress route answers 500 with the sentence;
- a days-of-stock goal with a deadline shows its number, and says its pace is not judged until the zone is set ("Pace unknown" in the recommendations margin);
- the recommendations ribbon reads every day `unknown` and gives no reason until PR-2;
- the hourly goal-reached and ceiling-held producers count each windowed goal they would judge as `failed`, with a `GOAL_PROGRESS_UNREADABLE` / `CEILING_PROGRESS_UNREADABLE` warning every tick.

## Forks deferred (not made here)

1. **The three CLAIMS rows need a 16th file.**
   - Options:
     - (a) a follow-up docs PR after this merges, restoring `claims.d/fix-sales-belong-to-the-house-day.jsonl` with its three rows re-checked against main;
     - (b) a one-off 16-file allowance for this PR, as was given for #603;
     - (c) leave the rule guarded by specs only.
   - **Recommendation: (a).** It costs one small PR and no cap exception. Until then CI guards the rule only through the jest specs, not through `check_decision_claims.sh`.
2. **A pace that needs no zone**, for example a deadline at UTC midnight or on the device's clock.
   - It is not built, because it needs a ruling. DASH-G2 rules out UTC.
   - **Recommendation: do not build it.** The zoneaddr lane gives every house a zone (its address, else the owner's device), which makes it moot.
3. **The read-side as-of control** (F-128 / A-061: the till opens on 30 days ending today) was not asked and is out of scope. This PR only ends the window on the house's today.
4. **`sale-record.producer.ts` files by `opened_at`.** Aligning it with "by close" is owed to PR-2 under the ruling. This is not a new fork.

## Merge-order notes

Measured with `git merge-tree` against `93cccf2cc`, counting only this PR's files. Some branches also conflict with main itself in `scripts/sql_outside_migrations.txt` or `insight-generator.service.ts`; those are not this PR's.
- **#609 cap** (`fix/analytics-reads-past-row-cap`, ADR 0292) conflicts in `goals.service.ts` and `analytics.service.ts`.
  - Cap merges first.
  - Resolve by keeping cap's `readWholeWindow` wrapper and putting tz's house bounds (`sinceIso`/`untilIso` from `houseDayBounds`) and the `fileByHouseDay` fold inside its builder closures.
- **#615 netsales** (`fix/owner-sales-read-net`, ADR 0295) conflicts in six files: `goals.service.ts`, `pos-revenue.spec.ts`, `report-export-cuttings.ts`, `scenario-verify.service.ts`, `rp-registers-trade.tsx` and `README.md`.
  - The overlap is mechanical: netsales changes the summed column (total → subtotal), and tz changes the day key and the bounds.
  - **The merged basis line, on both the page and the export, must name both "net" and the zone.**
  - Whichever of netsales and tz passes audit first merges, and the other re-heads.
- **#626 units** (stacked on cap) conflicts in `goals.service.ts`, `analytics.service.ts`, `report-export-cuttings.ts` and `README.md`. Its head includes cap, so most of this is cap's overlap.
- **Clean in this PR's files:** #617 proxies, #618 booth, #619 stockout, #620 zoneaddr, #624, #625 and #564 conflict at most in `README.md`. Several of them conflict nowhere in this PR's files.
- **#621 tables is merged** (`4528b9689`). It merges into this head without conflict (see the status line).
- **`README.md`** is append-only. Keep both rows by number.
- **PR-2** stacks on this branch, after caltakings (#610, ADR 0287) and cap.
- **PR-3** builds on main: ADR 0277's /logs is merged (#601).

## Not covered (CLAUDE.md §0.5)

- **No Browser-pane check.** No builder, verifier or last-call run rendered the /reports till or the goals desk, with a zone or without. jsdom tests cover:
  - the no-zone sentence;
  - the Settings link (`/settings?tab=time-zone`; the tab exists, and `SettingsNext` reads `?tab=`);
  - the basis line;
  - the pace captions.
- **F-086 is half-closed until PR-2 and PR-3.** /calendar (`recorded-days.service.ts`), the insight series and the ribbon still file on UTC, and /logs on the browser's day.
  - Before this PR the till, goals, the verifier and /calendar agreed, all on UTC and all wrong.
  - For a Los Angeles house they now differ for every check that closes after 17:00 local (16:00 in winter).
  - `recorded-days.service.ts:91-93` says the calendar and goal progress "can never disagree", which is false until PR-2.
- **With a zone, the ribbon gains two `unknown` cells until PR-2**, because it still keys its own "today" on the UTC date:
  - for a Los Angeles house, the cell marked today, from 17:00 local (16:00 in winter) to midnight;
  - for an Istanbul house, the 1st of the month on screen, after 21:00 UTC.
- **No CLAIMS row guards ADR 0296** (Forks deferred 1).
- **Weaker reasons on two surfaces.** The recommendations margin says "Pace unknown" and gives no reason, because showing the gateway's reason would need `GoalsMargin.tsx`, a 16th file. The mobile insights tab prints no pace word when `onTrack` is null; it says nothing false and nothing about why. The reports desk and the export give the reason.
- **The DST-at-midnight hour is not fixed.** In Santiago (spring, 2026-09-06) and historical São Paulo, `localMidnight` answers 23:00 the evening before, so bounds on that day are an hour early.
  - The fold still files each check correctly.
  - Three things are off: a window ending the day before stops an hour short; the consumption breakdown counts that hour on the change day; and a pace starting or ending that day is measured from or to 23:00 the evening before.
  - Fixing it means changing `service-day.ts` `localMidnight`, which predates this PR and is shared with the notification producers. ADR 0296 §1 and Consequences record it. No zone Tuzlu uses is affected.
- **Synthetic fixtures only.** The tests are shaped on Tuzlu's figures, and by rule nothing read the real feed. Nothing was deployed or checked in production.
- **A check opened more than 24 h before the window and closed inside it is missed** (`HOUSE_DAY_LOOKBACK_MS`). ADR 0296 states this.
- **The fold's `day > untilDate` guard is untested.** Deleting it leaves the 60 pos-revenue and scenario-verify tests passing (re-measured at this last call). `untilDate` is always the house's today, so the guard only matters for a check whose `closed_at` is stamped after today.
- **Scenario verifier edge:** a `service_date` exactly 365 days back now reads `unverifiable` (span 366 > 365) where it was verifiable before. The message says why; ADR 0296 does not mention it.
- **Status codes for a house with no zone:**
  - The per-goal progress route answers **500** with the zone sentence, because the route maps every error to 500. That is a settings gap reported with a server-error status.
  - `createGoal`'s controller maps every error to 400, so a failed `restaurants` read during `createGoal` also reads as 400.
- **Producer noise and cost for a house with no zone:**
  - A `failed` count and a warning every hour per windowed goal.
  - One `restaurants` read per goal per producer call; `listGoalsWithProgress` reads it once.
  - Both are in ADR 0296 Consequences.
- **Pre-existing, out of lane:**
  - The windowed metrics still read `const { data } = await q` and drop `error`, so a failed read there becomes an empty or zero result. Cap (#609) moves the `bottles_sold` and check reads onto `readWholeWindow`; `purchase_spend` keeps the pattern.
  - The notification producers fall back to UTC for a house with no zone (`notification-producers.service.ts:462-470`).
- **Suites and guards not run:**
  - the full gateway jest (117 suites in five directories ran) and the repo-wide vitest (two directories ran);
  - `check_gateway_boots.sh`;
  - the schema-parity workflow's database guards (`check_beverage_identity_parity`, `check_definer_functions_closed`, `check_migration_ledger`), which are unrelated to a diff with no SQL.
- **CI has not run** on `d7adf1862`, `a67e77d95` or `93cccf2cc`. Nothing is pushed.
- **Not re-tested against the newest main.** The tests were not re-run on this head merged with `origin/main` `4528b9689` (#621). The merge is clean and the two shared files change in unrelated hunks.
- **Commit hygiene.** Three merge commits from `origin/main` carry git's default message, with no body and no `Co-Authored-By` trailer: `18c19a002`, `61f6a9d0f` (made before the fix round) and `a67e77d95` (this last call). History was not rewritten to add them.
- **Out of lane, and still wrong for Tuzlu:**
  - The consumption breakdown beside the till files on `created_at`. That is Tuzlu's Oct 2 import day (F-129), so a Jul–Aug window shows no per-wine lines until the backfill.
  - A-057, A-058, A-059 and A-061.
  - The other UTC readers in ADR 0296's Owed list: `advanced-analytics.service.ts`, `analytics.service.ts` `loadConsumption`/`toDailySeries`, `inventory.service.ts` item activity, the dashboard's `getSalesChart` and the dashboard month.
- **Retire-to-write (CLAUDE.md §4).** The branch adds ADR 0296 and retires nothing. That is the record §5 requires. The claims fragment that §5b asks for is now owed (Forks deferred 1).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
