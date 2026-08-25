---
type: schedule
division: platform
department: reliability-sre
status: provisional
metrics: [sre.days_since_verified_restore, sre.dlq_depth_and_oldest_age, nf_a.emission_coverage]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[reliability-sre-loops]]", "[[reliability-sre-agenda-board]]", "[[observability-telemetry-plumbing-schedule]]", "[[release-engineering-schedule]]", "[[runtime-resilience-schedule]]", "[[state-integrity-invariants-schedule]]"]
---

# Reliability / SRE — Schedule & Skills

## Recurring work

Department-level only; team cadences live in each team's own schedule.

| Cadence | Job | Emits |
|---|---|---|
| Daily 06:00 | `schema-parity.yml` cron — **already running** (`.github/workflows/schema-parity.yml:26-28`) | Parity verdict → `sre.mttd_silent_corruption` |
| Daily 02:00 | `e2e-prod.yml` cloud E2E — **already running** | Prod smoke verdict |
| Weekly | **Red-signal audit** (L-SRE-1) — every gate: fix within one close-time, or delete | `ci.gates_red_count`, `ci.gates_tolerated_count` |
| Weekly | **Signal-liveness audit** (L-SRE-2) — which metrics could still be speaking | `obs.metrics_with_liveness_twin_pct` |
| Weekly | **Unowned-queue sweep** (L-SRE-4) — DLQ age, open findings age, unanswered questions | `sre.dlq_depth_and_oldest_age`, `integrity.open_findings_oldest_age` |
| Monthly | **Environment-variable reconciliation** across the 80 vars / ~6 surfaces; assert `DEV_AUTH_BYPASS*` absent in production | `release.env_drift_count` |
| Quarterly | **Restore drill** (L-SRE-3) — restore into a scratch database, then run `check_schema_parity.sh` *against the restored database* | `sre.days_since_verified_restore` — **first value ever** |
| Quarterly | **Timed no-op revert** — exercise `deploy.yml` `rollback_target_sha` deliberately | `sre.time_to_revert` |
| Quarterly | **Kill-switch exercise** — `orchestrator.py:537` `pause_all_writes` in a controlled window | `sre.days_since_kill_switch_exercised` |
| Quarterly | **Rejected-team trigger watch** (L-SRE-5) — has the scale changed? | Entry in `OPEN-DECISIONS.md` or nothing |

**Anti-sprawl rule ([[README]] §6):** a scheduled job producing no action for **3
consecutive runs** is downgraded or deleted. Two on this list are at risk by design — the
kill-switch exercise and the trigger watch will usually produce "no change". They survive
on the grounds that their *value is the absence*, but if either produces no action for a
full year it is deleted rather than defended.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion ([[README]] §3.3).

**State today, honestly:** the repo has **one** project skill —
`.claude/skills/railway-config/` — and it is arguably this department's, since Railway is
where `services/agent-orchestrator` runs (`railway.toml`). Everything below it is
**proposed, not built**. This department owns no skill layer yet.

| Skill | Tier ([[README]] §3.2) | Trigger — the exact situation it fires in | Doneability | Owner team |
|---|---|---|---|---|
| `railway-config` **(EXISTS)** | T3 operational | Railway service/env configuration change | Config applies and the service boots | [[release-engineering-charter]] |
| `release-verify` *(proposed)* | T3 operational | A deploy completed; before it is called done | Health surfaces green **and** liveness twins non-zero | [[release-engineering-charter]] |
| `restore-drill` *(proposed)* | T3 operational | Quarterly drill, or any time `restore_db.sh` changes | Row count + parity run against the restored DB | [[release-engineering-charter]] |
| `schema-drift-check` *(proposed, §3.2 names it)* | T3 operational | Parity gate red, or a hand-applied prod DDL is suspected | Drift enumerated and either migrated or filed | [[state-integrity-invariants-charter]] |
| `dlq-triage` *(proposed)* | T3 operational | `queue.dead_letters` non-empty at sweep time | Every message replayed, discarded with reason, or escalated | [[runtime-resilience-charter]] |
| `signal-liveness-audit` *(proposed)* | T2 department | Weekly, and after any dependency change touching `prometheus_client` | Every board metric has a named liveness twin | [[observability-telemetry-plumbing-charter]] |

Per [[README]] §3.3 every one of these must, before it is committed, cite **a real past
instance where it would have helped**. Four can already do so today: the 27-tables /
403-columns / 13-functions drift incident recorded verbatim in
`scripts/check_schema_parity.sh:6-11` (`schema-drift-check`); the `ci.yml:8` red-tolerance
note (`release-verify`); the unconsumed `queue.dead_letters` (`dlq-triage`); and
`observability.py:53`'s silent `NoopMetric` fallback (`signal-liveness-audit`).
`restore-drill` cannot cite one — **because the restore has never been run**, which is
precisely the argument for it.
