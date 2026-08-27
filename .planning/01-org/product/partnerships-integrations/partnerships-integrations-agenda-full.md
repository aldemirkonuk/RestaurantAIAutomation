---
type: agenda-full
division: product
department: partnerships-integrations
status: provisional
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, pi.unblocking_agreements]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partnerships-integrations-premortem]]"
  - "[[partnerships-integrations-agenda-board]]"
  - "[[pos-bridge-agenda-full]]"
  - "[[connector-platform-trust-agenda-full]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[OPEN-DECISIONS]]"
---

# Partnerships & Integrations — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Four teams, one thesis: **be the bridge, not another POS.**

| Team | First deliverable | Grade today |
|---|---|---|
| [[pos-bridge-charter]] | One real merchant on one provider, end to end | EXISTS |
| [[connector-platform-trust-charter]] | A verified ingress inventory + the CI guard that keeps it true | PARTIAL |
| [[supplier-distributor-network-charter]] | The CM-F3 boundary memo, then one live feed | PARTIAL |
| [[partner-alliance-development-charter]] | The OD-07 option memo | NEW |

The department inherits working code. Its first job is therefore **not build** — it is
*finish, verify, and get one merchant to pull on it.*

## How

### The three things that are true today and shape everything

1. **The groundwork exists.** Square and Clover are `scaffolded` with normalizers written
   (`pos-provider.registry.ts:71, :83`), Toast is `partial` (`:58`), onboarding already asks
   which POS the venue runs (`OnboardingContext.tsx:95`), and two universal providers are
   `available` right now (`:29-51`). The registry is a sequenced strategy document (`:3-16`),
   not a wish list.
2. **Nothing has ever flowed through it.** `pos_checks` = **0** real rows;
   `procurement_orders` = **1** (`.planning/decisions/AGENT_NATIVE_UI_DECISION.md:56, :59`). Every
   capability claim in this department is unexercised.
3. **The ingress posture is inconsistent, and inconsistency is the defect.** `pos-hub`
   verifies correctly and fails closed (`pos-hub.service.ts:96-121`); `toast` verifies only
   when a signature happens to be present (`toast.service.ts:189`). Two connectors, two
   postures — see [[partnerships-integrations-premortem]] M2.

### Sequencing, and the one rule that governs it

Foundation §8's *lead priority + background parallelism*. The lead is
**`pi.merchant_backed_providers` moving from 0 to 1.**

**The governing rule:** while that number is 0, no new provider adapter may begin. The only
permitted POS work is (a) finishing an adapter a *named venue* is waiting on, or (b)
hardening the two `available` paths. This is the counter-pressure to M1 and it is meant to
be inconvenient — the whole failure mode is that adapter work always feels productive.

### Boundaries we are working inside, not around

- **Security.** [[perimeter-ingress-integrity-charter]] owns webhook signature verification
  as a control. We own the per-connector trust contract. We do not ship a second verifier;
  we ship the specification and the evidence that the control holds. Coordination is a
  standing item, not an escalation (see [[partnerships-integrations-schedule]]).
- **Engineering.** Owns runtime code. Our CI guard is a joint ask, not a unilateral commit.
- **Sales.** CM-F3 is open. Until it resolves we work our proposed half and say so.

## Why now

Three reasons, in order of force.

1. **The exposure is live.** `POST /pos-hub/catalog-match/:restaurantId/proposals/:id/approve`
   and `/reject` (`ENDPOINTS.md:361-362`) are the human approval gate for catalogue mapping
   and are callable by anyone on the internet. A gate anyone can pull is not a gate. This
   does not need a design partner to matter.
2. **The docs are behind the code, and that misleads planning.** Three corrections found in
   one session (registry count, the "0 of 32" claim, vendor-portal's classification — all
   detailed in [[partnerships-integrations-charter]]). Planning against stale docs produces
   work that is already done and misses work that is not.
3. **The strategic window is a sequencing question, not a market one.** Square + Clover +
   SpotOn are ~60% of detected SMB restaurants per the registry's own sequencing (`:8`). Two
   of those three already have normalizers. The distance to a real connection is a merchant
   token, not an engineering programme — and that is exactly the kind of gap that stays open
   for a year because it does not look like code.

## Next steps

Proposed, not started. Each names its owning team.

| # | Step | Team | Done when |
|---|---|---|---|
| 1 | Publish the **verified ingress inventory** — every route in `pos-hub`, `toast`, `simpos`, `inbound-email` classified as ingress / management / simulator, with its actual verification posture | [[connector-platform-trust-charter]] | The inventory exists and `pi.verified_ingress_ratio` has a real baseline |
| 2 | Make the **toast call site unconditional** — absent signature must reject, not bypass (`toast.service.ts:189`) | [[connector-platform-trust-charter]] + Engineering | An unsigned POST to `/toast/webhook` returns 401 |
| 3 | Guard or reclassify the **catalogue-match approval routes** (`ENDPOINTS.md:361-362`) | [[pos-bridge-charter]] + Security | The gate rejects anonymous callers |
| 4 | Land the **CI recurrence guard** so this defect class cannot return | joint with [[perimeter-ingress-integrity-charter]] | A PR adding an unverified ingress route fails CI |
| 5 | Take **one named venue** from onboarding's POS question to a real `pos_checks` row — via `csv_import` or `generic_webhook` if that is what they actually run | [[pos-bridge-charter]] | `pi.merchant_backed_providers` = 1 |
| 6 | Write the **CM-F3 boundary memo** and hand it to the founder with Sales | [[supplier-distributor-network-charter]] | The memo exists; the fork is decidable |
| 7 | Write the **OD-07 option memo** — what collaboration would and would not buy, what it costs to keep the option open | [[partner-alliance-development-charter]] | The memo exists; OD-07 is answerable |
| 8 | Carry the three doc corrections back to `foundation/teams/product.md` and `ENDPOINTS.md` | department | The corrections land |

Steps 1–4 are the *"evidence, `file:line`, a classification step, and a recurrence guard"*
shape foundation §2.3 prescribes. Steps 6–7 produce decidability, not decisions.

## Questions for the founder

1. **OD-07 (Beli).** Not asking for the answer — asking whether the option memo should be
   written **now** or after guest MVP scope exists. The premortem's M3 says waiting has a
   cost that compounds silently.
2. **CM-F3 (distributor connectivity).** The charter proposes *signed intent to send data*
   as the seam: Sales before it, us after it. Ratify, overrule, or assign both halves to one
   unit? If one unit, we would rather lose the team than run a shared metric.
3. **PROD-F4 (connector trust boundary).** The charter asserts Partnerships owns the contract,
   Engineering the runtime, Security the control. Asserted, not decided — is it right?
4. **The no-new-adapters-until-one-merchant rule.** It is deliberately restrictive and it is
   the main defence against M1. Endorse it, or is there a reason to keep building the ladder?
5. **Türkiye market entries** (`:268-322` — Protel/Simpra, ElektraWeb, Vectron, Wolvox,
   SambaPOS) are a distinct BD motion with a different clock. In or out of scope for v0?
   *(Asked as a scope question. This department is not proposing an outbound target list —
   that is founder-deferred.)*

**Not asked, deliberately:** pricing, and who to contact first. Both are founder-deferred
and this agenda proposes neither.
