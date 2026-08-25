---
type: page
route: /wines
slug: wines
component: apps/web/src/pages/WineLibrary.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[TIER-MAP]]"]
---

# /wines — Wine Library

## 1. Purpose
Browse the master wine catalogue as this restaurant sees it — search/filter/sort ~500
wines, see stock overlay from inventory, compare list price to market price, and add
catalogue wines into inventory. Owner/manager surface; staff can read.

## 2. Entry
Sidebar item (`apps/web/src/components/layout/Sidebar.tsx:79`). PAGE_MAP records
in-degree 1 (`.planning/foundation/PAGE_MAP.md:148`). Not an orphan route.

## 3. Files
- Route: `apps/web/src/App.tsx:260` → `pages/wine-library/index.tsx` (3-line re-export of `pages/WineLibrary.tsx`, 1,901 lines)
- State/filter hook: `apps/web/src/pages/wine-library/useWineLibraryPage.ts` (353 lines)
- API→UI mapping: `apps/web/src/lib/wine-library.ts` (`mapApiWinesToUiWines`)
- Modals: `components/wines/AddWineModal.tsx`, `AddWineSelectionModal.tsx`, `MenuScannerModal.tsx`, `components/scanner/MenuScannerFlow.tsx`, `DevWinePhotoUpload.tsx`, `DevManualWineEntry.tsx`, `AddToInventoryFromLibraryModal.tsx` (imports at `WineLibrary.tsx:4-10`)

## 4. Endpoints
- `GET /wines` (search, `limit: 500`) — `services/api/wines.ts:30` via `useWines` (`useWineLibraryPage.ts:96-99`); ENDPOINTS.md:667
- `GET /inventory` — stock overlay via `useInventory` (`useWineLibraryPage.ts:100`)
- `GET /providers` — `services/api/providers.ts:201` via `useProviders` (`useWineLibraryPage.ts:101`)
- `GET /providers/recommendations?restaurantId&wineId` — `services/api/providers.ts:314-316` via `useRecommendedProviders` (`WineLibrary.tsx:161`), fires on wine selection
- `POST /inventory` — add-to-inventory flow, `services/api/inventory.ts:80` via `AddToInventoryFromLibraryModal`
- Realtime: wine update subscription over WebSocket (`useWineSubscription`, `WineLibrary.tsx:48`)

## 5. Signals
none. No `uxSignals`, no tracking calls (grep of `WineLibrary.tsx` + `wine-library/` — zero hits).

## 6. Tier cut
Core. Scenarios: S06 (new dish/menu item — wine catalogue is the ✅ half), S17 (same
product two identities — this page renders the merged library), S10 (stock-status chips
feed the stockout story). See TIER-MAP rows S06/S10/S17.

## 7. Rebrand surface
none — no user-visible `WineOps` strings on this page.

## 8. State & config
All client state (view mode, 9 filters, sort cycle) in `useWineLibraryPage.ts:74-93`.
`measurementUnit` from `useRestaurantSettingsStore` drives volume rendering. No feature
flags, no env vars.

## 9. Gaps — enrichment surfaces here, but thin
- **Market Price column is plumbing without data**: wired to
  `master_wine_library.retail_price_avg`, which is **null on all 442 rows** — renders
  "—" until price enrichment exists (`v3.0-TECH-DEBT.md:432-440`; render at
  `WineLibrary.tsx:1075-1089`).
- **Enrichment fields arrive on the wire and are dropped**: the API `Wine` type carries
  `description`, `tastingNotes`, `pairingNotes`, `appellation`, `imageUrl`
  (`services/api/types.ts:324-328`), but `mapApiWinesToUiWines` maps none of the notes
  fields — the page never shows tasting/pairing text (`lib/wine-library.ts` has no
  `tastingNotes`/`description` mapping; verified by grep).
- **Body filter is dead**: `body` is hardcoded to `'medium'` for every wine
  (`lib/wine-library.ts:32`), so the Body filter (`useWineLibraryPage.ts:204-206`)
  can only match everything or nothing.
- `liveStock: null, threshold: 6` are hardcoded in the mapper for catalogue-only wines
  (`lib/wine-library.ts:38-39`) — the reason Stock/Status columns were dropped
  (`v3.0-TECH-DEBT.md:432-435`).
- **44.1b**: wine-library duplicate-add silently loses stock and reports success
  (`v3.0-TECH-DEBT.md:47-49`).
- 44.15's claim of "no bulk select or column sorting on wines" is stale: column sort
  exists (`useWineLibraryPage.ts:306-319`) and bulk selection exists
  (`WineLibrary.tsx:409-427`) (`v3.0-TECH-DEBT.md:391-393` — catalog reconciliation
  pending).
