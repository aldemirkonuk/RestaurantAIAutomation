---
type: charter
division: platform
department: reliability-sre
status: exists
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-24
links: ["[[reliability-sre-premortem]]", "[[reliability-sre-agenda-full]]", "[[reliability-sre-agenda-board]]", "[[reliability-sre-directive]]", "[[reliability-sre-loops]]", "[[reliability-sre-schedule]]", "[[ORG_STRUCTURE]]", "[[technology]]", "[[observability-telemetry-plumbing-charter]]", "[[release-engineering-charter]]", "[[runtime-resilience-charter]]", "[[state-integrity-invariants-charter]]", "[[engineering-charter]]", "[[data-charter]]"]
---

# Reliability / SRE — Charter

Parent division: **Platform** ([[ORG_STRUCTURE]] §2). Siblings in-division:
[[engineering-charter]], [[data-charter]].

## Mandate

Reliability/SRE is accountable for the system **running**, which is a different job from
the system being *right* ([[engineering-charter]]) or its rows being *fit to use*
([[data-charter]]). It owns four questions, and the four questions are the four teams:
**does the number exist at all?** ([[observability-telemetry-plumbing-charter]]);
**can we put it back?** ([[release-engineering-charter]]);
**does it survive partial failure?** ([[runtime-resilience-charter]]);
**is it quietly wrong?** ([[state-integrity-invariants-charter]]).
Engineering authors; this department operates and audits. The seam is deliberate and is
the same author-≠-auditor argument [[ORG_STRUCTURE]] §3 uses for the advisory layer.

## Boundaries

Owns outright:

- **The emission path** — `services/agent-orchestrator/core/observability.py`
  (`MetricsCollector:86`, `TracingManager:267`, `instrument_fastapi:341`),
  `core/base_agent.py:77` `AgentMetrics`, `base_agent.py:743` `log_decision` → the
  `decision_log` table, Sentry in api-gateway and web, `apps/api-gateway/src/logs/`,
  `apps/web/src/pages/LogsTimelinePage.tsx`, `AdminHealth.tsx`,
  `common/orchestrator/health-proxy.controller.ts`, `scripts/health-check.sh`.
- **The path from commit to production and back** — the five workflows (`ci.yml`,
  `codeql.yml`, `deploy.yml`, `e2e-prod.yml`, `schema-parity.yml`),
  `services/agent-orchestrator/railway.toml`, `vercel.json`, `apps/web/vercel.json`,
  `docker-compose.yml` + `.override.yml`, and the 80 environment variables across ~6
  surfaces ([[EXTERNAL_CONNECTIONS]]:39-80).
- **Behavior under partial failure** — `core/message_bus.py:161-284` (circuit breaker),
  `:524-533` (dead-letter exchange and queue), `core/base_agent.py:543` `_process_with_retry`,
  `:704` `_check_idempotency`, `:791` `_send_to_dlq`, `:823-905` saga compensation,
  `core/connection_pool.py`, `core/outbox_publisher.py`,
  `apps/api-gateway/src/common/{idempotency,rate-limit,cache}/`,
  `core/orchestrator.py:537` `pause_all_writes`, `agents/buffer_manager.py`.
- **Silent-corruption detection and the gates that enforce invariants** —
  `agents/state_invariant_enforcer.py`, `agents/drift_agent.py`,
  `agents/inequality_detector.py`, `.github/workflows/schema-parity.yml`,
  `scripts/check_schema_parity.sh`, `check_no_direct_stock_writes.sh`,
  `check_no_direct_type_attributes_access.sh`, `check_no_raw_guest_channels.sh`,
  `check_no_guest_name_matching.sh`, `.planning/07-reference/SCHEMA_DRIFT_INVENTORY.txt`.

**Four teams, deliberately under-teamed** (`.planning/foundation/teams/technology.md:55,706-722`):

| Team | The question it owns | Evidence grade |
|---|---|---|
| [[observability-telemetry-plumbing-charter]] | Does the signal exist? | EXISTS |
| [[release-engineering-charter]] | Can we put it back? | EXISTS |
| [[runtime-resilience-charter]] | Does it survive partial failure? | EXISTS |
| [[state-integrity-invariants-charter]] | Is it quietly wrong? | EXISTS |

## Explicit non-goals

### Considered and rejected — do not resurrect

Two candidate teams were **argued and rejected** at the team-layer pass
(`technology.md:710-717`). They are recorded here as non-goals so the argument is not
re-run every quarter by whoever notices the gap:

| Rejected candidate | Why | Where the work actually goes | Entry trigger to revisit |
|---|---|---|---|
| **Incident Response / On-Call** | "A dedicated incident team for a solo founder plus an agent fleet is org cosplay" (`technology.md:712-714`). The metrics that would page anyone are owned one team over. | Incident command folds into [[observability-telemetry-plumbing-charter]]; multi-team incidents route to the department via [[reliability-sre-directive]]. | A **second human** carrying a pager, **or** paging volume that consumes more than one close-time of a team's capacity for two consecutive periods. |
| **Infrastructure Cost** | Inference cost is a routing decision, not an infra one; platform cost is three vendors (Railway, Vercel, Supabase) on flat plans. "Not a team until there is a bill worth a headcount" (`technology.md:715-717`). | Inference economics → [[model-routing-inference-economics-charter]]; platform spend is a line item, not a function. | A monthly platform bill (excluding inference) large enough that a percentage point of it exceeds the cost of the person watching it. |

Both rejections are **scale-dependent, not principled**. They were right in 2026-08 and
should be re-argued at the trigger, not before.

### Owned elsewhere

| Not ours | Whose it is | The line |
|---|---|---|
| Authoring DDL and migrations | [[schema-migrations-charter]] | Author ≠ auditor. They write the migration; [[state-integrity-invariants-charter]] runs the parity gate and declares red (`technology.md:860`). |
| Product correctness — identity, stock, money, delivery, screens | [[engineering-charter]] | We do not fix the bug; we detect that state is wrong and that the deploy can be undone. |
| Whether a data row is *fit to use* | [[data-charter]] | Substrate quality is upstream of us. A correctly-delivered garbage row is Data's problem, not a reliability failure. |
| Defining the NF-A event schema and doneability | [[neural-footprint-instrumentation-charter]], [[evaluation-doneability-charter]] *(Research & Math)* | They define the event; [[observability-telemetry-plumbing-charter]] owns the pipe it rides on. Method vs. plumbing. |
| What a metric *means* to a customer | [[metric-contract-truth-assurance-charter]] *(Analytics & BI)* | We own whether the number exists; they own whether the number's definition is honest. |
| Classifying the 137 unguarded endpoints | [[access-control-tenant-isolation-charter]] *(Security)* | Security finds the class; [[platform-api-charter]] builds the mechanism; we own only the CI gate that stops recurrence. |
| Agent code — including the guardian agents whose findings we consume | [[agent-fleet-charter]] | **Open seam, fork TECH-F6** (`technology.md:848`). Fleet owns the code, we own the findings. |

## Named gap — backup and restore is not a team, and is not solved

Stated plainly because it is the single most likely thing in this department to be lost:

- The entire backup/restore capability is **two shell scripts**: `scripts/backup_db.sh`
  (19 lines, `pg_dump --format=custom`) and `scripts/restore_db.sh` (25 lines,
  `pg_restore --clean --if-exists --no-owner`).
- **No workflow, test, or scheduled job references either script.** There is **no
  evidence of a tested restore** (`technology.md:719-722`).
- The backup filename template is still `wineops_backup_${TIMESTAMP}.dump` — the legacy
  brand ([[README]] §0 item 3), a small tell that nothing has touched this path recently.
- It is assigned to [[release-engineering-charter]] because **restore is the terminal
  rollback**, and that team's first task is to prove a restore works.
- Its metric, `sre.days_since_verified_restore`, currently has **no value at all** —
  not a bad value. That distinction is the finding.

This is a **gap, not a team**. Creating a "Backup & DR" team would be the same
org-cosplay error §6.0 rejected twice; leaving the gap unnamed would be worse.

## Metrics it moves

Like [[engineering-charter]], this department does not roll its team metrics into one
number — a missing metric and a stale DLQ message are not commensurable. The department
metric is the **set**, on one board ([[reliability-sre-agenda-board]]):

- `nf_a.emission_coverage` — share of agent tasks producing a complete NF-A event
  (task type · model · tokens · latency · retries · tool calls · doneability · cost,
  [[README]] §4.2). **Baseline: unmeasured.** `decision_log` and `api_spend` today cover
  parts of the tuple from two writers and cannot be joined per task (`technology.md:745-746`).
- `sre.time_to_revert` — decision to healthy production. **Baseline: unmeasured**;
  `deploy.yml`'s `rollback-guide` mode currently *prints steps*.
- `sre.dlq_depth_and_oldest_age` — depth **and** age of oldest message in
  `queue.dead_letters`. Depth alone hides the failure.
- `sre.mttd_silent_corruption` — violating write → raised finding. Schema drift is ≤24h
  (`schema-parity.yml` daily cron at 06:00); tenant leakage and stock divergence are
  **unmeasured**.
- `sre.days_since_verified_restore` — **undefined, because it has never happened.**

Neural-footprint tie: **this department is the hard prerequisite for L4.** NF-A cannot be
emitted by departments with no emission path ([[README]] §1, §4.2), which puts
[[observability-telemetry-plumbing-charter]] upstream of most of the org's metric story.

## Evidence today

**EXISTS.** All four teams are graded EXISTS in the evidence pass
(`technology.md:736,764,791,817`), and [[state-integrity-invariants-charter]] is called
out as "unusually strong for a proposed team". This department is not a greenfield
proposal — the mechanisms are largely **built and unwatched**, which is a specific and
different problem from being unbuilt. Three of the four premortems in
[[reliability-sre-premortem]] are variations on *the machinery works and nobody reads
its output*.

Two evidence caveats carried forward verbatim:

- `.github/workflows/ci.yml:8` — *"Do NOT treat TFND-05 as green CI — Black debt on
  studio_routes.py may keep main red"*. The workflow documents its own tolerance for red.
- `observability.py:53-84` degrades to `NoopMetric` when `prometheus_client` is absent —
  a defensible production choice that makes "no metrics" and "metrics are zero"
  indistinguishable.

## Is four the right number?

Yes, and the count survives the §0 tests: each team names a failure mode the others do
not have (missing signal / irreversible change / silent degradation / silent wrongness),
and each cites code it would own today. Two seams are genuinely contestable and are named
in [[reliability-sre-directive]] rather than left to be discovered in an argument:

1. **DLQ depth** is a *number* (observability) about a *mechanism* (resilience).
   Line: [[observability-telemetry-plumbing-charter]] owns that the number is emitted;
   [[runtime-resilience-charter]] owns its value and owns acting on it.
2. **A drift finding** is detected by state-integrity but must be *routed* by whatever
   holds incident command — which §6.0 folded into observability. Line: state-integrity
   owns detection and the finding's content; observability owns that it reaches a human.

## Open forks touching this department

- **TECH-F6** — guardian-agent co-ownership: [[agent-fleet-charter]] owns their code,
  [[state-integrity-invariants-charter]] owns their findings (`technology.md:848`).
- **TECH-F5** — 7 artifacts per team vs 3. This vault answers "7"; the fork is not closed.
- **TECH-F1** — 25 teams for one division at all (`technology.md:843`).
