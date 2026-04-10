# Phase 16: Auto-Locate Wines & Storage Intelligence — Context

**Discussed:** 2026-04-08  
**Status:** LOCKED — guides replanning of 16-01 and 16-02  
**Prior research:** `16-RESEARCH.md` (HIGH confidence, all claims verified)

---

## Decisions (Locked)

### D1: Manual Assignment UX — New `LocationPickerCell.tsx` Component
**Decision:** Build a new `LocationPickerCell.tsx` component (pill badge + styled dropdown).  
**Rationale:** The existing `<select>` element is functional but not state-of-the-art. The new component will be:
- A pill badge showing colored dot + location name when assigned
- A dashed "Assign location" placeholder when unassigned
- A styled dropdown listing all locations with capacity info (`{used}/{capacity}`)
- Full locations (at capacity) grayed out + "Full" badge, disabled
- "Remove assignment" at the bottom when assigned
- `Loader2` spinner during mutation

**Implementation note:** The existing `<select>` picker in `Inventory.tsx` (lines ~1193-1246) is REPLACED by `LocationPickerCell`. The `assignWineToLocation` call pattern stays the same.

**Cache fix (critical):** The root cause of "No wines assigned" in `StorageLocationManager` is missing `queryClient.invalidateQueries` after assign/remove. Fix by moving `WINES_AT_LOCATION_KEY` constant before `useStorageLocations` declaration and adding invalidation calls after both `persistToServer` calls (assign + remove).

---

### D2: Auto-Locate Scope — Include-Already-Assigned Toggle in Modal
**Decision:** Auto-Locate runs on ALL inventory wines by default (not just filtered/visible), but the preview modal shows a toggle:  
`☐ Include already-assigned wines (will reassign them)`  
Default: unchecked (only unassigned wines are shown in the plan). When checked, already-assigned wines are re-evaluated and may be moved.  
**Rationale:** The full cellar view gives the algorithm the best allocation picture. The toggle respects intentional manual assignments by default while giving the operator a "full re-optimize" escape hatch.

---

### D3: Auto-Locate Filtering — All Inventory Wines
**Decision:** The scoring engine receives ALL wines from inventory (not filtered by search/type chips).  
**Rationale:** Filtering by visible wines would produce a partial allocation that ignores the full cellar picture. Restaurant efficiency requires the engine to see everything to make optimal capacity decisions.

---

### D4: Preview Modal Controls — Per-Row Checkbox + Location Override Dropdown
**Decision:** The preview modal is a full table with:
- **Per-row checkbox** — uncheck to exclude a wine from the batch
- **Proposed location dropdown** — change the engine's suggestion before confirming
- **Score badge** — shows overall fitness score for the assignment
- **Reasons column** — brief explanation (e.g., "Temperature match · Wine type grouping · High capacity")
- **Header stats** — "X wines to assign · Y locations utilized · Z skipped (no valid match)"
- **Footer:** `Confirm Selected (N)` button + `Cancel`

**Rationale:** Restaurant operators need to review and override AI suggestions before committing. Per-row control prevents accidental bulk reassignments. This is state of the art for any professional inventory tool.

---

### D5: Scoring Algorithm — All Signals (Composite Score)
**Decision:** Use all four scoring dimensions:

| Signal | Max Points | Logic |
|--------|-----------|-------|
| Temperature match | 40 | Parse °F/°C from `StorageLocation.temperature`; red wines prefer 60-65°F, white/sparkling prefer 45-55°F, dessert prefer 55-60°F |
| Wine type grouping | 30 | +30 if location already predominantly stores same type, +15 if name suggests type (e.g. "White Wine Fridge") |
| Capacity availability | 20 | Proportional: `(capacity - currentCount) / capacity * 20`; skip if full |
| Accessibility | 10 | +10 if location name contains "bar", "floor", "service" AND wine is sold by glass (`saleType === 'glass' || 'both'`) |

**Total:** 100 points max  
**Allocation strategy:** Greedy capacity-aware — sort wines by their best score descending, assign to highest-scoring location, track running counts per location, skip location if full.

---

### D6: Sales Velocity — Placeholder Field, No Effect Until Wired
**Decision:** The `autoLocateEngine.ts` function signature includes `salesVelocity?: number` on each wine input object. The engine has a commented-out scoring block for it:
```typescript
// FUTURE: sales velocity signal (wire to real sales data in later phase)
// if (wine.salesVelocity && wine.salesVelocity > 20) {
//   score += Math.min(10, wine.salesVelocity / 5)  // +10 max for high-velocity wines
//   reasons.push('High sales velocity → accessible location preferred')
// }
```
Current value is always `0` until the sales data pipeline is connected.  
**Rationale:** Architecture is ready for the signal; no false behavior until real data arrives.

---

## Implementation Architecture (Updated from Research)

### What Exists (Do Not Rebuild)
- `assignWineToLocation(wineId, locationId, quantity?)` in `useStorageLocations.ts` — calls POST /mappings ✅
- `removeWineFromLocation(wineId)` in `useStorageLocations.ts` — calls DELETE /mappings/:wineId ✅  
- POST `/api/v1/storage-locations/:restaurantId/mappings` NestJS endpoint ✅
- Inline location column in `Inventory.tsx` (replace with `LocationPickerCell`, don't rebuild table) ✅
- `getLocationsWithActualCounts()` for accurate capacity tracking ✅

### What Gets Built

**Wave 1 — Bug Fixes (no new files):**
1. `useStorageLocations.ts`: Move `WINES_AT_LOCATION_KEY` to top of file; add `queryClient.invalidateQueries` for `MAPPINGS_KEY`, `WINES_AT_LOCATION_KEY` after assign AND after remove
2. `Inventory.tsx`: Add secondary location filter using `getWineLocation(item.id)?.id === selectedLocationFilter` (local `displayedInventory` variable wrapping `filteredInventory`)

**Wave 2 — New Component:**
3. `apps/web/src/components/inventory/LocationPickerCell.tsx` — pill badge + styled dropdown with click-outside, loading state, capacity display, full-location guard

**Wave 3 — Wire LocationPickerCell:**
4. `Inventory.tsx`: Replace existing `<select>` location picker cells with `<LocationPickerCell wineId={item.id} quantity={item.liveStock || 1} />`

**Wave 4 — Auto-Locate Engine:**
5. `apps/web/src/lib/autoLocateEngine.ts` — pure function, no hooks, all signal types documented above

**Wave 5 — Preview Modal:**
6. `apps/web/src/components/inventory/AutoLocatePreviewModal.tsx` — per-row table with checkbox + location override dropdown + score badge + reasons + summary stats

**Wave 6 — Wire Auto-Locate into Inventory:**
7. `Inventory.tsx`: Add `useQueryClient`, `showAutoLocateModal` state, "Auto-Locate" button (Zap icon, emerald), `handleAutoLocate` (compute plan), `handleConfirmAutoLocate` (batch assign + invalidate cache), render `<AutoLocatePreviewModal>`

---

## Key Pitfalls (From Research, Must Not Repeat)

- `WINES_AT_LOCATION_KEY` is declared at line 382 — AFTER the hook. Move it to top of file before using in invalidation.
- Temperature is a free-text string: parse with regex before comparison.
- `InventoryItem.id` = `master_wine_library` UUID (confirmed). Pass this to `assignWineToLocation`.
- `assignWineToLocation` is fire-and-forget (void). The batch assign loop just calls it N times; final cache invalidation handles refresh.
- Inventory.tsx doesn't import `useQueryClient` yet — must be added for batch invalidation.
- Use `getLocationsWithActualCounts()` not `loc.currentCount` for capacity in the engine (avoids stale server counts).

---

## Deferred Ideas (Out of Scope for Phase 16)

- **Sales velocity wiring** — requires a sales pipeline (future phase)
- **Multi-location per wine** — current schema is one-location-per-wine (`onConflict: 'restaurant_id,wine_id'`)
- **Location history / audit log** — no `wine_location_history` table yet
- **Batch backend endpoint** — not needed (N fire-and-forget calls is acceptable for ≤200 wines)
- **Mobile scan-to-locate** — mobile app scope
