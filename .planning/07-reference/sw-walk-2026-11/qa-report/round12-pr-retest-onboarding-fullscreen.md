# Round 12 — adversarial re-test of PR #847, #848, #843

Heads tested (detached scratch worktrees, `node_modules` symlinked, removed afterwards): #847 `4b0be17cf`, #848 `b9d9d6d68`, #843 `454c79316`; base `origin/main` `259feea3f`. #847 + #848 were also merged together in a scratch tree (clean merge, 83 tests green). Probes: `round12-probes-ui/` (`getstarted.qa.test.tsx` 26 cases, `house.qa.test.tsx` 9, `nudge.qa.test.tsx` 9, `combined.qa.test.tsx` 1, `fullscreen.qa.test.tsx` 17, `palette.qa.test.tsx` 1). `tsc --noEmit` on #843: 0 errors.

Not done: no real browser. Every page here needs a signed-in session and I will not visit production login or type passwords; jsdom cannot measure layout, so mobile 375 and real chart resize are read from CSS only (see "Not verified").

## Verdicts

| PR | Verdict | Blocker it targets |
|---|---|---|
| #847 resume /get-started at the menu, step past a 409 | **FIXED** (BL-1 web half) | BL-1 closed |
| #848 /house leads to the desk, menu-only nudge | **FIXED**, with 2 PARTIAL edges (manager entry points, `completed_at`) | BL-2 closed |
| #843 show any cutting full screen | **FIXED** for full screen, **NOT FIXED** for combo chart and for swap sizing (R-7) | R-1 full-screen half closed; combo half open |

Counts: FIXED 3 (one with caveats), PARTIAL 0 as a whole-PR verdict (2 edge findings under #848), NOT FIXED 0 (but combo chart and R-7 are untouched by #843), REGRESSION 0.

## Are the BLOCKERs closed?

- **BL-1 (Finish setup restarts at Welcome and dead-ends): CLOSED** by #847. Owner with a house lands on "Your menu" with no Welcome flash; a 409 no longer ends the flow.
- **BL-2 (/house has no way to the dashboard): CLOSED** by #848. Header mark and "Go to the desk" both link to `/`. The route is only usable after #847 for the Finish-setup path to be end-to-end, and the two merge cleanly; `combined.qa.test.tsx` walks Finish setup -> menu step -> Skip -> /house -> desk with no dead end.
- **R-1 full-screen: CLOSED** by #843 (every cutting that has a register, `?flat=<id>`).
- **R-1 combo (bar + line) chart: NOT CLOSED.** #843 adds no chart type (`grep combo|Composed` in `pages/reports` finds only a test word "combobox"). `GRAPH_TYPES` is unchanged.
- **R-7 (swap keeps the old square): NOT CLOSED.** `ReportsNext.tsx:257` still `{ id: to, slot: c.slot, graph: defaultGraph(to) }`. #843 gives the reader a way to see a clipped swapped cutting full screen (tested: opens the new subject with its own drawings, `Draw as` options equal the new spec), but the slot is not resized.

## #847 — GetStarted.tsx

Evidence (head): entry rule `GetStarted.tsx:35` (`entryFor`), decided once at `:136`; 409 branch `:240` -> `stepIntoTheHouse :253` -> `setRerouting(true) :270`; blank shell until decided `:307`.

Fails without the fix: yes. On `origin/main` the PR's own `GetStarted.entry.test.tsx` + `ArrivalFlow.test.tsx` give 10 failures, and my 26 probes give 21 failures there (the 5 that pass are cases that also hold on main). On the PR all pass.

Scenarios executed (all pass on head):
- Owner, house, no menu: menu step; auth `loading=true` first renders no heading (no Welcome flash), then menu.
- Owner, house, menu already read: also menu step (the page cannot tell). "Skip for now" reaches `/house`. Acceptable; noted below.
- Manager/staff with a house: desk. Signed out: `/login?redirect=%2Fget-started`, once, no loop.
- Name arrives late fills, never overwrites typed text. Role flips after entry do not bounce the page (decided once).
- 409 on create, with a real external-store auth (not mutated in place): re-read finds the house -> menu step, no "already has a house" sentence, no navigation; finds a manager role -> desk; names no house -> `/choose-house`; re-read fails, or `localStorage.getItem` throws -> alert "did not load here just now" plus a "Choose your house" link, button usable again, one alert after a second press; re-read leaves user null -> sign-in redirect, no loop; non-409 keeps the old words with no re-read; double press makes one `createFirstHouse` call; unmount mid re-read does not throw.
- Back button: leaves the flow (no in-page history), unchanged from I-1. Refresh on the restaurant step with no house restarts at Welcome (nothing persisted, unchanged and expected). Refresh on the menu step after the house exists resumes at the menu (this was the BLOCKER).
- Menu step errors 413/429/422/500 are said in `role=alert` and never leak the server string; a good read opens the first proof with no 1.2 s timer.
- Mobile 375: the component has no width logic; layout is Tailwind only (not measurable here).

Residual findings (none blocks the verdict):
1. **PARTIAL, manager entry points.** #848 sends a manager's nudge to `/menu`, but `LearnPanel.tsx:74` ("Upload Now") and `HouseMenu.tsx:85,100` still `navigate('/get-started')`. A manager there is now silently bounced to the desk by the #847 rule (before: Welcome then 409). No loop, but the button appears to do nothing. IMPROVE.
2. `/get-started` stays a public route (I-12, declared OPEN by the PR).
3. Mid-step sign-out (user -> null after entry) leaves the page where it is; pre-existing, noted only.
4. A session that has a house in the database but a token without it takes the 409 path to `/choose-house`; that screen exists and lists `/auth/houses`, so no loop was found, but I could not exercise the real gateway.

## #848 — HouseContents.tsx, SetupNudgeBanner.tsx

Evidence (head): `HouseContents.tsx:35` header `Link to="/" aria-label="Mudavym, the desk"`, `:119` "Go to the desk"; `SetupNudgeBanner.tsx:30` `menuMissing`, `:60` manager -> `/menu`. `houseLater.ts` and its test deleted; no remaining reference.

Fails without the fix: yes. On `origin/main`, the PR's `HouseContents.test.tsx` and `SetupNudgeBanner.test.tsx` fail 6/6 and my probes fail 13 of 18 (the 2 that pass are the unchanged owner nudge and the hidden-route list).

Scenarios executed (all pass on head), with the real `BrandMark` and router:
- Owner, house, no proof: "No menu read yet." and both links reach the desk. Owner with a proof: pencilled link, Receipts link work.
- Keyboard: Tab reaches the header mark first, Enter follows it. The mark link has one accessible name (the SVG is aria-hidden).
- Supplier: whitespace refused, double submit makes one request, Turkish name sent trimmed as typed, failure shows the alert and the button recovers, desk link still present. `sessionStorage` blocked: page still renders and leads out.
- Nudge: hidden while progress is null/undefined (no flash); hidden once `menu_uploaded` even with `activated=false` (the old forever-nudge); owner -> `/get-started`; manager -> `/menu`; staff, null role, no user never; hidden on the five listed paths; hidden when not due, session-dismissed, or no guidance provider; copy has no "wine list" or "threshold"; Later and Don't remind me wired.
- Merge with #847: clean, 83 tests green.

Findings:
1. **PARTIAL (low), `completed_at` no longer set from /house.** The PR drops the client `PATCH /onboarding/progress {vendor_added:true}`. That PATCH path (`menus.service.ts:2236-2246`) computes `completed_at` when menu, vendor and team are all true; `createProvider` (`providers.service.ts:296-309`) only sets `vendor_added`. `Sidebar.tsx:499` uses `completed_at` to hide "Get started". Effect only when the supplier is the last of the three tasks and the team invite and menu were done first. Adding a vendor from the Vendors page already has this gap, so it is pre-existing elsewhere, but #848 widens it to this screen. No test covers it.
2. IMPROVE: the nudge also shows on `/menu`, the page a manager is sent to (`/menu` is not in `HIDDEN_PATHS`), saying "Read your menu next" on the menu page.
3. IMPROVE: with the first proof gone (new tab, `sessionStorage` is per tab) `/house` says "No menu read yet." even though a menu was imported, and offers no link to read one. This is B-3, out of scope for #848; the desk link at least stops it being a dead end.

## #843 — CuttingFlat.tsx, Cutting.tsx, rp-plot.tsx, reports-flat.css

Evidence (head): scroll lock `CuttingFlat.tsx:96`, Escape `:98`, focus guard `:108`, Tab trap `:117`; open/close `Cutting.tsx:277/:282`, focus return `:296`.

Fails without the fix: yes. The PR's `CuttingFlat.test.tsx` on `origin/main`: 12 of 13 fail (the one pass is the "bogus param opens nothing" negative). On head all 93 tests of `CuttingFlat` + `ReportsNext` pass.

Scenarios executed (all pass on head, 17 probes):
- Data: empty series, one point (every graph type offered), 10k points (every graph type; no NaN/Infinity/undefined), 60 long Turkish categories in line, area and bars. Open of the 10k till took ~3.9 s in jsdom (recharts SVG for 10k points); not compared to the in-sheet draw, and real-browser cost not measured.
- Esc closes, returns focus to the opener, restores the pre-existing `body.style.overflow` (tested with `scroll`). Back-button and browser Back do the same and leave no extra history entry. Double Esc does not navigate past the sheet.
- Focus trap: Tab from last wraps to first, Shift+Tab from first to last, stray focus on a background control is pulled back in.
- Scroll lock released on close, on route change with it open, and on unmounting the page.
- Resize while open (375 then 1280 `resize` events): dialog and lock persist, no throw.
- Cold `?flat=till` closes by removing the param in place; Back then leaves the page (does not reopen). A reload that keeps history state closes with history -1 (to the previous entry).
- Two charts opened in a row: exactly one dialog each time, focus returns to the right opener, and the history stack ends where it started.
- Swapped cutting then full screen: opens the new subject (title, `Draw as` options from the new spec, URL `?flat=restock`). A stale `?flat=till` after a swap opens nothing.
- `Draw as` in the dialog never writes the sheet (`onGraph` not called), per F3.

Findings:
1. **NIT (low), palette under the dialog.** ReportsNext's window-level Cmd/Ctrl-K opens `AskTheBook` while the flat view is open. It renders at the house panel's z-index, under the flat view (z-index 1e9), so it is invisible, and one Esc closes both (`palette.qa.test.tsx`: 2 dialogs, focus stays in flat, one Esc -> both `onClose` called). Rare, no data risk.
2. The "writing" cutting has no register and therefore no full-screen opener (by design, test (a)); "any cutting" is true for every drawn cutting.
3. Combo chart and R-7 not addressed (see above). R-19 (screen-reader summary of the SVG) and R-20's `visualViewport` handling are not in the PR: the dialog is `position: fixed; inset: 0` with a `max(180px, 45vh)` plot floor, which is sound CSS, but the mobile address-bar case is unverified.

## Not verified

- Real-browser rendering of any of the three (resize of recharts inside the dialog, mobile 375 layout, safe-area padding, 10k-point paint time).
- Gateway behaviour behind the 409 re-read and `/auth/houses` (mocked in the web tests; code read only).
- The PR claim rows (`claims.d/*.jsonl`) and CI; only vitest and tsc on the web app were run.

## Cleanup

Scratch worktrees `/private/tmp/claude-501/qa-wt-r12-20..23` and the local refs `refs/qa-r12/*` are removed. One stash entry created by my own `git stash -u` inside a scratch worktree (it held only a probe copy) was dropped by exact hash; other sessions' stashes untouched. Nothing was checked out, merged, pushed or commented on in the shared checkout.
