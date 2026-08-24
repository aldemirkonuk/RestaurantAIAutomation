---
type: loops
division: platform
department: reliability-sre
team: runtime-resilience
status: provisional
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.retry_amplification_factor, resilience.buffer_evictions]
updated: 2026-08-24
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-directive]]", "[[reliability-sre-loops]]", "[[observability-telemetry-plumbing-loops]]", "[[state-integrity-invariants-loops]]"]
loop_count: 5
loop_count: 5
loop_ids: ["res-dead-letter-drain", "res-circuit-breaker-health", "res-retry-budget", "res-backpressure-eviction", "res-degradation-control-readiness"]
loop_close_times: ["weekly, immediate when oldest exceeds one close-time", "weekly", "monthly, immediate during a dependency incident", "monthly, immediate on any stock or money eviction", "quarterly, riding the department's L-SRE-3"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Runtime Resilience — Loops

Every loop names its close-time ([[ORG_STRUCTURE]] §5). All five depend on
[[observability-telemetry-plumbing-charter]]'s emission path being alive — if it is not,
every measure here reads zero and zero looks like health.

---

## L-RES-1 — Dead-letter drain

The team's primary loop, and the one that does not exist at all today.

```yaml
type: loop
id: res-dead-letter-drain
owner: runtime-resilience
measures: [sre.dlq_depth_and_oldest_age, resilience.dlq_messages_replayed, resilience.dlq_messages_discarded_with_reason, resilience.dlq_messages_touching_money_or_stock]
changes: [message_bus.dlq_consumer, base_agent.dlq_policy, runbook.dlq_triage]
inputs_from: [harness-runtime, agent-fleet, messaging-delivery, observability-telemetry-plumbing]
outputs_to: [state-integrity-invariants, engineering, reliability-sre]
close_time: weekly, immediate when oldest exceeds one close-time
status: proposed
```

- **Age of oldest is the primary measure**, not depth (`technology.md:799-800`).
- Opening state: `queue.dead_letters` is declared (`message_bus.py:505-533`) and counted
  into (`:771,817,824,830`) with **no consumer**.
- The fourth measure exists so the human-gate rule is auditable rather than assumed.

---

## L-RES-2 — Circuit-breaker health

```yaml
type: loop
id: res-circuit-breaker-health
owner: runtime-resilience
measures: [resilience.circuit_open_duration, resilience.circuit_open_to_closed_transitions, resilience.circuit_reopen_after_probe_count]
changes: [message_bus.circuit_breaker_config, dependency.timeout_policy]
inputs_from: [integration-engineering, model-routing-inference-economics, observability-telemetry-plumbing]
outputs_to: [engineering, product-and-vision, reliability-sre]
close_time: weekly
status: proposed
```

- A breaker with **zero open→closed transitions** across a period is a feature quietly
  switched off; that is the measure that catches M2 before the duration metric does.
- Escalation goes to the **owning feature's team** — whether a degraded feature is
  acceptable is a product decision, not an infrastructure one.

---

## L-RES-3 — Retry budget

```yaml
type: loop
id: res-retry-budget
owner: runtime-resilience
measures: [resilience.retry_amplification_factor, resilience.outbound_attempts_per_task, resilience.rate_limited_responses_retried_count]
changes: [base_agent.retry_policy, rabbitmq_bridge.connect_with_retry, vendor_sdk.retry_config]
inputs_from: [integration-engineering, messaging-delivery, model-routing-inference-economics]
outputs_to: [engineering, reliability-sre]
close_time: monthly, immediate during a dependency incident
status: proposed
```

- `resilience.rate_limited_responses_retried_count` has a **hard target of zero**: a 429 is
  a stop signal, never a retryable error. That single rule converts amplification back into
  backoff.
- The loop's real deliverable is a written list: for each outbound path, **which layer owns
  the retry**. Nested retries multiply; the list is the fix.

---

## L-RES-4 — Backpressure and eviction

```yaml
type: loop
id: res-backpressure-eviction
owner: runtime-resilience
measures: [resilience.buffer_evictions, resilience.evictions_by_payload_class, resilience.evictions_by_hour_of_day]
changes: [buffer_manager.window_policy, buffer_manager.non_evictable_classes]
inputs_from: [inventory-ledger, pos-operational-telemetry-ingest, observability-telemetry-plumbing]
outputs_to: [state-integrity-invariants, engineering, reliability-sre]
close_time: monthly, immediate on any stock or money eviction
status: proposed
```

- **`evictions_by_hour_of_day` is not a capacity statistic** — an eviction peak at 19:00 on
  a Friday is a statement about which customers were affected.
- Stock and money become non-evictable and route to the DLQ (L-RES-1) instead of being
  dropped, which is where M4 hands off to M1.

---

## L-RES-5 — Degradation-control readiness

```yaml
type: loop
id: res-degradation-control-readiness
owner: runtime-resilience
measures: [sre.days_since_kill_switch_exercised, resilience.kill_switch_runbook_answers_resume_questions]
changes: [orchestrator.pause_all_writes_runbook, orchestrator.emergency_flush_policy]
inputs_from: [release-engineering, observability-telemetry-plumbing]
outputs_to: [reliability-sre, decision-office]
close_time: quarterly, riding the department's L-SRE-3
status: proposed
```

- The second measure is a boolean checklist, not a metric: does the runbook answer *how
  long can we stay paused*, *what happens to the buffer*, *in what order do things resume*,
  and *what does `emergency_flush_buffer` do to a 40-minute backlog*? Today all four are
  unanswered.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-RES-1 dead-letter drain | weekly / immediate on age | M1 |
| L-RES-2 circuit-breaker health | weekly | M2 |
| L-RES-3 retry budget | monthly / immediate in an incident | M3 |
| L-RES-4 backpressure and eviction | monthly / immediate on stock or money | M4 |
| L-RES-5 degradation-control readiness | quarterly | M5 |
