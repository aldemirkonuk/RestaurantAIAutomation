---
type: charter
division: product
department: partnerships-integrations
team: pos-bridge
status: exists
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[pos-bridge-premortem]]"
  - "[[pos-bridge-directive]]"
  - "[[pos-bridge-loops]]"
  - "[[connector-platform-trust-charter]]"
  - "[[partner-alliance-development-charter]]"
  - "[[engineering-charter]]"
  - "[[analytics-engine-charter]]"
  - "[[ENDPOINTS]]"
  - "[[AGENT_NATIVE_UI_DECISION]]"
---

# POS Bridge — Charter

## Mandate

Own the canonical check pipeline and the provider adapters: **one `CanonicalCheck` shape, N
normalizers, and the mapping from a POS item to our catalogue.** This team is the concrete
expression of *"become the bridge, not another POS"* — its output is the layer that makes a
restaurant's existing point-of-sale system into an input, whichever one they chose.

## Why this team is distinct

It is the only team in [[partnerships-integrations-charter]] whose deliverable is **code that
runs in production against someone else's data model.** Its constraint is a foreign API's
semantics — Toast's idea of a voided line, Square's idea of a closed order — not a
counterparty's willingness. That is precisely what separates it from
[[partner-alliance-development-charter]], whose constraint is a signature no code can
produce.

## Boundaries — owned outright

- `apps/api-gateway/src/pos-hub/` — the whole module: `pos-adapters.ts`, `pos-hub.service.ts`,
  `catalog-matcher.service.ts`, `pos-types.ts`, `pos-provider.registry.ts`, plus specs.
- The **canonical shape** (`pos-types.ts`) and its neutrality.
- The **provider registry** and every provider's status: which providers exist, what tier,
  what capabilities, what status ladder position.
- **Per-provider normalizers** — turning a foreign payload into a canonical check.
- **POS item → catalogue mapping** (`catalog-matcher.service.ts`) and the human approval
  gate over its proposals.
- The **SimPOS simulator** (`apps/api-gateway/src/simpos/`) as a development target.

## Explicit non-goals

1. **We do not build a POS.** SimPOS is a simulator for developing against, not a product.
   The moment it is offered to a venue as their point-of-sale, the bridge thesis is dead.
2. **We do not chase signatures.** Nine registry providers carry
   `authModel: "partner_agreement"` (`pos-provider.registry.ts:119, 171, 192, 222, 232, 242,
   254, 264, 298`). Those are [[partner-alliance-development-charter]]'s, and no amount of
   normalizer work moves them.
3. **We do not own the verification control.** The webhook route we own must verify — but
   [[connector-platform-trust-charter]] owns the contract and
   [[perimeter-ingress-integrity-charter]] owns the control. We implement to their spec with
   [[engineering-charter]].
4. **We do not own what happens to a canonical check downstream.** Stock depletion,
   analytics, and insight generation consume it; [[analytics-engine-charter]] and Engineering
   own those. Our obligation is that what we hand them is true.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `pi.merchant_backed_providers` | Providers at `status: "available"` **with a real merchant behind them** | **2 available, 0 with a merchant** |
| `pi.canonical_shape_drift` | Fields in `pos-types.ts` populated by exactly one provider and not capability-gated | baseline unmeasured |
| `nf_a.task_success_rate` | Catalogue-match proposal accuracy measured at the human gate — approve vs reject | no baseline; the gate has never run on real data |

**The primary metric is `pi.merchant_backed_providers`, and the second half of that phrase is
the whole metric.** `scaffolded` count is vanity — see [[pos-bridge-premortem]] M1.

## Evidence today — EXISTS (substantial)

Verified in-session against the working tree.

### The module is real

- `apps/api-gateway/src/pos-hub/` — 10 files: `pos-adapters.ts` (+ spec),
  `pos-hub.service.ts` (+ spec), `catalog-matcher.service.ts` (+ spec), `pos-types.ts`,
  `pos-provider.registry.ts`, `pos-hub.controller.ts`, `pos-hub.module.ts`.
- **27 providers** in the registry, with `registrySummary()` at
  `pos-provider.registry.ts:328` aggregating by tier and status.
  *(Correction: [`foundation/teams/product.md:658`](../../../../../foundation/teams/product.md)
  says 30. Counted this session: 27 — 2 `available`, 1 `partial`, 2 `scaffolded`, 22
  `planned`.)*
- Capability model is already **per-provider, not per-shape**:
  `CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL` across `checks, items, tables, employees,
  webhooks` (`:17-25`). This is the structural defence against vendor semantics leaking into
  the canonical type — it exists, and it works.
- 10 endpoints (`ENDPOINTS.md:355-368`), including the human gate:
  `POST /pos-hub/catalog-match/:restaurantId/proposals/:proposalId/approve|reject`.
- A simulator to develop against: `apps/api-gateway/src/simpos/`, 11 routes
  (`ENDPOINTS.md:540-550`), surfaced at `/simpos/:restaurantId` and
  `/simpos/:restaurantId/orders`.

### The registry is a strategy document, not a list

Its own header sequences the programme (`pos-provider.registry.ts:3-16`):
foundation → Square/Clover/SpotOn (*"~60% of detected SMB restaurants"*) → rest of Tier 1 →
Tier 2 (*"partner agreements needed"*) → Türkiye (Simpra, ElektraWeb, Vectron, Wolvox,
SambaPOS). And it states the bridge thesis in code:

> *"`generic_webhook` and `csv_import` are AVAILABLE TODAY — any POS or middleware (Zapier, a
> nightly export, a partner integration) can push the canonical shape and the whole analytics
> stack lights up."* — `:12-15`

### This is not greenfield — the specific citations

| Fact | Citation |
|---|---|
| Square `status: "scaffolded"`, *"Orders API normalizer implemented; needs merchant OAuth token"* | `pos-provider.registry.ts:71`, `:76` |
| `developer.squareup.com` in source | `pos-provider.registry.ts:75` |
| Clover `status: "scaffolded"`, *"Orders v3 normalizer implemented; needs merchant API token"* | `pos-provider.registry.ts:83`, `:88` |
| Toast `status: "partial"` | `pos-provider.registry.ts:58` |
| `developers.lightspeedhq.com` in source (Lightspeed itself is `planned`) | `pos-provider.registry.ts:109` |
| Onboarding already asks which POS: `'square' | 'toast' | 'clover' | 'lightspeed' | 'other' | 'none'` | `apps/web/src/contexts/OnboardingContext.tsx:95` |
| Analytics substrate is already multi-POS: `-- toast | square | lightspeed | clover | manual` | `supabase/migrations_archive/20260717120000_analytics_insight_infra.sql:65` |

**Two normalizers are written and waiting on a merchant token, not on engineering.** That is
the single most important fact about this team's starting position, and it reframes the first
task from *build* to *get one venue to authorize a connection.*

### ⚠️ The reality check that governs everything above

- **`pos_checks` = 0 real rows.** *(Updated 2026-08-24 by live query against production
  `exzueerziesmczwlhomd`: the count is now **literally zero**. The 47 `generic_webhook`
  simulator rows from the 2026-08-19 window are gone. `restaurant_tables` and
  `wine_consumption_log` are also at 0; `pos_item_mappings` and
  `pos_catalog_match_proposals` hold 92 each.)*
- Everything in this charter is therefore **capability, not throughput.** No canonical check
  produced by a real restaurant has ever entered this system.

### ⚠️ The live exposure this team owns a piece of

`ENDPOINTS.md:355` classifies all 10 pos-hub routes as unguarded webhook-module routes.
**That classification is now out of date** — re-verified against `origin/main` 2026-08-24:

- `POST /pos-hub/webhook/:provider/:restaurantId` — **verifies correctly.** HMAC-SHA256 over
  the raw body in `X-Pos-Hub-Signature`, `crypto.timingSafeEqual`, **fails closed** when
  `POS_HUB_WEBHOOK_SECRET` is unset (`pos-hub.controller.ts:61-86`,
  `pos-hub.service.ts:96-121`). This is the good pattern.
- **The other 9 routes are now guarded.** `@UseGuards(JwtAuthGuard)` sits at class level
  (`pos-hub.controller.ts:36`), so the catalogue approval gate is no longer anonymous —
  **OD-40 is fixed** and should be moved to Resolved.
- **The exposure that replaced it is scope, not absence:** `POS_HUB_WEBHOOK_SECRET` is a
  single process-wide secret shared across all 27 providers and all restaurants, and the
  webhook route never binds `restaurantId` to the key. A signature valid for one tenant is
  valid for every tenant. See [POS-BRIDGE-AUDIT §2.4](../../../../../04-specs/POS-BRIDGE-AUDIT.md)
  and draft decision OD-B.

This corrects `product.md:783`'s claim that *"0 of the 32 verify signatures today."*
Co-owned with [[connector-platform-trust-charter]] and
[[perimeter-ingress-integrity-charter]] under OD-19.

### Full coverage audit

[**POS-BRIDGE-AUDIT**](../../../../../04-specs/POS-BRIDGE-AUDIT.md) (2026-08-24) — what exists,
what is genuinely missing, what is missing but does not matter yet, and a ranked gap list.
It supersedes `md/04-updates-builds/POS_INTEGRATION_COMPLETE.md`. Two findings there outrank
everything on this charter's own roadmap because they are **already wrong**, not unbuilt:
`sale_unit` is never written (all 92 production mappings are null → every glass pour depletes
a bottle), and `voided` is never persisted (→ voided checks count as revenue forever). Both
are logged in [[pos-bridge-questions]].
