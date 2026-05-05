"""
Production E2E Fixtures — conftest_prod.py
============================================
Session-scoped fixtures for live production tests against Railway + Supabase + Vercel.

Design decisions (from CONTEXT.md):
  D-01: All tests hit LIVE production — Railway orchestrator, Supabase, Vercel frontend
  D-04: Teardown errors → Sentry with tag e2e-orphan:true. NEVER raise.
  D-05: Deterministic IDs (e2e-*) + Supabase upserts for idempotency
  D-07: JWT via Supabase Auth REST POST /auth/v1/token?grant_type=password (service account)
  D-08: ADMIN_API_KEY for X-Admin-Key header on health/metrics/research endpoints
  TEST-PROD-09: Sentry capture_message on every production test failure
  TEST-PROD-12: Tag-based teardown: DELETE WHERE restaurant_id='e2e-test-restaurant' AND id LIKE 'e2e-%'

CRITICAL ANTI-PATTERNS (do NOT do these):
  - NEVER set the pytest sentinel env var — disables Sentry in FastAPI app (main.py:27)
  - NEVER write JWT to disk, JUnit XML, or logs
  - NEVER raise in teardown (D-04)
  - NEVER use function scope for prod_jwt (causes 401 on expiry between waves)
"""

import os
from typing import Any, Dict, List

import httpx
import pytest
import sentry_sdk
from supabase import create_client, Client
from tenacity import retry, stop_after_attempt, wait_exponential

# ---------------------------------------------------------------------------
# Sentry init — TEST RUNNER process only (separate from FastAPI app's Sentry)
# The FastAPI app's Sentry is initialized in main.py with its own call.
# This init ensures sentry_sdk.capture_message() works in pytest hooks below.
# ---------------------------------------------------------------------------
_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.0,
        environment="production",
        release=os.environ.get("GITHUB_SHA", "unknown"),
    )


# ---------------------------------------------------------------------------
# Wave extraction helper for Sentry tags
# ---------------------------------------------------------------------------

def _extract_wave(nodeid: str) -> str:
    """Return the wave letter (A–G) from a test node ID, or 'unknown'."""
    wave_map = {
        "wave_a_api_contracts": "A",
        "wave_b_agent_health": "B",
        "wave_c_agent_triggers": "C",
        "wave_d_toast_pipeline": "D",
        "wave_e_gmail_pipeline": "E",
        "prod_smoke": "F",
        "wave_g_calendar": "G",
    }
    for key, letter in wave_map.items():
        if key in nodeid:
            return letter
    return "unknown"


# ---------------------------------------------------------------------------
# Sentry hook — fires on EVERY production test failure (TEST-PROD-09)
# Coexists with E2EReportGenerator.pytest_runtest_logreport (no conflict).
# ---------------------------------------------------------------------------

def pytest_runtest_logreport(report):  # noqa: N802 (pytest hook name)
    """Fire Sentry alert on production test failure (TEST-PROD-09)."""
    if report.when != "call" or not report.failed:
        return
    if not _sentry_dsn:
        return  # Sentry not configured — skip silently
    triggered_by_deploy = os.environ.get("TRIGGERED_BY_DEPLOY", "false")
    sentry_sdk.capture_message(
        f"E2E Production Test Failed: {report.nodeid}",
        level="error",
        tags={
            "e2e-failure": "true",
            "deploy-gate": triggered_by_deploy,
            "wave": _extract_wave(report.nodeid),
        },
    )


# ---------------------------------------------------------------------------
# Production URL fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def prod_base_url() -> str:
    """Live Railway agent-orchestrator base URL (no trailing slash).

    Source: RAILWAY_ORCHESTRATOR_URL GitHub Actions secret.
    Example: https://agent-orchestrator-production.up.railway.app
    """
    url = os.environ.get("RAILWAY_ORCHESTRATOR_URL", "")
    if not url:
        pytest.skip("RAILWAY_ORCHESTRATOR_URL not set — skipping production test")
    return url.rstrip("/")


@pytest.fixture(scope="session")
def prod_frontend_url() -> str:
    """Live Vercel frontend base URL (used by Wave F Playwright via env, not this fixture)."""
    url = os.environ.get("E2E_BASE_URL", "")
    if not url:
        pytest.skip("E2E_BASE_URL not set — skipping Wave F production test")
    return url.rstrip("/")


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
async def prod_jwt() -> str:
    """Acquire a real Supabase JWT once per CI session (D-07, TEST-PROD-12).

    Calls POST /auth/v1/token?grant_type=password with the e2e service account.
    Supabase JWTs expire in 1 hour — suite must complete in < 10 min (D-19).
    Credentials: E2E_TEST_EMAIL + E2E_TEST_PASSWORD (GitHub Actions secrets).
    """
    supabase_url = os.environ.get("SUPABASE_URL", "")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    email = os.environ.get("E2E_TEST_EMAIL", "")
    password = os.environ.get("E2E_TEST_PASSWORD", "")

    if not all([supabase_url, anon_key, email, password]):
        pytest.skip(
            "Supabase auth env vars not set (SUPABASE_URL, SUPABASE_ANON_KEY, "
            "E2E_TEST_EMAIL, E2E_TEST_PASSWORD) — skipping production tests"
        )

    url = f"{supabase_url}/auth/v1/token?grant_type=password"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={"email": email, "password": password},
            headers={
                "apikey": anon_key,
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        pytest.skip(
            f"Supabase auth failed ({exc.response.status_code}) for E2E_TEST_EMAIL. "
            f"Check credentials are correct and account is enabled. "
            f"Body: {exc.response.text[:200]}"
        )
    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        pytest.skip(
            f"Supabase auth response missing 'access_token'. "
            f"Response keys: {list(data.keys())}"
        )
    return access_token  # Never log this value


@pytest.fixture(scope="session")
def prod_admin_headers() -> Dict[str, str]:
    """Return X-Admin-Key header dict for admin-only endpoints (D-08).

    Used for: GET /api/v1/health/agents, GET /api/v1/metrics,
              GET /api/v1/research/metrics
    """
    admin_key = os.environ.get("ADMIN_API_KEY", "")
    if not admin_key:
        pytest.skip("ADMIN_API_KEY not set — skipping admin endpoint tests")
    return {"X-Admin-Key": admin_key}


# ---------------------------------------------------------------------------
# Supabase production client + teardown registry
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def prod_supabase() -> Client:
    """Production Supabase client (service role — full access for teardown).

    Uses SUPABASE_SERVICE_ROLE_KEY for teardown deletes.
    Individual tests use prod_jwt for user-scoped assertions.
    """
    supabase_url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not service_key:
        pytest.skip(
            "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — "
            "skipping production tests that require DB access"
        )
    return create_client(supabase_url, service_key)


@pytest.fixture(scope="session")
def e2e_created_ids() -> List[Dict[str, str]]:
    """Mutable session registry of {table, id} pairs created during this run.

    Populated by individual test fixtures. Consumed by teardown_e2e_records.
    Format: [{"table": "inventory_stock", "id": "e2e-stock-001"}, ...]
    """
    return []


@pytest.fixture(scope="session", autouse=True)
def teardown_e2e_records(prod_supabase, e2e_created_ids):
    """Session teardown: delete all e2e records from production DB (D-03, D-04, TEST-PROD-12).

    Strategy: tag-based + ID-registry. Both approaches run to catch orphans
    from failed prior sessions (see RESEARCH.md Pitfall 5).

    CRITICAL: NEVER raise. All teardown failures go to Sentry with e2e-orphan:true.
    The anchor record (id='e2e-test-restaurant') is NEVER deleted.
    """
    yield  # Tests run here

    # Step 1: Delete by registry (records created in THIS session)
    failed_deletes = []
    for entry in e2e_created_ids:
        table = entry["table"]
        record_id = entry["id"]
        if record_id == "e2e-test-restaurant":
            continue  # Never delete the anchor
        try:
            prod_supabase.table(table).delete().eq("id", record_id).execute()
        except Exception as exc:
            failed_deletes.append({
                "table": table,
                "id": record_id,
                "error": str(exc),
            })

    # Step 2: Tag-based sweep (catches orphans from failed prior sessions)
    # H-02 audit of services/agent-orchestrator/agents/*.py — all tables that
    # receive writes with restaurant_id or id fields that could contain e2e data.
    # Missing tables = orphan rows silently accumulate in production.
    E2E_TABLES = [
        "inventory_stock",
        "notification_deliveries",
        "notification_logs",       # notification_agent.py: notification_logs.insert
        "order_interactions",
        "calendar_events",
        "pos_webhook_logs",
        "system_audit_log",        # inventory_engine.py + state_invariant_enforcer.py
        "master_wine_library_submissions",
    ]
    for table in E2E_TABLES:
        try:
            (
                prod_supabase.table(table)
                .delete()
                .eq("restaurant_id", "e2e-test-restaurant")
                .like("id", "e2e-%")
                .execute()
            )
        except Exception as exc:
            # Table may not exist or column may differ — log, don't fail
            failed_deletes.append({
                "table": table,
                "id": "e2e-%",
                "error": f"tag-based sweep: {exc}",
            })

    # Step 3: Report orphans to Sentry (D-04 — NEVER raise)
    if failed_deletes and _sentry_dsn:
        sentry_sdk.capture_message(
            "E2E teardown: orphaned records could not be deleted",
            level="warning",
            tags={"e2e-orphan": "true"},
            extra={"orphaned_records": failed_deletes},
        )


# ---------------------------------------------------------------------------
# Retry utilities (RESEARCH.md Pattern 3)
# ---------------------------------------------------------------------------

def make_retry_decorator():
    """Return a tenacity @retry decorator: 3 attempts, 2s base exponential backoff."""
    return retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )


prod_retry = make_retry_decorator()


async def get_with_retry(
    client: httpx.AsyncClient, url: str, **kwargs
) -> httpx.Response:
    """GET with 3-retry exponential backoff for flaky production network calls."""

    @prod_retry
    async def _get():
        return await client.get(url, **kwargs)

    return await _get()


async def post_with_retry(
    client: httpx.AsyncClient, url: str, **kwargs
) -> httpx.Response:
    """POST with 3-retry exponential backoff."""

    @prod_retry
    async def _post():
        return await client.post(url, **kwargs)

    return await _post()
