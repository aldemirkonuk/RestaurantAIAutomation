---
type: schedule
division: commercial
department: growth
team: conversion-funnel
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[conversion-funnel-charter]]", "[[conversion-funnel-loops]]", "[[conversion-funnel-agenda-board]]", "[[growth-schedule]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[editorial-gate-schedule]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[activation-in-product-guidance-charter]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# Conversion & Funnel — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per commit (CI)** | Privacy coupling check — any diff touching `apps/web/index.html`, tracking config, or an analytics env var must carry a `apps/web/src/pages/Privacy.tsx` diff in the same commit | Block, or `conversion.privacy_coupling_violations` |
| Per publication | CTA and social-proof review on any new public page — provenance present, no implied price | Pass, or a [[editorial-gate-schedule]] referral |
| Weekly | Privacy notice versus code — does the page still describe what the app does, including after a **removal**? | Notice-amendment request to [[compliance-privacy-charter]] |
| Weekly | Tracking-surface census — what do we collect, from whom, gated on what? | `conversion.tracking_surface_count`. Baseline: one, dark (`apps/web/src/lib/uxSignals.ts:15`) |
| Monthly | Visit-to-activation read — L-G5-1. Rate **and** `funnel.measurable_steps`, always together | `funnel.visit_to_activated_rate` or an explicit *unmeasurable* |
| Monthly | Checklist versus outcome — L-G5-4, including `conversion.items_on_authenticated_routes` | Reclassification to [[activation-in-product-guidance-charter]], or a green item |
| Monthly | 404 probe, shared with [[technical-seo-ai-answer-surface-schedule]] — status code **and** what a lost visitor sees | Seam status |
| Quarterly | Social-proof provenance re-audit — L-G5-3. **Complete, not sampled** | Corrections on-page; stale-claim list |
| Quarterly | Accessibility pass on public surfaces — alt text, focus order, contrast | Defect list to [[client-surfaces-charter]] |
| Quarterly | Charter staleness sweep ([[README]] §3.3, §6) | Archive or revision |

**Two jobs run today and neither is a growth job.** The privacy coupling check protects a
live promise, and the checklist-versus-outcome read produces an honest set of zeros. That is
where this team's leverage currently sits, and the schedule reflects it rather than
front-loading conversion work onto a site with no visitors.

**Anti-sprawl.** A job with no action for three consecutive runs is downgraded or deleted
([[README]] §6). The weekly tracking-surface census is the likely candidate — if the answer is
"one, dark" for three months it becomes monthly. **The CI coupling check is exempt**, for the
same reason [[editorial-gate-schedule]] exempts the human pass: a check that never fires is
either a well-behaved codebase or a check that stopped running, and only running it
distinguishes them.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.

**None exist.** The repo has one project skill, `.agents/skills/railway-config/SKILL.md`
([[README]] §3.1). Each row is bound to a job above, per the creation protocol
([[README]] §3.3).

| Proposed skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `privacy-coupling-check` | T3 | CI, on any diff touching tracking config, `index.html`, or an analytics env var | Blocks unless the privacy notice changed in the same commit. **A run that cannot determine the answer blocks rather than passing** | `apps/web/src/pages/Privacy.tsx:8-11` states the coupling contract in a code comment — the exact place CI cannot read it. The contract has existed and been unenforceable since the file was written |
| `funnel-step-census` | T3 | Monthly L-G5-1 | Enumerates which funnel steps have any instrument at all; output includes `funnel.measurable_steps` and blocks reporting a rate when it is 0 | `funnel.measurable_steps` = 0 was asserted in this vault before anyone measured it. The census is what turns an assertion into a reading |
| `social-proof-provenance` | T3 | Per publication and quarterly | Every social-proof element mapped to a named consenting counterparty and a dated artifact; unmapped elements are listed. **It produces a list, never a verdict** — the verdict is [[editorial-gate-schedule]]'s | The pressure is structural: one design partner, a checklist asking for case studies, and a recovery figure that means *we asked* ([[YC_WEDGE_PLAN]]:31-33) |
| `alt-text-audit` | T3 | Quarterly accessibility pass, and per publication | Lists `<img>` elements with no `alt` on public surfaces | 17 `<img>` tags in `apps/web/src`, at least 10 with no `alt`, including `apps/web/src/pages/VendorPortal.tsx:222` on the one public content route. This one has a real backlog waiting for it today |

**`privacy-coupling-check` is the one G5 skill worth building before its job has run manually
twice**, and for a specific reason: it is the only mechanism in Growth that prevents a
**legal** failure rather than a commercial one, and its failure mode must be *block*, never
*pass*. Designing that failure behaviour is the work; discovering it after a silent pass is
not recoverable.

**Registry ownership** sits with [[skills-charter]]; the 30-day review with
[[skill-lifecycle-anti-sprawl-charter]]. G5 authors, it does not govern — and it asks that no
skill guarding the privacy coupling ever be retired for inactivity.
