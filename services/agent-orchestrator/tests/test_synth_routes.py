"""Wave 3 — thin FastAPI admin synth routes (X-Admin-Key + dry-run default)."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI

ADMIN_KEY = "test-admin-key-synth-37"


def _make_synth_app() -> FastAPI:
    from api.synth_routes import router

    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
async def synth_client(monkeypatch):
    monkeypatch.setenv("ADMIN_API_KEY", ADMIN_KEY)
    app = _make_synth_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        yield client


async def test_synth_generate_requires_admin_key(synth_client):
    resp = await synth_client.post("/api/v1/admin/synth/generate", json={})
    assert resp.status_code == 401


async def test_synth_generate_wrong_key_401(synth_client):
    resp = await synth_client.post(
        "/api/v1/admin/synth/generate",
        json={"archetype": "bistro"},
        headers={"X-Admin-Key": "wrong"},
    )
    assert resp.status_code == 401


async def test_synth_generate_apply_defaults_false(synth_client):
    with patch("api.synth_routes.apply_seed") as apply_seed:
        apply_seed.return_value = {
            "archetype_id": "bistro",
            "dry_run": True,
            "apply": False,
            "slug": "sim-bistro",
        }
        resp = await synth_client.post(
            "/api/v1/admin/synth/generate",
            json={"archetype": "bistro"},
            headers={"X-Admin-Key": ADMIN_KEY},
        )
    assert resp.status_code == 200
    apply_seed.assert_called()
    kwargs = apply_seed.call_args.kwargs
    assert kwargs.get("apply") is False


async def test_synth_teardown_apply_defaults_false(synth_client):
    with patch("api.synth_routes.teardown_sim") as teardown:
        teardown.return_value = {"ok": True, "dry_run": True}
        resp = await synth_client.post(
            "/api/v1/admin/synth/teardown",
            json={},
            headers={"X-Admin-Key": ADMIN_KEY},
        )
    assert resp.status_code == 200
    assert teardown.call_args.kwargs.get("apply") is False


async def test_synth_refresh_requires_admin_key(synth_client):
    resp = await synth_client.post("/api/v1/admin/synth/refresh", json={})
    assert resp.status_code == 401
