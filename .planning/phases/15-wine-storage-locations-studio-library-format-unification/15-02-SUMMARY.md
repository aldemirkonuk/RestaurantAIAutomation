---
phase: 15-wine-storage-locations-studio-library-format-unification
plan: "02"
subsystem: studio-library-bridge
tags: [studio, wine-library, promotion, field-mapping, format-unification]
dependency_graph:
  requires:
    - master_wine_library_submissions table (populated by Studio extraction pipeline)
    - master_wine_library table (target of promotion)
    - require_studio_role() dependency from override_service
  provides:
    - POST /api/v1/studio/promote endpoint
    - mapWineRecordToMasterLibrary() TypeScript utility
    - canPromote() TypeScript guard
    - Promote to Library UI action in Studio wine table
  affects:
    - apps/web/src/pages/studio/WineRecordsTable.tsx
    - services/agent-orchestrator/api/studio_routes.py
tech_stack:
  added: []
  patterns:
    - Fetch API with localStorage accessToken (matching FieldCell.tsx pattern)
    - Pydantic BaseModel for promotion request body
    - field_confidence JSONB extraction with fallback to top-level columns
    - Graceful retry without audit columns if DB schema lacks them
key_files:
  created:
    - apps/web/src/lib/wine-format-mapper.ts
  modified:
    - services/agent-orchestrator/api/studio_routes.py
    - apps/web/src/pages/studio/WineRecordsTable.tsx
decisions:
  - "Used fetch() directly (matching FieldCell.tsx pattern) rather than apiClient abstraction — consistent with existing Studio component conventions"
  - "Retry-without-audit-columns fallback avoids hard failure if promoted_by/promoted_at/submission_id columns haven't been added to master_wine_library yet"
  - "Action column rendered outside COLUMN_ORDER.map() to avoid adding 'action' as a WineRecord key"
metrics:
  duration_minutes: 5
  completed_date: "2026-04-08"
  tasks_completed: 2
  files_modified: 3
---

# Phase 15 Plan 02: Studio→Library Promotion Bridge Summary

**One-liner:** WineRecord-to-master_wine_library field mapper, POST /promote endpoint with dedup + audit trail, and per-row Promote button with 3-state feedback in Studio table.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create format mapper + promotion endpoint | 7855dc4 | wine-format-mapper.ts (new), studio_routes.py |
| 2 | Add "Promote to Library" button in Studio UI | c02e78c | WineRecordsTable.tsx |

## What Was Built

### `apps/web/src/lib/wine-format-mapper.ts` (NEW)
- `mapWineRecordToMasterLibrary(record)` — maps all 13 WineRecord fields to master_wine_library column names with type coercion (vintage→int, price→float, bottle_size_ml defaulting to 750)
- `canPromote(record)` — returns true if `wine_name` is non-null and non-empty

### `POST /api/v1/studio/promote` (in studio_routes.py)
- `PromoteRequest` Pydantic model with `submission_id: str`
- Role guard: `require_studio_role("developer", "review_admin")` — T-15-03
- Fetches submission server-side using `.maybe_single()` — T-15-04 (client only sends submission_id)
- Extracts values from `field_confidence` JSONB first, falls back to top-level columns
- Dedup check: case-insensitive `name + vintage + producer` → 409 if duplicate
- Inserts into `master_wine_library` with `promoted_by`, `promoted_at`, `submission_id` audit fields — T-15-05
- Retry logic: if insert fails due to missing audit columns, retries without them
- Updates `promoted_to_library = true` on the submission row (non-fatal if column absent)
- Returns `{ status: "promoted", wine_id, name }`

### `WineRecordsTable.tsx` (MODIFIED)
- "Action" column header added as last column (not in COLUMN_ORDER — avoids WineRecord key type clash)
- `promoteStates` local state tracks per-record: `idle | loading | promoted | duplicate | error`
- `handlePromote()` calls `fetch('/api/v1/studio/promote', ...)` with Bearer token from localStorage
- Button: green pill when promotable, gray+disabled when `wine_name` is null/empty
- Loading: spinner during in-flight request
- Success: persistent emerald "✓ Promoted" badge
- 409: amber "Already in library" badge (persistent)
- Error: red "Failed" badge, auto-clears after 3s

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added graceful fallback for missing DB audit columns**
- **Found during:** Task 1 (implementing promote endpoint)
- **Issue:** Plan specified `promoted_by`, `promoted_at`, `submission_id` columns on master_wine_library, but these may not exist in the DB schema yet (the plan notes "add column if not present — use a simple try/except")
- **Fix:** On insert failure, detect if the error mentions these specific column names and retry the insert without them — allows the core promotion to succeed even if the schema hasn't been migrated
- **Files modified:** services/agent-orchestrator/api/studio_routes.py
- **Commit:** 7855dc4

## Known Stubs

None — all fields are wired from real submission data. `bottle_size_ml` defaults to 750 (intentional — Studio doesn't capture bottle size; documented in plan as default).

## Threat Flags

No new security surface beyond what was in the plan's threat model. The `/promote` endpoint is properly guarded with `require_studio_role("developer", "review_admin")`.

## Self-Check: PASSED

- [x] `apps/web/src/lib/wine-format-mapper.ts` exists
- [x] `POST /api/v1/studio/promote` endpoint exists in studio_routes.py
- [x] `WineRecordsTable.tsx` has Promote button with canPromote, success/409/error states
- [x] Commit 7855dc4 exists (Task 1)
- [x] Commit c02e78c exists (Task 2)
- [x] No new TypeScript errors introduced (lucide TS2786 errors pre-exist throughout codebase)
