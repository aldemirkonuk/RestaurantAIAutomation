---
phase: 28-onboarding-reform-menu-import
plan: "03"
subsystem: frontend
tags: [onboarding, menu-import, get-started, react, tanstack-query]
dependency_graph:
  requires: [28-01, 28-02]
  provides: [get-started-page, menu-import-ui]
  affects: [App.tsx, onboarding-flow]
tech_stack:
  added: [framer-motion/AnimatePresence, CameraCapture reuse]
  patterns: [TanStack Query hook, lazy route, accordion card expand, CSV preview table]
key_files:
  created:
    - apps/web/src/services/api/menus.ts
    - apps/web/src/hooks/queries/useOnboardingProgress.ts
    - apps/web/src/pages/GetStarted.tsx
    - apps/web/src/components/onboarding/MenuImportCard.tsx
    - apps/web/src/components/onboarding/MenuScanUpload.tsx
    - apps/web/src/components/onboarding/MenuCsvUpload.tsx
    - apps/web/src/components/onboarding/MenuManualEntry.tsx
  modified:
    - apps/web/src/App.tsx
key_decisions:
  - "Used apiClient (axios) instead of raw fetch for token refresh handling (Rule 2 improvement)"
  - "CameraCapture reused from scanner/ with enableLiveDetection=false for onboarding context"
  - "/get-started registered as public/semi-auth route alongside /verify-email"
  - "/onboarding route left unchanged per plan note (Plan 05 handles retirement)"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-11"
  tasks_completed: 7
  files_created: 7
  files_modified: 1
  commits: 3
---

# Phase 28 Plan 03: Frontend — /get-started MenuImportOnboarding Page Summary

## One-liner

Full-screen `/get-started` page with three animated import method cards (photo scan via CameraCapture, CSV with 5-row preview, manual row entry) all wired to a shared `importMenu()` API function and a TanStack Query onboarding progress hook.

## What Was Built

### Task 1: menus API service + hook
- `services/api/menus.ts`: exports `importMenu()`, `getOnboardingProgress()`, `updateOnboardingProgress()` using the project's `apiClient` (axios)
- `hooks/queries/useOnboardingProgress.ts`: TanStack Query hook wrapping onboarding progress with 30s staleTime and mutation invalidation

### Task 2: GetStarted.tsx page
- Full-screen white layout with WineOps brand header
- Three `MenuImportCard` components in a responsive 3-column grid
- `AnimatePresence` for animated expand/collapse of sub-components below cards
- Guard: redirects to `/` if `progress.menu_uploaded` is already `true`
- `SuccessScreen` inline component showing item count with "View Inventory" and "Go to Dashboard →" CTAs
- Frictionless "Skip for now →" text link

### Task 3: MenuScanUpload
- Wraps the existing `CameraCapture` component (`components/scanner/CameraCapture.tsx`) with `enableLiveDetection={false}` for cleaner onboarding UX
- Loading state: animated spinner + "Analyzing your menu with AI..."
- Inline error with retry

### Task 4: MenuCsvUpload
- Drag-and-drop-styled file input accepting `.csv`, `.xlsx`, `.xls`
- FileReader parses CSV (handles quoted commas) → shows preview table of first 5 rows with headers
- Displays total row count estimate
- "Import N wines" button calls `importMenu('csv', { csvContent })`

### Task 5: MenuManualEntry
- Dynamic row table (name required, vintage/region/glass price/bottle price optional)
- "Add another wine +" button appends rows; trash button removes (min 1 row)
- Validates at least 1 named row before submitting
- "Import N wines" button calls `importMenu('manual', { items })`

### Task 6: Success screen
- `SuccessScreen` function component inline in GetStarted.tsx
- Spring-animated check icon, item count headline, dashboard/inventory CTAs

### Task 7: Route registration
- `/get-started` added to `App.tsx` public routes section (lazy-loaded)
- Placed alongside `/verify-email` per plan spec

## Deviations from Plan

### Auto-improved: Rule 2 — Used apiClient instead of raw fetch

- **Found during:** Task 1
- **Issue:** Plan spec showed raw `fetch()` with manual `localStorage.getItem('accessToken')` — this bypasses the existing token-refresh interceptor in `apiClient`, meaning a 401 on an expired token would not auto-refresh and would cause a hard failure mid-onboarding
- **Fix:** Used `apiClient` (axios instance from `services/api/client.ts`) which has the refresh interceptor already configured
- **Files modified:** `apps/web/src/services/api/menus.ts`

## Known Stubs

None. All three import methods are wired to the live `importMenu()` API call. The API endpoint (`POST /api/v1/menus/import`) is built in Plan 02, which runs in parallel.

## Threat Flags

None. `/get-started` is a public route that calls authenticated endpoints. Auth is handled by `apiClient`'s Bearer token header. No new auth paths or trust boundary changes introduced.

## Self-Check: PASSED

**Files verified present:**
- FOUND: apps/web/src/services/api/menus.ts
- FOUND: apps/web/src/hooks/queries/useOnboardingProgress.ts
- FOUND: apps/web/src/pages/GetStarted.tsx
- FOUND: apps/web/src/components/onboarding/MenuImportCard.tsx
- FOUND: apps/web/src/components/onboarding/MenuScanUpload.tsx
- FOUND: apps/web/src/components/onboarding/MenuCsvUpload.tsx
- FOUND: apps/web/src/components/onboarding/MenuManualEntry.tsx

**Commits verified in git log:**
- 1a42a67: feat(28-03): add menus API service + useOnboardingProgress hook
- 167588e: feat(28-03): build /get-started page with scan/csv/manual import methods
- c422e45: feat(28-03): register /get-started route in App.tsx
