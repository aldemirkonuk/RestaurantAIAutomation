---
type: agenda-board
division: product
department: design
team: design-system-motion-substrate
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[design-system-motion-substrate-charter]]", "[[design-system-motion-substrate-agenda-full]]", "[[design-system-motion-substrate-loops]]", "[[design-system-motion-substrate-schedule]]", "[[design-system-motion-substrate-premortem]]", "[[design-agenda-board]]"]
---

# Design System & Motion Substrate — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design"
WHERE team = this.team
SORT type ASC
```

## Where this team sits in Design

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/design"
WHERE type = "charter"
SORT team ASC
```

## Stale — 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/design"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops without a close-time

```dataview
LIST
FROM "01-org/product/design"
WHERE team = this.team AND type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the monthly census exists)

The forward metric is listed **first, deliberately**. If the documentation number is ever
shown without it, [[design-system-motion-substrate-premortem]] M1 is already underway.

- [ ] `design.system_composition_pct` — **undefined**. No denominator exists. First
      deliverable is the definition, not a number
- [x] `design.token_source_count` — **2** (`apps/web` layer, `apps/mobile/src/design/tokens.ts`).
      Target **1**. **Escalates at one quarter** if unchanged with no migration plan
- [ ] `design.token_divergence_values` — **uncounted**. Values present in one source and
      not the other. Rises before entrenchment does
- [x] `design.primitive_documented_ratio` — **5 of 18** in `apps/web/src/components/ui/`;
      **0 of ~11** in `packages/ui`; **0** in `apps/mobile`
- [ ] `design.a11y_violations_per_pr` — **unmeasured, not zero**. §X `NEW-667…676`
      (`UX_PATHS_CATALOG.md:1493`) is prose, enforced nowhere
- [ ] `design.bespoke_components_added` — **uncounted**. The number that shows the system
      failing one afternoon at a time
- [ ] `design.primitive_request_response_days` — **no SLA published**. Slower than a sprint
      and bespoke wins on merit

## Convergence debt inherited from the sketch corpus

- [ ] **043** `motion-signature-moments` — `Winner: null`
- [ ] **044** `wineops-signature-motions` — `Winner: null` (Sediment Settle, Cellar Breath,
      Cork Commit)
- [ ] **045** `ops-signature-motions` — `Winner: null` (Ledger Fold, Cellar Route Lock,
      Provenance Stitch)
- [ ] **046** `cellar-commit-motions` — `Winner: null` (Cork Seat, Capsule Sweep, Bin Breath)
- [x] **042** `mobile-stack-capabilities` — decided: *H — RN Skia + Reanimated*. **Not
      reopened**

Nine fully-specified motions with trigger / motion / haptic / anti-gimmick clauses, a
chosen stack, and zero winners. Withdraw or decide — the null is the only unacceptable
state.

## Open, blocking, named

- [ ] **Migration budget** for one token source — without it the metric comes off this board
- [ ] **Can this team block a merge?** A warn-only lint is ignored by week six
- [ ] **Storybook runner coverage** for `packages/ui` — content is ours, machinery is
      [[client-surfaces-charter]]'s
- [ ] `MANIFEST.md` "Design Direction" still says **"WineOps AI"** — [[media-brand-charter]]
      retires the string; we stop propagating it into code
- [ ] Primitives must not assume Next.js. `apps/web` is a **Vite SPA + react-router-dom**
      (`apps/web/package.json:8,55,94`)
