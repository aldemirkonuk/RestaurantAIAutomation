---
type: agenda-board
division: commercial
department: growth
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[growth-charter]]", "[[growth-agenda-full]]", "[[growth-loops]]", "[[growth-schedule]]", "[[growth-premortem]]"]
---

# Growth — Board

> **PROVISIONAL — no work done yet.**

Bullets and queries only. Prose belongs in [[growth-agenda-full]].

## Every Growth artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/growth"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/commercial/growth"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/commercial/growth"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Premortem coverage — every team must have one

```dataview
LIST
FROM "01-org/commercial/growth"
WHERE type = "premortem"
SORT default(team, "") ASC
```

## The five team outcomes (hand-entered until the jobs exist)

No activity counters on this board by design — no drafts written, no keywords harvested,
no checklist percentage. [[growth-premortem]] M1 and M3 are both the department reporting
activity instead of outcome.

- [ ] `demand.uncovered_keyword_count` — **unmeasurable**: no Search Console property
- [ ] `content.published_units_per_week` — **0**, and correctly 0 until a publishing target exists
- [ ] `editorial.claims_traceable_pct` — **n/a**: nothing published, provenance format unwritten
- [ ] `seo.indexed_pages` — **0**: no `robots.txt`, no sitemap, no content route
- [ ] `answer_surface.assistant_citations` — **0**, and unmeasured; no standard dashboard reports this
- [ ] `funnel.visit_to_activated_rate` — **unmeasurable**: `funnel.measurable_steps` = 0 pre-login

## The three zeros — any non-zero is a department-level escalation

- [ ] `editorial.gate_bypass_count` — **0**. One bypass invalidates the pipeline, not one article
- [ ] `funnel.fabricated_social_proof_count` — **0**. Absolute; unrecoverable if breached
- [ ] Published claims stronger than the evidence — **0**. Specifically: *dollars recovered*
      means **we asked**, not we received ([[YC_WEDGE_PLAN]]:31-33)

## Diagnostics that stop a checklist reading green on an empty site

- [ ] `seo.soft_404_rate` — **100%** baseline. `vercel.json:11-13` returns 200 for every
      unmatched URL; `apps/web/src/App.tsx:302` then redirects client-side
- [ ] `funnel.measurable_steps` — **0** pre-login. `apps/web/src/lib/uxSignals.ts:15` is dark
      and post-authentication
- [ ] `demand.wedge_share_of_corpus` — **n/a**: no corpus yet

## Blocking decisions

- [ ] **Publishing target** — inside `apps/web`, separate surface, or static generator.
      Blocks all eight items in [[growth-agenda-full]]. Not yet in [[OPEN-DECISIONS]]
- [ ] **CM-F1** — merge [[content-production-charter]] and [[editorial-gate-charter]]?
      **Recorded, not resolved**
- [ ] **Domain** — `wineops.ai` still live in shipped surfaces; publishing under a name we
      are migrating away from ([[brand-identity-charter]])
- [ ] **Pre-login measurement vs. the published privacy position**
      (`apps/web/src/pages/Privacy.tsx:30-31`) — [[compliance-privacy-charter]] holds the pen

## Standing prohibitions

- [ ] Growth proposes **no pricing** — founder-deferred, [[unit-economics-pricing-charter]] owns it
- [ ] Growth sketches **no target list** — founder-deferred, Sales owns it
- [ ] No social proof without a named, consenting counterparty and a dated artifact
