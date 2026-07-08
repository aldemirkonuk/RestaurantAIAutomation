"""
Unit tests for saga state management, event store append, and outbox publisher (Plan 18-03).
"""

import asyncio
import uuid
from typing import Dict, Any, List
from unittest.mock import MagicMock, AsyncMock
import pytest

from core.base_agent import BaseAgent
from core.outbox_publisher import OutboxPublisher


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class ConcreteAgent(BaseAgent):
    async def initialize(self) -> None:
        pass

    async def process_message(self, message: Dict[str, Any]) -> None:
        pass

    def get_subscribed_routing_keys(self) -> List[tuple]:
        return []


def make_agent():
    message_bus = MagicMock()
    message_bus.publish = AsyncMock(return_value=True)
    supabase = MagicMock()
    database = MagicMock()
    database.supabase = supabase
    agent = ConcreteAgent("test_agent", message_bus, database, {})
    return agent, supabase


def make_result(data):
    r = MagicMock()
    r.data = data
    return r


def make_publisher():
    message_bus = MagicMock()
    message_bus.publish = AsyncMock(return_value=True)
    supabase = MagicMock()
    database = MagicMock()
    database.supabase = supabase
    publisher = OutboxPublisher(message_bus, database)
    return publisher, supabase, message_bus


# ---------------------------------------------------------------------------
# start_saga
# ---------------------------------------------------------------------------


class TestStartSaga:

    def test_creates_row_with_in_progress_status(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.return_value = (
            make_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent.start_saga("order_fulfillment", {"order_id": "123"})
        )

        supabase.table.assert_called_with("saga_state")
        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert insert_args["saga_type"] == "order_fulfillment"
        assert insert_args["status"] == "IN_PROGRESS"
        assert insert_args["current_step"] == "INIT"
        assert insert_args["context"] == {"order_id": "123"}
        assert insert_args["compensations"] == []

    def test_returns_saga_id_as_uuid_string(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.return_value = (
            make_result([])
        )

        saga_id = asyncio.get_event_loop().run_until_complete(
            agent.start_saga("order_fulfillment", {})
        )

        assert isinstance(saga_id, str)
        uuid.UUID(saga_id)  # validates UUID format

    def test_sets_deadline_at(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.return_value = (
            make_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent.start_saga("order_fulfillment", {}, deadline_minutes=30)
        )

        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert "deadline_at" in insert_args
        assert insert_args["deadline_at"] is not None

    def test_raises_on_db_error(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.side_effect = Exception(
            "DB error"
        )

        with pytest.raises(Exception, match="DB error"):
            asyncio.get_event_loop().run_until_complete(
                agent.start_saga("order_fulfillment", {})
            )


# ---------------------------------------------------------------------------
# advance_saga
# ---------------------------------------------------------------------------


class TestAdvanceSaga:

    def test_updates_current_step(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = make_result(
            [{"compensations": []}]
        )
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        asyncio.get_event_loop().run_until_complete(
            agent.advance_saga("saga-1", "step_2")
        )

        update_args = supabase.table.return_value.update.call_args[0][0]
        assert update_args["current_step"] == "step_2"

    def test_appends_compensation_info(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = make_result(
            [{"compensations": []}]
        )
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        asyncio.get_event_loop().run_until_complete(
            agent.advance_saga(
                "saga-1", "step_2", compensation_info={"action": "rollback_order"}
            )
        )

        update_args = supabase.table.return_value.update.call_args[0][0]
        assert len(update_args["compensations"]) == 1
        assert update_args["compensations"][0]["step"] == "step_2"
        assert update_args["compensations"][0]["compensation"] == {
            "action": "rollback_order"
        }


# ---------------------------------------------------------------------------
# complete_saga
# ---------------------------------------------------------------------------


class TestCompleteSaga:

    def test_sets_status_to_completed(self):
        agent, supabase = make_agent()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        asyncio.get_event_loop().run_until_complete(agent.complete_saga("saga-1"))

        update_args = supabase.table.return_value.update.call_args[0][0]
        assert update_args["status"] == "COMPLETED"
        assert update_args["current_step"] == "DONE"


# ---------------------------------------------------------------------------
# compensate_saga
# ---------------------------------------------------------------------------


class TestCompensateSaga:

    def test_sets_status_to_compensated(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = make_result(
            [{"saga_type": "order_fulfillment", "compensations": []}]
        )
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        asyncio.get_event_loop().run_until_complete(
            agent.compensate_saga("saga-1", "timeout")
        )

        update_args = supabase.table.return_value.update.call_args[0][0]
        assert update_args["status"] == "COMPENSATED"
        assert update_args["error"] == "timeout"

    def test_handles_missing_saga_gracefully(self):
        agent, supabase = make_agent()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        # Should not raise
        asyncio.get_event_loop().run_until_complete(
            agent.compensate_saga("nonexistent", "error")
        )


# ---------------------------------------------------------------------------
# append_event
# ---------------------------------------------------------------------------


class TestAppendEvent:

    def test_inserts_to_event_store(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.return_value = (
            make_result([])
        )
        agg_id = str(uuid.uuid4())

        asyncio.get_event_loop().run_until_complete(
            agent.append_event("inventory", agg_id, "stock.decremented", {"qty": -1}, 1)
        )

        supabase.table.assert_called_with("event_store")
        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert insert_args["aggregate_type"] == "inventory"
        assert insert_args["aggregate_id"] == agg_id
        assert insert_args["event_type"] == "stock.decremented"
        assert insert_args["payload"] == {"qty": -1}
        assert insert_args["sequence_number"] == 1

    def test_includes_correlation_id(self):
        agent, supabase = make_agent()
        agent._current_correlation_id = "trace-abc"
        supabase.table.return_value.insert.return_value.execute.return_value = (
            make_result([])
        )

        asyncio.get_event_loop().run_until_complete(
            agent.append_event(
                "inventory", str(uuid.uuid4()), "stock.decremented", {}, 1
            )
        )

        insert_args = supabase.table.return_value.insert.call_args[0][0]
        assert insert_args["correlation_id"] == "trace-abc"

    def test_raises_on_db_error(self):
        agent, supabase = make_agent()
        supabase.table.return_value.insert.return_value.execute.side_effect = Exception(
            "unique constraint violation"
        )

        with pytest.raises(Exception):
            asyncio.get_event_loop().run_until_complete(
                agent.append_event(
                    "inventory", str(uuid.uuid4()), "stock.decremented", {}, 1
                )
            )


# ---------------------------------------------------------------------------
# OutboxPublisher
# ---------------------------------------------------------------------------


class TestOutboxPublisher:

    def test_polls_unpublished_rows(self):
        publisher, supabase, _ = make_publisher()
        supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = make_result(
            []
        )

        asyncio.get_event_loop().run_until_complete(publisher.poll_and_publish())

        supabase.table.assert_called_with("outbox")
        eq_call = supabase.table.return_value.select.return_value.eq.call_args
        assert eq_call[0] == ("published", False)

    def test_dispatches_to_rabbitmq(self):
        publisher, supabase, message_bus = make_publisher()
        rows = [
            {
                "id": 1,
                "exchange": "orders",
                "routing_key": "order.created",
                "payload": {"order_id": "123"},
            }
        ]
        supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = make_result(
            rows
        )
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        count = asyncio.get_event_loop().run_until_complete(
            publisher.poll_and_publish()
        )

        message_bus.publish.assert_called_once_with(
            exchange_name="orders",
            routing_key="order.created",
            message_body={"order_id": "123"},
        )
        assert count == 1

    def test_marks_published_after_dispatch(self):
        publisher, supabase, _ = make_publisher()
        rows = [
            {
                "id": 42,
                "exchange": "orders",
                "routing_key": "order.created",
                "payload": {},
            }
        ]
        supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = make_result(
            rows
        )
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        asyncio.get_event_loop().run_until_complete(publisher.poll_and_publish())

        update_args = supabase.table.return_value.update.call_args[0][0]
        assert update_args["published"] is True
        assert "published_at" in update_args

    def test_continues_on_single_dispatch_failure(self):
        publisher, supabase, message_bus = make_publisher()
        rows = [
            {"id": 1, "exchange": "ex", "routing_key": "rk", "payload": {}},
            {"id": 2, "exchange": "ex", "routing_key": "rk", "payload": {}},
        ]
        supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = make_result(
            rows
        )
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = make_result(
            []
        )

        # First call fails, second succeeds
        message_bus.publish.side_effect = [Exception("connection lost"), True]

        count = asyncio.get_event_loop().run_until_complete(
            publisher.poll_and_publish()
        )

        assert count == 1  # second row still published
        assert message_bus.publish.call_count == 2

    def test_noop_when_no_unpublished_rows(self):
        publisher, supabase, message_bus = make_publisher()
        supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = make_result(
            []
        )

        count = asyncio.get_event_loop().run_until_complete(
            publisher.poll_and_publish()
        )

        assert count == 0
        message_bus.publish.assert_not_called()

    def test_stop_signals_shutdown(self):
        publisher, _, _ = make_publisher()
        assert publisher._shutdown is False
        publisher.stop()
        assert publisher._shutdown is True
