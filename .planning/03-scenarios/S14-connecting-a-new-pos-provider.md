---
type: scenario
id: S14
slug: connecting-a-new-pos-provider
class: happy-path
actors: [operator, pos-bridge, connector-platform-trust, onboarding, catalog-matcher]
modules: ["[[pos-bridge-charter|pos-bridge]]", "[[connector-platform-trust-charter|connector-platform-trust]]", "[[catalogue-identity-charter|catalogue-identity]]"]
signals: [provider_registry, onboarding_pos_config, canonical_check, catalog_match_proposal]
insights_class: [connection-health, catalog-mapping-coverage, depletion-velocity]
tier: core
sim_harness: simpos
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[pos-bridge-charter]]", "[[connector-platform-trust-charter]]"]
---

# S14 — Connecting a new POS provider

## 1. Trigger
An operator connects their POS — during onboarding, or later from settings. Bounded: from
provider selection to the first canonical check flowing and depleting stock (which hands off
to S04). **Positioning is POS-agnostic (OD-38, locked):** the bridge is not a Toast
integration with extras — Toast is *one of 27* registry providers
(`pos-provider.registry.ts`), region `us`, status `partial` (`:55-66`). Do not frame this
scenario Toast-first.

## 2. Actors
Operator (picks the provider, supplies their own credentials/webhook config) · the
pos-bridge (registry + adapters + ingestion) · connector-platform-trust (delivery
integrity, S09) · the onboarding flow (already captures POS config) · the catalog-matcher
(maps the provider's items to inventory).

## 3. Signals
- **Provider registry** — 27 providers with honest per-provider `status`
  (`available` / `partial` / `scaffolded` / `planned`) and capability flags
  (checks / items / tables / employees / webhooks). `generic_webhook` and `csv_import` are
  the only two marked **available today** (`registry.ts:29-51`); Square and Clover are
  **scaffolded** — Orders-API normalizers implemented, needing merchant OAuth/API tokens
  (`:68-90`); Toast is **partial** (existing ToastModule + a check-level normalizer,
  `:55-66`). Everything else is `planned`.
- **Onboarding POS config** — the flow already asks: `provider`
  (`'square' | 'toast' | 'clover' | 'lightspeed' | 'other' | 'none'`), `connected`,
  `apiKey`, `locationId` (`apps/web/src/contexts/OnboardingContext.tsx:94-99`). The named
  four are a shortlist; the product bridges **any** POS via `generic_webhook`, so `other`
  is a first-class path, not a dead end.
- **First canonical check** — proves the connection live end to end (→ S04 signals).
- **Catalog-match proposals** — after the first catalog pull, unmapped items queue in
  `pos_catalog_match_proposals` at <0.9 confidence.

## 4. Queries the product must answer
- "Which providers can I actually connect *today*?" — `GET /pos-hub/providers` returns the
  registry + a status/tier summary, so the honest answer is surfaced, not hidden.
- "What does this provider support?" — capability flags per provider.
- "Is my connection live?" — `GET /pos-hub/status/:restaurantId` (checks landing by source).
- "Are my POS items mapped to inventory?" — catalog-match proposal queue + coverage count.

## 5. Outputs (in the moment)
- A provider picker with **honest status badges** — "available" vs "scaffolded" vs
  "planned" — so no operator is promised a native adapter that isn't built.
- For the universal path: the `generic_webhook` URL and the `POS_HUB_WEBHOOK_SECRET` to
  configure in the POS or middleware (Zapier, a nightly export, a partner feed).
- After the first pull: catalog-match proposals to review, and the status page showing the
  first checks arriving.

## 6. Insights the owner sees (the payoff)
- Connection health: are checks landing, at what rate, from which source.
- Catalog mapping coverage: "N of M items auto-mapped, K need your review."
- Then everything S04 unlocks — depletion, velocity, variance.

**Satisfiability — this scenario *is* the unlock.** Connecting a POS is the single act that
moves an owner off the 25.1%-without-POS floor ([[analytics-bi-charter]]) and into the
POS-fed insight classes. It doesn't compute insights itself; it opens the tap that S04 and
S15 drink from. That is the honest framing: S14's own §6 is thin (connection + coverage),
but its downstream value is the largest of any POS scenario.

## 7. Decisions
Human: picks the provider, **enters their own credentials** (per platform policy, the
system never enters or stores credentials on the operator's behalf), approves auto-mapping
proposals. The system **proposes only**: suggests a provider (e.g. by region), auto-maps
catalog items at ≥0.9 confidence and unambiguous, and — when a native adapter isn't ready —
proposes bridging via `generic_webhook`/`csv_import` rather than blocking (the adapter path
itself returns that guidance, `pos-hub.service.ts:141-144`).

## 8. Failure modes
- **Operator picks a `planned` provider** expecting native support → ingest throws "no
  adapter yet" with the explicit fallback message pointing at `generic_webhook`/`csv_import`
  (`pos-hub.service.ts:141-144`). Graceful, but a UX that badges status poorly would strand
  them.
- **Secret misconfigured** → fail-closed rejection (S04 §3) presents as "it's just not
  working," debugged on the wrong side.
- **Pull-source vs sales-source mismatch** → a catalog pulled as `simpos` maps to the sales
  source `generic_webhook`; a mapping stamped for the wrong source is **invisible to every
  inbound sale** (`catalog-matcher.service.ts:49-62`). A new adapter that gets this wrong
  silently maps to nothing.
- **Toast-first expectation** — a positioning failure, not a code one; OD-38 exists to keep
  it out of the docs and the picker.

## 9. Simulation & deploy gate
**SimPOS is the reference "new provider."** It onboards exactly like a real one — seed
catalog, catalog-match, close a check → signed `generic_webhook` POST
(`simpos.service.ts:485-509`) — and is non-production only since PR #32
(`assertSimRestaurant` refuses any non-`sim-` tenant, `:46-60`). **Gate (locked
2026-08-24):** a new adapter or normalizer ships only when a SimPOS-style onboarding plus
first-check-deplete passes end to end in simulation before any real merchant connects. Each
new normalizer earns a sim variant before `live`.

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

**S14 must never sit above Core.** It computes almost nothing itself, but it is the single act
that moves an owner from **25.1% to 100%** of the insight catalogue. Gating POS connection
behind a paid tier would gate the product's own value delivery behind a paywall and make every
other scenario's Plus/Pro look like vapour.

- **Core (operate):** the provider picker across 27 registry providers with **honest status
  badges** (available / partial / scaffolded / planned) so nobody is promised an adapter that
  isn't built; the universal `generic_webhook` URL + secret to configure in the POS or
  middleware; `csv_import` for pull-based houses; and connection status by source
  (`GET /pos-hub/status/:restaurantId`). Ships today — with the honest caveat that
  **`generic_webhook` and `csv_import` are the only two providers marked available**; Toast is
  `partial`, Square and Clover are `scaffolded` (normalizers written, awaiting merchant
  OAuth/tokens), and the rest are `planned`.
- **Plus (understand):** catalog auto-mapping at ≥0.9 confidence and unambiguous, with the
  review queue for everything below; the mapping-coverage readout ("N of M items auto-mapped,
  K need your review"); and the connection-health scorecard (checks landing, at what rate, from
  which source). Ships today.
- **Pro (optimize):** native OAuth adapters, multi-location, and cross-provider intelligence.
  🚧 **signal not built** — **no native OAuth adapter is `available` today**. A Pro tier sold as
  "native integrations" would be selling scaffolding.

The framing an entitlement page should carry, from S15 §10: Pro across the whole product is
almost definitionally *"you plugged in your POS."* That makes **S14 the true upgrade trigger,
not a price toggle** — and an argument for making connection free and frictionless.

## 11. Evolution feedback
Which providers operators actually pick (the onboarding `pos.provider` distribution) tells
us which adapter to build next — **data-driven, not Toast-by-default**. How many operators
fall back to `generic_webhook` measures the native-adapter gap. Mapping-approval rate tunes
the catalog-matcher. Every "planned" provider an operator wanted is a prioritization signal
for [[pos-bridge-charter|pos-bridge]].

**Flex points:** provider (any of 27, or the universal bridge) · connect at onboarding vs
later · push (webhook) vs pull (CSV) · single vs multi-location · native adapter vs
middleware bridge.
