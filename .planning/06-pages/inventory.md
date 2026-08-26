---
type: page
route: /inventory
slug: inventory
component: apps/web/src/pages/inventory/command/InventoryCommandPage.tsx
audience: staff
tier: core
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[orders]]"]
---

# /inventory — Inventory Command

## Surface — buttons → where they go

- **Row menu / row expansion: Draft PO** → [[orders]] `/orders?draft=new&inventoryId=…&qty=…`
- **Row expansion: View ledger** → `/documents?ledger=…` (no such route exists — broken destination)
- **Receiving verification / Spot count / Cellar map** → (workspaces and views on this page)

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
- Rendered components: `components/inventory/{AddWineToInventoryModal, StorageLocationManager, AutoLocatePreviewModal, RemoveFromInventoryModal, ManualReceiptWorkspace, MultiLocationCell}.tsx`, `components/scanner/MenuScannerFlow.tsx`, `components/wines/AddWineSelectionModal.tsx`, `components/insights/ContextualInsights.tsx` (InventoryCommandPage.tsx:14-26).
- Offline plumbing: `lib/spotCountOutbox.ts`, `lib/menuScannerPersistence.ts`.
- Auto-Locate engine: `lib/autoLocateEngine.ts` (`InventoryCommandPage.tsx:20`); its
  `WineInput` already extends this page's `InventoryItem`.
- Inherited from the retired `/inventory-legacy` (2026-08-26): Auto-Locate,
  `MultiLocationCell`, by-the-glass pour, active/inactive toggle, and the realtime
  inventory subscription.

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):249 (`inventory`, 18), :236
(`inventory-ledger`), :552 (`storage-locations`), :378 (`procurement/documents`),
:389 (`procurement`), :10 (`analytics` — atlas's ⚠ is stale; guarded at class level
since 2026-08-24 (#31), `apps/api-gateway/src/analytics/analytics.controller.ts:51`).

| Method | Path | Call site |
|---|---|---|
| GET | `/inventory/:rid` (+ `/summary`, `/low-stock`) | `useInventoryData` → `services/api/inventory.ts:66,118,129`; per-branch `InventoryCommandPage.tsx:382` |
| POST | `/inventory/:rid/items` (create) | `useCreateInventoryItem` → `services/api/inventory.ts:80` |
| POST | `/inventory/:rid/items/bulk` | `services/api/inventory.ts:104` (ManualReceiptWorkspace path) |
| POST | `/inventory/:rid/item/:itemId/count` | spot count via outbox — `lib/spotCountOutbox.ts:17` → `services/api/inventory.ts:249` |
| GET | `/procurement/orders?status=delivered|partially_received` | `InventoryCommandPage.tsx:131,136` → `services/api/orders.ts:53` |
| GET | `/procurement/documents?orderId=` | `ReceivingWorkspace.tsx:187` → `services/api/documents.ts:71` |
| GET/POST | `/storage-locations/:rid` (+ mappings, wines-at-location) | `hooks/useStorageLocations.ts:70,88,122,453`; Auto-Locate bulk-writes mappings via `assignWineToLocation` (`InventoryCommandPage.tsx` `handleConfirmAutoLocate`) |
| POST | `/inventory/:rid/item/:itemId/transfer` | source-selected move — `RowExpansion.tsx` `doTransfer` → `services/api/inventory.ts:transferStock` |
| POST | `/inventory/:rid/item/:itemId/pour` | `RowExpansion.tsx` `pour` → `services/api/inventory.ts:193` (`recordPour`, client idempotency key) |
| PATCH | `/inventory/:rid/item/:itemId` (`isActive`) | row context menu `toggleActive` → `hooks/useInventoryData.ts:47` |
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

## 10. Maturity

**partial.** The stock spine is real and the writes land in a ledger; the market
column has no producer and one embedded panel is dead. The two capability gaps that
blocked the `/inventory-legacy` retirement (Auto-Locate, source-selected transfer)
were closed 2026-08-26 and the legacy page was deleted — see [ADR 0019](../decisions/0019-p2-build-scope.md) §B-parity.

| Evidence | `path:line` |
|---|---|
| **Writes are ledger-backed, not optimistic.** Spot counts go through `set_stock_absolute` with `transaction_type=reconciliation`, `source=mobile_count` and a client idempotency key `count:{inventoryId}:{clientCountId}`, and stamp `last_counted_at` even on a no-change count. | `inventory.controller.ts:368-390`; outbox `lib/spotCountOutbox.ts:82-96` |
| **Offline is real**, not a spinner — counts queue and the page refetches on drain. | `lib/spotCountOutbox.ts:17,82`; `InventoryCommandPage.tsx:101` |
| **Receiving verification is the live four-way match**, and its output is what feeds [[receiving]]'s manager queue. | `ReceivingWorkspace.tsx:274` → `services/api/orders.ts:192` → `procurement.controller.ts:244` |
| **Market column has a producer that has never produced.** `marketPrice` ← `master_wine_library.retail_price_avg` (`inventory.service.ts:77`). The only writer is the Celery task `score.rescore_stale_wines`, scheduled nightly at 03:00 UTC — but `services/agent-orchestrator/railway.toml` declares **only a web service with a `/health` check**; there is no worker/beat process in any deploy config in the repo. Consistent with `v3.0-TECH-DEBT.md:432-440` ("null on all 442 rows"). | `jobs/score_tasks.py:16,277`; `jobs/celery_app.py:118-122`; `services/agent-orchestrator/railway.toml` |
| **Derived advice inherits the null.** `marketDeltaPct` returns `null` when `marketPrice` is falsy, so the "Priced X% under market" / "Cost X% above market" notes never fire — dead branches, not wrong ones (honest failure). | `bits.tsx:23-26`; `InventoryCommandPage.tsx:233,242-243` |
| **"View ledger" points at a route that does not exist.** `/documents?ledger=…` — the app has `/documents-reports`, not `/documents` (§0, and `App.tsx` has no `/documents` binding). The catch-all sends the click to `/` (`App.tsx:302`). | §0 of this note |
| **The embedded insights rail is 401ing** since the analytics guard landed. `ContextualInsights` calls the analytics API with raw `fetch` and no `Authorization` header; the controller has been `@UseGuards(JwtAuthGuard)` at class level since 2026-08-24 (#31), and the JWT strategy is bearer-header-only. It fails into `catch { /* additive panel — fail quiet */ }`. | `components/insights/ContextualInsights.tsx:104,118,121,176`; guard `analytics.controller.ts:51`; extractor `auth/strategies/jwt.strategy.ts:11` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/inventory/:rid` (+`/summary`, `/low-stock`) | JWT (class) | `inventory.controller.ts:35,105,155` | rows with `stock_live`, `shadow_stock`, `marketPrice` from the master library join (`inventory.service.ts:77`) |
| POST `/inventory/:rid/items` · `/items/bulk` | JWT | `:53`, `:76` | created item(s) |
| POST `/inventory/:rid/item/:id/count` | JWT | `:368` | ledger write via `set_stock_absolute`, idempotent |
| POST `/inventory/:rid/item/:id/transfer` · `/pour` · `/count-photo-estimate` | JWT | `:311,340,402` | ledger writes |
| GET `/procurement/orders?status=DELIVERED\|PARTIALLY_RECEIVED` | JWT | `procurement.controller.ts:65` | verify-queue source; status is mapped to the backend enum by `toBackendStatus` (`services/api/orders.ts:25-38`) — correct here, unlike [[receiving]] |
| POST `/procurement/orders/:id/verify-receipt` | JWT | `procurement.controller.ts:244` | match verdict; opens vendor credit claims |
| GET/POST `/storage-locations/:rid` | JWT | `storage-locations` module | locations, mappings |
| POST orchestrator `/api/v1/scan/{menu,wine,fuzzy-match,wine-research}` | orchestrator | `services/wineDetection.ts:342-457` | scan proposals |
| GET/POST `/analytics/insights/:rid`, `…/recommendations/:rid/action(s)` | **JWT required, none sent** → 401 | `analytics.controller.ts:243,654,757` | nothing — see §10 |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Live depletion | **POS webhook** — pos-hub upserts `pos_checks` and depletes via `apply_stock_movement`/`record_glass_pour` | `pos-hub/pos-hub.controller.ts:76`; `pos-hub.service.ts:321,752` |
| Receipts into live stock | `markDelivered` (shadow release + live receive, two idempotent RPCs) | `procurement.service.ts:989-1011` |
| Door-stage case counts | `POST /procurement/receiving/orders/:id/door` from [[receiving-door]] | `receiving.controller.ts:119` |
| Spot counts | manual / voice / photo on this page | `inventory.controller.ts:368` |
| Low-stock flags | `v_low_stock_items` + a 2-minute edge sweep and hourly digest | `notifications/low-stock-alerts.service.ts:85,110` |
| Market price | `score.rescore_stale_wines` Celery beat — **scheduled in code, no worker deployed** | `jobs/celery_app.py:118`; `railway.toml` |
| Insight rail | hourly `insight-scheduler` sweep — the data exists; the page cannot fetch it (§10) | `analytics/insights/insight-scheduler.service.ts:42` |

**Finding:** the Market column and everything derived from it has a producer that is
scheduled but not deployed. Live depletion has a producer only where a POS is connected;
without one, `stock_live` moves only on receipts and manual counts.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Spot count | `restaurant_inventory` + `inventory_transactions` via `set_stock_absolute` | low-stock sweep, dashboard alerts, shrinkage analysis |
| Verify receipt | `procurement_orders.match_status`, `procurement_credits` | [[receiving]] manager queue + owner recovery card |
| Add / bulk-add item | `restaurant_inventory` | everything |
| Storage location + mapping | `storage_locations` | cellar map |

## 12. Design intent

**Should be:** the stock number a somm will actually trust at 7pm, plus the two jobs that
keep it true — count what drifted, verify what arrived.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query flags across the tree |
| empty | ✅ | market/count columns render "—", not `0` — the right call (`bits.tsx:23-26`) |
| error | ⚠️ partial | table paths surface errors; the insights rail swallows its 401 silently (`ContextualInsights.tsx:176`) |
| permission-denied | ❌ | one layout for staff and managers; cost is visible to both (contrast [[receiving]]'s deliberate role split) |

**Where the UI misleads**

1. **The insights rail renders as "no insights"** when it is actually unauthenticated —
   `catch {}` makes a 401 and a genuinely quiet restaurant look identical.
2. **"View ledger" is a dead control** — a plausible link to a route that does not exist.
3. The Market column's "—" is honest, but it has been "—" for every row since the
   feature shipped, which reads as a broken column rather than a pending job.

## 13. Roadmap

1. **Fix the insights rail's auth** — move `ContextualInsights` off raw `fetch` onto
   `apiClient` (which stamps the bearer token, `services/api/client.ts:62`). One-line
   class of fix; also un-breaks the same panel on [[orders]]. *Blocker: none.*
2. **Deploy the Celery worker + beat, or delete the Market column.** Shipping a column
   that has never had a value is the shape §44.2 warns about. *Blocker: founder decision
   on running a second orchestrator process (cost); no ADR exists either way.*
3. Repoint "View ledger" at `/documents-reports` or drop it.
4. Give the four-way match a reachable second home — today the only way into
   `ReceivingWorkspace` is this page, and [[receiving]]'s manager queue links to
   `/orders`, not here.
5. Turn on the reporter for the `data-ux-key` markers already in place
   (`ReceivingWorkspace.tsx:126,625,633`) — the instrumentation is written, the sink is not.
6. `INVENTORY_SOTA_PLAN.md` phases 2–3 (`v3.0-TECH-DEBT.md:357`). *Blocker: unbuilt plan,
   not a defect.*
