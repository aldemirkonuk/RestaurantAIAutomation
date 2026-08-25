---
type: charter
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: exists
metrics: [nf_a.emission_coverage, obs.metrics_with_liveness_twin_pct, obs.decision_log_join_rate]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[observability-telemetry-plumbing-premortem]]", "[[observability-telemetry-plumbing-agenda-full]]", "[[observability-telemetry-plumbing-agenda-board]]", "[[observability-telemetry-plumbing-directive]]", "[[observability-telemetry-plumbing-loops]]", "[[observability-telemetry-plumbing-schedule]]", "[[neural-footprint-instrumentation-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[runtime-resilience-charter]]", "[[state-integrity-invariants-charter]]"]
---

# Observability & Telemetry Plumbing — Charter

Team **6.1** of [[reliability-sre-charter]] (`.planning/foundation/teams/technology.md:726-751`).

## Mandate

Own **whether a signal exists at all**: metrics, traces, error capture, log timelines,
health surfaces — and the emission path NF-A will ride on. This team owns *whether the
number exists*, **never** *what the number says*. That one-sentence boundary is the whole
team; every ambiguous case resolves against it.

It is also **the hard prerequisite for L4**. NF-A cannot be emitted by departments with no
emission path, which puts this team upstream of most of [[README]] §4 and, transitively,
upstream of the org's ability to grade any department by a metric ([[ORG_STRUCTURE]] §4).

## Boundaries

Owns outright:

- **Python-side telemetry** — `services/agent-orchestrator/core/observability.py`:
  `MetricsCollector` (Prometheus) at `:86`, `TracingManager` (OTel) at `:267`,
  `instrument_fastapi` at `:341`, and the no-op fallbacks at `:53-84`.
- **Agent-level metrics** — `core/base_agent.py:77` `AgentMetrics` — p95, success rate,
  uptime, error recording (`:104-156`).
- **The decision trail** — `base_agent.py:743` `log_decision` → the `decision_log` table
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2687`).
- **Error capture** — `apps/api-gateway/src/common/error-tracking/`, Sentry in both
  api-gateway and web ([[EXTERNAL_CONNECTIONS]]:34).
- **Human-visible surfaces of the above** — `apps/api-gateway/src/logs/` (1 route),
  `apps/web/src/pages/LogsTimelinePage.tsx`, `AdminHealth.tsx`,
  `common/orchestrator/health-proxy.controller.ts` (4 routes), `scripts/health-check.sh`.
- **Incident routing**, by department decision — a dedicated Incident Command team was
  rejected as org cosplay at this scale (`technology.md:712-714`) and folded here, because
  these metrics are what would page anyone in the first place. See the non-goal below: this
  is a **time-boxed** responsibility, not the team's identity.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| What a metric *means*, and whether its definition is honest | [[metric-contract-truth-assurance-charter]] *(Analytics & BI)* | We own that the number exists; they own that it is not lying about what it counts |
| The NF-A event **schema** and the definition of doneability | [[neural-footprint-instrumentation-charter]], [[evaluation-doneability-charter]] *(Research & Math)* | They define the event; we own the pipe it rides on. Method vs. plumbing |
| The *value* of a resilience number and acting on it | [[runtime-resilience-charter]] | We emit DLQ depth; they own that it is too high and what to do about it |
| Detecting silent corruption | [[state-integrity-invariants-charter]] | A finding is a signal we deliver, not a signal we produce |
| Whether the build is healthy | [[release-engineering-charter]] | CI is a gate, not telemetry |
| Product analytics and guest-facing dashboards | [[analytics-engine-charter]] *(Analytics & BI)* | Different consumer, different truth standard |
| **Being the org's on-call function** | Rejected as a team; time-boxed here | Incident triage is a duty, not the mandate. If it displaces emission coverage for three close-times, the rejection is re-argued ([[reliability-sre-directive]] trigger 4) |

## Metrics it moves

- **`nf_a.emission_coverage` (primary)** — share of agent tasks producing a *complete*
  NF-A event: task type · model · tokens · latency · retries · tool calls · doneability ·
  cost ([[README]] §4.2). **Baseline: unmeasured.** `decision_log` and `api_spend` today
  cover parts of that tuple from **two different writers and cannot be joined per task**
  (`technology.md:745-746`) — so today's honest value is not "low", it is "not computable".
- `obs.decision_log_join_rate` — share of agent tasks where the cost row and the decision
  row can be joined by a shared key. This is the sub-metric that has to move *first*;
  coverage cannot be measured until the join exists.
- `obs.metrics_with_liveness_twin_pct` — share of board metrics that have a value which is
  non-zero *by construction* when the pipeline is alive. Direct counter to
  [[observability-telemetry-plumbing-premortem]] M1.
- **Denominator discipline:** coverage is measured over **agent tasks**, never over HTTP
  requests. `instrument_fastapi` makes request coverage trivially high and NF-A still empty.

## Evidence today

**EXISTS** (`technology.md:736-741`). This is a plumbing team with plumbing already laid —
its problem is fidelity, not absence.

- `core/observability.py:86` `MetricsCollector`, `:267` `TracingManager`, `:341`
  `instrument_fastapi`, `:53-84` no-op fallbacks
- `core/base_agent.py:77` `AgentMetrics`; error recording `:104-156`
- `base_agent.py:743` `log_decision` → `decision_log`
  (`20260805000000_baseline_from_production.sql:2687`). **This is the closest existing
  thing to an NF-A event and should be treated as the migration target, not replaced
  blind** (`technology.md:739`) — a green-field NF-A table would strand the only decision
  trail the system has.
- `apps/api-gateway/src/common/error-tracking/`, Sentry both surfaces
- `apps/api-gateway/src/logs/`, `LogsTimelinePage.tsx`, `AdminHealth.tsx`,
  `health-proxy.controller.ts`, `scripts/health-check.sh`

**Known weakness, in the code's own design:** `observability.py:53` returns `NoopMetric`
when `prometheus_client` is absent and logs it at INFO (`:50`). Correct for production
resilience; fatal for trust, because it makes *no metrics* and *metrics are zero*
render identically.

## Why this team is distinct from its siblings

Its failure is **the absence of information**, not a wrong system state. The other three
SRE teams can all be wrong loudly, quietly, or reversibly; this team's failure mode is that
nobody can tell which. It is the only team whose collapse makes the other three
unfalsifiable — which is also why it must not grade the numbers it emits.
