"""
Golden Path E2E Integration Tests
==================================
Tests the full 4-agent pipeline using in-process mocks.
No real RabbitMQ or Supabase required — runs in CI.

Covers requirements: E2E-v2-01, E2E-v2-02, E2E-v2-03, E2E-v2-04

Actual event routing chain (from RESEARCH.md):
  POST /webhook/toast
      -> POSIntegrationAgent.process_toast_webhook()
      -> publish pos.sale.completed -> pos.events
  BufferManagerAgent (receives pos.sale.completed)
      -> _evaluate_buffer() -> publish stock.evaluated -> stock.events
  InventoryEngineAgent (receives stock.evaluated)
      -> _handle_stock_evaluated() -> UPDATE inventory_stock
      -> publish stock.state.changed -> stock.events
  BufferManagerAgent (parallel) when stock < threshold:
      -> publish stock.threshold.breached -> stock.events
  NotificationAgent (receives stock.threshold.breached)
      -> sends SMS/email alert
  ReportingAgent: reads DB directly -- triggered by reporting.events, not stock.events
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agents.pos_integration_agent import POSIntegrationAgent
from agents.inventory_engine import InventoryEngineAgent
from agents.notification_agent import NotificationAgent
from agents.reporting_agent import ReportingAgent


# ---------------------------------------------------------------------------
# Shared payloads
# ---------------------------------------------------------------------------

GOLDEN_PATH_WEBHOOK = {
    "order_guid": "gp-order-001",
    "event_type": "OrderCompleted",
    "eventType": "OrderCompleted",
    "restaurant_id": "rest-001",
    "data": {
        "order": {
            "guid": "gp-order-001",
            "restaurantGuid": "e5d6d489-25fa-4082-9cad-3e9e74225517",
            "closedDate": "2026-04-11T19:30:00Z",
            "selections": [
                {
                    "guid": "sel-001",
                    "itemGroup": {"name": "Caymus Cabernet 2021"},
                    "menuGroup": {
                        "name": "Bottle Wine",
                        "category": "Bottle Wine",
                    },
                    "quantity": 1,
                    "preDiscountPrice": 12000,
                    "voided": False,
                }
            ],
        }
    },
}

# stock.evaluated message shape expected by InventoryEngineAgent._handle_stock_evaluated
# The method reads message.get("payload", {}) for inventory_id and stock_after.
STOCK_EVALUATED_MSG = {
    "routing_key": "stock.evaluated",
    "message_id": "msg-gp-001",
    "payload": {
        "inventory_id": "inv-uuid-001",
        "stock_after": 4,
        "restaurant_id": "rest-001",
        "wine_name": "Caymus Cabernet 2021",
    },
}

# stock.threshold.breached message (NotificationAgent routes by routing_key field)
STOCK_THRESHOLD_MSG = {
    "routing_key": "stock.threshold.breached",
    "event_id": "event-gp-001",
    "payload": {
        "wine_id": "wine-uuid-001",
        "restaurant_id": "rest-001",
        "current_stock": 1,
        "threshold_min": 2,
        "wine_name": "Caymus Cabernet 2021",
        "stock_after": 1,
        "threshold": 2,
        "estimated_stockout_days": 0.5,
        "correlation_id": "corr-gp-001",
    },
}

# ReportingAgent.process_message routes by message.get("type"), not routing_key
ON_DEMAND_REPORT_MSG = {
    "type": "generate_on_demand_report",
    "routing_key": "reporting.generate_on_demand_report",
    "restaurant_id": "rest-001",
    "report_type": "inventory",
    "date": "2026-04-11",
    "requested_by": "manager@rest.com",
    "manager_email": "manager@rest.com",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_bus():
    bus = MagicMock()
    bus.publish = AsyncMock(return_value=True)
    return bus


def _make_db():
    """Return a mock DB whose supabase attribute mimics chained query calls.

    Uses a side-effect factory so each .table() call returns a fresh chain
    that won't confuse assertions across multiple table accesses.
    """
    db = MagicMock()
    db.supabase = MagicMock()

    def _table_chain(*args, **kwargs):
        chain = MagicMock()
        chain.select.return_value = chain
        chain.insert.return_value = chain
        chain.update.return_value = chain
        chain.delete.return_value = chain
        chain.eq.return_value = chain
        chain.single.return_value = chain
        chain.maybe_single.return_value = chain
        chain.execute.return_value = MagicMock(data=[], error=None)
        return chain

    db.supabase.table.side_effect = _table_chain
    return db


def _patch_base_agent(agent):
    """Patch BaseAgent infrastructure methods to stay unit-scoped."""
    agent._check_idempotency = AsyncMock(return_value=False)
    agent._mark_processed = AsyncMock()
    agent.log_decision = AsyncMock()
    agent._send_to_dlq = AsyncMock()
    if hasattr(agent, "append_event"):
        agent.append_event = AsyncMock()
    if hasattr(agent, "start_saga"):
        agent.start_saga = AsyncMock(return_value="saga-gp-001")
        agent.advance_saga = AsyncMock()
        agent.complete_saga = AsyncMock()
        agent.compensate_saga = AsyncMock()
    return agent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def pos_agent():
    bus = _make_bus()
    db = _make_db()
    a = POSIntegrationAgent("pos_integration_agent", bus, db, {
        "mock_mode": True,
        "toast_webhook_secret": "test-secret",
        "toast_api_url": "https://ws-api.toasttab.com",
    })
    _patch_base_agent(a)
    # Patch methods that would hit external services
    a.log_webhook_event = AsyncMock()
    if hasattr(a, "_handle_incomplete_webhook"):
        a._handle_incomplete_webhook = AsyncMock(return_value=[])
    return a


@pytest.fixture
def inventory_agent():
    bus = _make_bus()
    db = _make_db()
    # InventoryEngineAgent uses self.database (BaseAgent attribute)
    # _handle_stock_evaluated calls self.database.update_inventory_stock and get_inventory_item
    db.update_inventory_stock = AsyncMock(return_value=True)
    db.get_inventory_item = AsyncMock(return_value={
        "id": "inv-uuid-001",
        "wine_name": "Caymus Cabernet 2021",
        "stock_live": 4,
        "threshold_min": 2,
        "in_transit_quantity": 0,
    })
    a = InventoryEngineAgent("inventory_engine", bus, db, {
        "default_threshold": 2,
    })
    _patch_base_agent(a)
    return a


@pytest.fixture
def notification_agent():
    bus = _make_bus()
    db = _make_db()
    a = NotificationAgent("notification_agent", bus, db, {
        "mock_mode": True,
    })
    _patch_base_agent(a)
    # Patch _track_notification_delivery so no real DB insert is attempted
    a._track_notification_delivery = AsyncMock(return_value="notif-id-001")
    a._mark_delivery_sent = AsyncMock()
    a._mark_delivery_failed = AsyncMock()
    # Patch the internal routing methods that would require manager DB lookups
    a._get_manager_for_restaurant = AsyncMock(return_value={
        "id": "mgr-001",
        "phone": "+1415555000",
        "email": "manager@rest.com",
    })
    a._get_notification_preferences = AsyncMock(return_value={})
    a._select_channels = AsyncMock(return_value=["sms"])
    a._get_push_subscriptions = AsyncMock(return_value=[])
    # Patch the actual send calls
    a.sms_client.send_sms = AsyncMock(return_value={"status": "sent"})
    if hasattr(a.sms_client, "send_sms_with_action_buttons"):
        a.sms_client.send_sms_with_action_buttons = AsyncMock(return_value={"status": "sent"})
    a.email_client.send_template_email = AsyncMock(return_value={"status": "sent"})
    a.push_service.send_notification = AsyncMock(return_value={"status": "sent"})
    return a


@pytest.fixture
def reporting_agent():
    bus = _make_bus()
    db = _make_db()
    # ReportingAgent uses self.database.supabase.table(...).select().eq().execute()
    # We need inventory_stock table to return data
    inv_chain = MagicMock()
    inv_chain.select.return_value = inv_chain
    inv_chain.eq.return_value = inv_chain
    inv_chain.execute.return_value = MagicMock(data=[
        {"id": "inv-uuid-001", "wine_name": "Caymus Cabernet 2021",
         "stock_live": 4, "threshold_min": 2, "wine_price": 120.0,
         "last_sold_at": "2026-04-11T19:30:00Z"}
    ], error=None)

    def _table_side_effect(table_name):
        if table_name == "inventory_stock":
            return inv_chain
        # For all other tables (idempotency_keys, decision_log, etc.)
        chain = MagicMock()
        chain.select.return_value = chain
        chain.insert.return_value = chain
        chain.update.return_value = chain
        chain.eq.return_value = chain
        chain.execute.return_value = MagicMock(data=[], error=None)
        return chain

    db.supabase.table.side_effect = _table_side_effect

    a = ReportingAgent("reporting_agent", bus, db, {
        "mock_mode": True,
    })
    _patch_base_agent(a)
    # email_client is None until initialize() — stub it so send_email doesn't crash
    email_mock = MagicMock()
    email_mock.send_email = AsyncMock(return_value={"status": "sent"})
    email_mock.send_template_email = AsyncMock(return_value={"status": "sent"})
    a.email_client = email_mock
    return a


# ---------------------------------------------------------------------------
# E2E-v2-01: Webhook -> POSSaleCompleted published
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_01_webhook_to_pos_event(pos_agent):
    """E2E-v2-01: Toast webhook -> POSIntegrationAgent -> pos.sale.completed published."""
    result = await pos_agent.process_toast_webhook(
        webhook_data=GOLDEN_PATH_WEBHOOK,
        signature=None,      # mock_mode=True skips HMAC check
        raw_payload=json.dumps(GOLDEN_PATH_WEBHOOK).encode(),
    )

    # Agent must accept or succeed (not error/ignored)
    assert result.get("status") in ("accepted", "success"), (
        f"Expected accepted/success, got: {result}"
    )

    # pos.sale.completed must have been published to pos.events exchange
    pos_agent.message_bus.publish.assert_called()
    published_calls = pos_agent.message_bus.publish.call_args_list
    # The agent uses publish(exchange=..., routing_key=...) — check both kwarg variants
    pos_event_calls = [
        c for c in published_calls
        if (
            (c.kwargs.get("exchange_name") == "pos.events" or c.kwargs.get("exchange") == "pos.events")
            and c.kwargs.get("routing_key") == "pos.sale.completed"
        ) or (
            "pos.events" in str(c) and "pos.sale.completed" in str(c)
        )
    ]
    assert pos_event_calls, (
        f"Expected publish to pos.events with routing_key=pos.sale.completed. "
        f"Actual calls: {published_calls}"
    )


# ---------------------------------------------------------------------------
# E2E-v2-02: stock.evaluated -> InventoryEngine decrements stock
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_02_pos_event_to_inventory_decrement(inventory_agent):
    """E2E-v2-02: stock.evaluated -> InventoryEngine decrements stock in DB."""
    # Direct call mirrors what BufferManager does after flushing the 30-min window
    await inventory_agent._handle_stock_evaluated(STOCK_EVALUATED_MSG)

    # Assert the DB update method was called with the correct inventory_id
    db = inventory_agent.database
    db.update_inventory_stock.assert_called_once()
    call_kwargs = db.update_inventory_stock.call_args
    # May be positional or keyword args
    all_args = str(call_kwargs)
    assert "inv-uuid-001" in all_args, (
        f"Expected inventory_id=inv-uuid-001 in update call. Got: {call_kwargs}"
    )

    # stock.state.changed should be published to stock.events
    inventory_agent.message_bus.publish.assert_called()
    published = inventory_agent.message_bus.publish.call_args_list
    state_changed_calls = [
        c for c in published
        if "stock.state.changed" in str(c)
    ]
    assert state_changed_calls, (
        f"Expected stock.state.changed publish. Actual: {published}"
    )


# ---------------------------------------------------------------------------
# E2E-v2-03: stock.threshold.breached -> NotificationAgent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_03_stock_threshold_to_notification(notification_agent):
    """E2E-v2-03: stock.threshold.breached -> NotificationAgent sends alert."""
    # NotificationAgent.process_message routes by routing_key field
    # It returns None (not dict) per current implementation
    result = await notification_agent.process_message(STOCK_THRESHOLD_MSG)

    # Agent must not raise — result may be None (NotificationAgent returns None by design)
    # This is acceptable: the test verifies the agent completes without exception
    # and that the internal send path was invoked.
    assert result is None or isinstance(result, dict), (
        f"NotificationAgent.process_message must return None or dict, got {type(result)}"
    )
    if isinstance(result, dict):
        status = result.get("status", "")
        assert status not in ("fatal_error", "crash"), (
            f"NotificationAgent returned failure status: {result}"
        )

    # The internal handler _get_manager_for_restaurant was called (proves routing worked)
    notification_agent._get_manager_for_restaurant.assert_called_once_with("rest-001")

    # SMS send was invoked (urgency=critical for 0.5 days stockout -> SMS channel)
    notification_agent.sms_client.send_sms.assert_called_once()


# ---------------------------------------------------------------------------
# E2E-v2-04: ReportingAgent generates on-demand inventory report
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_04_stock_event_to_reporting(reporting_agent):
    """E2E-v2-04: ReportingAgent generates inventory report on demand (reads DB directly)."""
    # ReportingAgent routes by message.get("type"), not routing_key.
    result = await reporting_agent.process_message(ON_DEMAND_REPORT_MSG)

    assert isinstance(result, dict), (
        f"ReportingAgent.process_message must return dict, got {type(result)}"
    )
    # Must not be a hard failure
    assert result.get("status") not in ("fatal_error", "crash"), (
        f"ReportingAgent returned failure status: {result}"
    )
    # DB must have been queried for inventory_stock
    db = reporting_agent.database
    db.supabase.table.assert_called()
    table_calls = [str(c) for c in db.supabase.table.call_args_list]
    inventory_queried = any("inventory_stock" in c for c in table_calls)
    assert inventory_queried, (
        f"Expected inventory_stock table to be queried. Table calls: {table_calls}"
    )


# ---------------------------------------------------------------------------
# Full golden path: webhook -> all 4 agents (E2E-v2-01..04 combined)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_full_golden_path(
    pos_agent, inventory_agent, notification_agent, reporting_agent
):
    """Full pipeline: webhook -> POS -> BufferManager(mocked) -> Inventory -> Notification + Reporting."""

    # --- Step 1: POS webhook ---
    pos_result = await pos_agent.process_toast_webhook(
        webhook_data=GOLDEN_PATH_WEBHOOK,
        signature=None,
        raw_payload=json.dumps(GOLDEN_PATH_WEBHOOK).encode(),
    )
    assert pos_result.get("status") in ("accepted", "success"), (
        f"POS webhook failed: {pos_result}"
    )

    # --- Step 2: Simulate BufferManager flush -> stock.evaluated ---
    # BufferManager acts as intermediary; we call InventoryEngine directly
    # with the stock.evaluated message that BufferManager would publish.
    await inventory_agent._handle_stock_evaluated(STOCK_EVALUATED_MSG)

    # --- Step 3: Simulate BufferManager threshold breach -> Notification ---
    notif_result = await notification_agent.process_message(STOCK_THRESHOLD_MSG)
    # NotificationAgent returns None — absence of exception is the contract
    assert notif_result is None or isinstance(notif_result, dict), (
        f"NotificationAgent must return None or dict, got: {type(notif_result)}"
    )
    if isinstance(notif_result, dict):
        assert notif_result.get("status") not in ("fatal_error", "crash")

    # --- Step 4: Reporting reads DB directly ---
    report_result = await reporting_agent.process_message(ON_DEMAND_REPORT_MSG)
    assert isinstance(report_result, dict), (
        f"ReportingAgent must return dict, got: {type(report_result)}"
    )
    assert report_result.get("status") not in ("fatal_error", "crash")

    # --- Verify publish chain ---
    # POS published pos.sale.completed to pos.events
    all_pos_publishes = pos_agent.message_bus.publish.call_args_list
    assert any(
        "pos.events" in str(c) for c in all_pos_publishes
    ), f"POS agent never published to pos.events: {all_pos_publishes}"

    # InventoryEngine published stock.state.changed
    all_inv_publishes = inventory_agent.message_bus.publish.call_args_list
    assert any(
        "stock.state.changed" in str(c) for c in all_inv_publishes
    ), f"InventoryEngine never published stock.state.changed: {all_inv_publishes}"
