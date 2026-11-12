# Round 9 re-test: PRs #817, #818, #819, #822

Method: detached worktrees `/private/tmp/claude-501/qa-wt-{817,818,819,822}` at each PR head (node_modules symlinked), throwaway tests, then "fix removed" mutation (file restored from the parent commit) to see which tests fail without the fix. Baseline: `origin/main` 259feea3f. Compared against `round4-team-admin-shell.md` (B1, B2, B3, H2). Round 2 (`round2-inventory-recipes.md`) has no entry on defaulted-price ranking; #822 was judged against its own stated defect.

Stack: #817 <- #818 <- #819 (each PR's head contains the one before). #822 is independent on main.
Throwaway tests kept in `round9-tests/`: `gw.qa9.spec.ts` (gateway, 20 cases), `web822.qa9.rank.test.ts` (7 cases). The 12-case MyShifts RTL file was deleted by mistake before it was copied out; its results are recorded below but the file is not retained.

## Verdicts

| PR | Verdict |
|---|---|
| #817 reads fail closed; acknowledge only reports a stored receipt | **PARTIAL** (B1, B3 fixed; B2 fixed for 2 of 3 reads) |
| #818 retry failed file reads; refuse an unrecorded confirmation | **FIXED** |
| #819 staff see published weeks only; managers see drafts marked | **FIXED** (one non-blocking observation) |
| #822 rank price and margin only on prices the house set | **FIXED** (one out-of-scope gap noted) |

Counts: FIXED 3, PARTIAL 1, NOT FIXED 0, REGRESSION 0.

## #817 PARTIAL

Fixed, with file:line (PR head `schedule.service.ts` / `team.service.ts`):
- B1 `getMyWeek` now binds and refuses on all four reads: member, schedule, shifts, receipt (`schedule.service.ts:~244-290`, `refuse()` throws 500 with words, not an empty week). Test: 4 failures each reject; failed read then clearing the fault and calling again on the same service instance answers normally (no sticky state); 50 concurrent failing calls all reject, none hang. The client message is generic, no raw DB text.
- B3 `acknowledge` (`:~590-650`): schedule read error -> 500, member read error -> 500, no roster row -> 409 (was 200 `{acknowledged:false}`), upsert error -> 500 with no receipt row. Double confirm: both calls answer true, exactly one receipt row (upsert on `schedule_id,member_id`). Other restaurant / unknown id -> 404.
- B2 `listCertifications` (`team.service.ts:2145`) and `listTimeOff` (`:2243`) refuse on a failed read, for manager and staff. Staff path: a failed own-roster lookup also refuses (`ownMemberId` already raised).

NOT fixed (the reason for PARTIAL): round 4 B2 named three reads, `TS:2145`, `TS:2243` and **`getSettings` `TS:2463`**. `getSettings` (`team.service.ts:2485` on the PR head) still takes `{ data }` alone. Test: forcing `team_settings:select` to fail, `getSettings(manager)` resolves with `{configured:false, labor_tracking_enabled:true, allow_double_booking:false, ...}`, i.e. feature defaults presented as the house's settings. My test `817 fail closed > B2 getSettings` FAILS on the PR head. The PR text and spec do not claim getSettings, but B2 is the finding it cites.

Fails without the fix: yes. Reverting `schedule.service.ts` and `team.service.ts` to main: 11 of 14 tests in the PR's `schedule.my-week-honesty.spec.ts` fail (the 3 passing are the controls).

Other checks: `tsc --noEmit` on the gateway shows only the pre-existing `@simplewebauthn/server` missing-module errors in `passkeys.service.ts`, nothing in `team/`. Read-error baseline file lowered by 5 rows (schedule_receipts/receipt, schedules/schedule, shifts/shifts and two in the diff stat); not re-run through `check_read_errors_not_swallowed.py` by me.

## #818 FIXED

- `acknowledgeSchedule` (`apps/web/src/services/api/team.ts`, +12) throws "The confirmation was not recorded." unless `data.acknowledged === true`. Old-gateway `200 {acknowledged:false}` and `{}` both reject; the component then shows "Your manager was not told you have seen this week" and never "You have told your manager you have seen this week".
- Credentials panel and time-off sheet (`TeamNext.tsx:~612`, `TeamOverlays.tsx:~721`) have a "Try again" button inside the alert. The credentials retry calls `data.refetch`, which re-runs 7 queries (week, members, certs, rules, time-off, trail, notes), not only the failed one. The time-off retry (`onChanged` = `refreshWeek`) invalidates 4 keys. Not a storm (react-query de-duplicates in flight), but a wider refetch than the button implies.
- Tests (MyShifts RTL through the real `team.ts` with a mocked `apiClient`): failed read -> Try again -> success shows the shift and clears the banner; 6 rapid Try-again clicks while pending produce exactly 1 extra request; a gateway that fails every time never prints "Off" across repeated retries; offline at load (react-query paused) shows 7 "not known" and no "Off"; a background refresh that fails after success keeps the last answer and says "could not be refreshed"; ack rejected once (409) shows the error and re-enables the button, second try succeeds.
- Double confirm: with a realistic gap between clicks the button is disabled ("Sending...") and one POST is sent. Two clicks inside the same microtask (synthetic only) sent two POSTs, because `isPending` is set after a tick. Harmless: the server upsert is idempotent (one row). Low.
- Fails without the fix: yes. Reverting `TeamNext.tsx`, `TeamOverlays.tsx`, `team.ts` to #817: 4 tests fail (2 in `team.acknowledge.test.ts`, 2 retry tests in `TeamNext.honesty.test.tsx`). Full `src/pages/team/next` + `src/services/api/team*` on the PR head: 16 files, 208 tests pass.

## #819 FIXED

Server (`schedule.service.ts`, `getMyWeek` and `acknowledge`):
- Staff get a shift only if its own `schedule_id` points at a published schedule (judged per shift, so a window straddling a draft week and a live week hides only the draft part). A shift with a null `schedule_id` is hidden from staff even inside a published week. A week with no schedule row at all: staff get `mine:[]`, `draftsWithheld:true`, `published:false`, `schedule:null`.
- Owner and manager get every shift, each with `draft:true`, `schedule` present, `draftsWithheld:false`; `labor_cost` still stripped for all. An unknown role string ("supervisor") is treated as staff (nothing leaks).
- Zero published shifts: a published empty week returns `published:true`, `draftsWithheld:false`, `mine:[]`, so the page honestly says "Off" (confirmed in the UI test: 7 x "Off", no "Not published yet").
- Publish then unpublish: there is no unpublish route (only `publish`, which republishes). Simulated by flipping the row to draft in the DB: the next `my-week` returns no shifts, `acknowledged:false`, `draftsWithheld:true`; `acknowledge` on it answers 409. In the open page, a refetch after the flip withdraws the shifts, shows "Not published yet" x7 and removes the "I have seen it" banner.
- Status-lookup read failure refuses (`refuse("whether this week is published")`), no fallthrough to showing shifts.
- Manager UI: draft chips ("server · draft"), text "staff do not see them until you publish"; no staff text, no "I have seen it".
- An older gateway (no `published`/`draftsWithheld`) with `schedule:null` keeps the old "No schedule has been published" banner.
- Fails without the fix: yes. Reverting `schedule.service.ts` to #818 level: 15 of 38 gateway tests fail (the PR's and mine). Reverting `MyShiftsNext.tsx` and `team.ts`: 4 web tests fail (2 PR tests, 2 mine).

Observations, not defects of this PR:
1. Once a week is published, shifts the manager adds afterwards reach staff immediately with `draft:false` (the schedule row is the unit, not the shift). That is the pre-existing meaning of "published"; flag it only if the founder expects per-shift drafts on a live week.
2. The calendar feed (`calendar-links.service.ts:733-814`) already lists unpublished shifts to the person with an event title suffixed "(draft)". It labels rather than withholds, which differs from the new `my-week` rule. Not in the PR's scope; worth a decision.

## #822 FIXED

- `useInventoryPage.ts`: the `3x cost` helper is gone (both the local copy and `getDefaultMenuPrice` in `wineData.ts`; no remaining importer in the tree). Price rank uses `houseMenuPrice` (`menuPriceBottle` only, finite and > 0, else null); margin uses `marginPercent` (null when price or cost is unknown or <= 0); unknowns sort last in both directions with a stable order among themselves.
- All prices defaulted: no field ranks anything, insertion order kept in both directions, no throw. One set: that one first both ways. Zero, negative, NaN, null and the string "45" are all unknown and last. Price below cost still ranks as a real negative margin. Price set but cost unknown: margin sort puts it last, price sort still ranks it. The library's `menuPrice` is never used.
- Currency mix: the inventory item has no currency field anywhere in this path, so 100 (EUR) and 100 (TRY) rank equal. Pre-existing and not introduced here; nothing to fix in this PR, but a mixed-currency house would rank wrongly.
- Out of scope but nearby: `InventoryCommandPage.tsx:857` values stock with `item.menuPrice ?? 0` (the library figure) and `RowExpansion.tsx:251` shows `item.menuPrice`, a different field from the `menuPriceBottle` now used for ranking. A column showing one figure while the sort uses another is possible there. No default or invention involved.
- Fails without the fix: yes. With `useInventoryPage.ts` reverted to main: 4 of the PR's 4 tests and 6 of my 7 fail (the currency case passes by construction). With the fix: all 11 pass.

## Not done

- No browser run; all UI evidence is RTL/vitest and jest on a stub DB (the stub applies filters for real, but it is not Postgres/RLS).
- Typecheck: web `tsc --noEmit` on the #819 tree (which contains #817/#818) is clean; gateway tsc shows only the pre-existing `@simplewebauthn/server` errors. Web tsc on #822 was killed before finishing (not run to completion); vitest passes there.
- Worktrees removed after the run.
