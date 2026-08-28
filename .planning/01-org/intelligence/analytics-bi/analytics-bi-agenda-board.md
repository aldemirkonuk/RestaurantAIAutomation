---
type: agenda-board
division: intelligence
department: analytics-bi
status: active
metrics: []
updated: 2026-08-28
links: ["[[analytics-bi-charter]]", "[[analytics-bi-agenda-full]]", "[[analytics-bi-premortem]]", "[[analytics-bi-loops]]", "[[analytics-bi-schedule]]", "[[analytics-bi-directive]]", "[[analytics-bi-agent-stack]]", "[[analytics-bi-questions]]", "[[0039-activation-plan-of-record]]", "[[0020-no-fabricated-answers]]"]
---

# Analytics & BI — Board

> **Agenda of 2026-08-28.** Tasks live in [[analytics-bi-agenda-full]]; this file is the
> live view. **Five numbers, never summed** — the department has no health score by
> design ([[analytics-bi-agent-stack]] §2, hard rule). Every counter below carries a
> value or the words *not computed* (ADR 0020).

## Every Analytics & BI artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi"
SORT default(team, "") ASC, type ASC
```

## Anything still provisional in this department

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi"
WHERE status = "provisional"
SORT type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/analytics-bi"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/analytics-bi"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Blocked loops — anything waiting on a unit we do not control

```dataview
LIST
FROM "01-org/intelligence/analytics-bi"
WHERE type = "loops" AND contains(file.content, "status: blocked")
```

## Open questions anywhere in the department

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  open_questions AS Open,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/intelligence/analytics-bi"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Division-wide view — how we compare to our siblings

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  department AS Department,
  default(team, "— dept —") AS Unit,
  status AS Evidence
FROM "01-org/intelligence"
WHERE type = "charter"
SORT department ASC, status ASC
```

## The five, with their denominators — hand-entered until A1 lands

Never averaged, never ranked, never totalled.

- [ ] `analytics.satisfiable_candidate_share` — **144 / 573 = 25.1%** without POS · **38 / 573 = 6.6%** consumption-only · **67.4%** with 66 POS checks (`POS-BRIDGE-AUDIT` §A.1). Re-read per live restaurant → **D2**, weekly from 2026-09-04
- [ ] `analytics.insight_acceptance_rate` — **not computed.** Both tables exist; no query joins them → **D1**, fortnightly from 2026-09-11
- [ ] `analytics.kpi_ground_truth_agreement` — **0%, blocked** on §44.7 SimPOS (`v3.0-TECH-DEBT.md:309`). Publishing the 0 is the point → **A5**, monthly from 2026-09-25
- [ ] `analytics.metric_claim_divergence_count` — **two live divergences**, censused 2026-08-28: insight-type count (5 assertive code sites · 7 lines in `UX_PATHS_CATALOG.md` §Z · 10 stale-as-unresolved rows in 3 other units) and feature count (360 vs 460) → **B1–B5**
- [ ] `analytics.engine_service_test_ratio` — **149 cases / 3,679 engine lines · 23 cases beside ~5,600 service lines.** Inverted, less so than in the charter → **D4**, 2026-10-09

## Secondary counters

- [ ] `analytics.candidate_type_count` — **573** (OD-33, settled 2026-08-26). *Never publish without the share above.* CI pins only `>= 200` → **B1**, 2026-09-04
- [ ] `analytics.registry_binding_share` — **33 keys bind 69 distinct `catalogIds`, max id 352; zero bindings into Batch 6 (361–460).** Measured 2026-08-28 → **B6**
- [ ] `analytics.top_rank_ignore_rate` — **not computed.** `position = 1`, never acted on → **D1**
- [ ] `analytics.claims_without_provenance` — **not computed.** The register does not exist → **A3**, 2026-09-11
- [ ] `analytics.consultant_enabled_restaurants` — **unlisted.** No expiry mechanism exists → **C4**, weekly from 2026-09-04
- [ ] `analytics.unnamed_threshold_count` — **5** (`insight-generator.service.ts:200, 550, 867, 1017, 1107`) → **D3**, 2026-09-25
- [ ] `analytics.silent_zero_paths` — **6 `Promise.allSettled` sites** in `analytics/` collapse rejection to `null`; one of them builds the consultant evidence pack → **C1**, 2026-09-11
- [ ] `analytics.unknown_evidence_roots` — **collected, never reported.** `checkGrounding()` returns them today → **C3**, 2026-09-25

## Demand on this department — measured, not assumed

- **28** loops in other units name Analytics & BI or one of its teams as `inputs_from`;
  **25** send outputs to us (`.planning/00-index/loops.json`, counted 2026-08-28).
  Each must map to a board row or a gap row → **A2**, 2026-09-11.
- **22** loops are owned here: 20 `proposed`, 2 `blocked`.

## Live exposures we do not own but refuse to stand on

- [x] ~~**OD-20** — 39 unguarded routes on `analytics.controller.ts`~~ **RESOLVED
      2026-08-25** — class-level `@UseGuards(JwtAuthGuard)` at `analytics.controller.ts:51`
- [ ] **§44.7 SimPOS** — blocks `analytics.kpi_ground_truth_agreement`. Owner:
      [[engineering-charter]]. Three identical restatements escalate to the founder
- [ ] **INTEL-F3** — no `subject_type` for the restaurant operator; blocks
      `analytics.insight_acceptance_rate` from the neural footprint. Owner:
      [[decision-office-charter]] / OD-11
- [ ] **`analytics.claim_published` has no publisher** — nothing emits when a figure
      ships. Finding, not a task ([[analytics-bi-agenda-full]] §7)
