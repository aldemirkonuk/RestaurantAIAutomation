## The dashboard month drew $0 paid, dropped events past 1,000, filed days on UTC and had no sales — CLOSED on `fix/dashboard-tells-the-day-true` — 2026-10-03

Filed and closed with [ADR 0290](../decisions/0290-the-dashboard-tells-the-houses-day-true.md) (PR-1 of lane `dash`). The defects were found by the owner-quarter analytics walk on 2026-10-03, in `GET /dashboard/calendar-revenue/:id`, which `SalesCalendar` draws.

- **C18 (A-036, F-156).** The deliveries read selected `procurement_orders.wine_name`, a column the table does not have. PostgREST refused the read, the method did not read `error`, and every day drew $0 paid to vendors: Oct 2 showed $0 against $39,302.50 delivered. Fix: the read names the six columns it uses and goes through `readAll`, which throws on error.
- **AW12 (A-042).** The month's `calendar_events` read was `select('*')` with no paging, so PostgREST's 1,000-row cap dropped rows without a word. Fix: five named columns, keyset paging, and a throw on error.
- **AW21 (A-023).** The page is a sales calendar but had no sales source. Fix: net sales come from `pos_checks.subtotal` with `voided = false`, filed on the house's day and shown only to roles that see `sales`.
- **F-086 on this route.** Days were cut on the UTC prefix of a timestamp. Fix: they are cut with `localDateIn` in the house zone. A house with no zone gets `null` figures and a line linking to settings, never a UTC fallback.

Checked by `claims.d/fix-dashboard-tells-the-day-true.jsonl` (six resolved rows) and by `apps/api-gateway/src/dashboard/dashboard-month-days.spec.ts`: 28 tests, all red on `8c673db4b`. `scripts/read_error_baseline.json` drops the route's two rows, from 151 to 149 sites.

## What ADR 0290's first PR leaves owed on the dashboard — OPEN — 2026-10-03

Line numbers are at this branch's head.

- **AW04, PR-2** (`fix/dashboard-alert-says-when-it-went-low`). `getAlerts` stamps every low-stock alert with `new Date()` (`apps/api-gateway/src/dashboard/dashboard.service.ts:1053`), so each one reads "just now". The claim row `ADR-0290-AW04-LOW-SINCE-OPEN` is open and fails until that PR lands. OD-161 (an uncounted wine reads as out of stock) is a separate defect and is not touched here.
- **Moved to PR-2 to keep PR-1 at 15 files:**
  - the reason text for `procurement_orders.wine_name` in `scripts/check_read_columns_exist.py:177`. The entry stays, because `communications.controller.ts` still reads the column; only the text naming the dashboard is stale.
  - the denominator in `.planning/03-scenarios/DELIVERY-AUDIT.md` §6 (`:135`), which still reads 151 and should read 149.
- **The rest of the dashboard summary.** The upcoming-events read (`dashboard.service.ts:489`) is still `select('*')`, and its "next 7 days" window is cut on the UTC date. The notifications read (`:390`) is also `select('*')`. Neither is the month route, so both are outside AW12 and DASH-G2's PR-1 scope.
- **Carried by #579 (F4 (a)).** AW19's remainder (the unbounded stats read and the no-zone rule on the tiles), C13, F5's "settled deliveries" tile label, and the vendor-spend role gate (W22) all land as a follow-up on #579 when it unpauses. #579 must rebase onto this branch.
- **Clover reads "—" for net sales.** Its adapter writes `subtotal: null` (`apps/api-gateway/src/pos-hub/pos-adapters.ts:159`), and ADR 0290 files a day with any unstated subtotal as unknown. The adapter's basis belongs to lane netsales (AW17).
- **Two net-sales folds now exist.** The dashboard's `netSalesByHouseDay` is net and zoned; `RecordedDaysService` is gross and UTC. Whichever of lanes caltakings and netsales lands next should converge them.
- **The F1 sketch.** A render of the no-zone month, which production's one real house will show until a zone is set, is owed to the founder before this branch merges.
