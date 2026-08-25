---
type: agenda-full
division: product
department: partnerships-integrations
team: pos-bridge
status: provisional
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-premortem]]"
  - "[[pos-bridge-agenda-board]]"
  - "[[pos-bridge-directive]]"
  - "[[connector-platform-trust-agenda-full]]"
  - "[[partner-alliance-development-charter]]"
  - "[[partnerships-integrations-agenda-full]]"
---

# POS Bridge — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

One `CanonicalCheck` shape, N normalizers, and the POS-item → catalogue mapping — kept
provider-neutral, and pulled on by at least one real merchant.

The team starts with working code and zero throughput. Those two facts together define the
whole agenda: **the job is not to build the bridge, it is to get someone to walk across it.**

## How

### Starting position, stated precisely

| | |
|---|---|
| Providers in registry | **27** (2 `available`, 1 `partial`, 2 `scaffolded`, 22 `planned`) |
| Normalizers written and waiting on a *token*, not on code | **2** — Square (`:71`), Clover (`:83`) |
| Providers usable by any venue **today** | **2** — `generic_webhook`, `csv_import` (`:29-51`) |
| Real `pos_checks` rows | **0** (`AGENT_NATIVE_UI_DECISION.md:56`) |
| pos-hub routes | 10 — **1 verifies correctly, 9 unauthenticated** |
| Onboarding already asks which POS | yes — `OnboardingContext.tsx:95` |

### The sequence, and why it is in this order

**Phase 0 — close the gate that anyone can pull.** Before anything else,
`POST /pos-hub/catalog-match/:restaurantId/proposals/:proposalId/approve|reject`
(`ENDPOINTS.md:361-362`) gets a guard. It is the only route this team owns where an anonymous
caller changes what the system believes about a restaurant's inventory
([[pos-bridge-premortem]] M3). It needs no design partner, no decision, and no dependency
beyond [[engineering-charter]].

**Phase 1 — instrument the human gate before real data arrives.** Emit an `nf_a` event per
catalogue-match proposal: matcher confidence, human verdict, dwell time. This must exist
*before* the first merchant, because after the first batch the approval history is already
contaminated by fatigue and there is no baseline to recover ([[pos-bridge-premortem]] M4).
Cheap now, impossible later.

**Phase 2 — one venue, one real row.** Take a named venue from onboarding's POS question
(`OnboardingContext.tsx:95`) to a real `pos_checks` row. **Whichever path is shortest for
that venue** — and if that is a nightly CSV through `csv_import`, that is a success, not a
compromise. The registry's own header already argues this (`:12-15`).

**Phase 3 — finish the adapter that venue is waiting on.** Only then, and only that one.
Square and Clover are token-blocked, not code-blocked, so "finishing" may be an OAuth flow
and a sandbox connection rather than normalizer work.

### The rule that governs the whole sequence

**No new provider adapter while `pi.merchant_backed_providers == 0.`** It is deliberately
inconvenient. Adapter work always feels productive, which is exactly why the failure mode in
[[pos-bridge-premortem]] M1 is the most likely one.

### What this team does *not* do while waiting

Not: build adapters 3 through 27. Not: extend SimPOS toward real service
([[pos-bridge-premortem]] M5). Instead — harden the two universal paths, instrument the gate,
close the exposure, and establish `pi.canonical_shape_drift`'s baseline while the shape is
still small enough to audit in an afternoon.

## Why now

1. **The exposure is live and this team owns it.** Nine unauthenticated pos-hub routes,
   two of which mutate catalogue mappings.
2. **The gap is a token, not a programme.** Two normalizers are written. The distance to a
   real connection is a merchant authorizing OAuth — a category of work that stays open for a
   year precisely because it does not look like code.
3. **The shape is still cheap to keep neutral.** `pos-types.ts` has never been pulled on by a
   second real provider. Every month of single-provider use makes M2 harder to reverse, and
   the two-provider rule costs nothing to adopt before the first field is added under
   pressure.
4. **The docs are behind the code.** Planning has been treating multi-POS as greenfield while
   `developer.squareup.com` (`:75`) and `developers.lightspeedhq.com` (`:109`) have been in
   source. This team's first output is partly *telling everyone else what already exists.*

## Next steps

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | Guard `catalog-match/.../approve` and `/reject` | [[engineering-charter]] | Anonymous POST is rejected |
| 2 | Classify all 10 pos-hub routes ingress / management / simulator | [[connector-platform-trust-charter]] | Classification published; feeds `pi.verified_ingress_ratio` |
| 3 | Instrument the catalogue-match gate with `nf_a` events | — | Confidence, verdict, dwell recorded per proposal |
| 4 | Baseline `pi.canonical_shape_drift` — audit every `pos-types.ts` field against the registry | — | Every field is 2+-provider or capability-gated, or flagged |
| 5 | Registry audit — reconcile 27 statuses against what actually builds | — | Any unsupported `scaffolded` demoted |
| 6 | Take one named venue to one real `pos_checks` row, by the shortest path | Sales / founder naming a venue | `pi.merchant_backed_providers` = 1 |
| 7 | Carry the "27 not 30" and "0 of 32 verify" corrections back upstream | — | `foundation/teams/product.md` updated |

Steps 1–5 need nobody's permission. Step 6 is the one that matters, and it is the one this
team cannot start alone.

## Questions for the founder

1. **Which venue?** Step 6 needs one named restaurant. Not a target list — one venue already
   in reach. *(Asked as a dependency, not as a request for the outbound target list, which is
   founder-deferred.)*
2. **Is `csv_import` an acceptable first win?** If the first real integration is a nightly
   CSV rather than a live Square connection, is that a success? This charter says yes and
   plans accordingly; if the answer is no, the sequence changes materially.
3. **SimPOS boundary.** Confirm it stays a simulator. If a venue with no POS ever gets
   offered SimPOS for real service, that is a change to the bridge thesis and needs a
   supersede-ADR, not a sprint decision.
4. **Türkiye entries** (`:268-322`) — in or out of v0 scope? They are a different clock and a
   different BD motion, and half of them are `partner_agreement` blocked anyway.
