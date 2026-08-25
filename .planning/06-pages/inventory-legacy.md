---
type: page
route: /inventory-legacy
slug: inventory-legacy
component: apps/web/src/pages/Inventory.tsx
audience: staff
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /inventory-legacy — Inventory (parked legacy page)

## 1. Purpose

The pre-SOTA-rebuild inventory table, parked when `/inventory` was repointed at
`InventoryCommandPage`. Same domain (stock list, add/override/locate wines, storage
locations, auto-locate engine) rendered as the older single-table page. Kept routed
as a fallback during the dual-bookkeeping migration (memory: inventory-sota-rebuild-plan).

## 2. Entry

**No inbound link anywhere.** Listed as a cold entry point in
[PAGE_MAP](../foundation/PAGE_MAP.md):117, and a repo-wide grep for
`inventory-legacy` matches only the route definition (`apps/web/src/App.tsx:256`).
Reachable by typed URL only.

## 3. Files

- Route binding: `apps/web/src/App.tsx:256` (eagerly imported at :71).
- `apps/web/src/pages/Inventory.tsx` (1,928 lines).
- Shares the page hook with the new page: `pages/inventory/useInventoryPage.ts`
  (Inventory.tsx:44).
- Rendered components: `components/inventory/{AddWineToInventoryModal, ManualOverrideModal, StorageLocationManager, MultiLocationCell, AutoLocatePreviewModal}.tsx` (Inventory.tsx:33-51), `lib/autoLocateEngine.ts`.

## 4. Endpoints

Same inventory family as the new page — atlas rows
[ENDPOINTS](../foundation/ENDPOINTS.md):249 (`inventory`), :552 (`storage-locations`):

| Method | Path | Call site |
|---|---|---|
| GET | `/inventory/:rid` (+ summary/low-stock) | `useInventoryPage` → `hooks/useInventoryData.ts:15` → `services/api/inventory.ts:66,118,129` |
| POST | `/inventory/:rid/items` | `useCreateInventoryItem` (Inventory.tsx:45) → `services/api/inventory.ts:80` |
| various | `inventoryApi` mutations (Inventory.tsx:48) | `services/api/inventory.ts` |
| GET/POST | `/storage-locations/:rid` family | `hooks/useStorageLocations.ts:70-122` (Inventory.tsx:37) |
| GET | `/wines?ids=` | `useWinesByIds` → `services/api/wines.ts:58` |

Realtime inventory subscription keeps the table live
(`useTypedInventorySubscription`, Inventory.tsx:43).

## 5. Signals

**None.** No `uxSignals`, no `data-ux-key`, no tracking (reporter dark,
`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — operate; same S02/S04/S10/S11 surface as `/inventory`
([TIER-MAP](../03-scenarios/TIER-MAP.md):38,40,46,47), but it is the superseded
rendering of it.

## 7. Rebrand surface

**0 user-visible strings** (grep of the file: no `wineops` hits). Shared layout
chrome applies (see dashboard.md §7).

## 8. State & config

- Same restaurant-settings store and realtime context as the new page
  (Inventory.tsx:42-43). No page-specific flags or env gates.

## 9. Gaps

- **Retirement is tracked but undecided**: `v3.0-TECH-DEBT.md` 44.5-correction notes
  "`/inventory-legacy` is also linked from nowhere but its own route definition —
  worth retiring, tracked separately" (v3.0-TECH-DEBT.md:483-484).
- `v3.0-TECH-DEBT.md:357` — the page `INVENTORY_SOTA_PLAN.md` describes is this one,
  parked; the plan's remaining phases target its replacement, not this file.
