---
type: agenda-board
division: research-math
department: research-math
team: harness-model-routing
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-agenda-full]]", "[[harness-model-routing-loops]]", "[[harness-model-routing-schedule]]", "[[harness-model-routing-premortem]]", "[[research-math-agenda-board]]"]
---

# Harness & Model Routing (RM-1) — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/research-math/teams/harness-model-routing"
SORT type ASC
```

## Sibling charters — who can fail us, and what they own

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/research-math"
WHERE type = "charter" AND team != this.team
SORT team ASC
```

## Our loops, and whether any lost its close-time

```dataview
LIST
FROM "01-org/intelligence/research-math/teams/harness-model-routing"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — 60 days untouched is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/intelligence/research-math/teams/harness-model-routing"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Metrics — blanks render, always

| Metric | Reading |
|---|---|
| `nf_a.harness_overhead_ms` | **unmeasured — no instrument exists.** Blocks the OD-03 bake-off |
| `nf_a.cost_per_completed_task` | **unmeasured** — needs cost events (RM-3) **and** verdicts (RM-2) |
| `share_of_model_calls_through_wrapper` | **0 of 7** NestJS callsites; wrapper not built |

## Callsite ledger — the seven, and what each is missing

- [ ] `analytics/consultants.service.ts:28` — no retry · no cost events · **route unguarded (OD-20)** · Opus · **migrate first**
- [ ] `common/orchestrator/inbound-responder.service.ts:16` — no retry · no cost events · model in a module constant (`:21`)
- [ ] `procurement/documents/document-extractor.service.ts:27` — no retry · no cost events · model from `DOCUMENT_EXTRACTION_MODEL`
- [ ] `menus/parsers/scan-parser.service.ts:10` — **has retry** (`:136`, `:343`) · no cost events · model hardcoded (`:261`)
- [ ] `inventory/photo-count.service.ts:9` — no retry · no cost events · model hardcoded (`:60`)
- [ ] `vendor-intel/vendor-page-extractor.service.ts:13` — no retry · no cost events
- [ ] `ux-optimizer/ux-optimizer.service.ts:44` — no retry · no cost events
- [ ] *(scripts)* `scripts/enrich_wines.py:52`, `scripts/extract_menu_corpus.py:47`

**Standing counters:** retry coverage **1 / 7** · cost telemetry **0 / 7** · model-choice
conventions **5** (2 literals, 1 constant, 3 env vars).

## OD-03 gate — none of this may start before the box above it is ticked

- [ ] Overhead instrument built
- [ ] First reading of `nf_a.harness_overhead_ms` published
- [ ] Bake-off workloads chosen from real production task types
- [ ] Pass conditions authored by [[evaluation-doneability-charter]] and **committed before any candidate runs**
- [ ] `base_agent.py` entered as a **scored candidate**, not the polite incumbent
- [ ] Only then: schedule the OD-03 session

## Blocked / waiting on someone else

- [ ] **F-5** — are the 7 NestJS callsites in scope for OD-03? *(founder)*
- [ ] **The routing seam** — RM-1 vs `[[harness-model-routing-charter|aio-model-routing]]`, same mandate and metric *(founder)*
- [ ] **Per-caller inference budget number** — wrapper can enforce, cannot invent *(founder)*
- [ ] **Callsite migration** — [[engineering-charter]] owns adoption
- [ ] **NF-A field list** — [[neural-footprint-instrumentation-charter]] owns the contract we emit into
- [ ] **Verdicts** — [[evaluation-doneability-charter]]; without them `cost_per_completed_task` has no denominator

## Parked, with a trigger

- [ ] First-party model training (`services/agent-orchestrator/training/`, 3 scripts, no live loop) — unparks when a first-party model beats the API baseline on an RM-2 golden set **and** the cost delta justifies serving it
