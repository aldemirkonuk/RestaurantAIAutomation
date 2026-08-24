---
type: agenda-full
division: product
department: guest-experience
team: guest-value-monetization
status: provisional
metrics: [nf_b.ops_conversion, nf_b.k_anonymity_pass_rate, nf_b.photo_consent_rate, nf_b.sub_k_render_attempts]
updated: 2026-08-24
links: ["[[guest-value-monetization-charter]]", "[[guest-value-monetization-premortem]]", "[[guest-value-monetization-agenda-board]]", "[[guest-value-monetization-directive]]", "[[guest-value-monetization-loops]]", "[[guest-value-monetization-schedule]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[consumer-app-points-economy-charter]]", "[[compliance-privacy-charter]]", "[[legal-charter]]", "[[analytics-bi-charter]]", "[[growth-charter]]", "[[finance-pricing-charter]]", "[[product-vision-charter]]", "[[FUTURES]]", "[[UX_PATHS_CATALOG]]", "[[OPEN-DECISIONS]]"]
---

# Guest Value & Monetization — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.
>
> ⬦ **Unstaffed.** Three entry conditions, none satisfied — including **PROD-F3**, which
> decides whether this team reports here or into Commercial. Two acts, however, are
> available now and are the two that only work if they happen first.

## What

Everything the guest side gives back to the restaurant, in three parts with three
different maturities:

1. **K-anonymized segment insight** — eleven UX paths written (`NEW-659`, `NEW-660`,
   `NEW-661`, `NEW-664`, `NEW-665`; `NEW-880`, `NEW-882`, `NEW-883`, `NEW-885`), none
   built, nothing to aggregate yet.
2. **Photos as promotional assets** — the enrichment pipeline **exists**, the
   consent-to-reuse plumbing does **not**. Capability without permission, which is the
   dangerous way round.
3. **Advertising** riding on guest activity and photo content — **zero groundwork**,
   and a written product promise pointing the other way.

And the number that judges the whole sub-layer: **`nf_b.ops_conversion`**.

**Not in scope, deliberately: pricing.** Rate cards, CPM, revenue share, floors — none
of it is proposed here. Founder-deferred, and Commercial's when it is not.

## How

**Build the two gates before the team exists.** This is the unusual instruction in
this agenda and it is the whole strategy. The k-threshold as a **code constant with a
CI guard**, and the **sub-k empty state designed properly**, are the only two
counter-pressures that work against [[guest-value-monetization-premortem]] V1 — and
both stop working the moment there is a pilot restaurant with an empty dashboard.
Afterwards they are a debate about a customer's experience. Beforehand they are just
how the system was built. Same for the advertising boundary statement: a paragraph
now, an improvised retraction later.

**Purpose-scoped consent, copied from a pattern that already works here.** The
consent-to-reuse contract for photos should be modelled directly on
`consent_purpose` / `consent_notice_version`
(`20260819000000_guest_identity_minimal_slice.sql:54-64`) — an enumerated purpose with
a version, never a boolean, for exactly the reason stated at `:55-56`: a boolean
cannot answer *what was this person told, on what date, and can we prove it*. Catalog
enrichment, restaurant promotion, and paid placement are **three different purposes**,
and a single "yes" cannot cover them.

**Traceability designed into the first surface, not the tenth.**
`nf_b.ops_conversion` requires a chain — segment → insight → surfaced recommendation →
restaurant decision. Every restaurant-facing recommendation carries the segment id
that produced it; every acted-upon recommendation writes back. Cheap at surface one,
near-impossible at surface ten, and unmeasured-forever is how
[[guest-value-monetization-premortem]] V3 happens.

**Assume the incentive, do not resolve it internally.** This team's customer is the
restaurant, which inverts every incentive in the rest of the sub-layer. So no privacy
gate it operates is reviewed by it. That is structural, not courtesy
([[ORG_STRUCTURE]] §3).

## Why now

**Mostly not now** — and precisely which parts are which:

- **Not now:** segments (nothing to aggregate — `nf_b.subject_coverage` is
  structurally 0% and no NF-B event has been emitted), advertising (PROD-F3 unresolved,
  zero groundwork), photo reuse at scale (no consumer app producing photos).
- **Now, and only now:** the k-threshold constant, its CI guard, the sub-k empty
  state, and the advertising boundary statement. Every one of them is a counter-pressure
  that is cheap while hypothetical and contested once real. There is no second window.

## Next steps

Steps 1–3 are **available now and gated on nothing**. Everything from 4 waits.

| # | Step | Gate | Done when |
|---|---|---|---|
| 1 | **k-threshold as a code constant + CI guard**, in the shape of the four guest PII guards | **none** | The threshold cannot be changed by config, only by a reviewed diff |
| 2 | **Design the sub-k empty state** — *"not enough data yet"* as a normal, shippable state | **none**, with [[design-charter]] | Empty is unembarrassing, which removes the pressure at its source |
| 3 | **Write the advertising boundary statement** against `ServicesPermissions.tsx:41,249` | Founder + [[compliance-privacy-charter]] | Which surfaces may carry advertising, which may never, and what the operator promise covers |
| 4 | **Purpose-scoped photo consent contract**, modelled on `consent_purpose` / `consent_notice_version` | [[legal-charter]] + [[compliance-privacy-charter]] | Catalog enrichment ≠ restaurant promotion ≠ paid placement, and revocation propagates |
| 5 | Enforce photo consent **at the pipeline**, not the surface | 4, [[consumer-app-points-economy-charter]] | No photo enters enrichment without a live consent record for that purpose |
| 6 | Resolve **PROD-F3** | Founder | This team knows which division it reports into before building an ad product |
| 7 | First segment surface — `NEW-659` / `NEW-660` — **with segment-id traceability from day one** | Non-zero subject coverage; a segment that clears k **without lowering it** | `nf_b.ops_conversion` is computable, not merely hoped for |
| 8 | Weekly digest → menu experiment (`NEW-664`), write-back on action | 7 | `nf_b.segment_to_decision_latency` is a real number |
| 9 | Advertising product shape — **on its own data model**, not `provider_promotions` | 3, 6 | The subject of an ad row is a guest context, not a vendor |

**Not doing:** any pricing model; any segment rendering below k, in any environment,
for any customer; any use of `provider_promotions` for guest-facing advertising; any
photo reuse under a boolean consent.

## Questions for the founder

1. **The advertising promise already shipped in the product.**
   `apps/web/src/components/settings/ServicesPermissions.tsx:41` lists *"Any
   advertising or cross-site tracking"* under exclusions; `:249` states *"WineOps sets
   no tracking or advertising cookies."* That binds the **operator** app, not a guest
   app — a real and defensible distinction **if it was drawn deliberately**. Is the
   boundary per-surface (operator app never, guest app with consent), or is that copy
   the company's position? An improvised answer to *"you said you don't do
   advertising"* is indistinguishable from a retraction, and this costs a paragraph
   today.

2. **PROD-F3 — this team here, or in Commercial?** ([[product]] §5.2) This team takes
   **no position and is not neutral**: staying here maximises this sub-layer's scope.
   What it does assert is that wherever the team goes, the **k-threshold and the
   photo-consent contract must not move with it** — they belong wherever
   [[compliance-privacy-charter]] can review them independently of the revenue.

3. **Is the k-threshold founder-only to lower?** Proposed in
   [[guest-value-monetization-directive]]. Endorsing it now, while there is no pilot
   restaurant staring at an empty dashboard, is the difference between a rule and a
   negotiation. And note what V1 costs: not a metric, a **specific recognisable
   person** disclosed to a manager who cannot un-know it.

4. **Does a revoked photo have to be pulled from already-printed material?** The
   revocation path is easy in software and hard in a printed menu or a paid placement
   that already ran. [[legal-charter]] and [[compliance-privacy-charter]] own the
   answer; it must exist **before** the first reuse, because the first reuse is when
   someone will ask.

5. **Note on the reviewer.** [[ORG_STRUCTURE]] §3 records **Ethics & Responsible AI as
   considered and not adopted**, with guest-data use falling to
   [[compliance-privacy-charter]] in the line. This team is the single best test of
   that call — *the department that benefits from a personalization feature cannot
   neutrally assess it* describes it precisely. If Compliance & Privacy proves too
   thin here, that is evidence for revisiting the advisory decision, and this team
   considers itself obliged to say so rather than to quietly self-review.
