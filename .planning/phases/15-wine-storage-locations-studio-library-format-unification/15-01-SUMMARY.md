---
phase: 15-wine-storage-locations-studio-library-format-unification
plan: "01"
subsystem: storage-locations
tags: [api, react-query, inventory, wine-locations]
dependency_graph:
  requires: []
  provides:
    - GET /storage-locations/:restaurantId/locations/:locationId/wines (enriched wine list)
    - useWinesAtLocation React Query hook
    - StorageLocationManager expandable location cards
  affects:
    - apps/api-gateway/src/storage-locations/
    - apps/web/src/hooks/useStorageLocations.ts
    - apps/web/src/components/inventory/StorageLocationManager.tsx
tech_stack:
  added:
    - EnrichedWineAtLocation interface (service + hook)
  patterns:
    - Batch Supabase `.in()` query for wine name enrichment
    - React Query standalone hook with enabled guard
    - Graceful fallback (wineId as name when master_wine_library misses)
key_files:
  created: []
  modified:
    - apps/api-gateway/src/storage-locations/storage-locations.service.ts
    - apps/api-gateway/src/storage-locations/storage-locations.controller.ts
    - apps/web/src/hooks/useStorageLocations.ts
    - apps/web/src/components/inventory/StorageLocationManager.tsx
decisions:
  - "Used single batch .in() query for master_wine_library lookup — avoids N+1"
  - "useWinesAtLocation is a separate exported hook, not folded into useStorageLocations return — cleaner lazy-load semantics"
  - "Expand toggle is a separate button with stopPropagation so card-click-to-edit still works"
  - "Wines query disabled when locationId is null — no unnecessary fetches"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-07"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 15 Plan 01: Add Enriched Wines-at-Location API + Expandable Location Cards Summary

Enriched `GET /:restaurantId/locations/:locationId/wines` NestJS endpoint plus React Query `useWinesAtLocation` hook and collapsible wine list per storage location card in `StorageLocationManager`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add enriched wines-at-location API endpoint | f13689a | storage-locations.service.ts, storage-locations.controller.ts |
| 2 | Expandable wine list in StorageLocationManager + useWinesAtLocation hook | 70b1eb5 | useStorageLocations.ts, StorageLocationManager.tsx |

## What Was Built

**Backend (Task 1):**
- `EnrichedWineAtLocation` interface exported from service: `{ wineId, wineName, producer, vintage, quantity, assignedAt }`
- `getWinesAtLocation(restaurantId, locationId)` method on `StorageLocationsService`:
  - Queries `wine_location_mappings` filtered by both `restaurant_id` and `location_id`
  - Batch-fetches `master_wine_library` with `.in('id', wineIds)` to get name/producer/vintage
  - Graceful fallback: if no library match, uses `wineId` as the display name
- `GET /:restaurantId/locations/:locationId/wines` controller route placed before `GET /:restaurantId` to avoid routing conflicts
- Scoped by `restaurant_id` — satisfies T-15-01 threat mitigation (JwtAuthGuard already enforced at controller level)

**Frontend (Task 2):**
- `EnrichedWineAtLocation` interface exported from `useStorageLocations.ts`
- `useWinesAtLocation(locationId: string | null)` standalone exported hook:
  - React Query with `queryKey: [WINES_AT_LOCATION_KEY, restaurantId, locationId]`
  - Disabled when `locationId` is null (no wasteful fetches)
  - Returns `{ wines: EnrichedWineAtLocation[], isLoading: boolean }`
- `StorageLocationManager.tsx` additions:
  - `expandedLocationId` state (one at a time)
  - `useWinesAtLocation(expandedLocationId)` called at component level
  - Chevron toggle button (`ChevronDown`/`ChevronRight`) below capacity bar on each card — click stops propagation so edit-on-card-click still works
  - Expanded section shows wine list: bold wine name + vintage, gray producer, quantity badge in location color
  - Loading spinner (`Loader2` animated) during fetch
  - "No wines assigned" placeholder when empty

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data paths are wired to live API endpoints.

## Pre-existing TypeScript Issues (not caused by this plan)

The `apps/web` TypeScript compilation has pre-existing errors unrelated to this plan's changes:
- `@testing-library/react` module not found (test setup)
- framer-motion + lucide-react JSX type compatibility issues (`AnimatePresence`, `motion.div`, all lucide icons including pre-existing `MapPin`, `X`, `Plus`, etc.)
- File casing conflicts in `App.tsx` (`Dashboard.tsx` vs `dashboard.tsx`)

My new code (`useWinesAtLocation` call, new icon imports) has no errors beyond the same pre-existing pattern.

## Threat Surface Scan

No new trust boundaries introduced. The new endpoint follows existing JwtAuthGuard + restaurantId scoping pattern. No additional threat flags.

## Self-Check: PASSED

All 4 modified files confirmed on disk. Both task commits (f13689a, 70b1eb5) verified in git log.
