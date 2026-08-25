---
type: page
route: /providers
slug: providers
component: apps/web/src/pages/Providers.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[distributors]]", "[[promotions]]", "[[vendor-prices]]"]
---

# /providers — vendor roster + distributor discovery

## 1. Purpose
Owner/manager vendor hub with two tabs (`Providers.tsx:146`): **mine** — the
restaurant's vendor roster with contacts, locations, orders, intelligence panels and
export; **discover** — the U.S. distributor catalogue on a map, one-tap add (S13).

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
- TIER-MAP S13 Pro: "discovery is catalogue-first, **comparison routes unreachable**" —
  this page never links to `/vendor-prices` (see [[vendor-prices]] §2).
- `v3.0-TECH-DEBT.md:391-393` (44.15) claims no bulk select / column sorting on
  providers — flagged there as a stale catalog needing reconciliation before action.
- S13 Plus coverage metrics "denominator flatters without POS" (TIER-MAP S13) — the
  discover tab shows catalogue reach, not supply-graph truth.
