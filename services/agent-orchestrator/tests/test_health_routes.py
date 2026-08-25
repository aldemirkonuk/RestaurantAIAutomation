"""Tests for health and metrics API endpoints (OBS-02, OBS-03).

Uses httpx.AsyncClient with ASGITransport — starlette 0.35.1 is incompatible
with TestClient on httpx 0.28.x (same pattern as test_cors.py, test_analytics_routes.py).
"""

import pytest
import httpx
from fastapi import FastAPI
from unittest.mock import AsyncMock, MagicMock, patch

ADMIN_KEY = "test-admin-key-99999"


def _make_health_app() -> FastAPI:
    """Minimal FastAPI app with only health_routes registered."""
    from api.health_routes import router

    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
async def health_client(monkeypatch):
    """Async httpx client with health_routes registered and ADMIN_API_KEY patched."""
    monkeypatch.setenv("ADMIN_API_KEY", ADMIN_KEY)
    app = _make_health_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        yield client


async def test_health_agents_requires_admin_key(health_client):
    resp = await health_client.get("/api/v1/health/agents")
    assert resp.status_code == 401


async def test_health_agents_wrong_key_returns_401(health_client):
    resp = await health_client.get(
        "/api/v1/health/agents", headers={"X-Admin-Key": "wrong"}
    )
    assert resp.status_code == 401


async def test_health_agents_503_without_orchestrator(health_client):
    with patch("api.health_routes.get_orchestrator", return_value=None):
        resp = await health_client.get(
            "/api/v1/health/agents", headers={"X-Admin-Key": ADMIN_KEY}
        )
    assert resp.status_code == 503


async def test_health_agents_returns_agent_list(health_client):
    mock_agent = MagicMock()
    mock_agent.get_health.return_value = {
        "agent_name": "pos_integration_agent",
        "status": "active",
        "healthy": True,
        "capabilities": [],
    }
    mock_orch = MagicMock()
    mock_orch.agents = {"pos_integration_agent": mock_agent}

    with patch("api.health_routes.get_orchestrator", return_value=mock_orch):
        resp = await health_client.get(
            "/api/v1/health/agents", headers={"X-Admin-Key": ADMIN_KEY}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert data["agents"][0]["agent_name"] == "pos_integration_agent"


async def test_health_agent_by_name_not_found(health_client):
    mock_orch = MagicMock()
    mock_orch.agents = {}
    with patch("api.health_routes.get_orchestrator", return_value=mock_orch):
        resp = await health_client.get(
            "/api/v1/health/agents/nonexistent", headers={"X-Admin-Key": ADMIN_KEY}
        )
    assert resp.status_code == 404


async def test_metrics_requires_admin_key(health_client):
    resp = await health_client.get("/api/v1/metrics")
    assert resp.status_code == 401


async def test_metrics_returns_dlq_size_key(health_client):
    mock_orch = MagicMock()
    # get_metrics is `async def` (core/orchestrator.py). Mocking it as sync
    # made this test pass against a route that had forgotten to await it —
    # the mock encoded the bug. AsyncMock matches the real signature.
    mock_orch.get_metrics = AsyncMock(return_value={"agents": {}, "aggregated": {}})
    mock_settings = MagicMock()
    mock_settings.supabase_client = (
        None  # No DB — triggers except branch (dlq_size = -1)
    )

    with patch("api.health_routes.get_orchestrator", return_value=mock_orch), patch(
        "api.health_routes.get_settings", return_value=mock_settings
    ):
        resp = await health_client.get(
            "/api/v1/metrics", headers={"X-Admin-Key": ADMIN_KEY}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "dlq_size" in data
    assert "active_sagas" in data
