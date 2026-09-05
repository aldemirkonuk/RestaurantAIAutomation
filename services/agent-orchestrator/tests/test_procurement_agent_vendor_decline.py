"""
ADR 0125 Q3 — a vendor's decline returns the order to NEGOTIATING, never to a
terminal state.

WHY THIS FILE EXISTS
--------------------
`_handle_intent_response`'s decline branch wrote `status: "REJECTED"`, a TERMINAL
state, so one vendor saying no dropped the order out of every open-order list,
outstanding count and reorder widget before a human decided anything. The house
may still buy that wine at another price or from another vendor. The founder's
call of 2026-09-05 was "Return to NEGOTIATING, with the decline recorded".

The change shipped with NO test in this language at all. An audit of the
follow-up commit found that gap and this file closes it. Every case here fails
against `git show bdce73f4^:services/agent-orchestrator/agents/procurement_agent.py`;
the counts are in ADR 0125's second addendum.

It is now also enforced BELOW this code: `trg_procurement_order_transition_is_legal`
has no `CONFIRMED>REJECTED` edge, so the old write would raise 23514 from
Postgres rather than quietly closing the order. This file asserts the agent no
longer attempts it.
"""

from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.procurement_agent import ProcurementAgent

ORDER_ID = "44444444-4444-4444-4444-444444444444"
REST_ID = "11111111-1111-1111-1111-111111111111"

# The states this house treats as closed. A decline may not write any of them.
TERMINAL_STATUSES = ("CANCELLED", "REJECTED", "FAILED", "COMPLETED")


class _Result:
    """
    What Supabase's `.execute()` returns here, usable BOTH ways.

    The read path calls `.execute()` and does NOT await it; the write path
    awaits it. A plain MagicMock satisfies the first and raises TypeError on the
    second — and `_handle_intent_response` wraps everything in a try/except, so
    that TypeError was swallowed and the branch silently stopped after the
    update was recorded. The status assertion still passed and the notification
    assertion failed for a reason that had nothing to do with the code under
    test. Measured while writing this file; the harness was wrong, not the agent.
    """

    def __init__(self, data: Any) -> None:
        self.data = data

    def __await__(self):
        async def _self() -> "_Result":
            return self

        return _self().__await__()


class _OrdersTable:
    """`procurement_orders` only — every update recorded, nothing else stubbed."""

    def __init__(self, order: Dict[str, Any], updates: List[Dict[str, Any]]) -> None:
        self._order = order
        self._updates = updates

    def select(self, *_a: Any, **_k: Any) -> "_OrdersTable":
        return self

    def update(self, payload: Dict[str, Any]) -> "_OrdersTable":
        self._updates.append(payload)
        return self

    def eq(self, *_a: Any, **_k: Any) -> "_OrdersTable":
        return self

    def single(self) -> "_OrdersTable":
        return self

    def execute(self) -> "_Result":
        return _Result(self._order)


def _make_agent(status: str = "CONFIRMED"):
    order = {
        "id": ORDER_ID,
        "restaurant_id": REST_ID,
        "status": status,
        "wine_name": "Barolo Riserva",
        "provider_name": "Vinos Iberia",
        "inventory_id": None,
        "quantity": 6,
    }
    updates: List[Dict[str, Any]] = []
    orders = _OrdersTable(order, updates)

    db = MagicMock()
    # Only `procurement_orders` is answered. Any other table this branch reached
    # for would raise, which is the point: a decline must not need one.
    db.supabase.table.side_effect = lambda name: (
        orders
        if name == "procurement_orders"
        else pytest.fail(f"the decline branch touched an unexpected table: {name}")
    )

    bus = AsyncMock()
    bus.publish = AsyncMock(return_value=True)

    agent = ProcurementAgent(
        agent_name="procurement_agent",
        message_bus=bus,
        database=db,
        config={"mock_mode": True},
    )
    agent.logger = MagicMock()
    agent.publish = AsyncMock(return_value=True)
    return agent, updates, order


def _decline(response_type: str = "rejection") -> Dict[str, Any]:
    return {
        "payload": {
            "order_id": ORDER_ID,
            "restaurant_id": REST_ID,
            "response_type": response_type,
            "parsed_price": None,
        }
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("response_type", ["rejection", "declined"])
async def test_decline_writes_negotiating_and_never_a_terminal_state(response_type):
    agent, updates, _order = _make_agent()
    await agent._handle_intent_response(_decline(response_type))

    assert len(updates) == 1, f"expected exactly one order write, got {updates}"
    written = updates[0]["status"]
    assert written == "NEGOTIATING", (
        f"a vendor's decline wrote {written!r}. ADR 0125 Q3: the order returns to "
        "negotiation so the house can re-price it or try another vendor."
    )
    assert written not in TERMINAL_STATUSES


@pytest.mark.asyncio
async def test_decline_writes_no_reason_onto_the_order():
    # Who declined, when and in what words is the inbound
    # `procurement_conversations` row. Copying it onto the order would make two
    # accounts of one event that can disagree.
    agent, updates, _order = _make_agent()
    await agent._handle_intent_response(_decline())

    payload = updates[0]
    assert "rejection_reason" not in payload
    assert "rejected_reason" not in payload
    assert set(payload) == {"status", "updated_at"}


@pytest.mark.asyncio
async def test_decline_tells_a_manager_the_order_is_still_open():
    agent, _updates, _order = _make_agent()
    await agent._handle_intent_response(_decline())

    assert agent.publish.await_count == 1
    kwargs = agent.publish.await_args.kwargs
    assert kwargs["routing_key"] == "notification.procurement_rejected"
    body = kwargs["message_body"]["payload"]
    # The sentence a manager reads has to carry the thing they would otherwise
    # get wrong: the order did not die.
    assert "cancelled" in body["message"].lower()
    assert "negotiation" in body["message"].lower()
    assert "rejected" not in body["title"].lower()


@pytest.mark.asyncio
async def test_an_out_of_stock_reply_is_still_the_cancel_path_not_the_decline_one():
    # `unavailable` is a different branch with its own cascade (calendar event,
    # shadow stock, alternative providers) and it deliberately still CANCELS.
    # Asserted so a future tidy-up does not fold the two together: a vendor with
    # none left is not a vendor refusing our price.
    agent, updates, _order = _make_agent(status="APPROVED")
    agent._cancel_order_calendar_event = AsyncMock()
    agent._release_shadow_stock = AsyncMock()
    agent.database.supabase.table.side_effect = lambda name: (
        _OrdersTable({"id": ORDER_ID, "status": "APPROVED"}, updates)
        if name == "procurement_orders"
        else MagicMock()
    )
    await agent._handle_intent_response(_decline("unavailable"))
    assert updates and updates[0]["status"] == "CANCELLED"
