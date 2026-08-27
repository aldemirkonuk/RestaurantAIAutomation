# Phase 15: Wine Storage Locations & Studio↔Library Format Unification — Context

## Part A: Storage Locations

### Existing infrastructure
- DB: `storage_locations` table (zone, capacity, parent_id, is_active)
- DB: `wine_location_mappings` table (wine_id, location_id, quantity)
- DB: `restaurant_inventory.storage_location_id` FK
- Hook: `apps/web/src/hooks/useStorageLocations.ts` — full CRUD via React Query
- Component: `apps/web/src/components/inventory/StorageLocationManager.tsx`

### What's missing
- Enriched API endpoint: GET wines at a specific location with names + counts
- Expandable location cards: click a location → see which wines are there
- Location picker: assign a wine to a location from the inventory view

## Part B: Studio ↔ Library Format Unification

### Two incompatible types
1. **WineRecord** (Studio): wine_name, vintage, producer, region, country, grape_variety, color, primary_type, sweetness_level, price_bottle, price_glass, tasting_notes, description + field_confidence
2. **Wine** (Library): name, producer, vintage, region, country, price, liveStock, shadowStock, threshold, menuPrice, bottleSizeMl, etc.

### What's missing
- Format mapping function: WineRecord → master_wine_library row → Wine
- "Promote to Library" action in Studio
- Backend endpoint: POST /studio/promote → insert into master_wine_library
- No bridge between these two data models

## Decisions
- D-01: Location display is read-only first (list wines + counts per location)
- D-02: Location assignment uses existing wine_location_mappings table
- D-03: Promotion endpoint writes to master_wine_library (existing table)
- D-04: Only developer/review_admin can promote (consistent with Studio auth)
- D-05: Format mapper is a shared TypeScript utility (not inline in components)
