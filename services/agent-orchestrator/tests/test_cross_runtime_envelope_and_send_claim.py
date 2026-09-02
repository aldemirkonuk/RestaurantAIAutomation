"""Two cross-runtime omissions: a dropped envelope and an unrecorded vendor send.

DEFECT A — the envelope mismatch
    NestJS publishes a flat body
    (apps/api-gateway/src/common/orchestrator/orchestrator.service.ts:85 —
    `JSON.stringify(event)` on the caller's object). Python's own publisher
    nests the business fields under `payload`
    (core/message_bus.py, `MessageBus.publish` -> `DynamicEvent`). Every Python
    consumer reads `message.get("payload", {})`, so a flat NestJS body yields
    `{}`, every field is missing, the handler bails on its own guard, and the
    event is consumed, acked and dropped without an error.

    `normalize_event_envelope` closes it on the consumer side. These tests pin
    BOTH directions: the flat shape must now reach the handler, and the wrapped
    shape must be untouched.

DEFECT B — the load-bearing bare except
    `ProviderConversationAgent._handle_conversation_approved` sends a message to
    a REAL vendor and used to wrap the whole thing in `except Exception: log`.
    That except is load-bearing: `process_message` re-raises
    (provider_conversation_agent.py), `BaseAgent._process_with_retry` retries,
    and `MessageBus.consume` re-publishes — so letting the exception escape
    turns a silent loss into a DUPLICATE VENDOR EMAIL.

    These tests pin the shape that fixes it without that: claim first, classify
    the failure, release only on a proven refusal, park anything ambiguous in a
    state that is visible and not re-claimable.

Neither defect corrupts data. Both are omissions — messages that never arrive
and outcomes that were never written down. No row is left wrong; rows are left
missing an update.
"""

import asyncio
import json
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.buffer_manager import BufferManagerAgent
from agents.provider_conversation_agent import ProviderConversationAgent
from core.message_bus import normalize_event_envelope

CONV_ID = "11111111-1111-1111-1111-111111111111"


# =============================================================================
# DEFECT A — envelope normalization
# =============================================================================

# Copied verbatim from the NestJS publisher at
# apps/api-gateway/src/inventory/inventory.service.ts:1316.
NESTJS_FLAT_STOCK_EVENT = {
    "restaurant_id": "rest-1",
    "inventory_id": "inv-1",
    "wine_id": "wine-1",
    "old_stock_live": 10,
    "new_stock_live": 2,
    "old_shadow_stock": 10,
    "new_shadow_stock": 2,
    "threshold_min": 6,
    "source": "manual_override",
    "timestamp": "2026-09-01T00:00:00.000Z",
}

# What MessageBus.publish puts on the wire for the same event.
PYTHON_WRAPPED_STOCK_EVENT = {
    "event_type": "stock.manual_override",
    "event_id": "evt-1",
    "correlation_id": None,
    "source_agent": "inventory_engine",
    "version": "1.0",
    "payload": {
        "restaurant_id": "rest-1",
        "inventory_id": "inv-1",
        "wine_id": "wine-1",
        "old_stock_live": 10,
        "new_stock_live": 2,
        "threshold_min": 6,
    },
}


def _buffer_agent():
    """A BufferManagerAgent with only the collaborators this handler touches."""
    agent = object.__new__(BufferManagerAgent)
    agent.logger = MagicMock()
    agent.database = MagicMock()
    agent.database.get_inventory_item = AsyncMock(
        return_value={
            "wine_name": "Test Wine",
            "sales_velocity_7d": 1,
            "in_transit_quantity": 0,
        }
    )
    agent.publish = AsyncMock()
    return agent


class TestEnvelopeNormalization:
    async def test_flat_nestjs_event_reaches_a_python_consumer(self):
        """FAILS on unmodified main: the handler bailed and published nothing."""
        agent = _buffer_agent()
        body = normalize_event_envelope(
            json.loads(json.dumps(NESTJS_FLAT_STOCK_EVENT)),
            "stock.manual_override",
            "stock.events",
        )

        await BufferManagerAgent._handle_manual_override(agent, body)

        assert agent.publish.await_count == 1, (
            "a NestJS-shaped flat event was dropped: the consumer read "
            "message['payload'] and found nothing"
        )
        published = agent.publish.await_args.kwargs
        assert published["routing_key"] == "stock.threshold.breached"
        assert published["message_body"]["payload"]["inventory_id"] == "inv-1"

    async def test_wrapped_python_event_still_works(self):
        """Python -> Python traffic must be completely unaffected."""
        agent = _buffer_agent()
        body = normalize_event_envelope(
            json.loads(json.dumps(PYTHON_WRAPPED_STOCK_EVENT)),
            "stock.manual_override",
            "stock.events",
        )

        await BufferManagerAgent._handle_manual_override(agent, body)

        assert agent.publish.await_count == 1
        assert (
            agent.publish.await_args.kwargs["message_body"]["payload"]["inventory_id"]
            == "inv-1"
        )

    def test_existing_payload_is_never_rewritten(self):
        """The guarantee that keeps Python -> Python safe: setdefault, not set."""
        original = {"event_type": "x", "payload": {"a": 1}}
        out = normalize_event_envelope(dict(original), "rk", "ex")
        assert out["payload"] == {"a": 1}, "an existing payload must survive verbatim"

    def test_normalization_is_purely_additive(self):
        """Nothing is deleted, renamed or moved — only `payload` is added."""
        flat = dict(NESTJS_FLAT_STOCK_EVENT)
        out = normalize_event_envelope(dict(flat), "rk", "ex")
        for key, value in flat.items():
            assert out[key] == value, f"{key} was altered by normalization"
        assert out["payload"]["inventory_id"] == "inv-1"

    def test_typed_base_event_without_payload_gains_a_mirror(self):
        """A typed BaseEvent (e.g. StockEvaluatedEvent) carries domain fields flat.

        It gains a payload mirror and keeps every top-level field, so consumers
        that read those fields flat read exactly what they read before.
        """
        typed = {
            "event_id": "e1",
            "event_type": "stock.evaluated",
            "version": "1.0",
            "inventory_id": "inv-9",
            "stock_after": 3,
        }
        out = normalize_event_envelope(dict(typed), "stock.evaluated", "stock.events")
        assert out["inventory_id"] == "inv-9"
        assert out["payload"] == {"inventory_id": "inv-9", "stock_after": 3}
        assert "event_id" not in out["payload"], "envelope keys are not domain data"

    def test_is_idempotent(self):
        once = normalize_event_envelope(dict(NESTJS_FLAT_STOCK_EVENT), "rk", "ex")
        twice = normalize_event_envelope(dict(once), "rk", "ex")
        assert twice == once

    def test_non_dict_body_is_passed_through(self):
        assert normalize_event_envelope([1, 2], "rk", "ex") == [1, 2]

    def test_routing_key_forwarding_is_preserved(self):
        out = normalize_event_envelope({"a": 1}, "some.key", "some.exchange")
        assert out["routing_key"] == "some.key"
        assert out["exchange"] == "some.exchange"
        out2 = normalize_event_envelope(
            {"a": 1, "routing_key": "explicit"}, "some.key", "some.exchange"
        )
        assert out2["routing_key"] == "explicit", "an explicit routing_key wins"


# =============================================================================
# DEFECT B — claim / classify / park around a real vendor send
# =============================================================================


class _FakeQuery:
    """Just enough PostgREST to honour the conditional filters the claim uses."""

    _BLOCKED = ("SENDING", "SENT", "AUTO_SENT", "SEND_UNCONFIRMED")

    def __init__(self, table, row):
        self._table = table
        self._row = row
        self._op = None
        self._payload = None
        self._filters = {}
        self._or = None

    def select(self, *a, **k):
        self._op = "select"
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def eq(self, column, value):
        self._filters[column] = value
        return self

    def or_(self, filters, *a, **k):
        self._or = filters
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def single(self):
        return self

    def execute(self):
        if self._op == "update":
            if self._table != "procurement_conversations":
                return types.SimpleNamespace(data=[{}])
            # conditional UPDATE ... WHERE status = <expected>
            if (
                "status" in self._filters
                and self._row.get("status") != self._filters["status"]
            ):
                return types.SimpleNamespace(data=[])
            # the claim's NOT-IN arm
            if self._or and self._row.get("status") in self._BLOCKED:
                return types.SimpleNamespace(data=[])
            self._row.update(self._payload)
            return types.SimpleNamespace(data=[dict(self._row)])
        if self._table == "procurement_conversations":
            return types.SimpleNamespace(data=dict(self._row))
        if self._table == "providers":
            return types.SimpleNamespace(
                data={
                    "name": "Test Vendor",
                    "primary_contact": {"email": "vendor@example.com"},
                }
            )
        return types.SimpleNamespace(data={})


class _FakeSupabase:
    def __init__(self, row):
        self.row = row

    def table(self, name):
        return _FakeQuery(name, self.row)


def _conversation_agent(send_outcome, status="PENDING_APPROVAL"):
    """A real agent instance (real method resolution) with a stubbed send."""
    row = {
        "id": CONV_ID,
        "message_text": "Could you quote 12 bottles?",
        "provider_id": "prov-1",
        "channel": "email",
        "order_id": "order-1",
        "status": status,
        "message_id": None,
        "conversation_context": {},
    }
    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = types.SimpleNamespace(supabase=_FakeSupabase(row))
    agent._active_sessions = {}
    agent.row = row
    agent.sends = []

    async def _send(**kwargs):
        agent.sends.append(kwargs)
        if isinstance(send_outcome, BaseException):
            raise send_outcome
        return send_outcome

    agent._send_message = _send
    return agent


AMBIGUOUS_FAILURES = [
    pytest.param(asyncio.TimeoutError(), id="socket-timeout-raised"),
    pytest.param(
        {"success": False, "error": "Connection reset by peer"},
        id="econnreset-returned",
    ),
    pytest.param({"success": False, "error": "socket hang up"}, id="hang-up-returned"),
    pytest.param(
        {"success": False, "error": "451 4.3.0 try again later"},
        id="smtp-4xx-is-transient-not-a-refusal",
    ),
    pytest.param({"success": False, "error": ""}, id="unnameable-failure"),
]


class TestAmbiguousSendIsParkedNotRetried:
    @pytest.mark.parametrize("failure", AMBIGUOUS_FAILURES)
    async def test_ambiguous_failure_parks_and_does_not_raise(self, failure):
        """FAILS on unmodified main: nothing was recorded and the row stayed re-sendable."""
        agent = _conversation_agent(failure)

        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )

        assert (
            agent.row["status"] == "SEND_UNCONFIRMED"
        ), "an ambiguous send failure must be parked where a human can see it"
        assert agent.row[
            "message_id"
        ], "the Message-ID must be minted and stored before the send"

    @pytest.mark.parametrize("failure", AMBIGUOUS_FAILURES)
    async def test_ambiguous_failure_produces_no_second_send_on_replay(self, failure):
        """The trap: the bus retries on an exception, and a retry here costs money."""
        agent = _conversation_agent(failure)

        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        # Exactly what BaseAgent._process_with_retry / MessageBus.consume would do.
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )

        assert (
            len(agent.sends) == 1
        ), f"replay sent {len(agent.sends)} vendor messages — the claim did not hold"

    async def test_parked_conversation_is_not_reclaimable(self):
        agent = _conversation_agent(
            {"success": False, "error": "timeout"}, status="SEND_UNCONFIRMED"
        )
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        assert agent.sends == [], "a parked conversation must never be re-sent"


class TestDefiniteRefusalIsReleased:
    @pytest.mark.parametrize(
        "error",
        [
            "550 5.1.1 User unknown",
            "Recipient address rejected: does not exist",
            "No email delivery method available",
            "invalid_grant: token expired",
        ],
    )
    async def test_definite_refusal_releases_the_claim_and_raises(self, error):
        """Proven undelivered: safe to hand back, and a retry is the right outcome."""
        agent = _conversation_agent({"success": False, "error": error})

        with pytest.raises(RuntimeError):
            await ProviderConversationAgent._handle_conversation_approved(
                agent, {"conversation_id": CONV_ID}
            )

        assert (
            agent.row["status"] == "PENDING_APPROVAL"
        ), "a proven refusal must return the row to its prior state"

    async def test_classifier_defaults_to_ambiguous(self):
        """The asymmetry that drives the whole design."""
        assert ProviderConversationAgent._is_definite_send_refusal("") is False
        assert ProviderConversationAgent._is_definite_send_refusal(None) is False
        assert (
            ProviderConversationAgent._is_definite_send_refusal("something weird")
            is False
        )
        assert (
            ProviderConversationAgent._is_definite_send_refusal("451 try later")
            is False
        ), "an SMTP 4xx is transient and may still have been relayed"
        assert (
            ProviderConversationAgent._is_definite_send_refusal("550 user unknown")
            is True
        )


class TestSuccessfulSend:
    async def test_success_marks_sent_and_blocks_replay(self):
        agent = _conversation_agent({"success": True, "message_id": "gm-1"})

        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        assert agent.row["status"] == "SENT"

        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        assert len(agent.sends) == 1, "a sent conversation must never be re-sent"

    async def test_message_id_is_reused_across_attempts(self):
        """A retry must reuse the stored id, not mint a second one."""
        agent = _conversation_agent({"success": False, "error": "timeout"})
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        first_id = agent.row["message_id"]

        # Simulate an operator releasing the parked row for one deliberate retry.
        agent.row["status"] = "PENDING_APPROVAL"
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )

        assert (
            agent.row["message_id"] == first_id
        ), "a fresh Message-ID would arrive at the vendor as a second, unrelated order"
