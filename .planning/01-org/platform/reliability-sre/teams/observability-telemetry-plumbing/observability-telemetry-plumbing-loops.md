---
type: loops
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: provisional
metrics: [nf_a.emission_coverage, obs.decision_log_join_rate, obs.metrics_with_liveness_twin_pct]
updated: 2026-08-24
links: ["[[observability-telemetry-plumbing-charter]]", "[[observability-telemetry-plumbing-directive]]", "[[reliability-sre-loops]]", "[[neural-footprint-instrumentation-charter]]", "[[harness-runtime-charter]]"]
loop_count: 5
loop_count: 5
loop_ids: ["obs-nf-a-emission-coverage", "obs-signal-liveness", "obs-error-capture-fidelity", "obs-triage-displacement", "obs-health-surface-truthfulness"]
loop_close_times: ["weekly", "hourly detection / weekly review", "monthly", "weekly, escalating after 3 consecutive close-times", "monthly, plus after every incident"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Observability & Telemetry Plumbing — Loops

Every loop names its close-time ([[ORG_STRUCTURE]] §5).

---

## L-OBS-1 — NF-A emission coverage

The team's primary loop. Denominator is **agent tasks**; an event missing any tuple field
scores zero, not partial credit.

```yaml
type: loop
id: obs-nf-a-emission-coverage
owner: observability-telemetry-plumbing
measures: [nf_a.emission_coverage, obs.decision_log_join_rate, nf_a.tuple_fields_missing_top3]
changes: [observability.instrumentation_targets, base_agent.log_decision_payload, api_spend.correlation_id]
inputs_from: [harness-runtime, agent-fleet, model-routing-inference-economics, neural-footprint-instrumentation]
outputs_to: [research-math, people-and-agent-ops, analytics-bi, reliability-sre]
close_time: weekly
status: proposed
```

- **Opening value: not computable.** `decision_log` and `api_spend` cannot be joined per
  task (`technology.md:745-746`). `obs.decision_log_join_rate` must move first.
- **Third measure exists for a reason:** naming the top three missing tuple fields turns a
  flat percentage into a work queue.

---

## L-OBS-2 — Signal liveness

Counter-pressure to [[observability-telemetry-plumbing-premortem]] M1. Its close-time is
deliberately short — a liveness loop that closes weekly can be blind for six days.

```yaml
type: loop
id: obs-signal-liveness
owner: observability-telemetry-plumbing
measures: [obs.metrics_with_liveness_twin_pct, obs.heartbeat_gauge_present, obs.metrics_flat_zero_full_period_count]
changes: [observability.noop_fallback_log_level, health.observability_degraded_flag, agenda.board_admission]
inputs_from: [release-engineering, runtime-resilience]
outputs_to: [reliability-sre, engineering, analytics-bi]
close_time: hourly detection / weekly review
status: proposed
```

- **Detection is hourly** (heartbeat absent → alert); **review is weekly** (which metrics
  still lack a twin). One loop, two clocks, both named.
- Root cause it watches: `observability.py:53-84` no-op fallbacks, logged at INFO (`:50`).

---

## L-OBS-3 — Error-capture fidelity

Does what reaches Sentry match what actually broke? A capture path can be alive and still
be systematically missing a class of failure.

```yaml
type: loop
id: obs-error-capture-fidelity
owner: observability-telemetry-plumbing
measures: [obs.errors_captured_vs_reported_ratio, obs.unhandled_paths_without_capture, obs.pii_attributes_found_count]
changes: [error-tracking.capture_boundaries, tracing.attribute_allowlist]
inputs_from: [client-surfaces, platform-api, compliance]
outputs_to: [engineering, compliance, reliability-sre]
close_time: monthly
status: proposed
```

- `obs.pii_attributes_found_count` has a **hard target of zero** and is the M5 tripwire;
  a non-zero value stops emission on that path the same day
  ([[observability-telemetry-plumbing-directive]] trigger 5).

---

## L-OBS-4 — Triage-vs-instrumentation balance

The M3 loop. It measures the team's own displacement, which no other unit can see.

```yaml
type: loop
id: obs-triage-displacement
owner: observability-telemetry-plumbing
measures: [obs.triage_volume, obs.triage_share_of_capacity, nf_a.emission_coverage_delta]
changes: [team.time_box, department.reallocation, org.incident_command_trigger_status]
inputs_from: [reliability-sre, runtime-resilience, state-integrity-invariants]
outputs_to: [reliability-sre, decision-office, people-and-agent-ops]
close_time: weekly, escalating after 3 consecutive close-times
status: proposed
```

- **Escalation is written into the close-time**, not left to judgement: three close-times
  of triage-up / coverage-flat forces a department decision, and a second occurrence
  reopens the Incident Command question ([[reliability-sre-charter]]).

---

## L-OBS-5 — Health-surface truthfulness

`AdminHealth.tsx`, `health-proxy.controller.ts` and `scripts/health-check.sh` are what a
human looks at. This loop asks whether they were right.

```yaml
type: loop
id: obs-health-surface-truthfulness
owner: observability-telemetry-plumbing
measures: [obs.health_green_during_confirmed_incident_count, obs.health_check_coverage_of_dependencies]
changes: [health.checks, health.dependency_list]
inputs_from: [runtime-resilience, release-engineering]
outputs_to: [reliability-sre, engineering]
close_time: monthly, plus after every incident
status: proposed
```

- **The measure that matters is retrospective:** how often the health surface was green
  while something was genuinely broken. One occurrence is a finding, not a statistic.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-OBS-1 emission coverage | weekly | M2, M4 |
| L-OBS-2 signal liveness | hourly detect / weekly review | M1 |
| L-OBS-3 error-capture fidelity | monthly | M5 |
| L-OBS-4 triage displacement | weekly, escalating at 3 | M3 |
| L-OBS-5 health-surface truthfulness | monthly + post-incident | M1 |
