"""Tests for BUG-03, BUG-04, BUG-05, BUG-06 in POSIntegrationAgent."""

import hashlib
import hmac
import json
import inspect
import pytest
from unittest.mock import AsyncMock, MagicMock

from agents.pos_integration_agent import POSIntegrationAgent


def _make_agent(config=None):
    """Build POSIntegrationAgent with minimal mocks."""
    agent = POSIntegrationAgent.__new__(POSIntegrationAgent)
    agent.agent_name = "test_pos"
    agent.logger = MagicMock()
    agent.metrics = MagicMock()
    agent.mock_mode = False
    agent.toast_webhook_secret = "test-secret-key"
    agent.toast_environment = "sandbox"
    agent.wine_category_keywords = [
        "wine",
        "vino",
        "red wine",
        "white wine",
        "sparkling",
        "champagne",
        "cabernet",
        "chardonnay",
        "pinot",
        "merlot",
        "sauvignon",
        "riesling",
        "zinfandel",
        "syrah",
        "bordeaux",
        "burgundy",
        "prosecco",
        "cava",
        "rosé",
        "rose",
        "dessert wine",
    ]
    agent.wine_menu_categories = [
        "Wine",
        "Wines",
        "Wine List",
        "Bottle Wine",
        "Glass Wine",
        "Sparkling Wine",
        "Red Wine",
        "White Wine",
        "Rose Wine",
        "Dessert Wine",
    ]
    if config:
        for k, v in config.items():
            setattr(agent, k, v)
    return agent


# ---------------------------------------------------------------------------
# BUG-03: hmac.HMAC not hmac.new
# ---------------------------------------------------------------------------


class TestBUG03HmacAPI:
    def test_verify_webhook_signature_uses_hmac_HMAC(self):
        """verify_webhook_signature source must reference hmac.HMAC, not hmac.new."""
        source = inspect.getsource(POSIntegrationAgent.verify_webhook_signature)
        assert (
            "hmac.new(" not in source
        ), "BUG-03: deprecated hmac.new() still present — replace with hmac.HMAC()"
        assert (
            "hmac.HMAC(" in source
        ), "BUG-03: hmac.HMAC() constructor not found in verify_webhook_signature"

    def test_verify_webhook_signature_correct_result(self):
        agent = _make_agent()
        raw = "hello-toast-payload"
        expected = hmac.HMAC(
            agent.toast_webhook_secret.encode("utf-8"),
            raw.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        assert agent.verify_webhook_signature(raw, expected) is True

    def test_verify_webhook_signature_wrong_secret_returns_false(self):
        agent = _make_agent()
        raw = "hello-toast-payload"
        wrong_sig = "deadbeef" * 8
        assert agent.verify_webhook_signature(raw, wrong_sig) is False


# ---------------------------------------------------------------------------
# BUG-05: Signature must be verified against raw bytes, not re-serialized JSON
# ---------------------------------------------------------------------------


class TestBUG05SignatureRawBytes:
    @pytest.mark.asyncio
    async def test_raw_payload_used_for_verification(self):
        """process_toast_webhook must use raw_payload param, not json.dumps(webhook_data)."""
        agent = _make_agent()
        agent.message_bus = MagicMock()
        agent.database = MagicMock()

        # Craft a raw payload where json.dumps would produce different bytes
        # (e.g., Toast sends compact JSON, but json.dumps adds spaces)
        raw_payload_str = '{"eventType":"OrderCompleted","data":{"order":{"guid":"abc","restaurantGuid":"r1","closedDate":"2026-01-01","selections":[]}}}'
        webhook_data = json.loads(raw_payload_str)

        # Compute HMAC over raw bytes (as Toast would)
        valid_sig = hmac.HMAC(
            agent.toast_webhook_secret.encode("utf-8"),
            raw_payload_str.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        # json.dumps(webhook_data) will produce different bytes — if code re-serializes,
        # verification will fail and we get {"status": "error"}
        result = await agent.process_toast_webhook(
            webhook_data=webhook_data,
            signature=valid_sig,
            raw_payload=raw_payload_str.encode("utf-8"),
        )
        # Signature should verify correctly when raw_payload is provided
        assert (
            result.get("status") != "error"
            or result.get("message") != "Invalid signature"
        ), "BUG-05: signature verification failed because raw_payload was not used"


# ---------------------------------------------------------------------------
# BUG-04: Wine detection — category-first, keyword fallback
# ---------------------------------------------------------------------------


class TestBUG04WineDetection:
    def test_category_wine_list_no_keywords(self):
        """Item in 'Wine List' category but no wine keywords in name -> True."""
        agent = _make_agent()
        selection = {"menuGroup": {"category": "Wine List", "name": "Beverages"}}
        assert agent.is_wine_item("Caymus", selection=selection) is True

    def test_category_red_wine_branded_name(self):
        """'Opus One' has no keywords but category 'Red Wine' -> True."""
        agent = _make_agent()
        selection = {"menuGroup": {"category": "Red Wine"}}
        assert agent.is_wine_item("Opus One", selection=selection) is True

    def test_no_category_branded_name_returns_false(self):
        """'Caymus' with no category and no keywords -> False (cannot detect)."""
        agent = _make_agent()
        assert agent.is_wine_item("Caymus", selection=None) is False

    def test_non_wine_category_returns_false(self):
        """Item in 'Beverages' category -> False even if it had wine-adjacent words."""
        agent = _make_agent()
        selection = {"menuGroup": {"category": "Beverages"}}
        assert agent.is_wine_item("Sparkling Water", selection=selection) is False

    def test_keyword_fallback_for_uncategorized(self):
        """No category on selection, but 'chardonnay' in name -> keyword fallback True."""
        agent = _make_agent()
        selection = {"menuGroup": {"category": ""}}
        assert agent.is_wine_item("Estate Chardonnay 2021", selection=selection) is True

    def test_backward_compat_no_selection_arg(self):
        """Calling is_wine_item with just name string still works (keyword path)."""
        agent = _make_agent()
        assert agent.is_wine_item("Pinot Noir Reserve") is True
        assert agent.is_wine_item("Cheese Board") is False


# ---------------------------------------------------------------------------
# BUG-06: Refund logic separated from void logic
# ---------------------------------------------------------------------------


class TestBUG06RefundLogic:
    @pytest.mark.asyncio
    async def test_refund_publishes_POSSaleRefunded_not_voided(self):
        """handle_order_refunded must publish POSSaleRefunded event type."""
        agent = _make_agent()

        published_events = []

        # Parameter names match MessageBus.publish(exchange_name, routing_key,
        # message_body). They are not cosmetic: the agent calls publish() with
        # keyword arguments, so a stale name here makes the call raise instead of
        # recording, and the test fails as "0 events published" rather than as a
        # signature mismatch — which is why this looked like a refund bug.
        async def mock_publish(exchange_name, routing_key, message_body, **kwargs):
            published_events.append(message_body)

        agent.message_bus = MagicMock()
        agent.message_bus.publish = mock_publish
        agent.database = MagicMock()
        agent.get_restaurant_id = AsyncMock(return_value="rest-1")
        agent.match_wine_to_library = AsyncMock(return_value="wine-1")
        agent.log_webhook_event = AsyncMock()

        webhook_data = {
            "eventType": "OrderRefunded",
            "data": {
                "restaurantGuid": "toast-rest-1",
                "orderGuid": "order-abc",
                "refund": {
                    "amount": 4500,
                    "reason": "customer_request",
                    "items": [
                        {"guid": "sel-1", "name": "Caymus Cabernet", "quantity": 1}
                    ],
                },
            },
        }

        await agent.handle_order_refunded(webhook_data)

        assert len(published_events) >= 1, "Expected at least one published event"
        event_types = [e.get("event_type") for e in published_events]
        assert (
            "POSSaleRefunded" in event_types
        ), f"BUG-06: expected POSSaleRefunded, got {event_types}"
        assert (
            "POSSaleVoided" not in event_types
        ), "BUG-06: refund must not publish POSSaleVoided"

    @pytest.mark.asyncio
    async def test_refund_event_contains_amount_and_reason(self):
        """Refund event payload must include refund_amount_dollars and reason."""
        agent = _make_agent()
        published_events = []

        # Parameter names match MessageBus.publish(exchange_name, routing_key,
        # message_body). They are not cosmetic: the agent calls publish() with
        # keyword arguments, so a stale name here makes the call raise instead of
        # recording, and the test fails as "0 events published" rather than as a
        # signature mismatch — which is why this looked like a refund bug.
        async def mock_publish(exchange_name, routing_key, message_body, **kwargs):
            published_events.append(message_body)

        agent.message_bus = MagicMock()
        agent.message_bus.publish = mock_publish
        agent.database = MagicMock()
        agent.get_restaurant_id = AsyncMock(return_value="rest-1")
        agent.match_wine_to_library = AsyncMock(return_value=None)
        agent.log_webhook_event = AsyncMock()

        webhook_data = {
            "eventType": "OrderRefunded",
            "data": {
                "restaurantGuid": "toast-rest-1",
                "orderGuid": "order-abc",
                "refund": {
                    "amount": 9000,
                    "reason": "quality_issue",
                    "items": [
                        {
                            "guid": "sel-2",
                            "name": "Opus One",
                            "quantity": 2,
                            "menuGroup": {"category": "Red Wine"},
                        }
                    ],
                },
            },
        }

        await agent.handle_order_refunded(webhook_data)
        refund_events = [
            e for e in published_events if e.get("event_type") == "POSSaleRefunded"
        ]
        assert refund_events, "No POSSaleRefunded event published"
        payload = refund_events[0]["payload"]
        assert (
            payload.get("refund_amount_dollars") == 90.0
        ), f"Expected refund_amount_dollars=90.0, got {payload.get('refund_amount_dollars')}"
        assert payload.get("reason") == "quality_issue"

    @pytest.mark.asyncio
    async def test_refund_does_not_call_handle_item_voided(self):
        """handle_order_refunded must not delegate to handle_item_voided."""
        agent = _make_agent()
        agent.handle_item_voided = AsyncMock()
        agent.message_bus = MagicMock()
        agent.message_bus.publish = AsyncMock()
        agent.database = MagicMock()
        agent.get_restaurant_id = AsyncMock(return_value="rest-1")
        agent.match_wine_to_library = AsyncMock(return_value=None)
        agent.log_webhook_event = AsyncMock()

        webhook_data = {
            "eventType": "OrderRefunded",
            "data": {
                "restaurantGuid": "r",
                "orderGuid": "o",
                "refund": {"amount": 1000, "reason": "x", "items": []},
            },
        }
        await agent.handle_order_refunded(webhook_data)
        agent.handle_item_voided.assert_not_called()
