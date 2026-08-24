---
type: charter
division: commercial
department: media-brand
team: customer-relationship-research
status: partial
metrics: [nf_b.choice, nf_b.context]
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[customer-relationship-research-premortem]]"
  - "[[customer-relationship-research-directive]]"
  - "[[customer-relationship-research-loops]]"
  - "[[customer-relationship-research-schedule]]"
  - "[[compliance-charter]]"
  - "[[guest-experience-charter]]"
  - "[[commercial]]"
---

# Customer Relationship Research (M4) — Charter

**Parent:** [[media-brand-charter|Media & Brand]] · Commercial.
**Evidence grade: `PARTIAL`** — consent is modelled and shipped for guests; no research
practice exists, and the register this team's first assignment actually needs does not exist
at all.

---

> ## ⛔ The consent gate
>
> **Research only customers who have explicitly approved having their public web presence
> reviewed.**
>
> This is the founder's instruction and it is the first thing in this charter because it is
> the only thing that makes the team permissible. **This is not open-ended lookup.** It is
> not "research our customers". It is not "public data, so it is fair game". The gate is a
> recorded approval from the specific customer, for this specific purpose.
>
> **Today, no such register exists.** Therefore, today, the correct output of this team for
> every research request is: **no.**
>
> The consent **mechanism** — what the customer is told, how approval is captured, how it is
> withdrawn, and what legal basis it rests on — is
> [[compliance-charter|Corporate → Compliance & Privacy]]'s to design. M4 must coordinate
> with them and **must not claim their scope**. This team proposes; it does not decide the
> legal shape.

---

## Mandate

Consent-gated research into the people the product serves — what guests and operators
actually do — asked only of those who opted in. The team owns **the questions and the
findings**, and nothing else.

Two subjects, one gate:

| Subject | What is researched | Consent source |
|---|---|---|
| **Customers** (restaurants) | Public web presence, reviewed with their explicit approval | An approval register that **does not exist yet** |
| **Guests** | Behaviour recorded in the product | The shipped consent columns, for the purpose they were captured under |

## Why distinct from siblings

It is the only function in Commercial that touches identified individuals under a gate. Its
failure is not a weak quarter; it is a privacy incident, and the company has one customer to
lose. That risk profile does not belong inside a team whose metric is reach, because reach
and restraint pull in opposite directions and the tie-break under pressure is predictable.

## Boundaries

Owns outright: the research questions, the findings, the eligibility check before any touch,
and the retraction queue when a consent is withdrawn.

## Explicit non-goals

- **The legal basis, the DPAs, and the consent mechanism's legal shape** belong to
  [[compliance-charter|Compliance & Privacy]]. M4 proposes the register's operational shape
  and implements nothing until they have reviewed it.
- **The guest-facing product** belongs to [[guest-experience-charter|Product → Guest Experience]].
- **Prospect research** is not this team's work and must be refused here. A restaurant that
  has not approved anything is a prospect, not a consented customer; that request routes to
  [[outbound-engine-charter|Sales S2]] and is answered under their rules, not by borrowing
  this team's gate.
- **Personalisation and recommendation** belong to Product. M4 produces findings; it does
  not ship features from them.
- **Anything about a person who interacted with us on social.** A reply, a follow, or a
  mention is not consent.

## Metrics it moves

**Primary: findings per consented cohort.**

**Hard secondary, which overrides the primary in every case:**

- **zero** records touched whose `consent_withdrawn_at` is set;
- **zero** customers researched who are not on the approval register — which today means
  zero customers researched, because there is no register.

A hard-fail metric rather than a target. There is no acceptable non-zero value, and a team
that reports "one, and here is why it was reasonable" has already failed.

**Neural footprint tie.** Guest-side findings consume `nf_b.choice` and `nf_b.context`
([README §4.4](../../../../../foundation/README.md)). The NF-B namespace is provisional;
these map to literal fields in the sketched event shape rather than inventing names. NF-B
is a priority track ([README §4.2](../../../../../foundation/README.md)) and it **emits
nothing today** — L4 is architecturally locked and uninstrumented
([README §1](../../../../../foundation/README.md)).

## Evidence today

`PARTIAL`. Verified 2026-08-24.

### `EXISTS` — the guest consent substrate is real and unusually well built

`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`:

| Line | What it establishes |
|---|---|
| `:58` | `consent_purpose text not null default 'service_personalisation'` |
| `:59` | `consent_notice_version text not null` — *what the person was told*, versioned |
| `:60-62` | `consent_captured_via`, CHECK-constrained to `reservation_form`, `in_venue_card`, `staff_verbal`, `loyalty_signup` |
| `:63` | `consent_captured_at timestamptz not null` |
| `:64` | `consent_withdrawn_at timestamptz` |
| `:55-57` | The design note: *"A boolean cannot answer 'what was this person told, on what date, and can we prove it'"* |
| `:79-81` | `erased_at` as a **tombstone**, not a soft delete |
| `:112-117` | Column comment: on erasure, `guest_identifiers` rows are hard-deleted and `display_label`/`consent_*` nulled; the row survives only so historical `guest_check_links` do not dangle |

A pre-login `/privacy` route also exists (`apps/web/src/App.tsx:158`), rendering
`apps/web/src/pages/Privacy.tsx`.

### `NEW` — and this is the part that matters

**There is no approval register for customer web-presence research.** The shipped consent
columns are for a **different subject** (guests, not restaurants) and a **different purpose**
(`service_personalisation`, not research). Reusing them would be exactly the drift the
premortem names, and it would be permanently recorded in migration history.

There is also no research practice, no findings format, no retraction mechanism, and no
cohort definition.

### One inconsistency inherited from the division document

[[commercial]] §4 assigns review of this team's work to **Ethics & Responsible AI
(advisory)**. [ORG_STRUCTURE §3](../../../../../foundation/ORG_STRUCTURE.md) records that
function as **considered and not adopted**, with guest-data use falling to Compliance &
Privacy in the line. The review therefore has no owner. This charter routes it to Compliance
& Privacy and flags the discrepancy rather than quietly rewriting either document.

## What this charter did not verify

No live customer, no external site, and no social presence was fetched or looked up during
this session — which is the correct behaviour for a team whose gate is not yet built.
