---
type: agenda-board
division: intelligence
department: research-math
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[research-math-charter]]", "[[research-math-agenda-full]]", "[[research-math-loops]]", "[[research-math-schedule]]", "[[research-math-premortem]]"]
---

# Research & Math — Board

> **PROVISIONAL — no work done yet.**

## Every Research & Math artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/research-math"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/research-math"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Loops missing a close-time — a loop that cannot say how fast it closes is a diagram

```dataview
LIST
FROM "01-org/intelligence/research-math"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/intelligence/research-math"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Anything in the division claiming an `nf_a.*` metric — the department must recognise all of it

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  department AS Dept,
  metrics AS Metrics
FROM "01-org/intelligence"
WHERE type = "charter" AND any(map(metrics, (m) => startswith(m, "nf_a")))
SORT department ASC
```

## The four primary metrics — these rows always render, blank is a status

| Metric | Reading | Owner |
|---|---|---|
| `nf_a.event_completeness` | **0%** (NestJS surface) · partial (Python, 2 unjoined tables) | [[neural-footprint-instrumentation-charter]] |
| `nf_a.cost_per_completed_task` | **unmeasured** — no cost events on NestJS, no verdict anywhere | [[harness-model-routing-charter]] |
| `nf_a.harness_overhead_ms` | **unmeasured** — no instrument exists; blocks OD-03 | [[harness-model-routing-charter]] |
| `nf_a.verified_task_success_rate` | **unmeasured** — near zero outside the merge-policy gate | [[evaluation-doneability-charter]] |
| *(gap metric)* verified − self-reported (`base_agent.py:144`) | **unmeasured** — the department's actual product | [[evaluation-doneability-charter]] |
| *(inherited gate)* `identity.false_merge_count` | **0** — must stay 0 | [[evaluation-doneability-charter]] |

> A proxy may appear **indented under** the metric it stands for. It may never appear
> beside it. [[research-math-premortem]] M2.

## Standing counters (hand-entered until the jobs exist)

- [ ] NestJS model callsites emitting cost events — **0 of 7**
- [ ] Model callsites with retry — **1 of 7** (`menus/parsers/scan-parser.service.ts`)
- [ ] Model-choice conventions in `apps/api-gateway/src` — **5** (2 literals, 1 constant, 3 env vars)
- [ ] NF-A fields on a single joinable row — **max 4 of 8** anywhere in the repo
- [ ] `SpendLogger.log()` carries an `agent` argument — **no** (`spend_logger.py:41-48`)
- [ ] Task types with written doneability criteria — **0**
- [ ] Golden sets with a named source of **free** negatives — **1** (beverage identity, 732,874 pairs)
- [ ] Project skills in the repo — **1** (`.agents/skills/railway-config/SKILL.md`); T4 activates at ~15

## Non-preemptible lane — slipping any of these is a founder decision, recorded

- [ ] OD-03 bake-off on this repo's own workloads — *no pick from repute* (`OPEN-DECISIONS.md:14`)
- [ ] Golden sets with real negatives, for three task types
- [ ] NF-A backfill to a joinable event

## Blocked on someone else

- [ ] **OD-11 column contract** — needs a named owner split with [[data-charter]] before any DDL
- [ ] **Seven callsite migrations** — [[engineering-charter]] owns adoption; needs a deprecation date
- [ ] **Fork F-3** (`operator` as a fourth `subject_type`) — folds into the OD-11 session

## Open forks on this board

- [ ] Division-vs-department wording of the compensation clause ([[0001-mudavym-single-entity]] vs [[ORG_STRUCTURE]] §2)
- [ ] The routing seam — [[harness-model-routing-charter]] vs `[[aio-model-routing]]`
- [ ] The evaluation seam — [[evaluation-doneability-charter]] vs [[aio-evaluation-gates]] (`technology.md:845`; note the local ID collides with global OD-21)
- [ ] **F-5** — are the seven NestJS callsites in scope for OD-03?
