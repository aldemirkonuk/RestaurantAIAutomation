---
type: page
route: /inventory
slug: inventory
component: apps/web/src/pages/inventory/command/InventoryCommandPage.tsx
audience: staff
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /inventory — Inventory Command

## 1. Purpose

"Inventory Command — production port of sketch 038. 3a live/shadow spine: 9-column
table, row-expand detail, attention rail, cellar map view, receiving verification,
adjustable locations" (`InventoryCommandPage.tsx:1-5`). The working stock page for
staff and managers: live vs shadow stock, spot counts, receiving verification as a
pinned task (not a popup), menu-scan intake, and per-branch views.

## 2. Entry

In-degree 2 ([PAGE_MAP](../foundation/PAGE_MAP.md):143): from `/` and `/get-started`.
Sidebar "Inventory" with low-stock badge (`components/layout/Sidebar.tsx:67,411`).
Eagerly loaded (`apps/web/src/App.tsx:72`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:255`.
- Tree: `pages/inventory/command/{InventoryCommandPage.tsx, bits.tsx, RowExpansion.tsx, SpotCountPanel.tsx, ReceivingWorkspace.tsx (+test), CellarMapView.tsx}` and `pages/inventory/{index.tsx, useInventoryPage.ts}`.
- Rendered components: `components/inventory/{AddWineToInventoryModal, StorageLocationManager, RemoveFromInventoryModal, ManualReceiptWorkspace}.tsx`, `components/scanner/MenuScannerFlow.tsx`, `components/wines/AddWineSelectionModal.tsx`, `components/insights/ContextualInsights.tsx` (InventoryCommandPage.tsx:14-23).
- Offline plumbing: `lib/spotCountOutbox.ts`, `lib/menuScannerPersistence.ts`.

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):249 (`inventory`, 18), :236
(`inventory-ledger`), :552 (`storage-locations`), :378 (`procurement/documents`),
:389 (`procurement`), :10 (`analytics` ⚠).

| Method | Path | Call site |
|---|---|---|
| GET | `/inventory/:rid` (+ `/summary`, `/low-stock`) | `useInventoryData` → `services/api/inventory.ts:66,118,129`; per-branch `InventoryCommandPage.tsx:382` |
| POST | `/inventory/:rid/items` (create) | `useCreateInventoryItem` → `services/api/inventory.ts:80` |
| POST | `/inventory/:rid/items/bulk` | `services/api/inventory.ts:104` (ManualReceiptWorkspace path) |
| POST | `/inventory/:rid/item/:itemId/count` | spot count via outbox — `lib/spotCountOutbox.ts:17` → `services/api/inventory.ts:249` |
| GET | `/procurement/orders?status=delivered|partially_received` | `InventoryCommandPage.tsx:131,136` → `services/api/orders.ts:53` |
| GET | `/procurement/documents?orderId=` | `ReceivingWorkspace.tsx:187` → `services/api/documents.ts:71` |
| GET/POST | `/storage-locations/:rid` (+ mappings, wines-at-location) | `hooks/useStorageLocations.ts:70,88,122,453` |
| POST | orchestrator `/api/v1/scan/{menu,wine,fuzzy-match,wine-research}` | `services/wineDetection.ts:342-457` via MenuScannerFlow (`VITE_AGENT_ORCHESTRATOR_URL`, wineDetection.ts:17) |
| GET/POST | `/analytics/insights/:rid`, `/analytics/recommendations/:rid/action(s)` | `components/insights/ContextualInsights.tsx:118-192` |

## 5. Signals

**None emitted.** The tree is instrumentation-*ready* — `data-ux-key` markers exist
(`ReceivingWorkspace.tsx:126,625,633`) — but the reporter that would read them ships
dark (`lib/uxSignals.ts:15`) and its hook has zero importers. Nothing reaches a server.

## 6. Tier cut

**Core** — operate. Scenario surface: S02 (receiving verification workspace), S04
(live depletion display), S10 (low-stock attention rail), S11 (waste/adjust), S17
(duplicate identities enter here). All ✅-Core rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38,40,46,47,53).

## 7. Rebrand surface

**0 user-visible strings.** `ReceivingWorkspace.tsx:2` says "canonical WineOps
invoice" in a comment only; the test file title (`ReceivingWorkspace.test.tsx:90`)
never renders. Shared layout chrome applies (see dashboard.md §7).

## 8. State & config

- `VITE_AGENT_ORCHESTRATOR_URL` for menu/label scanning (`services/wineDetection.ts:17`).
- Spot counts queue in an offline outbox with client idempotency keys
  (`services/api/inventory.ts:225-252`, `lib/spotCountOutbox.ts:82-96`); page refetches
  on outbox drain (`InventoryCommandPage.tsx:101`).
- Multi-branch: `RestaurantBranchSwitcher` (InventoryCommandPage.tsx:30) fetches other
  branches' stock (:382).

## 9. Gaps

- `v3.0-TECH-DEBT.md:357` — `INVENTORY_SOTA_PLAN.md` phases 2–3 (§6, §7) remain
  unbuilt; Phase 1 is what this page ships. Phase 0's ground-truth check "still worth
  running — against the *new* page".
- Market-price columns render "—" until price enrichment exists
  (`v3.0-TECH-DEBT.md:436-441` — plumbing complete, data absent).
