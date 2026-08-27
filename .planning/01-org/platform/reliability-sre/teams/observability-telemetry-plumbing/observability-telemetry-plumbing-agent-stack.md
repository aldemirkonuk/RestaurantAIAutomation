---
type: agent-stack
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: designed
updated: 2026-08-27
metrics: [nf_a.emission_coverage, obs.metrics_with_liveness_twin_pct, obs.decision_log_join_rate]
links: ["[[observability-telemetry-plumbing-charter]]", "[[observability-telemetry-plumbing-schedule]]", "[[observability-telemetry-plumbing-loops]]", "[[observability-telemetry-plumbing-directive]]", "[[0034-agent-stack-artifact]]", "[[reliability-sre-agent-stack]]", "[[skills-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[metric-contract-truth-assurance-charter]]"]
---

# Observability & Telemetry Plumbing — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns *whether the number exists*, **never** *what the number says*
> ([[observability-telemetry-plumbing-charter]] §Mandate) — so its agent is deliberately the
> least interpretive in the department. It counts, joins and checks for absence, and the
> moment a row needs an opinion about a value it is out of mandate and belongs to whoever
> owns that value.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `obs-liveness-sentinel` | Prove every board metric is still speaking — heartbeat present, no flat zeros, a named liveness twin — and compute NF-A emission coverage over **agent tasks**, without ever grading what a value means | NEW |

## 2. Agent cards

```yaml
agent: obs-liveness-sentinel
unit: observability-telemetry-plumbing
triggers:
  - schedule: "hourly (heartbeat check), daily (flat-zero sweep), weekly (L-OBS-1 coverage, L-OBS-2 liveness twins)"  # [[observability-telemetry-plumbing-schedule]]
  - schedule: "monthly (L-OBS-3 error-capture fidelity, L-OBS-5 health-surface retrospective)"
  - topic: deploy.dependency_set_changed    # publisher: NONE (gap — nothing emits on an image/dependency change; the schedule's per-change assertion is manual)
consumes:
  - "`decision_log` rows — publisher: `base_agent.py:743` `log_decision` (schema at `20260805000000_baseline_from_production.sql:2687`)"
  - "`api_spend` rows — publisher: the model call path; a **second, unjoinable writer** (`technology.md:745-746`)"
  - "Prometheus/OTel output — publisher: `core/observability.py:86` `MetricsCollector`, `:267` `TracingManager`, `:341` `instrument_fastapi`"
  - "Sentry events and `apps/api-gateway/src/common/error-tracking/` — publisher: both product surfaces"
emits:
  - "`nf_a.emission_coverage` + `nf_a.tuple_fields_missing_top3` → consumer: [[reliability-sre-agent-stack|sre-board-orchestrator]]"
  - "`obs.metrics_with_liveness_twin_pct`, `obs.decision_log_join_rate` → consumer: the same board"
  - "absence alerts (heartbeat missing, metric flat-zero for a full period) → consumer: NONE (gap — no paging channel exists; today the alert is a doc row)"
  - nf_a events (task_type: obs_liveness_sweep, obs_coverage_report)
routing_class: mechanical      # count, join, diff, assert-present — no judgment anywhere in the loop
quality_bar: "a rerun over the same window yields the same coverage number and the same list of metrics without a twin; coverage is measured over **agent tasks**, never HTTP requests. NONE (gap) — coverage is not computable at all until `obs.decision_log_join_rate` is non-zero"
autonomy:
  read: autonomous
  propose: autonomous          # findings land as memory PRs and board rows
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: observability-telemetry-plumbing
escalates_to: "[[reliability-sre-charter]]"
```

**The card's own hard rule:** the sentinel reports that a number exists and is alive. It
never says a number is *too high*, *wrong*, or *concerning* — those verdicts belong to
[[runtime-resilience-charter]], [[metric-contract-truth-assurance-charter]] and
[[state-integrity-invariants-charter]] respectively. A sentinel that starts grading values
has collapsed the one-sentence boundary that is the whole team.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `signal-liveness-audit` | T2 | Weekly, and immediately after any change to the dependency set or container image | Every board metric has a named, verified liveness twin; the list without one is empty or explicitly accepted | `core/observability.py:53-84` returns `NoopMetric` when `prometheus_client` is absent and logs it at INFO (`:50`) — *no metrics* and *metrics are zero* render identically | NEW |
| `nf-a-coverage-report` | T2 | Weekly, and on demand before any L4 claim | Coverage over agent tasks with whole-tuple grading, plus the three most-missing fields named | `decision_log` and `api_spend` cover parts of the tuple from two writers and **cannot be joined per task** (`technology.md:745-746`) | NEW |
| `trace-attribute-review` | T2 | Any PR adding a span attribute, Sentry context, or log field | The attribute is on the allowlist or the PR is blocked; no raw guest identifier crosses the boundary | The guest-data invariant already required shell guards: `scripts/check_no_raw_guest_channels.sh`, `scripts/check_no_guest_name_matching.sh` | NEW |
| `incident-timeline-assemble` | T3 | An incident is declared and routed here per the folded incident-command duty | A timeline joining `decision_log`, Sentry events and deploy history, with gaps in the record marked **as gaps** | `apps/web/src/pages/LogsTimelinePage.tsx` exists precisely because assembling this by hand was needed | NEW |

**Named collision, not resolved here:** `nf-a-coverage-report` is claimed by this name in
[[ai-orchestration-agent-stack]] as well. Same skill name, two proposed owners, two
different past instances (theirs: PR #35 / `feat/p1-readout`). Recorded as a seam for
[[decision-office-charter]] — a unit doc must not pick.

Consumed, owned elsewhere: the NF-A event schema and doneability definition
([[neural-footprint-instrumentation-charter]], [[evaluation-doneability-charter]]) — method
is theirs, the pipe is ours.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: obs_liveness_sweep` and `obs_coverage_report`. Needs
  `context.metric_name`, `context.twin_present` and `context.tuple_field_missing` as jsonb
  keys, or a per-metric history is a join this team has to invent. The events this team
  *studies* are every other team's; the events it *emits* are its own sweeps.
- **Semantic** — `memory/` beside this file, `observability-telemetry-plumbing-MEMORY.md`
  as index. Its founding facts are already known and would be the first two files: the
  `NoopMetric` degradation path (source: `observability.py:53-84`, 2026-08-24) and the
  two-writer/no-join state of the NF-A tuple (source: `technology.md:745-746`). Provenance
  frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. `observability.py`
  and the health surfaces are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, to be mirrored in [[observability-telemetry-plumbing-schedule]]
(not a row there yet): diff this month's liveness-twin list against last month's; **failures
first** — a metric that lost its twin, or went flat-zero while an independent path showed
activity, becomes a fact naming the mechanism, not "the dashboard looked odd". Expire facts
unverified for 90 days; propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops ([[observability-telemetry-plumbing-loops]]), NF-A events
and vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| Absence alerts have no consumer | The hourly heartbeat check's whole value is firing on *absence*, and there is no paging channel to fire into — the incident-command duty was folded here without one. Today an alert is a doc row read at the next cadence |
| `deploy.dependency_set_changed` has no publisher | Nothing emits when the image loses a dependency, which is the exact first step of the M1 failure. The per-change assertion in the schedule is manual and depends on someone remembering |
| `obs.decision_log_join_rate` has no producer yet | Two writers, no shared key (`technology.md:745-746`). Until the join exists, `nf_a.emission_coverage` is not "low" — it is **not computable**, and must be rendered that way |

## 6. Evidence today

- **EXISTS — the plumbing the sentinel would read.** `core/observability.py:86,267,341`,
  `core/base_agent.py:77` `AgentMetrics` (`:104-156`), `base_agent.py:743` `log_decision` →
  `decision_log`, Sentry on both surfaces, `apps/api-gateway/src/logs/`,
  `LogsTimelinePage.tsx`, `AdminHealth.tsx`, `health-proxy.controller.ts`,
  `scripts/health-check.sh`. This is a plumbing team with plumbing already laid.
- **NEW — the sentinel and all four skills.** Nothing runs these sweeps; the team owns no
  skill today (the repo's one project skill is [[release-engineering-charter]]'s).
- **PARTIAL — the metric substrate.** `decision_log` is the closest existing thing to an
  NF-A event and is the **migration target, not a thing to replace blind**
  (`technology.md:739`); `api_spend` is the second writer; the join does not exist.
