#!/usr/bin/env python3
"""
Standalone Supabase integration test for master_wine_library_submissions.

Usage:
    cd services/agent-orchestrator
    source venv/bin/activate
    python ../../scripts/test_supabase_integration.py

Steps:
    1. Verify Supabase client initialises (env var check)
    2. Check submitted_by column type (TEXT vs UUID)
    3. Insert one test wine row
    4. Verify row exists in Supabase
    5. Clean up test row
    6. Print PASS or FAIL summary
"""

import os
import sys
import hashlib
from datetime import datetime

# ---------------------------------------------------------------------------
# Load .env from services/agent-orchestrator directory
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# PROJECT_ROOT is the root of the git repo (parent of scripts/)
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Find the .env file — walk up from script location to find it
def _find_env_file(start_dir, max_levels=6):
    """Search upward from start_dir for a .env that has SUPABASE_SERVICE_ROLE_KEY."""
    d = start_dir
    for _ in range(max_levels):
        candidate = os.path.join(d, ".env")
        if os.path.exists(candidate):
            with open(candidate) as f:
                if "SUPABASE_SERVICE_ROLE_KEY" in f.read():
                    return candidate
        d = os.path.dirname(d)
    return None

# Find agent-orchestrator with config/settings.py — check worktree first then walk up
def _find_agent_dir(start_dir, max_levels=6):
    d = start_dir
    for _ in range(max_levels):
        candidate = os.path.join(d, "services", "agent-orchestrator")
        if os.path.exists(os.path.join(candidate, "config", "settings.py")):
            return candidate
        d = os.path.dirname(d)
    return os.path.join(start_dir, "services", "agent-orchestrator")  # fallback

AGENT_DIR = _find_agent_dir(PROJECT_ROOT)
ENV_FILE = _find_env_file(PROJECT_ROOT)

# Try to load .env using python-dotenv if available
def load_env():
    env_path = ENV_FILE
    if not env_path:
        # Also check agent-orchestrator directory
        env_path = os.path.join(AGENT_DIR, ".env")
    if env_path and os.path.exists(env_path):
        try:
            from dotenv import load_dotenv
            load_dotenv(env_path)
            return True
        except ImportError:
            # Manual parse
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, val = line.partition("=")
                        os.environ.setdefault(key.strip(), val.strip())
            return True
    return False


# Add agent-orchestrator to sys.path so we can import settings
sys.path.insert(0, AGENT_DIR)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TEST_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001"
TEST_WINE_NAME = "Test Wine"
TEST_PRODUCER = "Test Producer"
TEST_VINTAGE = "2023"
SIGNATURE_INPUT = f"{TEST_WINE_NAME}-{TEST_PRODUCER}-{TEST_VINTAGE}".lower().strip()
SIGNATURE_HASH = hashlib.sha256(SIGNATURE_INPUT.encode()).hexdigest()

failures = []


# ---------------------------------------------------------------------------
# STEP 1 — Verify Supabase client initialises
# ---------------------------------------------------------------------------
print("\n=== STEP 1: Verify Supabase client initialises ===")
load_env()

from config.settings import Settings

s = Settings()
if s.supabase_key is None:
    print("FAIL: supabase_key is None — check SUPABASE_SERVICE_ROLE_KEY in .env")
    failures.append("supabase_key is None (env var not found)")
else:
    print(f"OK: supabase_key found (length={len(s.supabase_key)})")

supabase = s.supabase_client
if supabase is None:
    print("FAIL: Supabase client is None — check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    failures.append("supabase_client is None")
    print("\nFAIL: Cannot continue without Supabase client")
    sys.exit(1)
else:
    print("OK: Supabase client initialised")


# ---------------------------------------------------------------------------
# STEP 2 — Check submitted_by column type
# ---------------------------------------------------------------------------
print("\n=== STEP 2: Check submitted_by column type ===")
submitted_by_is_text = False

try:
    # Probe: attempt insert with submitted_by as text string
    probe_result = supabase.table("master_wine_library_submissions").insert({
        "restaurant_id": TEST_RESTAURANT_ID,
        "submitted_by": "claude_vision_probe",
        "payload": {"wine_name": "__probe__"},
        "signature_hash": hashlib.sha256(b"__probe__").hexdigest(),
        "status": "pending_review",
        "created_at": datetime.utcnow().isoformat(),
    }).execute()

    if probe_result.data:
        submitted_by_is_text = True
        print("submitted_by column type: TEXT")
        # Clean up probe row immediately
        probe_id = probe_result.data[0].get("id")
        if probe_id:
            supabase.table("master_wine_library_submissions").delete().eq("id", probe_id).execute()
    else:
        print("submitted_by column type: unknown (insert returned no data)")

except Exception as e:
    err_str = str(e)
    if "invalid input syntax for type uuid" in err_str.lower() or "uuid" in err_str.lower():
        submitted_by_is_text = False
        print("submitted_by column type: UUID (migration 015 not applied)")
        print(f"  Error detail: {err_str}")
        # ACTION NEEDED: run migration 015 in Supabase SQL editor to convert submitted_by to TEXT
        print("  ACTION NEEDED: run migration 015 in Supabase SQL editor to convert submitted_by to TEXT")
    else:
        print(f"submitted_by column type check failed with unexpected error: {err_str}")
        failures.append(f"Column type check error: {err_str}")


# ---------------------------------------------------------------------------
# STEP 3 — Insert one test wine row
# ---------------------------------------------------------------------------
print("\n=== STEP 3: Insert test wine row ===")

row = {
    "restaurant_id": TEST_RESTAURANT_ID,
    "payload": {
        "wine_name": TEST_WINE_NAME,
        "producer": TEST_PRODUCER,
        "vintage": TEST_VINTAGE,
        "scan_session_id": "test-session-260401",
        "extraction_source": "claude_vision",
    },
    "signature_hash": SIGNATURE_HASH,
    "status": "pending_review",
    "created_at": datetime.utcnow().isoformat(),
}

if submitted_by_is_text:
    row["submitted_by"] = "claude_vision"
else:
    row["submitted_by"] = None  # UUID column: send None to avoid type error

inserted_id = None
try:
    insert_result = supabase.table("master_wine_library_submissions").insert(row).execute()
    if insert_result.data:
        inserted_id = insert_result.data[0].get("id")
        print(f"OK: Row inserted — id={inserted_id}")
    else:
        print("FAIL: Insert returned no data")
        failures.append("Insert returned no data")
except Exception as e:
    print(f"FAIL: Insert raised exception: {e}")
    failures.append(f"Insert exception: {e}")


# ---------------------------------------------------------------------------
# STEP 4 — Verify row exists in Supabase
# ---------------------------------------------------------------------------
print("\n=== STEP 4: Verify row exists ===")

if inserted_id:
    try:
        verify_result = (
            supabase.table("master_wine_library_submissions")
            .select("*")
            .eq("restaurant_id", TEST_RESTAURANT_ID)
            .execute()
        )
        rows = verify_result.data or []
        matching = [r for r in rows if r.get("payload", {}).get("wine_name") == TEST_WINE_NAME]
        if matching:
            print(f"OK: Row verified — count={len(matching)}")
            print(f"  Row: {matching[0]}")
        else:
            print("FAIL: Row not found in verification query")
            failures.append("Row not found after insert")
    except Exception as e:
        print(f"FAIL: Verification query raised exception: {e}")
        failures.append(f"Verification exception: {e}")
else:
    print("SKIP: No inserted_id available — skipping verification")
    failures.append("No inserted_id — skipping verification")


# ---------------------------------------------------------------------------
# STEP 5 — Clean up test row
# ---------------------------------------------------------------------------
print("\n=== STEP 5: Clean up test rows ===")

try:
    delete_result = (
        supabase.table("master_wine_library_submissions")
        .delete()
        .eq("restaurant_id", TEST_RESTAURANT_ID)
        .execute()
    )
    deleted = delete_result.data or []
    print(f"OK: Test row(s) cleaned up — {len(deleted)} row(s) deleted")
except Exception as e:
    print(f"WARNING: Cleanup failed: {e}")
    # Not a test failure, just a warning


# ---------------------------------------------------------------------------
# STEP 6 — Summary
# ---------------------------------------------------------------------------
print("\n=== STEP 6: Summary ===")
if failures:
    print(f"FAIL: {'; '.join(failures)}")
    sys.exit(1)
else:
    print("PASS")
    sys.exit(0)
