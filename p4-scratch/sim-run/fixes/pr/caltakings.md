**[2026-10-06 ~00:33Z, coordinator] Re-headed at `31c5ec562`.** It merges `origin/main` `63ce97e62`, bringing in everything merged since this branch last took main. The newest of that is #607 `1884dea38`, #647 `8e16fbcef` and #646 `63ce97e62`. Conflicts resolved by the coordinator: none. Guards at the new head: migration order, versions unique, OD ids and conflict markers all 0. `ownership_between(origin/main, HEAD)` = `[]`. Decision claims and ADR-number uniqueness are left to CI. Lines below that name an older head describe this PR before the merge. This is a first audit pass; the merge turn re-heads and re-audits.

## What was wrong for the owner

The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only, production) found **AW22 / A-049: /calendar did not show the takings its own API returned.**

- `GET /calendar/day-record` summed `pos_checks.total` into `recorded.sales` (`recorded-days.service.ts:129-130`, select at `:165` @ `8c673db4b`). The page drew only covers, in both the month cell and the day panel (`SkyMark.tsx:150-177`, `MonthLedger.tsx:158`, `:314`). No web file read `recorded.sales`.
- So Tuzlu's street-fair booth, **$7,709.52 over Aug 22-23** ($4,201.10 and $3,508.42, covers null on both checks), changed nothing on /calendar.
- The figure the API sent was **gross**. The walk measured `total` as net plus 8.63% tax plus a 4% surcharge (AW17).
- `/calendar/day-record` is guarded only by `JwtAuthGuard`, so that gross figure went to **every role, staff included**. It was not drawn, but it was in the payload.

## What changed, and why

**Gateway** (`apps/api-gateway/src/calendar/`)
- `recorded-days.service.ts`: the `pos_checks` read selects `subtotal` instead of `total`, and the fold sums it as `netSales`. It never falls back to `total`, because a sum of net and gross is neither. `netSalesCheckCount` counts the checks that carried a subtotal, so a partial figure says it is partial. `netSales` is null, never 0, when no check carried one. Paging is untouched; that belongs to lane cap.
- `day-record.service.ts`:
  - `recorded.sales` becomes `netSales` + `netSalesCheckCount`.
  - The window gains `currency: {code, readable}` from one `restaurants.currency` primary-key read, run alongside the two registers. A failed read is logged as `readable: false` and is never shown as "not recorded" (ADR 0117 Q25).
  - The evidence pair's `actual_value.sales` (gross) becomes `netSales`, `netSalesCheckCount` and `netSalesCurrency`.
  - `windowFor` takes a **required** viewer `{seesHouseMoney}`. A viewer who does not see money gets `withholdHouseMoney(window)`. That function is an allowlist: it drops `netSales`, `netSalesCheckCount` and `currency` (the keys are omitted, not nulled) and adds `takingsWithheld: true`. The evidence pair is still written in full, whoever opened the page.
- `calendar.controller.ts`: `seesHouseMoney = roleSatisfies(user.role, "manager")`. The role is the one held in the token's house, re-read on every request (`jwt.strategy.ts:68`). A null, staff or unknown role ranks below manager.

**Web** (`apps/web/src/pages/calendar/next/`)
- `SkyMark.tsx`: a new `TakingsMark`, drawn in `DayLedger` only (the month view's opened day and the Day view). It has three states:
  - complete: the amount, then "net sales · recorded";
  - partial: the amount, then "net sales · from N of M checks";
  - none: an em dash, then "net sales not recorded".

  It draws nothing on a day with no checks, nothing for a payload from before this change, and nothing when `takingsWithheld` is set. `DayRecordMark` and the month cell stay covers-only.
- `MonthLedger.tsx`: `TakingsMark` sits beside `DayRecordMark` in `DayLedger`. The month grid is untouched.
- `cal-format.ts`: `takings()` uses `formatMoney`, so the output is never a bare `$`. "(currency not recorded)" and "(currency could not be read)" are kept apart.
- `useCalendarNextData.ts`: types mirrored. The net keys are optional, so a payload from before this change draws no mark rather than "not recorded".

## Founder answers (verbatim, built)

- **AW22** (2026-10-04 ~00:30Z): *"Day panel only (Recommended)"*. Built: the takings appear in the opened day's panel only, and the month cell and its hover title stay covers-only.
- **AW17** (~00:15Z): *"Net sales (Recommended)"*. Built: the sum of `pos_checks.subtotal`, labelled "net".
- **F1, who sees the day's takings** (~02:10Z, in his own words): *"everyone owners and managers, authorized ones see everything others only see actions, goals dedicated to them"*. Built as option (b): owners and managers see the takings; any other role, or no role, gets the payload with the money keys omitted and `takingsWithheld: true`. Both sides are tested. The "goals dedicated to them" half is recorded in ADR 0287 as his direction for staff and is **not built** here.

## Tests and guards (run at HEAD `3d0083990`, origin/main `e2cbe426a`)

- Gateway: `npx jest src/calendar --runInBand --forceExit` → **15/15 suites, 319/319 tests**. `day-record.spec.ts` has 50 tests (baseline 33). The new tests cover:
  - net vs gross;
  - null, never 0;
  - the partial count;
  - the select names `subtotal`;
  - currency readable, not recorded, and unreadable;
  - the pair key;
  - the real controller driven as owner, manager, staff, host, null and undefined;
  - a staff-opened pair still written in full;
  - the `withholdHouseMoney` allowlist.
- Web: `npx vitest run src/pages/calendar` → **4/4 files, 123/123 tests**. `CalendarNext.test.tsx` has 74 tests (baseline 63). The new describe block, 'the opened day shows what it took, net', has 11 tests. They check:
  - the figure in the house currency;
  - the cell stays covers-only, before and after the day is opened;
  - partial, em dash, no currency, unreadable currency;
  - the Day view;
  - no mark for a payload from before this change, for a no-check day, and for a withheld window, even if a figure reached it.
- Mutations: with the role check forced `true || …`, 4 gateway tests fail (re-run at last call). The verifier also ran:
  - `select` and fold switched back to `total`: 6 fail;
  - `windowFor` returning the full window: 4 fail;
  - web withheld guard removed: 1 fails;
  - `TakingsMark` removed from `DayLedger`: 7 fail;
  - `TakingsMark` added to the cell: 1 fails.
- Typecheck: gateway `tsc -p tsconfig.spec.json` gives 2 errors and web `tsc` gives 1. All three are TS2307 `@simplewebauthn/*` in untouched passkeys files, because that package is absent from the symlinked node_modules. There are no other errors.
- Lint: web `eslint --quiet` on the 5 web files exits 0. Gateway eslint on the 4 calendar files gives 0 errors and 15 warnings (prettier and unused variables, on lines the verifier confirmed predate this lane).
- CI guards at HEAD:
  - All **44** `scripts/check_*.py` named in `ci.yml` exit 0.
  - The 3 shell guards exit 0: `check_model_calls_logged.sh`, `check_no_direct_stock_writes.sh` and `check_no_direct_type_attributes_access.sh`.
  - `check_decision_claims.sh`: **843 checked, 843 holding, PASS**.
  - `check_adr_numbers_unique.py`: 0287 is introduced by this ref, checked against 1,675 refs, no collision.
  - `--self-test` was run by the builder and verifier for adr_numbers_unique, citation_pairing, od_ids_exist, no_conflict_markers, read_columns_exist, read_errors_not_swallowed, web_reads_gateway_dto_keys, no_seeded_defaults, money_routes_are_sealed, windowed_figures and verified_at_is_not_a_boolean.
- Local Postgres (`pgtest.sh lane … caltakings`, saved at `p4-scratch/sim-run/fixes/audits/caltakings-local-pg.txt`):

  ```
  applied 0 migration(s) to caltakings_fix
  template=fb862aa574f710d4e1faf06df0ea50f1a5ce18cf lane_migrations=0 tests=0
  pos_checks.subtotal numeric
  pos_checks.voided boolean
  restaurants.currency character varying
  ```

  This lane adds no migration and no SQL test, so the run proves only that the columns it reads exist.

## Decision records and claims

- **New: ADR 0287**, *A passed day's panel shows its net takings; the cell stays covers*. Locked on the founder's three answers above. It covers placement, basis, the partial-day method, the currency shape, the payload and evidence keys, the audience (F1), and the known limits, each with an owner.
- **ADR 0111 §2b**: a dated bracket says the cell stays covers-only; 0111 governs the cell and 0287 governs the panel.
- **`.planning/decisions/README.md`**: the index row for 0287.
- **`.planning/06-pages/calendar.md`**: the two "Covers and sales" lines (`:172`, `:421`) are corrected in place.
- **`claims.d/fix-calendar-day-panel-takings.jsonl`**: claim `AW22-CALENDAR-DAY-PANEL-NET-TAKINGS`, status resolved. Its static verify checks 8 conditions. The verifier ran 19 mutants against it; each exits 1.

## Forks deferred

- **F2 (coordinator)**: whether each POS adapter's `subtotal` is really net. Square maps `net_amounts.total_money`, which its docs describe as tax-inclusive; Clover writes `subtotal: null` (`pos-adapters.ts:113`, `:159`). This is handed to **lane netsales** (AW17), which should also adopt or supersede 0287's partial-day rule.
- **The staff half of F1** ("goals dedicated to them") is recorded as direction and not built.
- **OD-180 fork 3** (house money on the bell, product-wide) is untouched; 0287 F1 answers only this route.

## Merge order

- **Lane cap (`fix/analytics-reads-past-row-cap`, ADR 0292) merges FIRST.** Both lanes edit the `pos_checks` read in `recorded-days.service.ts`. Cap wraps it in `readWholeWindow` and selects `"id, opened_at, closed_at, total, covers", { count: "exact" }`. When this branch is synced after cap, it needs three changes:
  - the select becomes `"id, opened_at, closed_at, subtotal, covers", { count: "exact" }`;
  - the claim's regex (verify item 1 currently requires `.select("…")` with the paren closing straight after the string) must accept the second argument, or the claim fails;
  - the fake supabase chain in the `RecordedDaysService — reads the net column` spec must answer cap's paged and counted read.

  Until cap lands, a Tuzlu month window (1,910 and 2,121 checks) sums at most 1,000 rows.
- `.planning/decisions/README.md` is an index-row append shared with most open lanes. Keep the rows ordered by number.
- No other open lane PR touches the calendar gateway, the calendar web files, ADR 0111 or `calendar.md`. Lane tz (F-086) will own `checkBusinessDate` in the same file but in a different function.
- ADR 0090's audit is owed before merge.

## Not covered (CLAUDE.md §0.5)

- **Tuzlu's booth still does not land on its own day.** `checkBusinessDate` files a check under its UTC date. In the month view, the booth's checks (open 19:00Z, closed 01:00Z) show on the NEXT day's panel. In the one-day Day view they show on neither day, because the next day's read windows on `opened_at`. This waits on lane tz (F-086). It is stated in ADR 0287 §Consequences, but this PR does not fix it.
- **Production was not re-measured** (off-limits to this lane). Not checked: whether Tuzlu's `pos_checks.subtotal` is populated (if not, its panels read "net sales not recorded"), the booth totals, and the gross = net + tax + surcharge split.
- **The "net" label rests on each adapter's `subtotal`.** It is unmeasured for Square, Generic and Toast and null for Clover (F2, lane netsales).
- **No Browser-pane or visual check of `TakingsMark`** (CLAUDE.md §9). Coverage is jsdom only. The mark reuses the existing `.cn-record` classes and adds no CSS.
- **No web test pins the exact booth case**: a check with null covers but a net figure. The verifier confirmed it ad hoc (it draws "covers not recorded" beside the net sales) and deleted the test.
- **`check_gateway_boots.sh` was not passing locally**, and tsc shows 3 errors, all because `@simplewebauthn/*` is missing from the shared node_modules. CI is the first real boot check.
- **`check_web_reads_gateway_dto_keys` does not mirror the calendar DTO**, so it proves nothing about the new keys.
- **The pgtest run is vacuous**: 0 migrations and 0 SQL tests. Its template `fb862aa57` predates origin/main `e2cbe426a` (#601 merged after it). The saved output file also ends with a stray `(eval):1: == not found` line from the builder's shell; it is not a test result.
- **Old `prediction_outcomes` rows keep the gross `sales` key.** They were not migrated or backfilled; the new key names the basis so the two cannot be read as one series.
- **ADR 0287's lock covers the founder's three answers.** Decisions 3-5 (the partial-day rule, the currency shape, the payload keys) are this lane's method choices under those answers, as its Status line says.
- **One deviation from the plan.** The plan skipped the currency read for withheld viewers; the build always reads it, because the evidence pair records it. ADR 0287 Decision 6 states this.
- **The 15 pre-existing gateway lint warnings** in the touched files were left as they were.
- **Commit `fd1578ece`'s body is stale.** It still says F1 "is open and blocks the merge"; `3d0083990` superseded that, and a squash merge drops it.
- The coordinator merged `origin/main` (`f5f658934`) in at `db95e8a64` with no conflicts, then re-ran `check_adr_numbers_unique`, `check_od_ids_exist` and `check_decision_claims` (all PASS) before pushing.

## Coordinator note (65fdcdc86)

The CI audit gate escalated `db95e8a64`: ADR 0287's merge-order line said "ADR 0090's audit before merging", which the origin/main ownership classifier reads as a rule about the gate. The sentence restated ADR 0090 and decided nothing here, so `65fdcdc86` removes it (docs only; guards re-run). The merge-order fact, after lane cap, stays.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

