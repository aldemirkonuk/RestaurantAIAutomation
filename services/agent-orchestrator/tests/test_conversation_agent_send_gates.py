"""The two gates #464 needs before ProviderConversationAgent runs in production.

Founder, 2026-09-25: "Gate, clear, then merge."

GATE 1 — the house's switch.
    `conversation.auto_reply.urgency` emails a vendor "please hold those for us"
    with no human approval. Before this, it never read the house's
    `enable_ai_autonomous_send`, and its fixed text passes the commitment
    guardrail, so nothing stopped it. It now reads the same row, with the same
    literal-`true` rule, as the gateway's autonomous reply
    (apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts,
    isAutonomousSendEnabled), and fails closed.

GATE 2 — no send from an old message.
    The agent's durable queues have been collecting since at least 2026-09-23
    with nobody consuming them. A send-triggering message older than
    SEND_MESSAGE_MAX_AGE_SECONDS (24h, borrowed from plivo_voice_client) is not
    sent: an approved draft goes back to the manager with a sentence saying
    why, and the hold is logged. A message whose age cannot be proven is held
    the same way. Messages that only draft or read are processed normally.
"""

import json
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.provider_conversation_agent import (
    SEND_MESSAGE_MAX_AGE_SECONDS,
    SEND_TRIGGERING_KEYS,
    ProviderConversationAgent,
    message_published_at,
    send_hold_for,
)
from core.message_bus import MessageBus
from services.plivo_voice_client import APPROVAL_MAX_AGE_SECONDS

CONV_ID = "22222222-2222-2222-2222-222222222222"
REST_ID = "rest-1"
NOW = datetime.now(timezone.utc)


def _iso(delta: timedelta) -> str:
    """A MessageBus envelope time: naive UTC, like datetime.utcnow()."""
    return (NOW - delta).replace(tzinfo=None).isoformat()


# =============================================================================
# An in-memory PostgREST that honours the filters these paths use
# =============================================================================


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op, self.values, self.filters, self.or_filter = "select", None, {}, None
        self.mode = "many"

    def select(self, *a, **k):
        self.op = "select"
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def or_(self, expr, *a, **k):
        self.or_filter = expr
        return self

    def in_(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def single(self):
        self.mode = "single"
        return self

    def maybe_single(self):
        self.mode = "maybe_single"
        return self

    def _matches(self, row):
        if any(row.get(k) != v for k, v in self.filters.items()):
            return False
        if self.or_filter:  # the claim / return guard: status null or not terminal
            return (
                row.get("status")
                not in ProviderConversationAgent._SEND_TERMINAL_STATUSES
            )
        return True

    def execute(self):
        if self.table in self.db.raise_on:
            raise RuntimeError(f"{self.table} unreachable")
        self.db.calls.append((self.table, self.op, dict(self.filters)))
        if self.op == "insert":
            rows = self.values if isinstance(self.values, list) else [self.values]
            self.db.tables.setdefault(self.table, []).extend(rows)
            return types.SimpleNamespace(data=rows)
        rows = [r for r in self.db.tables.get(self.table, []) if self._matches(r)]
        if self.op == "update":
            for r in rows:
                r.update(self.values)
            return types.SimpleNamespace(data=[dict(r) for r in rows])
        if self.mode == "maybe_single":
            # postgrest-py returns None, not an empty response, for no row.
            return types.SimpleNamespace(data=dict(rows[0])) if rows else None
        if self.mode == "single":
            return types.SimpleNamespace(data=dict(rows[0]) if rows else None)
        return types.SimpleNamespace(data=[dict(r) for r in rows])


class _DB:
    def __init__(self, tables, raise_on=()):
        self.tables, self.raise_on, self.calls = tables, set(raise_on), []
        self.supabase = self

    def table(self, name):
        return _Query(self, name)

    @property
    def notifications(self):
        return self.tables.get("notifications", [])


def _agent(*, autonomy=None, flag_rows=None, status="PENDING_APPROVAL", raise_on=()):
    """A real agent (real method resolution) over the in-memory database."""
    if flag_rows is None:
        flag_rows = (
            []
            if autonomy is None
            else [
                {
                    "restaurant_id": REST_ID,
                    "flag_name": "restaurant_settings",
                    "enable_ai_autonomous_send": autonomy,
                }
            ]
        )
    db = _DB(
        {
            "restaurant_feature_flags": flag_rows,
            "procurement_conversations": [
                {
                    "id": CONV_ID,
                    "restaurant_id": REST_ID,
                    "provider_id": "prov-1",
                    "order_id": "order-1",
                    "message_text": "Could we have 12 bottles at $25?",
                    "channel": "email",
                    "status": status,
                    "message_id": None,
                    "constraint_flags": {"llm_model": "x"},
                    "conversation_context": {},
                }
            ],
            "providers": [
                {
                    "id": "prov-1",
                    "name": "Cellar Co",
                    "primary_contact": {"name": "Ana"},
                }
            ],
            "procurement_orders": [],
            "user_restaurant_access": [{"restaurant_id": REST_ID, "user_id": "u-1"}],
        },
        raise_on=raise_on,
    )
    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = db
    agent.config = {}
    agent._active_sessions = {}
    agent.publish = AsyncMock()
    agent.sends = []

    async def _send(**kwargs):
        agent.sends.append(kwargs)
        return {"success": True, "message_id": "gm-1"}

    agent._send_message = _send
    agent.db = db
    return agent


def _message(routing_key, payload, **envelope):
    return {"routing_key": routing_key, "payload": payload, **envelope}


URGENCY = {
    "provider_id": "prov-1",
    "restaurant_id": REST_ID,
    "order_id": "order-1",
    "wine_name": "Barolo 2019",
    "body": "Only 6 left",
}


def _logged(agent, text):
    return any(text in str(c) for c in agent.logger.method_calls)


# =============================================================================
# GATE 1 — the urgency hold obeys enable_ai_autonomous_send
# =============================================================================


class TestUrgencyHoldObeysTheHouseSwitch:
    async def _run(self, agent):
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.auto_reply.urgency",
                dict(URGENCY),
                timestamp=_iso(timedelta(minutes=1)),
            ),
        )

    async def test_switch_off_sends_nothing_and_tells_the_manager(self):
        """FAILS before #464's gate: the hold email went out regardless."""
        agent = _agent(autonomy=False)
        await self._run(agent)
        assert agent.sends == [], "the house said no autonomous send"
        (note,) = agent.db.notifications
        assert note["type"] == "scarcity_hold_not_sent"
        assert "Automatic replies are off for this house" in note["message"]
        assert "nothing was sent" in note["message"]

    async def test_no_settings_row_sends_nothing(self):
        agent = _agent(autonomy=None)
        await self._run(agent)
        assert agent.sends == []

    async def test_unreadable_switch_fails_closed(self):
        agent = _agent(autonomy=True, raise_on={"restaurant_feature_flags"})
        await self._run(agent)
        assert agent.sends == [], "a read failure must never count as permission"
        (note,) = agent.db.notifications
        assert "could not check" in note["message"]

    @pytest.mark.parametrize("value", ["true", 1, "yes", None])
    async def test_only_a_literal_true_counts(self, value):
        agent = _agent(autonomy=value)
        await self._run(agent)
        assert agent.sends == []

    async def test_another_rows_true_does_not_count(self):
        """A self-evolution row in the same table is not the house's switch."""
        agent = _agent(
            flag_rows=[
                {
                    "restaurant_id": REST_ID,
                    "flag_name": "some_experiment",
                    "enable_ai_autonomous_send": True,
                }
            ]
        )
        await self._run(agent)
        assert agent.sends == []

    async def test_missing_restaurant_fails_closed(self):
        agent = _agent(autonomy=True)
        payload = dict(URGENCY, restaurant_id=None)
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.auto_reply.urgency", payload, timestamp=_iso(timedelta(0))
            ),
        )
        assert agent.sends == []

    async def test_switch_on_sends_the_hold_once(self):
        agent = _agent(autonomy=True)
        await self._run(agent)
        assert len(agent.sends) == 1
        assert "hold those for us" in agent.sends[0]["message"]


# =============================================================================
# GATE 2 — an old send request is held, never sent
# =============================================================================


class TestStaleApprovalReturnsToTheManager:
    async def test_three_day_old_approval_is_not_sent(self):
        """FAILS before the guard: a backlogged approval emailed the vendor."""
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                timestamp=_iso(timedelta(days=3)),
            ),
        )
        assert agent.sends == [], "a 3-day-old approval reached the vendor"
        row = agent.db.tables["procurement_conversations"][0]
        assert row["status"] == "PENDING_APPROVAL"
        held = row["constraint_flags"]["reapproval_required"]
        assert held["reason_code"] == "stale"
        assert "You approved this message about 3 days ago" in held["reason"]
        assert row["constraint_flags"]["llm_model"] == "x", "existing flags survive"
        (note,) = agent.db.notifications
        assert note["type"] == "conversation_reapproval_needed"
        assert note["title"] == "Approve your message to Cellar Co again"
        assert note["message"] == held["reason"]
        assert note["action_url"] == "/orders?order=order-1"
        assert _logged(agent, "NOT SENT — conversation.approved held (stale)")

    async def test_modified_approval_is_held_too(self):
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.modified",
                {"conversation_id": CONV_ID, "modified_message": "edited"},
                timestamp=_iso(timedelta(hours=30)),
            ),
        )
        assert agent.sends == []
        assert "about 30 hours ago" in agent.db.notifications[0]["message"]

    async def test_approval_without_a_time_is_held(self):
        """A gateway body published before the stamp existed has no time at all."""
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent, _message("conversation.approved", {"conversation_id": CONV_ID})
        )
        assert agent.sends == []
        row = agent.db.tables["procurement_conversations"][0]
        assert (
            row["constraint_flags"]["reapproval_required"]["reason_code"]
            == "unknown_time"
        )
        assert "without a time we can trust" in agent.db.notifications[0]["message"]

    async def test_approval_dated_in_the_future_is_held(self):
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                timestamp=_iso(-timedelta(hours=2)),
            ),
        )
        assert agent.sends == []

    async def test_stale_gateway_stamp_is_held(self):
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                amqp_timestamp=(NOW - timedelta(days=2)).isoformat(),
            ),
        )
        assert agent.sends == []

    async def test_the_earlier_time_wins(self):
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                timestamp=_iso(timedelta(minutes=1)),
                amqp_timestamp=(NOW - timedelta(days=2)).isoformat(),
            ),
        )
        assert agent.sends == []

    async def test_a_row_already_sent_is_left_alone(self):
        agent = _agent(status="SENT")
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                timestamp=_iso(timedelta(days=3)),
            ),
        )
        row = agent.db.tables["procurement_conversations"][0]
        assert row["status"] == "SENT"
        assert "reapproval_required" not in row["constraint_flags"]
        assert agent.sends == [] and agent.db.notifications == []

    async def test_a_read_failure_raises_and_sends_nothing(self):
        agent = _agent(raise_on={"procurement_conversations"})
        with pytest.raises(RuntimeError):
            await ProviderConversationAgent.process_message(
                agent,
                _message(
                    "conversation.approved",
                    {"conversation_id": CONV_ID},
                    timestamp=_iso(timedelta(days=3)),
                ),
            )
        assert agent.sends == []

    async def test_stale_urgency_is_not_sent_even_with_the_switch_on(self):
        agent = _agent(autonomy=True)
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.auto_reply.urgency",
                dict(URGENCY),
                timestamp=_iso(timedelta(days=2)),
            ),
        )
        assert agent.sends == []
        (note,) = agent.db.notifications
        assert "about 2 days ago" in note["message"]
        assert "too old to answer automatically" in note["message"]


class TestFreshMessagesStillWork:
    async def test_fresh_approval_is_sent(self):
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                timestamp=_iso(timedelta(minutes=5)),
            ),
        )
        assert len(agent.sends) == 1
        assert agent.db.tables["procurement_conversations"][0]["status"] == "SENT"

    async def test_fresh_gateway_stamped_approval_is_sent(self):
        agent = _agent()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "conversation.approved",
                {"conversation_id": CONV_ID},
                amqp_timestamp=(NOW - timedelta(seconds=30)).isoformat(),
            ),
        )
        assert len(agent.sends) == 1

    async def test_old_non_send_message_is_processed_normally(self):
        """Drafting keys are not held: an old request becomes a draft, never an email."""
        agent = _agent()
        agent._handle_procurement_intent = AsyncMock()
        await ProviderConversationAgent.process_message(
            agent,
            _message(
                "procurement.conversation_request",
                {"provider_id": "prov-1"},
                timestamp=_iso(timedelta(days=5)),
            ),
        )
        agent._handle_procurement_intent.assert_awaited_once()


class TestTheRuleItself:
    def test_the_window_is_the_existing_approval_window(self):
        assert SEND_MESSAGE_MAX_AGE_SECONDS == APPROVAL_MAX_AGE_SECONDS == 24 * 3600

    def test_every_send_path_is_a_send_triggering_key(self):
        """If a new key reaches _send_message, it must be added here and held."""
        assert SEND_TRIGGERING_KEYS == {
            "conversation.approved",
            "conversation.modified",
            "conversation.auto_reply.urgency",
        }

    def test_boundaries(self):
        just_inside = {
            "timestamp": _iso(timedelta(seconds=SEND_MESSAGE_MAX_AGE_SECONDS - 60))
        }
        just_outside = {
            "timestamp": _iso(timedelta(seconds=SEND_MESSAGE_MAX_AGE_SECONDS + 60))
        }
        assert send_hold_for(just_inside, NOW) is None
        assert send_hold_for(just_outside, NOW).reason == "stale"
        assert send_hold_for({}, NOW).reason == "unknown_time"
        assert send_hold_for({"timestamp": "not a date"}, NOW).reason == "unknown_time"

    def test_published_at_reads_both_sources(self):
        assert message_published_at({"timestamp": "2026-09-20T10:00:00"}) == datetime(
            2026, 9, 20, 10, tzinfo=timezone.utc
        )
        assert message_published_at(
            {"amqp_timestamp": "2026-09-20T10:00:00+00:00"}
        ) == datetime(2026, 9, 20, 10, tzinfo=timezone.utc)


# =============================================================================
# The bus carries the publish time to the agent, and keeps it on retry
# =============================================================================


class _Incoming:
    def __init__(self, body, timestamp):
        self.body = json.dumps(body).encode()
        self.headers = {}
        self.exchange, self.routing_key = "conversation.events", "conversation.approved"
        self.timestamp = timestamp
        self.priority = 5
        self.content_type = "application/json"
        self.message_id = "m-1"
        self.correlation_id = None
        self.processed = False

    async def ack(self):
        self.processed = True

    async def reject(self, requeue):
        self.processed = True

    def process(self, ignore_processed=False):
        incoming = self

        class _Ctx:
            async def __aenter__(self):
                return incoming

            async def __aexit__(self, *exc):
                return False

        return _Ctx()


class _Queue:
    def __init__(self):
        self.callback = None

    async def consume(self, callback, no_ack=False):
        self.callback = callback
        return "tag-1"


class _Exchange:
    def __init__(self):
        self.published = []

    async def publish(self, message, routing_key=None, **kw):
        self.published.append(message)


class TestBusCarriesThePublishTime:
    async def _bus(self, callback):
        bus = MessageBus("amqp://unused")
        queue = _Queue()
        bus.queues["q"] = queue
        exchange = _Exchange()
        bus.exchanges["conversation.events"] = exchange
        await bus.consume("q", callback)
        return queue, exchange

    async def test_amqp_timestamp_reaches_the_handler_outside_the_payload(self):
        seen = []

        async def callback(body):
            seen.append(body)

        queue, _ = await self._bus(callback)
        stamp = datetime(2026, 9, 23, 0, 3, tzinfo=timezone.utc)
        await queue.callback(_Incoming({"conversation_id": CONV_ID}, stamp))
        (body,) = seen
        assert body["amqp_timestamp"] == stamp.isoformat()
        assert "amqp_timestamp" not in body["payload"]

    async def test_a_retry_keeps_the_original_publish_time(self):
        async def callback(body):
            raise RuntimeError("transient")

        queue, exchange = await self._bus(callback)
        stamp = datetime(2026, 9, 23, 0, 3, tzinfo=timezone.utc)
        await queue.callback(_Incoming({"conversation_id": CONV_ID}, stamp))
        (retry,) = exchange.published
        assert retry.timestamp == stamp, "a retry must not look newer than it is"
