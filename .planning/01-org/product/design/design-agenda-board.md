---
type: agenda-board
division: product
department: design
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[design-charter]]", "[[design-agenda-full]]", "[[design-loops]]", "[[design-schedule]]", "[[design-premortem]]", "[[design-directive]]"]
---

# Design — Board

> **PROVISIONAL — no work done yet.**

## Every Design artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/design"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/product/design"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/design"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Teams with no premortem — the artifact that is skipped first

```dataview
LIST
FROM "01-org/product/design"
WHERE type = "charter" AND team != null
  AND !contains(file.outlinks, link(team + "-premortem"))
```

## Standing counters (hand-entered until the jobs in [[design-schedule]] exist)

Two are measured. Four are not. An unmeasured metric is written **unmeasured**, never
blank — a blank cell reads as zero and zero reads as fine.

- [ ] `design.paths_closed_per_month` — **rate never measured**; ~90–100 of **910**
      closed cumulatively
- [ ] `design.deferred_unblocker_ratio` — **uncomputed**; the data is in
      `UX_PATHS_CATALOG.md:10-67` and nobody has divided
- [ ] `design.ledger_drift_days` — **non-zero, unknown**. Known stale row: `:49` vs
      `:1013` vs `SeatingDensityPanel.tsx` on disk
- [x] `design.token_source_count` — **2** (`apps/web`, `apps/mobile/src/design/tokens.ts`).
      Target **1**
- [ ] `design.primitive_documented_ratio` — **5 stories / 18 primitives** in
      `apps/web/src/components/ui/`; **0 of ~11** in `packages/ui`; **0** in `apps/mobile`
- [ ] `design.system_composition_pct` — **undefined**; the denominator does not exist yet
- [x] `design.resolved_question_rate` — **15 of 43** indexed sketches carry a winner;
      **28 `Winner: null`**
- [x] `design.sketch_index_completeness` — **43 of 53** directories indexed; **1** manifest
      row (`039`) has no directory
- [ ] `design.winner_shipped_conversion` — **2 of 53** (sketch 038 → `/inventory`;
      052 → `scripts/docgen/templates/wineops_document.html`)
- [ ] `design.time_to_first_real_action_staff_min` — **unmeasured, and no event exists to
      compute it from**
- [ ] `design.role_default_coverage_pct` — **0**. Role-based defaults do not exist;
      `NEW-513` deferred at `UX_PATHS_CATALOG.md:63`
- [x] `design.ux_optimizer_rows` — **0**, and **0 is the correct value**. Non-zero means
      [[AGENT_NATIVE_UI_DECISION]]:78 was reversed without a supersede-ADR → incident,
      routed to [[decision-office-charter]]

## Open, blocking, named

- [ ] **Commissioning authority** — can [[ux-path-burn-down-charter]] commission the
      endpoints its deferred rows need? Unanswered → the largest team cannot function
- [x] **Fork ID collision resolved** — `product.md:858-862` proposed OD-20…OD-24 while
      OD-20…OD-23 were already issued in the register; renamespaced
      to **PROD-F1…PROD-F5** ([[FORK-REGISTRY]])
- [ ] **The count correction** — "760 paths" appears in [[engineering-premortem]] M5 and
      in founder notes. It is **910**
