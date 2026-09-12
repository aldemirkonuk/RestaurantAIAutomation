---
type: agent-stack
division: commercial
department: growth
team: conversion-funnel
status: designed
updated: 2026-08-27
metrics: [funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.fabricated_social_proof_count, funnel.step_dropoff, conversion.checklist_items_green]
links: ["[[conversion-funnel-charter]]", "[[conversion-funnel-schedule]]", "[[conversion-funnel-loops]]", "[[conversion-funnel-premortem]]", "[[0034-agent-stack-artifact]]", "[[growth-agent-stack]]", "[[technical-seo-ai-answer-surface-charter]]", "[[editorial-gate-charter]]", "[[compliance-privacy-charter]]", "[[skills-charter]]"]
---

# Conversion & Funnel — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> G5's card is the one whose obvious next step is forbidden. The instrument it needs exists and
> is dark on the wrong side of the login wall, and switching it on would make a **live page
> false** (`apps/web/src/pages/Privacy.tsx:30-31`) — so this agent censuses, reports, and blocks;
> it never enables. Mechanisms referenced only: harness → [[harness-runtime-charter]] (**OD-03
> open**), the mutation gate → [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `funnel-census-keeper` | Keep two numbers honest — how many funnel steps have any instrument at all, and what is collected from whom gated on what — and refuse to report a conversion rate over a funnel with no measurable steps | NEW |

## 2. Agent cards

```yaml
agent: funnel-census-keeper
unit: conversion-funnel
triggers:
  - schedule: "monthly — visit-to-activation read (L-G5-1, close_time monthly); rate and funnel.measurable_steps always together"
  - schedule: "weekly — tracking-surface census: what do we collect, from whom, gated on what"
  - schedule: "quarterly — social-proof provenance re-audit (L-G5-3), complete and not sampled"
  - topic: pr.touches_tracking_surface   # publisher: NONE (gap — L-G5-2 is a per-pr loop with no CI job behind it)
consumes:
  - "apps/web/src/lib/uxSignals.ts:15,20-23 — the one instrument: dark, and bucketed on the authenticated user id"
  - "apps/web/src/pages/Privacy.tsx:8-11,30-31,48-49 — the published promise and its own coupling contract"
  - "the activation path: apps/api-gateway/src/auth/auth.service.ts:650-651 → communications/gmail.service.ts:702"
  - "social-proof elements and their provenance — publisher: [[design-partner-operations-charter]] for anything about recovery"
emits:
  - "funnel.measurable_steps and conversion.tracking_surface_count → [[conversion-funnel-agenda-board]]"
  - "an unmapped social-proof list → [[editorial-gate-charter]] (consumer named; the verdict is the gate's, never this agent's)"
  - "a notice-amendment request → [[compliance-privacy-charter]] (consumer named). Growth never drafts privacy copy"
  - "an alt-text and accessibility defect list → [[client-surfaces-charter]]"
  - nf_a events (task_type: funnel_census)
routing_class: mechanical
quality_bar: "reporting funnel.visit_to_activated_rate while funnel.measurable_steps = 0 is a failed run. A coupling check that cannot determine the answer **blocks**, it never passes ([[conversion-funnel-schedule]])"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant, plus the two hard rules below
memory: conversion-funnel
escalates_to: "[[growth-charter]]"
```

**Two hard rules on this card, and both are the point of it.**
(1) **It may not enable an instrument.** Setting `VITE_UX_OPTIMIZER`, adding an analytics tag, or
widening what `uxSignals.ts` collects makes `apps/web/src/pages/Privacy.tsx:30-31` a false
statement on a live page — a published claim, which is the gate's surface and Compliance's
document, not an autonomy tier this card can grant itself ([[growth-premortem]] M4).
(2) **`funnel.fabricated_social_proof_count` = 0 is absolute.** The agent maps each social-proof
element to a named consenting counterparty and a dated artifact; it never authors one, and an
unmapped element is **listed**, never softened.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `privacy-coupling-check` | T3 | CI, on any diff touching tracking config, `apps/web/index.html`, or an analytics env var | Blocks unless the privacy notice changed in the same commit. **A run that cannot determine the answer blocks rather than passing** | `apps/web/src/pages/Privacy.tsx:8-11` states the coupling contract in a code comment — the one place CI cannot read it. The contract has existed and been unenforceable since the file was written | NEW |
| `funnel-step-census` | T3 | Monthly L-G5-1 | Enumerates which funnel steps have any instrument at all; emits `funnel.measurable_steps` and blocks reporting a rate while it is 0 | `funnel.measurable_steps` = 0 was asserted in this vault (charter §Metrics, 2026-08-24) **before anyone measured it**; the census is what turns that assertion into a reading | NEW |
| `alt-text-audit` | T3 | Quarterly accessibility pass, and per publication | Lists `<img>` elements with no `alt` on public surfaces | 17 `<img>` tags in `apps/web/src`, at least ten with no `alt`, including `apps/web/src/pages/VendorPortal.tsx:222` on the one public content route. This skill has a real backlog waiting for it today | NEW |

The schedule's fourth proposal, `social-proof-provenance`, cites structural pressure rather than a
past instance and is **not a row here** (README §3.3) — there is no testimonial, logo, rating or
case study in existence to have audited. Its constraint still binds the card above. Consumed,
owned elsewhere: the registry ([[skills-charter]]); the verdict on any social proof
([[editorial-gate-charter]]); the notice wording ([[compliance-privacy-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, with this
  team's standing request that **no skill guarding the privacy coupling be retired for inactivity**.
- **Episodic** — nf_a `task_type: funnel_census`. Needs `context.step`, `context.instrument`
  (`present` | `absent` | `dark`) and `context.gated_on` as jsonb keys — "dark" is a third state
  that a boolean would erase, and it is the exact state the one existing instrument is in.
- **Semantic** — `memory/` beside this file, index `conversion-funnel-MEMORY.md`. Founding facts:
  the one instrument is dark **and post-login by construction**, so it can never observe a first
  visit; `funnel.measurable_steps` = 0 for every pre-login step; the published privacy position and
  its dated source. A fourth fact is a **correction**, and keeping corrections is most of this
  layer's value: [[commercial]] §1.3 recorded "no product analytics of any kind", which is right
  about acquisition and wrong about the mechanism.
- **Working** — this card, the MEMORY index, charter §Mandate and the checklist table. `uxSignals.ts`
  and `Privacy.tsx` are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, with the L-G5-1 read. Failures first: every checklist item that
turned out to sit on an authenticated route becomes a fact naming the misclassification (it belongs
to [[activation-in-product-guidance-charter]], not here); every coupling near-miss becomes a fact
naming the file that changed without the notice; expire at 90 days. One PR; "no delta" when true.

## 5. Async contract

Cross-unit interaction is loops in [[conversion-funnel-loops]], NF-A events, vault PRs and skill
candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `pr.touches_tracking_surface` has no publisher | L-G5-2 has a `per-pr` close_time and no CI job behind it. Until one exists the coupling contract lives in a comment at `apps/web/src/pages/Privacy.tsx:8-11`, where nothing enforces it |
| The primary metric has no source | No pre-login instrument exists — not "off", but incapable: `uxSignals.ts:20-23` buckets on the authenticated user id. `funnel.visit_to_activated_rate` reads *unmeasurable*, and reporting a number beside `measurable_steps = 0` is the failure this card is written against |
| The 404 seam has two owners and no event | [[technical-seo-ai-answer-surface-charter]] owns the status code, G5 owns the page; the presentation half already exists unrouted at `apps/web/src/components/ui/error-state.tsx:142`. Neither team can ship the item alone ([[growth-directive]]) |
| Case-study evidence has a publisher and no supply | [[design-partner-operations-charter]] produces verified recovery; there is one design partner, not yet connected. G5 presents what S1 verified and nothing more — so today it presents nothing, which is the correct empty state |

## 6. Evidence today

- **PARTIAL — the instrument exists and is on the wrong side of the wall.**
  `apps/web/src/lib/uxSignals.ts` is a real interaction-telemetry client (rage clicks, dead clicks,
  time-to-interactive) posting to `apps/api-gateway/src/ux-optimizer/`, shipping dark behind
  `VITE_UX_OPTIMIZER === "true"` (`:15`) and bucketing on the authenticated user id (`:20-23`).
- **EXISTS — three things the census would report today.** The two-layer 404
  (`apps/web/src/App.tsx:302` under `vercel.json:12-15`) with its unrouted `NotFoundError`
  component; breadcrumbs built and used once (`apps/web/src/components/layout/Breadcrumbs.tsx:14`
  at `apps/web/src/pages/InsightCatalog.tsx:228`); and the alt-text backlog above.
- **EXISTS — the constraint.** `apps/web/src/pages/Privacy.tsx:30-31` promises no tracking cookies
  and no consent banner; `:48-49` says telemetry is off unless a deployment enables it and the
  operator opts in (`apps/web/src/components/settings/ServicesPermissions.tsx:29`).
- **NEW — the agent, all three skills, and every memory layer** except the NF-A tables
  (ADR 0006/0008). Nothing measures a stranger's first visit today, and nothing may start before
  the privacy question is answered.
