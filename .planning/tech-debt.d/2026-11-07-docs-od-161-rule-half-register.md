## OD-161 rule half: low-stock readers that do not use the view still read an uncounted wine as zero — OPEN — 2026-11-07

Filed by `docs/od-161-rule-half-register`, the companion of `fix/uncounted-wine-is-not-low-stock` (menu upload Phase 1A step 1l, OD-161 in `../decisions/OPEN-DECISIONS.md`). Split out of that branch to keep its diff under the audit gate's size wall; it describes that branch, so it is true only once that branch is merged.

**What that branch changed.** `v_low_stock_items` keeps only rows with `last_counted_at` set (migration `an_uncounted_wine_is_not_low_stock`). The dashboard's "Out of Stock" alert read and its summary `criticalCount`/`healthyCount` (`apps/api-gateway/src/dashboard/dashboard.service.ts`), and the gateway's /inventory summary bands (`apps/api-gateway/src/inventory/inventory.service.ts`, `getInventorySummary`), leave never-counted rows out. Every gateway reader of the view follows it, including both digests (`scheduled-tasks.service.ts` through `DatabaseService.getLowStockItems`, and `notifications/low-stock-alerts.service.ts`).

**What is still true.** These compute their own below-par or out-of-stock answer from `restaurant_inventory` and do not read `last_counted_at`, so a never-counted row at `stock_live` 0 still counts as below par or out of stock there:

- `apps/api-gateway/src/ask-readings/reading-runner.ts:75-80` (`inventory.low_stock` reading);
- `apps/api-gateway/src/procurement/pending-order-priority.ts:115-130` (`live <= 0` returns true before any par test);
- `services/agent-orchestrator/core/database.py:1017-1043` (`get_low_stock`, used by `get_low_stock_items` at `:1921`) and `services/agent-orchestrator/agents/inventory_engine.py:461-487` (`_calculate_inventory_state`);
- the /inventory page. `apps/web/src/pages/inventory/next/InventoryRoute.tsx` draws InventoryNext when the house's `mudavym_design_inventory_next` is on, and its standing is `standingOf` (`apps/web/src/pages/inventory/next/useInventoryNextData.ts:133-139`), where `stock <= 0` is `out` before any par test. The command page it draws otherwise uses `classifyStock` (`apps/web/src/lib/inventoryStatus.ts:93`). So the page can show a never-counted wine at 0 as out while the gateway summary counts it as unknown;
- the demo report scripts under `services/agent-orchestrator/demo/`.

**Not done.** The look (MU-1): whether the dashboard and /inventory say "not counted yet" for such a wine. It needs a web change and an answer, so the fix branch leaves the wine absent from alerts. How many production rows are affected is unmeasured (neither branch read production).

**A founder question, not decided.** `last_counted_at` is stamped only by `record_stock_count()`. A wine whose stock came only from receipts or sales and was never counted is now also left out of the view, so it raises no low-stock alert until it is counted once. If a receipt or a sale should make a wine known, the view's predicate changes.

**What closes it.** Each reader above applies the same `last_counted_at` test (or reads the view), MU-1 is answered and built, and the founder question above is answered.
