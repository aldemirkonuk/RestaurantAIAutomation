---
type: loops
division: platform
department: reliability-sre
status: provisional
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[reliability-sre-directive]]", "[[reliability-sre-schedule]]", "[[observability-telemetry-plumbing-loops]]", "[[release-engineering-loops]]", "[[runtime-resilience-loops]]", "[[state-integrity-invariants-loops]]", "[[decision-office-charter]]"]
---

# Reliability / SRE — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop ([[ORG_STRUCTURE]] §5).

These four are **department-level** — they exist because no single team can own them
without grading its own work. Team loops live in
[[observability-telemetry-plumbing-loops]], [[release-engineering-loops]],
[[runtime-resilience-loops]], [[state-integrity-invariants-loops]].

---

## L-SRE-1 — Red-signal audit

The direct counter-pressure to [[reliability-sre-premortem]] M3. Its output is a count
published even when it is embarrassing, and it forces a binary: fix within one close-time
or delete the gate.

```yaml
type: loop
id: sre-red-signal-audit
owner: reliability-sre
measures: [ci.gates_red_count, ci.gates_red_consecutive_runs, ci.gates_tolerated_count]
changes: [ci.gate_set, ci.gate_severity, workflows.ci_yml_tolerance_note]
inputs_from: [release-engineering, state-integrity-invariants, engineering]
outputs_to: [engineering, decision-office]
close_time: weekly
status: proposed
```

- **Opening value:** at least one — `.github/workflows/ci.yml:8` documents its own
  tolerance for red on `main`.
- **Escalates when:** a gate is red for two consecutive runs and the proposed close is a
  chat message ([[reliability-sre-directive]] trigger 2).

---

## L-SRE-2 — Signal-liveness audit

The department's own guard against M1. It does not ask what the metrics say; it asks
whether any of them could still be *speaking*.

```yaml
type: loop
id: sre-signal-liveness
owner: reliability-sre
measures: [obs.metrics_with_liveness_twin_pct, obs.metrics_flat_zero_full_period_count, obs.observability_degraded_flag]
changes: [observability.instrumentation_targets, health.degraded_surface, agenda.board_admission]
inputs_from: [observability-telemetry-plumbing, runtime-resilience]
outputs_to: [research-math, analytics-bi, decision-office]
close_time: weekly
status: proposed
```

- **Admission rule:** a metric with no liveness twin is not admitted to
  [[reliability-sre-agenda-board]]. The loop enforces the rule; the board displays it.
- **Root evidence:** `observability.py:53-84` degrades to `NoopMetric` silently.

---

## L-SRE-3 — Recovery-path proving

Covers every path whose *first* use would otherwise be during an incident: restore,
revert, and the `pause_all_writes` kill switch (`orchestrator.py:537`). One loop, because
they fail the same way — untested, then load-bearing.

```yaml
type: loop
id: sre-recovery-path-proving
owner: reliability-sre
measures: [sre.days_since_verified_restore, sre.time_to_revert, sre.days_since_kill_switch_exercised]
changes: [scripts.restore_db_sh, workflows.deploy_yml, orchestrator.kill_switch_runbook]
inputs_from: [release-engineering, runtime-resilience]
outputs_to: [engineering, decision-office, strategy]
close_time: quarterly
status: proposed
```

- **Opening value:** `sre.days_since_verified_restore` has **never had a value**
  ([[reliability-sre-charter]], named gap). The loop's first close is the first value.
- **Why quarterly and not weekly:** a drill that is too frequent gets skipped and becomes
  a lie; quarterly with a date on the calendar is a commitment that can be audited.

---

## L-SRE-4 — Unowned-queue sweep

Three queues in this department accumulate work that nobody is obliged to read:
`queue.dead_letters` (no consumer), `drift_findings` at status `open`, and unanswered
`questions.md` entries. They are one loop because they are one failure: a queue whose
count can only rise.

```yaml
type: loop
id: sre-unowned-queue-sweep
owner: reliability-sre
measures: [sre.dlq_depth_and_oldest_age, integrity.open_findings_count, integrity.open_findings_oldest_age, questions.unanswered_past_close_time]
changes: [resilience.dlq_consumer_policy, integrity.triage_cadence, department.reallocation]
inputs_from: [runtime-resilience, state-integrity-invariants, red-team, architecture-review]
outputs_to: [engineering, decision-office, people-and-agent-ops]
close_time: weekly
status: proposed
```

- **Age, not depth, is the metric.** A DLQ of depth 3 whose oldest message is six weeks
  old is worse than a DLQ of depth 200 that drains hourly.
- **Escalates when:** any of the three counts rises for three consecutive close-times.
  Rising means nobody owns it, which is [[reliability-sre-premortem]] M1 in queue form.

---

## L-SRE-5 — Rejected-team trigger watch

Cheap, and it exists so that two deliberate rejections stay decisions rather than
becoming blind spots.

```yaml
type: loop
id: sre-rejected-team-trigger-watch
owner: reliability-sre
measures: [org.humans_on_pager, sre.triage_share_of_team_capacity, platform.monthly_bill_excl_inference]
changes: [org.team_set]
inputs_from: [observability-telemetry-plumbing, people-and-agent-ops, finance-and-pricing]
outputs_to: [decision-office, strategy]
close_time: quarterly
status: proposed
```

- Incident Command and Infrastructure Cost were rejected on **scale** grounds
  (`technology.md:710-717`), not on principle. This loop watches the two numbers that
  would change the answer, and its only possible output is an entry in `OPEN-DECISIONS.md`.

---

## Close-time summary

| Loop | Close-time | Failure it counters |
|---|---|---|
| L-SRE-1 red-signal audit | weekly | M3 — red normalized |
| L-SRE-2 signal liveness | weekly | M1 — zero looks like calm |
| L-SRE-3 recovery-path proving | quarterly | M2 — first restore is the real one |
| L-SRE-4 unowned-queue sweep | weekly | M1 — queues as oubliettes |
| L-SRE-5 rejected-team trigger watch | quarterly | Scale-dependent rejection becoming dogma |
