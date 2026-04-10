---
phase: quick
plan: 260401-wps
subsystem: services/agent-orchestrator
tags: [supabase, integration-test, env-fix, settings]
dependency_graph:
  requires: []
  provides: [supabase-client-init-verified, live-round-trip-test]
  affects: [services/agent-orchestrator/config/settings.py]
tech_stack:
  added: []
  patterns: [supabase-py client init, environment variable fallback chain]
key_files:
  created:
    - scripts/test_supabase_integration.py
  modified:
    - services/agent-orchestrator/config/settings.py
decisions:
  - "SUPABASE_SERVICE_ROLE_KEY added as third fallback in settings.py supabase_key chain"
  - "submitted_by column confirmed UUID type — script inserts with submitted_by=None as safe workaround"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-01"
  tasks_completed: 2
  files_changed: 2
---

# Phase quick Plan 260401-wps: Live Supabase Integration Test Summary

**One-liner:** Fixed SUPABASE_SERVICE_KEY env mismatch in settings.py and confirmed full insert/verify/cleanup round-trip against live Supabase master_wine_library_submissions table.

---

## What Was Fixed

### Env Var Mismatch (settings.py)

`services/agent-orchestrator/config/settings.py` line 19 previously read:

```python
os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
```

Neither of those keys exists in `.env`. The actual key is `SUPABASE_SERVICE_ROLE_KEY`. This caused `supabase_client` to always be `None`, silently skipping all DB inserts.

**Fix:** Added `os.getenv("SUPABASE_SERVICE_ROLE_KEY")` as a third fallback.

---

## What the Integration Test Confirmed

Script: `scripts/test_supabase_integration.py`

| Step | Result |
|------|--------|
| Supabase client initialises | PASS — key length 219, client created successfully |
| `submitted_by` column type | UUID (migration 015 not applied — see ACTION NEEDED below) |
| Insert test row | PASS — id=1d44008a-e534-4bcf-889c-961a46b1732e |
| Verify row in Supabase | PASS — row found with correct payload fields |
| Clean up test row | PASS — 1 row deleted |
| Overall | **PASS** |

**Inserted row confirmed fields:**
- `restaurant_id`: `00000000-0000-0000-0000-000000000001`
- `submitted_by`: `null` (UUID column — string insert fails)
- `payload.wine_name`: `Test Wine`
- `payload.producer`: `Test Producer`
- `payload.vintage`: `2023`
- `payload.extraction_source`: `claude_vision`
- `status`: `pending_review`

---

## submitted_by Column Type

**Finding:** Column is still `UUID` type. Migration 013 created it as UUID. Migration 015 (`ADD COLUMN IF NOT EXISTS submitted_by TEXT DEFAULT 'unknown'`) did not convert the existing column — it was an IF NOT EXISTS add, which is a no-op when the column already exists.

**Current behavior:** Route has a UUID-error retry that sends `submitted_by=None`. The integration test confirms this workaround succeeds.

**ACTION NEEDED:** Run the following in the Supabase SQL editor to convert `submitted_by` to TEXT:

```sql
ALTER TABLE master_wine_library_submissions
  ALTER COLUMN submitted_by TYPE TEXT USING submitted_by::TEXT;
ALTER TABLE master_wine_library_submissions
  ALTER COLUMN submitted_by SET DEFAULT 'unknown';
```

This is a one-time schema fix. After it runs, the route can pass `submitted_by="claude_vision"` directly without the retry workaround.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Script path resolution for worktree context**

- **Found during:** Task 2 execution
- **Issue:** Script couldn't locate `.env` when run from within a git worktree (worktree root has no `.env`, main project root does)
- **Fix:** Added `_find_env_file()` and `_find_agent_dir()` helper functions that walk up the directory tree to find both the correct `.env` (containing `SUPABASE_SERVICE_ROLE_KEY`) and the correct `config/settings.py` (from the worktree for the patched version)
- **Files modified:** `scripts/test_supabase_integration.py`
- **Commit:** bb2b4b1

---

## Known Stubs

None — no UI rendering stubs or placeholder data introduced.

---

## Commits

| Hash | Message |
|------|---------|
| 10001fa | fix(quick-260401-wps): add SUPABASE_SERVICE_ROLE_KEY fallback to settings.py |
| bb2b4b1 | feat(quick-260401-wps): add live Supabase integration test script |

---

## Self-Check

- [x] `services/agent-orchestrator/config/settings.py` — modified and committed
- [x] `scripts/test_supabase_integration.py` — created and committed
- [x] Integration test ran and printed PASS with live Supabase
- [x] `submitted_by` column type confirmed and printed
- [x] ACTION NEEDED item for migration 015 surfaced

## Self-Check: PASSED
