---
type: loops
division: commercial
department: media-brand
status: provisional
metrics: [nf_b.choice, nf_b.context]
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-directive]]"
  - "[[brand-identity-loops]]"
  - "[[narrative-collateral-loops]]"
  - "[[social-community-loops]]"
  - "[[customer-relationship-research-loops]]"
loop_count: 4
loop_count: 4
loop_ids: ["legacy-brand-surface-burndown", "headline-claim-consistency", "consent-register-reconciliation", "outward-surface-inventory"]
loop_close_times: ["weekly", "monthly", "weekly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Media & Brand — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

Four department-level loops. Team-level loops live in the four team `loops.md` files and are
not duplicated here; where a department loop consumes one, `inputs_from` names it.

---

## 1. Legacy-brand surface burndown

The department's only measurable loop today, and the reason it is first.

```yaml
type: loop
id: legacy-brand-surface-burndown
owner: media-brand
measures: [brand.legacy_name_refs_shipped, brand.legacy_domain_refs_shipped]
changes: [source.display_strings, ci.brand_guard]
inputs_from: [brand-identity]
outputs_to: [engineering, growth, sales]
close_time: weekly
status: proposed
```

**Measures two numbers, deliberately.** A single count has already hidden half the problem
twice: the host-scoped scan reported 10, the domain-scoped scan reports 33, and neither can
see `apps/web/index.html:7` or `apps/mobile/app.json:3`. Baseline at founding: **name 351
lines / 193 files; domain 33 lines / 25 files** (verified 2026-08-24).

**Closes weekly while burning down; converts to per-PR** once tier 1 reaches zero, at which
point the CI guard is the loop and weekly reporting is redundant.

---

## 2. Headline-claim consistency

```yaml
type: loop
id: headline-claim-consistency
owner: media-brand
measures: [brand.artifacts_leading_with_headline_claim]
changes: [collateral.artifact_set, brand.voice_guide]
inputs_from: [narrative-collateral, strategy-and-fundraising]
outputs_to: [sales, growth, editorial-gate]
close_time: monthly
status: proposed
```

**Binary per artifact, not a percentage of words.** The failure this loop watches for is
proliferation — a second sentence appearing in a second room and neither being retired.
[YC_WEDGE_PLAN.md:323](../../YC_WEDGE_PLAN.md) is the standing reason: the risk is surface
area, and surface area grows one reasonable addition at a time.

**Monthly**, because artifacts are produced at deadline cadence, not weekly.

---

## 3. Consent-register reconciliation

```yaml
type: loop
id: consent-register-reconciliation
owner: media-brand
measures: [research.subjects_touched, research.subjects_approved, guests.consent_withdrawn_at]
changes: [research.eligible_cohort, findings.retraction_queue]
inputs_from: [customer-relationship-research, compliance-and-privacy]
outputs_to: [compliance-and-privacy, guest-experience]
close_time: weekly
status: proposed
```

**The only loop with a hard-fail rather than a target.** `subjects_touched` minus
`subjects_approved` must be zero, and any subject whose `consent_withdrawn_at`
(`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:64`) becomes non-null
puts every finding resting on them into the retraction queue.

**Weekly**, because withdrawal is a right with a clock on it, and a monthly loop would leave
a withdrawn subject inside live findings for up to a month.

**Currently unrunnable.** `subjects_approved` has no source — the approval register does not
exist. That is stated as a blocker, not modelled as zero.

---

## 4. Outward surface inventory

```yaml
type: loop
id: outward-surface-inventory
owner: media-brand
measures: [brand.outward_surface_count, brand.surfaces_unowned]
changes: [brand.scan_patterns, media-brand.team_scope]
inputs_from: [engineering, product-and-vision, partnerships]
outputs_to: [brand-identity, narrative-collateral]
close_time: quarterly
status: proposed
```

**This is the loop that would have caught the missing half.** The brand audit was wrong
twice for the same reason: nobody kept a list of *every* place a third party meets this
company, so each scan searched for what it already knew about. Push notification titles,
Face ID prompts, Android notification channels, and iCal `PRODID` headers were all outward
surfaces that no scan pattern covered.

**Quarterly**, because the surface set changes at feature cadence. A new integration, a new
notification channel, or a new outbound document type each add a row.

---

## Loops this department consumes but does not own

| Loop | Owner | Why we care |
|---|---|---|
| Editorial gate first-pass rate | [[editorial-gate-loops\|Growth G3]] | M1's voice guide is the thing being enforced; a rising rejection rate may be a guide problem, not a writer problem |
| Visit → activated restaurant | [[conversion-funnel-loops\|Growth G5]] | M3's metric is a subset of it and cannot exist before it |
| Verified dollars recovered | [[design-partner-operations-loops\|Sales S1]] | M2 may not state the number until this loop closes once |
