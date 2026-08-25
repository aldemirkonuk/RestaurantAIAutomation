---
type: page
route: /v/:slug
slug: vendor-public-page
component: apps/web/src/pages/VendorPortal.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[vendor-prices]]"]
---

# /v/:slug — public vendor catalogue

## 1. Purpose
A vendor's published wine catalogue for *their* customers: searchable, sortable
(name / price-per-750ml / vintage) listing table with contact details. Double duty by
design: "read back by our own ingester as an api_catalog observation rather than a
website_scrape — which is the whole reason to host it" (`VendorPortal.tsx:40-48`).

## 2. Entry — the Growth story
**The app's only real public content route.** No auth, no tenant, no inbound in-app
link (`PAGE_MAP.md` entry-point list) — entry is entirely external: the vendor shares
their own URL, and search engines can index it via the injected schema.org JSON-LD
(`ItemList` → `Product` → `Offer` with price/currency/availability,
`VendorPortal.tsx:118-158`) plus a real `document.title` (`:154`). Every visit is a
vendor marketing *their* catalogue on Mudavym infrastructure — inbound acquisition the
platform gets for free, and the priced observations feed [[vendor-prices]] comparisons.
Route comment: `App.tsx:159-161`.

## 3. Files
- Route: `apps/web/src/App.tsx:161` (public section) → `pages/VendorPortal.tsx`
  (374 lines, fully self-contained — no shared layout, no auth context)

## 4. Endpoints
- `GET {VITE_API_GATEWAY_URL}/api/v1/vendor-portal/:slug` — direct axios
  (`VendorPortal.tsx:93-94`); ENDPOINTS.md:656-660, explicit `@Public()` 🌐
- The sibling `GET /vendor-portal/:slug/jsonld` (ENDPOINTS.md:661) is **not called by
  this page** — it serves the ingester; the page injects its own JSON-LD client-side.

## 5. Signals
none — no view tracking of any kind. For the one page whose whole point is external
reach, Growth cannot see a single visit.

## 6. Tier cut
Public — outside the subscriber tiers. Feeds S08 (drift observations) and S13
(vendor presence) from the supply side.

## 7. Rebrand surface
none. Page brands itself as the vendor (`displayName`, logo), not the platform —
which also means zero Mudavym attribution (see §9).

## 8. State & config
- `VITE_API_GATEWAY_URL` (default `http://localhost:4000`, `VendorPortal.tsx:6`)
- Client state only: search query + sort. Honest sorts: unpriced listings sort last,
  "absent is not cheapest" (`:172-182`); prices normalized to per-750ml (`:51-57`)

## 9. Gaps
- **JSON-LD is client-injected** (`:118-158`): crawlers that don't execute JS see an
  empty SPA shell — the SEO value of the schema.org block is conditional on Google-class
  rendering. The server-side `/jsonld` endpoint exists but nothing wires it into the
  served HTML.
- No OpenGraph/meta tags → vendor links shared in chat/social unfurl blank.
- No platform attribution or sign-up path anywhere on the page — the Growth loop
  (vendor's customer → Mudavym) has no hook.
- No pagination; entire catalogue in one payload/table.
