---
type: loops
division: platform
department: engineering
team: inventory-ledger
status: provisional
metrics: [inventory.projection_divergence_rows, inventory.direct_write_paths, inventory.ledger_v1_callers]
updated: 2026-08-24
links: ["[[inventory-ledger-charter]]", "[[inventory-ledger-premortem]]", "[[inventory-ledger-directive]]", "[[engineering-loops]]", "[[state-integrity-invariants-charter|sre-state-integrity]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_ids: ["il-projection-divergence", "il-guard-outcome-reconciliation", "il-ledger-v1-caller-census", "il-cross-hop-duplication", "il-count-adjustment-provenance"]
loop_close_times: ["daily", "weekly", "fortnightly", "weekly", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Inventory & Ledger — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-IL-1 — Daily projection divergence

```yaml
type: loop
id: il-projection-divergence
owner: inventory-ledger
measures: [inventory.projection_divergence_rows, inventory.divergent_lot_ids]
changes: [inventory.write_paths, ci.guard_set, inventory.incident_queue]
inputs_from: [procurement-vendor-network, integration-engineering, dat-pos-telemetry-ingest]
outputs_to: [engineering, sre-state-integrity, decision-office]
close_time: daily
status: proposed
```

The team's spine. Rows where `stock_live` ≠ sum of lots. **Any non-zero is P1**
(`technology.md:119-120`), resolved within one close-time or escalated. Deliberately the
cheapest possible implementation first — one query, one number — because premortem M2 says
an unread metric makes every other mechanism unfalsifiable.

---

## L-IL-2 — Guard/outcome reconciliation

```yaml
type: loop
id: il-guard-outcome-reconciliation
owner: inventory-ledger
measures: [inventory.direct_write_paths, inventory.guard_pass_rate, inventory.projection_divergence_rows]
changes: [ci.guard_set, guard.coverage_scope]
inputs_from: [schema-migrations, sre-state-integrity]
outputs_to: [engineering, platform-api]
close_time: weekly
status: proposed
```

Counters premortem M1. Explicitly watches for the **alarm state**: green guard,
non-zero divergence. Also tracks whether the guard's scope has been extended past
TypeScript into `supabase/migrations/**` function bodies, which is where
`scripts/check_no_direct_stock_writes.sh:10` admits it cannot look.

---

## L-IL-3 — Ledger v1 caller census

```yaml
type: loop
id: il-ledger-v1-caller-census
owner: inventory-ledger
measures: [inventory.ledger_v1_callers, inventory.ledger_v1_new_call_sites]
changes: [inventory.deprecation_schedule, inventory-ledger.removal_date]
inputs_from: [client-surfaces, procurement-vendor-network, agent-fleet]
outputs_to: [engineering, decision-office]
close_time: fortnightly
status: proposed
```

Counters premortem M3. The deliverable is a **falling number**, not a document —
`apps/api-gateway/src/inventory-ledger/LEDGER_V1_DEPRECATED.md` already exists and did not
prevent anything on its own. A single new call site after the deprecation date escalates;
a flat count for two close-times forces either an honest un-deprecation or a removal date.

---

## L-IL-4 — Cross-hop movement duplication

```yaml
type: loop
id: il-cross-hop-duplication
owner: inventory-ledger
measures: [inventory.duplicate_movements_per_origin_event, inventory.movements_missing_origin_id]
changes: [inventory.idempotency_key_derivation, movement.record_schema]
inputs_from: [integration-engineering, messaging-delivery]
outputs_to: [engineering, integration-engineering, messaging-delivery, decision-office]
close_time: weekly
status: proposed
```

Counters premortem M4. Until movement records carry the originating external event id,
this loop's honest reading is `movements_missing_origin_id = all of them` — which is
itself the finding. Cross-hop duplicates cannot be fixed inside this team's code, so the
loop's output is a **seam decision**, routed per [[engineering-directive]] with this team
accountable.

---

## L-IL-5 — Count adjustment provenance

```yaml
type: loop
id: il-count-adjustment-provenance
owner: inventory-ledger
measures: [inventory.adjustments_without_movement, inventory.count_reconciliation_delta]
changes: [inventory_count_service.write_path, inventory.adjustment_policy]
inputs_from: [agent-fleet, client-surfaces]
outputs_to: [engineering, dat-substrate-quality]
close_time: weekly
status: proposed
```

Counters premortem M5. Every adjustment produced by
`services/agent-orchestrator/services/inventory_count_service.py` or
`agents/inventory_engine.py` must have a matching movement row. **One violation is the
finding** — this is not a trend metric, because a reconciliation path that writes directly
is dual bookkeeping wearing a new name.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-IL-1 projection divergence | daily | M2, and detects M1/M5 by construction |
| L-IL-2 guard/outcome reconciliation | weekly | M1 |
| L-IL-3 ledger v1 caller census | fortnightly | M3 |
| L-IL-4 cross-hop duplication | weekly | M4 |
| L-IL-5 count adjustment provenance | weekly | M5 |
