"""One simulated check, encoded for each of the two ingresses.

There are two POS ingresses in this repo and they are not connected to each other:

  A. NestJS  POST /pos-hub/webhook/generic_webhook/:restaurantId
     -> PosHubService.ingest -> UPSERT pos_checks -> analytics/insights/goals.
     NO inventory write exists on this path, so posting here can never trigger a
     reorder. Shape: `CanonicalCheck` in apps/api-gateway/src/pos-hub/pos-types.ts.

  B. FastAPI POST /api/v1/pos/webhook/toast
     -> ToastAdapter.verify_webhook -> POSIntegrationAgent -> RabbitMQ
     -> BufferManager -> InventoryEngine (stock decrement)
     -> stock.threshold.breached -> ProcurementAgent (the reorder).

Getting B's shape right is fiddly, and two details are load-bearing.

**The guid must be top level.** `process_toast_webhook` computes its idempotency
key as `webhook_data.get("order_guid") or webhook_data.get("guid", "")` plus the
event type — read from the ENVELOPE, not from `data.order.guid`. A payload that
nests the guid only under `order` yields the key `":OrderCompleted"` for every
event, so the first order is processed and every subsequent one is discarded as a
duplicate. Silently. This is the single easiest way to build a simulator that
appears to work and delivers one check a night.

**The adapter and the handler disagree, and the handler wins.**
`ToastAdapter.normalize_event` parses `order.checks[].selections` using
`displayName` and `price`. `handle_order_completed` parses
`data.order.selections` using `itemGroup.name` and `preDiscountPrice` in CENTS.
Because `process_pos_event` forwards `event.raw_payload` — the original dict —
rather than the normalised `POSEvent.items`, the adapter's parsed items are never
read on this path. So the payload must satisfy the HANDLER. We emit both shapes:
the handler's because it is what functions, the adapter's because it costs nothing
and keeps the envelope honest if that dead path is ever revived.

That disagreement is worth naming as a finding rather than papering over: it means
the "provider-agnostic" POSEvent abstraction does not currently abstract. A second
POS adapter that correctly normalised into `POSEvent.items` would produce a
payload the handler reads as empty, which then triggers the polling saga.
"""

from __future__ import annotations

from typing import Any

from scripts.simulate.service import Check

#: Toast event type that routes to `handle_order_completed`. The handler_map also
#: accepts OrderItemVoided / OrderRefunded / MenuItemModified.
EVENT_ORDER_COMPLETED = "OrderCompleted"

#: Category name the wine-detection path scores highest. Sending a real category
#: is not cheating — a real Toast menu has one, and omitting it would test the
#: keyword fallback exclusively.
WINE_CATEGORIES = {"Wine", "Wine by the Glass"}


def canonical_check(check: Check) -> dict[str, Any]:
    """Ingress A payload — `CanonicalCheck`.

    `is_wine` is deliberately NOT set. The hub resolves it via pos_item_mappings
    and then a keyword heuristic, and asserting our own answer here would mean the
    run measures nothing about whether that resolution works. The simulator's job
    is to feed the real path, not to pre-answer it.
    """
    return {
        "externalCheckId": check.external_check_id,
        "openedAt": check.opened_at.isoformat(),
        "closedAt": check.closed_at.isoformat(),
        "tableRef": check.table_ref,
        "serverExternalId": check.server_external_id,
        "serverName": check.server_name,
        "covers": check.covers,
        "subtotal": check.subtotal,
        "total": check.total,
        "tip": check.tip,
        "items": [
            {
                "name": item.name,
                "externalItemId": item.external_item_id,
                "category": item.category,
                "qty": item.quantity,
                "price": item.price,
            }
            for item in check.items
        ],
    }


def toast_webhook(check: Check, restaurant_guid: str) -> dict[str, Any]:
    """Ingress B payload — Toast-shaped, satisfying the handler.

    See the module docstring for why `order_guid` sits at the top level and why the
    items appear under `data.order.selections` with prices in cents.
    """
    selections = [
        {
            # The handler reads the item name from itemGroup.name. Not displayName.
            "itemGroup": {"name": item.name},
            "menuGroup": {
                "name": item.category if item.category in WINE_CATEGORIES else item.category
            },
            "quantity": item.quantity,
            # CENTS. handle_order_completed divides by 100.
            "preDiscountPrice": int(round(item.price * 100)),
            "itemGuid": item.external_item_id,
            "guid": item.external_item_id,
            # Kept for the adapter's (currently unread) parser.
            "displayName": item.name,
            "price": item.price,
            "modifiers": [],
        }
        for item in check.items
    ]

    order = {
        "guid": check.external_check_id,
        "restaurantGuid": restaurant_guid,
        "closedDate": check.closed_at.isoformat(),
        "openedDate": check.opened_at.isoformat(),
        "selections": selections,
        # The adapter's shape, so the envelope satisfies both readers.
        "checks": [{"selections": selections}],
    }

    return {
        "eventType": EVENT_ORDER_COMPLETED,
        # Both spellings, because process_toast_webhook reads `event_type` for the
        # idempotency key and `eventType` for routing.
        "event_type": EVENT_ORDER_COMPLETED,
        # TOP LEVEL. Without this every check after the first is dropped as a
        # duplicate of the empty-guid key.
        "order_guid": check.external_check_id,
        "guid": check.external_check_id,
        "restaurantGuid": restaurant_guid,
        "createdDate": check.closed_at.isoformat(),
        "data": {"order": order},
        # Some readers look for the order at the envelope root.
        "order": order,
    }


def idempotency_key(check: Check) -> str:
    """The key ingress B will compute for this payload.

    Reproduced here so a test can assert that two different checks produce two
    different keys — the property whose absence silently collapses a whole night
    of service into one processed order.
    """
    return f"{check.external_check_id}:{EVENT_ORDER_COMPLETED}"
