"""
Wave D: Toast Webhook Pipeline Integration Test (TEST-PROD-04)
================================================================
Delivers a HMAC-signed test Toast webhook to the live agent-orchestrator.
Verifies the full pipeline: POSIntegrationAgent → audit log in pos_webhook_logs.

Test data isolation:
  restaurant_id / restaurantGuid: "e2e-test-restaurant" (D-02)
  order_guid / orderGuid:         "e2e-order-001" (D-05)
  All created records registered in e2e_created_ids for session teardown (D-03).

HMAC signing notes (verified against adapters/toast_adapter.py):
  - Header name: Toast-Signature (NOT X-Toast-Signature).
    pos_routes.py line 37: alias="Toast-Signature"
  - Header value: raw HMAC-SHA256 hexdigest (no "sha256=" prefix).
    ToastAdapter.verify_webhook compares hmac.hexdigest() vs signature.lower()
    directly — adding a prefix would cause all signatures to fail.
  - Digest: hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    (same algorithm used in adapters/toast_adapter.py)

Supabase verification:
  pos_webhook_logs schema: event_type, payload (JSONB), processing_result,
  processed_at, pos_system. The order_guid lives inside payload->>'orderGuid'.
  Polling fetches the most recent records and checks payload contents in Python.

Known teardown limitation:
  pos_webhook_logs has no restaurant_id column and no controllable id column.
  ID-registry teardown will attempt delete by order_guid as id (fails silently).
  Tag-based sweep will not match (no restaurant_id column; fails silently).
  Both failures are D-04 compliant: reported to Sentry as orphans, never raised.

Depends on: Wave A (API contracts) + Wave B (agent health) — D-17: D depends on A+B

SKIP condition: TOAST_WEBHOOK_SECRET not set in environment.

Run: pytest tests/e2e/wave_d_toast_pipeline.py --junitxml=test-results/wave_d.xml
"""

import asyncio
import hashlib
import hmac
import json
import os
from typing import Any

import httpx
import pytest
from e2e.conftest_prod import post_with_retry

pytestmark = pytest.mark.prod_e2e

# ---------------------------------------------------------------------------
# Test data constants (D-05)
# ---------------------------------------------------------------------------
E2E_ORDER_GUID = "e2e-order-001"
E2E_RESTAURANT_ID = "e2e-test-restaurant"
E2E_TABLE_NAME = "pos_webhook_logs"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def toast_webhook_secret() -> str:
    """TOAST_WEBHOOK_SECRET from env — skips Wave D if not set (TEST-PROD-09)."""
    secret = os.environ.get("TOAST_WEBHOOK_SECRET", "")
    if not secret:
        pytest.skip(
            "TOAST_WEBHOOK_SECRET not set — skipping Wave D Toast pipeline test. Add TOAST_WEBHOOK_SECRET to GitHub Actions secrets to enable Wave D."
        )  # noqa: E501
    return secret


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_toast_webhook_payload() -> dict:
    """Minimal Toast webhook payload with deterministic e2e IDs.

    Uses TOAST_RESTAURANT_GUID env var if set (for real validation bypass at
    agent layer); falls back to E2E_RESTAURANT_ID for isolation testing.
    """
    restaurant_guid = os.environ.get("TOAST_RESTAURANT_GUID", E2E_RESTAURANT_ID)
    return {
        "restaurantGuid": restaurant_guid,
        "orderGuid": E2E_ORDER_GUID,
        "entityType": "ORDER",
        "eventType": "APPLIED_DATE",
        "timestamp": "2026-05-01T02:00:00Z",
        "order": {
            "guid": E2E_ORDER_GUID,
            "restaurantGuid": restaurant_guid,
            "checks": [
                {
                    "selections": [
                        {
                            "itemGroup": {
                                "guid": "e2e-item-001",
                                "name": "Barolo E2E Test",
                            },
                            "quantity": 1,
                            "unitOfMeasure": "NONE",
                        }
                    ]
                }
            ],
        },
    }


def sign_webhook_payload(body_bytes: bytes, secret: str) -> str:
    """Compute HMAC-SHA256 signature matching ToastAdapter.verify_webhook.

    Returns raw hexdigest (no prefix) — ToastAdapter compares:
      expected = hmac.new(secret, raw, sha256).hexdigest()
      hmac.compare_digest(expected, signature.lower())
    Adding "sha256=" prefix would cause signature mismatch.
    """
    return hmac.new(
        key=secret.encode("utf-8"),
        msg=body_bytes,
        digestmod=hashlib.sha256,
    ).hexdigest()


async def poll_supabase_for_webhook_record(
    prod_supabase: Any,
    order_guid: str,
    timeout_seconds: float = 15.0,
) -> bool:
    """Poll pos_webhook_logs for our test order within timeout.

    pos_webhook_logs schema has payload as JSONB. The order_guid sits inside
    payload->>'orderGuid'. We fetch the 10 most-recent rows and check in Python
    to avoid PostgREST JSONB path syntax compatibility issues across supabase-py
    versions.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    last_exc = None
    while loop.time() < deadline:
        try:
            result = (
                prod_supabase.table(E2E_TABLE_NAME)
                .select("*")
                .order("processed_at", desc=True)
                .limit(10)
                .execute()
            )
            for row in result.data or []:
                payload_data = row.get("payload") or {}
                # Check both camelCase (raw Toast format) and snake_case variants
                found_guid = (
                    payload_data.get("orderGuid")
                    or payload_data.get("order_guid")
                    or ""
                )
                if str(found_guid) == order_guid:
                    return True
        except Exception as exc:
            if last_exc is None:
                print(f"[poll] Supabase query error (will retry): {exc}", flush=True)
            last_exc = exc
        await asyncio.sleep(2.0)
    if last_exc:
        raise RuntimeError(
            f"Supabase poll failed after {timeout_seconds}s: {last_exc}"
        ) from last_exc
    return False


def _build_signed_request(
    payload: dict,
    secret: str,
) -> tuple[bytes, dict]:
    """Return (body_bytes, headers) with valid Toast-Signature header."""
    body_bytes = json.dumps(payload).encode("utf-8")
    signature = sign_webhook_payload(body_bytes, secret)
    headers = {
        "Content-Type": "application/json",
        # Header alias per pos_routes.py line 37: alias="Toast-Signature"
        "Toast-Signature": signature,
    }
    return body_bytes, headers


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


class TestToastPipeline:
    """Wave D: Toast webhook → full pipeline (TEST-PROD-04)."""

    async def test_webhook_returns_200_or_202(
        self,
        prod_base_url: str,
        toast_webhook_secret: str,
    ) -> None:
        """POST /api/v1/pos/webhook/toast with valid HMAC → 200/202 (not 401, 500).

        Verifies HMAC signing + route registration are correct.
        """
        payload = make_toast_webhook_payload()
        body_bytes, headers = _build_signed_request(payload, toast_webhook_secret)

        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await post_with_retry(
                client,
                "/api/v1/pos/webhook/toast",
                content=body_bytes,
                headers=headers,
                timeout=20.0,
            )
        assert resp.status_code in (200, 201, 202), (
            f"Expected 200/202 from Toast webhook endpoint, got {resp.status_code}.\n"
            f"If 401: TOAST_WEBHOOK_SECRET mismatch or wrong header name "
            f"(expected 'Toast-Signature').\n"
            f"If 404: route '/api/v1/pos/webhook/toast' not registered.\n"
            f"If 503: orchestrator not running or pos_integration_agent not started.\n"
            f"Body: {resp.text[:400]}"
        )

    async def test_webhook_rejected_without_signature(
        self,
        prod_base_url: str,
    ) -> None:
        """POST /api/v1/pos/webhook/toast without Toast-Signature → 401.

        Verifies HMAC guard is enforced in production (TOAST_WEBHOOK_SECRET set
        on Railway). ToastAdapter.verify_webhook returns False when signature=""
        and secret is set, causing pos_routes.py to raise HTTPException(401).

        Note: if TOAST_WEBHOOK_SECRET is NOT set on Railway, the adapter is
        fail-open (returns True) and this test will see 200 — a configuration
        issue, not a code bug.
        """
        payload = make_toast_webhook_payload()
        body_bytes = json.dumps(payload).encode("utf-8")

        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await client.post(
                "/api/v1/pos/webhook/toast",
                content=body_bytes,
                headers={"Content-Type": "application/json"},
                timeout=15.0,
            )
        assert resp.status_code == 401, (
            f"Expected 401 for webhook without signature, got {resp.status_code}. "
            "HMAC guard may not be enforced — check TOAST_WEBHOOK_SECRET on Railway."
        )

    async def test_pipeline_creates_supabase_record(
        self,
        prod_base_url: str,
        toast_webhook_secret: str,
        prod_supabase: Any,
        e2e_created_ids: list,
    ) -> None:
        """Deliver webhook; verify Supabase record in pos_webhook_logs within 15s.

        Full pipeline verification (TEST-PROD-04):
          POST /api/v1/pos/webhook/toast
            → pos_routes.py validates HMAC
            → POSIntegrationAgent.process_pos_event()
            → _log_webhook_event() inserts into pos_webhook_logs

        The order_guid lives inside payload JSONB column, not as a top-level column.
        Polling fetches recent rows and checks payload contents in Python.

        Teardown note: pos_webhook_logs has no restaurant_id or controllable id
        column. The registry entry below triggers teardown attempt which will fail
        silently (D-04 — NEVER raise). Tag-based sweep also won't match. The audit
        log record persists harmlessly after the run.
        """
        payload = make_toast_webhook_payload()
        body_bytes, headers = _build_signed_request(payload, toast_webhook_secret)

        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await post_with_retry(
                client,
                "/api/v1/pos/webhook/toast",
                content=body_bytes,
                headers=headers,
                timeout=20.0,
            )

        if resp.status_code not in (200, 201, 202):
            pytest.skip(
                f"Webhook delivery failed ({resp.status_code}) — "
                "skipping Supabase record assertion. Fix test_webhook_returns_200_or_202 first."
            )

        # Register for teardown (D-03). Teardown will fail silently because
        # pos_webhook_logs.id is a UUID (not E2E_ORDER_GUID) — see module docstring.
        e2e_created_ids.append({"table": E2E_TABLE_NAME, "id": E2E_ORDER_GUID})

        found = await poll_supabase_for_webhook_record(
            prod_supabase=prod_supabase,
            order_guid=E2E_ORDER_GUID,
            timeout_seconds=15.0,
        )
        assert found, (
            f"No pos_webhook_logs record with orderGuid='{E2E_ORDER_GUID}' found "
            f"within 15s after webhook delivery. "
            f"Check Railway logs for POSIntegrationAgent. "
            f"The pipeline may have rejected the e2e-test-restaurant ID at the "
            f"agent layer (POSIntegrationAgent validates restaurantGuid against "
            f"TOAST_RESTAURANT_GUID env var — set TOAST_RESTAURANT_GUID='e2e-test-restaurant' "
            f"on Railway or supply a real GUID via TOAST_RESTAURANT_GUID env var)."
        )
