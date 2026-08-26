---
type: page
route: /wines
slug: wines
component: apps/web/src/pages/WineLibrary.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[TIER-MAP]]", "[[orders]]"]
---

# /wines — Wine Library

## Surface — buttons → where they go

- **Add Wine** → (modal — AddWineSelectionModal → scanner / manual-entry flows)
- **Add to Inventory** → (modal — AddToInventoryFromLibraryModal)
- **Reorder → Contact Provider** → stages the pending order, then hard-navigates → [[orders]] `/orders`

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

## 10. Maturity

**hollow.** Browsing works and is real. The page's two headline *actions* — "order this
wine" and "save this as a recurring order" — report success and write nothing, and the
export ships fabricated wine attributes as fact.

| Evidence | `path:line` |
|---|---|
| **"✅ Order created" — no order is created.** `handlePlaceOrder` writes a plain object into a Zustand store and navigates. There is no POST anywhere in the handler. The alert reads *"✅ Order created for {wine} … The AI will contact the selected provider(s) via Plivo. You'll receive notifications as they respond. Redirecting to Orders page…"* — none of which has happened; [[orders]] merely opens with a prefilled modal the user must still submit. | `WineLibrary.tsx:313-382`, alert text `:360-368`; staging `setPendingReorder(orderData)` `:349` |
| Plivo is a real SMS integration in the repo — but it belongs to `communications`, is not called by this flow, and mocks itself when unconfigured. The sentence is asserting a system behaviour that does not occur. | `apps/api-gateway/src/communications/sms.service.ts:23-37` |
| **"Save as recurring order" is component state.** `savedPreferences` is a bare `useState` map, and the per-wine "recurring" badge reads from it. It is lost on navigation and on reload — and the app *has* a real `recurring-orders` module the control does not touch. | `WineLibrary.tsx:140,320-332,1012`; unused backend `procurement/recurring-orders.controller.ts:36` |
| **Fabricated attributes are exported as data.** `mapApiWineToUiWine` hardcodes `body:'medium'`, `sweetness:'dry'`, `acidity:'medium'`, `alcohol:0`, `aromas:[]`, `flavors:[]` for **every** wine — and the export builder ships exactly those as columns *Body / Sweetness / Acidity / Alcohol % / Aromas / Flavors*. A 500-row CSV in which every wine is medium-bodied, dry and 0% ABV leaves the product looking like a dataset. | mapper `lib/wine-library.ts:32-37`; export columns `WineLibrary.tsx:459-464` |
| **A whole provider block is fabricated per wine** — `{ name:'Unknown Provider', contact:'Contact Provider', phone:'N/A', email:'N/A', address:'N/A' }`. Not currently rendered (the UI reads real providers from `useProviders`), but it is what `action.wine.provider.name` resolves to in [[dashboard]]'s one-tap path (`OneTapActionCenter.tsx:588,603`). | `lib/wine-library.ts:45-51` |
| **Market Price is plumbing without data** — bound to `master_wine_library.retail_price_avg`, whose only writer is a Celery task that is scheduled but has no deployed worker (see [[inventory]] §10). | `WineLibrary.tsx:1075-1089`; `lib/wine-library.ts:24-26`; `jobs/celery_app.py:118`; `v3.0-TECH-DEBT.md:432-440` |
| **Enrichment arrives on the wire and is discarded.** `description`, `tastingNotes`, `pairingNotes`, `imageUrl` are on the API type and unmapped. | `services/api/types.ts:324-328`; `lib/wine-library.ts` (no mapping) |
| Reads are genuine: `/wines` search over `master_wine_library` with the inventory overlay and a live WebSocket subscription. | `wines.controller.ts:38`; `wines.service.ts:489`; `WineLibrary.tsx:48` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/wines?limit=500` | JWT (class) | `wines.controller.ts:30-38` → `wines.service.ts:489` | master library rows incl. `retail_price_avg` (null on all rows today) |
| GET `/wines/:wineId`, `/wines/:id/similar`, `/wines/meta/*` | JWT | `:52-80` | detail, similars, facets |
| GET `/inventory/:rid` | JWT | `inventory.controller.ts:35` | stock overlay |
| GET `/providers` | JWT | `providers.controller.ts:215` | roster for the reorder picker |
| GET `/providers/recommendations?restaurantId&wineId` | JWT | `providers.controller.ts:101` → `providersService.getRecommendations` | ranked providers for the selected wine |
| POST `/inventory/:rid/items` | JWT | `inventory.controller.ts:53` | add-to-inventory — **this one does persist** |
| WS wine updates | socket | `websocket` module | live catalogue edits |

All calls go through `apiClient` (bearer token attached, `services/api/client.ts:62`).

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| `master_wine_library` rows | menu/label scanning (`MenuScannerFlow` → orchestrator `/api/v1/scan/*`), wine submissions, and the seeded corpus | `services/wineDetection.ts:342-457`; `wines/wine-submissions.service.ts` |
| Provisional stubs → resolved wines | `research.dispatch_batch` Celery beat, hourly at :30 — **no-op unless `RESEARCH_DISPATCH_ENABLED=true`** | `jobs/celery_app.py:150-158` |
| `critic_scores` + `retail_price_avg` | `score.rescore_stale_wines` Celery beat, 03:00 UTC — **no worker in any deploy config** | `jobs/score_tasks.py:16,277`; `jobs/celery_app.py:118` |
| Stock overlay | [[inventory]]'s ledger | `inventory.service.ts` |
| Body / sweetness / acidity / alcohol / aromas / flavors | **no producer — hardcoded in the client mapper** | `lib/wine-library.ts:32-37` |

**Finding:** six of the page's wine attributes have no producer at all — they are
constants — and two more (market price, research enrichment) have producers that are
scheduled but not running.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Add to inventory | `restaurant_inventory` via `POST /inventory/:rid/items` | [[inventory]], low-stock sweep, dashboard |
| Add wine (scan / manual) | `master_wine_library` + submissions queue | the catalogue itself |
| "Remove from library" | `user_preferences.removedWines` — a **per-user view filter**, not a catalogue change; the alert's "still available in the Master Library" is accurate | `WineLibrary.tsx:302-311` |
| Reorder | **nothing** — in-memory Zustand only (§10) | [[orders]] reads it on mount (`Orders.tsx:449`) if the SPA was not reloaded |
| Save as recurring | **nothing** — `useState` (§10) | none |

## 12. Design intent

**Should be:** the master catalogue as this restaurant sees it — what exists, what we
carry, what it costs us versus the market, and a one-tap route from "we're out of this"
to a real purchase order.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | `useWines` flags |
| empty | ⚠️ mixed — Market renders "—" (honest); Body/Alcohol render fabricated constants (dishonest) | `WineLibrary.tsx:1075-1089` vs `lib/wine-library.ts:32-37` |
| error | ❌ | no error branch; three flows use `alert()`/`confirm()` rather than the app's toast system (`:301,317,360`) |
| permission-denied | ❌ | one owner-shaped view; §1 says staff can read but nothing enforces or adapts |

**Where the UI misleads**

1. **A success alert for a write that never happened** (§10) — the canonical §44.2 shape,
   made worse by naming a delivery mechanism (Plivo) that is not involved.
2. **A persistence promise for a checkbox in `useState`** — "save as recurring" survives
   nothing, next to a backend module that would have stored it.
3. **Fabricated tasting attributes exported as a dataset** (§10).
4. **A dead Body filter** — every wine is `'medium'`, so the control can only match all or
   none (`useWineLibraryPage.ts:204-206`).

## 13. Roadmap

1. **Make Reorder create an order, or stop saying it did.** Either `POST
   /procurement/orders` here, or change the alert to "Draft prepared — review it on
   Orders". The second is a five-minute honest fix; the first is the right product.
   *Blocker: none.*
2. **Wire "save as recurring" to `recurring-orders`, or remove the checkbox** — the
   controller already exists (`recurring-orders.controller.ts:36`).
3. **Drop the six fabricated columns from the export** (and the Body filter with them)
   until a producer exists. Exporting constants as measurements is the most damaging
   thing on this page because it leaves the building as a file.
4. **Map the enrichment fields that already arrive** — `description`, `tastingNotes`,
   `pairingNotes`, `imageUrl` (`services/api/types.ts:324-328`). Free content, zero new
   endpoints.
5. Replace `alert()`/`confirm()` with the toast + dialog system used everywhere else.
6. Market Price: deploy the scoring worker or remove the column — same decision as
   [[inventory]] §13.2, and it should be made once for both. *Blocker: founder decision
   on running Celery beat/worker.*
