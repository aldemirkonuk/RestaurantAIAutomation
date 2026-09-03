---
type: agenda-board
division: research-math
department: research-math
status: active
metrics: []
updated: 2026-08-28
links: ["[[research-math-charter]]", "[[research-math-agenda-full]]", "[[research-math-loops]]", "[[research-math-schedule]]", "[[research-math-premortem]]", "[[research-math-agent-stack]]", "[[research-math-questions]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[backtests-charter]]", "[[0039-activation-plan-of-record]]", "[[0036-cost-routing-two-plans-in-harmony]]"]
---

# Research & Math — Board

**Board of 2026-08-28.** Tasks live in [[research-math-agenda-full]]; this file is the
query surface and the metric set. Every reading below is measured or says
*not measured* — never inferred ([[research-math-agent-stack]] §2, quality bar).

## Every Research & Math artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/research-math"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/research-math"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Agendas that have re-rotted to provisional — the wave-3 check

An agenda that reverts to `provisional`, or that stops being touched, is the failure
ADR 0039 §Consequences names. This query is how it gets caught.

```dataview
TABLE WITHOUT ID
  file.link AS Agenda,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/research-math"
WHERE type = "agenda-full" OR type = "agenda-board"
SORT updated ASC
```

## Loops missing a close-time — a loop that cannot say how fast it closes is a diagram

```dataview
LIST
FROM "01-org/research-math"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/research-math"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Anything anywhere claiming an `nf_a.*` metric — the seam audit's input

Scoped to the whole org, not to one division: OD-29's duplication was found *across* a
division boundary, and a query that cannot see across one cannot find the next.

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  department AS Dept,
  metrics AS Metrics
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND any(map(metrics, (m) => startswith(m, "nf_a")))
SORT division ASC, department ASC
```

## The four primary metrics — these rows always render, blank is a status

| Metric | Reading (2026-08-28) | Owner |
|---|---|---|
| `nf_a.event_completeness` | **not measured** — both runtimes emit (`model-client.service.ts:413`, `spend_logger.py:387`); no completeness number has ever been computed from the table. First publish due 2026-09-04 (RM-12) | [[neural-footprint-instrumentation-charter]] |
| `nf_a.cost_per_completed_task` | **not measured** — and it has no agreed denominator until RM-06 writes one (ADR 0036 gives RM-1 that half) | [[harness-model-routing-charter]] |
| `nf_a.harness_overhead_ms` | **not measured** — `grep harness_overhead apps services scripts` → **0 hits** (2026-08-28). Still the number that decides OD-03 | [[harness-model-routing-charter]] |
| `nf_a.verified_task_success_rate` | **not measured** — computable since P3.0 and never published | [[evaluation-doneability-charter]] |
| *(gap metric)* verified − self-reported (`base_agent.py:144`) | **not measured** — the department's actual product. Publishes with its pair or not at all | [[evaluation-doneability-charter]] |
| *(inherited gate)* `identity.false_merge_count` | **0** — and it must stay 0 | [[evaluation-doneability-charter]] |
| *(new, proposed RM-14)* verdict **strength** distribution per task type | **not defined yet** — the ladder is due 2026-09-18, the first reading 2026-09-25 | [[evaluation-doneability-charter]] |
| *(new, proposed RM-08)* `bt.outcome_regrade_delta` | **not measured** — first replay due 2026-09-18 | [[backtests-charter]] |

> A proxy may appear **indented under** the metric it stands for. It may never appear
> beside it. [[research-math-premortem]] M2.

## Standing counters — measured 2026-08-28, hand-entered until the jobs exist

- [x] Task types emitting · carrying a verdict · knowingly exempt · **ungraded** — **39 · 27 · 12 · 0** (`python3 scripts/check_task_types_are_graded.py` → PASS)
- [ ] Non-test Python files writing `"parse_v1"` as a bare literal — **10**; basis constants module on the Python side — **none** (the gateway's is `verdict-bases.ts`)
- [ ] Distinct `outcome_basis` values the Python runtime writes — **2** (`parse_v1` ×15, `constraint_v1` ×1)
- [ ] Verdict bases defined in the gateway vocabulary — **9** (`verdict-bases.ts`)
- [ ] Declared agent cards in the org this department must be able to benchmark — **102** across 100 units; `routing_class` split **36 mechanical / 36 extraction / 30 judgment** (`00-index/cards.json`)
- [ ] `nf_a.skill_id` exists — **no** (`scripts/agents/run_card.py:254` returns the literal *"unmeasurable — nf_a.skill_id does not exist"*)
- [ ] Golden sets with a named source of **free** negatives — **1** (beverage identity, 732,874 pairs)
- [ ] Backtest replays ever run — **0**. Entry trigger **MET** 2026-08-28 ([[backtests-agent-stack]] §6)
- [ ] Project skills in `.claude/skills/` — **4**, and **all four declare an applied-ai owner** (`fleet-census`, `harness-contract-audit`, `model-pin-census`, `registry-index-refresh`); T4 activates at ~15. Two sit on RM territory — RM-18
- [ ] `.agents/skills/railway-config/SKILL.md`, cited as the repo's one skill by this department's charter and schedule — **the path no longer exists** (2026-08-28)

## Non-preemptible lane — slipping any of these is a founder decision, recorded

- [ ] The OD-03 bake-off on this repo's own workloads — *no pick from repute* (OD-03). RM-04 writes its methodology; OD-52 is checked first
- [ ] Golden sets with real negatives, for three task types — RM-16
- [ ] NF-A brought to one joinable event, and read — RM-12

## Blocked on someone else

- [ ] **`approval_v1` operated as a gate** — [[agent-evaluation-gates-charter|aio-evaluation-gates]] operates; we define (TECH-F3). RM-03 files the ask
- [ ] **`provider_ms` in the wrapper** — `aio-model-routing` owns the operation under ADR 0036; RM-05 supplies the definition
- [ ] **`nf_a.skill_id` column + runner cron** — Track A4 lands in parallel; RM-10 owns what it *means*
- [ ] **A provider-invoice feed** — publisher NONE; reconciliation depends on a human-fetched bill (RM-13)
- [ ] **The callsite census** — produced by `model-pin-census` (applied-ai's `spend-sentinel`); we consume it and define what adoption means, we do not rebuild it (RM-17)

## Open forks on this board

- [ ] **OD-52 before OD-03** — does the bake-off compare reasoning layers *on* our messaging infra, or that infra to reasoning layers?
- [ ] **The CI eval cost cap** — `v3.0-TECH-DEBT.md:326-330` requires one and names no number. Founder's
- [ ] **May a verdict block a product ship**, or only a sibling's work?
- [ ] **Division vs department** — [[0001-mudavym-single-entity]] review trail vs ORG_STRUCTURE §2. The oldest open item here
- [ ] **INTEL-F5** — are the (now-migrated) gateway callsites in scope for OD-03?
- [x] ~~The routing seam~~ — **closed 2026-08-28** by [[0036-cost-routing-two-plans-in-harmony]]: methodology here, operation there
