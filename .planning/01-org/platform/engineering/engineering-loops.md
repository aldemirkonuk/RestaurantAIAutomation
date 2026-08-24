---
type: loops
division: platform
department: engineering
status: provisional
metrics: [identity.false_merge_count, inventory.projection_divergence_rows, platform.endpoints_protected_by_default_pct, schema.days_since_hand_applied_ddl, integration.verified_signature_coverage]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[engineering-premortem]]", "[[engineering-directive]]", "[[catalogue-identity-loops]]", "[[inventory-ledger-loops]]", "[[procurement-vendor-network-loops]]", "[[messaging-delivery-loops]]", "[[client-surfaces-loops]]", "[[platform-api-loops]]", "[[integration-engineering-loops]]", "[[schema-migrations-loops]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["eng-wrongness-board", "eng-seam-arbitration", "eng-guard-outcome-reconciliation", "eng-irreversible-class-review", "eng-public-surface-exposure"]
loop_close_times: ["weekly", "weekly", "monthly", "monthly", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Engineering — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Department-level loops are deliberately few. Engineering's real loops live in the eight
teams; the five here exist because they **cross** teams, and premortem M1 says the
crossings are where failure hides.

---

## L-ENG-1 — The eight-wrongness board

```yaml
type: loop
id: eng-wrongness-board
owner: engineering
measures: [identity.false_merge_count, inventory.projection_divergence_rows, procurement.order_to_delivery_reconciliation_rate, messaging.duplicate_delivery_rate, surfaces.reachable_route_ratio, platform.endpoints_protected_by_default_pct, integration.verified_signature_coverage, schema.days_since_hand_applied_ddl]
changes: [engineering.team_allocation, engineering.agenda_board]
inputs_from: [catalogue-identity, inventory-ledger, procurement-vendor-network, messaging-delivery, client-surfaces, platform-api, integration-engineering, schema-migrations]
outputs_to: [platform, decision-office]
close_time: weekly
status: proposed
```

Eight numbers, never summed. If a team's number is unreadable, the loop records
*unreadable* rather than omitting it — an omitted metric reads as green.

---

## L-ENG-2 — Seam arbitration

```yaml
type: loop
id: eng-seam-arbitration
owner: engineering
measures: [engineering.open_seam_questions, engineering.seam_question_age_days]
changes: [engineering.seam_ownership, decisions.open_queue]
inputs_from: [catalogue-identity, inventory-ledger, procurement-vendor-network, messaging-delivery, client-surfaces, platform-api, integration-engineering, schema-migrations, data, reliability-sre, ai-orchestration, security, design, partnerships]
outputs_to: [decision-office, red-team]
close_time: weekly
status: proposed
```

Any `questions.md` entry naming two units and answered by neither. Closes weekly by
assigning the left-of-seam team (`technology.md:857-865`) or escalating to
`OPEN-DECISIONS.md`. This is the direct counter-pressure to premortem M1.

---

## L-ENG-3 — Guard-versus-outcome reconciliation

```yaml
type: loop
id: eng-guard-outcome-reconciliation
owner: engineering
measures: [engineering.grep_guards_without_outcome_twin, inventory.projection_divergence_rows, identity.false_merge_count]
changes: [ci.guard_set, engineering.agenda_full]
inputs_from: [inventory-ledger, catalogue-identity, schema-migrations, reliability-sre]
outputs_to: [platform-api, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M4. For each grep-shaped guard — `scripts/check_no_direct_stock_writes.sh:1-13`,
`scripts/check_no_guest_name_matching.sh`, `scripts/check_schema_parity.sh:6-11` — assert
that an **outcome-side** measurement exists and agrees. Green guard plus divergent data is
the alarm state, and only this loop can see it.

---

## L-ENG-4 — Irreversible-class review

```yaml
type: loop
id: eng-irreversible-class-review
owner: engineering
measures: [schema.days_since_hand_applied_ddl, identity.merge_undo_invocations, messaging.duplicate_delivery_rate]
changes: [engineering.directive, schema.migration_policy]
inputs_from: [schema-migrations, catalogue-identity, messaging-delivery]
outputs_to: [reliability-sre, architecture-review, decision-office]
close_time: monthly
status: proposed
```

The three artifact classes a revert does not undo: a merge, a migration, a sent message.
Reviews every instance, not a sample. A month with zero instances is a valid, recorded
outcome — this loop is allowed to be boring.

---

## L-ENG-5 — Public-surface exposure

```yaml
type: loop
id: eng-public-surface-exposure
owner: engineering
measures: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes, integration.verified_signature_coverage, platform.public_decorator_count]
changes: [platform.guard_mechanism, integration.signature_policy, ci.public_route_allowlist]
inputs_from: [platform-api, integration-engineering, procurement-vendor-network, messaging-delivery]
outputs_to: [security, red-team, decision-office]
close_time: weekly
status: proposed
```

Counters premortem M2. Tracks the two numbers **side by side**, because
"routes carrying the global guard" can reach 100% while "unguarded reachable routes" is
flat. Weekly because the 137 unguarded endpoints and the 6 unguarded `recurring-orders`
routes ([[ENDPOINTS]]:428) are live exposure, not debt.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-ENG-1 eight-wrongness board | weekly | metric drift, silent unreadability |
| L-ENG-2 seam arbitration | weekly | premortem M1 |
| L-ENG-3 guard/outcome reconciliation | monthly | premortem M4 |
| L-ENG-4 irreversible-class review | monthly | premortem M3, identity loss |
| L-ENG-5 public-surface exposure | weekly | premortem M2 |
