---
type: loops
division: platform
department: reliability-sre
team: release-engineering
status: provisional
metrics: [sre.time_to_revert, sre.days_since_verified_restore, release.env_drift_count, ci.gates_red_consecutive_runs]
updated: 2026-08-24
links: ["[[release-engineering-charter]]", "[[release-engineering-directive]]", "[[reliability-sre-loops]]", "[[state-integrity-invariants-loops]]", "[[observability-telemetry-plumbing-charter]]"]
loop_count: 5
loop_count: 5
loop_ids: ["rel-restore-proving", "rel-revert-timing", "rel-red-gate-resolution", "rel-env-drift", "rel-recovery-first-use-review"]
loop_close_times: ["quarterly", "quarterly (exercised), immediate (real revert)", "weekly", "monthly, immediate on a bypass finding", "within one week of any first use"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Release Engineering — Loops

Every loop names its close-time ([[ORG_STRUCTURE]] §5).

---

## L-REL-1 — Restore proving

The named gap, as a loop. Its first close produces the **first value**
`sre.days_since_verified_restore` has ever had.

```yaml
type: loop
id: rel-restore-proving
owner: release-engineering
measures: [sre.days_since_verified_restore, sre.restore_drill_parity_result, sre.restore_duration_minutes]
changes: [scripts.restore_db_sh, scripts.backup_db_sh, runbook.restore]
inputs_from: [state-integrity-invariants, schema-migrations]
outputs_to: [reliability-sre, engineering, strategy, decision-office]
close_time: quarterly
status: proposed
```

- **The drill's output is evidence, not a claim:** row counts plus a
  `scripts/check_schema_parity.sh` run against the **restored** database.
- **A failed first drill closes this loop successfully.** The loop's purpose is to replace
  a hypothesis with a fact; a fact that says "broken" is the more valuable outcome.
- Quarterly rather than weekly on purpose: a drill scheduled too often is skipped, and a
  skipped drill on a schedule is worse than an honest gap.

---

## L-REL-2 — Revert timing

```yaml
type: loop
id: rel-revert-timing
owner: release-engineering
measures: [sre.time_to_revert, sre.reverts_exercised_count, sre.rollback_guide_staleness_days]
changes: [workflows.deploy_yml, runbook.rollback_guide]
inputs_from: [observability-telemetry-plumbing, engineering]
outputs_to: [reliability-sre, engineering]
close_time: quarterly (exercised), immediate (real revert)
status: proposed
```

- **Population rule:** only an exercised revert may write `sre.time_to_revert`. Estimates
  are rejected; an empty field is information, a guessed field is not.
- `sre.rollback_guide_staleness_days` catches M3's real mechanism — the guide's step 3
  referencing a service name that changed months ago.

---

## L-REL-3 — Red-gate resolution

This team supplies the numbers; the department's L-SRE-1 forces the fix-or-delete choice.
Separating them is deliberate: the team that tolerates the red should not be the one that
decides tolerance is fine.

```yaml
type: loop
id: rel-red-gate-resolution
owner: release-engineering
measures: [ci.gates_red_consecutive_runs, ci.exceptions_open_count, ci.exceptions_past_expiry_count, ci.yml_line8_present]
changes: [workflows.ci_yml, ci.gate_severity, code.studio_routes_black_debt]
inputs_from: [engineering, state-integrity-invariants]
outputs_to: [reliability-sre, decision-office]
close_time: weekly
status: proposed
```

- `ci.yml_line8_present` is a **boolean whose target is false.** The deliverable is the
  deletion of that line of text, which requires the Black debt on `studio_routes.py` to be
  resolved first.
- `ci.exceptions_past_expiry_count` is the metric that distinguishes an exception log from
  a tolerance log.

---

## L-REL-4 — Environment and secret drift

```yaml
type: loop
id: rel-env-drift
owner: release-engineering
measures: [release.env_drift_count, release.vars_without_owner, release.dev_auth_bypass_in_prod]
changes: [config.env_manifest, workflows.ci_yml_env_assertions, railway.toml, vercel.json]
inputs_from: [platform-api, security, external-connections]
outputs_to: [engineering, security, reliability-sre]
close_time: monthly, immediate on a bypass finding
status: proposed
```

- `release.dev_auth_bypass_in_prod` has a **hard target of zero** and fails the deploy
  rather than warning. Combined with `tenant.guard.ts:38-46`, a non-zero value is a live
  authentication bypass, not a hygiene issue.
- Two clocks again: monthly review of the 80-var surface, immediate action on a bypass.

---

## L-REL-5 — Recovery-path first-use review

Fires rarely and is the cheapest loop here. Any first-in-anger use of restore, revert, or
`orchestrator.py:537` `pause_all_writes` — **including successful uses** — produces a
written review within one close-time.

```yaml
type: loop
id: rel-recovery-first-use-review
owner: release-engineering
measures: [sre.recovery_paths_used_unverified_count, sre.days_since_kill_switch_exercised]
changes: [runbook.restore, runbook.rollback_guide, runbook.kill_switch]
inputs_from: [runtime-resilience, observability-telemetry-plumbing]
outputs_to: [reliability-sre, decision-office]
close_time: within one week of any first use
status: proposed
```

- **Success does not exempt.** A recovery path that worked while unverified worked by luck,
  and luck is not a measurement.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-REL-1 restore proving | quarterly | M2 |
| L-REL-2 revert timing | quarterly / immediate on a real revert | M3 |
| L-REL-3 red-gate resolution | weekly | M1 |
| L-REL-4 env drift | monthly / immediate on bypass | M4 |
| L-REL-5 recovery first-use review | within one week of first use | M2, M3, M5 |
