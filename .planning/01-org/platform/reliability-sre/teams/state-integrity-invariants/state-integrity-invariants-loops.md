---
type: loops
division: platform
department: reliability-sre
team: state-integrity-invariants
status: provisional
metrics: [sre.mttd_silent_corruption, integrity.open_findings_count, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
updated: 2026-08-24
links: ["[[state-integrity-invariants-charter]]", "[[state-integrity-invariants-directive]]", "[[reliability-sre-loops]]", "[[schema-migrations-charter]]", "[[inventory-ledger-charter]]", "[[access-control-tenant-isolation-charter]]"]
---

# State Integrity & Invariants — Loops

Every loop names its close-time ([[ORG_STRUCTURE]] §5). One of these has a close-time
measured in minutes, and that asymmetry is the team's central design claim: **severity is
structural, not a column.**

---

## L-INT-1 — Tenant-leakage response

Deliberately first, deliberately alone, deliberately out of band. It shares no cadence, no
queue, and no routing with anything else this team owns.

```yaml
type: loop
id: int-tenant-leakage-response
owner: state-integrity-invariants
measures: [integrity.tenant_leakage_detections, integrity.tenant_leakage_time_to_human_minutes, integrity.cross_tenant_probe_coverage]
changes: [orchestrator.write_pause_decision, access_control.policy, alerting.out_of_band_path]
inputs_from: [access-control-tenant-isolation, platform-api, observability-telemetry-plumbing]
outputs_to: [security, compliance, legal, decision-office, reliability-sre]
close_time: minutes — immediate, out of band, never queued
status: proposed
```

- `state_invariant_enforcer.py:1-30` already **detects** tenant leakage. What does not exist
  is a route that is different in kind from a drift finding.
- The response policy — stop writes (`orchestrator.py:537`) vs. alert-and-continue — is a
  founder decision made **before** the first detection ([[state-integrity-invariants-agenda-full]] Q3).

---

## L-INT-2 — Findings disposition

The M1 loop. Its measure is **age**, and its purpose is to make the queue drainable rather
than large.

```yaml
type: loop
id: int-findings-disposition
owner: state-integrity-invariants
measures: [integrity.open_findings_oldest_age, integrity.open_findings_count, integrity.findings_closed_by_disposition, integrity.findings_invalidated_count]
changes: [detector.thresholds, triage.cadence, engineering.work_queue]
inputs_from: [agent-fleet, inventory-ledger, catalogue-identity, pos-operational-telemetry-ingest]
outputs_to: [engineering, reliability-sre, decision-office]
close_time: weekly
status: proposed
```

- Three terminal states: **fixed**, **accepted-with-reason**, **invalidated**. A finding
  with no terminal state after one close-time is aged, and age escalates.
- `integrity.findings_invalidated_count` is a **detector-quality** signal, not a nuisance
  count: rising invalidations mean the detector needs work, and fixing data instead of the
  detector is how the queue fills with noise.

---

## L-INT-3 — Gate integrity

Watches the gates themselves, including the author≠auditor tripwire that no other loop can
see.

```yaml
type: loop
id: int-gate-integrity
owner: state-integrity-invariants
measures: [schema.days_since_hand_applied_ddl, integrity.commits_touching_migration_and_gate, integrity.gates_relaxed_count, ci.parity_red_consecutive_runs]
changes: [scripts.check_schema_parity_sh, workflows.schema_parity_yml, gate.severity]
inputs_from: [schema-migrations, release-engineering]
outputs_to: [engineering, decision-office, reliability-sre]
close_time: daily (cron already exists), weekly review
status: proposed
```

- `integrity.commits_touching_migration_and_gate` has a **hard target of zero** and is the
  M3 tripwire — greppable on every push, and the only mechanism that survives the author and
  auditor being the same person.
- The daily half already runs: `schema-parity.yml:26-28`. The weekly half is the review the
  cron cannot do for itself.

---

## L-INT-4 — Outcome-side coverage

The M2 loop. It measures the distance between *checking the syntax* and *measuring the
state*.

```yaml
type: loop
id: int-outcome-side-coverage
owner: state-integrity-invariants
measures: [integrity.invariants_with_outcome_side_check_pct, integrity.divergence_sample_rows, integrity.green_ci_with_nonzero_divergence_count]
changes: [gates.outcome_side_twins, sampling.frequency, detector.coverage]
inputs_from: [inventory-ledger, catalogue-identity, substrate-quality-coverage]
outputs_to: [engineering, reliability-sre]
close_time: monthly, immediate on a green-CI-plus-divergence event
status: proposed
```

- `integrity.green_ci_with_nonzero_divergence_count` is the exact tell from
  [[state-integrity-invariants-premortem]] M2 and from [[engineering-premortem]] M4: green
  guard, divergent data. **One occurrence is a finding, not a statistic.**
- Five of six gates are greps today; `check_no_direct_stock_writes.sh:10` says so itself.

---

## L-INT-5 — Detection-coverage honesty

Keeps the mandate and the capability visibly aligned, which is the only defence against a
strong-looking evidence base hiding two stubs.

```yaml
type: loop
id: int-detection-coverage-honesty
owner: state-integrity-invariants
measures: [sre.mttd_silent_corruption_by_class, integrity.invariant_classes_unmeasured, integrity.stub_agents_counted_as_coverage]
changes: [board.mttd_table, charter.declared_not_owned_list, agents.build_or_disown_decision]
inputs_from: [agent-fleet, observability-telemetry-plumbing]
outputs_to: [reliability-sre, decision-office, people-and-agent-ops]
close_time: weekly
status: proposed
```

- `sre.mttd_silent_corruption_by_class` is **never aggregated to a single number** —
  the aggregation is M4.
- `integrity.stub_agents_counted_as_coverage` has a target of zero and is currently at
  **two**: `ghost_inventory_agent.py` and `shrinkage_detective_agent.py`
  (`technology.md:40-43`, `:821`).

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-INT-1 tenant-leakage response | **minutes, out of band** | M5 |
| L-INT-2 findings disposition | weekly | M1 |
| L-INT-3 gate integrity | daily cron / weekly review | M3 |
| L-INT-4 outcome-side coverage | monthly / immediate on green-CI-plus-divergence | M2 |
| L-INT-5 detection-coverage honesty | weekly | M2, M4 |
