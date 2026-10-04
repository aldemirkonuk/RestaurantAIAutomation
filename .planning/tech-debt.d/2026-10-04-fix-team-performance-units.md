## The /team Performance card printed a unitless median, literal dollars and a mislabelled wine share (A-048) — FIXED — 2026-10-04

Branch `fix/team-performance-units`, [ADR 0294](../decisions/0294-the-team-performance-card-prints-every-figure-with-its-unit.md). The card printed the house median of sales per cover as a bare "72" under "Average check $186", labelled wine sales over net sales "Wine attach", and blamed "no other server" when the benchmark read failed or the only figures were the member's own. It now prints every money figure in the house's currency through `tm-format`, the member's own sales per cover beside the median, what the median is taken over, and why there is none when there is none. `PerformanceCard.test.tsx` (12) and `performance.service.spec.ts` (11) all fail at `f5f658934` and pass here. The literal `$` rows left `scripts/money_currency_baseline.json`, closing ADR 0215 residual (f).

## server_sales stores a blank figure as 0, so the card cannot tell a blank night from a zero one — OPEN — 2026-10-04

`server_sales.covers`, `net_sales`, `wine_sales` and `checks` are `DEFAULT 0 NOT NULL` (`supabase/migrations/20260805000000_baseline_from_production.sql:5351-5354`), and both ingest routes write `?? 0` (`apps/api-gateway/src/team/performance.service.ts:67-70` and `:154-157`, line numbers on this branch). So *Sales / shift* averages a night typed with no sales in as 0, the average check divides one night's sales by another night's checks, and the wine share reads 0% for a night whose wine was left blank. ADR 0294 works around it for the per-cover figures only (a service counts when `covers > 0 AND net_sales > 0`, M1) and prints an unknown average check or share as the dash (M4). The fix needs nullable columns, a form that sends null for a blank field, and the reads to skip nulls per figure. It is a schema change, left for its own branch.

## /team's window register lists one server-side window, and the member's own read is a second — OPEN — 2026-10-04

`apps/web/src/pages/team/next/useTeamNextData.ts` declares `TEAM_SERVER_WINDOWS` with only `BENCHMARK_SERVICES` (the house's 200 newest). `getMemberPerformance` also reads only the member's last `limit = 6` services (`performance.service.ts:176`, read with `.limit(limit)` at `:202`). The card states the exact count it received ("Over Lucas's last 2 logged services", ADR 0294 M6), so no figure is windowed silently, but the register does not list the second window and `check_windowed_figures.py` cannot see it, because the cap is a parameter, not a literal.

## The per-service per-cover series is sent and printed nowhere — OPEN — 2026-10-04

`analytic.series` (`performance.service.ts:333`) carries one per-cover figure per service, 0 for a service with no covers, and nothing on the web prints it. If a chart ever draws it, a coverless night will draw as a zero night. It should send null for those services first.
