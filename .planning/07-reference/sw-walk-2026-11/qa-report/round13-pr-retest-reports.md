# Round 13 - adversarial re-test of #850, #851, #852 (+ #843 for context)

Heads tested (detached scratch worktrees, node_modules symlinked, removed afterwards): #850 `f733c5208`, #851 `d9c170eed`, #852 `da0d86345` (a stack: 850 < 851 < 852), #843 `454c79316` (unchanged since round 12); base `origin/main` `259feea3f`. All four PRs are DRAFT.

## Verdicts

| PR | Verdict | Fails without the fix? |
|---|---|---|
| #850 one twelve-column ruling, nothing written below 768 px | **FIXED** (R-8 closed; caveat: threshold is the sheet's width, not the viewport's) | Yes: 11 of its specs red on main (Sheet.test 5, rp-arrange.test 5, ReportsNext.test 1). My real-RGL probe also red on main (12 failures) |
| #851 never draw or save the house sheet as the reader's own | **FIXED** (R-10 closed; one edge case with misleading wording, below) | Yes: 7 specs red on the 850 head with 851's tests (useReportsNextData.test 5, ReportsNext.test 2). My real-hook probe: cold-load and error/signed-out cases red on main |
| #852 say "Ruled off." only once the sheet is saved | **PARTIAL** (R-9 closed; "an edit made during the save cannot be lost" is false for one path) | Yes: 5 specs red on the 851 head with 852's tests. My real-hook probe: slow, failed and hung saves all red on main |

Counts: FIXED 2, PARTIAL 1, NOT FIXED 0, REGRESSION 0.

**R-7 (swap sizing, `ReportsNext.tsx:257` on main, now `:317`): NOT touched by any of the three.** `onSwap` is still `{ id: to, slot: c.slot, graph: defaultGraph(to) }`. Probe (real page, real RGL, 375 / 768 / 1280): `ledger` at `5,0,7,9` swapped to `restock` saves `restock:5,0,7,9`, not the analysis's default square. The diff of the stack has no hit for `onSwap`, `DEFAULT_SLOTS[` or `defaultGraph(to)`.
**Combo chart (R-1 second half): NOT touched.** No `combo`/`Composed` in the stack's diff, `GRAPH_TYPES` unchanged. #843 (full screen) is unchanged since round 12 and still does not close either; it merges cleanly onto the #852 head (`git merge-tree`, exit 0).

## What I ran

Suite on #852 head (whole stack): `npx vitest run src/pages/reports/next` -> 7 files, 177 passed. `tsc --noEmit` shows no error under `pages/reports/next` (other errors are my worktree missing the `packages/ui` symlink, not the PR). eslint not run.
Without-fix runs: logs `withoutfix-w2.log` (main + 850 tests), `-w3.log` (850 src + 851 tests), `-w4.log` (851 src + 852 tests).

Probes (folder `round13-probes-reports/`, copied into the worktree beside the sources to run):
- `sheet-real-rgl.probe.test.tsx` - the REAL `react-grid-layout` 2.2.2 inside `Sheet`, container width driven through a controllable `ResizeObserver` (the lib reads `contentRect.width`) and `offsetParent` stubbed so a real mouse drag fires `onDragStop`. The PRs' own `Sheet.test` replaces the grid with a stand-in, so this is the first end-to-end evidence. Output on main: `probe1-on-main.log`.
- `page-real-prefs.probe.test.tsx` - real `ReportsNext` + real `useReportsNextData` + REAL `useUserPreferences` (optimistic write, rollback, invalidate); only HTTP, auth and the two desks are doubled. Runs: `probe2-run2.log` (PR), `probe2-on-main.log`.
- `page-edit-during-save.probe.test.tsx` - `probe3-run1.log`.
- `page-width-keyboard.probe.test.tsx` - page + real RGL + keyboard at 375/767/768/769/1280, resize with unsaved edits, swap per width, a11y names. `probe4-run1.log`.

## #850 - FIXED

Real RGL, 10 default cuttings, drag one cutting:
- main: a drag at 375 writes a sheet whose right edge is column 2; 767 -> 4; 768 -> 4; 900 -> 6; 1280 -> 12. That is the "switched places" bug reproduced end to end (`probe1-on-main.log`).
- PR: 375 and 767 write nothing; 768, 900, 1280 write and every slot stays inside 12 columns. Flow flag is `true` at 375/479/480/767 and `false` at 768/769/900/996/1200; at 767 every item is container width and static, at 768 the grid is draggable. Boundary is exactly 767|768 as claimed.
- Resize sequence 1280 -> 700 -> 375 -> 767 -> 768 -> 769 -> 480 -> 1280 with the draft held: zero `onMove` calls and the slot objects byte-identical afterwards. A width change during a half-finished drag (900 -> 700) writes nothing.
- Page level, keyboard (real RGL, real hook): 375 and 767 -> Space+Arrow says "Moving cuttings needs a wider screen." and the save keeps `till:0,0,5,9 / ledger:5,0,7,9`; 768, 769, 1280 move the cutting and announce "placed at column 2 of 12". Take-off made at 1280, narrowed to 375, widened back, saved: the take-off is kept and the slots are 12-column. Take-off made and saved while at 375: slots untouched.
- 12 columns with 0 / 1 / 40 cuttings at 375 and 1280: item count equals input, no throw. Zero cuttings shows the page's "Every cutting has been taken off" note (Sheet not mounted).
- Role: the sheet is a per-user preference; owner, manager, staff and waiter all got the identical house sheet (10 regions), the identical own sheet after a take-off (9), and a patch whose only key is `reportsSheet`.

Caveats (none is a regression):
1. The 768 line is the SHEET container width, not the viewport. From `DashboardLayout.tsx:91` (260 px left pad at md+, 72 px collapsed) and `.rp-page__inner` (16 px each side), the sheet is about viewport - 292, so with the sidebar open the sheet flows (no arranging) below a ~1060 px viewport, ~872 px collapsed. A tablet in landscape with the sidebar open is on the phone sheet. The note says "needs a wider screen", which is true, but "below 768 px" in the PR title reads as a viewport rule. Arithmetic from source, NOT measured in a browser.
2. Fractional widths: RGL flows when `width <= 767`, the keyboard uses `clientWidth` (integer). In 767.0-767.5 px the grid is draggable while the keyboard refuses. Harmless (refuses, never writes); reasoning only, not run.
3. No real browser check (the PR says the same). `display:none` on the grips removing them from the tab order is CSS-only; jsdom still lists the two grip buttons at 375. Unverified in a browser.
4. Screen reader: the ruling is a `::before` pseudo-element (no role, no label); the "column 2 of 12" announcement from the keyboard model is its only spoken form. The note text switching to "Moving cuttings needs a wider screen." when the window crosses 768 mid-arrange is not in a live region, so it is silent until the reader meets it.

## #851 - FIXED

Real `useUserPreferences` with a gated GET (cold load):
- All four roles: Arrange is disabled, the "Reading how you arranged this sheet…" outlines show, none of the house cuttings are drawn, clicking Arrange does nothing; when the read answers, only the reader's own cutting is drawn (not the house ten). On main the same probe fails at `toBeDisabled` (arranging the house sheet over the reader's own was possible).
- No saved sheet (`{}` answer): house sheet appears only after the answer, not before.
- GET 500 (after the hook's one retry): the "could not be read" note shows, house sheet shown, Arrange disabled, zero PATCH. Signed out: "No one is signed in…", Arrange disabled. On main: neither sentence exists.

Edge (new, not fixed by the PR): **a background refetch that fails after a good load flips the page to "unread".** Probe `BG-REFETCH-FAIL`: sheet loaded, then the next GET fails (focus refetch / network blip / `invalidateQueries`). React Query keeps the old data but sets `error`, so `sheetKnown` becomes false and the page prints "Your own arrangement of this sheet could not be read (...), so the house sheet is shown. Arranging is off until it can be read." while it is still drawing the reader's OWN sheet (regions = the own cutting). Arrange is locked until a later read succeeds. Wording is wrong and the lock is avoidable (the retained data is usable). Cause: `useReportsNextData.ts:274` uses `!prefsError` without looking at whether data exists. On main the same probe shows no note and Arrange enabled (so this is new behaviour, a mild one; it fails safe).

## #852 - PARTIAL

Held (real hook, real mutation, optimistic cache):
- Slow save: button reads "Ruling off…", both buttons disabled, no "Ruled off."; a second click and an Enter on the disabled button produce no second PATCH (`srv.patches` length 1); when the write lands, the stamp shows and Arrange is enabled again.
- Failed save (503): `role="alert"` "The sheet was not saved. Try again.", no stamp, still arranging, the take-off stays off in the draft, the optimistic cache rolls back (server and cache keep the old sheet), Rule it off enabled; a retry sends the second PATCH, shows "Ruled off.", and the alert goes away.
- Hung network: stays "Ruling off…" until the client's 30 s timeout (`services/api/client.ts:67`), then the failure path. No page-level timeout and no cancel; the reader is locked out of Put it all back for up to 30 s. (Code-read for the 30 s; I held the promise 600 ms, not 30 s.)
- Unmount during an in-flight save: one PATCH, no error, no stamp timer left (the PR's own timer spec also covers re-rule-off and clear on unmount, red on main).
- Roles: owner, manager, staff, waiter all save the same single key.

**Hole: the paper is not held still against every writer.** `editing = arranging && !saving` is passed to the sheet, cuttings and keyboard, but `placeProposed` (ReportsNext.tsx, the Goals desk's "Put it on the sheet") is not guarded by `saving`. Probe 3: own sheet [goals, till], Arrange, Rule it off with the PATCH gated, press "Put it on the sheet" (button present, not disabled) during the save, release the PATCH. Result: server saved `["till","goals"]` (the draft as it was), the page then shows "Ruled off." with no "Spend pacing" cutting, and the proposal's placement is gone with no message - the exact loss the PR says it prevents ("an edit made during the save cannot be lost when the draft is dropped"). Narrow window (the save time) and one control, but the guarantee as written is not true. Fix shape: `placeProposed` returns early while `saving`, or `ruleOff` drops only the draft it sent (compare identity) instead of `setDraft(null)`. The same stale-draft pattern would apply to anything else that calls `setDraft` mid-save; I found only this one.

Not fixed and not claimed - **two writers, last writer wins silently.** The sheet is per user, so "two managers" never share one; the real case is one manager in two tabs/devices. Probe: tab B takes off `reading` and saves ("Ruled off."); tab A (cache opened before B saved, `staleTime` 30 s so it still shows `reading`) takes off `till` and saves ("Ruled off."). Server ends with `["reading"]`: B's take-off is silently reverted and A's view never warned. The gateway does read-then-update with a top-level deep merge and no version or `If-Match` (`user-preferences.service.ts:99-105`, also not atomic), so two different preference keys written at once can race too. "Ruled off." now means "the write landed", not "nothing was overwritten".

Smaller observations:
- While saving, `editing` is false, so the arrange note and the arrange look of every cutting drop away for the duration and come back on failure (a flicker; on a slow link a long one).
- A failed-save alert stays after "Put it all back" until the next save or the next Arrange. Defensible (the sheet is still unsaved) but stale-feeling.
- The new strings ("Ruling off…", "The sheet was not saved. Try again.") are English-only; same as the rest of the page (R-15), so nothing new.
- Long Turkish labels: the three PRs change no label rendering, and I did not render long Turkish cutting titles. The only Turkish-adjacent check was `lang="tr"` on the arrange chrome (still English strings, no crash).

## Not done / limits

- No browser run (jsdom + real RGL with a faked `ResizeObserver`/`offsetParent`). CSS-dependent claims (grips hidden, scrolling tables inside cuttings, row floor of 322 px) are not observed.
- Pointer-drag was exercised only by synthetic mouse events through react-draggable; touch events not exercised.
- eslint and the repo guard scripts not re-run.
- The 767-767.5 fractional-width and the container-vs-viewport figures are derived from source.
- #843: only re-checked for head unchanged and for a clean merge with #852; not re-tested.
- Worktrees `/private/tmp/claude-501/qa-wt-r13-{1,2,3,4}` and local refs `refs/qa/r13-*` removed after the run.
