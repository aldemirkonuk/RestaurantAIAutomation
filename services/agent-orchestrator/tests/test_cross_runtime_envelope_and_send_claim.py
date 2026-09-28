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
import re
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
            # The claim's NOT-IN arm: parsed from the REAL `.or_()` filter
            # string the agent built (`status.is.null,status.not.in.(A,B,C)`)
            # rather than a hardcoded mirror of
            # `ProviderConversationAgent._SEND_TERMINAL_STATUSES` — a
            # constant this fake predates would otherwise be free to drift
            # from with no test noticing (found mutation-testing ADR 0099's
            # RELAY_REFUSED addition, 2026-09-21: a hardcoded mirror here left
            # the removal of RELAY_REFUSED from that constant invisible to
            # every test in this file).
            if self._or:
                blocked_match = re.search(r"status\.not\.in\.\(([^)]*)\)", self._or)
                blocked = (
                    set(blocked_match.group(1).split(",")) if blocked_match else set()
                )
                if self._row.get("status") in blocked:
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
    # ADR 0099 (2026-09-19, founder decision, lane answers batch 4): unlike
    # 400/403/422 above, a relay 401 means the ORCHESTRATOR's own service key
    # is wrong or missing at the gateway — a fixable config problem, not proof
    # about the vendor — so it stays ambiguous and parks for a person.
    pytest.param(
        {
            "success": False,
            "error": "gateway refused the send: HTTP 401 — Unauthorized",
            "gateway_status": 401,
        },
        id="relay-401-service-key-problem-is-ambiguous",
    ),
    # 2026-09-28, the Python twin of PR #405's double-send vector. A relay 200
    # `success:false` carries the PROVIDER's words; the gateway's typed
    # classifier found no refusal (no `refusal_kind`), so the vendor may hold
    # the message. Each of these was RELEASED for retry on c8bbf95de because
    # its words matched a phrase — the retry is the second purchase order.
    pytest.param(
        {
            "success": False,
            "error": (
                "gateway refused the send: HTTP 200 — Email delivery failed: "
                "Message failed: 450 4.2.1 Mailbox unavailable"
            ),
            "gateway_status": 200,
        },
        id="relay-200-smtp-450-mailbox-unavailable-is-transient",
    ),
    pytest.param(
        {
            "success": False,
            "error": (
                "gateway refused the send: HTTP 200 — connect ETIMEDOUT " "10.5.1.2:443"
            ),
            "gateway_status": 200,
        },
        id="relay-200-timeout-whose-address-looks-like-an-smtp-code",
    ),
    pytest.param(
        {
            "success": False,
            "error": (
                "gateway refused the send: HTTP 200 — socket hang up after "
                'RCPT TO "Suite 550 - Orders, user unknown" <v@example.com>'
            ),
            "gateway_status": 200,
        },
        id="relay-200-hang-up-quoting-planted-words",
    ),
    # Words alone, with no typed field at all, prove nothing either.
    pytest.param(
        {"success": False, "error": "550 5.1.1 User unknown"},
        id="untyped-words-are-never-read",
    ),
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
        "failure",
        [
            # The gateway's typed refusal on a relay 200 (2026-09-28):
            # `classifySendFailure` proved it from the error's fields.
            pytest.param(
                {
                    "error": "gateway refused the send: HTTP 200 — Message failed: 550 5.1.1 User unknown",
                    "gateway_status": 200,
                    "refusal_kind": "rejected",
                },
                id="relay-200-typed-rejected",
            ),
            pytest.param(
                {
                    "error": "gateway refused the send: HTTP 200 — No email delivery method available",
                    "gateway_status": 200,
                    "refusal_kind": "no-transport",
                },
                id="relay-200-typed-no-transport",
            ),
            # OD-175 (open): released, as before — not decided here.
            pytest.param(
                {
                    "error": "gateway refused the send: HTTP 200 — invalid_grant: token expired",
                    "gateway_status": 200,
                    "refusal_kind": "credentials",
                },
                id="relay-200-typed-credentials",
            ),
            # Refused in this process, before any transport.
            pytest.param(
                {"error": "no_email", "refused_before_send": True},
                id="no-vendor-address",
            ),
            pytest.param(
                {
                    "error": "no email delivery method available: ADMIN_API_KEY is not configured for the orchestrator",
                    "refused_before_send": True,
                },
                id="no-service-key",
            ),
        ],
    )
    async def test_definite_refusal_releases_the_claim_and_raises(self, failure):
        """Proven undelivered: safe to hand back, and a retry is the right
        outcome. None is a relay 400/403/422, so `_relay_final_refusal_code`
        leaves them alone (see TestRelayFinalRefusalCloses below for the
        three that are)."""
        agent = _conversation_agent({"success": False, **failure})

        with pytest.raises(RuntimeError):
            await ProviderConversationAgent._handle_conversation_approved(
                agent, {"conversation_id": CONV_ID}
            )

        assert (
            agent.row["status"] == "PENDING_APPROVAL"
        ), "a proven refusal must return the row to its prior state"

    async def test_classifier_defaults_to_ambiguous(self):
        """The asymmetry that drives the whole design."""
        classify = ProviderConversationAgent._is_definite_send_refusal
        assert classify("") is False
        assert classify(None) is False
        assert classify({}) is False
        assert classify("something weird") is False
        assert (
            classify("451 try later") is False
        ), "an SMTP 4xx is transient and may still have been relayed"
        # 2026-09-28: TEXT IS NEVER READ. This was True on c8bbf95de; the
        # words are someone else's, and only a typed field proves a refusal.
        assert classify("550 user unknown") is False
        assert classify(asyncio.TimeoutError()) is False
        assert classify({"error": "550 user unknown", "gateway_status": 200}) is False
        # A typed kind the gateway does not define proves nothing.
        assert classify({"gateway_status": 200, "refusal_kind": "maybe"}) is False
        # `True` is an int in Python; it is not an HTTP status.
        assert classify({"gateway_status": True}) is False
        assert classify({"gateway_status": 200, "refusal_kind": "rejected"}) is True
        assert classify({"refused_before_send": True}) is True


def _status_of(error: str) -> int:
    """The status these fixtures' sentences name — the typed field
    `send_via_gateway` sets beside them (2026-09-28)."""
    return int(error.split("HTTP ", 1)[1][:3])


class TestRelayFinalRefusalCloses:
    """ADR 0099, founder 2026-09-21: "a 400/403/422 relay refusal is FINAL =
    'Close, no retry'" — narrowing the 2026-09-19 answer
    (TestDefiniteRefusalIsReleased's own header once said these three codes
    too, before this correction). These three still satisfy
    `_is_definite_send_refusal` (read from `gateway_status` since 2026-09-28) —
    what changed is that `_handle_conversation_approved` now checks
    `_relay_final_refusal_code` FIRST and, for exactly these codes, CLOSES
    the row instead of releasing its claim, and does not raise."""

    @pytest.mark.parametrize(
        "error",
        [
            pytest.param(
                "gateway refused the send: HTTP 400 — This mail has no words: bodyText is empty. Nothing was sent.",
                id="relay-400-malformed-request",
            ),
            pytest.param(
                "gateway refused the send: HTTP 403 — Conversation is not one of this house's conversations. Nothing was sent.",
                id="relay-403-doors-own-refusal",
            ),
            pytest.param(
                "gateway refused the send: HTTP 422 — A guardrail refused this content. Nothing was sent.",
                id="relay-422-guardrail-refusal",
            ),
            # ADR 0172, founder 2026-09-21: "a header refusal on the relay
            # path answers a FINAL 422 (not 200 success:false), so both send
            # paths behave alike". Same code, different underlying cause — a
            # 422 minted by RelayEmailService.sendAsOrchestrator when
            # GmailService reports `refusedBeforeSend` rather than by a door
            # check — and this classifier cannot and need not tell the two
            # apart: both are decided before any transport reached the
            # vendor, so both close.
            pytest.param(
                "gateway refused the send: HTTP 422 — Could not fold the Subject header. Nothing was sent — the provider was never called. Fix the header named above and try again.",
                id="relay-422-header-refusal-before-send",
            ),
        ],
    )
    async def test_relay_final_refusal_closes_and_does_not_raise(self, error):
        """CLOSED, not released: a retry would refuse the same request again,
        identically, so nothing must raise to trigger one."""
        agent = _conversation_agent(
            {"success": False, "error": error, "gateway_status": _status_of(error)}
        )

        # No raise — this is the whole point of "no retry".
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )

        assert agent.row["status"] == "RELAY_REFUSED"
        assert agent.row["relay_refusal_reason"] == error
        assert agent.sends, "the send must still have been attempted once"

    async def test_relay_final_refusal_produces_no_second_send_on_replay(self):
        """A closed row must never become re-sendable — the same replay trap
        `TestAmbiguousSendIsParkedNotRetried` guards for the parked case."""
        error = "gateway refused the send: HTTP 403 — refused. Nothing was sent."
        agent = _conversation_agent(
            {"success": False, "error": error, "gateway_status": 403}
        )

        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )
        await ProviderConversationAgent._handle_conversation_approved(
            agent, {"conversation_id": CONV_ID}
        )

        assert (
            len(agent.sends) == 1
        ), f"replay sent {len(agent.sends)} vendor messages — RELAY_REFUSED did not hold as a claim"


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
