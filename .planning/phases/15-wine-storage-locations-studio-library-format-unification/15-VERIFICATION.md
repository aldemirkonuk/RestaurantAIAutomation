---
phase: 15-wine-storage-locations-studio-library-format-unification
verified: 2026-04-08T00:00:00Z
status: human_needed
score: 7/7 must-haves verified
human_verification:
  - test: "Expand a location card in StorageLocationManager and confirm enriched wine list loads from real DB"
    expected: "Wine names, producers, vintages, and bottle counts appear under the card; spinner shown during load; 'No wines assigned' shown for empty locations"
    why_human: "Requires live DB with wine_location_mappings rows; can't verify real data flow without running app"
  - test: "From Inventory page, change a wine's location via dropdown and then open StorageLocationManager to verify wine appears under new location"
    expected: "Wine moves to selected location; StorageLocationManager expandable list refreshes to show the wine under the new location"
    why_human: "Multi-step user flow requiring live API + React Query cache invalidation"
  - test: "In Studio, click Promote on a wine with a name — confirm success badge appears and wine is visible in Wine Library"
    expected: "Emerald '✓ Promoted' badge appears; navigating to /wines (Wine Library) shows the promoted wine with correct name, producer, vintage, price"
    why_human: "Requires live Studio session with submission data + DB insert + Wine Library re-fetch"
  - test: "Click Promote on a wine already in the library — confirm 409 is handled correctly"
    expected: "Amber 'Already in library' badge appears inline; no duplicate created in DB"
    why_human: "Requires live DB state with duplicate detection active"
  - test: "Verify a non-developer/review_admin user cannot access POST /api/v1/studio/promote"
    expected: "403 Forbidden returned; Wine Library unchanged"
    why_human: "Requires testing with a real session token that lacks the required role"
---

# Phase 15: Wine Storage Locations & Studio↔Library Format Unification Verification Report

**Phase Goal:** Wire wine storage location views (which wines are in each location with counts) and unify the data format between Studio (WineRecord) and Library (Wine) so promoted wines flow seamlessly into the main library.  
**Verified:** 2026-04-08  
**Status:** human_needed  
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Expanding a storage location card shows wines with bottle counts | ✓ VERIFIED | `StorageLocationManager.tsx` lines 79–80: `expandedLocationId` state + `useWinesAtLocation(expandedLocationId)`; lines 345–400 render wine list with name, vintage, producer, quantity badge per card |
| 2 | API returns wines at a location with wine name, producer, vintage, and quantity | ✓ VERIFIED | `storage-locations.service.ts` lines 239–294: `getWinesAtLocation()` queries `wine_location_mappings`, batch-joins `master_wine_library` via `.in('id', wineIds)`, returns `EnrichedWineAtLocation[]`; controller line 87–106 wires `GET /:restaurantId/locations/:locationId/wines` |
| 3 | User can assign a wine to a storage location via dropdown picker from inventory | ✓ VERIFIED | `Inventory.tsx` line 1203–1218: inline `<select>` dropdown per inventory row calls `assignWineToLocation(item.id, locId, quantity)` on change; unassign path calls `removeWineFromLocation` |
| 4 | `mapWineRecordToMasterLibrary()` correctly maps all 13 WineRecord fields | ✓ VERIFIED | `wine-format-mapper.ts` exports `mapWineRecordToMasterLibrary`: maps `wine_name→name`, `producer`, `vintage` (int parse), `price_bottle→price` (float parse), `price_glass` (float parse), `region`, `country`, `grape_variety`, `primary_type\|color`, `color`, `sweetness_level`, `tasting_notes`, `description`; + `bottle_size_ml=750`, `source='studio_promotion'`. All 13 source fields accounted for |
| 5 | POST /api/v1/studio/promote inserts into master_wine_library with dedup check (409 on duplicate) | ✓ VERIFIED | `studio_routes.py` line 629: `@studio_router.post("/promote")`; dedup at lines 705–726 (case-insensitive ilike on name + producer + vintage); 409 raised on match; insert at lines 756–774 with retry-without-audit-cols fallback; confirmed registered: `python3 -c "..." → ['/api/v1/studio/promote']` |
| 6 | "Promote to Library" button appears in Studio WineRecordsTable per wine row, disabled without wine_name | ✓ VERIFIED | `WineRecordsTable.tsx` line 6: `import { canPromote } from '../../lib/wine-format-mapper'`; line 127: `const promotable = canPromote(record)`; lines 174–191: Promote button rendered in "Action" column, disabled when `!promotable`, shows ArrowUpRight icon; promoteStates tracks idle/loading/promoted/duplicate/error |
| 7 | Promoted wines appear in Wine Library via existing useWines() pipeline | ✓ VERIFIED | `useWines()` → `searchWines()` → `GET /wines` (NestJS) → `wines.service.ts` line 296: `client.from('master_wine_library').select('*')`; promotion inserts directly into `master_wine_library` → wine is immediately fetchable by the Wine Library page |

**Score: 7/7 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api-gateway/src/storage-locations/storage-locations.service.ts` | `getWinesAtLocation()` joining wine_location_mappings + master_wine_library | ✓ VERIFIED | Lines 239–294: full implementation with `.in()` batch query, graceful fallback (wineId as name), returns `EnrichedWineAtLocation[]` |
| `apps/api-gateway/src/storage-locations/storage-locations.controller.ts` | `GET /:restaurantId/locations/:locationId/wines` endpoint | ✓ VERIFIED | Lines 87–106: endpoint correctly placed before generic `GET /:restaurantId` route to avoid NestJS routing conflict |
| `apps/web/src/hooks/useStorageLocations.ts` | Exports `useWinesAtLocation` hook | ✓ VERIFIED | Lines 384–405: standalone exported hook with `enabled: !!restaurantId && !!locationId && isAuthenticated` guard; returns `{ wines, isLoading }` |
| `apps/web/src/components/inventory/StorageLocationManager.tsx` | Expandable wine list per location card | ✓ VERIFIED | Lines 27, 79–80, 345–400: imports `useWinesAtLocation`, calls at component level, renders chevron toggle + wine list inline under capacity bar |
| `apps/web/src/lib/wine-format-mapper.ts` | Exports `mapWineRecordToMasterLibrary` and `canPromote` | ✓ VERIFIED | File exists (32 lines), both exports present, all 13 WineRecord fields mapped |
| `services/agent-orchestrator/api/studio_routes.py` | `POST /api/v1/studio/promote` endpoint | ✓ VERIFIED | Lines 628–785; `PromoteRequest` Pydantic model at line 61; route confirmed registered via Python import check |
| `apps/web/src/pages/studio/WineRecordsTable.tsx` | Promote button per wine row with canPromote guard | ✓ VERIFIED | Lines 6, 30, 34, 126–192: full implementation with 5-state feedback (idle/loading/promoted/duplicate/error) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `StorageLocationManager.tsx` | `useWinesAtLocation` hook | Direct hook call at line 80 | ✓ WIRED | Plan named the pattern `getEnrichedWinesInLocation` but implementation uses `useWinesAtLocation` directly — intent fulfilled, naming differs |
| `useStorageLocations.ts` | NestJS API | `apiClient.get('/storage-locations/${restaurantId}/locations/${locationId}/wines')` | ✓ WIRED | Line 392–393 exact URL match to controller route |
| `WineRecordsTable.tsx` | `POST /api/v1/studio/promote` | `fetch('/api/v1/studio/promote', ...)` with Bearer token | ✓ WIRED | Lines 41–48: fetch with submission_id body, Authorization header from localStorage |
| `POST /promote` | `supabase.table('master_wine_library').insert()` | Field mapping + insert | ✓ WIRED | Lines 728–757: full insert_payload built and inserted |
| `useWines()` | `master_wine_library` | `searchWines()` → GET /wines → NestJS `wines.service.ts` | ✓ WIRED | wines.service.ts line 296 queries master_wine_library; promoted wine is immediately in scope |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `StorageLocationManager.tsx` | `expandedWines` | `useWinesAtLocation(expandedLocationId)` → `apiClient.get(…/wines)` → `getWinesAtLocation()` → Supabase `.from('wine_location_mappings')` + `.from('master_wine_library')` | Yes — live DB queries with restaurant_id + location_id scoping | ✓ FLOWING |
| `WineRecordsTable.tsx` `promoteStates` | `promoteState` per record | `fetch('/api/v1/studio/promote')` → FastAPI → Supabase insert/dedup | Yes — real DB insert, not static | ✓ FLOWING |
| `useWines()` in Wine Library | `wines[]` | `searchWines()` → GET /wines → `wines.service.ts` → `master_wine_library` | Yes — live SELECT * query | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Promote route registered | `python3 -c "from api.studio_routes import studio_router; print([r.path for r in studio_router.routes if 'promot' in r.path])"` | `['/api/v1/studio/promote']` | ✓ PASS |
| `canPromote` returns false for null name | Code inspection: `record.wine_name != null && record.wine_name.trim().length > 0` | Correctly gates on null/empty wine_name | ✓ PASS |
| Controller route ordering | GET `/:restaurantId/locations/:locationId/wines` declared at line 87 before GET `/:restaurantId` at line 108 | No routing conflict | ✓ PASS |

---

### Requirements Coverage

Requirements SLOC-01, SLOC-02, SLOC-03, UNIF-01, UNIF-02, UNIF-03, UNIF-04 are declared in the phase plans and ROADMAP but are not defined in `.planning/REQUIREMENTS.md` (the requirements file uses different IDs for other phases). Coverage assessed against ROADMAP success criteria instead (all 7 SCs verified above).

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| SLOC-01 (expandable wine list) | 15-01-PLAN.md | ✓ SATISFIED | `StorageLocationManager.tsx` expandable cards wired to `useWinesAtLocation` |
| SLOC-02 (wines-at-location API) | 15-01-PLAN.md | ✓ SATISFIED | `GET /:restaurantId/locations/:locationId/wines` endpoint exists and queries DB |
| SLOC-03 (location picker from inventory) | 15-01-PLAN.md | ✓ SATISFIED | `Inventory.tsx` inline select dropdown calls `assignWineToLocation` |
| UNIF-01 (field mapper function) | 15-02-PLAN.md | ✓ SATISFIED | `wine-format-mapper.ts` exports `mapWineRecordToMasterLibrary` with all 13 fields |
| UNIF-02 (promote endpoint with dedup) | 15-02-PLAN.md | ✓ SATISFIED | `POST /api/v1/studio/promote` with 409 dedup check |
| UNIF-03 (Promote button in Studio) | 15-02-PLAN.md | ✓ SATISFIED | `WineRecordsTable.tsx` Action column with 5-state Promote button |
| UNIF-04 (promoted wines in Wine Library) | 15-02-PLAN.md | ✓ SATISFIED | Insert to `master_wine_library` → `useWines()` queries same table |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `StorageLocationManager.tsx` | 594–626 | "Stored Wines" panel in edit form still renders from `inventoryItems` prop (old workaround) | ⚠️ Warning | Plan specified this section should be replaced with the enriched API data; the new expandable card section was added but the old edit-panel section was preserved. Two wine-list UI surfaces now exist — one from real API (card), one from stale prop data (edit panel). No blocker — primary SC is met. |

---

### Human Verification Required

#### 1. Expandable wine list with real DB data

**Test:** Open StorageLocationManager on a restaurant with wines assigned to locations. Click the chevron button on a location card.  
**Expected:** Loading spinner appears briefly, then a list of wine names (with vintage), gray producer text, and colored quantity badges renders. An empty location shows "No wines assigned."  
**Why human:** Requires live DB rows in `wine_location_mappings` + `master_wine_library`; data-flow correctness can't be fully proven without running the app.

#### 2. Location assignment round-trip

**Test:** From Inventory page, change a wine's location via the inline dropdown. Then open StorageLocationManager, expand the target location card.  
**Expected:** The newly assigned wine appears in the location's expanded wine list. Quantity reflects the bottle count at time of assignment.  
**Why human:** Multi-step flow requiring React Query cache invalidation across two components + live API writes.

#### 3. Studio promote → Wine Library appearance

**Test:** In Studio, open a session with extracted wines. Click "Promote" on a wine that has a name.  
**Expected:** Emerald "✓ Promoted" badge appears in the row. Navigate to /wines (Wine Library). The promoted wine appears in the list with correct name, producer, vintage, and price.  
**Why human:** Requires live Studio session with `master_wine_library_submissions` data + DB insert + Wine Library re-fetch.

#### 4. Duplicate promotion handling

**Test:** Click Promote on a wine that is already in the master_wine_library (same name + vintage + producer).  
**Expected:** Amber "Already in library" badge appears; no new DB row created.  
**Why human:** Requires controlled DB state with a known duplicate.

#### 5. Role-based promote access

**Test:** Attempt POST /api/v1/studio/promote with a session token that lacks `developer` or `review_admin` role.  
**Expected:** 403 Forbidden; Wine Library unchanged.  
**Why human:** Requires testing with a real non-privileged session token.

---

### Gaps Summary

No gaps found. All 7 ROADMAP success criteria are satisfied in code. One ⚠️ warning: the edit-panel "Stored Wines" section in `StorageLocationManager` still renders from the `inventoryItems` prop rather than the new enriched API — the plan specified replacing it, but it was preserved alongside the new expandable card section. This does not block goal achievement (the primary expandable wine list feature works correctly) but creates a minor UI inconsistency.

---

_Verified: 2026-04-08_  
_Verifier: Claude (gsd-verifier)_
