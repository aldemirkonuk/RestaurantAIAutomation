# Phase 16: Wine → Storage Location Assignment & Auto-Locate Intelligence — Research

**Researched:** 2026-04-08  
**Domain:** Frontend React (inline picker, scoring engine, preview modal) + NestJS storage-locations service + React Query cache invalidation  
**Confidence:** HIGH — all findings are from direct file reads, not training knowledge

---

## Executive Summary

Phase 16 has two capabilities. **(A) Manual assignment** is already 90% implemented — the Location column exists, the inline picker exists, `assignWineToLocation` already fires to the API. The primary fix needed is **React Query cache invalidation**: when a wine is assigned, the `[WINES_AT_LOCATION_KEY, ...]` cache is never invalidated, so `StorageLocationManager` continues to show "No wines assigned."

**(B) Auto-Locate** is entirely new: a pure-frontend scoring engine that computes wine-to-location fitness, a preview modal, and a batch apply that calls the already-existing assignment infrastructure.

**Primary recommendation:** Fix cache invalidation for (A) in one targeted edit; build the scoring engine and preview modal for (B) as two new files (`autoLocateEngine.ts` + `AutoLocatePreviewModal.tsx`).

---

## Critical Findings — Answers to All Research Questions

### Q1: Does `assignWineToLocation` already call POST /mappings?

**YES.** [VERIFIED: direct file read `useStorageLocations.ts` lines 197-201]

```typescript
// useStorageLocations.ts line 197
persistToServer('POST', `/storage-locations/${restaurantId}/mappings`, {
  wineId,
  locationId,
  quantity,
})
```

`persistToServer` is fire-and-forget (`try/catch` swallows errors). The function is a plain `useCallback` — it is **not async** and returns `void`. Callers cannot `await` it.

**Critical gap:** `assignWineToLocation` calls `setMappings` (local cache) and `persistToServer` (API) but **never calls `queryClient.invalidateQueries`** for `[WINES_AT_LOCATION_KEY, ...]`. This is the root cause of "No wines assigned" in `StorageLocationManager`.

**Fix:** After the `persistToServer` call, add:
```typescript
queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
```

### Q2: What does the Inventory table look like? What is `InventoryItem`?

**Table structure:** [VERIFIED: `Inventory.tsx` line 1038]
- Standard HTML `<table>` with `<tr>/<td>` — NOT flexbox/grid
- `min-w-[1432px]`, `tableLayout: 'fixed'`, `overflow-x-auto` wrapper
- 16 columns: checkbox | Wine(300px) | Type(112px) | Format(112px) | **Location(128px)** | Live | Shadow | Total | Min | Purchased Price | Menu Price | Margin | Total Value | Status | Active | Actions(192px)
- **Location column ALREADY EXISTS** at column index 5 (`w-32`, MapPin icon header)

**InventoryItem type:** [VERIFIED: `useInventoryPage.ts` lines 7-20 + mapping at lines 116-131]

```typescript
interface InventoryItem extends Wine {
  inventoryId?: string         // inventory table row UUID
  storageLocation?: string     // name string, used for display
  location?: string            // alternate location name field
  liveStock?: number
  shadowStock?: number
  threshold: number
  lastCounted: string | null
  isActive: boolean
  lastManualAdjustment?: { timestamp: Date; managerName: string }
}
```

**Wine base type** (from `wineData.ts`):
```typescript
interface Wine {
  id: string          // ← master_wine_library UUID
  name: string
  producer: string
  vintage: number | null
  price: number
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  grape: string
  country: string
  region: string
  bottleSizeMl: number
  saleType?: 'bottle' | 'glass' | 'both'
  pourSizeMl?: number
  menuPrice?: number
  menuPriceGlass?: number
  // ...more
}
```

### Q3: What is `InventoryItem.id`? Is it the right value for `wine_location_mappings.wine_id`?

**`InventoryItem.id` IS the `master_wine_library` UUID.** [VERIFIED: `useInventoryPage.ts` line 119]

```typescript
return {
  ...fallback,
  inventoryId: item.id,    // ← inventory table row ID stored here
  id: item.wineId,         // ← item.id = wine's master library UUID
  // ...
}
```

The raw API `InventoryItem` (from `types.ts`) has:
- `id` = inventory row UUID
- `wineId` = master_wine_library UUID

After mapping in `useInventoryPage.ts`:
- `inventoryItem.id` = `wineId` (master library UUID) — **CORRECT** for `wine_location_mappings.wine_id`
- `inventoryItem.inventoryId` = original inventory row UUID

**Conclusion:** Passing `item.id` to `assignWineToLocation` is correct. The existing picker at lines 1206/1212 does this correctly.

### Q4: NestJS API URL base path

**Base URL:** `http://localhost:4000/api/v1` [VERIFIED: `services/api/client.ts` line 19]

```typescript
// client.ts
baseURL: `${API_GATEWAY_URL}/api/v1`,
```

The hook uses `apiClient.get('/storage-locations/${restaurantId}')` → resolves to `http://localhost:4000/api/v1/storage-locations/${restaurantId}`.

NestJS controller is `@Controller('storage-locations')` with no explicit prefix — the app-level global prefix is `/api/v1` (set in `main.ts`). **Confirmed working.**

### Q5: Does the DTO directory exist? Where are DTOs?

**Path:** `apps/api-gateway/src/storage-locations/dto/storage-locations.dto.ts` [VERIFIED: directory listing]

Directory contents:
```
apps/api-gateway/src/storage-locations/
├── dto/
│   └── storage-locations.dto.ts    ← AssignWineToLocationDto is here
├── storage-locations.controller.ts
├── storage-locations.module.ts
└── storage-locations.service.ts
```

### Q6: Does POST /mappings endpoint already exist?

**YES.** [VERIFIED: `storage-locations.controller.ts` lines 45-64]

```typescript
@Post(':restaurantId/mappings')
async assignWineToLocation(
  @Param('restaurantId') restaurantId: string,
  @Body() dto: AssignWineToLocationDto,
) {
  return await this.storageLocationsService.assignWineToLocation(restaurantId, dto);
}
```

**Full URL:** `POST /api/v1/storage-locations/:restaurantId/mappings`

**`AssignWineToLocationDto`** [VERIFIED: dto file]:
```typescript
class AssignWineToLocationDto {
  wineId: string        // @IsString() — NOT @IsUUID() — accepts any string ID
  locationId: string    // @IsUUID()
  quantity?: number     // @IsInt() @Min(1) @IsOptional()
}
```

### Q7: Wine ID — is it the right field? RESOLVED above.

`item.id` in `InventoryItem` = `master_wine_library` UUID. This matches what `wine_location_mappings.wine_id` expects, confirmed by the NestJS service query: `from('master_wine_library').select('id, wine_name, ...')`.

---

## Existing Infrastructure (What's Already Built)

### What Already Works

| Feature | Location | Status |
|---------|----------|--------|
| Location column in table | `Inventory.tsx` lines 1074-1247 | ✅ Exists |
| `editingLocationItemId` state | `Inventory.tsx` line 137 | ✅ Exists |
| Inline `<select>` picker on click | `Inventory.tsx` lines 1193-1246 | ✅ Exists |
| `assignWineToLocation` hook fn | `useStorageLocations.ts` lines 158-204 | ✅ Exists, calls API |
| POST /mappings endpoint | `storage-locations.controller.ts` line 45 | ✅ Exists |
| NestJS upsert service | `storage-locations.service.ts` lines 205-237 | ✅ Exists |
| `getWineLocation(wineId)` lookup | `useStorageLocations.ts` lines 142-149 | ✅ Exists |
| `removeWineFromLocation` | `useStorageLocations.ts` lines 206-223 | ✅ Exists |
| `mappings` query + cache | `useStorageLocations.ts` lines 82-95 | ✅ Exists |
| `useWinesAtLocation` hook | `useStorageLocations.ts` lines 384-405 | ✅ Exists |

### What's Broken / Missing

| Issue | Impact | Fix |
|-------|--------|-----|
| No cache invalidation after assign | "No wines assigned" in StorageLocationManager | Add `queryClient.invalidateQueries` call in `assignWineToLocation` |
| `selectedLocationFilter` in deps but not used in filter body | Location filter chip has no effect | Add location filter logic to `filteredInventory` useMemo |
| No batch assignment API | Auto-Locate needs N calls | Use existing single-assignment endpoint N times (acceptable) |
| No scoring engine | Auto-Locate feature | New file: `autoLocateEngine.ts` |
| No preview modal | Auto-Locate feature | New file: `AutoLocatePreviewModal.tsx` |
| No "Auto-Locate" trigger button | Auto-Locate entry point | Add button to Inventory toolbar |

---

## Standard Patterns (How This Codebase Works)

### React Query Pattern

**Query keys are module-level constants:**
```typescript
const LOCATIONS_KEY = 'storageLocations'
const MAPPINGS_KEY = 'storageLocationMappings'
const WINES_AT_LOCATION_KEY = 'winesAtLocation'  // line 382
```

**Invalidation pattern:**
```typescript
queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY, restaurantId] })
```

**Optimistic update pattern (used in setMappings/setLocations):**
```typescript
queryClient.setQueryData<WineLocationMapping[]>(
  [MAPPINGS_KEY, restaurantId],
  (old) => { ... }
)
```

### API Client Pattern

All hooks use the shared `apiClient` from `services/api/client.ts`:
```typescript
import { apiClient } from '../services/api/client'
// GET: apiClient.get('/storage-locations/{restaurantId}')
// POST: apiClient.request({ method: 'POST', url: '...', data: body })
```

The `persistToServer` helper in `useStorageLocations` wraps `apiClient.request` with silent error swallowing.

### NestJS Supabase Pattern

**Client injection:** [VERIFIED: `storage-locations.service.ts` line 79]
```typescript
const client = this.dbService.supabase;  // NOT a property accessor pattern
```

`DatabaseService` is injected via constructor: `constructor(private readonly dbService: DatabaseService) {}`

**Upsert pattern for `wine_location_mappings`:**
```typescript
await client
  .from('wine_location_mappings')
  .upsert(
    { restaurant_id, wine_id, location_id, quantity, assigned_at },
    { onConflict: 'restaurant_id,wine_id' }
  )
  .select('*')
  .single();
```

**Critical:** The unique constraint is on `(restaurant_id, wine_id)` — each wine can only be assigned to ONE location at a time. Reassigning automatically moves it (upsert replaces).

### Auth Pattern

```typescript
const { activeRestaurantId, isAuthenticated } = useAuth()
```

`activeRestaurantId` is the restaurant UUID string (or null before auth loads). Always guard with `!!restaurantId && isAuthenticated`.

---

## Integration Points (Exact Files and Lines)

### Part A — Fix Cache Invalidation

**File:** `apps/web/src/hooks/useStorageLocations.ts`
- **Line 197:** After `persistToServer(...)` call in `assignWineToLocation`, add:
  ```typescript
  queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
  ```
- `queryClient` is already in scope (line 61)
- `WINES_AT_LOCATION_KEY` is at line 382 — move it above `useStorageLocations` or import it (it's module-level)

**Wait:** `WINES_AT_LOCATION_KEY` is declared AFTER `useStorageLocations` at line 382. Move the constant declaration to before the first hook that needs it, or use the string literal `'winesAtLocation'` inline (safe since it's in the same file).

### Part A — Fix Location Filter

**File:** `apps/web/src/pages/inventory/useInventoryPage.ts`
- **Lines 136-234:** The `filteredInventory` useMemo includes `selectedLocationFilter` in deps (line 234) but never uses it. Fix: after the bottle size filter block, add:
  ```typescript
  if (selectedLocationFilter) {
    // Filter: only show wines assigned to this location
    // Need to cross-reference with storage mappings
  }
  ```
  **BUT:** `useInventoryPage` doesn't have access to `mappings` from `useStorageLocations`. Options:
  - (a) Pass `selectedLocationFilter` and `getWineLocation` down from Inventory.tsx (which already has both)
  - (b) Move the filter into `Inventory.tsx` where `getWineLocation` is available
  - **Recommended:** Filter in `Inventory.tsx` by wrapping `filteredInventory` with location filter using `getWineLocation(item.id)?.id === selectedLocationFilter`

### Part B — Auto-Locate Engine

**New file:** `apps/web/src/lib/autoLocateEngine.ts`

Scoring inputs available on `InventoryItem`:
- `item.type`: `'red' | 'white' | 'sparkling' | 'rose' | 'dessert'`
- `item.liveStock`, `item.shadowStock`: current quantities
- `item.price`: for premium/accessibility scoring (expensive = more accessible location)

Scoring inputs available on `StorageLocation`:
- `loc.temperature`: string like `"55°F"` or `"13°C"` (may be empty string)
- `loc.humidity`: string like `"70%"` (may be empty string)
- `loc.capacity`: number
- `loc.currentCount`: number (USE `getLocationsWithActualCounts()` for accurate counts)
- `loc.name`: for accessibility heuristic (e.g., "Bar Stock" = accessible)
- `loc.color`, `loc.description`: additional metadata

Temperature parsing note: values like `"55°F"`, `"58°F"`, `"53°F"` appear in defaults. Need to parse out numeric values from strings.

### Part B — Preview Modal Trigger

**File:** `apps/web/src/pages/Inventory.tsx`

Add to toolbar (after existing buttons, around line 939):
```tsx
<button
  onClick={() => setShowAutoLocateModal(true)}
  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
>
  <Zap className="w-4 h-4" />
  Auto-Locate
</button>
```

`Zap` icon is already imported (line 33).

**New state:** `const [showAutoLocateModal, setShowAutoLocateModal] = useState(false)`

### Part B — Batch Assignment

After user confirms in preview modal:
```typescript
// In Inventory.tsx, loop over plan:
for (const assignment of plan) {
  assignWineToLocation(assignment.wineId, assignment.locationId, assignment.quantity)
}
// Then invalidate after all:
queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
```

`assignWineToLocation` is synchronous (optimistic update + fire-and-forget API call). No batch endpoint needed.

---

## Gaps — What Needs to Be Built vs Extended

### Extend Existing Code
| File | Change | Size |
|------|--------|------|
| `useStorageLocations.ts` | Add `queryClient.invalidateQueries` after assign/remove | ~3 lines |
| `Inventory.tsx` | Add Auto-Locate button + modal state + confirm handler | ~30 lines |
| `useInventoryPage.ts` (optional) | Wire `selectedLocationFilter` into filter logic OR handle in Inventory.tsx | ~10 lines |

### Build From Scratch
| File | What | Size |
|------|------|------|
| `apps/web/src/lib/autoLocateEngine.ts` | Pure scoring engine | ~150 lines |
| `apps/web/src/components/inventory/AutoLocatePreviewModal.tsx` | Preview + confirm modal | ~200 lines |

---

## Common Pitfalls

### Pitfall 1: `WINES_AT_LOCATION_KEY` Scope
**What goes wrong:** `WINES_AT_LOCATION_KEY` is declared at line 382 — AFTER `useStorageLocations` ends. Adding `queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, ...] })` inside `useStorageLocations` (line 200) will fail with "cannot access before initialization."
**Fix:** Move `const WINES_AT_LOCATION_KEY = 'winesAtLocation'` to be declared before `useStorageLocations` (near line 56 where other keys are declared), or use the string literal inline.

### Pitfall 2: Location Counts — Use `getLocationsWithActualCounts()`
**What goes wrong:** `StorageLocation.currentCount` is server-managed and may lag behind optimistic updates. For capacity scoring in the Auto-Locate engine, using stale `currentCount` leads to over-allocation.
**Fix:** Always use `getLocationsWithActualCounts()` which recalculates from the in-memory `mappings` array. This function is already exported from `useStorageLocations`.

### Pitfall 3: Temperature String Parsing
**What goes wrong:** `StorageLocation.temperature` is a free-text string: `"55°F"`, `"13°C"`, `""`, `undefined`. Treating it as a number crashes.
**Fix:** In `autoLocateEngine.ts`, parse with a helper:
```typescript
function parseTempF(s: string | undefined): number | null {
  if (!s) return null
  const celsius = s.match(/(\d+(?:\.\d+)?)\s*°C/)
  if (celsius) return parseFloat(celsius[1]) * 9/5 + 32
  const fahrenheit = s.match(/(\d+(?:\.\d+)?)\s*°F/)
  if (fahrenheit) return parseFloat(fahrenheit[1])
  return null
}
```

### Pitfall 4: Auto-Locate Skips Already-Assigned Wines
**What goes wrong:** Running Auto-Locate on wines that already have locations would reassign them, breaking intentional manual assignments.
**Fix:** In the scoring engine, accept a `mappings: WineLocationMapping[]` parameter and skip wines that already have a mapping. Alternatively, offer "include already-assigned" as an option in the modal.

### Pitfall 5: Capacity Overflow
**What goes wrong:** If 50 wines all score highest for one location but that location only has capacity for 10, all 50 get assigned there anyway.
**Fix:** In the engine, sort wines by score descending, then assign greedily tracking running totals per location. Stop assigning to a location once `assignedCount >= availableCapacity`.

### Pitfall 6: `filteredInventory` vs `inventory` in Inventory.tsx
**What goes wrong:** The table renders `filteredInventory` (from hook, line 1144). The hook's `inventory` is derived from `apiInventory` without `localOverrides`. However, `getWineLocation(item.id)` pulls from the `mappings` cache — which IS optimistically updated. So the picker display is correct. The `storageLocation` field on the item may lag (it's only updated in `localOverrides`), but `getWineLocation(item.id)?.name` is the source of truth for display.
**Don't add complexity** — the existing pattern of `item.storageLocation || getWineLocation(item.id)?.name` already handles this.

### Pitfall 7: Auto-Locate Requires `queryClient` in Inventory.tsx
**What goes wrong:** Inventory.tsx doesn't currently import `useQueryClient`.
**Fix:** Add `import { useQueryClient } from '@tanstack/react-query'` and `const queryClient = useQueryClient()` at the top of `Inventory` function, then call invalidate after batch assignment.

---

## Implementation Checklist (Ordered for Executor)

### Wave 1 — Fix Existing Bugs (no new files)

1. **`useStorageLocations.ts`**: Move `WINES_AT_LOCATION_KEY` const to top of file (near line 56). Then in `assignWineToLocation` after `persistToServer(...)`, add cache invalidation for both `MAPPINGS_KEY` and `WINES_AT_LOCATION_KEY`. Do the same in `removeWineFromLocation`.

2. **`useInventoryPage.ts`**: Add `getWineLocation?: (wineId: string) => any` as hook parameter OR export `selectedLocationFilter` logic for Inventory.tsx to apply post-filtering. Simplest: export selectedLocationFilter from hook and apply filter in Inventory.tsx using `getWineLocation`.

3. **`Inventory.tsx`**: Apply location filter to rows displayed — wrap `filteredInventory` with a local `displayedInventory` that filters by `getWineLocation(item.id)?.id === selectedLocationFilter` when a filter is active.

### Wave 2 — Auto-Locate Engine

4. **Create `apps/web/src/lib/autoLocateEngine.ts`**:
   - Export `WineLocationScore { wineId: string; wineName: string; locationId: string; locationName: string; score: number; reasons: string[] }`
   - Export `computeAutoLocatePlan(wines: InventoryItem[], locations: StorageLocation[], mappings: WineLocationMapping[], options?: { skipAssigned: boolean }): WineLocationScore[]`
   - Scoring algorithm:
     - Temperature match: +40pts if wine type temp preference matches location temp
     - Wine type grouping: +30pts if location already has same wine type or name suggests type
     - Capacity: +20pts proportional to available space (cap availability score 0-20)
     - Accessibility: +10pts for "Bar Stock" / "bar" locations for by-glass wines
   - Greedy capacity-aware allocation

5. **Create `apps/web/src/components/inventory/AutoLocatePreviewModal.tsx`**:
   - Props: `isOpen, onClose, plan: WineLocationScore[], locations: StorageLocation[], onConfirm: (plan: WineLocationScore[]) => void`
   - Shows table: wine name | assigned location | score | reasons
   - Summary stats: X wines assigned, X locations utilized, X skipped (no valid location)
   - "Confirm All" button and optional per-row toggle
   - Framer Motion animation (same pattern as existing modals)

### Wave 3 — Wire Auto-Locate into Inventory.tsx

6. **`Inventory.tsx`**:
   - Import `autoLocateEngine`, `AutoLocatePreviewModal`
   - Add `useQueryClient` hook
   - Add `showAutoLocateModal` state
   - Add "Auto-Locate" button in toolbar (Zap icon, emerald color)
   - Add `handleAutoLocate` that computes plan from `mergedInventory + locations + mappings`
   - Add `handleConfirmAutoLocate(plan)` that loops `assignWineToLocation` + invalidates cache
   - Render `<AutoLocatePreviewModal>`

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely frontend TypeScript changes + existing NestJS endpoint usage. No new external dependencies required.

---

## Sources

### Primary (HIGH confidence) — all VERIFIED via direct file reads
- `apps/web/src/hooks/useStorageLocations.ts` — full hook implementation, query keys, assign logic
- `apps/web/src/pages/Inventory.tsx` — table structure, existing location picker, imports
- `apps/web/src/pages/inventory/useInventoryPage.ts` — InventoryItem mapping, id field source
- `apps/web/src/data/wineData.ts` — Wine base type fields
- `apps/api-gateway/src/storage-locations/storage-locations.service.ts` — upsert pattern, Supabase client
- `apps/api-gateway/src/storage-locations/storage-locations.controller.ts` — existing endpoints
- `apps/api-gateway/src/storage-locations/dto/storage-locations.dto.ts` — AssignWineToLocationDto
- `apps/web/src/services/api/client.ts` — base URL `/api/v1`, auth headers
- `apps/web/src/contexts/AuthContext.tsx` — `activeRestaurantId`, `isAuthenticated`
- `apps/web/src/services/api/types.ts` — raw InventoryItem from API

---

## Assumptions Log

*All claims in this research were verified by direct file reads. No assumed claims.*

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | All claims verified | — | — |

---

## Metadata

**Confidence breakdown:**
- Existing infrastructure: HIGH — all files directly read
- Integration points: HIGH — exact line numbers cited
- Auto-Locate scoring design: MEDIUM — scoring factors chosen based on available data fields; actual scoring weights are design decisions for executor
- NestJS Supabase upsert constraint: HIGH — confirmed `onConflict: 'restaurant_id,wine_id'`

**Research date:** 2026-04-08  
**Valid until:** 2026-05-08 (stable architecture, unlikely to change)
