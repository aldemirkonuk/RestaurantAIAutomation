# Inventory Add/Remove Scenarios — Design Brief

Research only, grounded in the current codebase. All paths relative to repo root.

## TL;DR

- **Menu Scanner is a dead end today.** `MenuScannerFlow.onWinesAdded` is a no-op in both call sites (`apps/web/src/components/inventory/AddWineToInventoryModal.tsx:704-708`, `apps/web/src/pages/WineLibrary.tsx:1818-1821`). Confirmed wines vanish. No quantity/threshold/location is ever captured for them — `ScanResultsPanel.tsx`'s `EditableFields` (lines 42-51) only has wine-identity fields, nothing stock-related.
- **The sync "match-or-create" function you need already exists** and is unused by anything reachable from the UI: `WineSubmissionsService.resolveOrCreateLibraryWine` (`apps/api-gateway/src/wines/wine-submissions.service.ts:291-382`). It's currently only called server-side by the menu importer (`apps/api-gateway/src/menus/menus.service.ts:259`). Reuse it — don't reinvent fuzzy matching.
- **WAC is already lot-based and already excludes NULL-cost lots** from the average (`inventory_lot_rollup` view, `supabase/migrations/20260710120100_phase2_lot_rollup_view_and_sync_trigger.sql:14-19`, filters on `unit_cost IS NOT NULL`). Omitting cost today already "protects" WAC — but it's indistinguishable from "we forgot to enter the cost." That ambiguity is the real problem to solve for samples, not WAC corruption per se.
- **`AddWineToInventoryModal.tsx` has no cost field at all**, while `AddToInventoryFromLibraryModal.tsx:107` (the Wine Library's equivalent) does have `costPerBottle`. That's an existing inconsistency, and the fastest lever for samples.

---

## 1. Manager behavior scenarios

| # | Who / when / device | Time pressure | What they want |
|---|---|---|---|
| 1 | Line manager, mid-lunch, phone, distributor rep just dropped 2 free tasting bottles | High | Tap "add wine → find it or scan it → mark sample → done" in under 20s. No cost prompt, no vendor form. |
| 2 | Beverage director, month-end close, desktop | Low | Pull up every sample received this month and confirm none leaked into COGS or "value on hand." Needs a filter/report, not just an entry flow. |
| 3 | New GM, day one, phone camera, inherited a 60-wine paper list | High (wants it live before dinner) | Photograph 2-3 pages, accept sane defaults (par level, unassigned location) for everything, fix outliers later. |
| 4 | Sommelier, desktop, reviewing the same 60 detected wines | Low | Correct ~8 low-confidence OCR reads, set custom par per wine (verticals vs. by-the-glass differ a lot), assign real cellar zones, before confirming. |
| 5 | Manager, tablet at host stand, between covers, private buyer paid cash for a case (3 SKUs, 12 bottles, no PO) | High | 3 rows, quantity + rough cost each, under 2 minutes. |
| 6 | Owner/operator, desktop, first cellar load-in for a new location: 300 bottles / 45 SKUs from a liquor-license transfer, no invoices | Low, high accuracy need | Spreadsheet-like bulk entry they can save and resume across sessions; needs an estimated-FMV cost per bottle for insurance/tax basis. |
| 7 | Line cook, mid-Friday-dinner-rush, phone | Very high | Bottle turned out corked — wants it off the live count *right now* so POS doesn't oversell. This is a **decrement**, not a delete (existing `RowExpansion.tsx` "Manual adjust" with `Breakage` reason, lines 41-47, 276-292) — worth noting because "removal" requests from staff are usually this, not SKU deletion. |
| 8 | Beverage director, desktop, end of week | Low | Discontinuing a wine that's sold out and won't reorder. Wants it off the active list/menus, but is willing to deliberately reconcile-to-zero first and confirm nothing's in flight. |
| 9 | Manager, phone, Friday dinner rush, last bottle of a SKU just broke | Very high | Needs to 86 it. The new "reconcile-to-zero-before-delete" policy forces a reason prompt here — if that prompt is more than a one-tap dropdown pick (reuse `ADJUST_REASONS`, `RowExpansion.tsx:41-47`), a rushed manager abandons it and the dead SKU just sits there uncleaned. |
| 10 | Manager, desktop, seasonal wine-list rotation, 15 wines rotating off at once | Medium | Wants to bulk-select the 15 rows (multi-select already exists, `InventoryCommandPage.tsx:576-594`) and do "reconcile to zero + archive" once, not repeat a single-row flow 15 times. No such bulk action exists today. |

---

## 2. Menu Scanner persistence design

### Current pipeline (confirmed by reading the code)

1. `MenuScannerFlow.tsx` → capture → `scanMenuImage()` (`apps/web/src/services/wineDetection.ts:419-444`) → returns `DetectedWine[]` with `inMasterLibrary`, `masterWineId`, `confidence`, 25+ fields.
2. `ScanResultsPanel.tsx` renders review UI: select/deselect/reject/edit per wine (identity fields only), confirm button calls `onConfirm(accepted)` (line 456-464 `handleConfirm`).
3. `MenuScannerFlow.handleConfirmWines` (lines 85-90) calls `onWinesAdded?.(acceptedWines)` and jumps to the `'done'` step, **claiming** "wines have been added to your inventory" (line 250) — false today.
4. Both consumers (`AddWineToInventoryModal.tsx:704-708`, `WineLibrary.tsx:1818-1821`) just `console.log` and close.

### What actually needs to happen on confirm

For each accepted `DetectedWine`:

1. **Resolve or create the Master Library row.** Call the equivalent of `resolveOrCreateLibraryWine({ name, producer, vintage, region, grapeVariety, country })` (`wine-submissions.service.ts:291-382`). It already does exactly the dedupe you asked for — signature-hash exact match, then normalized name+producer match, then creates a `library_tier: 3` (Provisional) row if nothing matches (lines 322-358). **Do not use `POST /wines/submissions`** (`wines.controller.ts:89-100`) for this — that path stages into `master_wine_library_submissions` and only resolves asynchronously via `processPendingSubmissions` (a dedup worker, lines 140-273). You need a wine ID *now* to create the inventory row against it; the async staging path can't give you that.
   - **Gap:** `resolveOrCreateLibraryWine` is currently a private method only called from `menus.service.ts:259`, not exposed via any controller route. Something new is needed here — see options below.
2. **Create the inventory row** with quantity/threshold/location/bottle-size/sale-type via `createInventoryItem` (`apps/api-gateway/src/inventory/inventory.service.ts:387-556`), which already:
   - Accepts `costPerBottle`, `thresholdMin/Max`, `storageLocationId`, `saleType`, `pourSizeMl`, `menuPriceGlass`, `bottleSizeMl` (`CreateInventoryItemDto`, `apps/api-gateway/src/inventory/dto/inventory.dto.ts:18-99`).
   - Seeds real initial stock as a cost lot via the `apply_stock_movement` RPC (lines 522-537), not just a bare counter — this is the correct primitive to reuse, not a raw insert.
   - Handles re-activating a soft-deleted row for the same wine (lines 411-467) and returns `409 CONFLICT` with `existingId` if already active (lines 470-478) — the frontend loop must handle that conflict per-row (treat as "already there, maybe just add stock via `transferStock`/`updateInventoryItem` instead of erroring the whole batch out).

### Backend surface: new endpoint vs. loop

**Recommendation: add one new endpoint**, `POST /inventory/:restaurantId/items/bulk`, that internally loops resolve+create per item server-side, in the same spirit as `menus.service.ts:441-486 addToInventory` (which already loops, skips existing rows, and treats individual failures as non-fatal instead of aborting the whole batch — copy that pattern). Reasons to do this over a frontend loop of `createInventoryItem` calls:

- A menu scan can produce 20-60 wines; N sequential `POST /inventory/:id/items` round-trips from the browser is slow and gives poor partial-failure UX (which of the 43 succeeded?).
- The resolve step (`resolveOrCreateLibraryWine`) isn't reachable from the frontend at all right now — it needs a new route regardless, so exposing it as part of one bulk endpoint is no more work than exposing it standalone, and avoids doubling network calls (resolve, then create, per wine).
- Mirrors `menus.service.ts`'s existing "seed inventory from a batch of resolved items" shape closely enough that it should reuse or sit next to `addToInventory`'s logic rather than duplicate it — worth checking whether `menus.service.ts`'s import flow and this one should eventually share a service method.

**If a backend change is out of scope for a first cut:** ship a **frontend loop** calling a new minimal `POST /wines/resolve` endpoint (thin wrapper exposing `resolveOrCreateLibraryWine`) followed by `createInventoryItem` per accepted wine, sequentially with a progress indicator and per-row success/fail state in the confirmation UI. Slower and chattier, but zero new backend orchestration logic — only a thin route.

### Batch quantity/threshold review UI (wireframe-level)

`ScanResultsPanel.tsx` currently only reviews wine *identity*. Do not overload it further — insert a **new step** between `'results'` and `'done'` in `MenuScannerFlow`'s `FlowStep` union (`MenuScannerFlow.tsx:15`), e.g. `'stock-setup'`. Rationale: identity review ("is this the right wine?") and stock review ("how many, where, what par?") are different judgments; conflating them on one screen is exactly the kind of dense, mid-shift-phone friction the user wants to avoid.

Layout for the new step (reuses primitives that already exist elsewhere in the codebase — e.g. the `Stepper` component in `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:110-154`):

```
┌─ Batch setup — 14 wines selected ──────────────────────────┐
│ Apply to all:  Qty [ 6 ▾]  Threshold [ 4 ▾]  Location [Cellar A ▾]   [Apply to all] │
├──────────────────────────────────────────────────────────────┤
│ ☑ Château X 2019           [Library]   Qty 6  Par 4  Cellar A ▾  Bottle ▾ │
│ ☑ Domaine Y NV              [New]       Qty 6  Par 4  Cellar A ▾  Bottle ▾ │
│ ☑ Estate Z 2021 (low conf.) [New]       Qty 1  Par 2  Unassigned ▾ Glass ▾ │
│ ...                                                                        │
├──────────────────────────────────────────────────────────────┤
│              [Back to review]     [Add 14 wines to inventory →]           │
└──────────────────────────────────────────────────────────────┘
```

- **Bulk-apply bar at top** sets a default for every row (par defaults to the restaurant's existing default threshold — `menus.service.ts:488-495 getDefaultThresholdMin` already reads `restaurants.default_threshold_min`, reuse it as the seed value here too).
- **Per-row override** stays inline and cheap (numeric steppers, not a modal), matching the `Stepper` pattern already used in `ReceivingWorkspace.tsx`.
- **`[Library]` / `[New]` badge per row** reuses the color language already established in `ScanResultsPanel.tsx:223-233` (emerald = in library, amber = new) so it's visually consistent with the screen the manager just came from.
- Low-confidence rows (as already flagged with a confidence bar in `ScanResultsPanel.tsx:337-359`) should default to a conservative qty (1) and Unassigned location, forcing a moment's attention without blocking the bulk-apply flow for the confident rows.
- On confirm, this is what feeds the new bulk endpoint / loop described above.

---

## 3. Sample / manual bulk receipt

### What already exists that's relevant

- `inventory_lots.cost_provenance` is a `VARCHAR(12) CHECK (cost_provenance IN ('invoice','estimated','manual'))` (`supabase/migrations/20260710120000_phase2_inventory_lots_foundation.sql:15`).
- `apply_stock_movement` sets `cost_provenance = 'invoice'` when `p_unit_cost IS NOT NULL`, else `'estimated'` (`supabase/migrations/20260710120200_phase2_write_cutover.sql:73-76`). There's no path today that produces `'manual'` despite it being a legal value — worth noting as already-modeled headroom.
- `inventory_lot_rollup`'s WAC calculation explicitly filters `WHERE unit_cost IS NOT NULL` in both numerator and denominator (`supabase/migrations/20260710120100_phase2_lot_rollup_view_and_sync_trigger.sql:14-19`) — a lot with `unit_cost = NULL` is **fully excluded** from WAC, not averaged in at zero. This means: **omitting cost today already prevents WAC corruption.** The risk isn't "$0 destroys WAC," it's "a `NULL`-cost lot from a genuine sample looks identical to a `NULL`-cost lot from a manager who just didn't bother entering the price," and both get labeled `cost_provenance: 'estimated'` — a real reporting ambiguity, not a math bug.
- `CreateInventoryItemDto.costPerBottle` and `CreateInventoryItemRequest.costPerBottle` (`apps/api-gateway/src/inventory/dto/inventory.dto.ts:33-37`, `apps/web/src/services/api/types.ts:112`) already flow end-to-end into `p_unit_cost`. **`AddWineToInventoryModal.tsx` never surfaces this field to the user** — it's plumbed but invisible. `AddToInventoryFromLibraryModal.tsx:107` (`costPerBottle` state, used when adding from the Wine Library page instead of the Inventory page) already has the input. This asymmetry is presumably an oversight, not a decision.

### Option A: Samples only

Add a cost field + a "Free sample (won't affect average cost)" toggle to `AddWineToInventoryModal.tsx`'s sidebar (next to Quantity/Threshold, `AddWineToInventoryModal.tsx:415-471`). Toggling it zeroes/nulls the cost sent and tags the lot distinctly (see migration recommendation below). Minimal-scope, fixes scenario #1 fast, no new UI surface.

### Option B: Large one-off manual receipt only

A distinct bulk-entry screen (spreadsheet/checklist: wine, qty, cost, location per row), separate from both `ReceivingWorkspace.tsx` (requires a matching `order`, does 4-way PO match — wrong tool, no PO exists here) and the single-wine `AddWineToInventoryModal.tsx` (too slow one row at a time for 45 SKUs). Fixes scenarios #5/#6.

### Option C (recommended): One "manual receipt" flow with a per-row cost-basis toggle

Build a single new workspace — call it `ManualReceiptWorkspace`, opened from a new button next to "Add wine" on `InventoryCommandPage.tsx` (near line 472-474) — that is **the same row-grid UI as the Menu Scanner batch-setup step described in §2**, just started empty (or from search-added rows) instead of pre-populated from OCR. Each row gets: wine (search-or-create, reusing the same resolve-or-create call), qty, cost/bottle, location, and a per-row **"Sample — $0, exclude from cost basis"** checkbox that zeroes cost and sets the distinct provenance tag.

**Why this over A+B as separate builds:**
- A sample *is* a large manual receipt with `qty=1` and the sample toggle on — it's a degenerate case of the same shape, not a different one. Building two UIs for the same underlying data shape (wine + qty + cost + location, submitted as a batch) means testing and maintaining two things that will drift.
- It directly reuses the batch UI already being built for Menu Scanner persistence (§2) — same component, three entry points (scanner-detected rows, manually-searched rows, or a mix in one session — useful for scenario #5's "3 rows I know off the top of my head").
- One mental model for managers: "I'm receiving stock that didn't come through a tracked PO" — whether that's 1 free bottle or 300 purchased ones is a difference of scale, not of kind.
- The only real UX risk of unifying is a fast/lazy sample-entry manager (#1) being shown a "batch grid" that feels heavier than a single quick add. Mitigate by keeping the existing single-wine `AddWineToInventoryModal.tsx` sample toggle (Option A) as the *fast path* for exactly one wine, and reserving `ManualReceiptWorkspace` for 2+ rows — both write through the same backend primitives, so this is a UI-entry-point decision, not a data-model fork.

### Recommended data model change

1. Add `'sample'` to the `cost_provenance` CHECK constraint (currently `('invoice','estimated','manual')`, `supabase/migrations/20260710120000_phase2_inventory_lots_foundation.sql:15`) — small additive migration.
2. Update `inventory_lot_rollup`'s WAC filter (`supabase/migrations/20260710120100_phase2_lot_rollup_view_and_sync_trigger.sql:14-19`) to also exclude `cost_provenance = 'sample'` explicitly, rather than relying on `unit_cost IS NULL` as a proxy. This makes the exclusion a real, named property of the data instead of an implicit side effect of leaving a field blank — and lets "value on hand" reporting later choose to *show* sample bottles at $0 explicitly (currently: since `stock_live`/`shadow_stock` counts include sample bottles' quantity regardless of cost, the "Value on hand" KPI (`InventoryCommandPage.tsx:404-414`, `wac * (live+shadow)`) will slightly **overstate** value by pricing sample bottles at the paid-lot WAC rather than $0 — worth a small correction once the tag exists: compute value as `SUM(qty * COALESCE(wac_for_that_lot, 0))` rather than `wac * total_qty`.)
3. `apply_stock_movement` already accepts `p_unit_cost` and writes it straight to the ledger (`inventory_transactions.unit_cost`) — no ledger schema change needed, just pass `0` explicitly (not `NULL`) plus the new provenance flag so a $0 sample is visibly distinct from "unknown cost" in the audit trail (`RowExpansion.tsx:317-322 "View ledger"` link).

---

## 4. Removal edge cases

(Informational only — the reconcile-to-zero-then-delete policy itself is the parent's decision, not revisited here.)

- **Open-bottle partial ml.** `InventoryItem.openMl` (`useInventoryPage.ts:23`, surfaced in `RowExpansion.tsx:140-145` as "Open bottle: X ml left") tracks partially-consumed bottles separately from whole-bottle counts. Confirm the reconcile-to-zero step also zeroes `openMl` — a wine reconciled to 0 whole bottles but with, say, 200ml still shown open would let the row pass the "stock is zero" gate while an inconsistent partial-bottle figure lingers.
- **Multi-location split.** `InventoryItem.locations` (`useInventoryPage.ts:27`) can spread one wine's stock across several storage locations with independent per-location WAC. Verify `reconcileItem`'s backend path zeroes every location's lots, not just an aggregate total — a reconcile that sets the *overall* count to 0 without walking all location-scoped lots could leave orphaned lots at a secondary location.
- **In-flight/expected PO.** Orders reference a specific `inventoryId` (see `ReceivingWorkspace` query in `RowExpansion.tsx:73-78`, and the `verify=<orderId>` deep link keyed off it in `InventoryCommandPage.tsx:119-124`). If a wine is deleted while it has an order sitting in `DELIVERED`/`PARTIALLY_RECEIVED` awaiting the "Match invoice" step (`InventoryCommandPage.tsx:493-501` attention-rail chip), that order becomes orphaned against a soft-deleted row. Two mitigations worth considering: block delete while an open order references the item, or lean on the fact that `createInventoryItem` already auto-reactivates a soft-deleted row on next stock movement (`inventory.service.ts:411-467`) as a self-healing fallback if verification happens after deletion anyway.
- **Menu items / POS mapping still pointing at it.** `menu_items.inventory_item_id` (`menus.service.ts:497-506 backfillMenuItemColumn`) and Toast GUID mapping (`toast_item_guid`, `inventory.controller.ts` toast endpoints) can both still reference a soft-deleted `restaurant_inventory` row. A menu item or POS button left pointing at an archived wine risks a silent oversell or a confusing "sold an item with no inventory record" state. Worth a pre-delete check (or at least a warning) for active menu items / Toast mappings referencing the row.
- **Ledger/history integrity.** This looks solid as-is: `softDeleteItem` (`inventory.service.ts:908-966`) only flips `is_active`; it never touches `inventory_lots` or `inventory_transactions`, so historical WAC/valuation reporting for a since-removed wine stays intact. No action needed, just confirming it's not a gap.

---

## 5. Prioritized build list

1. **Wire up the simple case of Menu Scanner persistence first**: for detected wines already `inMasterLibrary` with a `masterWineId`, loop `createInventoryItem` calls straight from `onWinesAdded` with restaurant-default par/qty and no location — no new backend, no schema change, immediately stops wines from vanishing after a scan for the common "wine's already in my library" case.
2. **Add the batch quantity/threshold/location step** (§2 wireframe) to `MenuScannerFlow` between `'results'` and `'done'`, feeding the loop from step 1. This is the actual friction fix the scenarios call for.
3. **Add the cost field + sample toggle to `AddWineToInventoryModal.tsx`** (§3 Option A) — small, isolated, uses already-plumbed `costPerBottle`/`p_unit_cost` support, unlocks the fast sample scenario (#1) without touching the scanner work.
4. **Migration: `cost_provenance = 'sample'` + WAC-view exclusion** (§3 data model) — do this once the toggle from step 3 ships, so "deliberately free" and "cost unknown" stop being indistinguishable in reporting.
5. **Expose `resolveOrCreateLibraryWine` and build the real bulk endpoint** (`POST /inventory/:restaurantId/items/bulk` or equivalent) to replace the frontend loop from step 1 once volume/robustness matters (atomic-ish per-item results, fewer round trips) — needed regardless for wines *not* already in the library, since there's currently no reachable way to synchronously mint a new Master Library row from the UI.
6. **Build `ManualReceiptWorkspace`** (§3 Option C) reusing the grid component from step 2, for large one-off receipts and multi-row samples.
7. **Removal hardening** (§4): verify `openMl` and multi-location zeroing on reconcile, add an open-order/active-menu-item check before delete, and add a bulk "reconcile to zero + archive" action to the existing multi-select bar (`InventoryCommandPage.tsx:576-594`) for scenario #10.

---

## 6. Build status (2026-07-29)

Items 1–6 of §5 are **complete**. Item 7 (removal hardening) is the only one still open.

| # | Item | Status | Where it landed |
|---|---|---|---|
| 1 | Menu Scanner persistence, simple case | done | `apps/web/src/lib/menuScannerPersistence.ts` |
| 2 | Batch quantity/threshold/location step | done | `BatchReceiveGrid.tsx`, new `'stock-setup'` step in `MenuScannerFlow.tsx` |
| 3 | Cost field + sample toggle, single wine | done | `AddWineToInventoryModal.tsx` |
| 4 | `cost_provenance = 'sample'` + WAC exclusion | done | `supabase/migrations/20260729120000_inventory_sample_cost_provenance.sql` |
| 5 | Bulk endpoint + library resolve-or-create | done | `POST /inventory/:restaurantId/items/bulk` |
| 6 | `ManualReceiptWorkspace` | done | `apps/web/src/components/inventory/ManualReceiptWorkspace.tsx` |
| 7 | Removal hardening | **open** | — |

### Notes on how items 4 and 5 differ from the plan above

**§3 step 3 was wrong about `apply_stock_movement`.** The plan said "no ledger schema
change needed, just pass `0` explicitly plus the new provenance flag". There was no
provenance flag to pass: the live function hardcoded
`CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END`, so a $0 sample
would have been written as provenance `'invoice'` — the exact conflation the change was
meant to remove. The migration therefore also swaps the function for a 12-argument
version taking `p_cost_provenance`. `CREATE OR REPLACE` could not be used (a new
trailing argument creates a second, ambiguous overload), so it is a `DROP` + `CREATE`
with the ACL re-granted; every caller in the repo passes named arguments, so the added
optional parameter is backward compatible.

Verified against synthetic lots: 6 btl @ $40 + 6 btl @ $60 + 2 free samples now yields
WAC **$50.00** and `live_qty` 14. The old formula reported **$42.86** — a 14%
understatement of cost per bottle.

**The bulk endpoint is not just a batched loop.** Three behaviours the per-item loop
could not have:
- A wine already in inventory is `stock_added`, not a 409. Receiving a case of
  something you already carry is not an error condition.
- A line may carry `wineDraft` instead of `wineId`, resolved through
  `WineSubmissionsService.resolveOrCreateLibraryWine` (exact signature → normalized
  name+producer → Provisional tier 3). This removes the "not in library" dead end
  entirely, which was the largest hole in item 1.
- Per-line results keyed by request index; one bad line never aborts the batch.

### Follow-ups this work surfaced

- **`sample_qty` is now available on `inventory_lot_rollup`** but nothing reads it yet.
  §3's note about the "Value on hand" KPI overstating value still stands: it computes
  `wac * (live + shadow)`, which prices free-sample bottles at the paid-lot WAC. The tag
  needed to fix it now exists.
- **`master_wine_library` has no market price data at all** — `retail_price_avg`,
  `market_value` and `market_data` are null on all 442 rows. Both the Inventory "Market"
  delta column and the new Wine Library "Market Price" column are therefore wired to a
  real field that renders "—" until a price-enrichment pipeline populates it. The
  plumbing is complete (`wines.service.ts` now maps `retail_price_avg` → `retailPriceAvg`,
  which the library maps to `marketPrice`); only the data is missing.
- **The Wine Library grid view still shows stock-derived badges.** The list table's
  `Stock` and `Status` columns were removed because `mapApiWineToUiWine` hardcodes
  `liveStock: null, threshold: 6`, so every catalog-only wine rendered "0 / 6" and
  "Out of Stock". The grid view (`WineLibrary.tsx`, grid branch) has the same defect and
  was left alone pending a decision.
