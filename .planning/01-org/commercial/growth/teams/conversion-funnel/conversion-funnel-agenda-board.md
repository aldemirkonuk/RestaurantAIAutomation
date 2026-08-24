---
type: agenda-board
division: commercial
department: growth
team: conversion-funnel
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[conversion-funnel-charter]]", "[[conversion-funnel-agenda-full]]", "[[conversion-funnel-loops]]", "[[conversion-funnel-schedule]]", "[[growth-agenda-board]]", "[[technical-seo-ai-answer-surface-charter]]"]
---

# Conversion & Funnel — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth/teams/conversion-funnel"
SORT type ASC
```

## Where this team sits in Growth

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/growth"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — untouched in 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/commercial/growth/teams/conversion-funnel"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- [ ] `funnel.visit_to_activated_rate` — **unmeasurable**. *Activated* = first POS-connected day,
      not signup. The definition does not change without a department decision
- [ ] `funnel.measurable_steps` — **0** pre-login. Reported next to the rate, always
- [ ] `funnel.fabricated_social_proof_count` — **0. Absolute. No exception path**
- [ ] `funnel.step_dropoff` — **n/a**: no steps defined
- [ ] `conversion.checklist_items_green` — listed last and never alone. Activity counter

## The conversion checklist — pre-account surface only

An item completed on an authenticated route is in-product work, not a G5 completion
([[conversion-funnel-premortem]] M3).

- [ ] **Custom 404 with a CTA** — component exists at
      `apps/web/src/components/ui/error-state.tsx:142`, routed nowhere.
      `apps/web/src/App.tsx:302` redirects instead. **Seam: G4 owns the status code**
- [ ] **CTA above the fold** — no public marketing page to place one on
- [ ] **Breadcrumbs** — component exists (`apps/web/src/components/layout/Breadcrumbs.tsx:14`),
      used on one page (`apps/web/src/pages/InsightCatalog.tsx:228`). A rollout question, not a build
- [ ] **Sticky mobile CTA** — absent
- [ ] **Case studies** — none. One design partner, not yet connected (`DEP-06` unchecked)
- [ ] **Real reviews only** — **a constraint, not an item.** See the zero above
- [ ] **Image alt text** — 17 `<img>` tags in `apps/web/src`, at least 10 with no `alt`,
      including `apps/web/src/pages/VendorPortal.tsx:222` on the one public content route
- [ ] **Local business schema** — **deliberately not shipped.** No premises; the markup would assert one

## The measurement decision — highest-value unblocked work

- [ ] Options paper written: log-derived counts → cookieless first-party sessions →
      first-party tag → third-party tag
- [ ] **Exhaust the first two before proposing either of the last two**
- [ ] CI coupling check proposed: tracking config and the privacy notice change in the same
      commit or neither changes
- [ ] `apps/web/src/pages/Privacy.tsx:30-31` promises **no tracking cookies and no banner**;
      `:48-49` says telemetry is off by default; `:8-11` states the change contract
- [ ] `apps/web/src/lib/uxSignals.ts:15` is dark and buckets on an authenticated user id
      (`:20-23`) — **it cannot see a first visit**

## Blocking

- [ ] **No public page to convert on**
- [ ] **Measurement approach undecided** — and it is a privacy decision before it is a technical one
- [ ] **404 seam unagreed** with [[technical-seo-ai-answer-surface-charter]]
- [ ] **No verified recovery number** — no case study is honest until one exists

## Standing prohibitions

- [ ] No social proof without a named consenting counterparty and a dated artifact.
      Every element passes [[editorial-gate-charter]]
- [ ] No CTA implying a price, a tier, or a "starting at" — founder-deferred
- [ ] No conversion rate reported while `funnel.measurable_steps` is 0
- [ ] Growth never drafts privacy copy
