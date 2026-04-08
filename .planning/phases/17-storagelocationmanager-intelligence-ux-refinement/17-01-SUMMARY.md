---
phase: 17-storagelocationmanager-intelligence-ux-refinement
plan: "01"
subsystem: inventory/storage-locations
tags: [fix, capacity-counts, storage-locations, ux]
dependency_graph:
  requires: []
  provides: [accurate-capacity-counts, actual-location-counts]
  affects: [StorageLocationManager, useStorageLocations]
tech_stack:
  added: []
  patterns: [computed-from-mappings]
key_files:
  modified:
    - apps/web/src/hooks/useStorageLocations.ts
    - apps/web/src/components/inventory/StorageLocationManager.tsx
  created: []
decisions:
  - "DEFAULT_LOCATIONS zeroed rather than removed — fallback data still needed when API unavailable"
  - "actualLocations computed at render time from getLocationsWithActualCounts() — no memoization needed, hook already memoizes with useCallback"
  - "locations array kept for edit form state; actualLocations used only for display (capacity bars, footer count)"
metrics:
  duration: ~4 minutes
  completed_date: "2026-04-08"
  tasks_completed: 2
  files_modified: 2
---

# Phase 17 Plan 01: Fix Stale Capacity Counts in StorageLocationManager Summary

Zeroed hardcoded DEFAULT_LOCATIONS currentCount values (324/78/45/32→0) and wired StorageLocationManager capacity bars and footer to use getLocationsWithActualCounts() computed from live wine_location_mappings instead of stale server-stored current_count.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Zero out DEFAULT_LOCATIONS currentCount | e5198b9 | useStorageLocations.ts |
| 2 | Use getLocationsWithActualCounts() in StorageLocationManager | 0db0dc1 | StorageLocationManager.tsx |

## What Was Built

### Task 1 — useStorageLocations.ts
- All four DEFAULT_LOCATIONS entries had their `currentCount` changed from placeholder values (324, 78, 45, 32) to `0`
- `getLocationsWithActualCounts` was already exported in the hook's return object from Phase 16 — no change needed

### Task 2 — StorageLocationManager.tsx
- Destructured `getLocationsWithActualCounts` from `useStorageLocations()` at line 76
- Added `const actualLocations = getLocationsWithActualCounts()` immediately after destructuring
- Changed location cards list from `locations.map` → `actualLocations.map` so every card's capacity bar uses the computed actual count
- Changed footer from `locations.reduce(...)` → `actualLocations.reduce(...)` so "X bottles stored" reflects real mappings
- `locations` array is preserved for edit form state (`editingLocation`, `startEdit`, `handleUpdate`) as these need the raw server-stored location objects

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all capacity data is now computed from live wine_location_mappings.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

Files exist:
- ✅ apps/web/src/hooks/useStorageLocations.ts — modified
- ✅ apps/web/src/components/inventory/StorageLocationManager.tsx — modified

Commits exist:
- ✅ e5198b9 — fix(17-01): zero out DEFAULT_LOCATIONS currentCount placeholder values
- ✅ 0db0dc1 — fix(17-01): use getLocationsWithActualCounts() for capacity display in StorageLocationManager

TypeScript errors introduced: 0 (two pre-existing errors in StorageLocationManager at lines 12/73 for unused `Edit3` import and unused `selectedWineId` prop — not caused by this plan's changes)
