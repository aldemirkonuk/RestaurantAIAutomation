---
type: charter
division: commercial
department: media-brand
status: partial
metrics: [nf_b.choice, nf_b.context]
updated: 2026-08-24
links:
  - "[[ORG_STRUCTURE]]"
  - "[[commercial]]"
  - "[[media-brand-premortem]]"
  - "[[media-brand-directive]]"
  - "[[media-brand-loops]]"
  - "[[media-brand-schedule]]"
  - "[[brand-identity-charter]]"
  - "[[narrative-collateral-charter]]"
  - "[[social-community-charter]]"
  - "[[customer-relationship-research-charter]]"
---

# Media & Brand — Charter

**Parent division:** Commercial ([ORG_STRUCTURE §2](../../../foundation/ORG_STRUCTURE.md)).
**Teams:** 4 — [[brand-identity-charter|Brand Identity]] · [[narrative-collateral-charter|Narrative & Collateral]] · [[social-community-charter|Social & Community]] · [[customer-relationship-research-charter|Customer Relationship Research]].

## Mandate

Media & Brand owns what the company is called, what it claims, where it says it, and
what it is allowed to learn about the people it says it to. Four surfaces, one
accountability: **everything a person encounters before they are a user, and everything
the company asserts about itself once they are.** The department writes the definitions —
the name, the marks, the voice, the one sentence — and other units apply them. That split
is the whole point: Growth's [[editorial-gate-charter|Editorial Gate]] cannot enforce a
voice guide that the team publishing the content also wrote.

Today the department is **not** starting from zero and it is **not** starting from a clean
slate either. It inherits a live identity defect — the product still calls itself WineOps
to its users, its vendors, its crawl targets, and the operating systems it is installed on
(see [[brand-identity-charter]]) — and it inherits a narrative that is already written and
peer-reviewed but has never been produced as an artifact.

## Boundaries

**Owns outright:**

| Surface | Team | What ownership means |
|---|---|---|
| Name, marks, wordmark, voice guide | M1 | The definition, and the CI guard that keeps it true |
| Company story, pitch sentence, deck, demo script, case study | M2 | The craft of the argument, for a named room |
| Public presence and distribution of Growth's output | M3 | Dormant; see entry trigger below |
| Consent-gated research into customers and guests | M4 | The questions and the findings, nothing else |

**The one metric the whole department is judged on first:** legacy-brand references
remaining in shipped surfaces, target 0, with a recurrence guard. Everything else in this
charter is downstream of the company having one name.

## Explicit non-goals

**Media & Brand is outward creative. It is not Design.** This is the boundary most likely
to be violated by drift, so it is stated first and concretely.

- **Product and interaction design belongs to [[design-charter|Product → Design]]**
  ([ORG_STRUCTURE §2](../../../foundation/ORG_STRUCTURE.md)). Design owns what the product
  looks like and how it behaves for someone who is already inside it: layout, components,
  states, flows, the design tokens at `apps/mobile/src/design/tokens.ts`. Media & Brand
  owns what the company looks and sounds like to someone who is not inside it yet.
  **The seam is concrete:** on `apps/web/src/components/brand/AuthShell.tsx`, Media & Brand
  owns the wordmark and the sentence; Design owns the form, the spacing, and the error
  states. A pull request that changes both is two reviews, not one.
- **Enforcement of voice on published content** is Growth's
  [[editorial-gate-charter|G3 Editorial Gate]]. M1 writes the guide; G3 applies it. A guide
  whose author is also its enforcer is an opinion.
- **The metrics narrative** belongs to [[analytics-bi-charter|Intelligence → Analytics & BI]].
  M2 uses the numbers; it does not produce them.
- **The YC path and the decision to apply** belong to
  [[strategy-charter|Corporate → Strategy & Fundraising]]. M2 owns the artifact craft only.
- **The legal basis for consent, DPAs, and the consent mechanism's legal shape** belong to
  [[compliance-charter|Corporate → Compliance & Privacy]]. M4 must coordinate with them and
  must not claim their scope. See [[customer-relationship-research-charter]].
- **The guest-facing product** belongs to [[guest-experience-charter|Product → Guest Experience]].
  M4 asks questions about guests; it does not build for them.
- **Package, workspace, container, and deploy-target renaming** (`@wineops/*` scopes,
  `docker-compose.yml` service and network names, `.railway/railway.ts`, `vercel.json`)
  belongs to [[engineering-charter|Platform → Engineering]]. Raised as fork **CM-F5** in
  [[commercial]]; M1's founding assignment stops at surfaces a human or a third-party
  machine can see.
- **Paid acquisition and PR/press** are not chartered anywhere in Commercial. There is no
  budget, no funding round, and no customer count. See [[commercial]] §4.2.

## Metrics it moves

| Team | Primary metric | Neural footprint tie |
|---|---|---|
| M1 Brand Identity | Legacy-brand references in shipped surfaces → 0 | — |
| M2 Narrative & Collateral | One headline claim: every outward artifact leads with the same sentence (binary, per artifact) | — |
| M3 Social & Community | Referred sessions reaching an activated account | — |
| M4 Customer Relationship Research | Findings per consented cohort; hard override: **zero** records touched with `consent_withdrawn_at` set | `nf_b.choice`, `nf_b.context` ([README §4.4](../../../foundation/README.md)) |

Three of the four metrics are **not currently measurable**, and saying so is part of the
charter. M3's metric needs product analytics, which do not exist — Sentry is the only
telemetry SDK in [EXTERNAL_CONNECTIONS.md](../../../foundation/EXTERNAL_CONNECTIONS.md),
so no funnel step can be attributed. M4's metric needs an approval register that does not
exist in the repo. M1's metric is measurable today, which is one more reason it is the
department's first assignment.

**NF-B field names are provisional.** [README §4.4](../../../foundation/README.md) gives the
event shape (`choice`, `context`, `outcome`) but no settled metric namespace; the two names
above map to literal schema fields rather than inventing new ones.

## Evidence today

Graded per [[commercial]] §0. Verified 2026-08-24 against the working tree on
`feat/beverage-catalogue-wine-identity`.

**M1 Brand Identity — `EXISTS`, as a live defect, and larger than previously recorded.**
The full audit is in [[brand-identity-charter]]. The headline: a host-based scan reports
10 references ([EXTERNAL_CONNECTIONS.md:15](../../../foundation/EXTERNAL_CONNECTIONS.md));
[[commercial]] §4.1 corrected that to 33 lines; this session reproduces **33 lines across
25 tracked files for the `wineops.ai` domain** and finds a second, much larger surface the
domain scan structurally cannot see — **351 lines across 193 tracked files carry the literal
string `WineOps`**, including the mobile app's installed name
(`apps/mobile/app.json:3`), the Face ID system prompt (`apps/mobile/app/lock.tsx:31`), the
Android notification channel (`apps/mobile/src/lib/push.ts:32`), the web push title
(`apps/web/public/sw.js:67`), and the iCal `PRODID` transmitted into every subscribed
calendar client (`apps/api-gateway/src/calendar/calendar.service.ts:1204`).

**M2 Narrative & Collateral — `PARTIAL`.** The argument exists and is good:
[YC_WEDGE_PLAN.md:312](../../YC_WEDGE_PLAN.md) is the sentence, `:315` the metric, §3 the
sixty-second demo, `:323` the surface-area constraint that is this team's central design
problem. No produced artifact exists anywhere in the repo — no deck, no case study, no
recorded demo. One named visual reference is **unavailable to this org**: it lives in the
founder's personal Instagram saves and must be supplied by hand.

**M3 Social & Community — `NEW`, chartered dormant.** Zero artifacts. No social or
scheduling host appears among the 50 runtime hosts in
[EXTERNAL_CONNECTIONS.md](../../../foundation/EXTERNAL_CONNECTIONS.md).
**Entry trigger:** the first long-form article clears G3's gate. Until then there is nothing
to distribute and a dormant feed reads worse than no feed. Fork **CM-F6**.

**M4 Customer Relationship Research — `PARTIAL`.** Consent is modelled and shipped for
*guests*: `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64`
carries `consent_purpose` (default `service_personalisation`), `consent_notice_version`,
a CHECK-constrained `consent_captured_via`, `consent_captured_at` and `consent_withdrawn_at`;
`:114` documents the erasure tombstone. A pre-login `/privacy` route exists
(`apps/web/src/App.tsx:158`). **What does not exist is the thing this team's first
assignment actually needs:** a register of *customers* who have explicitly approved having
their public web presence reviewed. That is a different subject and a different purpose from
the guest consent columns, and reusing those columns for it would be the exact drift the
premortem names.

## Honest note on the team count

Four teams for a one-person department is ambitious, and the count survives the
[[commercial]] §0 test only because M3 is deliberately dormant. Three live mandates —
identity, argument, consent-gated research — do have different metrics, different crafts,
and different failure modes. If a fifth is ever proposed, the burden is to show it fails
differently from these, not that it has work to do.
