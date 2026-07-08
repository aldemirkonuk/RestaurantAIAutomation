"""
Wave A: API Contract Tests (TEST-PROD-01)
==========================================
Validates every /api/v1/ endpoint on the live Railway agent-orchestrator.

Pass criteria (per D-10 and ROADMAP success criteria 1):
  - Public /health → 200
  - Auth-protected routes → 401 without credentials
  - Auth-protected routes → 200/204 with correct credentials
  - Zero 500 errors on any probe

Run: pytest tests/e2e/wave_a_api_contracts.py --junitxml=test-results/wave_a.xml
Depends on: conftest_prod.py session fixtures (prod_base_url, prod_jwt, prod_admin_headers)
"""

import httpx
import pytest
from e2e.conftest_prod import get_with_retry

pytestmark = pytest.mark.prod_e2e


class TestPublicEndpoints:
    """Endpoints that require NO authentication."""

    async def test_health_check_public(self, prod_base_url: str):
        """GET /health → 200 with {status: ok} — no auth required (TEST-PROD-01)."""
        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await get_with_retry(client, "/health", timeout=15.0)
        assert (
            resp.status_code == 200
        ), f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        assert data.get("status") == "ok", f"Expected status:ok, got: {data}"

    async def test_unknown_route_404(self, prod_base_url: str):
        """GET /api/v1/nonexistent → 404 (FastAPI default, router not silently catching all)."""
        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await client.get("/api/v1/nonexistent-e2e-probe", timeout=15.0)
        assert (
            resp.status_code == 404
        ), f"Expected 404 for unknown route, got {resp.status_code}"


class TestUnauthenticatedReturns401:
    """Auth-protected endpoints must return 401 without credentials."""

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/quality/review-queue",
            "/api/v1/analytics/trends",
            "/api/v1/studio/queue",
        ],
    )
    async def test_user_jwt_endpoint_requires_auth(self, prod_base_url: str, path: str):
        """User-JWT endpoints return 401 without Bearer token (TEST-PROD-01)."""
        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await client.get(path, timeout=15.0)
        assert resp.status_code in (
            401,
            403,
        ), f"Expected 401/403 on {path} without auth, got {resp.status_code}"

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/research/metrics",
            "/api/v1/health/agents",
            "/api/v1/metrics",
        ],
    )
    async def test_admin_key_endpoint_requires_auth(
        self, prod_base_url: str, path: str
    ):
        """Admin-key endpoints return 401 without X-Admin-Key header (TEST-PROD-01)."""
        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await client.get(path, timeout=15.0)
        assert resp.status_code in (
            401,
            403,
        ), f"Expected 401/403 on {path} without X-Admin-Key, got {resp.status_code}"


class TestAuthenticatedEndpoints:
    """Auth-protected endpoints return expected 2xx with correct credentials."""

    @pytest.mark.parametrize(
        "path,expected_statuses",
        [
            ("/api/v1/quality/review-queue", [200, 204]),
            ("/api/v1/analytics/trends", [200, 204]),
            ("/api/v1/studio/queue", [200, 204]),
        ],
    )
    async def test_user_jwt_endpoints_accessible(
        self,
        prod_base_url: str,
        prod_jwt: str,
        path: str,
        expected_statuses: list,
    ):
        """User-JWT endpoints return 200/204 with valid Bearer token (TEST-PROD-01)."""
        headers = {"Authorization": f"Bearer {prod_jwt}"}
        async with httpx.AsyncClient(base_url=prod_base_url, headers=headers) as client:
            resp = await get_with_retry(client, path, timeout=20.0)
        assert resp.status_code in expected_statuses, (
            f"Expected {expected_statuses} on {path} with JWT, "
            f"got {resp.status_code}: {resp.text[:200]}"
        )
        assert resp.status_code != 500, f"500 error on {path}: {resp.text[:300]}"

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/research/metrics",
            "/api/v1/health/agents",
            "/api/v1/metrics",
        ],
    )
    async def test_admin_key_endpoints_accessible(
        self,
        prod_base_url: str,
        prod_admin_headers: dict,
        path: str,
    ):
        """Admin-key endpoints return 200 with X-Admin-Key header (TEST-PROD-01)."""
        async with httpx.AsyncClient(
            base_url=prod_base_url, headers=prod_admin_headers
        ) as client:
            resp = await get_with_retry(client, path, timeout=20.0)
        assert resp.status_code == 200, (
            f"Expected 200 on {path} with X-Admin-Key, "
            f"got {resp.status_code}: {resp.text[:200]}"
        )
        assert resp.status_code != 500, f"500 error on {path}: {resp.text[:300]}"

    async def test_onboarding_router_reachable(self, prod_base_url: str, prod_jwt: str):
        """POST /api/v1/onboarding/extract without body → 422 (router registered, not 404)."""
        headers = {"Authorization": f"Bearer {prod_jwt}"}
        async with httpx.AsyncClient(base_url=prod_base_url, headers=headers) as client:
            resp = await client.post(
                "/api/v1/onboarding/extract", json=None, timeout=15.0
            )
        assert (
            resp.status_code != 404
        ), "onboarding router not registered — got 404 (expected 422 or 401)"
        assert (
            resp.status_code != 500
        ), f"500 on /api/v1/onboarding/extract: {resp.text[:200]}"

    async def test_preview_router_reachable(self, prod_base_url: str):
        """POST /api/v1/preview/detect without body → 422 (router registered, not 404)."""
        async with httpx.AsyncClient(base_url=prod_base_url) as client:
            resp = await client.post("/api/v1/preview/detect", json=None, timeout=15.0)
        assert (
            resp.status_code != 404
        ), "preview router not registered — got 404 (expected 422)"

    async def test_per_agent_health_detail(
        self, prod_base_url: str, prod_admin_headers: dict
    ):
        """GET /api/v1/health/agents/inventory_engine → 200 or 404 (not 500, not 401)."""
        async with httpx.AsyncClient(
            base_url=prod_base_url, headers=prod_admin_headers
        ) as client:
            resp = await get_with_retry(
                client, "/api/v1/health/agents/inventory_engine", timeout=15.0
            )
        assert resp.status_code in (
            200,
            404,
        ), f"Expected 200 or 404 for per-agent detail, got {resp.status_code}"
        assert resp.status_code != 500
