---
type: loops
division: product
department: product-vision
team: service-floor
status: provisional
metrics: [floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready, floor.kitchen_ready_to_waiter_p95_seconds, floor.misroute_rate]
updated: 2026-08-24
links: ["[[service-floor-charter]]", "[[service-floor-directive]]", "[[service-floor-premortem]]", "[[service-floor-schedule]]", "[[product-vision-loops]]", "[[pos-bridge-charter]]", "[[partner-alliance-development-charter]]", "[[design-charter]]"]
loop_count: 5
loop_count: 5
loop_ids: ["floor-input-availability", "floor-routing-correctness", "floor-latency-segments", "floor-engagement-integrity", "floor-blocker-commissioning"]
loop_close_times: ["monthly", "per-service", "per-service", "monthly", "monthly"]
loop_statuses: ["proposed", "blocked", "blocked", "blocked", "proposed"]
---

# Service Floor (Floor Checker) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**Four of the five loops below are `blocked`, and every one carries a named unblocker.**
For a NEW team with null inputs that is the honest state. A blocked loop with an unblocker
is a plan; a blocked loop without one is an abandonment
([[service-floor-premortem]] M4).

---

## L1 — Input-availability loop (the only one running today)

```yaml
type: loop
id: floor-input-availability
owner: product-vision
team: service-floor
measures: [floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready]
changes: [floor.v0_scope, pos.capability_flags_requested, floor.stage_gate]
inputs_from: [pos-bridge, engineering]
outputs_to: [pos-bridge, partner-alliance-development, product-vision]
close_time: monthly
status: proposed
baseline: "0 and 0, of 30 registry providers"
```

This is the team's spine until a trigger fires. Its output is not a number for its own sake
— it is the evidence that turns "no POS emits this" into two dated asks. `pos-types.ts`
carries no kitchen-ready concept at all, so the second counter cannot become non-zero
without a `CanonicalCheck` change.

---

## L2 — Routing-correctness loop

```yaml
type: loop
id: floor-routing-correctness
owner: product-vision
team: service-floor
measures: [floor.misroute_rate, floor.ambiguous_routing_fallback_rate, floor.alert_acknowledgment_rate]
changes: [routing.join_freshness_rule, routing.ambiguity_fallback, routing.device_staleness_rule]
inputs_from: [pos-bridge, engineering]
outputs_to: [engineering, design]
close_time: per-service
status: blocked
blocked_on: "table_id and server_name are 0 of 47 rows; no table→server join is populated"
unblocked_by: "one non-simulator provider emitting table_id + server_name (Stage 1 trigger)"
baseline: "unmeasurable"
```

**Close-time is `per-service`, not weekly** — deliberately. This module has no undo, so a
mis-route discovered a week later is discovered after staff already stopped trusting the
alert. `floor.alert_acknowledgment_rate` **within a single shift** is the trust instrument:
decay inside one service is the tell that something mis-routed, even before the mis-route
itself is identified.

---

## L3 — Latency-segment loop

```yaml
type: loop
id: floor-latency-segments
owner: product-vision
team: service-floor
measures: [floor.kitchen_ready_to_waiter_p95_seconds, floor.seg_pos_to_ingest_ms, floor.seg_ingest_to_route_ms, floor.seg_route_to_push_accepted_ms, floor.seg_push_accepted_to_ack_ms]
changes: [routing.transport_choice, floor.latency_budget]
inputs_from: [engineering, reliability-sre]
outputs_to: [engineering, design, product-vision]
close_time: per-service
status: blocked
blocked_on: "no kitchen-ready event exists to start the clock"
unblocked_by: "kitchen-ready modelled in CanonicalCheck and emitted by a non-simulator provider (Stage 2 trigger)"
baseline: "unmeasurable; measurement boundary defined as event → device acknowledgment"
```

The four segments are published separately on purpose. A single end-to-end p95 hides which
hop is slow, and the most likely slow hop
(`push-accepted → acknowledged`) is outside this repo entirely — Expo push, carrier, a phone
in an apron in a basement dining room. If that segment dominates, the answer is a transport
or hardware decision, not a code optimization ([[service-floor-premortem]] M5).

---

## L4 — Engagement-signal integrity loop

```yaml
type: loop
id: floor-engagement-integrity
owner: product-vision
team: service-floor
measures: [floor.check_in_compliance_rate, floor.table_outcome_delta, floor.performance_view_requests]
changes: [floor.engagement_signal_definition, floor.aggregation_level]
inputs_from: [design, analytics-bi]
outputs_to: [product-vision, design, founder]
close_time: monthly
status: blocked
blocked_on: "no check-in data exists"
unblocked_by: "Stage 1 shipping to one real restaurant"
baseline: "unmeasurable"
```

The measure that matters is the **pair**: compliance rate rising while table outcomes do not
change is staff optimizing the measurement, not service improving
([[service-floor-premortem]] M2). `floor.performance_view_requests` is counted from the
first request onward and is an escalation trigger, not a demand signal.

---

## L5 — Blocker-commissioning loop

```yaml
type: loop
id: floor-blocker-commissioning
owner: product-vision
team: service-floor
measures: [floor.open_asks_with_named_counterparty, floor.asks_past_due, floor.close_times_blocked_without_ask]
changes: [pos-types.CanonicalCheck, partner.outreach_queue]
inputs_from: [pos-bridge, partner-alliance-development]
outputs_to: [pos-bridge, partner-alliance-development, decision-office]
close_time: monthly
status: proposed
baseline: "0 asks filed; 2 identified and pending (model the event; get a provider to emit it)"
```

This loop exists because *waiting politely* is a real failure mode for a gated team. Its
third measure — close-times reporting `blocked` with no accompanying ask — is the direct
instrument for [[service-floor-directive]]'s blocked-with-a-name rule, and two consecutive
non-zero readings escalate.
