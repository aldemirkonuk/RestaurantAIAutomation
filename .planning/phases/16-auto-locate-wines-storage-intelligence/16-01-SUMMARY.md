---
phase: 16-auto-locate-wines-storage-intelligence
plan: 01
subsystem: frontend/hooks, frontend/pages
tags: [cache-invalidation, react-query, inventory-filter, storage-locations]
dependency_graph:
  requires: []
  provides: [accurate-location-cache, working-location-chip-filter]
  affects: [StorageLocationManager, Inventory table, LocationPickerCell (Plan 02), Auto-Locate (Plans 04-05)]
tech_stack:
  added: []
  patterns: [React Query cache invalidation with queryClient.invalidateQueries, useMemo-derived filter]
key_files:
  modified:
    - apps/web/src/hooks/useStorageLocations.ts
    - apps/web/src/pages/Inventory.tsx
decisions:
  - "Move WINES_AT_LOCATION_KEY const above useStorageLocations hook to fix temporal dead zone bug"
  - "Invalidate by [WINES_AT_LOCATION_KEY, restaurantId] prefix to bust all location-specific sub-keys in one call"
  - "Wrap displayedInventory in useMemo for referential stability; place it right after mergedInventory"
  - "Also update export and select-all to use displayedInventory for consistent location-filter behavior"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-08"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 16 Plan 01: Cache Invalidation + Location Filter Fix Summary

Two surgical fixes eliminating root bugs that were blocking all Phase 16 feature completeness.

## Objective

Fix (1) stale "No wines assigned" state in StorageLocationManager after assign/remove, and (2) non-functional location chip filter in the Inventory table.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix cache invalidation in useStorageLocations.ts | ef61a00 | apps/web/src/hooks/useStorageLocations.ts |
| 2 | Add displayedInventory location filter in Inventory.tsx | bc2e2a7 | apps/web/src/pages/Inventory.tsx |

## Changes Made

### Task 1 — useStorageLocations.ts

**Root cause:** `WINES_AT_LOCATION_KEY` was declared at line 382, *after* the `useStorageLocations` hook exports, making it inaccessible inside the hook body. Even if it had been hoisted, neither `assignWineToLocation` nor `removeWineFromLocation` ever called `queryClient.invalidateQueries` after persisting to the server.

**Fix:**
1. Moved `const WINES_AT_LOCATION_KEY = 'winesAtLocation'` to line 58, alongside `LOCATIONS_KEY` and `MAPPINGS_KEY` — before the hook definition.
2. Removed the duplicate declaration that was at the bottom of the file (line 382).
3. Added two `queryClient.invalidateQueries` calls at the end of `assignWineToLocation` (after `persistToServer`): one for `[WINES_AT_LOCATION_KEY, restaurantId]` and one for `[MAPPINGS_KEY, restaurantId]`.
4. Added the same two `queryClient.invalidateQueries` calls at the end of `removeWineFromLocation`.

Result: After assign or remove, React Query invalidates both the wines-at-location query and the mappings query, triggering a fresh fetch in `StorageLocationManager`.

### Task 2 — Inventory.tsx

**Root cause:** `selectedLocationFilter` was in the `useMemo` dependency array of `filteredInventory` (inside `useInventoryPage`) but the filter body never used it — so clicking a location chip had no effect on the table rows.

**Fix:**
1. Added `displayedInventory` as a `useMemo` right after `mergedInventory` in the `Inventory` component body:
   ```typescript
   const displayedInventory = useMemo(
     () => selectedLocationFilter
       ? filteredInventory.filter(item => getWineLocation(item.id)?.id === selectedLocationFilter)
       : filteredInventory,
     [filteredInventory, selectedLocationFilter, getWineLocation]
   )
   ```
2. Changed the table body render from `filteredInventory.map(...)` to `displayedInventory.map(...)`.
3. Also updated export (`handleExport`) and select-all checkbox to use `displayedInventory` for consistent behavior — exporting and selecting only what is visible when a location chip is active.

## Verification

```
grep -n "const WINES_AT_LOCATION_KEY" apps/web/src/hooks/useStorageLocations.ts
# 58:const WINES_AT_LOCATION_KEY = 'winesAtLocation'  ✅ (≤ 60)

grep -c "invalidateQueries" apps/web/src/hooks/useStorageLocations.ts
# 4  ✅ (2 per function × 2 functions)

grep -n "displayedInventory.map" apps/web/src/pages/Inventory.tsx
# 577, 1057, 1152  ✅

grep -n "filteredInventory.map" apps/web/src/pages/Inventory.tsx
# (empty)  ✅
```

## Deviations from Plan

### Auto-extended (Rule 2 - completeness)

**Export and select-all consistency**
- **Found during:** Task 2
- **Issue:** After adding `displayedInventory` for the table render, `handleExport` and the select-all checkbox still referenced `filteredInventory.map` — so exporting while a location chip was active would export all wines, not just the filtered set.
- **Fix:** Changed both uses to `displayedInventory.map` so export and select-all respect the active location filter.
- **Files modified:** apps/web/src/pages/Inventory.tsx
- **Commit:** bc2e2a7

## Known Stubs

None — both fixes wire real data, no placeholders or TODOs introduced.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| None | — | No new network endpoints or auth paths introduced |

## Self-Check: PASSED

```
[ -f "apps/web/src/hooks/useStorageLocations.ts" ] → FOUND
[ -f "apps/web/src/pages/Inventory.tsx" ] → FOUND
git log --oneline | grep ef61a00 → FOUND
git log --oneline | grep bc2e2a7 → FOUND
```
