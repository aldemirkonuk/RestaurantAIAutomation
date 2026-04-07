# Quick Task 260407-qpw: Summary

**Date:** 2026-04-07 | **Status:** Complete

## Changes

### Backend — `services/agent-orchestrator/api/onboarding_routes.py`
- Clear any stale `submission_id` on each wine before the insert loop
- After each successful Supabase insert: `wine["submission_id"] = insert_resp.data[0]["id"]`
- Real UUID is now included in the `wines` array returned to the frontend

### Frontend — `apps/web/src/pages/studio/CommandBar.tsx`
- Use `w.submission_id` from backend response when it's a real UUID (length > 10)
- Fall back to `crypto.randomUUID()` only when backend omitted it (Supabase unavailable)
- Manual empty record now uses `crypto.randomUUID()` instead of `'new-1'`
- Added `description: null, tasting_notes: null` to manual empty record

### Store + Table — `useStudioSessionStore.ts` + `WineRecordsTable.tsx`
- Added `description` and `tasting_notes` fields to `WineRecord` interface
- Added both as editable columns in `COLUMN_ORDER` (after Glass price)
- Both fields are part of Claude's extraction prompt and `master_wine_library` schema
