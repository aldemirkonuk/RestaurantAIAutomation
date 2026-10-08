**[2026-10-06 ~05:04Z, coordinator, at merge] Merged head `34098a128`.** This top section replaces the earlier per-head status notes, which described heads `b0c60b850`, `14016c2df` and `edfec73af` and said "this head has not been gated". Those notes are in the PR's edit history. Everything from "What was wrong for the owner" down is the PR's record.

- **Audits (ADR 0090, three roles):**
  - PASS at `5a737a8e7` (comment 6007717351).
  - Re-audit PASS at `34098a128` (comment 6009673676; `audits/622-34098a128/report.md`). The branch has no commits of its own since `5a737a8e7`. It has only two merges of main: `4daa3caba` (main `54f833e4b`, #627) and `34098a128` (main `4528b9689`, #621). Neither merge changed a dashboard file. The only file both #621 and this PR touch is the decision index, whose rows are kept by number.
- **CI at `34098a128`:** 41 pass, 1 skipped (Supabase Preview).
  - An earlier run at `4daa3caba` failed once on main's `ReceivingNext.test.tsx` F9. The re-audit's final judged that a flake: a synchronous `getByText('≥$900')` after awaiting a different query, in a file this PR does not touch. The fix is owed on its own branch.
- **Re-run by the coordinator at `34098a128`:** jest `src/dashboard` 63/63; vitest `src/pages/dashboard` 114/114. Migration order, versions unique, OD ids, conflict markers, citation pairing and decision claims all pass.
- **History.**
  - Last call 2 held `edfec73af` on one false sentence: "'recorded' is wider than a cell under about 44 px". `f5f0d0089` reworded it, in ADR 0290 §9, the `NOT_RECORDED_FIG` comment and the tech-debt fragment, to the measured range. "recorded" breaks inside the word in cells measured up to 49.4 px wide and reads whole from a cell of about 60 px; the widths between were not measured.
  - The founder's answers were recorded in `a451c6153`.
- **Owed after merge, none blocking (from the re-audit's final):**
  1. The `ADR-0290-MONTH-ON-THE-HOUSE-DAY` claim row does not catch a UTC-prefix `houseDayOf` coming back, and no claim row covers `CHECK_LOOKBACK_MS`. Only the spec guards them.
  2. A check opened more than 24 h before the 1st and closed in the month is not found. Whether to widen the read or show the gap is a question for the founder.
  3. `dashboard.controller.ts` returns `error.message` in 500 bodies. It should return a fixed sentence and log the detail.
  4. ADR 0290 should point to ADR 0281 F1 and to #616's zone ruling.
  5. December-to-January, DST and the lookback edge are untested.
  6. The `ReceivingNext.test.tsx:885` race, on its own branch.

## What was wrong for the owner

The owner-quarter analytics walk on Tuzlu Rüzgar (production, read-only, 2026-10-03) found three things wrong with `GET /dashboard/calendar-revenue/:id`, the month grid on `/dashboard`:

- **A-036 / C18 (major).** The deliveries read named `procurement_orders.wine_name`, a column that table has never had. PostgREST refused the whole read and nobody read the error, so every day drew **$0 paid to vendors**. Oct 2 showed $0 / 0 bottles / 0 orders. That day 549 orders delivered $39,302.50 and 4,347 bottles.
- **A-042 / AW12 (minor).** The events read was `select('*')` with no paging. In October it sent 534 full rows of 34 columns (547,711 bytes) to draw one dot a day. A month past the 1,000-row `max_rows` would have lost its last days without a word.
- **A-023 / AW21 (major).** Locked ADR 0044 calls this a sales calendar (`:26-27`), but it had no sales source.
  - Days were also cut on the UTC prefix of a timestamp (F-086), so an evening in Los Angeles landed on the next day's square.

## What changed, and why

All of it is recorded in ADR 0290 (Proposed), *The dashboard tells the house's day true*.

- **House day.** Every figure is filed with `localDateIn` in the zone that `houseFrame` returns (`common/house-frame.ts`, ADR 0207 q6).
  - That zone is the house's own zone if its name can be read, else its country's only zone, else none. This is the rule #616's `readHouseZone` reads.
  - With no zone, every day figure is `null` and the payload carries `zone_unset: true`. The page draws "—" and links to Settings. It never guesses UTC (DASH-G2).
- **Net sales: count and say** (netsales F1, ADR 0290 §2).
  - A day's net sales are the sum of `pos_checks.subtotal` over the non-voided checks that stated one.
  - Each day carries `net_checks` beside `checks`. The month carries `monthly_net_checks` beside `monthly_checks`.
  - When 0 < N < M, the page says "from N of M checks". A day whose checks all lack a subtotal reads "not recorded", never "—" and never $0.
  - The fold is a local copy of #615's `foldNetSales`/`netSalesOf`. It has the same rule and return shape, re-compared with #615's head `f315abb07` in this last call.
- **Month total: sum, say N of M days** (§4). The month sums the begun days the register counted and states `monthly_days_counted` of `monthly_days_begun`. For example: "net sales $14,310.25 · from 2 of 4 days".
- **Register bounds** (§4).
  - A house that has never sent a check reads "No register connected".
  - Days before its first check read "—". So do days after its latest check, which is the founder's 2026-10-05 ruling.
  - A quiet day between those bounds is a measured 0.
- **Check day** (§3). A check belongs to the house day it closed on, else the day it opened. The read looks back 24 h. `houseDayOf` is a local copy of #616's helper, with the same rule and signature (re-compared with #616's head `cfa9876d7`).
- **C18.** `wine_name` is dropped from the deliveries read. The read goes through the keyset pager `readAll`, which throws on error, so a refused read is a 500 and not a month of zeros.
- **AW12.** The events read names the five columns it draws, is keyset-paged and complete, and keeps every status.
- **Who sees sales.** Sales are gated on `policyFor(role).sees.includes("sales")`, so owner, manager and admin see them.
  - For anyone else `pos_checks` is not read, and the payload says `sales_withheld: true`.
  - The role is the one in the token's house, and `JwtAuthGuard`'s `assertTenantMatch` holds the route's `restaurantId` to that house.
- **Bad input.** A malformed `year` or `month` is a 400. It is raised outside the handler's try, so it is not rewrapped as a 500.
- **Web (F2).**
  - The cell headlines net sales. A partial day carries "from N of M checks" under its figure.
  - The spoken label, the header and DayDetail say the same counts.
  - "Today" comes from the house's clock.
  - The footer says net sales add up the subtotals register checks carry, and that this is before tax and surcharge only "when the register sends it that way".
- **Layout (§9).** The calendar cell and DayDetail size what they hold by their own widths, never the window's.
  - The cell is an inline-size container. Its headline is `min(12px, k cqi)`, one size for the month, so a figure never clips. Its words are `min(9px, 28.5cqi)` and wrap.
  - DayDetail's figures are `auto-fill` tracks of at least 8rem. Its four lists sit side by side only where each gets 16rem.
  - Before this, inside the app shell, a desktop cell (36.9 px at 1280) was narrower than a phone's, so "$4.2K" drew as "$4.2". DayDetail's `lg:grid-cols-6` gave each figure 34 px.
- **Controller.** The ApiOperation text describes `net_checks`, the counted-days fields and the `houseFrame` zone.
- **Ratchet.** `read_error_baseline.json` retires the route's two swallowed-read rows, taking it from 151 to 149 sites.

## Founder answers this PR rests on (verbatim)

- DASH-G2: *"Follow rule, follow-up PR (Recommended)"*. No zone reads as unknown, never UTC, and is sketched first.
- AW17: *"Net sales (Recommended)"*.
- F2: *"Sales in the cell (Recommended)"*.
- F5: *"Keep out, say so (Recommended)"*. This is built on the stacked PR-1b, not here.
- netsales F1, 2026-10-04 ~20:50Z: *"Count and say (Recommended)"*. It supersedes ADR 0290's first rule 2.
- Outage fork, 2026-10-05T01:14Z: *"Dash after last check (Recommended)"*. This is path (b) as built, with no heartbeat now.
- Month total, same ask: *"Sum, say N of M days (Recommended)"*.
- F1, F3 and F4 were not asked. They proceed on the plan's recommendation, as ADR 0290 states.

## Tests and guards

Re-run by last call 2 at `edfec73af`, with a clean working tree: [2026-10-06, coordinator: the code is unchanged since; the coordinator's re-run at the merged head `34098a128` is in the top section.]

- **Web vitest** `src/pages/dashboard/next`: **114/114** across 7 files.
- **Gateway jest** `src/dashboard`: **63/63** across 4 suites, with `--runInBand --forceExit`.
- **`check_decision_claims.sh`**: **868/868** holding.
- **`check_adr_numbers_unique.py`**: OK. 0290 is introduced by this ref, checked against 1,693 refs.
- **`check_read_errors_not_swallowed.py`**: 1,713 files, 149 sites, 149 baselined, 0 allowlisted.
- **Typecheck.**
  - Web: only `src/services/api/passkeys.ts(14,81)` fails, because `@simplewebauthn/browser` is not installed in the shared `node_modules`. That file is not on this branch.
  - Gateway (`tsconfig.spec.json`): clean apart from the pre-existing `@simplewebauthn/server` errors.
- **eslint.**
  - Web, on the 6 changed files: 0 errors.
  - Gateway, on the 4 changed files: 0 errors and 1 warning.
- **Gate-ownership classifier** (`ownership_between`, merge-base `28d32de36` to `edfec73af`): `[]`.
- **Files:** 15 against origin/main `28d32de36`.
- **SQL:** no migration and no SQL test, so there was no Postgres run.

From the builder and verifier rounds, not re-run here:

- **Fail-before, web.** `DashboardNext.test.tsx` against `3d29bc298`'s `SalesCalendar.tsx` and `DayDetail.tsx` fails **5 of 19**.
- **Fail-before, claims.** The claim row `ADR-0290-CALENDAR-SIZED-BY-ITS-CONTAINERS` prints all 9 reasons on those files.
- **Fail-before, gateway.** `dashboard-month-days.spec.ts` has 15 tests red on `4050daebe`'s service and 36 red on `8c673db4b`'s.
- **Gateway mutations.**
  - The verifier ran 4: `netSalesOf`, the counted window, the role gate and the `houseFrame` null zone. Each was caught by a spec.
  - Earlier rounds ran 6 of 6.
- **Other guards**, each with its `--self-test`: `check_windowed_figures`, `check_money_states_its_currency`, `check_no_seeded_defaults`, `check_no_conflict_markers`, `check_citation_pairing`, `check_od_ids_exist`, `check_web_reads_gateway_dto_keys` and `check_flag_readby_anchors`.

Browser checks, all on the local fixture harness (127.0.0.1, fake adapter, nothing left the page):

- **Builder, fix round after the HOLD at `3d29bc298`.** Playwright with shell spacers (rail 232 px; counter 320 px from 1280, else 52; a phone gets neither). Four states (a Tuzlu-like October with Oct 2's figures, no zone, a day not recorded, a day short of its checks) at 1024, 1280, 1440 and 375 px.
  - In every run there was no horizontal scroll, no page or console error, and no figure, orders mark or word line past its cell's inner edges.
  - Screenshots: `dash-harness/fix2-{normal,nozone}-*.png`, `fix2-extra-*.png`. Measurements: `fix2-measure-*.json`.
- **Verifier.** Five widths and nine states, all clean. Cell widths matched §9.
- **Last call 2.** The "not recorded" break at seven widths (Status).

## ADR, CLAIMS and docs touched

- `.planning/decisions/0290-the-dashboard-tells-the-houses-day-true.md` (Proposed):
  - §1–§9.
  - The founder's rulings, quoted verbatim.
  - Rejected options 1–13.
  - The review trail through the fix round after `3d29bc298`.
- `.planning/decisions/README.md`: only this branch's own 0290 row.
- `.planning/decisions/claims.d/fix-dashboard-tells-the-day-true.jsonl`: 12 rows.
  - 11 are resolved.
  - 1 is open: `ADR-0290-AW04-LOW-SINCE-OPEN`, which PR-2 flips.
- `.planning/tech-debt.d/2026-10-03-fix-dashboard-tells-the-day-true.md`: the closed defects and the owed list. Its line cites (`:1226`, `:525-526`, `:624-625`, `check_read_columns_exist.py:177`, `DELIVERY-AUDIT.md:135`) were re-checked in this last call and hold.
- `scripts/read_error_baseline.json`: two rows retired.

## Founder answers (2026-10-05, AskUserQuestion)

- **F1 sketch (DASH-G2, "sketched first").** He was sent the renders of the built no-zone month (`dash-harness/fix2-nozone-{1024,1280,1440,375}.png`: three desktop widths inside the shell, and one phone). Every day reads "—", the zone line links to Settings, and DayDetail's money figures read "—". He answered *"Sign off as built (Recommended)"*.
- **The cell's form when it is narrow.** "not recorded" breaks inside "recorded" in every cell measured up to 49.4 px wide, and reads whole from 59.7 px. He answered *"Keep the words, wrap (Recommended)"*: the cell keeps his words and wraps them, as built.
- **Giving the calendar room inside the shell.** He answered *"Counter starts tucked (Recommended)"*. `/dashboard` joins `/reports` and `/inventory` in `WIDE_PAGES` (`counterPrefs.ts:36`), so the counter starts as a strip and a person's remembered choice still wins. On the harness that gives a 75.1 px cell at 1280 and 98 px at 1440, with the 12 px headline. It is one line in a 16th file, so it ships on a follow-up branch with its own audit. Not taken: stacking the side rail below the calendar, and no change.

All three are recorded in ADR 0290 (§9, Consequences, the DASH-G2 bullet and the review trail) and in the tech-debt fragment.

## Merge order and shared files

- **#615** (netsales, head `f315abb07`) adds `analytics/net-sales.ts`, and **#616** (tz, head `cfa9876d7`) adds `common/house-day.ts`. This branch holds local copies with the same rules.
  - Whichever of each pair lands second swaps to the shared helper, and `houseZoneOrNull` moves to `readHouseZone`.
  - Neither PR stacks on the other, and neither shares a file with this one except `README.md`.
- **#579** (`fix/review-dashboard`, paused, head `48877640d`) shares 8 of these files: the service, the controller, `SalesCalendar`, `DayDetail`, `DashboardNext` and its test, `useDashboardNextData` and `read_error_baseline.json`.
  - #579 rebases onto this PR and PR-1b.
  - AW19's remainder, C13 and the W22 spend gate stay with #579 (F4 (a)).
- **#565** (head `e31e60333`) touches `DayDetail`, `SalesCalendar`, `useDashboardNextData`, `services/api/dashboard.ts` and `DashboardNext.test.tsx`, so expect conflicts. This PR lands first.
- **#609** (cap, head `12d1d9e6f`) edits `getSalesChart` in `dashboard.service.ts`. An earlier test merge auto-merged that file and conflicted only in `README.md`.
- **#561** (`fix/role-read-error-means-no-role`, head `566c49653`) also edits `scripts/read_error_baseline.json`.
  - It **conflicts** there, in `_comment`, `total_sites` and `total_files`.
  - Whichever lands second re-measures with the guard and keeps both retirements.
- **#603, #607, #608 and #610–#621** share only `.planning/decisions/README.md` with this branch. That includes #620 (zoneaddr, ADR 0304) and #621 (tables), which are new since the last round. Keep the rows ordered by number.
  - #620 changes how a house's zone is set, not `houseFrame`, so this branch reads whatever zone it stores.
- **PR-1b** (`fix/dashboard-tiles-say-settled-deliveries` @ `006a3b445`, F5) was cut on `4050daebe`. It must rebase onto this branch's final head, with conflicts expected in ADR 0290 and `dashboard.service.ts`.
- **PR-2** (`fix/dashboard-alert-says-when-it-went-low`, AW04 `low_since`) is not built. It is cut from main after this PR merges.

## Not covered (CLAUDE.md §0.5)

- **The 8 px cell headline at 1024 and 1280 inside the shell, and "not recorded" breaking inside the word.** The founder kept the wrap; the counter starting tucked on `/dashboard` gives the cell room from 1280 up and ships on a follow-up branch, so until it lands both stay as measured, and at 1024 they stay after it too. Figures no longer clip, and DayDetail's figures no longer overlap.
- **Layout was measured on a fixture harness, not in the real `HouseShell` or the deployed app.** The harness uses spacers at the shell's widths.
  - The 375 px runs had no rail and no counter, as on a phone.
  - jsdom drops `clamp()` and `cqi`, so the spec pins the constants and style hooks, not the fit. A CSS regression that keeps the same constants would pass the spec.
- **No plain-px fallback for container query units.** A browser without `cqi` would draw the cell's figure and words at the inherited size.
  - The app already relies on container queries (`cellar-next.css:57`, `public-shell.css:525`), so this does not lower the support floor.
  - It is stated, not guarded.
- **The 88 px figure for stacking the rail is arithmetic, not measured.**
- **`check_gateway_boots.sh` could not run in this worktree**, because `@simplewebauthn/server` is missing (a pre-existing worktree gap). CI runs it.
- **Moved to PR-2:**
  - The reason text in `check_read_columns_exist.py:177`, which still names the dashboard.
  - The `DELIVERY-AUDIT.md` §6 denominator (151 → 149).
  - AW04: the low-stock `createdAt` is still the request time (`dashboard.service.ts:1226`), and its claim row is open.
- **Left to the paused #579:** AW19's remainder and C13. F5 is on PR-1b. So the lane brief is not closed by this PR alone.
- **The page does not say why a day reads "—"**: whether it is before the register began or after its last check.
- **The no-zone line also shows for an unreadable zone name** when the country has several zones, or none recorded.
- **A gap in the middle of a month still reads as quiet days.** Only a heartbeat (path (c)) would catch it, and it was not chosen now.
- **The month's `pos_checks` read has no ceiling.** That is fine at Tuzlu's volume and unbounded for a very busy house.
- **A check opened more than 24 h before the 1st is not found.**
- **Money prints with one decimal.** "$39,302.5" comes from the shared `formatMoney` in `full` mode, which belongs to the fmt2 lane.
- **KpiRow was not re-checked here.** Its tiles are PR-1b.
- **One commit cite is wrong.** The body of commit `44be8bf88` cites notifications one line off. The fragment carries a bracketed correction, and history was not rewritten.
- **The commit trailer** is CLAUDE.md's `Co-Authored-By: Claude Opus 5` on the lane's commits and `Claude Opus 5.5` on the coordinator's three.
- **No production reads or writes.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)

