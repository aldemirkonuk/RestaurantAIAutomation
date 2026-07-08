"""Unit tests for CORS middleware (INFRA-01).

Uses httpx.AsyncClient with ASGITransport because starlette 0.35.1's
TestClient is incompatible with httpx 0.28.x (removed sync ASGI transport).
pytest-asyncio is configured as asyncio_mode=auto in pytest.ini so these
async test functions are collected automatically.
"""

import json
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def _make_app(allowed_origins) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/test")
    def test_route():
        return {"ok": True}

    return app


async def _get(app, path, headers=None):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        return await client.get(path, headers=headers or {})


async def _options(app, path, headers=None):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        return await client.options(path, headers=headers or {})


async def test_cors_header_present_for_allowed_origin():
    app = _make_app(["http://localhost:5173"])
    resp = await _get(app, "/test", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"


async def test_cors_preflight_returns_200():
    app = _make_app(["http://localhost:5173"])
    resp = await _options(
        app,
        "/test",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 200


async def test_cors_absent_for_unknown_origin():
    app = _make_app(["http://localhost:5173"])
    resp = await _get(app, "/test", headers={"Origin": "http://evil.com"})
    assert "access-control-allow-origin" not in resp.headers


async def test_allowed_origins_json_array_parses():
    raw = '["http://localhost:5173", "https://myapp.vercel.app"]'
    origins = json.loads(raw)
    app = _make_app(origins)
    for origin in origins:
        resp = await _get(app, "/test", headers={"Origin": origin})
        assert resp.headers.get("access-control-allow-origin") == origin
