---
type: loops
division: commercial
department: growth
team: conversion-funnel
status: provisional
metrics: [funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.step_dropoff, funnel.fabricated_social_proof_count, conversion.checklist_items_green, conversion.privacy_coupling_violations]
updated: 2026-08-24
links: ["[[conversion-funnel-charter]]", "[[conversion-funnel-premortem]]", "[[conversion-funnel-directive]]", "[[conversion-funnel-schedule]]", "[[growth-loops]]", "[[technical-seo-ai-answer-surface-loops]]", "[[editorial-gate-loops]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_ids: ["g5-visit-to-activation", "g5-privacy-coupling", "g5-social-proof-provenance", "g5-checklist-outcome"]
loop_close_times: ["monthly", "per-pr", "quarterly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Conversion & Funnel — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-G5-1 — Visit to activation

```yaml
type: loop
id: g5-visit-to-activation
owner: conversion-funnel
measures: [funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.step_dropoff]
changes: [conversion.page_layout, conversion.cta_policy, content.commission_list]
inputs_from: [content-production, technical-seo-ai-answer-surface, design-partner-operations]
outputs_to: [growth, search-demand-research, analytics-bi, product-vision]
close_time: monthly
status: proposed
```

G5's half of [[growth-loops]] L-GRO-4, and the only loop in the department that measures
whether any of the rest mattered. *Activated* is **first POS-connected day**, and the
definition does not move at team level.

**`funnel.measurable_steps` is reported in the same breath as the rate, every time.** Today
it is 0 for every pre-login step, which means the rate has no referent at all — and a loop
that reports a confident rate over an invisible funnel is worse than one that reports
*unmeasurable*. When the number is small it is still reported: with one design partner whose
Toast credentials are unconfigured (`DEP-06`), an honest zero is the correct reading and it
keeps every other number in Growth legible.

**Blocked by:** no pre-login instrument that keeps `apps/web/src/pages/Privacy.tsx:30-31`
true, and no public page to arrive on.
**Counters:** [[conversion-funnel-premortem]] M4.

---

## L-G5-2 — Privacy coupling

```yaml
type: loop
id: g5-privacy-coupling
owner: conversion-funnel
measures: [conversion.privacy_coupling_violations, funnel.measurable_steps, conversion.tracking_surface_count]
changes: [conversion.instrumentation, privacy.notice_text]
inputs_from: [compliance-privacy, privacy-engineering, client-surfaces]
outputs_to: [compliance-privacy, growth, decision-office]
close_time: per-pr
close_time_note: "per commit (CI), reviewed weekly"
status: proposed
```

The mechanism that stops [[conversion-funnel-premortem]] M2, and the one loop in Growth that
protects a **legal** surface rather than a commercial one. Two halves:

- **Per commit, in CI:** any diff touching `apps/web/index.html`, tracking configuration, or
  an analytics environment variable must carry a diff to `apps/web/src/pages/Privacy.tsx` in
  the same commit. `apps/web/src/pages/Privacy.tsx:8-11` already states this contract in a
  code comment, which is exactly where an automated check cannot read it.
- **Weekly review:** does the notice still describe what the code does? The failure is not
  only additive. Removing telemetry without updating the page leaves a claim that is stale
  rather than false, and stale claims are how a page stops being trustworthy quietly.

`conversion.tracking_surface_count` is tracked so the answer to "what do we collect" is a
number rather than a recollection. Baseline: one, dark —
`apps/web/src/lib/uxSignals.ts:15`, gated behind `VITE_UX_OPTIMIZER`, post-authentication.

**`close_time` note.** The field carries `weekly` because a machine-readable field takes one
value and the review is the slower half. The CI check is a commit-time gate rather than a
loop close, and saying so is more honest than inventing a cadence for it.

**Runnable today**, and the only Growth loop that protects something already live.

---

## L-G5-3 — Social-proof provenance

```yaml
type: loop
id: g5-social-proof-provenance
owner: conversion-funnel
measures: [funnel.fabricated_social_proof_count, conversion.social_proof_elements, editorial.claims_now_stale]
changes: [conversion.social_proof_block, conversion.empty_state_copy]
inputs_from: [design-partner-operations, editorial-gate, narrative-collateral]
outputs_to: [editorial-gate, growth, red-team, decision-office]
close_time: quarterly
status: proposed
```

Every social-proof element on every public surface is re-checked against its provenance:
named consenting counterparty, dated artifact, and a claim no stronger than the artifact
supports. Target for `funnel.fabricated_social_proof_count` is **zero**, and any non-zero is
a department-level escalation rather than a metric movement.

The specific quarterly question, because it is the one that will decay first: **does any
figure on a public page still mean what it meant when it shipped?** *Dollars recovered* means
*we asked* until an 812 credit memo lands ([[YC_WEDGE_PLAN]]:31-33), sourced through
[[design-partner-operations-charter]]. A claim that has gone stale is corrected on the page,
not deleted — deletion leaves the screenshot and removes the record.

Quarterly and **complete rather than sampled**, which is possible only because the surface is
tiny. When it stops being possible the close-time changes and this loop says so.

**Partly runnable today:** there are no public social-proof elements, so the first reading is
trivially zero. That reading is worth taking anyway, because it establishes the number before
there is pressure on it.

---

## L-G5-4 — Checklist versus outcome

```yaml
type: loop
id: g5-checklist-outcome
owner: conversion-funnel
measures: [conversion.checklist_items_green, funnel.measurable_steps, funnel.visit_to_activated_rate, conversion.items_on_authenticated_routes]
changes: [conversion.checklist_scope, growth.team_allocation]
inputs_from: [client-surfaces, design, technical-seo-ai-answer-surface]
outputs_to: [growth, activation-in-product-guidance, decision-office]
close_time: monthly
status: proposed
```

G5's half of [[growth-loops]] L-GRO-6, with one addition its sibling does not need:
`conversion.items_on_authenticated_routes`. Breadcrumbs, alt text, and a sticky CTA can all be
completed **behind the login wall**, where they are real improvements and zero of them are
visible to a stranger. That number is the fingerprint of
[[conversion-funnel-premortem]] M3, and the loop's change is to reclassify the work as
in-product and hand it to [[activation-in-product-guidance-charter]] rather than count it.

**Runnable today**, and its first reading is honest: zero items green, zero measurable steps,
and a checklist whose scope has never been tested against a public page.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-G5-1 visit to activation | monthly | premortem M4 | No — no instrument, no public page |
| L-G5-2 privacy coupling | per commit (CI) + weekly review | premortem M2 | **Yes** — and it protects something already live |
| L-G5-3 social-proof provenance | quarterly | premortem M1 | Partly — the first reading is a trivial zero worth recording |
| L-G5-4 checklist versus outcome | monthly | premortem M3 | **Yes** — first reading is zero across the board |

**The loop that can close today is the one guarding a live privacy promise, not the one
measuring growth.** That is an accurate description of where this team's leverage currently
is, and it is the argument for doing L-G5-2's CI check before anything else on the checklist.
