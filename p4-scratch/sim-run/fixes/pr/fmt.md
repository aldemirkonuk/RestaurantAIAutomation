## What was wrong for the owner

These came from the read-only analytics walk on Tuzlu Rüzgar (production, 2026-10-03), lane `fmt`, AW18 and AW07.

**A-020 (major): /reports showed pace and trend 100 times too small.** The engine returns `trendPerDayPct` and `paceDeltaPct` as 0–1 fractions:
- `trendPerDayPct` is the OLS slope ÷ |mean| (`engine/statistics.ts` trendPerPeriodPct).
- `paceDeltaPct` is (current − previous) ÷ |previous| (`engine/comparisons.ts` periodOverPeriod).

The recommendations and the insight generator already read them as fractions. `rp-format.ts` `pct` printed them without multiplying by 100, and its doc comment said they were "already in percent". Tuzlu's measured trend was `trendPerDayPct = 0.20689655`, which is +20.7% a day. The page showed it like this:
- The trade register showed "28-day trend: +0.21%".
- The bench showed "The week's trend: +0.2%".

The CSV and print export made the same mistake: they tagged the raw fraction with the `percent` unit, so they wrote "0.2%". Pace uses the same formatter. It shows a dash for Tuzlu today only because `paceDeltaPct` is null there. No test caught any of this because the fixtures were also written as percentages (33.3 where 1200 against 900 is 0.333).

**A-040 (minor, latent): an empty server register blamed the POS feed.** `table-analytics.service.ts` set `dataStatus` to "awaiting POS check feed (pos_checks is empty)" whenever the *window* held no check. The page then printed "No check in the window carries a server name … That is an absent field on the POS feed". The seats view printed "an absent attribution, not an empty room" for the same case.

Tuzlu's POS feed runs from Jul 1 to Aug 30 (3,593 checks), and /reports fixes the window at 90 days. From about Nov 28, the window will hold no checks because the feed stopped, not because a field is missing. The walk reproduced the false status with a window starting Aug 31 (`wtr-33`). There was also a second problem: a *failed* `pos_checks` read returned `[]`, so a broken query printed the same "pos_checks is empty" text (ADR 0067). Today Tuzlu's page shows 5 waiters and "live", so nothing on screen is wrong yet.

## What changed and why

**A-020**
- **`pct` now multiplies by 100.** 0.2069 prints "+20.7%". A value that rounds to zero prints "0.0%", never "-0.0%". The doc comment now cites the engine functions.
- **Trend labels say "per day".** The trade figure reads "28-day trend, per day" at 1 digit, which matches the export. The bench figure is "Trend per day, last 28 days" and its table cell reads "+20.7% a day".
- **The export goes through a new helper.** `report-export-cuttings.ts` gains `pctOf` (×100, or null). All six pace and trend sites use it, and the unit stays `percent`.
- **Fixtures now hold fractions.** In `cutting-payloads.ts` and `ReportsNext.test.tsx`, 33.3 became 0.3333, -0.4 became -0.004 and 0.2 became 0.002.

**A-040**
- **A failed read throws.** `loadChecks` throws `ServiceUnavailableException` (503) instead of returning `[]`.
- **New `feedStatus` helper.** It serves the four POS registers: tables, waiters, basket and hot tables. Each now returns `checksInWindow` and `latestCheckAt`.
  - When the window has checks, `dataStatus` stays `"live"`, because `scenario-verify.service.ts` keys on that word.
  - When the window is empty, it runs one probe: `pos_checks` filtered on `voided = false`, newest first, 1 row, served by `idx_pos_checks_restaurant_opened`. That gives one of two statuses: "no POS check opened in the last N days — the latest was opened YYYY-MM-DD (UTC)", or "awaiting POS check feed — no POS check is recorded for this restaurant".
  - If the probe fails, it throws too.
  - The basket gets a third state: "N POS checks in the last 90 days, none listing two or more named items". Before, that case read as an empty feed.
- **The page and the export distinguish the cases.** `rp-registers-house.tsx` and `report-export-cuttings.ts` now print the "absent field on the POS feed" and "absent attribution" sentences only when `checksInWindow > 0`, and those sentences now give the check count. An empty window names itself and the latest check's date. A house with no checks says none has reached Mudavym. A gateway older than this change sends no count, and the page then gets a hedged sentence that asserts neither cause.

**Why 503:** ADR 0067 frames a failed read as a 503 ("a 404 for a 503"), and 78 gateway files already use `ServiceUnavailableException`. This applies an existing record; it is not a new choice. The consumers already handle a throw:
- The page shows its failure line.
- The export marks itself failed.
- `scenario-verify` catches the throw and reports "unverifiable".

No web or mobile page reads hot-tables or basket today.

12 files, 773 insertions, 53 deletions. One commit, `5ec60d01b`, on `origin/main` `8c673db4b`. `git merge-tree` against current `origin/main` (`619a068a9`) is clean.

## Tests and guards

I re-ran these at HEAD `5ec60d01b`, in the clean worktree.

**Tests**
- **Gateway:** `npx jest src/analytics src/reports src/simpos --runInBand` gives **60 suites, 939 tests passed**. That includes 17 new tests: 7 in the new `table-analytics.service.spec.ts` and 10 in `report-export-cuttings.spec.ts`.
- **Web:** `npx vitest run src/pages/reports` gives **5 files, 128 tests passed**. That includes 12 new tests: 4 in the new `rp-format.test.ts` and 8 in `ReportsNext.test.tsx`. The baseline at `8c673db4b` was 116.

**Revert proof** (measured independently by the builder and the verifier; the two counts agree):
- With the old `rp-format.ts`, 6 tests fail.
- With the old trade, bench and house registers, 7 fail.
- With the old `table-analytics.service.ts` and export writer, 16 fail.

**Typecheck:** the gateway (`tsc -p tsconfig.spec.json`) has 2 errors and the web has 1. All three are the `@simplewebauthn` passkeys errors already on main; nothing new.

**Lint**
- Gateway eslint: 0 errors.
- Web eslint, with the scratch web-lint plugin path: clean.

**Guards:** each passed, and so did its `--self-test`:
- `check_read_errors_not_swallowed` (baseline unchanged; the new probe binds `error`)
- `check_read_columns_exist`
- `check_queried_tables_exist`
- `check_analytics_cost_honesty`
- `check_money_states_its_currency`
- `check_no_conflict_markers`
- `check_windowed_figures`
- `check_web_reads_gateway_dto_keys`
- `check_route_exposure`

**Claims checks**
- `check_decision_claims.sh`: 839 checked, 839 holding.
- `test_check_decision_claims.sh`: 31 ok, 0 failed.

## ADR / CLAIMS touched

- **No new ADR.** This branch decides no method, threshold or product behaviour:
  - A-020 restores the engine's documented 0–1 convention (`report-export-cuttings.ts` header and the engine functions).
  - A-040 applies ADR 0020 and ADR 0051 (Locked), and ADR 0067 (Proposed), including the 503 that ADR 0067 itself names.
- **New** `.planning/decisions/claims.d/fix-reports-fractions-and-empty-register.jsonl` adds three static python rows. Each exits 0 at HEAD and 1 against the `8c673db4b` copies of the files; I re-ran this myself.
  - `REPORTS-2026-10-03-PCT-IS-A-FRACTION-TIMES-100`
  - `REPORTS-2026-10-03-POS-EMPTY-WINDOW-IS-NOT-AN-ABSENT-FIELD`
  - `REPORTS-2026-10-03-POS-CHECK-READ-FAILURE-IS-NOT-EMPTY`
- `v3.0-TECH-DEBT.md` has no entry for these findings, so it is unchanged.

## Forks deferred (founder's call, not made here)

Both belong to **A-048**, the /team Performance card's per-cover "house median". That fix lives on a separate branch, `fix/team-performance-per-cover`, and needs both answers:
- **F1:** is the benchmark a house median that includes this person, or a peer median that leaves them out? The recommendation is the house median, with the card stating its coverage.
- **F2:** the card's "Wine attach" is wine_sales ÷ net_sales. Should it be relabelled "Wine share of sales", annotated, or recomputed as a true attach rate?

## Not covered (CLAUDE.md §0.5)

- **A-048 is not in this PR.** The `fmt` lane brief's headline includes "a per-cover median with its unit". The 15-file cap and one-operation-per-branch rule split it onto its own branch, and it waits on F1 and F2. **The `fmt` lane is not closed until that PR lands.**
- **The new count inherits the 1,000-row cap.** `checksInWindow` is `checks.length` from `loadChecks`. That read has no order or paging and stops at the API's `max_rows` of 1,000 (`supabase/config.toml:18`; the `cap` lane's A-006 measured 1,000 of 3,341 Tuzlu checks). So for a window with more than 1,000 checks:
  - A sentence like "None of the N checks in the last 90 days carries a server name" would show N = 1,000.
  - When the window is not empty, `latestCheckAt` is the newest of the rows read, and the web `PosWindow` comment describes it as the newest the house has.

  Neither prints in any case today. The count appears only when no waiter or table is attributed, and `latestCheckAt` only when the window is empty, where the probe gives the true newest check. The `cap` lane makes both exact. **Expect a textual conflict with the `cap`, `tables` and `booth` lanes** in `table-analytics.service.ts`.
- **Two dates for one check.** The page's empty-window sentence gives the latest check's date in the viewer's local calendar. The basis line ("Feed: … (UTC)") and the export give the UTC date. A late-evening check can therefore show two different days. The `tz` lane is expected to supersede this.
- **No Browser-pane visual check.** It needs an authenticated gateway, and this lane is limited to local code and tests with no production calls. The rendered sentences are pinned instead by exact-string assertions in `ReportsNext.test.tsx` and the export spec.
- **Suites not run:** the full repo-wide jest and vitest. Only gateway `src/analytics`, `src/reports` and `src/simpos`, and web `src/pages/reports`, were run.
- **`p4-scratch/verify_index.sh` was not used.** It writes outside this lane's allowed paths. The worktree had no unstaged or untracked files, so the tests ran on exactly the committed tree.
- **Prettier warnings rose.** They went from 56 to 59 in `report-export-cuttings.ts` and from 26 to 37 in its spec. Both files already carried many, eslint shows 0 errors, and CI has no eslint step. The new `table-analytics` files are prettier-clean.
- **The branch commit's "Claims:" sentence is loose.** It says each row fails "under eight targeted mutations". In fact, each row fails only under the mutations aimed at it. The figures in this body are the accurate ones.
- **A-020 and A-040 share one commit,** because they share four files (the export writer, its spec, the fixtures and `ReportsNext.test.tsx`).
- **API response change.** The four POS endpoints gain `checksInWindow` and `latestCheckAt`. Their empty-window `dataStatus` text changed, and the basket's old "awaiting POS check items (pos_checks.items is empty)" is gone. A failed read is now a 503 rather than a 200 with an empty status. I grepped for consumers: `rp-registers-house.tsx`, the export reader and `scenario-verify` are the only ones that read these fields.
- **Not touched:**
  - The date control (C02/F-128) and the owner-language pass (C13), as the brief's attack note AW03 directs.
  - The stale `PerformancePanel.tsx` row in `scripts/money_currency_baseline.json:47`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
