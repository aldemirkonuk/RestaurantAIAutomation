"""
Toast Integration Routes — the missing half of the NestJS ↔ orchestrator seam
============================================================================
`apps/api-gateway/src/toast/toast.service.ts` has called these six routes since
2026-04-13. The router was never built — no `api/toast_routes.py` appears
anywhere in git history — so every call 404'd, and five of the six then fell
back to gateway-side mock data (`toast.service.ts:768`, `:934`). This module is
the missing middle. It is wiring, not new capability: every operation already
existed on `services/toast_api_client.py`.

Routes (prefix /api/v1/toast, all X-Admin-Key gated):
  GET  /menus?restaurant_id=          → ToastMenuListResponseDto
  GET  /menus/{menu_id}               → ToastMenuDto
  POST /orders                        → ToastOrderResponseDto
  GET  /orders/{order_id}             → ToastOrderResponseDto
  GET  /sales?restaurant_id&start_time&end_time → ToastSalesResponseDto
  GET  /statistics                    → client statistics

Contract of record
------------------
The gateway's existing DTOs, which are camelCase:
  apps/api-gateway/src/toast/dto/toast-menu.dto.ts
  apps/api-gateway/src/toast/dto/toast-order.dto.ts
The Python client speaks Toast-native / snake_case, so this module maps between
them. It does not invent fields: anything Toast did not supply is omitted or
derived from values Toast did supply.

Honesty (ADR 0020, LOCKED — .planning/decisions/0020-no-fabricated-answers.md)
-----------------------------------------------------------------------------
`ToastAPIClient`'s default behaviour is to answer every failure with mock data:
a failed menu fetch returns MOCK_MENUS, a failed sales fetch returns invented
wine sales, and a failed order create returns a fabricated "mock_created" order.
Wiring the router to that default would have shipped a second fabricating
fallback into the exact seam whose first one caused this work. So the router
always constructs the client with `strict=True`, which converts every one of
those fallbacks into a raised error, and maps it to an honest status:

  503 — Toast is not configured, or Toast could not be reached
  404 — Toast answered, and the resource does not exist
  502 — Toast answered with something this router cannot map

No route on this module can return an empty list, a zero, or a synthesized body
as if it were Toast data.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, NoReturn, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.auth import verify_admin_key
from config.settings import get_settings
from services.toast_api_client import (
    ToastAPIClient,
    ToastNotConfigured,
    ToastNotFound,
    ToastUnavailable,
    create_toast_client_from_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/toast", tags=["Toast Integration"])


# ── Client lifecycle ─────────────────────────────────────────────────────────
# One process-lifetime client, created lazily. It is a singleton rather than a
# per-request object for two reasons: the OAuth token cache lives on the
# instance (a per-request client would re-authenticate against a paid
# third-party API on every call), and `get_statistics()` returns per-instance
# counters that would be permanently zero — itself a fabrication — if the
# instance were discarded after each request.
_client: Optional[ToastAPIClient] = None


async def get_toast_client() -> ToastAPIClient:
    """Return the shared strict-mode Toast client, connecting on first use.

    A failed connect is NOT cached: `_client` stays None so the next request
    retries rather than inheriting a dead client for the life of the process.
    Overridden in tests via `app.dependency_overrides`.
    """
    global _client
    if _client is not None:
        return _client

    settings = get_settings()
    client = create_toast_client_from_settings(settings, strict=True)
    try:
        # connect() raises ToastNotConfigured / ToastUnavailable in strict mode
        # instead of silently degrading to mock, which is the point. Mapped here
        # because an unmapped raise inside a dependency surfaces as a bare 500,
        # which tells the caller nothing about why Toast is unavailable.
        await client.connect()
    except Exception as exc:
        await _safe_close(client)
        _raise_http_for(exc, "Toast connection")

    _client = client
    return _client


async def _safe_close(client: ToastAPIClient) -> None:
    """Close a half-built client without masking the error that got us here."""
    try:
        await client.disconnect()
    except Exception:  # pragma: no cover - cleanup must never shadow the cause
        logger.debug(
            "Toast client cleanup failed after a failed connect", exc_info=True
        )


def _reset_client_for_tests() -> None:
    """Drop the cached client. Test-only seam; never called by route code."""
    global _client
    _client = None


# ── Request models ───────────────────────────────────────────────────────────
# Field names mirror exactly what the gateway sends. `toast.service.ts:863`
# posts `{ restaurant_id, ...CreateToastOrderDto }`, so the envelope key is
# snake_case while the DTO's own fields stay camelCase. That mix is the
# contract; it is reproduced here rather than corrected, so the two halves meet.


class ToastOrderItemIn(BaseModel):
    itemGuid: str  # noqa: N815 — gateway contract, see module docstring
    name: str
    quantity: int
    unitPrice: int  # noqa: N815 — cents
    specialInstructions: Optional[str] = None  # noqa: N815


class CreateOrderIn(BaseModel):
    restaurant_id: str
    items: List[ToastOrderItemIn] = Field(min_length=1)
    tableName: Optional[str] = None  # noqa: N815
    serverName: Optional[str] = None  # noqa: N815
    notes: Optional[str] = None


# ── Error mapping ────────────────────────────────────────────────────────────


def _raise_http_for(exc: Exception, operation: str) -> NoReturn:
    """Translate a client-layer Toast failure into an honest HTTP status.

    Never returns; always raises. The detail names the operation and the reason
    so the gateway logs something actionable rather than "Failed to fetch".
    """
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, ToastNotFound):
        raise HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ToastNotConfigured):
        raise HTTPException(
            status_code=503,
            detail=(
                f"Toast is not configured, so {operation} cannot be answered. "
                "Set TOAST_CLIENT_ID and TOAST_CLIENT_SECRET."
            ),
        )
    if isinstance(exc, ToastUnavailable):
        raise HTTPException(
            status_code=503, detail=f"Toast is unreachable, so {operation} failed."
        )
    logger.exception("Unexpected error during %s", operation)
    raise HTTPException(
        status_code=502, detail=f"Unexpected failure during {operation}"
    )


# ── Toast → gateway DTO mapping ──────────────────────────────────────────────
# Every mapper is total and non-inventing: a field Toast did not send is either
# omitted (optional in the DTO) or derived arithmetically from fields it did
# send. No placeholder strings, no zero-as-unknown.


def _map_menu_item(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Toast menu item → ToastMenuItemDto."""
    item: Dict[str, Any] = {
        "guid": raw.get("guid") or raw.get("itemGuid") or "",
        "name": raw.get("name") or raw.get("displayName") or "",
        "price": raw.get("price") if raw.get("price") is not None else 0,
        # Toast marks unavailability explicitly; absence means available.
        "isAvailable": bool(raw.get("isAvailable", True)),
    }
    if raw.get("description"):
        item["description"] = raw["description"]
    # The client's MOCK_MENUS uses `type` ("red"/"white") where the DTO has
    # `category`; real Toast sends neither on the item itself.
    category = raw.get("category") or raw.get("type")
    if category:
        item["category"] = category
    if raw.get("imageUrl"):
        item["imageUrl"] = raw["imageUrl"]
    return item


def _map_menu(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Toast menu → ToastMenuDto.

    The DTO requires `groups`. Toast's config API nests items under
    `menuGroups[].menuItems[]`, while the client's mock menus carry a flat
    `items[]`. Flat items are wrapped in a single group named after the menu —
    a structural adaptation, not invented content: every item and its fields
    come from the source, and no group that Toast did report is dropped.
    """
    guid = raw.get("guid") or ""
    name = raw.get("name") or ""

    groups: List[Dict[str, Any]] = []
    raw_groups = raw.get("menuGroups") or raw.get("groups") or []
    for raw_group in raw_groups:
        group: Dict[str, Any] = {
            "guid": raw_group.get("guid") or "",
            "name": raw_group.get("name") or "",
            "items": [
                _map_menu_item(i)
                for i in (raw_group.get("menuItems") or raw_group.get("items") or [])
            ],
        }
        if raw_group.get("description"):
            group["description"] = raw_group["description"]
        groups.append(group)

    flat_items = raw.get("items") or []
    if flat_items and not raw_groups:
        groups.append(
            {
                "guid": guid,
                "name": name,
                "items": [_map_menu_item(i) for i in flat_items],
            }
        )

    menu: Dict[str, Any] = {
        "guid": guid,
        "name": name,
        "groups": groups,
        "isActive": bool(raw.get("isActive", True)),
    }
    if raw.get("description"):
        menu["description"] = raw["description"]
    return menu


def _map_sale(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Toast sale row → ToastSalesDataDto (snake_case → camelCase).

    The client's two paths disagree on shape, which this mapper absorbs:
      * `_generate_mock_sales` emits unit_price / total_price / wine_type;
      * `_extract_wine_items` (the REAL path, toast_api_client.py:376-387)
        emits a single `price` in dollars and no wine_type.
    So unitPrice falls back to `price`, and totalPrice is computed as
    unitPrice x quantity rather than defaulted to zero — a zero here would read
    as "this sale earned nothing".
    """
    quantity = raw.get("quantity") or 0
    unit_price = raw.get("unit_price")
    if unit_price is None:
        unit_price = raw.get("price") or 0
    total_price = raw.get("total_price")
    if total_price is None:
        total_price = unit_price * quantity

    sale: Dict[str, Any] = {
        "id": raw.get("id") or "",
        "orderGuid": raw.get("order_guid") or "",
        "itemName": raw.get("item_name") or "",
        "quantity": quantity,
        "unitPrice": unit_price,
        "totalPrice": total_price,
        "timestamp": raw.get("timestamp") or "",
        "source": raw.get("source") or "toast_api",
    }
    if raw.get("wine_type"):
        sale["wineType"] = raw["wine_type"]
    if raw.get("server_name"):
        sale["serverName"] = raw["server_name"]
    if raw.get("table_name"):
        sale["tableName"] = raw["table_name"]
    return sale


def _order_items_from_checks(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pull ToastOrderItemDto rows out of a Toast order's checks/selections.

    Field names follow what this repo already asserts about Toast's order shape
    in `adapters/toast_adapter.py:66-79` and
    `services/toast_api_client.py:369-387`.
    """
    items: List[Dict[str, Any]] = []
    for check in raw.get("checks") or []:
        for selection in check.get("selections") or []:
            items.append(
                {
                    "itemGuid": selection.get("itemGuid")
                    or selection.get("guid")
                    or "",
                    "name": selection.get("displayName")
                    or selection.get("itemName")
                    or "",
                    "quantity": selection.get("quantity") or 1,
                    "unitPrice": selection.get("price") or 0,
                }
            )
    return items


def _map_order(
    raw: Dict[str, Any], fallback_items: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Toast order → ToastOrderResponseDto.

    `fallback_items` is used only on create, where the request body is a
    truthful record of what was sent if Toast's response echoes no selections.

    UNVERIFIED: the real-Toast branch of this mapping has never been exercised
    against a live Toast response — see the module docstring and the PR body.
    """
    items = _order_items_from_checks(raw)
    if not items and fallback_items:
        items = fallback_items

    checks = raw.get("checks") or []
    subtotal = raw.get("subtotal")
    if subtotal is None:
        subtotal = sum(c.get("amount") or 0 for c in checks) or sum(
            (i["unitPrice"] or 0) * (i["quantity"] or 0) for i in items
        )
    tax = raw.get("tax")
    if tax is None:
        tax = sum(c.get("taxAmount") or 0 for c in checks)
    total = raw.get("total")
    if total is None:
        total = raw.get("totalAmount")
    if total is None:
        total = subtotal + tax

    # Toast reports order state as an uppercase enum; the DTO's ToastOrderStatus
    # is lowercase open/closed/voided.
    if raw.get("voided"):
        status = "voided"
    elif raw.get("closedDate") or raw.get("closed_at"):
        status = "closed"
    else:
        status = "open"

    order: Dict[str, Any] = {
        "guid": raw.get("guid") or raw.get("order_id") or "",
        # Toast calls it displayNumber; the DTO calls it orderNumber. Coerced to
        # str because the DTO types it as a string.
        "orderNumber": str(
            raw.get("displayNumber") or raw.get("orderNumber") or raw.get("guid") or ""
        ),
        "status": status,
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "createdAt": raw.get("openedDate")
        or raw.get("createdDate")
        or raw.get("created_at")
        or "",
    }
    table_name = (raw.get("table") or {}).get("name") if raw.get("table") else None
    if table_name:
        order["tableName"] = table_name
    server = raw.get("server") or {}
    server_name = server.get("firstName") if server else None
    if server_name:
        order["serverName"] = server_name
    closed_at = raw.get("closedDate") or raw.get("closed_at")
    if closed_at:
        order["closedAt"] = closed_at
    return order


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/menus")
async def get_menus(
    restaurant_id: Optional[str] = Query(None),
    _key: str = Depends(verify_admin_key),
    client: ToastAPIClient = Depends(get_toast_client),
) -> Dict[str, Any]:
    """List menus. Matches `toast.service.ts:757` → ToastMenuListResponseDto."""
    try:
        raw = await client.fetch_menus(restaurant_id)
    except Exception as exc:
        _raise_http_for(exc, "menu listing")

    menus = [_map_menu(m) for m in (raw.get("menus") or [])]
    return {"menus": menus, "total": len(menus)}


@router.get("/menus/{menu_id}")
async def get_menu(
    menu_id: str,
    _key: str = Depends(verify_admin_key),
    client: ToastAPIClient = Depends(get_toast_client),
) -> Dict[str, Any]:
    """Fetch one menu. Matches `toast.service.ts:807` → ToastMenuDto."""
    try:
        raw = await client.fetch_menu(menu_id)
    except ValueError as exc:
        # The client's own "Menu not found" signal in mock mode.
        raise HTTPException(status_code=404, detail=str(exc) or "Menu not found")
    except Exception as exc:
        _raise_http_for(exc, f"menu lookup for '{menu_id}'")

    return _map_menu(raw)


@router.post("/orders", status_code=201)
async def create_order(
    body: CreateOrderIn,
    _key: str = Depends(verify_admin_key),
    client: ToastAPIClient = Depends(get_toast_client),
) -> Dict[str, Any]:
    """Create an order at Toast. Matches `toast.service.ts:863`.

    This route places a REAL order at a vendor, so: it is admin-key gated like
    its siblings (unauthenticated callers never reach the client), and it is
    called exactly once with no retry. A blind retry on an ambiguous failure —
    a timeout that Toast may or may not have committed — is how one order
    becomes two. A failure is reported, not re-attempted.
    """
    payload = body.model_dump(exclude_none=True)
    payload.pop("restaurant_id", None)

    try:
        raw = await client.create_order(body.restaurant_id, payload)
    except Exception as exc:
        _raise_http_for(exc, "order creation")

    return _map_order(
        raw,
        fallback_items=[i.model_dump(exclude_none=True) for i in body.items],
    )


@router.get("/orders/{order_id}")
async def get_order(
    order_id: str,
    _key: str = Depends(verify_admin_key),
    client: ToastAPIClient = Depends(get_toast_client),
) -> Dict[str, Any]:
    """Fetch one order. Matches `toast.service.ts:896` → ToastOrderResponseDto.

    Backed by `fetch_order`, added alongside this router — it was the one
    gateway call with no client method at all.
    """
    try:
        raw = await client.fetch_order(order_id)
    except Exception as exc:
        _raise_http_for(exc, f"order lookup for '{order_id}'")

    return _map_order(raw)


@router.get("/sales")
async def get_sales(
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    restaurant_id: Optional[str] = Query(None),
    _key: str = Depends(verify_admin_key),
    client: ToastAPIClient = Depends(get_toast_client),
) -> Dict[str, Any]:
    """Sales for a time range. Matches `toast.service.ts:923` → ToastSalesResponseDto."""
    if end_time < start_time:
        raise HTTPException(
            status_code=422, detail="end_time must not be earlier than start_time"
        )

    try:
        rows = await client.fetch_sales_data(start_time, end_time, restaurant_id)
    except Exception as exc:
        _raise_http_for(exc, "sales fetch")

    sales = [_map_sale(r) for r in (rows or [])]
    return {
        "sales": sales,
        "total": len(sales),
        "totalRevenue": sum(s["totalPrice"] for s in sales),
        "startTime": start_time.isoformat(),
        "endTime": end_time.isoformat(),
    }


@router.get("/statistics")
async def get_statistics(
    _key: str = Depends(verify_admin_key),
    client: ToastAPIClient = Depends(get_toast_client),
) -> Dict[str, Any]:
    """Client statistics. Matches `toast.service.ts:943`.

    Gated the same way as the other five: when Toast is not configured the
    dependency raises before this body runs, and the caller gets 503 rather than
    a row of zeros that would read as "connected, and nothing has happened".
    Counters are process-local, which `scope` states rather than implies.
    """
    stats = dict(client.get_statistics())
    stats["scope"] = "process"
    return stats
