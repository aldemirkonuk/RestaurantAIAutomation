---
type: agent-stack
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: designed
updated: 2026-08-27
metrics: [nf_a.cost_per_task, routing.routed_client_share, routing.metered_call_share, routing.distinct_model_pins]
links: ["[[model-routing-inference-economics-charter]]", "[[model-routing-inference-economics-schedule]]", "[[model-routing-inference-economics-loops]]", "[[0034-agent-stack-artifact]]", "[[ai-orchestration-agent-stack]]", "[[agent-evaluation-gates-charter]]"]
---

# Model Routing & Inference Economics — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The team that will one day own the routing policy gets a watcher first: spend and
> fragmentation made visible before any routing decision is automated. Note the
> irony this card must respect — it describes agents whose `routing_class` this very
> team defines for everyone else.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `spend-sentinel` | Keep the fragmentation numbers true — metered-call share, distinct model pins, routed-client share — and flag any model substitution that ships without a benchmark attached | NEW |

The **routing policy itself is not an agent and not on this page** — it is the
team's future build, blocked on OD-04 (the job → model registry) and on
[[agent-evaluation-gates-charter]] defining what "passes." A card that automated
routing today would be picking quality bars this team explicitly does not own.

## 2. Agent cards

```yaml
agent: spend-sentinel
unit: model-routing-inference-economics
triggers:
  - schedule: "weekly (feeds the aio board rollup)"        # mirrored in [[model-routing-inference-economics-schedule]]
  - topic: model.call_site_changed                          # publisher: NONE (gap — today only grep in review notices a new pin)
consumes:
  - api_spend rows (spend_logger's table) and the P1 gateway emission (model-client.service.ts:413)
  - grep census of model pins and metering across gateway + orchestrator
  - nf_a cost fields (ADR 0008)
emits:
  - the fragmentation tables → memory PRs and the board row
  - "cost anomalies (a task family whose cost_per_task moved >2x week-over-week) → [[ai-orchestration-agent-stack|aio-orchestrator]] escalation note"
  - nf_a events (task_type: spend_audit)
routing_class: mechanical         # counting pins and summing spend is not judgment
quality_bar: "every number is a query or a grep a reviewer can rerun; a family with no metering reads 'not metered', never 0 (ADR 0016 — ledgers express unknown)"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant — and spend *reporting* is not spend *control*; the sentinel never throttles or reroutes
memory: model-routing-inference-economics
escalates_to: "[[ai-orchestration-charter]]"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `model-pin-census` | T2 | Weekly, and any PR touching a model call site | Table of every model pin with `path:line` and value; `routing.distinct_model_pins` updated; a new pin names its PR | The 2026-08-24 session found 7 call sites, 3 different pinned values, one dated snapshot, and a retired-model warning living in a code comment ([[model-routing-inference-economics-charter]] §Evidence) | NEW |
| `unmetered-call-hunt` | T2 | Weekly, paired with the census | Every model call site classified metered / unmetered with the write path named; `routing.metered_call_share` updated | `grep -c api_spend` returning 0 for all seven gateway sites — a third of model spend invisible (charter §Evidence); closed for the gateway by P1, which is the proof the hunt works | NEW |

Consumed, owned elsewhere: benchmark methodology (Research & Math / OD-04
registry); "what passes" ([[agent-evaluation-gates-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: spend_audit`, and the cost fields of every task
  family's events (needs `context.model_id` and `context.call_site` keys so a pin
  can be traced to its spend without a grep).
- **Semantic** — `memory/` beside this file, index
  `model-routing-inference-economics-MEMORY.md`. First facts: the 7-site census
  (2026-08-24), the P1 closure (2026-08-25), the three pinned values. Provenance
  per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Metrics. Call sites are
  retrieval targets by `path:line`.

**Consolidation** — monthly: diff the pin and metering censuses; each closed or
opened site becomes a fact citing the commit; a substitution shipped without a
benchmark becomes a *failure* fact naming the PR; expire at 90 days unverified.
One PR; "no delta" stated when true.

## 5. Async contract

Board rows, memory PRs, NF-A events, loops per
[[model-routing-inference-economics-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `model.call_site_changed` has no publisher | A new unmetered call site is invisible until the weekly grep; the census bounds it at 7 days |
| `nf_a.cost_per_task` by task family not yet queryable end-to-end | P1 emits from the gateway; the Python orchestrator's spend_logger and the NF-A rows are not yet one joinable view — until then "cost per task" is two partial answers |
| Anomaly escalation is a doc note, not a page | Acceptable async path, but a 2x cost spike waits for the weekly cycle; naming that latency is the honest version of "real-time monitoring" |

## 6. Evidence today

- **NEW — the sentinel and both skills** as standing agents; both censuses were
  hand-run 2026-08-24 and the metering hunt was effectively re-run by P1.
- **EXISTS — the substrate.** `model_clients.py:52,73,93`, `spend_logger.py` (single
  insertion point into `api_spend`), P1 gateway metering
  (`model-client.service.ts:413`), `benchmark_haiku_vs_sonnet.py`.
- **PARTIAL — the joinable cost view.** Two metering systems exist (Python
  `api_spend`, P1 NF-A emission); nothing reads them as one.
