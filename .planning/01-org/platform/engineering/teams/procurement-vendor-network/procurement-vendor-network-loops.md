---
type: loops
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.no_touch_reconciliation_rate, procurement.unguarded_money_moving_routes]
updated: 2026-08-24
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-premortem]]", "[[procurement-vendor-network-directive]]", "[[engineering-loops]]", "[[action-safety-the-human-gate-charter|action-safety-the-human-gate]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_ids: ["pv-order-delivery-reconciliation", "pv-money-path-exposure", "pv-price-contract-integrity", "pv-spend-authority-boundary", "pv-vendor-portal-surface"]
loop_close_times: ["weekly", "daily", "weekly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Procurement & Vendor Network — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-PV-1 — Order-to-delivery reconciliation

```yaml
type: loop
id: pv-order-delivery-reconciliation
owner: procurement-vendor-network
measures: [procurement.order_to_delivery_reconciliation_rate, procurement.no_touch_reconciliation_rate, procurement.manual_repair_minutes]
changes: [procurement.matching_rules, vendor_catalogue.match_policy, procurement.receiving_flow]
inputs_from: [inventory-ledger, integration-engineering, dat-pos-telemetry-ingest]
outputs_to: [engineering, unit-economics-pricing, decision-office]
close_time: weekly
status: proposed
```

**Two numbers, never one.** Raw rate and no-touch rate; the gap between them is the labour
the system generates (premortem M2). The loop is meaningless until reconciliation records
carry `manual_intervention`, so its first output is that schema change, not a rate.

---

## L-PV-2 — Money-path exposure watch

```yaml
type: loop
id: pv-money-path-exposure
owner: procurement-vendor-network
measures: [procurement.unguarded_money_moving_routes, procurement.unauthenticated_writes_observed, procurement.public_decorator_on_money_routes]
changes: [ci.public_route_allowlist, procurement.route_guards, alerting.rules]
inputs_from: [platform-api, security]
outputs_to: [platform-api, security, red-team, decision-office]
close_time: daily
status: proposed
```

Counters premortem M1 — the department's single most consequential live exposure: 6
unguarded routes on the module that places automated orders ([[ENDPOINTS]]:428). **Daily**
close-time, because it is exposure rather than debt. Feeds [[engineering-loops]] L-ENG-5.
Runs on logging alone until the platform guard exists; the log is the point.

---

## L-PV-3 — Price-contract integrity

```yaml
type: loop
id: pv-price-contract-integrity
owner: procurement-vendor-network
measures: [procurement.lines_without_price_snapshot, procurement.reconciliations_joining_live_catalogue, procurement.price_change_between_order_and_delivery]
changes: [order_line.schema, procurement.reconciliation_query]
inputs_from: [vendor-catalogue, vendor-intel]
outputs_to: [engineering, unit-economics-pricing]
close_time: weekly
status: proposed
```

Counters premortem M3. Asserts the invariant directly: every order line stores its own
price at creation, and reconciliation reads that field. A price change between order and
delivery must produce a **flag**, not a silent pass — that flag is the only way the system
detects being overcharged.

---

## L-PV-4 — Spend-authority boundary

```yaml
type: loop
id: pv-spend-authority-boundary
owner: procurement-vendor-network
measures: [procurement.spend_capable_paths, procurement.auto_commit_events, procurement.threshold_changes]
changes: [procurement.commit_gates, decisions.open_queue]
inputs_from: [agent-fleet, action-safety-the-human-gate, rfq_agent, procurement_agent]
outputs_to: [action-safety-the-human-gate, red-team, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M4. Enumerates every code path that can cause spend — including agent
paths in `services/agent-orchestrator/agents/` — and asserts each has a human gate owned
by a unit that does not benefit from procurement throughput. A **threshold increase** is a
higher-priority event than a new threshold, because it means the ratchet has started.

---

## L-PV-5 — Vendor portal surface review

```yaml
type: loop
id: pv-vendor-portal-surface
owner: procurement-vendor-network
measures: [procurement.vendor_portal_route_count, procurement.vendor_portal_verified_auth_coverage]
changes: [vendor_portal.auth_mechanism, vendor_portal.route_set]
inputs_from: [integration-engineering, security]
outputs_to: [engineering, security, partnerships]
close_time: monthly
status: proposed
```

Counters premortem M5. `vendor-portal` is 2 unguarded routes and the product's only
outward-facing surface (`supabase/migrations/20260805155901_vendor_portal.sql`). Its
correctness criterion is **verified caller identity**, borrowed from
[[integration-engineering-charter]], not `TenantGuard`. Route-count growth without an
agenda entry escalates.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-PV-1 order-to-delivery reconciliation | weekly | M2 |
| L-PV-2 money-path exposure | **daily** | M1 |
| L-PV-3 price-contract integrity | weekly | M3 |
| L-PV-4 spend-authority boundary | monthly | M4 |
| L-PV-5 vendor portal surface | monthly | M5 |
