---
type: software
slug: vendor-directory
name: Vendor Directory & Intel
division: vendor
status: partial
tier: core
routes: ["/providers?tab=mine"]
pages: [providers]
api_modules: [providers, vendor-catalogue]
agents: [provider_communication_agent, provider_conversation_agent]
owner_unit: procurement-vendor-network
updated: 2026-09-01
links: ["[[providers]]", "[[global-vendor-search]]", "[[vendor-price-compare]]", "[[communications-hub]]", "[[promotions]]", "[[procurement-vendor-network-charter]]", "[[SOFTWARE-MAP]]"]
---

# Vendor Directory & Intel

## §0 What it is

Your book of suppliers — the ones you already buy from. Each vendor has people you call,
places they deliver from, the orders you have placed with them, and a growing picture of
what they are like to work with: what they told you, how they usually respond, whether the
relationship is going well. Finding a supplier you *don't* yet work with is the other half
of the same screen, and that is [[global-vendor-search]].

## §1 Features today

- Add, edit and delete a vendor
- Keep each vendor's contacts — name, role, phone, email — and edit or remove them
- Keep each vendor's delivery locations
- Record when you last spoke to a vendor
- See every order placed with a vendor
- Rate a vendor and see its performance record
- Email a vendor without leaving the page (Quick Gmail modal)
- Search the shared vendor catalogue and add a match as your own vendor, with duplicates
  caught before they are created
- Export the roster; contextual insights rail alongside it
- The intelligence panels — what we know about the vendor, its promotions, past
  conversations, sentiment over time — *dark* for almost every tenant (see §4)
- A link to the price-comparison screen built for exactly this job — **missing**;
  [[vendor-price-compare]] is unreachable from here ([[providers]] §9)

## §2 Screens

- [[providers]] — this software is the `?tab=mine` half of the page
  (`apps/web/src/pages/Providers.tsx`, 1,484 LOC; tab split at `:146`). The `discover`
  half is a **different software** ([[global-vendor-search]]).

Route is `PageGate`-wrapped (`apps/web/src/App.tsx:293`), so the legacy `Providers`
surface and the p3 `ProvidersNext` surface (`apps/web/src/pages/providers/next/`,
7 files incl. `TwinSheet.tsx`) can differ. Check the flag before trusting a screenshot.

## §3 Backend

Two controllers on **the same `providers` prefix**, in one module:

| Controller | `@Controller` | Routes | Covers |
|---|---|---|---|
| `providers/providers.controller.ts` | `:37` | **28** | roster CRUD, contacts, locations, orders, ratings, performance |
| `providers/provider-intelligence.controller.ts` | `:20` | **17** | knowledge, promotions, conversation memory, sessions, sentiment, outreach |

Plus `vendor-catalogue` for the add-from-catalogue path —
`@Controller("vendor-catalogue")` at `vendor-catalogue.controller.ts:22`, **3** routes
(`search` `:29`, `match` `:77`, `:id` `:104`), consumed by `VendorSearchModal`,
`VendorMatchModal` and `useDuplicateVendorCheck` through
`apps/web/src/services/api/vendors.ts:74,99,112,121`. That module is **shared** with
[[global-vendor-search]] and with the corpora lanes.

**Two corrections to the module list this note was commissioned with:**

- **`vendor-intel` is not part of this software.** Its web client
  `apps/web/src/services/api/vendorIntel.ts` has exactly one importer in the repo —
  `VendorPriceCompare.tsx:26`. It belongs to [[vendor-price-compare]].
- **`contacts` is not part of this software, and has no consumer at all.** Vendor contacts
  are served by `providers.controller.ts:361,377,394,416` (`/providers/:id/contacts`).
  The separate `contacts` module — `@Controller("contacts")` at `contacts.controller.ts:38`,
  8 routes, class-guarded at `:37` — has **zero callers anywhere in `apps/`** (grep for
  `/contacts` across `apps/web` and `apps/mobile` returns only the `providers/:id/contacts`
  client). It is a dead module that the org chart still assigns
  ([[messaging-delivery-charter]] boundary table, "`contacts` 8 — all unguarded" — also
  stale: it is guarded).

## §4 Automation

Two agents touch this software, and both are gated:

- `services/agent-orchestrator/agents/provider_conversation_agent.py` (3,227 LOC) — the
  **sole writer** of the four tables behind the intelligence panels
  (`provider_knowledge`, `provider_sentiment_history`, `conversation_embeddings`,
  `provider_conversation_sessions`; writers at `:1453,2216,1160,754`). It is registered
  (`core/orchestrator.py:184`) but sits behind `PROV_AGENT_LEVEL4_ENABLED`, which
  **defaults false** (`config/settings.py:194-197`). Worse: **seven of the routing keys it
  subscribes to appear nowhere else in the repo** — `conversation.inbound.email`,
  `.sms`, `.whatsapp`, `provider.promo_check_requested`, `provider.profile_refresh_requested`,
  `provider.outreach_scheduled`, `provider.created` (`:339-350`; grep across
  `apps/api-gateway/src` + `services/agent-orchestrator` finds no publisher). Only
  `procurement.conversation_request` has real producers (`procurement.service.ts:877`,
  `communications.controller.ts:746,934`, `procurement_agent.py:231`).
- `provider_communication_agent.py` (1,405 LOC) — registered at `core/orchestrator.py:213`,
  subscribes to `procurement.order.created`, `provider.draft.approved`,
  `provider.draft.discarded`, `provider.invoice.received` (`:117-127`). It drafts outbound
  vendor mail; the surface a human approves it on is [[communications-hub]].

No `@Cron` sweep refreshes anything on this page.

## §5 Data

Read/written from `providers.service.ts` + `provider-intelligence.service.ts`:
`providers`, `provider_contacts`, `provider_locations`, `provider_ratings`,
`provider_performance_metrics`, `provider_knowledge`, `provider_promotions`,
`provider_sentiment_history`, `provider_conversation_sessions`, `conversation_embeddings`,
`order_interactions`, `procurement_orders`, `procurement_conversations`,
`user_onboarding_progress`, `vendor_catalogue`.

It **owns** the `provider*` family. It does not own `vendor_catalogue` (shared, §3),
`procurement_orders` (procurement), or `procurement_conversations`
([[communications-hub]]).

## §6 Owner

[[procurement-vendor-network-charter]] — team `procurement-vendor-network`, department
`engineering`, division Platform
(`01-org/platform/engineering/teams/procurement-vendor-network/`). Its boundary table
claims `providers/providers` and `providers/provider-intelligence` outright, and its
mandate is *"Own the money path outward: orders, RFQs, receiving, credits, recurring
orders, vendor catalogues, price observations, and the distributor graph"*
(`procurement-vendor-network-charter.md:20-22`).

Two live claims sit on top of it and are worth recording rather than hiding:

- [[supply-discovery-charter]] claims *"the comparison surface's product definition —
  `/vendor-prices`, `/distributors`, `/providers` … jointly with
  [[surface-portfolio-charter]]"* (`supply-discovery-charter.md:33-35`). Product
  definition, not code — the two do not conflict, but nothing says so in writing.
- The `contacts` module this note was assigned belongs to [[messaging-delivery-charter]]
  (`messaging-delivery-charter.md` boundary table). Moot in practice: nothing calls it (§3).

## §7 Maturity & seams

**partial**, and the split is clean: the roster half is complete and correct; the
intelligence half is a set of panels over tables whose only writer is off by default and
subscribed mostly to dead keys.

Rolled up from [[providers]] §10 — roster CRUD complete
(`providers.controller.ts:37-38,188-303,361-436,573-656`), catalogue add real including the
409 dedupe, intelligence panels dependent on one flagged Python agent that renders empty
with no explanation when it is not running.

Seams:

1. **One page, two softwares.** `Providers.tsx` is 1,484 LOC hosting this and
   [[global-vendor-search]] behind `?tab=`. Neither extracts without the other.
2. **Vendors span five gateway modules** — `providers`, `distributor-discovery`,
   `vendor-intel`, `vendor-catalogue`, `vendor-portal` — plus four web API clients
   (`providers.ts`, `vendors.ts`, `vendorIntel.ts`, `distributors.ts`). No module boundary
   matches a product boundary.
3. **One prefix, two controllers.** `providers` is served by two `@Controller("providers")`
   classes with different guards and different owners of the underlying data. Route order
   is load-bearing and commented as such (`providers.controller.ts:123-125`).
4. **A dead module in the division.** `contacts` ships 8 guarded routes with no caller (§3).
5. **The intelligence panels fail silently.** If the agent is not running, four panels
   render empty and the page says nothing — indistinguishable from "this vendor is quiet".

## §8 Where it's going

- ADR 0049 §3a puts this in the **Vendor** division, phase **E1** (cross-runtime send
  reliability); the division note names `providers` and `contacts` among its modules
  (`04-specs/ECOSYSTEM-PLAN.md:55`).
- The unlinked [[vendor-price-compare]] is the cheapest real fix on this page —
  TIER-MAP S13 Pro names "comparison routes unreachable" as a defect, and the fix is a link.
- The intelligence half is blocked on publishers, not on the agent: seven of its input
  routing keys have no producer (§4). Naming who emits `conversation.inbound.email` is the
  decision that unblocks it.
- OD-101 (should the email composer read/write `provider_knowledge`) sits directly on this
  software's data.
