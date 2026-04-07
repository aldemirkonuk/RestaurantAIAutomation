---
quick_id: 260407-qpw
description: fix override submission_id — backend returns real Supabase UUID per wine in extract response, frontend uses it instead of String(i)
date: 2026-04-07
status: complete
---

# Quick Task 260407-qpw

## Root Cause
`POST /api/v1/studio/overrides` returns 503 with "Failed to fetch submission"
because `submission_id` sent is `"0"`, `"1"`, etc. — invalid UUID for Supabase.

Two-part bug:
1. Backend `/extract` inserts wines into `master_wine_library_submissions` and gets
   real UUIDs back, but never attached them to the response `wines` array.
2. Frontend `CommandBar.tsx` set `submission_id: String(i)` since nothing better existed.

## Fix
- `onboarding_routes.py`: stamp `wine["submission_id"] = insert_resp.data[0]["id"]`
  immediately after each Supabase insert; clear any pre-existing fake ID before the loop.
- `CommandBar.tsx`: use `w.submission_id` from response when it's a real UUID (length > 10);
  fall back to `crypto.randomUUID()` when Supabase was unavailable during extraction.
- Manual entry: use `crypto.randomUUID()` instead of `'new-1'`.
- Add `description` + `tasting_notes` to `WineRecord` type and `COLUMN_ORDER`.
