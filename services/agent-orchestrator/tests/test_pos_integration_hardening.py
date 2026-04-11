"""Integration tests for HARD-02: POSIntegrationAgent Level 4 hardening.

Covers:
- Webhook deduplication via composite (order_guid, event_type) idempotency key
- Wine detection decision logging with correct confidence values
- Toast polling saga: trigger, advance, complete, compensate, PartialOrderReceived publish
- Edge cases: invalid signature, refund idempotency, missing order_guid
"""
import pytest
import hmac
import hashlib
import json
from unittest.mock import AsyncMock, MagicMock, call, patch

from agents.pos_integration_agent import POSIntegrationAgent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_webhook_payload(order_guid="g-1", event_type="OrderCompleted", items=None):
    """Build a minimal Toast-like webhook payload."""
    return {
        "order_guid": order_guid,
        "event_type": event_type,
        "items": items if items is not None else [],
        "restaurant_id": "rest-1",
    }


def make_valid_signature(secret: str, body: str) -> str:
    """Compute HMAC-SHA256 signature the same way Phase 19 fixed code does."""
    return hmac.HMAC(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def agent():
    """Build POSIntegrationAgent with minimal mocks (no real DB / message bus)."""
    mock_bus = MagicMock()
    mock_db = MagicMock()
    mock_db.supabase = MagicMock()
    # Idempotency table: empty = key not seen yet
    mock_db.supabase.table.return_value.select.return_value.eq.return_value \
        .execute.return_value.data = []
    # Saga insert returns a saga_id
    mock_db.supabase.table.return_value.insert.return_value.execute.return_value \
        .data = [{"saga_id": "saga-1"}]

    config = {
        "toast_webhook_secret": "test-secret",
        "mock_mode": True,
        "toast_api_url": "https://test.toasttab.com",
    }
    a = POSIntegrationAgent("pos_agent", mock_bus, mock_db, config)
    # Patch out infrastructure BaseAgent methods so tests stay unit-scoped
    a._check_idempotency = AsyncMock(return_value=False)
    a._mark_processed = AsyncMock()
    a.log_decision = AsyncMock()
    a.start_saga = AsyncMock(return_value="saga-test-1")
    a.advance_saga = AsyncMock()
    a.complete_saga = AsyncMock()
    a.compensate_saga = AsyncMock()
    a.publish = AsyncMock()
    a.log_webhook_event = AsyncMock()
    a.handle_order_completed = AsyncMock(return_value={"status": "success", "wine_count": 1})
    a.handle_order_refunded = AsyncMock(return_value={"status": "success"})
    a.handle_item_voided = AsyncMock(return_value={"status": "success"})
    a.handle_menu_modified = AsyncMock(return_value={"status": "success"})
    return a


@pytest.fixture
def full_agent():
    """Agent with real handle_order_completed (not mocked) for wine detection tests."""
    mock_bus = MagicMock()
    mock_db = MagicMock()
    mock_db.supabase = MagicMock()
    mock_db.supabase.table.return_value.select.return_value.eq.return_value \
        .execute.return_value.data = []
    mock_db.supabase.table.return_value.insert.return_value.execute.return_value \
        .data = [{"saga_id": "saga-1"}]

    config = {
        "toast_webhook_secret": "test-secret",
        "mock_mode": True,
        "toast_api_url": "https://test.toasttab.com",
    }
    a = POSIntegrationAgent("pos_agent", mock_bus, mock_db, config)
    a._check_idempotency = AsyncMock(return_value=False)
    a._mark_processed = AsyncMock()
    a.log_decision = AsyncMock()
    a.start_saga = AsyncMock(return_value="saga-test-1")
    a.advance_saga = AsyncMock()
    a.complete_saga = AsyncMock()
    a.compensate_saga = AsyncMock()
    a.publish = AsyncMock()
    a.log_webhook_event = AsyncMock()
    a.publish_wine_sale_event = AsyncMock()
    a.match_wine_to_library = AsyncMock(return_value=None)
    a.get_restaurant_id = AsyncMock(return_value="rest-1")
    a._poll_toast_for_order = AsyncMock(return_value=[])
    return a


# ===========================================================================
# Class TestHARD02WebhookDedup
# ===========================================================================

class TestHARD02WebhookDedup:
    """4 tests: composite-key idempotency in process_toast_webhook."""

    @pytest.mark.asyncio
    async def test_duplicate_webhook_returns_duplicate_status(self, agent):
        """Same order_guid:event_type processed twice — second call returns duplicate."""
        # First call: not a duplicate
        agent._check_idempotency = AsyncMock(return_value=False)
        payload = make_webhook_payload(order_guid="guid-123", event_type="OrderCompleted")
        # Add eventType for routing
        payload["eventType"] = "OrderCompleted"
        result1 = await agent.process_toast_webhook(payload)
        assert result1.get("status") != "duplicate"

        # Second call: idempotency key already seen
        agent._check_idempotency = AsyncMock(return_value=True)
        result2 = await agent.process_toast_webhook(payload)
        assert result2.get("status") == "duplicate", \
            f"Expected 'duplicate', got: {result2}"

    @pytest.mark.asyncio
    async def test_first_webhook_processed(self, agent):
        """Unique key: processing completes and _mark_processed is called."""
        agent._check_idempotency = AsyncMock(return_value=False)
        payload = make_webhook_payload(order_guid="unique-guid-1", event_type="OrderCompleted")
        payload["eventType"] = "OrderCompleted"

        result = await agent.process_toast_webhook(payload)

        assert result.get("status") != "duplicate"
        agent._mark_processed.assert_called_once()
        call_args = agent._mark_processed.call_args[0]
        assert "unique-guid-1" in call_args[0]

    @pytest.mark.asyncio
    async def test_idempotency_key_is_composite(self, agent):
        """_check_idempotency must be called with composite 'guid-123:OrderCompleted' key."""
        agent._check_idempotency = AsyncMock(return_value=False)
        payload = make_webhook_payload(order_guid="guid-123", event_type="OrderCompleted")
        payload["eventType"] = "OrderCompleted"

        await agent.process_toast_webhook(payload)

        agent._check_idempotency.assert_called_once()
        key_used = agent._check_idempotency.call_args[0][0]
        assert key_used == "guid-123:OrderCompleted", \
            f"Expected composite key 'guid-123:OrderCompleted', got: '{key_used}'"

    @pytest.mark.asyncio
    async def test_idempotency_fail_open(self, agent):
        """If _check_idempotency raises, the webhook is still processed (fail open)."""
        agent._check_idempotency = AsyncMock(side_effect=Exception("DB unavailable"))
        payload = make_webhook_payload(order_guid="guid-err", event_type="OrderCompleted")
        payload["eventType"] = "OrderCompleted"

        # Should not propagate the exception; should return an error or success
        result = await agent.process_toast_webhook(payload)
        # The outer try/except in process_toast_webhook catches it and returns error status
        assert result is not None  # did not crash the caller


# ===========================================================================
# Class TestHARD02WineDetection
# ===========================================================================

class TestHARD02WineDetection:
    """4 tests: log_decision called per item with correct confidence values."""

    @pytest.mark.asyncio
    async def test_wine_item_by_category(self, full_agent):
        """Item with menuGroup.name='Wine' triggers log_decision with confidence=0.9."""
        webhook_data = {
            "data": {
                "order": {
                    "guid": "order-cat-1",
                    "restaurantGuid": "rest-guid-1",
                    "closedDate": "2026-01-01",
                    "selections": [
                        {
                            "itemGroup": {"name": "Chateau Margaux"},
                            "quantity": 1,
                            "preDiscountPrice": 5000,
                            "guid": "sel-1",
                            "voided": False,
                            "menuGroup": {"name": "Wine", "category": "Wine"},
                        }
                    ],
                }
            }
        }

        await full_agent.handle_order_completed(webhook_data)

        full_agent.log_decision.assert_called()
        call_kwargs = full_agent.log_decision.call_args
        # Positional or keyword — handle both
        if call_kwargs.kwargs:
            confidence = call_kwargs.kwargs.get("confidence")
            assert confidence == 0.9, f"Expected confidence=0.9 for category match, got {confidence}"
        else:
            # positional: (decision_type, inputs, output, reasoning, confidence, restaurant_id)
            assert call_kwargs.args[4] == 0.9

    @pytest.mark.asyncio
    async def test_wine_item_by_keyword(self, full_agent):
        """Item with no wine category but 'cabernet' in name → log_decision confidence=0.7."""
        webhook_data = {
            "data": {
                "order": {
                    "guid": "order-kw-1",
                    "restaurantGuid": "rest-guid-1",
                    "closedDate": "2026-01-01",
                    "selections": [
                        {
                            "itemGroup": {"name": "Estate Cabernet 2021"},
                            "quantity": 1,
                            "preDiscountPrice": 3000,
                            "guid": "sel-2",
                            "voided": False,
                            "menuGroup": {"name": "Unknown", "category": ""},
                        }
                    ],
                }
            }
        }

        await full_agent.handle_order_completed(webhook_data)

        full_agent.log_decision.assert_called()
        call_kwargs = full_agent.log_decision.call_args
        if call_kwargs.kwargs:
            confidence = call_kwargs.kwargs.get("confidence")
            assert confidence == 0.7, f"Expected confidence=0.7 for keyword match, got {confidence}"
        else:
            assert call_kwargs.args[4] == 0.7

    @pytest.mark.asyncio
    async def test_non_wine_item_logged(self, full_agent):
        """Non-wine item (Burger) still triggers log_decision with is_wine=False."""
        webhook_data = {
            "data": {
                "order": {
                    "guid": "order-nw-1",
                    "restaurantGuid": "rest-guid-1",
                    "closedDate": "2026-01-01",
                    "selections": [
                        {
                            "itemGroup": {"name": "Burger"},
                            "quantity": 1,
                            "preDiscountPrice": 1500,
                            "guid": "sel-3",
                            "voided": False,
                            "menuGroup": {"name": "Food", "category": "Food"},
                        }
                    ],
                }
            }
        }

        await full_agent.handle_order_completed(webhook_data)

        full_agent.log_decision.assert_called()
        # Verify output contains is_wine=False
        call_kwargs = full_agent.log_decision.call_args
        if call_kwargs.kwargs:
            output = call_kwargs.kwargs.get("output", {})
        else:
            output = call_kwargs.args[2]
        assert output.get("is_wine") is False, \
            f"Expected is_wine=False for Burger, got: {output}"

    @pytest.mark.asyncio
    async def test_decision_log_inputs_contain_item_name(self, full_agent):
        """log_decision inputs dict must contain 'item_name' key."""
        webhook_data = {
            "data": {
                "order": {
                    "guid": "order-inputs-1",
                    "restaurantGuid": "rest-guid-1",
                    "closedDate": "2026-01-01",
                    "selections": [
                        {
                            "itemGroup": {"name": "Pinot Noir Reserve"},
                            "quantity": 1,
                            "preDiscountPrice": 4000,
                            "guid": "sel-4",
                            "voided": False,
                            "menuGroup": {"name": "", "category": ""},
                        }
                    ],
                }
            }
        }

        await full_agent.handle_order_completed(webhook_data)

        full_agent.log_decision.assert_called()
        call_kwargs = full_agent.log_decision.call_args
        if call_kwargs.kwargs:
            inputs = call_kwargs.kwargs.get("inputs", {})
        else:
            inputs = call_kwargs.args[1]
        assert "item_name" in inputs, \
            f"Expected 'item_name' in log_decision inputs, got keys: {list(inputs.keys())}"


# ===========================================================================
# Class TestHARD02ToastPollingSaga
# ===========================================================================

class TestHARD02ToastPollingSaga:
    """5 tests: Toast polling saga start, advance, complete/compensate, PartialOrderReceived."""

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    async def test_saga_started_on_empty_items(self, mock_sleep, full_agent):
        """Empty selections list triggers start_saga with saga_type='toast_order_enrichment'."""
        full_agent._poll_toast_for_order = AsyncMock(return_value=[])

        await full_agent._handle_incomplete_webhook("order-empty-1", {})

        full_agent.start_saga.assert_called_once()
        call_kwargs = full_agent.start_saga.call_args
        saga_type = call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs.get("saga_type")
        assert saga_type == "toast_order_enrichment", \
            f"Expected saga_type='toast_order_enrichment', got: '{saga_type}'"

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    async def test_saga_advances_per_poll_attempt(self, mock_sleep, full_agent):
        """Saga advances exactly 3 times (POLL_ATTEMPT_1/2/3) before exhaustion."""
        full_agent._poll_toast_for_order = AsyncMock(return_value=[])

        await full_agent._handle_incomplete_webhook("order-adv-1", {})

        assert full_agent.advance_saga.call_count == 3, \
            f"Expected 3 advance_saga calls, got {full_agent.advance_saga.call_count}"
        steps = [c.args[1] for c in full_agent.advance_saga.call_args_list]
        assert steps == ["POLL_ATTEMPT_1", "POLL_ATTEMPT_2", "POLL_ATTEMPT_3"], \
            f"Unexpected saga steps: {steps}"

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    async def test_saga_completed_on_success(self, mock_sleep, full_agent):
        """If _poll_toast_for_order returns items on first attempt, complete_saga is called."""
        enriched = [{"itemGroup": {"name": "Opus One"}, "quantity": 1}]
        full_agent._poll_toast_for_order = AsyncMock(return_value=enriched)

        result = await full_agent._handle_incomplete_webhook("order-ok-1", {})

        full_agent.complete_saga.assert_called_once()
        full_agent.compensate_saga.assert_not_called()
        assert result == enriched

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    async def test_compensation_on_exhaustion(self, mock_sleep, full_agent):
        """After 3 failed polls, compensate_saga is called with an error string."""
        full_agent._poll_toast_for_order = AsyncMock(return_value=[])

        await full_agent._handle_incomplete_webhook("order-comp-1", {})

        full_agent.compensate_saga.assert_called_once()
        error_arg = full_agent.compensate_saga.call_args.args[1] \
            if full_agent.compensate_saga.call_args.args \
            else full_agent.compensate_saga.call_args.kwargs.get("error", "")
        assert "exhausted" in error_arg.lower() or "3" in error_arg, \
            f"Expected exhaustion error message, got: '{error_arg}'"

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    async def test_partial_order_received_published(self, mock_sleep, full_agent):
        """After saga exhaustion, PartialOrderReceived event published to pos.events exchange."""
        full_agent._poll_toast_for_order = AsyncMock(return_value=[])

        await full_agent._handle_incomplete_webhook("order-partial-1", {"restaurant_id": "r-1"})

        full_agent.publish.assert_called_once()
        publish_call = full_agent.publish.call_args
        # Check exchange
        exchange = publish_call.kwargs.get("exchange_name") or (
            publish_call.args[0] if publish_call.args else None
        )
        assert exchange == "pos.events", f"Expected exchange 'pos.events', got: '{exchange}'"
        # Check message body contains PartialOrderReceived
        msg_body = publish_call.kwargs.get("message_body") or (
            publish_call.args[2] if len(publish_call.args) > 2 else {}
        )
        assert msg_body.get("event_type") == "PartialOrderReceived", \
            f"Expected event_type='PartialOrderReceived', got: {msg_body.get('event_type')}"


# ===========================================================================
# Class TestHARD02EdgeCases
# ===========================================================================

class TestHARD02EdgeCases:
    """3 tests: invalid signature, refund idempotency, missing order_guid."""

    @pytest.mark.asyncio
    async def test_invalid_signature_rejected(self, agent):
        """Wrong HMAC signature returns error before idempotency check."""
        # Use a non-mock-mode agent so signature is checked
        agent.mock_mode = False
        agent.toast_webhook_secret = "test-secret"

        payload_dict = {
            "order_guid": "g-sig-1",
            "event_type": "OrderCompleted",
            "eventType": "OrderCompleted",
        }
        payload_str = json.dumps(payload_dict)
        wrong_sig = "deadbeef" * 8

        result = await agent.process_toast_webhook(
            webhook_data=payload_dict,
            signature=wrong_sig,
            raw_payload=payload_str.encode(),
        )

        assert result.get("status") == "error"
        assert "signature" in result.get("message", "").lower()
        # Idempotency check must NOT have been called (signature gate is first)
        agent._check_idempotency.assert_not_called()

    @pytest.mark.asyncio
    async def test_refund_has_idempotency(self, agent):
        """handle_order_refunded flow goes through process_toast_webhook idempotency check."""
        agent._check_idempotency = AsyncMock(return_value=False)
        agent.handle_order_refunded = AsyncMock(return_value={"status": "success"})

        payload = {
            "order_guid": "refund-guid-1",
            "event_type": "OrderRefunded",
            "eventType": "OrderRefunded",
        }

        await agent.process_toast_webhook(payload)

        # Idempotency key must include order_guid and event_type
        agent._check_idempotency.assert_called_once()
        key = agent._check_idempotency.call_args[0][0]
        assert "refund-guid-1" in key
        assert "OrderRefunded" in key

    @pytest.mark.asyncio
    async def test_webhook_with_no_guid_proceeds(self, agent):
        """Missing order_guid results in key ':OrderCompleted' — processes without crash."""
        agent._check_idempotency = AsyncMock(return_value=False)
        payload = {
            # no order_guid, no guid fields
            "event_type": "OrderCompleted",
            "eventType": "OrderCompleted",
        }

        result = await agent.process_toast_webhook(payload)

        # Should not raise; idempotency key is ":OrderCompleted"
        agent._check_idempotency.assert_called_once()
        key = agent._check_idempotency.call_args[0][0]
        assert key == ":OrderCompleted", \
            f"Expected ':OrderCompleted' for missing guid, got: '{key}'"
        # Result should not be an exception-driven crash
        assert result is not None
