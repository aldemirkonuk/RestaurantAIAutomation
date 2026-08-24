"""
Unit tests for BaseAgent infrastructure additions (Plan 18-02).
Tests: idempotency, decision logging, DLQ, correlation ID propagation.
"""

import asyncio
import uuid
from typing import Dict, Any, List
from unittest.mock import MagicMock, AsyncMock, call

from core.base_agent import BaseAgent


# ---------------------------------------------------------------------------
# Concrete test subclass
# ---------------------------------------------------------------------------


class ConcreteAgent(BaseAgent):
    """Minimal concrete implementation for testing."""

    def __init__(self, agent_name, message_bus, database, config=None):
        super().__init__(agent_name, message_bus, database, config or {})
        self.process_calls = 0
        self.should_raise = None

    async def initialize(self) -> None:
        pass

    async def process_message(self, message: Dict[str, Any]) -> None:
        self.process_calls += 1
        if self.should_raise:
            raise self.should_raise

    def get_subscribed_routing_keys(self) -> List[tuple]:
        return [("test.exchange", "test.key")]


def make_agent(raise_on_process=None):
    """Build a ConcreteAgent with fully mocked dependencies."""
    message_bus = MagicMock()
    message_bus.publish = AsyncMock(return_value=True)
    message_bus.publish_event = AsyncMock(return_value=True)
    message_bus.declare_queue = AsyncMock()
    message_bus.consume = AsyncMock()

    # Build a mock supabase chain: .table().select().eq().execute() etc.
    supabase = MagicMock()
    database = MagicMock()
    database.supabase = supabase

    agent = ConcreteAgent("test_agent", message_bus, database)
    if raise_on_process:
        agent.should_raise = raise_on_process

    return agent, supabase


def _make_supabase_result(data):
    """Return a mock that behaves like a Supabase execute() result."""
    result = MagicMock()
    result.data = data
    return result


# ---------------------------------------------------------------------------
# _check_idempotency
# ---------------------------------------------------------------------------


class TestCheckIdempotency:

    def test_returns_false_for_new_message(self):
        agent, supabase = make_agent()
        # Supabase returns empty list → message not seen before
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            []
        )

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_idempotency("new-msg-id")
        )
        assert result is False

    def test_returns_true_for_existing_message(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            [{"message_id": "existing-id"}]
        )

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_idempotency("existing-id")
        )
        assert result is True

    def test_fails_open_on_db_error(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = Exception(
            "DB connection lost"
        )

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_idempotency("any-id")
        )
        # Must fail open (return False) so processing continues
        assert result is False

    def test_returns_false_for_empty_message_id(self):
        agent, supabase = make_agent()

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_idempotency("")
        )
        assert result is False
        # Should not hit DB at all
        supabase.table.assert_not_called()


# ---------------------------------------------------------------------------
# _mark_processed
# ---------------------------------------------------------------------------


class TestMarkProcessed:

    def test_inserts_row_to_idempotency_keys(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent._mark_processed("msg-1", {"ok": True})
        )

        supabase.table.assert_called_with("idempotency_keys")
        supabase.table.return_value.insert.assert_called_once()
        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert insert_args["message_id"] == "msg-1"
        assert insert_args["agent_name"] == "test_agent"

    def test_skips_insert_for_empty_message_id(self):
        agent, supabase = make_agent()

        asyncio.get_event_loop().run_until_complete(agent._mark_processed(""))
        supabase.table.assert_not_called()

    def test_swallows_db_error(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.side_effect = Exception(
            "DB error"
        )

        # Should not raise
        asyncio.get_event_loop().run_until_complete(agent._mark_processed("msg-1"))


# ---------------------------------------------------------------------------
# _process_with_retry — idempotency integration
# ---------------------------------------------------------------------------


class TestProcessWithRetryIdempotency:

    def test_skips_duplicate_message(self):
        agent, supabase = make_agent()
        # Message already processed
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            [{"message_id": "dup-id"}]
        )

        asyncio.get_event_loop().run_until_complete(
            agent._process_with_retry({"message_id": "dup-id"})
        )

        assert agent.process_calls == 0
        assert agent.metrics.messages_skipped >= 1

    def test_marks_processed_after_success(self):
        agent, supabase = make_agent()
        # Check: not seen before
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            []
        )
        # Insert: success
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent._process_with_retry({"message_id": "new-msg"})
        )

        assert agent.process_calls == 1
        # _mark_processed should have been called → insert on idempotency_keys
        insert_calls = [
            c for c in supabase.table.call_args_list if c == call("idempotency_keys")
        ]
        assert len(insert_calls) >= 1


# ---------------------------------------------------------------------------
# log_decision
# ---------------------------------------------------------------------------


class TestLogDecision:

    def test_persists_to_decision_log(self):
        agent, supabase = make_agent()
        agent._current_correlation_id = "corr-123"
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent.log_decision(
                decision_type="match",
                inputs={"wine": "Barolo"},
                output={"matched": True},
                reasoning="High confidence match",
                confidence=0.95,
                restaurant_id="rest-uuid",
            )
        )

        supabase.table.assert_called_with("decision_log")
        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert insert_args["agent_name"] == "test_agent"
        assert insert_args["decision_type"] == "match"
        assert insert_args["confidence"] == 0.95
        assert insert_args["correlation_id"] == "corr-123"
        assert insert_args["restaurant_id"] == "rest-uuid"

    def test_does_not_chain_select_onto_the_insert_builder(self):
        """Regression (P1 readout): supabase-py >= 2 returns a builder with no
        .select() from .insert(). The old `.insert(...).select("id").execute()`
        raised AttributeError, which this method's except-block swallowed — so
        decision_log took ZERO writes and every neural_footprint_event
        correlation_id joined to nothing. A permissive MagicMock hid it; this
        spec'd mock has the real shape.
        """
        agent, supabase = make_agent()
        agent._current_correlation_id = "corr-select-regression"

        insert_builder = MagicMock(spec=["execute"])
        insert_builder.execute.return_value = _make_supabase_result([{"id": "d-1"}])
        table = MagicMock(spec=["insert"])
        table.insert.return_value = insert_builder
        supabase.table.return_value = table

        row_id = asyncio.get_event_loop().run_until_complete(
            agent.log_decision("match", {}, {}, "reason")
        )

        assert row_id == "d-1", "log_decision swallowed the insert failure"
        insert_builder.execute.assert_called_once()

    def test_swallows_db_error(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.side_effect = Exception(
            "DB error"
        )

        # Should not raise
        asyncio.get_event_loop().run_until_complete(
            agent.log_decision("type", {}, {}, "reason")
        )


# ---------------------------------------------------------------------------
# _send_to_dlq
# ---------------------------------------------------------------------------


class TestSendToDlq:

    def test_persists_failed_message_to_dlq(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )
        message = {"message_id": "m1", "payload": "data"}

        asyncio.get_event_loop().run_until_complete(
            agent._send_to_dlq(
                message=message,
                error="Timeout",
                retry_count=3,
                original_exchange="orders",
                original_routing_key="order.created",
            )
        )

        supabase.table.assert_called_with("dead_letter_queue")
        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert insert_args["agent_name"] == "test_agent"
        assert insert_args["original_exchange"] == "orders"
        assert insert_args["original_routing_key"] == "order.created"
        assert insert_args["error"] == "Timeout"
        assert insert_args["retry_count"] == 3

    def test_sends_to_dlq_after_retry_exhaustion(self):
        agent, supabase = make_agent()
        agent.should_raise = Exception("processing failed")
        agent.config.max_retries = 3

        # Idempotency check: not seen
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            []
        )
        # DLQ insert: success
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent._process_with_retry({"message_id": "fail-msg"})
        )

        # DLQ should have been called
        dlq_calls = [
            c for c in supabase.table.call_args_list if c == call("dead_letter_queue")
        ]
        assert len(dlq_calls) >= 1
        assert agent.metrics.messages_failed == 1


# ---------------------------------------------------------------------------
# Correlation ID
# ---------------------------------------------------------------------------


class TestCorrelationId:

    def test_extracted_from_incoming_message(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            []
        )
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent._process_with_retry(
                {"message_id": "m1", "correlation_id": "trace-abc"}
            )
        )

        assert agent._current_correlation_id == "trace-abc"

    def test_generated_if_missing_from_message(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = _make_supabase_result(
            []
        )
        supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_supabase_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent._process_with_retry({"message_id": "m2"})
        )

        assert agent._current_correlation_id is not None
        # Should be a valid UUID
        uuid.UUID(agent._current_correlation_id)

    def test_injected_into_publish(self):
        agent, supabase = make_agent()
        agent._current_correlation_id = "trace-xyz"

        body = {"data": "test"}
        asyncio.get_event_loop().run_until_complete(
            agent.publish("test.exchange", "test.key", body)
        )

        assert body["correlation_id"] == "trace-xyz"
        assert body["source_agent"] == "test_agent"
