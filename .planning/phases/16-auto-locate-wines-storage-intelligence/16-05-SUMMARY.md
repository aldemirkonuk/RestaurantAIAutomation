---
phase: 16-auto-locate-wines-storage-intelligence
plan: "05"
subsystem: frontend/inventory
tags: [auto-locate, inventory, wiring, react-query, modal-integration]
dependency_graph:
  requires:
    - 16-03 (useStorageLocations hook with mappings export)
    - 16-04 (autoLocateEngine.ts + AutoLocatePreviewModal.tsx)
  provides:
    - Auto-Locate button in Inventory toolbar
    - Full Auto-Locate feature wired end-to-end
  affects:
    - apps/web/src/pages/Inventory.tsx
tech_stack:
  added: []
  patterns:
    - useQueryClient for cache invalidation after batch assignment
    - useCallback for memoized handlers with proper dependency arrays
    - Conditional modal render (guard on autoLocateResult != null)
key_files:
  created: []
  modified:
    - apps/web/src/pages/Inventory.tsx
decisions:
  - "Used useAuth() to get activeRestaurantId for scoped queryClient.invalidateQueries — prevents cross-tenant cache invalidation"
  - "Modal wrapped in {autoLocateResult && ...} guard to avoid rendering with null result prop"
  - "handleAutoLocate/handleConfirmAutoLocate use useCallback with full dependency arrays"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-08"
  tasks_completed: 1
  tasks_total: 1
  files_created: 0
  files_modified: 1
---

# Phase 16 Plan 05: Inventory.tsx Auto-Locate Wiring Summary

**One-liner:** Six targeted edits to Inventory.tsx wire the Auto-Locate button (Zap/emerald), scoring plan computation, and AutoLocatePreviewModal into the existing inventory page — completing Phase 16 end-to-end.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire Auto-Locate engine + modal into Inventory.tsx | 66df878 | apps/web/src/pages/Inventory.tsx |

## What Was Built

### Inventory.tsx modifications (+62 lines)

**New imports (4):**
- `useQueryClient` from `@tanstack/react-query`
- `useAuth` from `../contexts/AuthContext`
- `computeAutoLocatePlan, AutoLocateResult, WineLocationScore` from `../lib/autoLocateEngine`
- `AutoLocatePreviewModal` from `../components/inventory/AutoLocatePreviewModal`

**Hook additions:**
- `const { activeRestaurantId } = useAuth()` — for tenant-scoped cache invalidation
- `const queryClient = useQueryClient()` — for invalidating winesAtLocation + storageLocationMappings after batch assign
- `mappings` added to `useStorageLocations()` destructure

**New state:**
- `showAutoLocateModal` — controls modal open/close
- `autoLocateResult: AutoLocateResult | null` — holds computed scoring plan (null = modal not open)
- `includeAssigned: boolean` — toggle for including already-assigned wines

**New handlers:**
- `handleAutoLocate` — calls `computeAutoLocatePlan(mergedInventory, storageLocations, mappings, { skipAssigned: !includeAssigned })`, stores result, opens modal
- `handleConfirmAutoLocate(selected)` — loops over selected `WineLocationScore[]`, calls `assignWineToLocation` per item, then invalidates `['winesAtLocation', restaurantId]` and `['storageLocationMappings', restaurantId]`, closes modal

**Toolbar button:**
- Emerald `bg-emerald-600` button with `<Zap />` icon, disabled when `storageLocations.length === 0`, inserted before Reset Stock button

**Modal render:**
- `{autoLocateResult && <AutoLocatePreviewModal ... />}` at bottom of JSX
- `onToggleIncludeAssigned` recomputes the plan inline with updated `skipAssigned` value

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. The `<interfaces>` block in the plan precisely matched the actual prop signatures from 16-04.

### Notes on Variable Names

- `mergedInventory` was confirmed present at line 92 of Inventory.tsx (computed via `useMemo` over `inventory` + `localOverrides`)
- `mappings` was confirmed exported from `useStorageLocations()` at hook line 359
- `activeRestaurantId` required importing `useAuth` — not previously imported in Inventory.tsx (AuthContext was only used indirectly via child hooks)

## Known Stubs

None — all data flows are live. `autoLocateResult` is populated from actual inventory data and storage locations. No placeholder values.

## Threat Flags

None — no new network endpoints introduced. `handleConfirmAutoLocate` calls the existing `assignWineToLocation` (already auth-gated by the API client). Cache invalidation is scoped to `activeRestaurantId` per T-16-05-03 mitigation.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| apps/web/src/pages/Inventory.tsx modified | FOUND |
| commit 66df878 | CONFIRMED |
| grep "showAutoLocateModal" Inventory.tsx | 4 matches |
| grep "handleAutoLocate" Inventory.tsx | 3 matches |
| grep "handleConfirmAutoLocate" Inventory.tsx | 2 matches |
| grep "Auto-Locate" Inventory.tsx | 2 matches (button label + comment) |
| grep "AutoLocatePreviewModal" Inventory.tsx | 2 matches (import + render) |
| grep "invalidateQueries.*winesAtLocation" Inventory.tsx | 1 match |
| TypeScript errors in Inventory.tsx | 0 |
