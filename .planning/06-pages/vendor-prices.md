---
type: page
route: /vendor-prices
slug: vendor-prices
component: apps/web/src/pages/VendorPriceCompare.tsx
audience: owner
tier: plus
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[wines]]"]
---

# /vendor-prices — cross-vendor price comparison

## 1. Purpose
Pick a wine, see every vendor's observed price side by side with source provenance
(invoice / catalogue / quote / rep message / social / manual — `VendorPriceCompare.tsx:28-44`)
and 7/30/90-day trend chips, and record a manually observed price. The S08 price-drift
surface.

## 2. Entry
**No inbound in-app link** (`PAGE_MAP.md` entry-point list) — cold URL only. TIER-MAP
S13 Pro names this exact defect: "comparison routes unreachable". Route comment notes
the role gate is enforced server-side (owner/manager on `/vendor-intel/*`), "a hidden
route is not access control" (`App.tsx:265-268`).

## 3. Files
- Route: `apps/web/src/App.tsx:268` → `pages/VendorPriceCompare.tsx` (595 lines,
  self-contained)
- API modules: `services/api/vendorIntel.ts`, `services/api/wines.ts`

## 4. Endpoints
- `GET /wines` (search) + `GET /wines/:wineId` — wine picker
  (`VendorPriceCompare.tsx:16`; `services/api/wines.ts:30,42`)
- `GET /vendor-intel/compare?masterWineId|signatureHash&windowDays`
  (`services/api/vendorIntel.ts:63-71`; ENDPOINTS.md:651, ✅ JWT)
- `POST /vendor-intel/observations` — record a manual price
  (`vendorIntel.ts:91-92`; ENDPOINTS.md:652)

## 5. Signals
none.

## 6. Tier cut
**Plus** — S08 (vendor price drift) is the library's only `plus`-tier scenario; its
Plus row ("7/30/90 trend chips, show-your-working panel, drift flag ✅") is this page.
Pro adjacency: COGS attribution / switch-worthiness are wine-only per TIER-MAP S08.

## 7. Rebrand surface
none.

## 8. State & config
- URL search params carry the selected wine (`useSearchParams`, `:2`)
- No feature flags; retry policy skips client errors (`vendorIntel.ts:115`)

## 9. Gaps
- **Unreachable by navigation** (§2) — the page ships and nobody can find it; the
  single highest-leverage fix is a link from [[providers]] or [[wines]].
- Honesty patterns worth keeping when touched: null trend renders "No comparable
  data", never 0% (`VendorPriceCompare.tsx:100-110`); server error message shown
  verbatim, not axios's generic text (`:466`).
- Depends entirely on observation density: with only invoice-derived observations the
  comparison degenerates to one column per wine (S08's food scaffolding caveat,
  TIER-MAP S08).
