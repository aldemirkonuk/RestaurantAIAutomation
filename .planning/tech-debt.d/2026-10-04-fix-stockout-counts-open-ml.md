## A stockout risk ranked how the data was loaded, not how the wine sells (AW29 / A-025) — FIXED — 2026-10-04

Branch `fix/stockout-counts-open-ml`, [ADR 0299](../decisions/0299-stockout-risk-counts-the-open-bottle-and-needs-a-measured-history.md). Stacked on ADR 0272 (#602, on `main`).

"What to buy back" listed eight Tuzlu wines at exactly 61%, Pierre Ferrand first with 45 days of cover, and the insight printed "Jameson Irish Whiskey ranks #1 of 134 by stockout risk (61.0%). Only 0 bottles on hand". There were two causes. On hand ignored the open bottle, so 950 of 1,000 ml read 0. And every series held one import day (F-129), so every series had CV √90 and every empty wine read 0.6098. On hand now counts `inventory_lot_rollup.open_ml`. A wine sold on fewer than 14 days in the window gets no risk, reorder point, safety stock or CV. Proven by `apps/api-gateway/src/analytics/stockout-counts-open-ml.spec.ts` (13 of 14 cases fail before the fix) and by the claims rows in `claims.d/fix-stockout-counts-open-ml.jsonl`.

- **OWED: the follow-up branch.** The founder answered the list's order (*"Soonest to run out (Recommended)"*) and ADR 0272 fork 3 (*"Out of both, say a count"*) on 2026-10-04. Neither is built here. Both go on a follow-up branch stacked on this one, which amends ADR 0272 Decision 4, its two claims rows, the server cut (`analytics.service.ts`, `reorderList: E.cutKeepingTies(`) and the web bars and table (`rp-registers-house.tsx`). [2026-10-06: that branch is open as #624, `fix/what-to-buy-back-runs-out-first`; not on `main`.]
- **Residual: a mixed series.** A series that mixes legacy one-day rows with newly dated sales passes the 14-day floor with its swing distorted until lane postime's F2 re-dating runs (ADR 0281, the founder's open call). [2026-10-06: answered, built and run since: #647 ran on production on 2026-10-05 (ADR 0281, F2 amendment). A row it cannot tie to exactly one closed, readable check keeps its import date, so the residual can still occur; Tuzlu's series were not re-measured here.]

## /inventory's days of cover still counts sealed bottles only — OPEN — 2026-10-04

`inventory.service.ts:233-235` reads `days_of_cover` from the `inventory_analytics` view. The view's on hand is `COALESCE(r.live_qty, 0)` from `inventory_lot_rollup` (`supabase/migrations/20260805000000_baseline_from_production.sql:3344`), and its `days_of_cover` divides that by velocity (`:3375-3377`). The open bottle is not counted there either, so /inventory and "What to buy back" can now disagree about the same wine's cover by up to one bottle's worth. Fixing it is a view migration; it was outside this lane, which changed no SQL.

## Two rules for an unstated bottle size — OPEN — 2026-10-04

`inventory.service.ts:80-82` takes the row's `bottle_size_ml`, then `master_wine_library.bottle_size_ml`, then 750. The writer, `record_glass_pour`, takes the row's size and then 750 and never reads the library (`supabase/migrations/20261217112500_a_short_pour_opens_the_next_bottle.sql:102`; [2026-10-06: since #603 the writer is defined by `20261222100000_a_pos_sale_is_dated_by_its_check.sql`, with the same rule at `:318`]). ADR 0299 reads open ml back at the writer's size. The two agree today only because the library holds 750 on every row ([ADR 0124](../decisions/0124-a-bottle-has-one-identity-and-every-price-names-it.md):91). ADR 0115's bottle-size work (AW15) owns which rule is right.

## The insight's sealed count is not the register's — OPEN — 2026-10-04

The stockout #1 insight takes sealed bottles from `restaurant_inventory.stock_live` (`insight-generator.service.ts`, `computeInventoryFamily`). The reorder register takes `inventory_lot_rollup.live_qty` first and falls back to `stock_live` (`analytics.service.ts`, `loadInventory`). When the lots and `stock_live` disagree, the two can rank the same wine on different counts. ADR 0299 kept each site's sealed source and added the same open ml to both; unifying the sealed source is a separate change.

## A failed rollup read degrades two sites and silences the third — OPEN — 2026-10-04

When the `inventory_lot_rollup` read fails, the reorder register (`analytics.service.ts`, `loadInventory`) and Wine-360 (`advanced-analytics.service.ts`) log it and fall back to `stock_live` with no open ml, so for that read their on hand carries the open-bottle gap that ADR 0299 closed. The stockout #1 insight is silent instead (`readOpenMl` returns null). The fallback was already there for the sealed count; ADR 0299 records the asymmetry and does not unify it.

## The open-ml reads keep one rollup row per inventory row and read one page — OPEN — 2026-10-06

`inventory_lot_rollup` groups by `inventory_id, restaurant_id, master_wine_id` (`supabase/migrations/20260902150000_lot_cost_truth.sql`, the view's `GROUP BY`). Where one inventory row's lots name two different wines, the view returns two rows for it. The register (`analytics.service.ts`, `loadInventory`), Wine-360 (`advanced-analytics.service.ts`) and the insight's `readOpenMl` (`insight-generator.service.ts`) all key the rows by `inventory_id` and keep the last one, so `open_ml` is that row's, not the sum; the register and Wine-360 already did this for the sealed count. None of the three reads is paged, so a house with more rollup rows than `max_rows = 1000` (`supabase/config.toml`) reads part of it. Both were noted in the review of #619 and left as residuals.
