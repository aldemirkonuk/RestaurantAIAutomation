---
type: page
route: /providers
slug: providers
softwares: [vendor-directory, global-vendor-search]
component: apps/web/src/pages/Providers.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[distributors]]", "[[promotions]]", "[[vendor-prices]]", "[[orders]]"]
---

# /providers — vendor roster + distributor discovery

> **Part of** [[08-softwares/vendor-directory|Vendor Directory & Intel]] · [[08-softwares/global-vendor-search|Global Vendor Search]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Add provider** → (modal) → API `POST /api/v1/providers`
- **View orders** (row menu) → [[orders]] `/orders?provider=<id>`
- **Discover tab** → renders the [[distributors]] map inline (no route change)
- **Email vendor** → (QuickGmailModal on this page)
- **Call** → external `tel:<phone>`
- **Open website** → external vendor site
- **Address** → external Google Maps search

## 1. Purpose
Owner/manager vendor hub with two tabs (`Providers.tsx:146`): **mine** — the
restaurant's vendor roster with contacts, locations, orders, intelligence panels and
export; **discover** — the U.S. distributor catalogue on a map, one-tap add (S13).

## 1a. Features
- **Mine** tab: your vendor roster — add, edit, delete vendors; manage each vendor's contacts and locations
- Vendor intelligence panels: knowledge, promotions, conversation memory, sentiment
- Email a vendor from the page (Quick Gmail modal)
- See each vendor's orders
- Search the vendor catalogue and add a vendor with one tap (duplicates detected)
- **Discover** tab: the U.S. distributor catalogue on a map with facet filters and one-tap add
- Export; contextual insights rail
- 🚧 No link to `/vendor-prices` price comparison — that page is unreachable from here (§9)
- **Mudavym redesign behind `mudavym_design_providers` (OFF)**: a quiet grid of small, closed vendor buckets (≤3 real facts each: open orders · lead time · last contact) with the digital twin held back in a right-hand TwinSheet, fetched on open

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_providers`)

Canonical source with curves: `apps/web/src/pages/providers/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `pv-sheet-settle` | The sheet settles in | TwinSheet opening from a bucket card — `settle`, 320ms house curve, 24px travel |
| `pv-card-ink` | Ink micro-state | bucket-card hover/focus — border to seal ring, one paper step; nothing moves |

Deliberate non-motions: no card stagger (a roster is a reference, not an
arrival), no count tallies, instant sheet close.

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: MERGE)

The founder liked **today's page** for its small-buckets calm ("less crowded")
and the **redesign** for its digital twin — and flagged the crowding as the
failure mode. The build enforces the reconciliation structurally: the card
*promises less* (name, type, three facts all real — open orders counted from
the orders book, `leadTimeDays`, `lastContactDate`), and everything learned
lives in the sheet via `ProviderIntelligencePanel`, lazy-fetched on open so
the grid never pays for the twin. Honesty rules carried from OrdersNext: an
unreachable orders book renders open-order counts as em dashes with a line
saying so — never zeros; a never-contacted vendor says "never contacted".
Legacy page untouched; flag defaults OFF; per-browser override
`mudavym.design.providers`. One ask deliberately substituted, disclosed: the
verdict's example behavioural fact ("confirms in 6 hours", "ships Tuesdays")
has no backing field on `interface Provider`, so the card carries
`lastContactDate` instead — a real fact, not an invented behaviour; the
learned behaviours stay in the sheet's intelligence panel. A second known
coherence gap: that panel renders in the legacy grey/blue skin inside the
İznik sheet — filed in §9 and v3.0-TECH-DEBT rather than hacked over with
CSS overrides.

## 2. Entry
Sidebar item (`components/layout/Sidebar.tsx:87`). `/distributors` redirects here with
`?tab=discover` (`App.tsx:271-274`). PAGE_MAP records an outbound edge providers→orders
(`PAGE_MAP.md:85`).

## 3. Files
- Route: `apps/web/src/App.tsx:264` → `pages/Providers.tsx` (1,484 lines)
- Discover tab lazy-loads `pages/distributors/command/DistributorMapPage.tsx`
  (`Providers.tsx:150-151`, rendered `:661`) + `pages/distributors/useDistributorsPage.ts`
- Modals/panels: `components/providers/AddProviderModal.tsx`, `EditProviderModal.tsx`,
  `VendorSearchModal.tsx`, `ProviderIntelligencePanel.tsx` (→ Knowledge/Promotions/
  ConversationMemory/Sentiment panels), `components/emails/QuickGmailModal.tsx`,
  `components/insights/ContextualInsights.tsx` (imports `Providers.tsx:43-52`)

## 4. Endpoints
- `GET/POST/PUT/DELETE /providers[/:id]` — `services/api/providers.ts:201-236` via hooks
  (`Providers.tsx:28`); ENDPOINTS.md providers module
- Contacts CRUD `/providers/:id/contacts[/:contactId]` (`providers.ts:243-283`)
- Locations CRUD `/providers/:id/locations[/:locationId]` (`providers.ts:456-498`)
- `GET /orders` via `useOrders` (`Providers.tsx:28`)
- Catalogue: `GET /vendor-catalogue/search` (`services/api/vendors.ts:74`) and add-from-
  catalogue `POST /providers` (`vendors.ts:121,131`) via `VendorSearchModal`
- Discover: `GET /distributors/search`, `/distributors/facets`, `/distributors/:id`
  (`services/api/distributors.ts:158-173`; ENDPOINTS.md:210-216)
- Intelligence panel: `GET /providers/:id/promotions`, `/providers/promotions/active`,
  `/expiring`, `/savings` + knowledge/conversation-memory
  (`services/api/provider-intelligence.ts`; ENDPOINTS.md:450-459)

## 5. Signals
none. (Realtime dispatch consumed via `useRealtimeDispatch`, `Providers.tsx:52` —
inbound updates, not emitted telemetry.)

## 6. Tier cut
Core — S13 (new vendor discovery & onboarding: catalogue search, one-tap add, 409
dedupe are the ✅ Core row). Also touches S02 (vendor scorecard adjacency) and S08
(price-drift entry via intelligence panel). See TIER-MAP S13.

## 7. Rebrand surface
none — no user-visible `WineOps` strings (grep of `Providers.tsx`: zero hits).

## 8. State & config
- `?tab=discover|mine` URL param drives the tab (`Providers.tsx:229-237`)
- `useUserPreferences` for per-user view prefs; auth store for restaurantId
- No feature flags

## 9. Gaps
- TwinSheet's intelligence panel renders in the legacy grey/blue skin inside
  the İznik sheet (`ProviderIntelligencePanel` is a shared legacy component) —
  the founder's "set does not cohere" complaint, reproduced in miniature;
  re-skin filed in v3.0-TECH-DEBT rather than patched with CSS overrides.
- TIER-MAP S13 Pro: "discovery is catalogue-first, **comparison routes unreachable**" —
  this page never links to `/vendor-prices` (see [[vendor-prices]] §2).
- `v3.0-TECH-DEBT.md:391-393` (44.15) claims no bulk select / column sorting on
  providers — flagged there as a stale catalog needing reconciliation before action.
- S13 Plus coverage metrics "denominator flatters without POS" (TIER-MAP S13) — the
  discover tab shows catalogue reach, not supply-graph truth.

## 10. Maturity

**partial.** The roster half is complete and correct. The intelligence half renders
panels over five tables whose only writer is a single Python agent, and the page never
links to the comparison surface built for it.

| Evidence | `path:line` |
|---|---|
| **Roster CRUD is complete** — providers, contacts and locations all have real create/read/update/delete routes under a class-level `JwtAuthGuard`. | `providers.controller.ts:37-38,188-303,361-436,573-656` |
| **Catalogue add is real**, including the 409 dedupe that S13 Core claims. | `vendor-catalogue.controller.ts`; client `services/api/vendors.ts:121,131` |
| **Discover tab is real** — `GET /distributors/search` runs the `search_distributors` RPC over `vendor_catalogue` joined to `vendor_locations`, `vendor_service_territories` and `vendor_portfolio_facets`. | `distributor-discovery.controller.ts:34-89`; `distributor-discovery.service.ts:84,177-204` |
| **The intelligence panels depend on one Python agent.** `provider_knowledge`, `provider_sentiment_history`, `conversation_embeddings` and `provider_conversation_sessions` are each written by exactly one file — `provider_conversation_agent.py` — reachable only via the orchestrator's registry and a Level-4 feature flag. If that agent is not running for a restaurant, all four panels render empty and the page gives no indication why. | writers `agents/provider_conversation_agent.py:1453,2216,1160,754`; registry `core/orchestrator.py:181,297`; flag `config/settings.py:193`; readers `provider-intelligence.service.ts:18,251,304,355` |
| **The Promotions panel now has a live producer** — the D3 lane extracts deterministically from provider-matched inbound mail into `provider_promotions`, on every message, plus a 09:00 digest cron. (Supersedes the "dormant" note carried in memory and in [[promotions]] §9.) | `common/orchestrator/promotion-extractor.service.ts:37-60,179`; wiring `rabbitmq-bridge.service.ts:789-799` |
| **Never links to [[vendor-prices]]** — the price-comparison page built for exactly this job is unreachable from the vendor hub, which TIER-MAP S13 Pro names as a defect. | §9 of this note; [[vendor-prices]] §2 |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET/POST/PATCH/DELETE `/providers[/:id]` | JWT (class) | `providers.controller.ts:215,231,188,251,277` | roster CRUD |
| `/providers/:id/contacts[/:cid]` (4 verbs) | JWT | `:361-436` | contact CRUD |
| `/providers/:id/locations[/:lid]` (4 verbs) | JWT | `:573-656` | location CRUD |
| GET `/providers/:id/orders`, `/performance`, `/recommendations` | JWT | `:303,317,464` | order history, scorecard, ranked providers |
| GET `/providers/:id/knowledge`, `/knowledge/contradictions` | JWT (class) | `provider-intelligence.controller.ts:32,49` | `provider_knowledge` facts + conflicts |
| GET `/providers/:id/promotions`, `/promotions/active`, `/expiring`, `/compare`, `/savings` | JWT | `:87-146` | `provider_promotions` |
| GET/POST `/providers/:id/conversation-memory[/search]` | JWT | `:163,185` | `conversation_embeddings` |
| GET `/providers/:id/sessions[/:sid/summary]`, `/sentiment` | JWT | `:212,232,249` | session + sentiment history |
| GET `/vendor-catalogue/search`; POST `/providers` | JWT | `vendor-catalogue.controller.ts` | catalogue search, add-with-dedupe |
| GET `/distributors/search`, `/facets`, `/:id` | JWT (class) | `distributor-discovery.controller.ts:39,64,89` | map results, facet counts, detail |
| GET `/analytics/insights/:rid` via `ContextualInsights` | **JWT required, none sent** → 401 | `analytics.controller.ts:243` | nothing — same defect as [[orders]] and [[inventory]] |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Vendor roster | manual entry + one-tap add from the catalogue + prospect promotion on [[promotions]] | `providers.controller.ts:188`; `common/orchestrator/prospects.controller.ts` |
| `vendor_catalogue` (discover tab) | seeded corpus | `supabase/migrations/seed/27_vendor_catalogue_seed.sql`; geo migrations `20260807001252/001352/001452` |
| `provider_promotions` | **D3 inbound-email lane**, live on every provider-matched message | `promotion-extractor.service.ts:37`; `rabbitmq-bridge.service.ts:789` |
| `provider_knowledge`, `provider_sentiment_history`, `conversation_embeddings`, `provider_conversation_sessions` | `ProviderConversationAgent` only, behind a Level-4 flag | `agents/provider_conversation_agent.py`; `config/settings.py:193` |
| Order history / performance | POs from [[orders]] | `procurement_orders` |

**Finding:** four of the six intelligence panels have a **single-agent, flag-gated
producer**. That is not "no producer", but it is a producer that can be off without any
signal on the page — the panels degrade to empty, which reads as "this vendor is quiet".

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Add / edit / delete provider | `providers` | [[orders]] vendor picker, [[promotions]] prospect promotion target, invoice matching |
| Add from catalogue | `providers` (409 on duplicate) | as above |
| Contacts / locations CRUD | `provider_contacts`, `provider_locations` | outbound mail routing, territory checks |
| Rate a provider (`POST /providers/:id/rate`) | provider score | scorecard |
| Quick Gmail send | `communications` | vendor thread on [[orders]] |

## 12. Design intent

**Should be:** the supply graph — who we buy from, what we know about them, what they
have offered lately, and who else could sell us the same bottle for less.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query flags |
| empty | ⚠️ — roster empty state is fine; the four intelligence panels render empty with no explanation of *why* (agent off vs genuinely nothing) | `provider-intelligence.service.ts:18-355` returns `[]` for both |
| error | ⚠️ partial | CRUD mutations toast; the insights rail swallows its 401 |
| permission-denied | ❌ | one owner-shaped view; the intelligence endpoints are guarded server-side but nothing adapts client-side |

**Where the UI misleads:** an intelligence panel that is empty because
`ProviderConversationAgent` never ran is indistinguishable from one that is empty because
the vendor has been silent. That is the mildest form of the §44.2 shape, but it is the
same shape.

## 13. Roadmap

1. **Link to [[vendor-prices]] from the provider row and from a wine's provider list.**
   The comparison page exists, is guarded, and is unreachable — this is the single
   highest-value edge missing in the vendor cluster, and TIER-MAP S13 Pro already names
   it. *Blocker: none.*
2. **Give the four agent-fed panels a distinct empty state** — "no conversation history
   yet" vs "vendor intelligence is not enabled for this restaurant". *Blocker: needs the
   flag state exposed to the client; `config/settings.py:193` is server-side only.*
3. Move `ContextualInsights` to `apiClient` (shared fix with [[orders]] §13.3 and
   [[inventory]] §13.1).
4. Reconcile the stale 44.15 bulk-select/column-sort claim against the real page rather
   than acting on the catalog (`v3.0-TECH-DEBT.md:391-393`).
5. Emit signals: this page has zero markers and is the entry point for S13, whose Plus
   tier is scored on coverage the page cannot currently measure.
6. Fold `pages/distributors/useDistributorsPage.ts` into the discover tab or keep it
   deliberately — today it is a standalone page hook with one consumer (§9 of
   [[distributors]]).
