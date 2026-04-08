"""
E2E Health Check Tests
=======================
Verifies that all registered router prefixes are reachable (non-404)
and that FastAPI default error handling is intact.

These tests catch router registration regressions without requiring
live Supabase or Anthropic connections.
"""

import pytest

pytestmark = pytest.mark.e2e

# Probe each router via a known endpoint.
# Response may be 200, 401, 405, 422, or 503 — anything but 404 confirms
# the router is registered and the prefix resolves correctly.
ROUTER_PROBE_ENDPOINTS = [
    # (prefix_label, path, method)
    ("onboarding",  "/api/v1/onboarding/extract",      "POST"),
    ("quality",     "/api/v1/quality/review-queue",    "GET"),
    ("research",    "/api/v1/research/metrics",        "GET"),
    ("preview",     "/api/v1/preview/detect",          "POST"),
    ("analytics",   "/api/v1/analytics/trends",        "GET"),
    ("studio",      "/api/v1/studio/queue",            "GET"),
]


class TestHealthEndpoint:
    def test_health_endpoint_returns_ok(self, test_client):
        """GET /health → 200 with body {status: ok}."""
        resp = test_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "ok"

    def test_unknown_route_returns_404(self, test_client):
        """GET /api/v1/nonexistent → 404 (FastAPI default)."""
        resp = test_client.get("/api/v1/nonexistent")
        assert resp.status_code == 404


class TestRouterRegistration:
    """Confirm all 6 router prefixes are registered (response != 404)."""

    @pytest.mark.parametrize("label,path,method", ROUTER_PROBE_ENDPOINTS)
    def test_all_router_prefixes_reachable(self, test_client, label, path, method):
        """
        Each registered router must expose at least one non-404 endpoint.
        POST endpoints return 405 on GET (acceptable) or 422 on no-body —
        both confirm the route exists.
        """
        if method == "GET":
            resp = test_client.get(path)
        else:
            # POST without a body — FastAPI returns 422 (validation) not 404
            resp = test_client.post(path, json=None)

        assert resp.status_code != 404, (
            f"Router '{label}' endpoint '{path}' returned 404 — "
            f"router may not be registered. Got: {resp.status_code}"
        )
