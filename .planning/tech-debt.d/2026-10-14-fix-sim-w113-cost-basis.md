## `restaurant_inventory.last_purchase_price` is read everywhere and written nowhere — OPEN — 2026-10-14

Filed by `fix/sim-w113-cost-basis` (owed from `w111-receiving-basis`; coordinator's call: no writer is invented on that branch). The column (`numeric(10,2)`, baseline `20260805000000_baseline_from_production.sql:3280`) has **no write site** in the gateway, the web app, the orchestrator agents or any migration. The only insert is the demo script `services/agent-orchestrator/demo/demo_ordering_scenario.py:229`, which is not a product path. `apps/api-gateway/src/analytics/inventory-cost.ts:13-18` records that it was NULL on every production row when that file was written. The only trigger on it (`20270110000000_house_tax_basis_and_rates.sql:434-436`) clears its tax basis on a change that never happens.

So no reader may trust it as "what this house last paid". Every reader, and what it does when the column is NULL:

- `apps/api-gateway/src/analytics/inventory-cost.ts:170` (`resolveUnitCost`, used by `analytics.service.ts` and `advanced-analytics.service.ts:197`) — invoice lot WAC first; then this column; else `unknown`. Lot cost already wins.
- `apps/api-gateway/src/analytics/analytics.service.ts:187`, `:634`, `:675` — margin is blocked on NULL ("null blocks margin honestly", `:99`).
- `apps/api-gateway/src/analytics/insights/insight-generator.service.ts:1077` — selects it for insight rows.
- `apps/api-gateway/src/pricing/margin-advice.service.ts:181`, `:326`, `:354`, `:570`, `:645` — a cost basis named `last_purchase_price`, used only with `last_purchase_price_tax_basis` stated; NULL refuses.
- `apps/api-gateway/src/pricing/price-locks.service.ts:242` and `apps/api-gateway/src/beverages/beverages.service.ts:1272` — feed margin advice and cocktail cost the same way.
- `apps/api-gateway/src/communications/scheduled-tasks.service.ts:1273` (`valueInventory`, the weekly report and Monday audit mail) — this column, then `custom_price`, then `negotiated_price`; NULL on all three adds bottles but no value.
- `services/agent-orchestrator/agents/reporting_agent.py:409` (`_unit_cost`, every inventory report's `total_value`) — this column, then `custom_price`, else 0.
- `services/agent-orchestrator/agents/email_intel_agent.py:841-874` — cross-vendor "last price" for a promotion; NULL rows are filtered out, so it returns nothing.
- `apps/api-gateway/src/inventory/inventory.controller.ts:52` — listed in `HOUSE_COST_KEYS`, stripped for staff.

**Not changed, and why.** Today a NULL here only makes a reader fall through or say "unknown"; none shows it as a price. Making the two valuations (`valueInventory`, `_unit_cost`) fall back to the lot cost instead of `custom_price` decides **OD-100** ("What price values inventory?"), which is open and the founder's. That part stopped there. If a stale value from before the baseline is ever found in production, it **would** be shown as a real cost by every reader above: the fix then is a writer (receiving / door verification) or dropping the column, which is one decision.
