---
phase: 16-auto-locate-wines-storage-intelligence
verified: 2026-04-08T00:00:00Z
status: human_needed
score: 10/10 ROADMAP success criteria code-verified; 28/28 plan must-have truths code-verified
human_verification:
  - test: "Open Inventory, assign a wine to a location, then expand that location in StorageLocationManager — confirm the wine appears immediately without a page refresh"
    expected: "Assigned wine appears in StorageLocationManager's wine list within ~1s (React Query invalidation triggers refetch)"
    why_human: "Cache invalidation chain (invalidateQueries → useWinesAtLocation refetch → StorageLocationManager re-render) requires live browser + API to verify the full round-trip"
  - test: "Open Inventory, click a location chip in the filter toolbar, confirm only wines assigned to that location appear in the table rows"
    expected: "Table rows filter to only wines whose getWineLocation(item.id)?.id matches the selected chip; unassigned wines disappear"
    why_human: "displayedInventory filter is code-correct but real filter-chip interaction (selectedLocationFilter state change → useMemo recompute → row count) must be exercised in the browser"
  - test: "In Inventory table, find a wine with no location assigned — confirm it shows a dashed 'Assign location' placeholder. Find a wine with a location assigned — confirm it shows a colored pill badge with a dot matching the location color"
    expected: "Unassigned: dashed border, MapPin icon, 'Assign location' text. Assigned: rounded-full white pill, colored dot (style={{ backgroundColor: location.color }}), location name, ChevronDown icon"
    why_human: "Visual rendering of Tailwind classes requires browser render — cannot verify color contrast, truncation, or responsive layout programmatically"
  - test: "Click the pill badge or placeholder for a wine. Confirm a dropdown appears listing all storage locations with {currentCount}/{capacity}. Confirm any location at full capacity shows a red 'Full' badge and cannot be clicked"
    expected: "Dropdown opens below the trigger; all locations listed; full locations have opacity-50 cursor-not-allowed styling and are disabled"
    why_human: "Dropdown positioning (absolute top-full left-0 z-50), capacity display, and disabled state interaction must be verified in browser"
  - test: "Click 'Auto-Locate' button (Zap icon, emerald) in the Inventory toolbar. Confirm the AutoLocatePreviewModal opens with: summary stats (N wines to assign, M locations utilized, K skipped), a table of proposed assignments with per-row checkboxes, location override dropdowns, score badges, and reasons"
    expected: "Modal renders with framer-motion animation; table has rows for each unassigned wine; score badges are color-coded (green ≥70pts, amber ≥40pts, gray <40pts)"
    why_human: "Full E2E flow (button click → computeAutoLocatePlan → modal open → table render) and framer-motion animation require browser execution"
  - test: "In the Auto-Locate modal, check 'Include already-assigned wines (will reassign them)' toggle. Confirm the table updates to include previously-assigned wines"
    expected: "onToggleIncludeAssigned fires, computeAutoLocatePlan is re-called with skipAssigned: false, modal rows update"
    why_human: "State change + plan recompute + modal re-render requires browser interaction to verify"
  - test: "In the Auto-Locate modal, deselect some wines using per-row checkboxes, then click 'Confirm Selected (N)'. Confirm only selected wines get assigned. Confirm StorageLocationManager updates."
    expected: "handleConfirmAutoLocate receives only checked rows; each wine gets a location pill in Inventory; StorageLocationManager wine lists refresh"
    why_human: "Batch assignment loop + cache invalidation + cross-component update requires live app interaction"
---

# Phase 16: Auto-Locate Wines & Storage Intelligence — Verification Report

**Phase Goal:** Manual wine→location assignment picker in Inventory table + intelligent Auto-Locate engine: scores each wine against each storage location using temperature matching, wine type grouping, capacity constraints, and accessibility optimization; preview modal before committing; populates wine_location_mappings automatically.
**Verified:** 2026-04-08
**Status:** HUMAN_NEEDED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Assigning a wine updates StorageLocationManager immediately (no stale "No wines assigned" state) | ✓ VERIFIED | `assignWineToLocation` calls `queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })` at line 203 of `useStorageLocations.ts`; `removeWineFromLocation` same at line 224 |
| 2 | Location filter chip in Inventory toolbar filters table rows to only wines in that location | ✓ VERIFIED | `displayedInventory` useMemo at `Inventory.tsx:107–112` filters `filteredInventory` via `getWineLocation(item.id)?.id === selectedLocationFilter`; table renders `displayedInventory.map` at line 1192; `filteredInventory.map` grep returns 0 |
| 3 | Inventory Location column shows LocationPickerCell pill badge (assigned) or dashed placeholder (unassigned) | ✓ VERIFIED | `<LocationPickerCell>` rendered at `Inventory.tsx:1241`; `LocationPickerCell.tsx` implements pill (lines 60–70) and dashed placeholder (lines 72–79) |
| 4 | LocationPickerCell dropdown shows all locations with {used}/{capacity} counts; full locations disabled | ✓ VERIFIED | `LocationPickerCell.tsx` lines 83–118: each location renders `{loc.currentCount}/{loc.capacity}`; `isFull(loc)` guard disables + shows "Full" badge; `disabled` attribute set |
| 5 | Auto-Locate button (Zap icon, emerald) in toolbar computes scoring plan from all inventory wines | ✓ VERIFIED | `Inventory.tsx:969–977` has emerald button with `<Zap>` icon; `handleAutoLocate` at lines 641–650 calls `computeAutoLocatePlan(mergedInventory, ...)` |
| 6 | computeAutoLocatePlan returns capacity-aware greedy assignments with 4-signal composite scores | ✓ VERIFIED | `autoLocateEngine.ts` implements all 4 signals (temp +40, type +30/+15, capacity +20, accessibility +10); `runningCount` tracker prevents over-allocation; sorts descending by score |
| 7 | AutoLocatePreviewModal shows per-row checkbox, location override, score badge, reasons, summary stats | ✓ VERIFIED | `AutoLocatePreviewModal.tsx`: per-row checkbox (line 175), location `<select>` (line 195), score badge (lines 211–220), reasons column (line 226), header stats (lines 96–107) |
| 8 | "Include already-assigned wines" toggle re-computes the plan | ✓ VERIFIED | `Inventory.tsx:1750–1758`: `onToggleIncludeAssigned` calls `computeAutoLocatePlan(..., { skipAssigned: !val })` and updates `autoLocateResult` |
| 9 | Confirming batch-assigns all selected wines and invalidates cache | ✓ VERIFIED | `handleConfirmAutoLocate` (lines 652–660): for-of loop over selected assignments calling `assignWineToLocation`; then `queryClient.invalidateQueries` for both `winesAtLocation` and `storageLocationMappings` keys |
| 10 | salesVelocity placeholder in WineInput type with commented scoring block ready for future wiring | ✓ VERIFIED | `autoLocateEngine.ts:5`: `salesVelocity?: number` in `WineInput`; commented block at lines 126–130 with `// FUTURE: sales velocity signal` comment |

**Score: 10/10 ROADMAP success criteria code-verified**

---

### Plan-Level Must-Have Truths Summary

All 28 must-have truths across all 5 plans code-verified:

| Plan | Truths | Status |
|------|--------|--------|
| 16-01 (Cache + Filter) | 3/3 | ✓ ALL VERIFIED |
| 16-02 (LocationPickerCell component) | 7/7 | ✓ ALL VERIFIED |
| 16-03 (Wire LocationPickerCell) | 3/3 | ✓ ALL VERIFIED |
| 16-04 (Engine + Modal) | 10/10 | ✓ ALL VERIFIED |
| 16-05 (Auto-Locate wiring) | 5/5 | ✓ ALL VERIFIED |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/hooks/useStorageLocations.ts` | Cache invalidation after assign/remove | ✓ VERIFIED | `WINES_AT_LOCATION_KEY` at line 58 (before hook); 4× `invalidateQueries` calls (2 in `assignWineToLocation`, 2 in `removeWineFromLocation`) |
| `apps/web/src/pages/Inventory.tsx` | `displayedInventory` filter + LocationPickerCell + Auto-Locate | ✓ VERIFIED | `displayedInventory` at lines 107–112; `<LocationPickerCell>` at line 1241; Auto-Locate button at lines 969–977; `<AutoLocatePreviewModal>` at line 1744 |
| `apps/web/src/components/inventory/LocationPickerCell.tsx` | Pill badge + styled dropdown picker | ✓ VERIFIED | Exports `LocationPickerCell`; all 4 render states implemented (pill, placeholder, loading, dropdown); `isFull` guard; click-outside handler |
| `apps/web/src/lib/autoLocateEngine.ts` | Pure scoring engine with composite 100pt algorithm | ✓ VERIFIED | Exports `computeAutoLocatePlan`, `WineLocationScore`, `AutoLocateOptions`, `AutoLocateResult`; all 4 signals; greedy capacity-aware; `parseTempF` |
| `apps/web/src/components/inventory/AutoLocatePreviewModal.tsx` | Preview + confirm modal with per-row controls | ✓ VERIFIED | Exports `AutoLocatePreviewModal`; summary stats; per-row checkbox + location dropdown + score badge + reasons; confirm/cancel footer |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `assignWineToLocation` | `WINES_AT_LOCATION_KEY` query cache | `queryClient.invalidateQueries` | ✓ WIRED | `useStorageLocations.ts:203` |
| `removeWineFromLocation` | `WINES_AT_LOCATION_KEY` query cache | `queryClient.invalidateQueries` | ✓ WIRED | `useStorageLocations.ts:224` |
| `Inventory.tsx` table render | `displayedInventory` | `useMemo` + `selectedLocationFilter` | ✓ WIRED | `filteredInventory.map` is gone; `displayedInventory.map` at line 1192; also used by select-all (line 1092) and export (line 586) |
| `Inventory.tsx` Location `<td>` | `LocationPickerCell` component | `import` + JSX render | ✓ WIRED | Import at line 40; `<LocationPickerCell>` at line 1241 with all required props |
| `LocationPickerCell` | `assignWineToLocation` / `removeWineFromLocation` | Props `onAssign` / `onRemove` from parent | ✓ WIRED | `Inventory.tsx:1246–1259` passes pre-bound callbacks |
| `AutoLocatePreviewModal` | `computeAutoLocatePlan` output | `result` prop (`WineLocationScore[]`) | ✓ WIRED | `WineLocationScore` imported and used throughout modal; `result.assignments` → `rows` state |
| `parseTempF` | `loc.temperature` string | regex match for °F / °C | ✓ WIRED | `autoLocateEngine.ts:29–36`; called at line 92; handles °F, °C, empty, undefined |
| `handleAutoLocate` | `computeAutoLocatePlan` | `onClick` handler in Inventory | ✓ WIRED | `Inventory.tsx:641–650`; `useCallback` with `[mergedInventory, storageLocations, mappings, includeAssigned]` |
| `handleConfirmAutoLocate` | `assignWineToLocation` (loop) | `for...of` over `selected` array | ✓ WIRED | `Inventory.tsx:652–660`; loops and invalidates after batch |
| `handleConfirmAutoLocate` | `queryClient.invalidateQueries` | After batch loop | ✓ WIRED | Lines 656–657: invalidates `winesAtLocation` AND `storageLocationMappings` scoped to `activeRestaurantId` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `LocationPickerCell` | `currentLocation` | `getWineLocation(item.id)` → `mappings` React Query (live API: `/storage-locations/:id/mappings`) | Yes — React Query cache backed by real API | ✓ FLOWING |
| `LocationPickerCell` | `locations` | `storageLocations` from `useStorageLocations` → `locationsQuery` (live API: `/storage-locations/:id`) | Yes — real API query with `placeholderData: DEFAULT_LOCATIONS` fallback | ✓ FLOWING |
| `displayedInventory` | filtered rows | `filteredInventory` → `useInventoryPage` → live `inventory` query | Yes — real inventory data from API | ✓ FLOWING |
| `AutoLocatePreviewModal` `rows` | `result.assignments` | `computeAutoLocatePlan(mergedInventory, storageLocations, mappings)` — all 3 args are live query data | Yes — pure computation over real API-backed data | ✓ FLOWING |
| `handleConfirmAutoLocate` | `selected: WineLocationScore[]` | Modal's `rows.filter(r => checked[r.wineId])` — user-filtered subset of engine plan | Yes — feeds into real `assignWineToLocation` calls which hit the API | ✓ FLOWING |

---

## Behavioral Spot-Checks

Step 7b: Partially applicable — the engine is pure TypeScript (no server dependency).

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `parseTempF("55°F")` returns 55 | Code trace: `fahrenheit.match` captures "55", `parseFloat("55")` = 55 | 55 | ✓ PASS |
| `parseTempF("13°C")` returns 55.4 | Code trace: `celsius.match` captures "13", `13 * 9/5 + 32` = 55.4 | 55.4 | ✓ PASS |
| `parseTempF("")` returns null | Code trace: `if (!s) return null` — empty string is falsy | null | ✓ PASS |
| `parseTempF(undefined)` returns null | Code trace: `if (!s) return null` — undefined is falsy | null | ✓ PASS |
| Full location skipped in greedy allocation | Code trace: `if (available <= 0) continue` — runningCount blocks over-full locations | skipped | ✓ PASS |
| `skipAssigned = true` excludes wines with existing mapping | Code trace: `candidates = wines.filter(w => !assignedWineIds.has(w.id))` | filtered | ✓ PASS |
| Score badge: score=75 → emerald class | Code trace: `row.score >= 70` → `'bg-emerald-100 text-emerald-700'` | emerald | ✓ PASS |
| Score badge: score=45 → amber class | Code trace: `row.score >= 40` (and < 70) → `'bg-amber-100 text-amber-700'` | amber | ✓ PASS |

---

## Requirements Coverage

### Declared Requirement IDs

All 5 plans reference ALOC requirement IDs:

| Requirement ID | Referenced In | Description | Status |
|----------------|--------------|-------------|--------|
| ALOC-01 | 16-02-PLAN, 16-03-PLAN | LocationPickerCell manual assignment UI | ✓ SATISFIED — `LocationPickerCell.tsx` created and wired into Inventory table |
| ALOC-02 | 16-01-PLAN | Cache invalidation after assign/remove | ✓ SATISFIED — `queryClient.invalidateQueries` added to both `assignWineToLocation` and `removeWineFromLocation` |
| ALOC-03 | 16-01-PLAN | Location filter chip filters Inventory table | ✓ SATISFIED — `displayedInventory` useMemo applies `selectedLocationFilter` correctly |
| ALOC-04 | 16-04-PLAN | computeAutoLocatePlan scoring engine | ✓ SATISFIED — pure TypeScript engine with 4-signal 100pt algorithm |
| ALOC-05 | 16-04-PLAN | Temperature scoring / parseTempF | ✓ SATISFIED — parseTempF handles °F, °C, empty, undefined |
| ALOC-06 | 16-04-PLAN | Capacity-aware greedy allocation | ✓ SATISFIED — runningCount tracker; skips full locations |
| ALOC-07 | 16-05-PLAN | Auto-Locate button + modal wiring in Inventory.tsx | ✓ SATISFIED — Zap button, handleAutoLocate, AutoLocatePreviewModal, handleConfirmAutoLocate all wired |
| ALOC-08 | 16-04-PLAN | Preview modal with per-row controls | ✓ SATISFIED — checkbox, location override dropdown, score badge, reasons, summary stats all implemented |

### ⚠️ ORPHANED Requirement IDs

**ALOC-01 through ALOC-08 are NOT defined in `.planning/REQUIREMENTS.md`.**

The existing `REQUIREMENTS.md` covers only the AI wine extraction pipeline (CLVS, GMFL, YOLO, HAIKU, COST, QUAL, IMGX prefixes). The restaurant operations subsystem (storage, inventory, auto-locate) has no corresponding requirements section.

This means the ALOC IDs are declared in ROADMAP.md and plan frontmatter but have no formal backing definitions. All 8 IDs are implementationally satisfied based on ROADMAP success criteria and plan must-haves, but they cannot be formally cross-referenced against REQUIREMENTS.md.

**Impact:** Documentation gap — does not affect code correctness or feature completeness. Recommend adding an `## Auto-Locate & Storage Intelligence` section to REQUIREMENTS.md in a future housekeeping pass.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `LocationPickerCell.tsx` | 39–42 | `setIsLoading(true)` immediately followed by `setIsLoading(false)` (synchronous fire-and-forget) | ℹ️ Info | The loading spinner will never visibly render because both state updates are batched by React. By design per PLAN-02: "optimistic update makes the UI feel instant." The `Loader2` animation is effectively dead code until `onAssign` becomes async. Not a bug — an intentional trade-off. |
| `Inventory.tsx` | 165–181 | `fetch('http://127.0.0.1:7243/ingest/...')` debug instrumentation in `handleInventoryUpdate` | ⚠️ Warning | Hard-coded debug agent endpoint in production event handler. Will fail silently (no-op) in production where port 7243 is unavailable — no user impact. Should be removed before public release. Pre-existing artifact from debugging session, not introduced by Phase 16. |

---

### Stale Duplicate ROADMAP Entry

**ROADMAP.md contains two Phase 16 sections:**

- **Active definition (lines 29–51):** "Auto-Locate Wines & Storage Intelligence" — 5 plans, 10 success criteria, client-side pure engine approach. This is what was implemented.
- **Stale duplicate (lines 589–606):** "Wine → Storage Location Assignment & Auto-Locate Intelligence" — 2 plans (old), 8 success criteria including a now-superseded SC4: `POST /storage-locations/:restaurantId/auto-locate` backend endpoint. This backend endpoint was intentionally dropped in favor of the pure client-side engine (per 16-CONTEXT.md).

**Impact:** The stale entry's SC4 (backend `/auto-locate` endpoint) was NOT implemented — this was an intentional architectural decision locked in CONTEXT.md before planning. It is NOT a gap. The stale section should be cleaned up.

---

## Human Verification Required

### 1. StorageLocationManager Real-Time Refresh

**Test:** Open the Inventory page. Click a `<LocationPickerCell>` and assign a wine to a location. Immediately open StorageLocationManager (storage icon in Inventory toolbar) and expand the location you just assigned to.
**Expected:** The wine appears in the location's wine list without a page reload. The wine count in the location card increments.
**Why human:** The `queryClient.invalidateQueries` call at `useStorageLocations.ts:203` triggers a background refetch of `useWinesAtLocation`. The full round-trip (invalidate → refetch → StorageLocationManager re-render) requires a live browser with API connectivity.

---

### 2. Location Filter Chip Behavior

**Test:** In the Inventory toolbar, click one of the location chips (colored location filter buttons). Observe the table.
**Expected:** Table rows immediately filter to show only wines whose assigned location matches the selected chip. The row count visible matches wines in that location.
**Why human:** The `displayedInventory` useMemo re-evaluates on `selectedLocationFilter` change. The chip click triggering `setSelectedLocationFilter` → state change → memo recompute chain requires browser interaction.

---

### 3. LocationPickerCell Visual Rendering

**Test:** Open Inventory table. Find a wine with no location (should show placeholder) and a wine with a location assigned (should show pill badge). Click each to open the dropdown.
**Expected:** Unassigned wine: dashed border, MapPin icon, "Assign location" text. Assigned wine: rounded-full white pill with colored dot (matching StorageLocation.color), location name, ChevronDown arrow. Dropdown shows all locations with {currentCount}/{capacity}, with "Full" badge + opacity-50 on full locations.
**Why human:** Visual correctness of Tailwind classes, color rendering, truncation behavior, dropdown z-index, and shadow appearance require browser render.

---

### 4. Auto-Locate Full End-to-End Flow

**Test:** Click "Auto-Locate" button. Verify modal opens with framer-motion animation. Observe summary stats. Deselect 1-2 wines via checkboxes. Change a proposed location via the dropdown. Check "Include already-assigned wines" toggle. Click "Confirm Selected (N)". Observe Inventory table and StorageLocationManager.
**Expected:** (1) Modal opens smoothly. (2) Stats reflect N wines to assign, M locations, K skipped. (3) Deselected wines are excluded from batch. (4) Location change is respected. (5) Toggle re-computes plan. (6) Confirm batch-assigns only checked wines. (7) Modal closes. (8) LocationPickerCell pills update for assigned wines. (9) StorageLocationManager wine lists refresh.
**Why human:** Full interactive modal flow (framer-motion, state changes, plan recompute) and cross-component update propagation require live browser + API.

---

## Gaps Summary

No gaps found. All 10 ROADMAP success criteria and all 28 plan-level must-have truths are verified by static code analysis. The `human_needed` status reflects that interactive/visual behaviors require browser verification — not that any code is missing or broken.

**Notable implementation quality notes:**
- The `isLoading` spinner in `LocationPickerCell` is architecturally present but never visibly fires (synchronous fire-and-forget). This is by design and not a user-facing defect.
- ALOC requirement IDs lack formal REQUIREMENTS.md definitions — documentation gap only.
- ROADMAP.md has a stale Phase 16 duplicate entry from pre-planning phase — housekeeping candidate.

---

_Verified: 2026-04-08_
_Verifier: Claude (gsd-verifier)_
