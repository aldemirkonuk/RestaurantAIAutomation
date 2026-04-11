"""Integration tests for HARD-03: NotificationAgent Level 4 hardening.

Covers:
- Idempotency: duplicate event_id skipped (TestHARD03Idempotency)
- Delivery tracking: notification_deliveries insert/update (TestHARD03DeliveryTracking)
- DLQ escalation after 3 failures (TestHARD03DLQ)
- Edge cases: rate limits, missing event_id, channel fallback, batch health (TestHARD03EdgeCases)
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, call, patch
from agents.notification_agent import NotificationAgent


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def agent():
    """Build a NotificationAgent with fully mocked dependencies."""
    mock_bus = MagicMock()
    mock_db = MagicMock()
    mock_db.supabase = MagicMock()

    # idempotency_keys: not yet processed by default
    mock_db.supabase.table.return_value.select.return_value.eq.return_value\
        .execute.return_value.data = []

    # notification_deliveries insert returns a row with notification_id
    mock_db.supabase.table.return_value.insert.return_value.execute.return_value\
        .data = [{"notification_id": "notif-1"}]

    # notification_deliveries update returns updated row
    mock_db.supabase.table.return_value.update.return_value.eq.return_value\
        .execute.return_value.data = [{"notification_id": "notif-1", "status": "sent"}]

    config = {"mock_mode": True}
    a = NotificationAgent.__new__(NotificationAgent)
    a.agent_name = "test_notification"
    a.logger = MagicMock()
    a.mock_mode = True
    a.config = config
    a.database = mock_db
    a.rate_limits = {
        "sms": {"per_hour": 10, "per_day": 50},
        "email": {"per_hour": 50, "per_day": 200},
        "push": {"per_hour": 100, "per_day": 500},
    }
    a._batch_task = None
    a._redis = None
    a._notification_retry_counts = {}
    a._dlq_escalated = set()
    a.sms_client = MagicMock()
    a.sms_client.send_sms = AsyncMock(return_value={"success": True})
    a.email_client = MagicMock()
    a.email_client.send = AsyncMock(return_value={"success": True})
    a.push_service = MagicMock()
    a.notification_queue = {}
    a.batch_interval_seconds = 300
    a.redis = AsyncMock()
    a.redis.get = AsyncMock(return_value=None)
    a.redis.incr = AsyncMock(return_value=1)
    a.redis.expire = AsyncMock()
    return a


def _run(coro):
    """Run a coroutine in the current event loop."""
    return asyncio.get_event_loop().run_until_complete(coro)


def _base_message(routing_key="alert.high_priority", event_id="evt-001"):
    return {
        "routing_key": routing_key,
        "event_id": event_id,
        "payload": {
            "restaurant_id": "rest-123",
            "event_id": event_id,
            "title": "Test Alert",
            "message": "Test message",
            "alert_type": "test",
        },
    }


# ---------------------------------------------------------------------------
# TestHARD03Idempotency
# ---------------------------------------------------------------------------

class TestHARD03Idempotency:
    @pytest.mark.asyncio
    async def test_duplicate_event_id_skipped(self, agent):
        """Same event_id processed twice: dispatch handler called only once."""
        # First call: idempotency_keys returns empty (not processed)
        agent.database.supabase.table.return_value.select.return_value.eq.return_value\
            .execute.return_value.data = []

        handler_called = []

        async def fake_handler(payload):
            handler_called.append(1)

        with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=fake_handler)):
            with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
                with patch.object(agent, "_mark_processed", new=AsyncMock()):
                    await agent.process_message(_base_message())
            # Second call: idempotency returns True (already processed)
            with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=True)):
                await agent.process_message(_base_message())

        assert len(handler_called) == 1, "Handler should be called exactly once for duplicate event_id"

    @pytest.mark.asyncio
    async def test_unique_event_processed(self, agent):
        """New event_id: processing completes and _mark_processed is called."""
        mark_called = []

        async def fake_mark(event_id, result=None):
            mark_called.append(event_id)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock(side_effect=fake_mark)):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock()):
                    await agent.process_message(_base_message(event_id="evt-unique-001"))

        assert "evt-unique-001" in mark_called, "_mark_processed should be called with the event_id"

    @pytest.mark.asyncio
    async def test_idempotency_fail_open(self, agent):
        """_check_idempotency raises: notification still sent (fail open)."""
        handler_called = []

        async def fail_check(event_id):
            raise Exception("DB connection error")

        async def fake_handler(payload):
            handler_called.append(1)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(side_effect=fail_check)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=fake_handler)):
                    # Should not raise — _check_idempotency failing means we proceed
                    try:
                        await agent.process_message(_base_message())
                    except Exception:
                        pass  # outer exception handler re-raises; we only care handler was called

        assert len(handler_called) == 1, "Notification should be sent even when idempotency check fails"


# ---------------------------------------------------------------------------
# TestHARD03DeliveryTracking
# ---------------------------------------------------------------------------

class TestHARD03DeliveryTracking:
    @pytest.mark.asyncio
    async def test_pending_row_inserted_before_send(self, agent):
        """notification_deliveries insert with status='pending' called before handler."""
        insert_calls = []

        original_insert = agent.database.supabase.table.return_value.insert

        def capture_insert(data):
            insert_calls.append(data)
            mock_result = MagicMock()
            mock_result.execute.return_value.data = [{"notification_id": "notif-1"}]
            return mock_result

        agent.database.supabase.table.return_value.insert = MagicMock(side_effect=capture_insert)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock()):
                    await agent.process_message(_base_message())

        # Find the pending insert among all inserts
        pending_inserts = [c for c in insert_calls if c.get("status") == "pending"]
        assert len(pending_inserts) >= 1, "Should insert a pending row into notification_deliveries"
        assert "event_id" in pending_inserts[0], "Pending row must include event_id"

    @pytest.mark.asyncio
    async def test_sent_row_updated_on_success(self, agent):
        """After successful send, notification_deliveries updated to status='sent' with delivered_at."""
        update_calls = []

        def capture_update(data):
            update_calls.append(data)
            mock_chain = MagicMock()
            mock_chain.eq.return_value.execute.return_value.data = [{"status": "sent"}]
            return mock_chain

        agent.database.supabase.table.return_value.update = MagicMock(side_effect=capture_update)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock()):
                    await agent.process_message(_base_message())

        sent_updates = [c for c in update_calls if c.get("status") == "sent"]
        assert len(sent_updates) >= 1, "Should update notification_deliveries to 'sent'"
        assert "delivered_at" in sent_updates[0], "Sent update must include delivered_at"

    @pytest.mark.asyncio
    async def test_failed_row_updated_on_error(self, agent):
        """On send exception, notification_deliveries updated to status='failed' with error string."""
        update_calls = []

        def capture_update(data):
            update_calls.append(data)
            mock_chain = MagicMock()
            mock_chain.eq.return_value.execute.return_value.data = [{"status": "failed"}]
            return mock_chain

        agent.database.supabase.table.return_value.update = MagicMock(side_effect=capture_update)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=Exception("send failed"))):
                    try:
                        await agent.process_message(_base_message())
                    except Exception:
                        pass  # expected re-raise

        failed_updates = [c for c in update_calls if c.get("status") == "failed"]
        assert len(failed_updates) >= 1, "Should update notification_deliveries to 'failed'"
        assert "error" in failed_updates[0], "Failed update must include error string"

    @pytest.mark.asyncio
    async def test_delivery_record_has_event_id(self, agent):
        """The inserted pending row contains the event_id from the message."""
        inserted_data = []

        def capture_insert(data):
            inserted_data.append(data)
            mock_result = MagicMock()
            mock_result.execute.return_value.data = [{"notification_id": "notif-99"}]
            return mock_result

        agent.database.supabase.table.return_value.insert = MagicMock(side_effect=capture_insert)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock()):
                    await agent.process_message(_base_message(event_id="evt-check-123"))

        pending = [d for d in inserted_data if d.get("status") == "pending"]
        assert len(pending) >= 1
        assert pending[0]["event_id"] == "evt-check-123", "Pending row event_id must match message event_id"


# ---------------------------------------------------------------------------
# TestHARD03DLQ
# ---------------------------------------------------------------------------

class TestHARD03DLQ:
    @pytest.mark.asyncio
    async def test_dlq_triggered_after_3_failures(self, agent):
        """After 3 send failures with same event_id, _send_to_dlq called with retry_count=3."""
        dlq_calls = []

        async def fake_dlq(message, error, retry_count, **kwargs):
            dlq_calls.append({"retry_count": retry_count, "error": error})

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock(side_effect=fake_dlq)):
                    with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=Exception("provider down"))):
                        # Simulate 3 failures for the same event_id
                        for _ in range(3):
                            try:
                                await agent.process_message(_base_message(event_id="evt-fail-001"))
                            except Exception:
                                pass

        assert len(dlq_calls) >= 1, "_send_to_dlq should be called after 3 failures"
        assert dlq_calls[-1]["retry_count"] == 3, "DLQ must be called with retry_count=3"

    @pytest.mark.asyncio
    async def test_dlq_not_triggered_on_first_failure(self, agent):
        """After 1 failure, _send_to_dlq NOT called."""
        dlq_calls = []

        async def fake_dlq(message, error, retry_count, **kwargs):
            dlq_calls.append(retry_count)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock(side_effect=fake_dlq)):
                    with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=Exception("first fail"))):
                        try:
                            await agent.process_message(_base_message(event_id="evt-first-fail"))
                        except Exception:
                            pass

        assert len(dlq_calls) == 0, "_send_to_dlq should NOT be called after only 1 failure"

    @pytest.mark.asyncio
    async def test_dlq_not_retriggered_on_fourth_failure(self, agent):
        """4 calls with same event_id, handler always raises; _send_to_dlq called exactly once."""
        dlq_calls = []

        async def fake_dlq(message, error, retry_count, **kwargs):
            dlq_calls.append(retry_count)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock(side_effect=fake_dlq)):
                    with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=Exception("provider down"))):
                        for _ in range(4):
                            try:
                                await agent.process_message(_base_message(event_id="evt-dlq-once"))
                            except Exception:
                                pass

        assert len(dlq_calls) == 1, "_send_to_dlq must be called exactly once, not on the 4th failure"

    @pytest.mark.asyncio
    async def test_dlq_escalated_drops_delivery_silently(self, agent):
        """After 3 failures, 4th call returns without calling handler or _send_to_dlq again."""
        handler_calls = []
        dlq_calls = []

        async def failing_handler(payload):
            handler_calls.append(1)
            raise Exception("provider down")

        async def fake_dlq(message, error, retry_count, **kwargs):
            dlq_calls.append(retry_count)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock(side_effect=fake_dlq)):
                    with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=failing_handler)):
                        # First 3 calls to reach DLQ threshold
                        for _ in range(3):
                            try:
                                await agent.process_message(_base_message(event_id="evt-drop-silent"))
                            except Exception:
                                pass
                        # 4th call: handler and DLQ must NOT be called
                        handler_calls.clear()
                        dlq_calls.clear()
                        await agent.process_message(_base_message(event_id="evt-drop-silent"))

        assert len(handler_calls) == 0, "Handler must NOT be called for already-DLQ-escalated event_id"
        assert len(dlq_calls) == 0, "_send_to_dlq must NOT be called again for already-escalated event_id"

    @pytest.mark.asyncio
    async def test_retry_count_in_dlq_payload_is_accurate(self, agent):
        """DLQ call receives actual retry count (3), not hardcoded 3."""
        dlq_calls = []

        async def fake_dlq(message, error, retry_count, **kwargs):
            dlq_calls.append(retry_count)

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock(side_effect=fake_dlq)):
                    with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=Exception("fail"))):
                        for _ in range(3):
                            try:
                                await agent.process_message(_base_message(event_id="evt-count-check"))
                            except Exception:
                                pass

        assert len(dlq_calls) == 1, "_send_to_dlq should be called exactly once"
        assert dlq_calls[0] == 3, f"retry_count passed to DLQ must be 3, got {dlq_calls[0]}"


# ---------------------------------------------------------------------------
# TestHARD03EdgeCases
# ---------------------------------------------------------------------------

class TestHARD03EdgeCases:
    @pytest.mark.asyncio
    async def test_rate_limit_does_not_trigger_dlq(self, agent):
        """Rate-limited notification is skipped cleanly — no DLQ, no error."""
        # Make _check_rate_limit return False (rate limited)
        dlq_calls = []

        async def fake_dlq(*args, **kwargs):
            dlq_calls.append(1)

        # Simulate rate-limited path: _check_rate_limit returns False
        # The agent routes to send_low_stock_alert which calls _check_rate_limit
        # We patch the handler to simulate a rate-limit skip (returns without sending)
        async def rate_limited_handler(payload):
            # Simulates handler that checks rate limit and returns without sending
            return  # no send, no exception

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock(side_effect=fake_dlq)):
                    with patch.object(agent, "send_low_stock_alert", new=AsyncMock(side_effect=rate_limited_handler)):
                        await agent.process_message(_base_message(routing_key="stock.threshold.breached", event_id="evt-ratelimit"))

        assert len(dlq_calls) == 0, "Rate-limited notification must NOT trigger DLQ"

    @pytest.mark.asyncio
    async def test_missing_event_id_proceeds(self, agent):
        """Message with no event_id: notification sent normally using generated UUID."""
        handler_called = []

        async def fake_handler(payload):
            handler_called.append(1)

        msg_no_event_id = {
            "routing_key": "alert.high_priority",
            # No event_id at top level
            "payload": {
                "restaurant_id": "rest-456",
                "title": "No event_id alert",
                "message": "Test",
                "alert_type": "test",
            },
        }

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "send_high_priority_alert", new=AsyncMock(side_effect=fake_handler)):
                    await agent.process_message(msg_no_event_id)

        assert len(handler_called) == 1, "Notification should proceed even without event_id"

    @pytest.mark.asyncio
    async def test_channel_fallback_on_sms_failure(self, agent):
        """SMS send fails: agent does NOT fall back to email (no cross-channel fallback).

        Status updated to 'failed', DLQ path taken after 3 retries.
        email_client.send must NOT be called.
        """
        update_calls = []
        email_send_called = []

        def capture_update(data):
            update_calls.append(data)
            mock_chain = MagicMock()
            mock_chain.eq.return_value.execute.return_value.data = [{"status": data.get("status")}]
            return mock_chain

        agent.database.supabase.table.return_value.update = MagicMock(side_effect=capture_update)

        # Simulate a send_low_stock_alert that attempts SMS and fails
        async def sms_fails_handler(payload):
            # Raises as if sms_client.send_sms raised
            raise Exception("SMS provider timeout")

        agent.email_client.send = MagicMock(side_effect=lambda *a, **kw: email_send_called.append(1))

        with patch.object(agent, "_check_idempotency", new=AsyncMock(return_value=False)):
            with patch.object(agent, "_mark_processed", new=AsyncMock()):
                with patch.object(agent, "_send_to_dlq", new=AsyncMock()):
                    with patch.object(agent, "send_low_stock_alert", new=AsyncMock(side_effect=sms_fails_handler)):
                        # 3 failures to trigger DLQ path
                        for _ in range(3):
                            try:
                                await agent.process_message(_base_message(
                                    routing_key="stock.threshold.breached",
                                    event_id="evt-sms-fail",
                                ))
                            except Exception:
                                pass

        # email_client.send should NOT have been called (no fallback)
        assert len(email_send_called) == 0, "email_client.send must NOT be called when SMS fails (no fallback)"

        # notification_deliveries should have failed updates
        failed_updates = [c for c in update_calls if c.get("status") == "failed"]
        assert len(failed_updates) >= 1, "Delivery record must be updated to 'failed'"

    @pytest.mark.asyncio
    async def test_batch_processor_monitored_in_health_check(self, agent):
        """Regression for BUG-08: health_check reports healthy when batch task running,
        and unhealthy when batch task has exited unexpectedly.
        """
        # Case 1: task is running (done() returns False) -> healthy=True
        running_task = MagicMock()
        running_task.done.return_value = False
        agent._batch_task = running_task

        with patch.object(
            type(agent).__bases__[0],
            "health_check",
            new=AsyncMock(return_value={"healthy": True, "agent": "test"}),
        ):
            result = await agent.health_check()

        assert result["healthy"] is True, "healthy must be True when batch task is running"
        assert result.get("batch_processor_running") is True, "batch_processor_running must be True"

        # Case 2: task has exited (done() returns True) -> healthy=False
        dead_task = MagicMock()
        dead_task.done.return_value = True
        dead_task.exception.return_value = RuntimeError("crash")
        # Prevent actual task creation on restart
        dead_task2 = MagicMock()
        dead_task2.done.return_value = False
        agent._batch_task = dead_task

        with patch.object(
            type(agent).__bases__[0],
            "health_check",
            new=AsyncMock(return_value={"healthy": True, "agent": "test"}),
        ):
            with patch("asyncio.create_task", return_value=dead_task2):
                result = await agent.health_check()

        assert result["healthy"] is False, "healthy must be False when batch task has exited"
        assert result.get("batch_processor_running") is False, "batch_processor_running must be False"
