---
phase: 17-storagelocationmanager-intelligence-ux-refinement
plan: "02"
subsystem: inventory/storage-locations
tags: [feat, wine-picker, storage-locations, ux, mappings]
dependency_graph:
  requires: [17-01]
  provides: [interactive-wine-picker, inline-assign-remove]
  affects: [StorageLocationManager]
tech_stack:
  added: []
  patterns: [computed-from-mappings, inline-picker]
key_files:
  modified:
    - apps/web/src/components/inventory/StorageLocationManager.tsx
  created: []
decisions:
  - "winesAvailableToAssign filters by NOT already assigned to THIS location — allows reassignment from other locations"
  - "winesAtThisLocation derives from mappings array (live), not inventoryItems string-match (stale)"
  - "Removed getLocationItems/locationItemTotal/locationItemsSorted — superseded by mappings-based computation"
  - "Assign button passes item.liveStock||1 as quantity to match inventory stock"
metrics:
  duration: ~6 minutes
  completed_date: "2026-04-08"
  tasks_completed: 1
  files_modified: 1
---

# Phase 17 Plan 02: Interactive Wine Picker in StorageLocationManager Edit Panel Summary

Replaced static "No wines assigned to this location yet." placeholder in the StorageLocationManager edit panel with a live interactive wine picker — search input filtered by name/producer, Assign buttons calling assignWineToLocation, and assigned wines list with per-wine Remove buttons calling removeWineFromLocation.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add wine picker to StorageLocationManager edit panel | 8a4efc8 | StorageLocationManager.tsx |

## What Was Built

### StorageLocationManager.tsx

**Step A — Hook destructuring extended:**
- Added `mappings`, `assignWineToLocation`, `removeWineFromLocation` to the `useStorageLocations()` destructure at line 76

**Step B — State:**
- Added `wineSearchQuery` / `setWineSearchQuery` state for the picker search input

**Step C — Computed arrays:**
- `winesAvailableToAssign`: `inventoryItems` filtered to wines NOT already assigned to the current editing location (via `mappings`)
- `winesFilteredBySearch`: `winesAvailableToAssign` further filtered by `wineSearchQuery` matching name or producer
- `winesAtThisLocation`: `mappings` entries for the current location cross-referenced with `inventoryItems` to include `mappingQuantity`

**Step D — Stored Wines section replaced:**
- Header now shows "N wines assigned here" derived from `winesAtThisLocation.length`
- Assigned wines list (`max-h-32`, scrollable) renders each `winesAtThisLocation` entry with quantity badge and `X` Remove button
- Search input (`pl-8`, Wine icon prefix) bound to `wineSearchQuery`; disabled when `inventoryItems` is empty
- Empty state messages: "Open Inventory to load wines…" / "No wines match your search." / "All inventory wines are already assigned here."
- Picker list (`max-h-36`, scrollable) shows up to 20 matches with per-row `Assign` button calling `assignWineToLocation` and clearing the search query
- Overflow indicator: "{N} more — refine your search"

**Cleanup:**
- Removed now-unused `getLocationItems`, `locationItemTotal`, `locationItemsSorted` (they were string-match based; superseded by mappings-based computation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused variables from replaced section**
- **Found during:** TypeScript check after Step D
- **Issue:** `locationItemTotal` and `locationItemsSorted` (and their source `getLocationItems`) became unused after the Stored Wines section was replaced
- **Fix:** Removed all three — `getLocationItems` function, `locationItemTotal`, and `locationItemsSorted`
- **Files modified:** StorageLocationManager.tsx
- **Commit:** 8a4efc8 (included in same commit)

## Known Stubs

None — wine picker is fully wired to live `mappings` data and `assignWineToLocation` / `removeWineFromLocation` from `useStorageLocations()`.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. `assignWineToLocation` and `removeWineFromLocation` already existed in the hook and persist to server via `persistToServer`.

## Self-Check: PASSED

Files exist:
- ✅ apps/web/src/components/inventory/StorageLocationManager.tsx — modified

Commits exist:
- ✅ 8a4efc8 — feat(17-02): replace static stored wines list with interactive wine picker

TypeScript errors introduced: 0 (two pre-existing errors at lines 12/73 for unused `Edit3` import and unused `selectedWineId` prop — pre-dated this plan, confirmed in 17-01 SUMMARY)
