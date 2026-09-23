"""Tests for health and metrics API endpoints (OBS-02, OBS-03).

Uses httpx.AsyncClient with ASGITransport — starlette 0.35.1 is incompatible
with TestClient on httpx 0.28.x (same pattern as test_cors.py, test_analytics_routes.py).
"""

import asyncio
from collections import OrderedDict
from datetime import datetime, timedelta

import pytest
import httpx
from fastapi import FastAPI
from unittest.mock import AsyncMock, MagicMock, patch

ADMIN_KEY = "test-admin-key-99999"


async def test_agent_operation_requires_admin_key(health_client):
    response = await health_client.post(
        "/api/v1/health/agents/inventory/stop",
        json={"request_id": "cdd19719-0dd8-41e2-8dda-f0d16d5869ce"},
    )
    assert response.status_code == 401


@pytest.mark.parametrize("action", ["restart", "stop"])
async def test_agent_operation_calls_only_named_lifecycle(health_client, action):
    orchestrator = MagicMock()
    orchestrator.agents = {"inventory": object()}
    orchestrator.restart_agent = AsyncMock(
        return_value={"success": True, "private": "not returned"}
    )
    orchestrator.stop_agent = AsyncMock(return_value={"success": True})
    with patch("api.health_routes.get_orchestrator", return_value=orchestrator):
        response = await health_client.post(
            f"/api/v1/health/agents/inventory/{action}",
            headers={"X-Admin-Key": ADMIN_KEY},
            json={"request_id": "cdd19719-0dd8-41e2-8dda-f0d16d5869ce"},
        )
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "agent": "inventory",
        "action": action,
        "request_id": "cdd19719-0dd8-41e2-8dda-f0d16d5869ce",
    }
    getattr(orchestrator, f"{action}_agent").assert_awaited_once_with("inventory")


async def test_agent_failure_does_not_disclose_exception(health_client):
    orchestrator = MagicMock()
    orchestrator.agents = {"inventory": object()}
    orchestrator.stop_agent = AsyncMock(
        side_effect=RuntimeError("another house secret")
    )
    with patch("api.health_routes.get_orchestrator", return_value=orchestrator):
        response = await health_client.post(
            "/api/v1/health/agents/inventory/stop",
            headers={"X-Admin-Key": ADMIN_KEY},
            json={"request_id": "cdd19719-0dd8-41e2-8dda-f0d16d5869ce"},
        )
    assert response.json()["success"] is False
    assert "secret" not in response.text


async def test_agent_operation_unknown_name_never_dispatches(health_client):
    orchestrator = MagicMock()
    orchestrator.agents = {}
    orchestrator.stop_agent = AsyncMock()
    with patch("api.health_routes.get_orchestrator", return_value=orchestrator):
        response = await health_client.post(
            "/api/v1/health/agents/missing/stop",
            headers={"X-Admin-Key": ADMIN_KEY},
            json={"request_id": "cdd19719-0dd8-41e2-8dda-f0d16d5869ce"},
        )
    assert response.status_code == 404
    orchestrator.stop_agent.assert_not_awaited()


async def test_agent_operation_is_readable_by_request_id_after_it_completes(
    health_client,
):
    """The gateway's receipt reconciliation (agent-operations.controller.ts's
    `reconcile()`) reads this route back when its own POST response to the
    operation above was lost. Before this session, the route did not exist —
    every reconciliation attempt 404'd on the path itself, which the gateway
    happened to read as "absent" for the wrong reason (no route, not no
    record), and three documents claimed this settles receipts when nothing
    on this side ever wrote one.
    """
    orchestrator = MagicMock()
    orchestrator.agents = {"inventory": object()}
    orchestrator.restart_agent = AsyncMock(return_value={"success": True})
    request_id = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    with patch("api.health_routes.get_orchestrator", return_value=orchestrator):
        post = await health_client.post(
            "/api/v1/health/agents/inventory/restart",
            headers={"X-Admin-Key": ADMIN_KEY},
            json={"request_id": request_id},
        )
        assert post.status_code == 200
        get = await health_client.get(
            f"/api/v1/health/agent-operations/{request_id}",
            headers={"X-Admin-Key": ADMIN_KEY},
        )
    assert get.status_code == 200
    body = get.json()
    finished_at = body.pop("finished_at", None)
    assert body == {
        "request_id": request_id,
        "agent": "inventory",
        "action": "restart",
        "state": "succeeded",
    }
    assert finished_at and datetime.fromisoformat(finished_at)


async def test_agent_operation_readable_as_running_while_still_in_flight(
    health_client,
):
    """Before this fix (wave-5 IJ confirm R1), operate_agent wrote its record only
    on completion, so a reconciliation read during a slow drain 404'd exactly like
    a genuinely lost request -- indistinguishable from the orchestrator having
    restarted or never received it at all. Two real triggers landed in that
    window: AdminDesk.tsx's operate() re-reads immediately in its `finally`
    clause, and the 30s poll re-reads throughout a slow drain. The gateway's own
    reconcile() already had a `state === "running"` branch waiting for this
    (agent-operations.controller.ts) and needed no change once this side fed it.
    [CORRECTED 2026-09-19, wave-5 IJ verify pass: that branch only matches a
    receipt already stored as `running`; it does not cover the transition this
    fix enables. A `requested`/`unknown` receipt whose orchestrator record now
    reads `running` is written to `running` by a different branch inside the
    same `reconcile` (agent-operations.controller.ts:360-374), untouched by
    this Python-side change and not covered by this test, which only exercises
    the GET route below.]
    """
    orchestrator = MagicMock()
    orchestrator.agents = {"inventory": object()}
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_restart(name):
        started.set()
        await release.wait()
        return {"success": True}

    orchestrator.restart_agent = AsyncMock(side_effect=slow_restart)
    request_id = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
    with patch("api.health_routes.get_orchestrator", return_value=orchestrator):
        post_task = asyncio.create_task(
            health_client.post(
                "/api/v1/health/agents/inventory/restart",
                headers={"X-Admin-Key": ADMIN_KEY},
                json={"request_id": request_id},
            )
        )
        try:
            await asyncio.wait_for(started.wait(), timeout=2)
            get = await health_client.get(
                f"/api/v1/health/agent-operations/{request_id}",
                headers={"X-Admin-Key": ADMIN_KEY},
            )
            assert get.status_code == 200
            body = get.json()
            assert body["state"] == "running"
            assert body.get("finished_at") is None
        finally:
            release.set()
        post = await post_task
    assert post.status_code == 200
    assert post.json()["success"] is True


async def test_agent_operation_failure_is_recorded_as_failed_not_dropped(health_client):
    orchestrator = MagicMock()
    orchestrator.agents = {"inventory": object()}
    orchestrator.stop_agent = AsyncMock(
        side_effect=RuntimeError("another house secret")
    )
    request_id = "8f14e45f-ceea-467e-adde-3fb5ba334205"
    with patch("api.health_routes.get_orchestrator", return_value=orchestrator):
        await health_client.post(
            "/api/v1/health/agents/inventory/stop",
            headers={"X-Admin-Key": ADMIN_KEY},
            json={"request_id": request_id},
        )
        get = await health_client.get(
            f"/api/v1/health/agent-operations/{request_id}",
            headers={"X-Admin-Key": ADMIN_KEY},
        )
    assert get.status_code == 200
    body = get.json()
    assert body["state"] == "failed"
    assert "secret" not in get.text  # the exception text never crosses this API either


async def test_get_agent_operation_unknown_id_returns_404_not_absent_by_accident(
    health_client,
):
    resp = await health_client.get(
        "/api/v1/health/agent-operations/00000000-0000-4000-8000-000000000000",
        headers={"X-Admin-Key": ADMIN_KEY},
    )
    assert resp.status_code == 404


async def test_get_agent_operation_requires_admin_key(health_client):
    resp = await health_client.get(
        "/api/v1/health/agent-operations/00000000-0000-4000-8000-000000000000"
    )
    assert resp.status_code == 401


async def test_operation_records_evict_oldest_once_past_the_cap(monkeypatch):
    import api.health_routes as health_routes

    monkeypatch.setattr(health_routes, "_operation_records", OrderedDict())
    monkeypatch.setattr(health_routes, "_OPERATION_RECORD_MAX", 2)
    monkeypatch.setattr(health_routes, "_OPERATION_RECORD_TTL", timedelta(hours=24))
    health_routes._record_operation("a", "inventory", "restart", "succeeded")
    health_routes._record_operation("b", "inventory", "restart", "succeeded")
    health_routes._record_operation("c", "inventory", "restart", "succeeded")
    assert list(health_routes._operation_records.keys()) == ["b", "c"]


async def test_operation_records_evict_by_age_not_only_by_count(monkeypatch):
    import api.health_routes as health_routes

    monkeypatch.setattr(health_routes, "_operation_records", OrderedDict())
    monkeypatch.setattr(health_routes, "_OPERATION_RECORD_MAX", 500)
    monkeypatch.setattr(health_routes, "_OPERATION_RECORD_TTL", timedelta(seconds=0))
    health_routes._record_operation("old", "inventory", "restart", "succeeded")
    health_routes._record_operation("new", "inventory", "restart", "succeeded")
    assert "old" not in health_routes._operation_records
    assert "new" in health_routes._operation_records


async def test_operation_record_reinserted_on_completion_keeps_sweep_order_correct(
    monkeypatch,
):
    """A "running" record written at dispatch and later updated to a terminal
    state reuses the same request id. If that update mutated the dict entry in
    place rather than re-inserting it (this test's regression target), the
    entry would keep its old front-of-the-dict position while carrying a fresh
    `_recorded_at` -- the sweep in `_record_operation` assumes dict order
    tracks recency and stops at the first non-expired entry it finds, so a
    stale-position-but-fresh-value entry at the front would make it stop
    immediately and never reach a genuinely expired entry recorded after it.
    """
    import api.health_routes as health_routes

    monkeypatch.setattr(health_routes, "_operation_records", OrderedDict())
    monkeypatch.setattr(health_routes, "_OPERATION_RECORD_MAX", 500)
    monkeypatch.setattr(health_routes, "_OPERATION_RECORD_TTL", timedelta(hours=24))
    health_routes._record_operation("A", "inventory", "restart", "running")
    health_routes._record_operation("B", "inventory", "restart", "succeeded")
    # Simulate time passing: "B" is now well past the 24h TTL set above.
    health_routes._operation_records["B"]["_recorded_at"] -= timedelta(hours=48)
    # "A" completes and is re-recorded under the same request id, with a fresh
    # timestamp. Correct behaviour moves it to the end of iteration order.
    health_routes._record_operation("A", "inventory", "restart", "succeeded")
    # A fresh write triggers the next sweep pass.
    health_routes._record_operation("C", "inventory", "restart", "succeeded")
    assert "B" not in health_routes._operation_records, (
        "B is 48h old against a 24h TTL and should have been swept; if it "
        "survives, A's re-record left it in the front position with a fresh "
        "timestamp, and the sweep stopped there before ever reaching B."
    )
    assert "A" in health_routes._operation_records
    assert "C" in health_routes._operation_records


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


async def test_health_agents_non_ascii_key_returns_401_not_500(health_client):
    # hmac.compare_digest(str, str) raises TypeError for a non-ASCII string.
    # HTTP headers are latin-1 at the wire; httpx's str encoder refuses a
    # non-ASCII str outright, so the raw (already-encoded) bytes are what an
    # ASGI app actually receives and decodes as latin-1 into `x_admin_key`.
    # A bad key must read as "wrong key" (401), never as an uncaught 500.
    resp = await health_client.get(
        "/api/v1/health/agents",
        headers={"X-Admin-Key": "wrong-é-key".encode("latin-1")},
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
