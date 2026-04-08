# Phase 15 Context: Wine Storage Locations & Studio↔Library Format Unification

## Decisions

- D-01: **Storage location display is expandable per-location card** — click a location → see wines + counts inline in StorageLocationManager (not a separate page)
- D-02: **Wine-to-location assignment via dropdown on inventory rows** — simple select from existing locations
- D-03: **Backend enrichment via NestJS join query** — new endpoint returns wine_location_mappings joined with master_wine_library for names/producers, not client-side cross-referencing
- D-04: **Promotion = insert into master_wine_library** — Studio-approved wines are copied from master_wine_library_submissions to master_wine_library using a mapping function
- D-05: **Mapping function lives in shared frontend util** — `mapWineRecordToApiWine()` for frontend preview, backend does its own field mapping for the DB insert
- D-06: **"Promote to Library" button appears per-wine in Studio** — only for wines with status approved or where developer/review_admin has overridden fields
- D-07: **Reuse existing NestJS storage-locations controller** — add a new endpoint to it, not a new controller
- D-08: **No new DB migrations needed for Part A** — storage_locations + wine_location_mappings already exist
- D-09: **Promotion endpoint on Python FastAPI (studio_routes.py)** — keeps all Studio logic in the same backend, uses existing Supabase client

## Deferred Ideas

- Advanced storage analytics (temperature monitoring, movement history)
- Batch promotion of entire Studio sessions
- Auto-assignment of wines to locations based on type/region rules
- Location capacity enforcement (block assignment when full)

## Claude's Discretion

- Exact UI layout of the expandable wine list (card vs table vs simple list)
- Whether to show a "promote all" batch action (deferred per above)
- Error handling UX for promotion failures
- Whether the location picker shows in the wine detail modal or only in inventory table rows

## Existing Infrastructure

### Backend (NestJS api-gateway)
- `StorageLocationsController` at `apps/api-gateway/src/storage-locations/storage-locations.controller.ts`
  - GET /:restaurantId → listLocations
  - GET /:restaurantId/mappings → listMappings (returns raw wineId/locationId/quantity)
  - POST /:restaurantId/mappings → assignWineToLocation (upsert)
  - DELETE /:restaurantId/mappings/:wineId → removeWineFromLocation
  - POST /:restaurantId → createLocation
  - PATCH /:restaurantId/:locationId → updateLocation
  - DELETE /:restaurantId/:locationId → deleteLocation (soft)
- `StorageLocationsService` handles all Supabase queries

### Backend (Python FastAPI agent-orchestrator)
- `studio_routes.py` at `services/agent-orchestrator/api/studio_routes.py`
  - POST /api/v1/studio/sessions — start session
  - POST /api/v1/studio/overrides — submit field override
  - GET /api/v1/studio/queue — approval queue
  - No promotion endpoint exists yet

### Frontend
- `useStorageLocations` hook — React Query, fetches from API, has getWinesInLocation(), assignWineToLocation()
- `StorageLocationManager` — modal with location list + edit form, shows "Stored Wines" from inventoryItems prop
- `useStudioSessionStore` — Zustand store with WineRecord type
- `WineRecordsTable` — renders Studio wine records with FieldCell per column
- `useWineLibraryPage` — fetches wines via useWines hook, maps with mapApiWinesToUiWines
- `mapApiWineToUiWine()` in `apps/web/src/lib/wine-library.ts` — converts API Wine → UI Wine

### Database
- `storage_locations` table: id, restaurant_id, name, description, parent_id, location_type, temperature, humidity, capacity, current_count, color, notes, deleted_at
- `wine_location_mappings` table: id, restaurant_id, wine_id, location_id, quantity, assigned_at, UNIQUE(restaurant_id, wine_id)
- `master_wine_library_submissions` table: has field_confidence JSONB, submission fields
- `master_wine_library` table: target for promoted wines

### Type gap (Studio WineRecord → Library Wine)
| Studio WineRecord field | Library API Wine field | Notes |
|------------------------|----------------------|-------|
| wine_name | name | rename |
| vintage | vintage | string → number parse |
| producer | producer | direct |
| region | region | direct |
| country | country | direct |
| grape_variety | grapeVariety | camelCase |
| color / primary_type | category | "red"/"white"/etc |
| price_bottle | price | string → number parse |
| price_glass | (menuPriceGlass) | extra field |
| sweetness_level | (no direct map) | stored in wine_structure |
| tasting_notes | tastingNotes | camelCase |
| description | description | direct |
