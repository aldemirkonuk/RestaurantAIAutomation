---
type: agenda-board
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: provisional
metrics: [nf_a.cost_per_task, routing.routed_client_share]
updated: 2026-08-24
links: ["[[model-routing-inference-economics-charter]]", "[[model-routing-inference-economics-agenda-full]]", "[[model-routing-inference-economics-premortem]]", "[[model-routing-inference-economics-loops]]", "[[ai-orchestration-agenda-board]]"]
---

# Model Routing & Inference Economics — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/applied-ai/ai-orchestration/teams/model-routing-inference-economics"
SORT type ASC
```

## Sibling teams — for seam checks

```dataview
TABLE WITHOUT ID file.link AS Team, status
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter" AND team != this.team
SORT file.name ASC
```

## Numbers

| Metric | Today |
|---|---|
| `routing.metered_call_share` (gateway) | **0 / 7** |
| `routing.routed_client_share` | well under 100%; **must be reported weighted by spend** |
| `routing.distinct_model_pins` | **≥7** places, **3** distinct model IDs |
| `nf_a.cost_per_task` | **not emitted** — structurally uncomputable for gateway paths |
| `routing.substitutions_without_benchmark` | target **0** |

## The seven unrouted gateway call sites — ordered by spend, descending

- [ ] `analytics/consultants.service.ts` — `claude-opus-4-8`, `max_tokens: 4096` · **most expensive · most exposed · unmetered**
- [ ] `common/orchestrator/inbound-responder.service.ts` — highest volume; carries a retired-model comment at `:18-20`
- [ ] `procurement/documents/document-extractor.service.ts` — invoice extraction
- [ ] `menus/parsers/scan-parser.service.ts`
- [ ] `vendor-intel/vendor-page-extractor.service.ts`
- [ ] `inventory/photo-count.service.ts`
- [ ] `ux-optimizer/ux-optimizer.service.ts` — pins a **dated snapshot**, `claude-haiku-4-5-20251001`

> `common/orchestrator/health-proxy.controller.ts:48` only reads the key for a health
> readout — **not** a call site. `technology.md:379` says 8; on disk it is 7.

## Unblocked now

- [ ] Meter `consultants.service.ts` → `api_spend` *(one day; closes the largest blind spot)*
- [ ] Report `routed_client_share` **weighted by spend**, alongside the count
- [ ] Consolidate the seven, spend-descending

## Blocked

- [ ] Task correlation ID on spend rows *(NF-A task identity)*
- [ ] Substitution gate in CI *(pass criteria — [[agent-evaluation-gates-charter]])*
- [ ] Declarative routing policy + explain endpoint *(all of the above)*

## Carried, not owned

- ⚠️ **[[README]] §0 finding 1** — `analytics.controller.ts` unguarded → anonymous
  caller reaches `claude-opus-4-8`. Guard is [[security-charter]] + Engineering.
  **The blindness is ours**: no `api_spend` row means no anomaly, no alert, and a
  provider invoice as the first notification.

## Watch signals

- [ ] A model ID changed in a commit citing cost, with **no eval run attached**
- [ ] `routed_client_share` by count diverging from `routed_client_share` by spend
- [ ] An `api_spend` row with no task correlation ID
- [ ] The first **per-tenant routing override** — where a table becomes a program
- [ ] Cost per restaurant per day crossing an anomaly threshold *(unbuildable today)*

## Open forks

- [ ] **OD-04** — external model roster; explicitly downstream of OD-03
- [ ] Is a dated model pin (`ux-optimizer.service.ts:250`) deliberate, or drift?
- [ ] What share of $20–50/mo pricing may be inference?
