"""Tests for the /api/v1/toast router — the missing NestJS ↔ orchestrator half.

Two things are under test and they are separate concerns:

1. **Shape.** Each of the six endpoints returns the gateway's contracted DTO
   shape (`apps/api-gateway/src/toast/dto/*`) when the client answers.
2. **Honesty.** Each endpoint surfaces an honest error — never an empty list, a
   zero, or a synthesized body — when the client is unconfigured or raises.
   This is ADR 0020 (LOCKED) and it is the reason this work exists.

Nothing here touches the real Toast API. The client is replaced wholesale via
`app.dependency_overrides`, and the strict-mode client tests drive the real
`ToastAPIClient` with its HTTP layer mocked, following
`tests/test_toast_api_client.py`'s approach.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI

from api.toast_routes import get_toast_client, router
from services.toast_api_client import (
    ToastAPIClient,
    ToastNotConfigured,
    ToastNotFound,
    ToastUnavailable,
)

ADMIN_KEY = "test-admin-key-toast"
AUTH = {"X-Admin-Key": ADMIN_KEY}


def _make_app(client_stub: Any) -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_toast_client] = lambda: client_stub
    return app


@pytest.fixture
def stub() -> MagicMock:
    """A stand-in Toast client whose every method is an AsyncMock."""
    c = MagicMock(spec=ToastAPIClient)
    c.fetch_menus = AsyncMock()
    c.fetch_menu = AsyncMock()
    c.create_order = AsyncMock()
    c.fetch_order = AsyncMock()
    c.fetch_sales_data = AsyncMock()
    c.get_statistics = MagicMock(
        return_value={
            "mode": "real",
            "total_api_calls": 3,
            "total_sales_fetched": 7,
            "mock_sales_generated": 0,
            "is_streaming": False,
            "strict": True,
            "credentials_present": True,
        }
    )
    return c


@pytest.fixture
async def api(stub: MagicMock, monkeypatch):
    monkeypatch.setenv("ADMIN_API_KEY", ADMIN_KEY)
    transport = httpx.ASGITransport(app=_make_app(stub))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        yield client


# A time window reused by the sales tests.
_START = datetime(2026, 8, 1, 18, 0, 0)
_END = _START + timedelta(hours=2)
_RANGE = {"start_time": _START.isoformat(), "end_time": _END.isoformat()}


# ── 1. Contracted shape from a mocked client ─────────────────────────────────


async def test_menus_returns_menu_list_dto_shape(api, stub):
    stub.fetch_menus.return_value = {
        "menus": [
            {
                "guid": "menu-001",
                "name": "Main Wine List",
                "items": [
                    {
                        "guid": "item-001",
                        "name": "Opus One 2019",
                        "price": 4500,
                        "type": "red",
                    },
                ],
            }
        ]
    }

    resp = await api.get(
        "/api/v1/toast/menus", params={"restaurant_id": "r1"}, headers=AUTH
    )

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"menus", "total"}
    assert body["total"] == 1
    menu = body["menus"][0]
    # ToastMenuDto: guid, name, groups[], isActive
    assert menu["guid"] == "menu-001"
    assert menu["name"] == "Main Wine List"
    assert menu["isActive"] is True
    assert isinstance(menu["groups"], list) and len(menu["groups"]) == 1
    item = menu["groups"][0]["items"][0]
    # ToastMenuItemDto: guid, name, price, isAvailable (+ optional category)
    assert item["guid"] == "item-001"
    assert item["price"] == 4500
    assert item["isAvailable"] is True
    assert item["category"] == "red"
    stub.fetch_menus.assert_awaited_once_with("r1")


async def test_menus_maps_real_toast_menu_groups(api, stub):
    """Real Toast nests items under menuGroups[].menuItems[] — not a flat list."""
    stub.fetch_menus.return_value = {
        "menus": [
            {
                "guid": "m1",
                "name": "Dinner",
                "menuGroups": [
                    {
                        "guid": "g1",
                        "name": "Reds",
                        "menuItems": [
                            {"guid": "i1", "name": "Barolo", "price": 6000},
                        ],
                    }
                ],
            }
        ]
    }

    body = (await api.get("/api/v1/toast/menus", headers=AUTH)).json()

    groups = body["menus"][0]["groups"]
    assert [g["guid"] for g in groups] == ["g1"]
    assert groups[0]["items"][0]["name"] == "Barolo"


async def test_menu_by_id_returns_menu_dto_shape(api, stub):
    stub.fetch_menu.return_value = {
        "guid": "menu-002",
        "name": "By The Glass",
        "items": [{"guid": "item-101", "name": "Caymus", "price": 2400}],
    }

    resp = await api.get("/api/v1/toast/menus/menu-002", headers=AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["guid"] == "menu-002"
    assert body["groups"][0]["items"][0]["guid"] == "item-101"
    stub.fetch_menu.assert_awaited_once_with("menu-002")


async def test_create_order_returns_order_dto_shape(api, stub):
    stub.create_order.return_value = {
        "guid": "order-guid-1",
        "displayNumber": 42,
        "openedDate": "2026-08-01T19:00:00Z",
        "checks": [
            {
                "amount": 4500,
                "taxAmount": 394,
                "selections": [
                    {
                        "itemGuid": "item-001",
                        "displayName": "Opus One 2019",
                        "quantity": 1,
                        "price": 4500,
                    },
                ],
            }
        ],
    }

    resp = await api.post(
        "/api/v1/toast/orders",
        json={
            "restaurant_id": "r1",
            "tableName": "Table 5",
            "items": [
                {
                    "itemGuid": "item-001",
                    "name": "Opus One 2019",
                    "quantity": 1,
                    "unitPrice": 4500,
                }
            ],
        },
        headers=AUTH,
    )

    assert resp.status_code == 201
    body = resp.json()
    # ToastOrderResponseDto
    assert body["guid"] == "order-guid-1"
    assert body["orderNumber"] == "42"  # DTO types orderNumber as a string
    assert body["status"] == "open"
    assert body["subtotal"] == 4500
    assert body["tax"] == 394
    assert body["total"] == 4894
    assert body["items"][0]["itemGuid"] == "item-001"
    assert body["createdAt"] == "2026-08-01T19:00:00Z"
    # restaurant_id travels as the positional arg, not inside the payload
    args, _ = stub.create_order.await_args
    assert args[0] == "r1"
    assert "restaurant_id" not in args[1]


async def test_create_order_is_called_exactly_once_and_never_retried(api, stub):
    """A vendor order must not be re-attempted on failure. One call, or none."""
    stub.create_order.side_effect = ToastUnavailable("timeout")

    resp = await api.post(
        "/api/v1/toast/orders",
        json={
            "restaurant_id": "r1",
            "items": [{"itemGuid": "i", "name": "n", "quantity": 1, "unitPrice": 100}],
        },
        headers=AUTH,
    )

    assert resp.status_code == 503
    assert stub.create_order.await_count == 1


async def test_order_by_id_returns_order_dto_shape(api, stub):
    stub.fetch_order.return_value = {
        "guid": "order-guid-9",
        "displayNumber": 7,
        "openedDate": "2026-08-01T19:00:00Z",
        "closedDate": "2026-08-01T20:30:00Z",
        "table": {"name": "Table 12"},
        "server": {"firstName": "Alex"},
        "checks": [
            {
                "amount": 2400,
                "taxAmount": 210,
                "selections": [
                    {
                        "itemGuid": "i2",
                        "displayName": "Caymus",
                        "quantity": 2,
                        "price": 1200,
                    },
                ],
            }
        ],
    }

    resp = await api.get("/api/v1/toast/orders/order-guid-9", headers=AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["guid"] == "order-guid-9"
    assert body["status"] == "closed"
    assert body["closedAt"] == "2026-08-01T20:30:00Z"
    assert body["tableName"] == "Table 12"
    assert body["serverName"] == "Alex"
    assert body["items"][0]["quantity"] == 2
    stub.fetch_order.assert_awaited_once_with("order-guid-9")


async def test_sales_returns_sales_dto_shape_camelcased(api, stub):
    stub.fetch_sales_data.return_value = [
        {
            "id": "sale-1",
            "order_guid": "og-1",
            "item_name": "Opus One 2019",
            "wine_type": "red",
            "quantity": 2,
            "unit_price": 45.0,
            "total_price": 90.0,
            "timestamp": "2026-08-01T19:30:00Z",
            "server_name": "Alex",
            "table_name": "Table 5",
            "source": "toast_api",
        }
    ]

    resp = await api.get(
        "/api/v1/toast/sales", params={"restaurant_id": "r1", **_RANGE}, headers=AUTH
    )

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"sales", "total", "totalRevenue", "startTime", "endTime"}
    assert body["total"] == 1
    assert body["totalRevenue"] == 90.0
    sale = body["sales"][0]
    # snake_case in, camelCase out — the DTO's contract
    assert sale["orderGuid"] == "og-1"
    assert sale["itemName"] == "Opus One 2019"
    assert sale["wineType"] == "red"
    assert sale["unitPrice"] == 45.0
    assert sale["totalPrice"] == 90.0
    assert sale["serverName"] == "Alex"
    assert sale["tableName"] == "Table 5"
    assert "unit_price" not in sale


async def test_sales_maps_real_path_rows_that_carry_only_price(api, stub):
    """`_extract_wine_items` emits `price`, not unit_price/total_price.

    totalPrice must be derived, never defaulted to 0 — a zero here would read as
    "this sale earned nothing".
    """
    stub.fetch_sales_data.return_value = [
        {
            "id": "s2",
            "order_guid": "og-2",
            "item_name": "Chardonnay Reserve",
            "quantity": 2,
            "price": 24.0,
            "timestamp": "2026-08-01T20:00:00Z",
            "source": "toast_api",
        }
    ]

    body = (await api.get("/api/v1/toast/sales", params=_RANGE, headers=AUTH)).json()

    sale = body["sales"][0]
    assert sale["unitPrice"] == 24.0
    assert sale["totalPrice"] == 48.0
    assert body["totalRevenue"] == 48.0


async def test_statistics_returns_client_stats(api, stub):
    resp = await api.get("/api/v1/toast/statistics", headers=AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "real"
    assert body["total_api_calls"] == 3
    assert body["credentials_present"] is True
    # Counters are process-local; the response says so rather than implying it.
    assert body["scope"] == "process"


# ── 2. Honest failure — never a fabricated body ──────────────────────────────


def _unconfigured_app() -> FastAPI:
    """App whose Toast dependency fails the way an unconfigured deploy does."""
    app = FastAPI()
    app.include_router(router)

    async def _boom():
        raise ToastNotConfigured(
            "Toast credentials are not configured "
            "(TOAST_CLIENT_ID / TOAST_CLIENT_SECRET)."
        )

    # Mirrors the real dependency: it maps the raise to a 503 itself.
    from api.toast_routes import _raise_http_for

    async def _dep():
        try:
            await _boom()
        except Exception as exc:
            _raise_http_for(exc, "Toast connection")

    app.dependency_overrides[get_toast_client] = _dep
    return app


@pytest.fixture
async def unconfigured_api(monkeypatch):
    monkeypatch.setenv("ADMIN_API_KEY", ADMIN_KEY)
    transport = httpx.ASGITransport(app=_unconfigured_app())
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        yield client


_ALL_SIX = [
    ("GET", "/api/v1/toast/menus", None),
    ("GET", "/api/v1/toast/menus/menu-001", None),
    (
        "POST",
        "/api/v1/toast/orders",
        {
            "restaurant_id": "r1",
            "items": [{"itemGuid": "i", "name": "n", "quantity": 1, "unitPrice": 100}],
        },
    ),
    ("GET", "/api/v1/toast/orders/order-1", None),
    ("GET", "/api/v1/toast/sales", None),
    ("GET", "/api/v1/toast/statistics", None),
]


@pytest.mark.parametrize("method,path,body", _ALL_SIX)
async def test_every_endpoint_is_honest_when_toast_is_unconfigured(
    unconfigured_api, method, path, body
):
    """No route may answer with mock data, an empty list, or a zero. ADR 0020."""
    params = _RANGE if path.endswith("/sales") else None
    resp = await unconfigured_api.request(
        method, path, json=body, params=params, headers=AUTH
    )

    assert resp.status_code == 503, f"{method} {path} did not fail honestly"
    detail = resp.json()["detail"]
    assert "not configured" in detail
    # The body must not be a plausible-looking success payload.
    assert set(resp.json()) == {"detail"}


@pytest.mark.parametrize(
    "attr,method,path,body",
    [
        ("fetch_menus", "GET", "/api/v1/toast/menus", None),
        ("fetch_menu", "GET", "/api/v1/toast/menus/m1", None),
        (
            "create_order",
            "POST",
            "/api/v1/toast/orders",
            {
                "restaurant_id": "r1",
                "items": [
                    {"itemGuid": "i", "name": "n", "quantity": 1, "unitPrice": 100}
                ],
            },
        ),
        ("fetch_order", "GET", "/api/v1/toast/orders/o1", None),
        ("fetch_sales_data", "GET", "/api/v1/toast/sales", None),
    ],
)
async def test_every_endpoint_is_honest_when_the_client_raises(
    api, stub, attr, method, path, body
):
    """A reachability failure is a 503, not an empty success."""
    getattr(stub, attr).side_effect = ToastUnavailable("connection reset")

    params = _RANGE if path.endswith("/sales") else None
    resp = await api.request(method, path, json=body, params=params, headers=AUTH)

    assert resp.status_code == 503
    assert "unreachable" in resp.json()["detail"]
    assert set(resp.json()) == {"detail"}


async def test_sales_failure_is_not_an_empty_list(api, stub):
    """The specific regression: an outage must not render as 'no sales today'."""
    stub.fetch_sales_data.side_effect = ToastUnavailable("gateway timeout")

    resp = await api.get("/api/v1/toast/sales", params=_RANGE, headers=AUTH)

    assert resp.status_code == 503
    assert "sales" not in resp.json()
    assert "totalRevenue" not in resp.json()


async def test_missing_resource_is_404_not_503(api, stub):
    """An outage and a deletion must not look the same to the caller."""
    stub.fetch_order.side_effect = ToastNotFound("Toast order 'o404' not found")

    resp = await api.get("/api/v1/toast/orders/o404", headers=AUTH)

    assert resp.status_code == 404


async def test_menu_not_found_in_client_is_404(api, stub):
    stub.fetch_menu.side_effect = ValueError("Menu not found")

    resp = await api.get("/api/v1/toast/menus/nope", headers=AUTH)

    assert resp.status_code == 404


async def test_unexpected_error_is_502_not_a_body(api, stub):
    stub.fetch_menus.side_effect = TypeError("mapper blew up")

    resp = await api.get("/api/v1/toast/menus", headers=AUTH)

    assert resp.status_code == 502
    assert set(resp.json()) == {"detail"}


async def test_sales_rejects_inverted_time_range(api, stub):
    resp = await api.get(
        "/api/v1/toast/sales",
        params={"start_time": _END.isoformat(), "end_time": _START.isoformat()},
        headers=AUTH,
    )

    assert resp.status_code == 422
    stub.fetch_sales_data.assert_not_awaited()


# ── 3. Auth gate ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("method,path,body", _ALL_SIX)
async def test_every_endpoint_requires_the_admin_key(api, stub, method, path, body):
    params = _RANGE if path.endswith("/sales") else None
    resp = await api.request(method, path, json=body, params=params)

    assert resp.status_code == 401


async def test_create_order_never_reaches_toast_without_auth(api, stub):
    """The vendor-order route must be unreachable unauthenticated."""
    await api.post(
        "/api/v1/toast/orders",
        json={
            "restaurant_id": "r1",
            "items": [{"itemGuid": "i", "name": "n", "quantity": 1, "unitPrice": 100}],
        },
    )

    stub.create_order.assert_not_awaited()


# ── 4. Strict mode on the real client (HTTP layer mocked) ────────────────────
# These drive ToastAPIClient itself, proving the router's honesty guarantee is
# backed by the client rather than only by the stub above.


def _strict_client() -> ToastAPIClient:
    return ToastAPIClient(
        toast_client_id="id",
        toast_client_secret="secret",
        toast_restaurant_guid="guid",
        mock_mode=False,
        strict=True,
    )


async def test_strict_connect_refuses_without_credentials():
    client = ToastAPIClient(mock_mode=False, strict=True)
    with pytest.raises(ToastNotConfigured):
        await client.connect()
    await client.disconnect()


async def test_strict_connect_does_not_silently_flip_to_mock():
    """The original defect: a failed auth set mock_mode=True and carried on."""
    client = _strict_client()
    client.http_client = MagicMock()
    client.http_client.post = AsyncMock(side_effect=httpx.ConnectError("nope"))
    client.http_client.aclose = AsyncMock()

    with pytest.raises(ToastUnavailable):
        await client.connect()

    assert client.mock_mode is False


async def test_strict_fetch_menus_raises_instead_of_returning_mock_menus():
    client = _strict_client()
    client.http_client = MagicMock()
    client.http_client.post = AsyncMock(side_effect=httpx.ConnectError("nope"))

    with pytest.raises(ToastUnavailable):
        await client.fetch_menus("r1")


async def test_strict_create_order_never_fabricates_a_created_order():
    """Non-strict returns status 'mock_created' — a claim no order supports."""
    client = _strict_client()
    client.http_client = MagicMock()
    client.http_client.post = AsyncMock(side_effect=httpx.ConnectError("nope"))

    with pytest.raises(ToastUnavailable):
        await client.create_order("r1", {"items": []})


async def test_strict_fetch_sales_raises_instead_of_generating_sales():
    client = _strict_client()
    client.http_client = MagicMock()
    client.http_client.post = AsyncMock(side_effect=httpx.ConnectError("nope"))

    with pytest.raises(ToastUnavailable):
        await client.fetch_sales_data(_START, _END)


async def test_non_strict_client_still_falls_back_to_mock():
    """Strict mode is additive: the permissive default is unchanged."""
    client = ToastAPIClient(
        toast_client_id="id", toast_client_secret="secret", mock_mode=False
    )
    client.http_client = MagicMock()
    client.http_client.post = AsyncMock(side_effect=httpx.ConnectError("nope"))

    menus = await client.fetch_menus("r1")

    assert menus == {"menus": ToastAPIClient.MOCK_MENUS}


# ── 5. fetch_order — the one operation the client did not have ───────────────


async def test_fetch_order_calls_toast_orders_v2_endpoint():
    client = _strict_client()
    payload: Dict[str, Any] = {"guid": "o1", "displayNumber": 3}
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=payload)

    client.http_client = MagicMock()
    client.http_client.get = AsyncMock(return_value=response)
    client.access_token = "tok"
    client.token_expires_at = datetime.utcnow() + timedelta(hours=1)

    result = await client.fetch_order("o1")

    assert result == payload
    url = client.http_client.get.await_args.args[0]
    assert url == "https://api.toasttab.com/orders/v2/orders/o1"
    headers = client.http_client.get.await_args.kwargs["headers"]
    assert headers == {"Authorization": "Bearer tok"}


async def test_fetch_order_maps_404_to_not_found():
    client = _strict_client()
    response = httpx.Response(404, request=httpx.Request("GET", "http://x"))
    client.http_client = MagicMock()
    client.http_client.get = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "404", request=response.request, response=response
        )
    )
    client.access_token = "tok"
    client.token_expires_at = datetime.utcnow() + timedelta(hours=1)

    with pytest.raises(ToastNotFound):
        await client.fetch_order("missing")


async def test_fetch_order_has_no_mock_fallback_even_when_not_strict():
    """An invented order is never a safe fallback, in any mode."""
    client = ToastAPIClient(mock_mode=True)

    with pytest.raises(ToastNotConfigured):
        await client.fetch_order("o1")
