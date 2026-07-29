---
phase: quick
plan: 260401-wps
type: execute
wave: 1
depends_on: []
files_modified:
  - services/agent-orchestrator/config/settings.py
  - scripts/test_supabase_integration.py
autonomous: true
requirements: []
must_haves:
  truths:
    - "POST /api/v1/onboarding/extract inserts real rows into master_wine_library_submissions"
    - "Rows appear in Supabase with correct fields: restaurant_id, submitted_by, payload, status=pending_review"
    - "submitted_by column type is confirmed (TEXT or UUID) and the insert succeeds without error"
  artifacts:
    - path: "scripts/test_supabase_integration.py"
      provides: "Standalone integration test — starts FastAPI app, POSTs real request, queries Supabase, prints results"
    - path: "services/agent-orchestrator/config/settings.py"
      provides: "Supabase client wired to correct env var SUPABASE_SERVICE_ROLE_KEY"
  key_links:
    - from: "services/agent-orchestrator/config/settings.py"
      to: "SUPABASE_SERVICE_ROLE_KEY in .env"
      via: "os.getenv lookup"
      pattern: "SUPABASE_SERVICE_ROLE_KEY"
    - from: "api/onboarding_routes.py"
      to: "master_wine_library_submissions"
      via: "supabase.table().insert().execute()"
      pattern: "master_wine_library_submissions"
---

<objective>
Fix the env var mismatch that silently breaks Supabase client init, then run a live integration
test against POST /api/v1/onboarding/extract that inserts real wine rows and verifies them.

Purpose: Confirm the full extraction-to-DB path works before Phase 2 builds on it. The
`submitted_by` column history (UUID in migration 013, altered to TEXT in migration 015) means
we need to verify the actual live column type and confirm inserts succeed.

Output:
- settings.py patched to read SUPABASE_SERVICE_ROLE_KEY (the key name present in .env)
- scripts/test_supabase_integration.py — standalone script that runs the full flow and reports results
- Console output showing rows inserted + column type confirmed
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Key facts discovered during planning:

1. ENV VAR MISMATCH — settings.py line 19 reads:
     os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
   But .env only has: SUPABASE_SERVICE_ROLE_KEY
   Result: supabase_client is always None → all inserts silently skipped.

2. submitted_by COLUMN HISTORY:
   - Migration 013 defines: submitted_by UUID
   - Migration 015 adds:    submitted_by TEXT DEFAULT 'unknown'  (ADD COLUMN IF NOT EXISTS)
   If migration 015 ran → column is TEXT (insert of "claude_vision" succeeds)
   If migration 015 did NOT run → column is UUID (insert of "claude_vision" fails with "invalid input syntax for type uuid")
   The route already has a UUID-error retry that sends submitted_by=None — but this is a workaround, not a fix.

3. restaurant_id in master_wine_library_submissions is UUID type — the route passes it as a raw
   string from the request body. This will fail if the string is not a valid UUID. Test must use
   a valid UUID format for restaurant_id.

4. FastAPI app entrypoint: services/agent-orchestrator/main.py
   Run with: uvicorn main:app --port 8001
   Venv: services/agent-orchestrator/venv
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix env var key name in settings.py</name>
  <files>services/agent-orchestrator/config/settings.py</files>
  <action>
    In Settings.__init__, update the supabase_key line to also check SUPABASE_SERVICE_ROLE_KEY,
    which is the actual key name present in .env:

      self.supabase_key: Optional[str] = (
          os.getenv("SUPABASE_SERVICE_KEY")
          or os.getenv("SUPABASE_KEY")
          or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
      )

    Add SUPABASE_SERVICE_ROLE_KEY as the third fallback (most specific). This is the only change —
    do not modify any other settings logic. The lru_cache on get_settings() means existing tests
    or live server instances need a restart to pick up the change.
  </action>
  <verify>
    cd services/agent-orchestrator && source venv/bin/activate && python -c "
import os; os.environ.setdefault('SUPABASE_URL', 'https://test.supabase.co'); os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test_key')
from config.settings import Settings; s = Settings(); print('supabase_key =', repr(s.supabase_key))
"
    Expected: supabase_key = 'test_key'
  </verify>
  <done>settings.py reads SUPABASE_SERVICE_ROLE_KEY; env var present in .env is now picked up</done>
</task>

<task type="auto">
  <name>Task 2: Write and run live Supabase integration test</name>
  <files>scripts/test_supabase_integration.py</files>
  <action>
    Create scripts/test_supabase_integration.py as a standalone Python script (no pytest, no
    FastAPI test client — directly calls the extractor and Supabase client to keep it simple and
    fast). The script must:

    STEP 1 — Verify Supabase client initialises:
      Load .env from services/agent-orchestrator/.env (use python-dotenv or os.environ manually).
      Import Settings, call get_settings(), assert supabase_client is not None.
      Print: "OK: Supabase client initialised"

    STEP 2 — Check submitted_by column type:
      Query the information_schema to determine whether submitted_by is TEXT or UUID:
        result = supabase.rpc("query_column_type", {...})
      If RPC not available, use a direct insert probe: insert a row with submitted_by="claude_vision"
      and check if it succeeds or raises "invalid input syntax for type uuid".
      Print: "submitted_by column type: TEXT" or "submitted_by column type: UUID (migration 015 not applied)"

    STEP 3 — Insert one test wine row directly via Supabase client:
      Use a fixed valid UUID for restaurant_id, e.g. "00000000-0000-0000-0000-000000000001".
      Use submitted_by="claude_vision" (or None if column is UUID).
      Payload: a minimal wine dict with wine_name, producer, vintage, scan_session_id, extraction_source.
      signature_hash: sha256 of "test-wine-producer-2023".lower().strip()
      status: "pending_review"
      created_at: datetime.utcnow().isoformat()
      Capture the response and print the inserted row id.

    STEP 4 — Verify row exists in Supabase:
      Query master_wine_library_submissions WHERE restaurant_id = the test UUID AND
      payload->>'wine_name' = 'Test Wine'. Assert count >= 1.
      Print the full row dict.

    STEP 5 — Clean up test row:
      DELETE FROM master_wine_library_submissions WHERE restaurant_id = the test UUID.
      Print: "OK: Test row cleaned up"

    STEP 6 — Summary:
      Print a one-line summary: "PASS" or "FAIL: <reason>"

    Run the script at the end of this task from the services/agent-orchestrator directory using
    the venv:
      cd services/agent-orchestrator && source venv/bin/activate && python ../../scripts/test_supabase_integration.py

    If Step 2 reveals submitted_by is still UUID type, note it clearly in output and have the
    script continue with submitted_by=None (not a blocker for the test). Add a comment in the
    script: "# ACTION NEEDED: run migration 015 in Supabase SQL editor to convert submitted_by to TEXT"
  </action>
  <verify>
    cd services/agent-orchestrator && source venv/bin/activate && python ../../scripts/test_supabase_integration.py
    Expected terminal output contains:
    - "OK: Supabase client initialised"
    - "submitted_by column type:" line
    - An inserted row id (UUID)
    - "OK: Test row cleaned up"
    - "PASS" on last line
  </verify>
  <done>
    Script exits 0, prints PASS, at least one row was inserted and deleted from
    master_wine_library_submissions. submitted_by column type is confirmed and printed.
  </done>
</task>

</tasks>

<verification>
After both tasks:
- settings.py: `grep -n "SUPABASE_SERVICE_ROLE_KEY" services/agent-orchestrator/config/settings.py` returns a hit
- Script: `python scripts/test_supabase_integration.py` prints PASS
- If submitted_by is UUID: ACTION NEEDED comment is visible in script output
</verification>

<success_criteria>
1. Supabase client no longer returns None — env var mismatch fixed
2. Integration script inserts a real row, queries it, deletes it — full round-trip confirmed
3. submitted_by column type is known and printed — no more guessing
4. Any remaining schema issues (UUID column, migration 015 not applied) are surfaced clearly
</success_criteria>

<output>
After completion, create `.planning/quick/260401-wps-run-live-supabase-integration-test-for-p/260401-wps-SUMMARY.md`
with: what was fixed, what the script confirmed, the submitted_by column type found, any
ACTION NEEDED items.
</output>
