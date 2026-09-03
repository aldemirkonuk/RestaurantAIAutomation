---
type: agent-stack
division: platform
department: reliability-sre
team: release-engineering
status: designed
updated: 2026-08-27
metrics: [sre.time_to_revert, sre.days_since_verified_restore, release.env_drift_count, ci.gates_red_consecutive_runs]
links: ["[[release-engineering-charter]]", "[[release-engineering-schedule]]", "[[release-engineering-loops]]", "[[release-engineering-directive]]", "[[0034-agent-stack-artifact]]", "[[reliability-sre-agent-stack]]", "[[skills-charter]]", "[[action-safety-the-human-gate-charter]]", "[[state-integrity-invariants-charter]]", "[[observability-telemetry-plumbing-charter]]"]
---

# Release Engineering — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Every other SRE team asks whether the system is healthy; this one asks whether we can
> **put it back** ([[release-engineering-charter]] §Mandate). Its agent therefore lives on a
> tighter leash than any other in the department: the work it exists to do — revert,
> restore, kill switch — is exactly the work it may never execute unattended.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `release-recovery-prover` | Keep the two reversibility numbers real — `sre.time_to_revert` and `sre.days_since_verified_restore` — by preparing and timing the dated drills, diffing the 80-var environment manifest, and refusing to call a deploy verified on a green health check alone | NEW |

## 2. Agent cards

```yaml
agent: release-recovery-prover
unit: release-engineering
triggers:
  - schedule: "weekly (L-REL-3 red-gate resolution), monthly (env reconciliation across ~6 surfaces)"  # [[release-engineering-schedule]]
  - schedule: "quarterly, dated (L-REL-1 restore drill, L-REL-2 timed no-op revert)"
  - topic: deploy.completed                  # publisher: `.github/workflows/deploy.yml` (gated on CI success) — event does not exist yet; today the trigger is a human noticing
  - topic: recovery_path.first_use           # publisher: NONE (gap — nothing records that a revert, restore or kill switch was used, including a successful use)
consumes:
  - "workflow run results — publisher: `ci.yml`, `codeql.yml`, `deploy.yml`, `e2e-prod.yml`, `schema-parity.yml` (this team runs the last one; [[state-integrity-invariants-charter]] grades it)"
  - "environment variable state across ~6 surfaces — publisher: [[EXTERNAL_CONNECTIONS]]:39-80 and the vendor consoles"
  - "liveness twins for the post-deploy check — publisher: [[observability-telemetry-plumbing-charter]] (`obs.metrics_with_liveness_twin_pct`)"
  - "`scripts/backup_db.sh` output and `scripts/restore_db.sh` behaviour during a drill"
emits:
  - "`sre.time_to_revert`, `sre.days_since_verified_restore` → consumer: [[reliability-sre-agent-stack|sre-board-orchestrator]]"
  - "`ci.gates_red_consecutive_runs`, `ci.exceptions_past_expiry_count` → consumer: the department's weekly red-signal audit (L-SRE-1)"
  - "`release.env_drift_count`, `release.dev_auth_bypass_in_prod` → consumer: the same board; a non-zero second value is an immediate escalation"
  - nf_a events (task_type: release_drill, release_env_reconcile)
routing_class: mechanical      # diff a manifest, count red runs, time a procedure — the drill's verdict is a measurement, not an opinion
quality_bar: "a drill counts only when it produced a number: a restore is done when `check_schema_parity.sh` passes **against the restored database** with row counts recorded; a revert is done when timed decision→healthy production. NONE (gap) — no formal verdict basis exists, and green CI has already been non-authoritative once (`ci.yml:8`)"
autonomy:
  read: autonomous
  propose: autonomous          # drill plans, manifests and findings land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: release-engineering
escalates_to: "[[reliability-sre-charter]]"
```

**The card's own hard rule, and it is broader than the constant above.** Executing a
revert, a restore, or `pause_all_writes` is a production mutation with no undo of its own:
`restore_db.sh` runs `pg_restore --clean --if-exists --no-owner`, which is destructive by
construction. This agent **prepares, schedules, times and records** those procedures; a
human runs them ([[action-safety-the-human-gate-charter]]). An agent that could revert
production autonomously would be the fastest path to needing the restore it has never tested.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `railway-config` | T3 | A Railway service or environment configuration change for `services/agent-orchestrator` | Config applies and the service boots healthy | `.claude/skills/railway-config/SKILL.md` — **the repo's only project skill**, and `railway.toml` is this team's file | **EXISTS** |
| `release-verify` | T3 | A deploy has completed, before it is called done | Health surfaces green **and** liveness twins non-zero — a green health check on a dead metrics pipeline is not a verified release | `.github/workflows/ci.yml:8-9` documents that green CI has already been non-authoritative once ("Do NOT treat TFND-05 as green CI" / "capability-unverified") | NEW |
| `env-manifest-diff` | T3 | Any PR or console change touching an environment variable across the ~6 surfaces | Manifest and reality agree; every var has an owner; `DEV_AUTH_BYPASS*` absent from production | 80 env vars across ~6 surfaces with **no manifest at all** ([[EXTERNAL_CONNECTIONS]]:39-80) | NEW |
| `rollback-rehearse` | T3 | Quarterly, and after any change to `deploy.yml` or a service name | A timed revert to the previous SHA and back, with `sre.time_to_revert` written from the measurement rather than estimated | `deploy.yml`'s `rollback-guide` mode **prints steps** and has never been exercised (`technology.md:771-772`) | NEW |

**One skill is deliberately absent.** `restore-drill` is proposed in
[[release-engineering-schedule]] as the department's single chartered exception to
[[README]] §3.3 rule 3; this artifact holds ADR 0034 §7.2's stricter line — no past
instance, no row — so it is recorded as an omission rather than smuggled in: **the restore
has never been run, which is why the drill exists and why it can cite nothing.** It stays in
the schedule and in loop `rel-restore-proving` (close_time: quarterly) until the first drill
produces evidence.

Consumed, owned elsewhere: [[state-integrity-invariants-charter]]'s `schema-drift-check` —
this team runs `check_schema_parity.sh` inside the restore drill and **does not grade it**.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: release_drill` and `release_env_reconcile`. Needs
  `context.drill_type` (`restore` | `revert` | `kill_switch`), `context.elapsed_seconds` and
  `context.outcome` as jsonb keys — a drill whose duration is not in the event is a drill
  that produced no metric, which is the exact failure this team was chartered to end.
- **Semantic** — `memory/` beside this file, `release-engineering-MEMORY.md` as index. Its
  founding facts are known and would be the first three files: the untested-restore state
  including the legacy `wineops_backup_` filename (source: [[release-engineering-charter]]
  §The named gap, 2026-08-24); the `--no-owner --clean` **hypothesis** about roles, RLS
  ownership and extensions, explicitly marked `confidence: hypothesis` until a drill
  converts it; and the `ci.yml:8` red-tolerance note with its own expiry. Every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §The named gap. The five
  workflows and `railway.toml`/`vercel.json` are retrieval targets by `path:line`.

**Consolidation** — quarterly, aligned to the drills, to be mirrored in
[[release-engineering-schedule]] (not a row there yet): after each drill, promote or kill
the semantic layer's hypotheses — **failures first**, and a drill that was *cancelled* is
itself a fact naming who cancelled it and why, because a visible cancellation is a finding
("dated, not prioritized"). Expire facts unverified for 90 days; propose skill candidates.
One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops ([[release-engineering-loops]]), NF-A events and vault PRs.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| `deploy.completed` has no event | `deploy.yml` runs, nothing publishes its completion, so `release-verify` fires when a human remembers. The concurrency group (`cancel-in-progress: false`) means a deploy can also complete long after the PR conversation ended |
| `recovery_path.first_use` has no publisher | L-REL-5 requires a review within one week of the **first use** of a restore, revert or kill switch — including a *successful* use — and nothing records that a recovery path was used at all |
| `sre.days_since_verified_restore` has no first value | The metric cannot drift, be stale, or be wrong; it does not exist. Every board render must say "never happened" rather than 0 or blank |

## 6. Evidence today

- **EXISTS — the pipeline.** Five workflows, a gated deploy with an explicit
  `rollback_target_sha` and a concurrency group that deliberately does not cancel
  in-progress, nightly cloud E2E (`e2e-prod.yml`, `schedule: 0 2 * * *`), daily
  `schema-parity.yml` (`:26-28`) — reasonably sophisticated for a solo-founder repo
  (`technology.md:764-769`).
- **EXISTS — one skill.** `.claude/skills/railway-config/`, the repo's only project skill.
- **PARTIAL — backup/restore.** Two scripts exist (`backup_db.sh`, 19 lines;
  `restore_db.sh`, 25 lines) and **no workflow, test or scheduled job references either**.
  Capability declared, capability unproven.
- **NEW — the agent, the three proposed skills, and every number on the board.** Neither
  the revert nor the restore has ever been timed, so both primary metrics are unmeasured —
  and one has never had a value at all.
