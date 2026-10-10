"""
Sim S67 — F-454, F-455, F-456 (agents lane, 2026-10-09).

F-454  EmailParsingAgent never parsed a mail (`self.db` was never set, and its
       writes awaited a sync `.execute()`). The gateway's RabbitMQ bridge
       already stores every inbound reply for the right house and hands it to
       the one-tap responder, so the agent is removed rather than repaired, with
       EmailIntelAgent's re-publish that only existed to feed it.
F-455  The procurement agent turned a vendor reply into an order status by
       substring ("Can you confirm the address?" -> CONFIRMED) with no person in
       the loop. The handler and its subscription are gone. The live
       intent_response path wrote a column procurement_orders does not have
       (`negotiated_price_per_bottle`) and awaited the sync client, so the
       notice after each write never went out.
F-456  `idempotency_keys` was keyed on message_id alone and the MessageBus kept
       one process-wide seen-set, so when an event fanned out to several agents
       the first to finish made every other one skip it.

Decision record: p4-scratch/sim-run/bulletproof/reconcile/agents-python-decisions.md.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

import pytest

from core.agent_registry import DEFAULT_AGENT_SPECS
from core.base_agent import BaseAgent
from core.message_bus import MessageBus

ORDER_ID = "45400000-0000-4000-8000-000000000001"
REST_ID = "45400000-0000-4000-8000-0000000000aa"


# ---------------------------------------------------------------------------
# F-454: no Python consumer of inbound mail besides the classifier
# ---------------------------------------------------------------------------


def test_email_parsing_agent_is_gone_from_the_roster():
    assert "email_parsing_agent" not in DEFAULT_AGENT_SPECS
    with pytest.raises(ImportError):
        __import__("agents.email_parsing_agent")


# ---------------------------------------------------------------------------
# F-455: a vendor's words never move an order on their own
# ---------------------------------------------------------------------------


class _SyncResult:
    """What the sync supabase client returns: NOT awaitable."""

    def __init__(self, data: Any) -> None:
        self.data = data


class _Orders:
    def __init__(self, order: Dict[str, Any], updates: List[Dict[str, Any]]):
        self._order, self._updates = order, updates

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self._updates.append(payload)
        return self

    def eq(self, *_a, **_k):
        return self

    def single(self):
        return self

    def execute(self):
        return _SyncResult(self._order)


def _procurement_agent():
    from agents.procurement_agent import ProcurementAgent

    order = {
        "id": ORDER_ID,
        "restaurant_id": REST_ID,
        "status": "NEGOTIATING",
        "wine_name": "Barolo Riserva",
        "inventory_id": None,
        "quantity": 6,
    }
    updates: List[Dict[str, Any]] = []
    orders = _Orders(order, updates)
    db = MagicMock()
    db.supabase.table.side_effect = lambda name: (
        orders if name == "procurement_orders" else pytest.fail(f"touched {name}")
    )
    agent = ProcurementAgent(
        agent_name="procurement_agent",
        message_bus=AsyncMock(),
        database=db,
        config={"mock_mode": True},
    )
    agent.logger = MagicMock()
    agent.publish = AsyncMock(return_value=True)
    return agent, updates


def test_procurement_agent_does_not_listen_for_raw_vendor_replies():
    from agents.procurement_agent import ProcurementAgent

    keys = ProcurementAgent.get_subscribed_routing_keys(MagicMock())
    assert ("procurement.events", "procurement.vendor_response") not in keys


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        "Can you confirm the delivery address?",
        "Sorry for the delay, ships Thursday.",
        "The 2019 is sold out, we can send the 2020.",
    ],
)
async def test_a_vendor_reply_writes_no_order_status(body):
    agent, updates = _procurement_agent()
    await agent.process_message(
        {
            "routing_key": "procurement.vendor_response",
            "payload": {
                "order_id": ORDER_ID,
                "restaurant_id": REST_ID,
                "subject": "Re: your order",
                "body": body,
            },
        }
    )
    assert updates == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response_type, status, notice",
    [
        ("confirmed", "CONFIRMED", "notification.order_confirmed"),
        ("counter_offer", "COUNTER_OFFERED", "notification.procurement_counter_offer"),
    ],
)
async def test_intent_response_writes_real_columns_and_still_notifies(
    response_type, status, notice
):
    agent, updates = _procurement_agent()
    await agent._handle_intent_response(
        {
            "payload": {
                "order_id": ORDER_ID,
                "restaurant_id": REST_ID,
                "response_type": response_type,
                "parsed_price": 24.5,
            }
        }
    )
    assert len(updates) == 1
    assert updates[0]["status"] == status
    assert updates[0]["negotiated_price"] == 24.5
    assert "negotiated_price_per_bottle" not in updates[0]
    published = [c.kwargs.get("routing_key") for c in agent.publish.await_args_list]
    assert notice in published


@pytest.mark.asyncio
async def test_a_confirmation_without_a_price_keeps_the_stored_price():
    agent, updates = _procurement_agent()
    await agent._handle_intent_response(
        {
            "payload": {
                "order_id": ORDER_ID,
                "response_type": "confirmed",
                "parsed_price": None,
            }
        }
    )
    assert updates and updates[0]["status"] == "CONFIRMED"
    assert not {"negotiated_price", "negotiated_price_per_bottle"} & set(updates[0])


# ---------------------------------------------------------------------------
# F-456: one agent finishing an event does not make another skip it
# ---------------------------------------------------------------------------


class _IdemTable:
    """`idempotency_keys` with the filters BaseAgent applies, nothing more."""

    def __init__(self, rows: List[Dict[str, Any]]):
        self.rows, self._filters, self._insert = rows, [], None

    def select(self, *_a):
        self._filters = []
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def insert(self, row):
        self._insert = row
        return self

    def execute(self):
        if self._insert is not None:
            row, self._insert = self._insert, None
            key = (row["agent_name"], row["message_id"])
            if any((r["agent_name"], r["message_id"]) == key for r in self.rows):
                raise RuntimeError("duplicate key value violates idempotency_keys_pkey")
            self.rows.append(row)
            return _SyncResult([row])
        hits = [r for r in self.rows if all(r.get(c) == v for c, v in self._filters)]
        return _SyncResult(hits)


class _Fanout(BaseAgent):
    def __init__(self, name: str, db):
        super().__init__(
            name,
            MagicMock(),
            db,
            {"circuit_breaker_enabled": False, "max_retries": 1},
        )
        self.seen: List[str] = []

    async def initialize(self):
        pass

    async def cleanup(self):
        pass

    def get_subscribed_routing_keys(self):
        return [("stock.events", "stock.threshold.breached")]

    async def process_message(self, message):
        self.seen.append(message["message_id"])


@pytest.mark.asyncio
async def test_two_agents_on_one_event_both_run_and_each_dedupes_itself():
    rows: List[Dict[str, Any]] = []
    db = MagicMock()
    db.supabase.table.side_effect = lambda name: _IdemTable(rows)
    procurement, notification = _Fanout("procurement_agent", db), _Fanout(
        "notification_agent", db
    )
    event = {"message_id": "evt-breach-1", "payload": {}}

    await procurement._process_with_retry(dict(event))
    await notification._process_with_retry(dict(event))
    # A redelivery to the same agent is still a duplicate.
    await procurement._process_with_retry(dict(event))

    assert procurement.seen == ["evt-breach-1"]
    assert notification.seen == ["evt-breach-1"]
    assert sorted(r["agent_name"] for r in rows) == [
        "notification_agent",
        "procurement_agent",
    ]


class _Incoming:
    def __init__(self, key: str):
        self.body = json.dumps({"message_id": key, "payload": {}}).encode()
        self.headers = {"x-idempotency-key": key}
        self.exchange, self.routing_key = "stock.events", "stock.threshold.breached"
        self.timestamp = None
        self.processed = False

    async def ack(self):
        self.processed = True

    async def reject(self, requeue):
        self.processed = True

    @asynccontextmanager
    async def process(self, ignore_processed=False):
        yield self


class _Queue:
    def __init__(self):
        self.callback = None

    async def consume(self, callback, no_ack=False):
        self.callback = callback
        return "tag"

    async def deliver(self, key: str):
        await self.callback(_Incoming(key))


@pytest.mark.asyncio
async def test_the_bus_keys_its_seen_set_by_queue():
    bus = MessageBus("amqp://unused")
    seen: Dict[str, int] = {"procurement": 0, "notification": 0}

    async def on(name):
        async def cb(_body):
            seen[name] += 1

        return cb

    queues = {}
    for name in seen:
        q = queues[name] = _Queue()
        bus.queues[f"queue.{name}_agent.stock_threshold_breached"] = q
        await bus.consume(
            f"queue.{name}_agent.stock_threshold_breached", await on(name)
        )

    await queues["procurement"].deliver("idem-1")
    await queues["notification"].deliver("idem-1")
    await queues["procurement"].deliver("idem-1")  # same queue: still a duplicate
    await asyncio.sleep(0)

    assert seen == {"procurement": 1, "notification": 1}
