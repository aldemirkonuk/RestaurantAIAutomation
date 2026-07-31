"""Tests for BUG-03, BUG-04, BUG-05, BUG-06 in POSIntegrationAgent."""

import hashlib
import hmac
import json
import inspect
import pytest
from unittest.mock import AsyncMock, MagicMock

from agents.pos_integration_agent import POSIntegrationAgent, WINE_WORDS


def _make_agent(config=None):
    """Build POSIntegrationAgent with minimal mocks."""
    agent = POSIntegrationAgent.__new__(POSIntegrationAgent)
    agent.agent_name = "test_pos"
    agent.logger = MagicMock()
    agent.metrics = MagicMock()
    agent.mock_mode = False
    agent.toast_webhook_secret = "test-secret-key"
    agent.toast_environment = "sandbox"
    # The production lists, not a local copy of them. A shorter stand-in list here
    # would let these tests pass against a detector the real agent does not run.
    agent.wine_category_keywords = list(WINE_WORDS)
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
        """Sparkling Water is not wine, whatever category it arrives under.

        'Beverages' is deliberately NOT a non-wine category (real POS menus file
        the wine list under it), so this falls through to the name scan — and the
        name scan holds no 'sparkling' token precisely so that water cannot read as
        sparkling wine.
        """
        agent = _make_agent()
        selection = {"menuGroup": {"category": "Beverages"}}
        assert agent.is_wine_item("Sparkling Water", selection=selection) is False

    def test_recognised_non_wine_category_stops_the_name_scan(self):
        """A positively non-wine family is a verdict, not a fall-through."""
        agent = _make_agent()
        for category in ("Beer & Cider", "Coffee", "Pasta", "Desserts"):
            selection = {"menuGroup": {"name": category}}
            assert (
                agent.is_wine_item("Barolo Braised Short Rib", selection=selection)
                is False
            ), category

    def test_unrecognised_category_does_not_veto_a_wine_name(self):
        """The undercount this reconciliation exists to fix.

        A category we have never seen used to be treated as authoritative, so a
        Chardonnay filed under 'Beverages' was recorded as food and every wine
        analytic downstream missed it. Silently.
        """
        agent = _make_agent()
        for category in ("Beverages", "Drinks", "Bar", "House Favourites"):
            selection = {"menuGroup": {"name": category}}
            assert (
                agent.is_wine_item("Estate Chardonnay 2021", selection=selection)
                is True
            ), category

    def test_category_read_from_menu_group_name_not_only_category(self):
        """Toast payloads in this repo populate menuGroup.name.

        Reading only menuGroup.category left the category signal dead against the
        payloads handle_order_completed actually receives, so every item fell
        through to the keyword scan.
        """
        agent = _make_agent()
        assert (
            agent.is_wine_item("Caymus", selection={"menuGroup": {"name": "Wine"}})
            is True
        )
        assert (
            agent.is_wine_item(
                "Caymus", selection={"menuGroup": {"name": "Wine by the Glass"}}
            )
            is True
        )

    def test_old_world_appellations_resolve_on_the_name_alone(self):
        """The measured gap: a grape list cannot reach appellation labelling."""
        for name in (
            "Edmondo Sarti Barbaresco",
            "Pace Arneis Roero",
            "Dettori Vermentino",
            "Moschioni Friulano",
            "Tenuta Orestiadi Nero d'Avola",
            "Billecart-Salmon Blanc de Blancs",
            "Gran Passaia Super Tuscan",
            "Domaine Lucien Crochet Sancerre",
            "Assyrtiko (Santorini)",
            "House White",
        ):
            assert _make_agent().is_wine_item(name) is True, name

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

        async def mock_publish(exchange, routing_key, message):
            published_events.append(message)

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

        async def mock_publish(exchange, routing_key, message):
            published_events.append(message)

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
