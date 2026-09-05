---
type: page
route: /inventory
slug: inventory
softwares: [inventory-command]
component: apps/web/src/pages/inventory/command/InventoryCommandPage.tsx
audience: staff
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[orders]]"]
---

# /inventory — Inventory Command

> **Part of** [[08-softwares/inventory-command|Inventory Command]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

## 1a. Features
- 9-column live stock table; expand a row for detail: live vs shadow stock, par/reorder bar, velocity, busy-hours heatmap, order history, manual entry (🚧 market-price columns render "—" until price enrichment exists)
- Attention rail surfacing low stock first
- Spot counts with an offline-safe outbox (counts queue and sync when back online)
- Receiving verification as a pinned task, not a popup — verify a delivery against its documents
- Cellar map view of storage zones
- Scan a menu/wine list photo to add wines
- Add and remove wines; manage storage locations
- Switch branches and see another branch's stock
- Contextual insights rail (analytics engine)
- **Receipts & invoices depth in the dropdown, behind `mudavym_design_inventory` (OFF)** — the founder's named gap (MAKEOVER: KEEP the dropdowns, deepen receipt/invoice actions): for the wine's recent orders, every attached invoice / delivery receipt / packing slip with total, tie-out state and review status, E49-honest (null tie-out = dash, never a pass), linking into `/receipts`
- **The house header, behind the same flag (OFF)** — `/inventory` is enrolled in `PageGate` (2026-09-04) with the SAME command page on both branches, purely so the page gets the chrome every other rebuilt page has: mark, page name, ⌘K "Search or act", house/branch switcher, bell, theme menu, account menu. No redesign, and no style change inside the page (measured — §1b)

- A house may name a bottle the library does not have; the item carries that **provisional** identity until Mudavym curates it, and promotion re-points the item (ADR 0124 Q3)
- The house names its own bottles: one editable display name per item (`wine_name`), used everywhere the house sees it; the library row is never written from here, and BOTH names stay searchable (ADR 0124, the naming rule)
## 1b. Motions used — Mudavym addition (flag `mudavym_design_inventory`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.
>
> **Enrolment, 2026-09-04 (founder's call).** The paragraph above was written
> while `/inventory` was still routed OUTSIDE any gate
> (`App.tsx:303`, `element={<InventoryCommandPage />}`), so no header actually
> mounted here: the gate is the only thing that mounts `HouseHeader`
> (`components/mudavym/PageGate.tsx`), and the one page the house runs on all
> day was the last surface with no bell, no account menu and no theme switch.
> The route is now
> `<PageGate page="inventory" legacy={<InventoryCommandPage />} next={<InventoryCommandPage />} />`
> — the SAME component on both branches. This is not a redesign: the flag's
> only effect on this route is the chrome.
>
> **What the flag does NOT do, measured 2026-09-04.** `PageGate` renders `next`
> as-is with no wrapper, so the command page gains no `.mudavym` scope and no
> ancestor of it changes. Measured rather than assumed: the route was loaded
> twice in one browser (override `0`, then `1`) and the FULL computed style of
> every element in the page's subtree diffed, keyed by a structural path that
> re-indexes past the header so the two runs line up
> (`$SP/measure-inventory-styles.mjs`). 1,939 elements compared, **zero**
> property differences inside the page. The only four differences in the whole
> tree are on the shell's own `<main>` — `height` 4113.25px → 4166.25px and the
> two origins that track it — i.e. the header's 53px of occupied flow, which is
> the point of adding it. Consistent with the source: every top-level selector
> in `house-header.css` and `sheet.css` is scoped to `.mdv-*`/`.mudavym`, so
> the stylesheets the header imports cannot reach the page's Tailwind
> utilities. No token-driven component inside the command page changes.
>
> The header's ground on this route is always **paper** unless the app's own
> dark theme is on: `readShellGroundFromDom` (`lib/mudavym/shellGround.ts:135`)
> returns `charcoal` only when a `.mudavym[data-ground="charcoal"]` node is in
> the document, and the command page declares none. Captures:
> `$SP/shots-inventory-header/inventory.png` (paper) and
> `inventory-charcoal.png` (the app's dark theme, where `.dark .mudavym` turns
> the bar).
>
> One real behavioural change beyond the bar, named honestly: while a `next`
> tree is mounted the gate claims a slot in `lib/mudavym/shellGround`, and the
> nine shared shell overlays (command palette, scrim, Ask AI bar, …) render
> their house shape rather than their legacy one. That is by design
> (PageGate's header comment) and is now reachable from `/inventory` with the
> flag on.

Deliberately none. This is a card added inside the KEPT page (the founder's
verdict kept `/inventory` as it is — the addition is styled native to the
page's own grey-card idiom, not the `.mudavym` tokens, and the İznik re-skin
arrives with the page redesigns, not here). Recording zero motions is the
motion map for this flag (ADR 0044 §2).

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: KEEP + named gap)

The dropdown the founder praised is untouched; the gap he named — "more
detail for the receipt and invoice actions… where inventory meets /receipts,
differentiated work, not a generic expander" — lands as the ReceiptDepth
card: real paperwork per wine (via the item's recent orders →
`documentsApi.forOrder`), each row carrying type, number, date, total,
tie-out and review status. Known limitation, recorded: rows are doc-level;
the per-item invoice LINE (this wine's qty × price inside the document) needs
an order-line join the web API does not expose yet — filed in §9 rather than
faked with description matching. Flag off = byte-identical page.

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
| GET | `/pos-hub/unresolved/:rid` | attention chip + panel — `services/api/posHub.ts` `getUnresolvedLines` → `PosMappingPanel.tsx` |
| GET/POST | `/pos-hub/catalog-match/:rid/proposals[/approve]`, `/pos-hub/mappings/:rid[/sale-unit]` | `PosMappingPanel.tsx` — confirm a button's wine and its sale size together (#307) |

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
- ReceiptDepth shows doc-level rows only: the per-item invoice LINE (this
  wine's qty × price inside the document) needs an order-line join the web
  API does not expose (`documentsApi.detail` has lines, but nothing maps an
  inventory item → its order_line ids). Deliberately not faked with
  description matching (§1b).

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** ~~no screen connects POS buttons to stock — the SPA calls only `pos-hub/providers` and `/status` (`services/api/posHub.ts:59,66`), so every closed check queues to `pos_unresolved_lines` until the mapping API is worked by hand (defect 1).~~ **Defect 1 closed (#307)** — this page now owns the mapping surface: `PosMappingPanel.tsx`, opened from the attention-rail chip "POS lines moving no stock — N", reading `pos-hub/unresolved`, `pos-hub/catalog-match/:rid/proposals` and `pos-hub/mappings/:rid`, and writing the identity *and* the sale size in one tap (defect 2, same PR). ~~The Add-Wine modal cannot express an unknown cost (`AddWineToInventoryModal.tsx:136,492` → `0 / 'manual'`; defect 6). Two definitions of "below par" on one page — chip `<=` 9 vs API `<` 7 (defect 7). Raising a par level through PATCH raises no alert (defect 8).~~ **Defects 6, 7 and 8 closed (#312).** A blank cost field now omits the key, so the API writes NULL rather than a `0` labelled `'manual'`. "Below par" has ONE definition, in `datasets/sim/fixtures/below-par-cases.json`, run by both `apps/api-gateway/src/common/stock-status.ts` and `apps/web/src/lib/inventoryStatus.ts` — it was three definitions, not two (`/summary`'s `criticalCount` was `stock === 0`). **Founder call, one line:** below par is now strictly `stock < par`, so a wine exactly at par is `at_par` and the chip reads 7 rather than 9 for the sim tenant; the fixture's `below_par_bands` reverses it in one edit. A par change through PATCH now evaluates low stock, lowering included. The first ~2.5 s render "0 wines, 0 bottles, $0" — byte-identical to an empty cellar — and unknown cost renders as "$0 cost basis" (absence 5, 6).

- **Lens run 2026-09-04 (Antalya, PR #314 finding 4 🔴) — FIXED by [ADR 0130](../decisions/0130-a-generic-name-stays-the-venues-own-wine.md).**
  A bulk-add draft of `"House White Wine"` — no producer, no vintage, no region —
  auto-linked at confidence **90** to another tenant's `HOUSE WHITE` (US /
  California / 2023) and the venue's own name was then **persisted over** in
  `restaurant_inventory.wine_name`, which is the column this page renders. Two
  writes, both closed: the resolver now refuses to consult the shared library for
  an identity that is not specific (a name plus a producer, or a vintage and a
  region), creating the venue's own provisional row instead; and bulk receive
  stores the draft's own label. Still open, filed in `v3.0-TECH-DEBT.md`: the 26
  rows already written keep their wrong links until a separate repair stop.

## 10. Maturity

**partial.** The stock spine is real and the writes land in a ledger; the market
column has no producer and one embedded panel is dead. The two capability gaps that
blocked the `/inventory-legacy` retirement (Auto-Locate, source-selected transfer)
were closed 2026-08-26 and the legacy page was deleted — see [ADR 0019](../decisions/0019-p2-build-scope.md) §B-parity.

| Evidence | `path:line` |
|---|---|
| **Writes are ledger-backed, and a count is a record of its own** ([ADR 0078](../decisions/0078-a-count-is-a-record-in-its-own-right.md), 2026-09-02). Spot counts go through `record_stock_count`, which writes a `stock_counts` row **unconditionally** — carrying `expected_qty` (the lot sum, read under the row lock) and `counted_qty` — and applies a movement only as a *consequence* of a non-zero difference. Before this they went through `set_stock_absolute`, which returns NULL on a zero delta while `inventory_transactions` CHECKs `quantity_change <> 0`, so **a count that agreed wrote nothing at all** and any variance rate over the ledger was 1.0 by construction. `transaction_type=reconciliation`, `source=mobile_count` and the client key `count:{inventoryId}:{clientCountId}` are unchanged; the key now gates the count row as well as the movement. `last_counted_at` is still stamped, now inside the same transaction rather than a second round trip whose failure only warned. The actor comes from the verified JWT, not the request body. | `inventory.controller.ts:379-417`; `inventory.service.ts:404-415`; `supabase/migrations/20260902190000_a_count_is_a_record.sql:204`; outbox `lib/spotCountOutbox.ts:17,82` |
| **A generic name is the venue's own wine, and keeps its own name** ([ADR 0130](../decisions/0130-a-generic-name-stays-the-venues-own-wine.md), 2026-09-05). `match_library_wine` returns **no candidates** for a query that is not specific (`wine_identity_is_specific`), so "House White", "Ev Şarabı" and "Red — by the glass" can no longer bind one venue's stock to another's bottle; the line becomes a row carrying `master_wine_library.provisional_for_restaurant_id`, keyed on `venue:<id>\|` so two venues coexist under the existing UNIQUE index and neither is ever offered to the other. Bulk receive writes `wine_name` from the draft, not from the row it resolved to. Measured pre-fix on the schema built from all 100 migrations: confidence **90**, `producer_sim` **1** because neither side stated a producer. | `supabase/migrations/20260906010000_a_generic_name_stays_the_venues_own_wine.sql`; `wines/wine-signature.ts:290`; `wines/wine-submissions.service.ts:430`; `inventory/inventory.service.ts` (bulk `wine_name`) |
| **Offline is real**, not a spinner — counts queue and the page refetches on drain. | `lib/spotCountOutbox.ts:17,82`; `InventoryCommandPage.tsx:101` |
| **Receiving verification is the live four-way match**, and its output is what feeds [[receiving]]'s manager queue. | `ReceivingWorkspace.tsx:274` → `services/api/orders.ts:192` → `procurement.controller.ts:244` |
| **Market column has a producer that has never produced.** `marketPrice` ← `master_wine_library.retail_price_avg` (`inventory.service.ts:77`). The only writer is the Celery task `score.rescore_stale_wines`, scheduled nightly at 03:00 UTC — but `services/agent-orchestrator/railway.toml` declares **only a web service with a `/health` check**; there is no worker/beat process in any deploy config in the repo. Consistent with `v3.0-TECH-DEBT.md:432-440` ("null on all 442 rows"). | `jobs/score_tasks.py:16,277`; `jobs/celery_app.py:118-122`; `services/agent-orchestrator/railway.toml` |
| **Derived advice inherits the null.** `marketDeltaPct` returns `null` when `marketPrice` is falsy, so the "Priced X% under market" / "Cost X% above market" notes never fire — dead branches, not wrong ones (honest failure). | `bits.tsx:23-26`; `InventoryCommandPage.tsx:233,242-243` |
| **"View ledger" points at a route that does not exist.** `/documents?ledger=…` — the app has `/documents-reports`, not `/documents` (§0, and `App.tsx` has no `/documents` binding). The catch-all sends the click to `/` (`App.tsx:302`). | §0 of this note |
| **The embedded insights rail is 401ing** since the analytics guard landed. `ContextualInsights` calls the analytics API with raw `fetch` and no `Authorization` header; the controller has been `@UseGuards(JwtAuthGuard)` at class level since 2026-08-24 (#31), and the JWT strategy is bearer-header-only. It fails into `catch { /* additive panel — fail quiet */ }`. | `components/insights/ContextualInsights.tsx:104,118,121,176`; guard `analytics.controller.ts:51`; extractor `auth/strategies/jwt.strategy.ts:11` |

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** measured with 53 items / 274 bottles on a sim tenant: the settled counts match the rows exactly; the bulk door (`POST :rid/items/bulk`, the modal's "Receive a delivery") took 50 free-text menu lines with 0 failures in 42 s; a count on a zero-stock item creates a lot at `unit_cost NULL / 'estimated'` (the honest onboarding door). What is not usable from this page: ~~connecting the POS,~~ ~~saying a cost is unknown,~~ a spirits list (every row types "Red"), or one wine at two pour sizes. **Connecting the POS is now on this page (#307):** the panel reads the unresolved queue, offers the catalog-match proposals, and writes `sale_unit`/`sale_volume_ml` with the approval — measured cause of the run's 0 depletions.

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/inventory/:rid` (+`/summary`, `/low-stock`) | JWT (class) | `inventory.controller.ts:35,105,155` | rows with `stock_live`, `shadow_stock`, `marketPrice` from the master library join (`inventory.service.ts:77`) |
| POST `/inventory/:rid/items` · `/items/bulk` | JWT | `:53`, `:76` | created item(s) |
| POST `/inventory/:rid/item/:id/count` | JWT | `:379` | `stock_counts` row via `record_stock_count`, idempotent; returns `count` (variance 0 + `transactionId: null` when the books were right) |
| POST `/inventory/:rid/item/:id/transfer` · `/pour` · `/count-photo-estimate` | JWT | `:314,345,418` | ledger writes; `transfer`/`pour` now pass the JWT actor, so `performed_by_type` is `'user'` rather than `'system'` (ADR 0078) |
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
| Spot counts | manual / voice / photo on this page | `inventory.controller.ts:379` |
| Low-stock flags | `v_low_stock_items` + a 2-minute edge sweep and hourly digest | `notifications/low-stock-alerts.service.ts:85,110` |
| Market price | `score.rescore_stale_wines` Celery beat — **scheduled in code, no worker deployed** | `jobs/celery_app.py:118`; `railway.toml` |
| Insight rail | hourly `insight-scheduler` sweep — the data exists; the page cannot fetch it (§10) | `analytics/insights/insight-scheduler.service.ts:42` |

**Finding:** the Market column and everything derived from it has a producer that is
scheduled but not deployed. Live depletion has a producer only where a POS is connected;
without one, `stock_live` moves only on receipts and manual counts.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Spot count | `stock_counts` (always) + `inventory_lots`/`inventory_transactions` (only on a non-zero difference) via `record_stock_count` | low-stock sweep, dashboard alerts, shrinkage analysis — and, for the first time, a variance rate that is not 1.0 by construction |
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

### The ledger's key becomes the house item — what changes here (added 2026-09-04)

OD-113 is decided (founder, 2026-09-03): **one house item id across all
beverages.** [[0115-the-house-item-is-the-ledgers-key]] — *Proposed*, the founder
locks — makes the house item `restaurant_inventory.id`, the row this page is
built on. The row stops being a wine: `master_wine_id` becomes a nullable
attribute and the row gains `kind`, `uom`, `display_name`, `beverage_id` and
`identity_provenance`. Migration
`supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql` is
written and **NOT applied**; `scripts/check_house_item_invariants.py` holds the
invariants the database cannot.

**This page is the one that changes most, and one line of it is a blocker.**

1. **`inventory.service.ts:69` must be fixed before the migration lands.**
   `const wineBottleMl = row.master_wine_library?.bottle_size_ml ?? 750` is the
   first line of `mapInventoryItem`, and `glassesPerBottle` is
   `floor(effectiveBottleSizeMl / pourSizeMl)` from it. A keg carries no library
   row, so it would be published as a 750 ml bottle yielding five glasses — a
   fabricated number in the read path every inventory surface uses (ADR 0020 /
   ADR 0051). It becomes an em dash. This is why the migration is gated rather
   than merely staged, and it is item 1 of the ADR's phase 2.
2. **`database.service.ts:46`** embeds `master_wine_library(...)` as a LEFT join,
   so a non-wine row returns `master_wine_library: null` rather than
   disappearing. Measured: there are **zero** `master_wine_library!inner` embeds
   in the gateway, so no list silently drops a keg — but every consumer of that
   embedded shape has to be read before the columns arrive.
3. **The row expander gains what the cellar's could not have.** `RowExpansion.tsx`
   is the anatomy [[wines]] copied, and the two cards the cellar draws hatched —
   *Live vs shadow* and *Par and reorder* — are exactly the two this page draws
   real. Once a keg has a row they are the same arithmetic on both pages, off
   `stock_live` and `threshold_min`.
4. **The POS bridge needs no repointing.** Measured on production 2026-09-03:
   `pos_item_mappings` holds 254 rows, **239 carry an `inventory_id`** and only
   107 carry a `master_wine_id`. The bridge already keys on the house item; what
   changes is that a till line for a keg now has one to resolve *to*, instead of
   landing in `pos_unresolved_lines` (130 rows) and being invisible to this page,
   to `/reports` and to the analytics engine. ADR 0030's mapping-integrity rules
   are unaffected — the FK it rests on
   (`20260902130000_capture_pos_inventory_fks.sql:65`) points at
   `restaurant_inventory(id)` and that target does not move.
5. **Low-stock alerts need no new producer.**
   `notifications/low-stock-alerts.service.ts:683-690` reads `stock_live` and
   `threshold_min` off whatever row it is handed and keys on `inventoryId`, so a
   keg with a par is alerted the day it has a row.
6. **`INVENTORY_SOTA_PLAN.md:352`'s identity paragraph is superseded** by the ADR
   (retire-to-write; that file gets no edit). `kind` is the one axis, on the row,
   CHECK-constrained — there is no `domain`/`subsection`/`subtype` triple and no
   attribute pack, because `beverages.type_attributes` already holds
   category-specific attributes and a second copy would be two homes for one
   fact. `:134`'s `inventory_lots(master_wine_id UUID NOT NULL, …)` is superseded
   too: phase 1 drops that `NOT NULL`, because it is what makes a non-wine lot
   unwritable.

7. **A library wine this page stocks can no longer be hard-deleted** (founder,
   2026-09-04). The FK becomes `ON DELETE RESTRICT`, soft-delete
   (`master_wine_library.deleted_at`) is the only retirement path, and the refusal
   names the count rather than saying *"still referenced from table
   restaurant_inventory"*. This closes a real hole on this page's data: under
   `CASCADE`, deleting a library row took the house's `restaurant_inventory` row
   **and**, through `inventory_lots_inventory_id_fkey`'s own cascade, its lots —
   silently and irreversibly. Nothing has to change here to benefit; what does
   change is that a **retired** wine now shows up as a live item whose library row
   is soft-deleted, which invariant 7 of the guard **flags** (never fails, because
   a house pours out a retired wine over weeks) and which phase 2's producer turns
   into a notification.
8. **Nothing on this page may auto-create a house item** (founder, 2026-09-04).
   A house item comes into being only through an explicit "carry this" that states
   kind and unit together. The receiving and four-way-match paths this page owns
   must therefore leave an unmatched line **unmatched, and say so** — they may
   never mint an inventory row to make a document reconcile. That is the same rule
   `ReceiptDepth`'s §9 gap already follows by accident ("deliberately not faked
   with description matching"); it is now a decision rather than a restraint.

*Blocker on all eight: the founder locks ADR 0115. Nothing here is built.*

### Filed separately — the price register, and why receiving is the thing that fills it

**[ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md)
(Proposed, 2026-09-04) — a price sighting names its source, its date and its unit.**
Independent of the eight items above and of ADR 0115: this page's receiving door is the
first and best writer the house's price register will ever have, and it is not wired to it.

Measured on production 2026-09-04: `vendor_price_observations` **0 rows**,
`price_history` **0**, `procurement_documents` **0**, `procurement_document_lines` **0**.
`price_history` *does* have a writer — `procurement.service.ts:900`, called from receipt
verification at `:2902` with the match's `effectiveUnitCost`, and from order confirmation
at `:4393` — but it writes a **different table** from the one the market box, the calendar
price mark and every register's `quote` line read. So the moment this page's four-way
match settles what a vendor actually charged, the house produces its highest-trust price
evidence (`source_type: 'invoice'`, trust tier 1) and then puts it somewhere nothing can
compare it. **Where it would write:** the same call site at
`procurement.service.ts:2902`, mirrored into `vendor_price_observations` scoped to the
restaurant — the ADR's step one, and the only step that needs no vendor, no terms, no
rate limit and no network.

Two constraints from the ADR that land on this page's work:

- **A sighting carries a unit, and the register has no food unit.** `unit_volume_ml` and
  `pack_size` are the only unit columns, and `normalizeUnitPrice`
  (`vendor-price-consensus.ts:115`) scales only by millilitres to a 750 ml reference.
  Anything this page receives by weight or by count has no comparable unit at all — which
  is the same seam ADR 0070 and OD-113 already circle, seen from the price side.
- **`price_history.unit` is hardcoded `'BOTTLE'`** and the comment at
  `procurement.service.ts:942` says why it must stay that way: a caller free to vary it
  would write a case price into a per-bottle series and no reader could tell. Any mirror
  into the sighting register inherits that constraint rather than escaping it.

Registry of every source examined, with the result of the 2026-09-04 fetch against each:
[`.planning/07-reference/price-sources.md`](../07-reference/price-sources.md). Dry-run
proof (writes nothing): `scripts/fetch_price_sightings.py`.

**Update 2026-09-04 — the public-list side (steps 2–3) is now built, as its own
register.** The item above is class A (this page's own paper) and is unchanged. Separately,
`price_index_postings` (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`)
and the gateway `price-index/` module now hold the class-B/D/E **index** — California live,
Iowa/Oregon control-state shelf lines, Michigan withheld. It is keyed by **state, not
restaurant**, so it never touches this page's tenant-scoped bookkeeping; a house's index
line is read at `GET /price-index/:state`. The food-unit and `'BOTTLE'` constraints above
still bind class A; the index register sidesteps them by storing each posted price **as
posted** (its own unit and pack, no 750 ml normalisation) rather than reducing it to a
comparable — because an index line is shown, never averaged against a vendor quote.

### 13.x The house item can name the bottle it is (ADR 0124, 2026-09-05)

`restaurant_inventory` gained a **nullable `identity_id`**
(`supabase/migrations/20260905140000_a_bottle_has_one_identity.sql`) pointing at
the trade-item register ADR 0124 introduced. It is nullable and never guessed:
an unjoined house item stays unjoined and the reader says so.

**The measurement that matters for this page.** Run through the real reader
against production on 2026-09-05: **0 of 206** house items can be read as an
identity from their own columns — 153 have no producer (the table has no producer
column at all) and 53 have no `wine_name` — while **205 of 206** can be read
**through the library row they link to**. `restaurant_inventory` also has **no
barcode or UPC column**, `internal_sku`/`pos_sku`/`sku_aliases` are empty on all
206 rows, and `bottle_size_ml` is known on **51** (47 × 750, 4 × 375), NULL on 155.

So the house item's identity comes from the library link it already has, not from
its own fields — which is a question for the founder rather than a fact this
build settled: whether a house item may ever carry an identity the library does
not have (ADR 0124 §Founder-only questions, Q3, beside ADR 0115's house-item key).

### 13.y A house may name a bottle the library does not have (ADR 0124 Q3, 2026-09-05)

The founder: **"Provisional on the item, curated into the library."** A house
states an identity for a bottle the shared library has never heard of; that
identity is **provisional**, named to the person, the time and the house
(`beverage_identities.asserted_for_restaurant_id`,
`supabase/migrations/20260906050000_a_house_may_name_a_bottle_the_library_does_not_have.sql`),
and it waits in a curation queue until Mudavym promotes it.

**Promotion re-points this page's rows.** When a provisional identity is
promoted, every `restaurant_inventory` row carrying that `identity_id` has its
`master_wine_id` moved to the newly shared library entry, and the number
re-pointed is reported — zero is a real answer and is printed rather than
implied. If the re-point fails the call fails and says the identity was
promoted, because a half-done promotion reporting success would leave this
page's row pointing at a placeholder forever.

**The house's assertion survives promotion.** `asserted_for_restaurant_id` is
written once and never cleared — deliberately a different column from ADR 0130's
`master_wine_library.provisional_for_restaurant_id`, which IS cleared on
promotion because there it is state and here it is provenance.

**Standing is generated, not flagged.** `library` / `provisional` / `source` is
a GENERATED column, so "printed as provisional everywhere it appears, never as
official" cannot drift from the two columns it describes. Three values and not
two on purpose: calling an Iowa transcription "official" would be the same class
of falsehood the register exists to stop.

### 13.z One alias on the item, library immutable (ADR 0124, the naming rule, 2026-09-05)

The founder: **"One alias on the item, library immutable."** *"Names are the
house's; identity is the library's."* His own words: *"let each restaurant to
name their products to match their likings, eg. instead of 1988 Wine X ...
maybe they would prefer to name it: Wine X only."*

**No column was added.** `restaurant_inventory.wine_name` already existed and
this page already rendered it — `inventory.service.ts:83` reads
`row.wine_name || row.master_wine_library?.name`. Measured read-only on
production 2026-09-05: 233 rows, `wine_name` present on **180**, **156**
distinct, and **0 differ from the library's own name**, because nothing let a
house set it (`UpdateInventoryItemDto` had no such field). It does now, and an
empty string CLEARS the alias rather than storing a name of `""`.

**Both names stay searchable.** `wineName` is whichever name is shown, so
matching on it alone would make the other unfindable — rename "1988 Wine X" to
"Wine X" and "1988" stops finding it. The item read now also carries
`libraryName` (matched, never displayed in the alias's place) and `houseAlias`
(whether the house set one at all, which `wineName` cannot say because it is
non-null either way), and `useInventoryPage`'s filter matches both.

**The library is immutable from this path, and a test reads the source to prove
it:** `house-item-alias.spec.ts` pulls the real `updateInventoryItem` body out
of the file and fails if it ever contains `from("master_wine_library")`.

