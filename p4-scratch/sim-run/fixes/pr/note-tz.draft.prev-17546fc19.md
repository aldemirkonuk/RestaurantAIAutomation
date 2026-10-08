> **[2026-10-07 20:17Z, fixer, local head `17546fc19`]** This builds the founder's 19:48:13Z answer on the could-not-be-scored card, takes the PR back to 15 files, kills the goal fold's three surviving mutants, and merges origin/main `ca3582988` (#649). LOCAL ONLY: nothing is pushed and the live body is not edited. Files against origin/main `ca3582988`: **15** (`git diff --name-only origin/main...HEAD | wc -l`), none of them SQL. `simpos/scenario-verify.service.spec.ts` is no longer one of them.
>
> **Founder answer, 2026-10-07 19:48:13Z (AskUserQuestion, transcript stamp; `fixes/briefs/answers-2026-10-07-pm.md:46-48`).** Q: *"#616: in a house with no time zone, a goal with a date window on /reports says 'This goal could not be scored (…set it in Settings, under Time zone)' as plain text. You asked for a link on the pace reason; this sentence wasn't in that question. Add the same link here?"*
> - Picked **"Add the link (Recommended)"**: *"The same /settings time-zone link as the pace reason. One card branch and one test, in files already in #616, which is being re-audited anyway."*
> - Rejected "Keep it as text": *"The sentence already says where to go; no code change."*
>
> **Commits since the live head `ae079c377`** (oldest first; the two notes below give the first eleven in full)
> - `d6f45604a` merges origin/main `42fe1252b` (#651), clean.
> - `a9320bc4a` `fix(reports)`: the goal card's no-zone pace reason links to Settings.
> - `8e6d7f25d` `docs(adr-0296)`: quotes the 12:02:43Z pick.
> - `cf317f9d1` merges origin/main `5e6c0684e` (#620), clean.
> - `50fbcd87d` `docs(adr-0296)`: the zoneaddr lane's ADR is no longer owed.
> - `9068a5a32` merges origin/main `b270a45b8` (#609) by hand.
> - `b9aa5dfaf` `test(reports)`: kills `paceAwaitsZone`'s two survivors.
> - `f26f3d66a` `docs(adr-0296)`: records the could-not-be-scored link as an open fork.
> - `b5c6227ed` `docs(adr-0296)`: the #609 merge takes the PR to 16 files.
> - `f252d1740` `style(analytics)`: wraps the merged whole-read case.
> - `131da0281` `docs(adr-0296)`: only the goal reads are widened and folded.
> - **New this round:**
>   - `3f32c334d` merges origin/main `ca3582988` (#649) via `merge_main.sh`, clean.
>   - `82549ea83` `test(simpos)`: back to 15 files.
>     - `simpos/scenario-verify.service.spec.ts` is origin/main's bytes again: `git diff origin/main -- <file>` is empty. Main's 20 cases pass against this lane's `scenario-verify.service.ts`.
>     - Its three ADR 0296 cases moved into `analytics/pos-revenue.spec.ts`, describe "ScenarioVerifyService — pos revenue on the house's day (ADR 0296)", with the same assertions: a Los Angeles service day passes at 250; a house with no zone is `unverifiable` with `HOUSE_ZONE_UNSET` in the detail; Istanbul at 23:30Z asks `getPosRevenueWindow("r-sim", 2)` and passes at 125.
>     - No UTC fallback was added, and no assertion was weakened.
>   - `f25f384c9` `test(analytics)`: kills the goal fold's three surviving mutants. A new describe in `pos-revenue.spec.ts`, "the goal reads file every row on the house's day (ADR 0296)", runs the fold in `America/Los_Angeles`:
>     - `bottles_sold` rows at 05:00Z and 17:00Z on 2026-08-31 file on 08-30 and 08-31;
>     - `purchase_spend` deliveries at 04:00Z and 16:00Z on 2026-08-31 file on 08-30 and 08-31;
>     - with `untilDate` 2026-08-30, a check that closed on 2026-08-31 is dropped (the stub ignores the read's `lte`, as an over-wide read would).
>   - `9449a4a7c` `fix(reports)`: builds the 19:48:13Z answer.
>     - Gateway, `goals.service.ts:422-430`: the goal list's unreadable entry gains `zoneUnset`, true only when its reason is `HOUSE_ZONE_UNSET`.
>     - Web, `rp-registers-goals.tsx:698-705`: the card draws "Set the time zone in Settings" (`/settings?tab=time-zone`, the pace link's classes) after "This goal could not be scored (…). Nothing below it is claimed." only for such an entry. `select` reads the flag only off an unreadable entry (`:829`).
>     - That is one field more than "one card branch and one test": I chose a typed flag over matching the gateway's sentence on the web, as `paceUnread` and the till's `zoneUnset` already do. ADR 0296 §5 says so.
>     - Tests: one jsdom case in `rp-registers-trade.test.tsx` and one gateway case in `pos-revenue.spec.ts` ("marks a goal that could not be read for another reason as not a zone matter"); the no-zone list case now also asserts `zoneUnset: true`.
>   - `17546fc19` `docs(adr-0296)`: records the answer.
>     - §5 quotes it verbatim (question, pick, rejected option, time). The OPEN-fork bullet, its "Until he answers" line, Status, §6's payload bullet and the real-tenant Consequences bullet get dated brackets; the old words stay.
>     - Links: "the till's and goals' window reads, read whole or refused" is narrowed in a bracket. The goals' `purchase_spend` read is still unranged.
>     - "this PR's 15-file budget" is bracketed: the PR was then at 16 files, and is back at 15 since `82549ea83`. The Owed bullet now says no allowance is needed.
>     - The 2026-10-06 "Say why, as built" time "~16:55Z" is bracketed with the transcript stamp 2026-10-06T16:55:23Z (`fixes/README.md:247`).
>     - One review-trail row. README row 0296 ("points to Settings") is still true and is unchanged.
>
> **Tests** (at `17546fc19`; `17546fc19` changes only the ADR)
> - **Gateway jest**, over `src/analytics`, `src/common`, `src/simpos`, `src/reports/exports`, `src/notifications/producers`, `src/settings`, `src/calendar` and `src/dashboard`: `Test Suites: 152 passed, 152 total` / `Tests:       2582 passed, 2582 total`. `pos-revenue.spec.ts` alone: 44/44. `simpos/scenario-verify.service.spec.ts` (main's bytes): 20/20.
> - **Web vitest**, over `src/pages/reports`, `src/pages/recommendations` and `src/pages/settings`: `Test Files  35 passed (35)` / `Tests  663 passed (663)`. `rp-registers-trade.test.tsx` holds 13 cases: 5 till, 8 goal.
> - **Mutations.** Each was applied with a Python replace, run, restored from a `cp -p` copy, and checked with `cmp`. The worktree was clean after every one.
>   - Fold, in `goals.service.ts`, with `pos-revenue.spec.ts` at `17546fc19`. Each fails 1 of 44:
>     - A: `bottles_sold` filed by `String(c.created_at).slice(0, 10)`;
>     - B: `purchase_spend` filed by `String(o.delivered_at || o.created_at).slice(0, 10)`;
>     - C: the `untilDate !== undefined && day > untilDate` drop deleted.
>   - The same three, with `pos-revenue.spec.ts` at `82549ea83` (before the new cases): each leaves `src/analytics` plus `common/read-whole-window.spec.ts` at 944/944 passing.
>   - Gateway flag, `pos-revenue.spec.ts`, each fails 1 of 44: `zoneUnset: true` always fails "marks a goal that could not be read for another reason…"; `zoneUnset: false` always fails "scores no goal for a house with no zone, and says why".
>   - Verifier, moved cases, run with `pos-revenue.spec.ts` and `src/simpos` (83 tests), each fails 1: dropping the spare day (`span = back`) fails "still covers service_date when the house is a day ahead of UTC"; dropping the `zoneUnset` branch fails "is unverifiable, with the reason, for a house with no zone".
>   - Card, `rp-registers-goals.tsx`. Each of four fails 1 of 13 (the new case): link always drawn; link never drawn; flag read off any entry; flag read without the entry's own `zoneUnset`. With `f25f384c9`'s card the new case fails, 1 of 13.
> - **Typecheck.** Gateway `tsc --noEmit -p tsconfig.spec.json`: 2 errors, both `@simplewebauthn/server`. Web `tsc --noEmit`: 1 error, `passkeys.ts` `@simplewebauthn/browser`. That package is missing from the linked node_modules.
> - **ESLint.**
>   - Gateway `goals.service.ts`: 3 warnings, all prettier. Main's copy, `ae079c377`'s and `131da0281`'s each have 4; the fourth was the catch's one-line return object, which `9449a4a7c` rewrote. `pos-revenue.spec.ts`: 0.
>   - Web, the two changed files: 0 errors and 2 warnings, both `react-refresh/only-export-components` (`paceCaption`, `goals`), as before.
>
> **Guards and claims** (at `17546fc19`)
> - `lanecheck.sh wt-fix-tz`: `check_migration_order`, `check_migration_versions_unique`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_citation_pairing` and `check_adr_numbers_unique` all rc=0. `files=15`. `ownership rc=0 []`.
> - `PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh`, run alone: `== Decision claims: 921 checked, 921 holding` / `PASS — every executable claim still describes reality.`
> - No SQL changed, so no `pgtest.sh` run.
>
> **PR body edits for the coordinator to apply** (live body at `ae079c377`, 250 lines; I did not edit it). This list replaces the two lists below. Where they differ, this one holds: line 61 is a 500, not the 503 the `131da0281` note said; lines 188-190 say the fold covers the goal reads only; and that note's Forks deferred 5 and 6 are withdrawn.
> - **Line 1** describes `ae079c377`. Leave it, and put the new push header above it. At `17546fc19` the PR is 15 files against origin/main `ca3582988`.
> - **Line 9**, replace with:
>   > **Founder ruling, 2026-10-06 16:55:23Z (AskUserQuestion; the transcript stamp), on the pace fix at `d7adf1862`:** verbatim pick *"Say why, as built (Recommended)"*. A days-of-stock goal with a deadline, in a house with no zone, keeps saying its pace is not judged until the zone is set. Rejected with it: judging the pace only when every possible zone agrees, and a UTC pace marked approximate. ADR 0296 §5 quotes it at `ae079c377`. [2026-10-07: that question promised the Settings link beside the reason, which the goal card at `ae079c377` did not draw, and said Tuzlu has no zone; the house with no zone is Meyhouse Palo Alto (inferred, not re-read). Re-asked with both corrections at 12:02:43Z, the founder picked *"Add the link (Recommended)"*. From `a9320bc4a` the /reports goal card draws the till's link (`/settings?tab=time-zone`, "Set the time zone in Settings") beside that sentence.]
> - **After line 9**, add:
>   > **Founder ruling, 2026-10-07 19:48:13Z (AskUserQuestion), on the could-not-be-scored card:** *"#616: in a house with no time zone, a goal with a date window on /reports says 'This goal could not be scored (…set it in Settings, under Time zone)' as plain text. You asked for a link on the pace reason; this sentence wasn't in that question. Add the same link here?"* Picked *"Add the link (Recommended)"*: *"The same /settings time-zone link as the pace reason. One card branch and one test, in files already in #616, which is being re-audited anyway."* Rejected *"Keep it as text"*: *"The sentence already says where to go; no code change."* Built at `9449a4a7c`: the gateway's goal list marks an unreadable entry `zoneUnset: true` only when its reason is `HOUSE_ZONE_UNSET`, and the card draws the link after its sentence only for such an entry. ADR 0296 §5 quotes it at `17546fc19`.
> - **Line 61**, replace with:
>   > - **`analytics.service.ts` `getPosConsumptionBreakdown`** takes `[startIso, endIso)` on the same house days as the till. [2026-10-07: since the #609 merge (`9068a5a32`) it reads through `readWholeWindow` (ADR 0292). A window it cannot read whole throws `WholeReadError`, and `GET /analytics/pos-revenue/:restaurantId` answers 500 with that error's sentence: the route's catch rethrows every error as `HttpException(error.message || "Failed to load POS revenue", INTERNAL_SERVER_ERROR)` (`analytics.controller.ts:1105-1112`; ADR 0292:126, "The four routes answer 500, not 503"). This read has no 24 h lookback and no `fileByHouseDay` fold.]
> - **Line 69**, replace with:
>   > The card's caption moves into `paceCaption(g)`. It prints `paceUnread`, or "The pace against this deadline was not computed." when a deadline has no pace and no reason. It says "No deadline" only of a goal with none. From `a9320bc4a`, when the caption is the `paceUnread` reason, the card draws the till's time-zone link beside it (`/settings?tab=time-zone`, "Set the time zone in Settings"); the other two captions get none (`paceAwaitsZone`). From `9449a4a7c`, the card's "This goal could not be scored (…)" sentence draws the same link when the gateway marks the entry `zoneUnset: true`; another reason, or a payload without the flag, gets none.
> - **Line 75** (Performance), append: "[2026-10-07: since the #609 merge, the goals' `bottles_sold` and check reads and the consumption read page through `readWholeWindow` at 1,000 rows a page (`WHOLE_READ_PAGE`) with an exact count, so a window of N rows takes at least ⌈N/1000⌉ requests. `purchase_spend` is still one unranged read.]"
> - **Lines 77-80**, replace with:
>   > **The 15 files.**
>   > - Records: `.planning/decisions/0296-a-sale-belongs-to-the-houses-day.md` (new) and `.planning/decisions/README.md` (one row).
>   > - Gateway, `apps/api-gateway/src/`: `analytics/analytics.controller.ts`, `analytics/analytics.service.ts`, `analytics/goal-source-rule.spec.ts`, `analytics/goals.service.ts`, `analytics/pos-revenue.spec.ts`, `common/house-day.ts` (new), `common/read-whole-window.spec.ts` (main's, from #609: the merge hands its till case the zone argument and its GoalsService cases a house zone; their assertions are unchanged), `reports/exports/report-export-cuttings.ts` and `simpos/scenario-verify.service.ts`.
>   > - Web, `apps/web/src/pages/`: `recommendations/next/rec-masthead.ts`, `reports/next/rp-registers-goals.tsx`, `reports/next/rp-registers-trade.test.tsx` and `reports/next/rp-registers-trade.tsx`.
>   >
>   > [2026-10-07: `simpos/scenario-verify.service.spec.ts` left the PR at `82549ea83`. It is origin/main's bytes, and its three ADR 0296 cases sit in `analytics/pos-revenue.spec.ts` with the same assertions.]
> - **Line 88**, append: "[2026-10-07: `scenario-verify`'s ADR 0296 cases moved into `pos-revenue.spec.ts` at `82549ea83`.]"
> - **Line 89**, append: "[2026-10-07: at `17546fc19`, web vitest over `src/pages/reports`, `src/pages/recommendations` and `src/pages/settings` is 35 files, 663/663 pass. `rp-registers-trade.test.tsx` holds 13 cases: 5 till, 8 goal.]"
> - **Line 93**, append: "[2026-10-07: `scenario-verify.service.spec` left the PR at `82549ea83`. At `17546fc19` `goals.service` has 3, one fewer than main's copy.]"
> - **Line 106**, replace with: "Deleting the fold's `day > untilDate` drop left 60/60 passing at this last call. [2026-10-07: from `f25f384c9` it fails 1 of 44 in `pos-revenue.spec.ts`, and so does filing `bottles_sold` or `purchase_spend` by its UTC date prefix. Before `f25f384c9` each of the three left 944/944 passing in `src/analytics` plus `read-whole-window.spec.ts`.]"
> - **Line 110**, append: "[2026-10-07: from `9449a4a7c` the file holds 13 cases. The 12th, the pace link, fails against `ae079c377`'s card; from `b9aa5dfaf` it also kills `paceAwaitsZone`'s two survivors. The 13th, the could-not-be-scored link, fails 1 of 13 against `f25f384c9`'s card.]"
> - **Line 157**, replace "ADR 0304 on #620, PR-1 of 5, open." with "ADR 0304 on #620, PR-1 of 5, merged at `5e6c0684e` (PR-1 changes no row and derives no zone)."
> - **Line 166**, replace with: "existing windowed goals read "could not be scored" with the sentence; from `9449a4a7c` the /reports goal card draws "Set the time zone in Settings" (`/settings?tab=time-zone`) after it. The per-goal progress route answers 500 with the sentence;"
> - **Line 167**, replace with: "a days-of-stock goal with a deadline shows its number, and says its pace is not judged until the zone is set, with the till's time-zone link beside that sentence on the /reports goal card ("Pace unknown" in the recommendations margin, with no Settings link);"
> - **Forks deferred** (171-184): no change. Do not add the `131da0281` note's 5 (answered 19:48:13Z, built at `9449a4a7c`) or 6 (the PR is 15 files from `82549ea83`). Fork 1's "16th file" arithmetic stands.
> - **Lines 188-190** (#609 cap), replace with: "**#609 cap is merged** (`b270a45b8`), into this head at `9068a5a32` as planned. In `goals.service.ts`, cap's `readWholeWindow` is kept for the `bottles_sold` and check reads, with tz's house bounds (`sinceIso`/`untilIso` from `houseDayBounds`) inside its builders. The `fileByHouseDay` fold covers the goal reads only: `bottles_sold`, the checks and `purchase_spend` (still unranged, as on main). In `analytics.service.ts`, `getPosConsumptionBreakdown` keeps cap's whole read with tz's `[startIso, endIso)` inside its builder, and has no fold."
> - **Line 191** (#615 netsales), append: "[2026-10-07: not re-measured since `82549ea83`. `pos-revenue.spec.ts` now also holds three verifier cases and three fold cases, and `scenario-verify.service.spec.ts` is no longer in this PR.]"
> - **Line 195** (#626 units), append: "[2026-10-07: not re-measured since the #609 merge.]"
> - **Line 206**, replace with: "the Settings link (`/settings?tab=time-zone`; the tab exists, and `SettingsNext` reads `?tab=`) on the till, and on the goal card beside the no-zone pace reason (from `a9320bc4a`) and the could-not-be-scored sentence (from `9449a4a7c`);"
> - **Line 224**, replace with: "**The fold's `day > untilDate` drop is tested from `f25f384c9`.** "drops a check the read lets through when it closed after the window's last house day" fails 1 of 44 without it. At this last call, deleting it left the 60 pos-revenue and scenario-verify tests passing."
> - **Line 234**, replace its second sentence with: "Since the #609 merge (`9068a5a32`), the `bottles_sold` and check reads go through `readWholeWindow` and refuse instead of dropping an error. Only `purchase_spend` still reads `const { data } = await q` (`goals.service.ts:984`)."
> - **Line 237**, replace with: "the full gateway jest (152 suites in eight directories ran at `17546fc19`) and the repo-wide vitest (three directories ran);"
> - **Line 240**, append: "[2026-10-07: nothing after `ae079c377` had run CI when this was written.]"
> - **Line 241**, replace with: "[2026-10-07: superseded. Every run above is at `17546fc19`, which contains origin/main `ca3582988`.]"
> - **Line 242** (Commit hygiene), append: "[2026-10-07: three more `merge_main.sh` merges carry git's default message with no body or trailer: `d6f45604a`, `cf317f9d1` and `3f32c334d`. The hand merge `9068a5a32` has a body.]"
>
> **Not done or not verified**
> - No Browser-pane render of either link. Only jsdom covers them.
> - One broad gateway run with mutant B applied reported 1 failed, 2005 passed. Rerun with `--json` it was 2006/2006 with 0 failed. I did not identify the flaky test. The final runs above are green.
> - #615 netsales and #626 units were not re-measured against this head.
> - The three CLAIMS rows are still owed (Forks deferred 1). No `OPEN-DECISIONS.md` row was filed.
> - Who can open the /reports goals desk was not checked. The Settings PUT is owner or manager only, as noted at 12:30Z.
> - Out of lane, not changed: main's `analytics.service.ts:217` comment says a `WholeReadError` is "a 503". The routes answer 500 (ADR 0292:126).
> - The re-audit is owed: one more ADR 0090 audit at this head, after it is pushed and CI is green.

---

> **[2026-10-07, fixer, local head `131da0281`]** This answers the verifier at `50fbcd87d` (1 should, 2 notes) and merges origin/main `b270a45b8` (#609, ADR 0292). LOCAL ONLY: nothing is pushed. Files against origin/main `b270a45b8`: **16**, none of them SQL. The 16th is main's `common/read-whole-window.spec.ts`, which the merge had to change (see "Open for the founder" below).
>
> **Commits** (on top of `50fbcd87d`)
> - `9068a5a32`: merges origin/main `b270a45b8` (#609) by hand. `merge_main.sh` printed `CONFLICT (manual)` for `analytics.service.ts` and `goals.service.ts`. Each was resolved by later-truth: #609's `readWholeWindow` is kept, and this lane's house-day logic is re-applied on top of it. The merge commit's body names each resolution.
>   - `analytics.service.ts` `getPosConsumptionBreakdown`: #609's whole read, with this lane's `.gte(startIso).lt(endIso)` from `houseDayBounds` inside its builder. Main's UTC `${fromDate}T00:00:00Z`..`T23:59:59.999Z` is gone.
>   - `goals.service.ts` `bottles_sold` and the check metrics: #609's whole reads are kept, including its select that asks for `items` only when a metric needs them. Their rows then go through this lane's `fileByHouseDay`, so `rowCount` and the series count only rows whose house day is in the window.
>   - `goals.service.ts` catch: both rules hold. `HOUSE_ZONE_UNSET` is thrown before the `try`, and #609's `if (err instanceof WholeReadError) throw err` stays in the catch. `purchase_spend` is still an unranged read, as on main.
>   - `common/read-whole-window.spec.ts` (main's file, not conflicted) had two problems after the merge. Its till case called `getPosConsumptionBreakdown` with three arguments: TS2554, measured with gateway `tsc`. Its six GoalsService cases gave the house no zone: 6 red, measured. Those cases now hand the zone `"UTC"` and seed `restaurants` r1 with `timezone: "UTC"`. Their assertions are unchanged.
> - `b9aa5dfaf` `test(reports)`: `rp-registers-trade.test.tsx`'s zoneLink case gains two rows.
>   - `zoneLink({ ...NO_DEADLINE, paceUnread: NO_ZONE_PACE })` must be null. The mutant that drops `Boolean(g.deadline)` fails it at `:195` (1 failed | 11 passed).
>   - `zoneLink({ ...STOCK, onTrack: false, daysLeft: 3 })` must be null. The mutant that drops `g.onTrack === null` fails it at `:198` (1 failed | 11 passed).
>   - Each mutant was applied to `rp-registers-goals.tsx`, run, and restored from a `cp -p` copy (`cmp` clean).
> - `f26f3d66a` `docs(adr-0296)`, three changes:
>   - §5 gains an **OPEN fork**: the could-not-be-scored card has no Settings link. Status points to it.
>   - The 2026-10-07 ruling's time is bracket-corrected: answered 12:02:43Z per the transcript, where 12:04:50Z was the coordinator's later `date -u`.
>   - Merge records: §4 notes the `readWholeWindow` reads, Links gain 0292, the Consequences citation `analytics.service.ts:291-301` is bracketed as `:291-318`, and a review-trail row is added.
> - `b5c6227ed` `docs(adr-0296)`: the Owed bullet on the file budget now says the merge takes the PR to 16 files, and that the allowance is open.
> - `f252d1740` `style(analytics)`: wraps the one merged `cappedDb` call that prettier flagged. The spec now lints with 0 problems, the same as main's copy.
> - `131da0281` `docs(adr-0296)`: narrows `f26f3d66a`'s §4 bracket. Only the goal reads are widened by the 24 h lookback and folded. The consumption breakdown reads `[startIso, endIso)` and has no fold.
>
> **Tests** (all at `f252d1740`; `131da0281` changes only the ADR, per `git diff --name-only f252d1740 131da0281`)
> - **Gateway jest**, over `src/analytics`, `src/common`, `src/simpos`, `src/reports/exports`, `src/notifications/producers`, `src/settings`, `src/calendar` and `src/dashboard`:
>   `Test Suites: 152 passed, 152 total` / `Tests:       2578 passed, 2578 total`
> - **Gateway, the named specs** (`pos-revenue`, `goal-*`, `days-of-inventory-goal`, `read-whole-window`):
>   `Test Suites: 7 passed, 7 total` / `Tests:       170 passed, 170 total`
> - **Web vitest**, over `src/pages/reports`, `src/pages/recommendations` and `src/pages/settings`:
>   `Test Files  35 passed (35)` / `Tests  662 passed (662)`. `rp-registers-trade.test.tsx` holds 12 cases: 5 till and 7 goal-pace.
> - **Typecheck.** Gateway `tsc --noEmit -p tsconfig.spec.json` and web `tsc --noEmit` show only the known `@simplewebauthn/server` and `@simplewebauthn/browser` lines. That package is missing from the linked node_modules.
> - **ESLint.**
>   - Web `rp-registers-trade.test.tsx`, run with `--resolve-plugins-relative-to p4-scratch/web-lint`: rc 0.
>   - Gateway, same warning counts as each file's origin/main copy: `goals.service` 4, `analytics.service` 1, `read-whole-window.spec` 0. All are prettier warnings.
>
> **Guards and claims** (re-run at `131da0281`)
> - `PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh` (Python 3.11.0): `== Decision claims: 921 checked, 921 holding` / `PASS — every executable claim still describes reality.`
> - `lanecheck.sh wt-fix-tz`: `check_migration_order`, `check_migration_versions_unique`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_citation_pairing` and `check_adr_numbers_unique` all rc=0. `files=16`. `ownership rc=0 []`. Script exit 0.
> - No SQL changed, so no `pgtest.sh` run.
>
> **Open for the founder** (recorded in ADR 0296 as open; not built and not defaulted)
> 1. **The could-not-be-scored card gets no Settings link** (ADR 0296 §5).
>    - In a house with no zone, a windowed goal's /reports card prints "This goal could not be scored (`HOUSE_ZONE_UNSET`). Nothing below it is claimed." as plain text (`rp-registers-goals.tsx:688-691`).
>    - "Add the link" (12:02:43Z) was asked about the pace reason only.
>    - Options: (a) draw the same `/settings?tab=time-zone` link when the reason is the zone sentence: one card branch plus one test, in files already in the PR; (b) keep it as text, since the sentence already says "set it in Settings, under Time zone".
>    - Recommendation: (a). It matches the pace card and the till, and costs no new file. It is not built.
> 2. **The PR is now 16 files.** The merge forced the 16th: without its edit, main's spec is a TS2554 and 6 red cases. Options: (a) a one-off 16-file allowance, as for #603; (b) nothing else keeps main's spec green without a UTC fallback, which DASH-G2 rules out. If (a) is granted, it changes the arithmetic of Forks deferred 1: claims rows inside this PR would make 17.
>
> **PR body edits for the coordinator to apply** (the live body is at `ae079c377`; I did not edit it). The edits in the 12:30Z note below still apply (lines 9, 157, 167, 206). Add these:
> - **Line 61**, append: "Since the #609 merge (`9068a5a32`) it reads through `readWholeWindow` (ADR 0292): whole, or a `WholeReadError` 503, never a 1,000-row slice."
> - **Line 69**, replace with:
>   > The card's caption moves into `paceCaption(g)`. It prints `paceUnread`, or "The pace against this deadline was not computed." when a deadline has no pace and no reason. It says "No deadline" only of a goal with none. From `a9320bc4a`, when the caption is the `paceUnread` reason, the card draws the till's time-zone link beside it (`/settings?tab=time-zone`, "Set the time zone in Settings"). The other two captions get no link (`paceAwaitsZone`, `rp-registers-goals.tsx:124-126`).
> - **Line 75** (Performance), append: "[2026-10-07: since the #609 merge, the check and consumption reads page through `readWholeWindow`, at 1,000 rows a page with an exact count, so a window of N rows takes ⌈N/1000⌉ requests (at least one).]"
> - **Line 77**: "**The 15 files.**" becomes "**The 16 files.**"
> - **Line 79**, add after `analytics/pos-revenue.spec.ts`: "`common/read-whole-window.spec.ts` (main's, from #609; the merge hands its till case the zone argument and its GoalsService cases a house zone, and leaves their assertions unchanged)". Add one sentence after the list: "The 16th file came with the #609 merge; the allowance is open (Forks deferred 6)."
> - **Line 89**, append: "[2026-10-07: from `a9320bc4a` the file holds 12 cases (5 till, 7 goal-pace). At `f252d1740`, web vitest over `src/pages/reports`, `src/pages/recommendations` and `src/pages/settings` is 35 files, 662/662 pass.]"
> - **Line 110**, append: "[2026-10-07: the file holds 12 cases from `a9320bc4a`. The 12th, the goal card's zone link, fails 1 of 12 against `ae079c377`'s `rp-registers-goals.tsx`. From `b9aa5dfaf` it also holds the two rows that kill `paceAwaitsZone`'s survivors (dropping `Boolean(g.deadline)` fails it at :195, dropping `g.onTrack === null` at :198).]"
> - **Line 166**, append: "That card prints the sentence with no Settings link. Whether it gets one is open (ADR 0296 §5; Forks deferred 5)."
> - **Forks deferred**: add **5.** (the could-not-be-scored link, as in "Open for the founder" 1 above) and **6.** (the 16-file allowance, as in 2 above).
> - **Lines 188-190** (#609 cap), replace with: "**#609 cap is merged** (`b270a45b8`). It was merged into this head at `9068a5a32` as planned. Cap's `readWholeWindow` was kept, tz's house bounds went inside its builders, and the `fileByHouseDay` fold runs over the whole read."
> - **Line 195** (#626 units, stacked on cap): append "[2026-10-07: not re-measured since the #609 merge.]"
> - **Line 234**, replace its second sentence with: "Since the #609 merge (`9068a5a32`), the `bottles_sold` and check reads go through `readWholeWindow` and refuse instead of dropping an error. Only `purchase_spend` still reads `const { data } = await q` (`goals.service.ts:976`)."
> - **Line 237**, replace with: "the full gateway jest (152 suites in eight directories ran at `f252d1740`) and the repo-wide vitest (three directories ran);"
> - **Line 241** ("Not re-tested against the newest main"), replace with: "[2026-10-07: superseded. Every run above is at `f252d1740`, which contains origin/main `b270a45b8`.]"
>
> **Not done or not verified**
> - The open fork above is not asked and not built. It is not in `OPEN-DECISIONS.md`, because that would be a 17th file.
> - The 2026-10-06 "Say why, as built" time (~16:55Z in ADR 0296 §5 and body line 9) is not in the coordinator's list of exact times. I did not change it, and I did not check it against the transcript.
> - No Browser-pane render. Only jsdom covers the links.
> - #615 netsales and #626 units were not re-measured against this head.
> - The re-audit is owed: one more ADR 0090 audit at this head, after it is pushed and CI is green.

---

> **[2026-10-07 12:30Z, fixer, local head 50fbcd87d]** This answers the ADR 0090 BLOCK at `ae079c377` (`fixes/audits/616-ae079c377/report.md`, "Final adjudication"). The founder was re-asked with both corrections and picked *"Add the link (Recommended)"*. LOCAL ONLY: nothing is pushed. Files against origin/main `5e6c0684e`: 15, none of them SQL.
>
> **Commits**
> - `d6f45604a`: merges origin/main `42fe1252b` (#651). Clean, via `merge_main.sh`.
> - `a9320bc4a` `fix(reports)`: changes the /reports goal card in `rp-registers-goals.tsx`.
>   - When the card's caption is the gateway's `paceUnread` reason, the card now draws the till's link beside it. The gateway sets `paceUnread` only for a goal with a deadline and no house zone (`goals.service.ts:510`).
>   - The link has the same target (`/settings?tab=time-zone`), the same classes and the same words ("Set the time zone in Settings") as `rp-registers-trade.tsx:189`.
>   - The "not computed" and "No deadline" captions get no link. The recommendations margin is unchanged.
>   - It adds one jsdom case to `rp-registers-trade.test.tsx`.
> - `8e6d7f25d` `docs(adr-0296)`: in §5, a dated bracket quotes the question, the pick and the rejected option verbatim ("answered 2026-10-07 (recorded 12:04:50Z)") [Corrected 2026-10-07: answered 12:02:43Z per the transcript; 12:04:50Z was the coordinator's later date -u].
>   - It states both corrections: at `ae079c377` the card had no link, and the house with no zone is Meyhouse Palo Alto (inferred, not re-read), not Tuzlu.
>   - It says the link was then built at `a9320bc4a`, and re-locks the bullet on the new pick.
>   - The §5 build sentence, the Status line, the real-tenant Consequences bullet and the Review trail (two rows) get matching brackets.
> - `cf317f9d1`: merges origin/main `5e6c0684e` (#620, ADR 0304). Clean, via `merge_main.sh`.
> - `50fbcd87d` `docs(adr-0296)`: Consequences said "That lane's ADR is owed". That is false since `5e6c0684e`. A bracket now says ADR 0304 records the founder's answers, that its PR-1 changes no row and derives no zone, and that its back-fill dry run is its PR-3.
>
> **Tests**
> - **The new case**, "draws the till's time-zone Settings link beside the no-zone pace reason, and beside no other caption":
>   - With `ae079c377`'s `rp-registers-goals.tsx` swapped back: 1 failed | 11 passed (12). At `a9320bc4a`: 12/12 pass. The worktree was clean after the restore.
>   - I made three mutations of the link predicate: always true; drop the `paceUnread` check; `paceUnread !== null || onTrack !== null`. Each one fails it: 1 failed | 11 passed.
> - **Web vitest** (reports, recommendations, settings) at `50fbcd87d`: 35 files, 662/662 pass.
> - **Gateway jest** (analytics, reports/exports, common, simpos, settings) at `50fbcd87d`: 120 suites, 1942/1942 pass.
> - **ESLint** on the two changed web files: 0 errors and 2 warnings. Both are `react-refresh/only-export-components` (`paceCaption` :98, `goals` :779) and both are already there at `ae079c377`.
> - **Web `tsc --noEmit`**: one error, in `passkeys.ts`, because `@simplewebauthn/browser` is not installed in the linked node_modules. It is an environment gap and not in this PR's files.
>
> **Guards and claims**
> - `lanecheck.sh wt-fix-tz` at `50fbcd87d`: every rc is 0, files=15, ownership `[]`.
> - `check_decision_claims.sh` under Python 3.11: "Decision claims: 918 checked, 918 holding".
> - No SQL changed, so no local Postgres run.
>
> **PR body edits for the coordinator to apply** (I did not edit the live body)
> - **Line 9, corrected sentence:**
>   > **Founder ruling, 2026-10-06 ~16:55Z (AskUserQuestion), on the pace fix at `d7adf1862`:** verbatim pick *"Say why, as built (Recommended)"*. A days-of-stock goal with a deadline, in a house with no zone, keeps saying its pace is not judged until the zone is set. Rejected with it: judging the pace only when every possible zone agrees, and a UTC pace marked approximate. ADR 0296 §5 quotes it at `ae079c377`. [2026-10-07: that question promised the Settings link beside the reason, which the goal card at `ae079c377` did not draw, and said Tuzlu has no zone; the house with no zone is Meyhouse Palo Alto (inferred, not re-read). Re-asked with both corrections, the founder picked *"Add the link (Recommended)"*. From `a9320bc4a` the /reports goal card draws the till's link (`/settings?tab=time-zone`, "Set the time zone in Settings") beside that sentence. ADR 0296 §5 quotes both picks at `8e6d7f25d`.]
> - **Line 157:** replace "ADR 0304 on #620, PR-1 of 5, open." with "ADR 0304 on #620, PR-1 of 5, merged at `5e6c0684e` (PR-1 changes no row and derives no zone)."
> - **Line 167, suggested:**
>   > a days-of-stock goal with a deadline shows its number, and says its pace is not judged until the zone is set, with the till's time-zone link beside that sentence on the /reports goal card ("Pace unknown" in the recommendations margin, with no Settings link);
> - **Line 206, suggested:** "the Settings link on the till and, from `a9320bc4a`, on the goal card (`/settings?tab=time-zone`; …)".
> - **Line 1** ("with no code change") describes `ae079c377` only. Leave it.
>
> **Notes carried forward from the BLOCK**
> - Notes 1 to 4 are still true and stay as disclosed. I left their records unchanged.
>   1. The three dropped CLAIMS rows are still owed in a follow-up PR.
>   2. The per-goal progress route still answers 500 for no zone, and the producers still count those goals as `failed`.
>   3. A failed zone read still echoes the Supabase message.
>   4. The Santiago and São Paulo midnight-DST hour is still untested.
> - Note 5 is now partly false. "#620 making a house with no zone rare" is the founder's framing, and it stays verbatim in the 2026-10-06 bracket. But #620 is no longer open: it merged at `5e6c0684e`, and its PR-1 gives no house a zone. ADR :78 now says so (`50fbcd87d`), and the line 157 edit above covers the PR body.
>
> **Not done or not verified**
> - No Browser-pane render of the goal card or the till. Only jsdom covers the link.
> - Every viewer of the card sees the link, as with the till's. The Settings PUT is owner or manager only (`TimeZoneSection.tsx:28`, gateway `PUT /settings/time-zone`). I did not check who can open the /reports goals desk.
> - The brief `fixes/briefs/tz.md:66` is bracketed in place. Its "with the Settings link" now has a bracket saying it was not so at `ae079c377` and is so from `a9320bc4a`, and its "No code change" is marked superseded. The 2026-10-07 answer is appended verbatim. That file is in p4-scratch, not in the PR.
> - The re-audit is owed: one more ADR 0090 audit at this head, after it is pushed and CI is green.
