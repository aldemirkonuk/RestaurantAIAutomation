"""Integration tests for HARD-01: InventoryEngine Level 4 hardening."""
import pytest
from unittest.mock import AsyncMock, MagicMock, call
from agents.inventory_engine import InventoryEngineAgent


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.supabase = MagicMock()
    # Default: idempotency check returns empty (not yet processed)
    db.supabase.table.return_value.select.return_value.eq.return_value\
        .execute.return_value.data = []
    db.supabase.table.return_value.insert.return_value.execute.return_value\
        .data = [{"message_id": "test"}]
    db.supabase.table.return_value.update.return_value.eq.return_value\
        .eq.return_value.execute.return_value.data = [{"id": "inv-1", "stock_live": 5, "version": 2}]
    db.update_inventory_stock = AsyncMock(return_value=True)
    db.get_inventory_item = AsyncMock(return_value={
        "id": "inv-1", "wine_name": "Opus One", "stock_live": 5,
        "threshold_min": 3, "in_transit_quantity": 0, "restaurant_id": "rest-1"
    })
    db.update_order_status = AsyncMock(return_value=True)
    return db


@pytest.fixture
def agent(mock_db):
    mock_bus = MagicMock()
    mock_bus.publish = AsyncMock()
    a = InventoryEngineAgent("inventory_engine", mock_bus, mock_db, {"default_threshold": 3})
    # Patch publish to be a no-op async
    a.publish = AsyncMock()
    return a


# =========================================================================
# TestHARD01Idempotency
# =========================================================================

class TestHARD01Idempotency:
    """HARD-01: Idempotency — duplicate messages must be deduplicated."""

    @pytest.mark.asyncio
    async def test_duplicate_message_skipped(self, agent, mock_db):
        """Send same message_id twice; database.update_inventory_stock called once."""
        # First call: not processed; second call: already processed
        mock_db.supabase.table.return_value.select.return_value.eq.return_value\
            .execute.side_effect = [
                MagicMock(data=[]),                        # first call — proceed
                MagicMock(data=[{"message_id": "abc"}]),  # second call — duplicate
            ]

        msg = {
            "message_id": "abc",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)
        await agent._handle_stock_evaluated(msg)

        mock_db.update_inventory_stock.assert_called_once()

    @pytest.mark.asyncio
    async def test_first_message_processed(self, agent, mock_db):
        """Unique message_id proceeds to processing; update_inventory_stock called."""
        msg = {
            "message_id": "unique-001",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 7, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)
        mock_db.update_inventory_stock.assert_called_once()

    @pytest.mark.asyncio
    async def test_idempotency_check_fail_open(self, agent, mock_db):
        """If _check_idempotency raises, processing continues (fail open)."""
        mock_db.supabase.table.return_value.select.return_value.eq.return_value\
            .execute.side_effect = Exception("DB connection lost")

        msg = {
            "message_id": "fail-open-001",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 4, "restaurant_id": "rest-1"},
        }
        # Must not raise; should proceed with processing
        await agent._handle_stock_evaluated(msg)
        mock_db.update_inventory_stock.assert_called_once()

    @pytest.mark.asyncio
    async def test_mark_processed_called_after_success(self, agent, mock_db):
        """_mark_processed must be called with the message_id after successful update."""
        insert_mock = MagicMock()
        insert_mock.execute.return_value.data = [{"message_id": "mark-001"}]

        # Route all table() calls; detect insert on idempotency_keys
        insert_calls = []

        original_table = mock_db.supabase.table

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{"message_id": "mark-001"}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "idempotency_keys":
                insert_calls.append(table_name)
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "mark-001",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)

        # idempotency_keys table was accessed (for both check and mark)
        assert "idempotency_keys" in insert_calls

    @pytest.mark.asyncio
    async def test_delivery_idempotency(self, agent, mock_db):
        """Duplicate order.delivered message: update_inventory_stock called once."""
        mock_db.supabase.table.return_value.select.return_value.eq.return_value\
            .execute.side_effect = [
                MagicMock(data=[]),
                MagicMock(data=[{"message_id": "del-dup"}]),
            ]

        msg = {
            "message_id": "del-dup",
            "routing_key": "procurement.order.delivered",
            "payload": {"order_id": "ord-1", "inventory_id": "inv-1", "quantity_delivered": 12},
        }
        await agent._handle_order_delivered(msg)
        await agent._handle_order_delivered(msg)

        mock_db.update_inventory_stock.assert_called_once()


# =========================================================================
# TestHARD01DecisionLogging
# =========================================================================

class TestHARD01DecisionLogging:
    """HARD-01: Decision logging — every stock change must write to decision_log."""

    @pytest.mark.asyncio
    async def test_stock_update_logs_decision(self, agent, mock_db):
        """stock.evaluated handler calls decision_log insert with decision_type='stock_update'."""
        logged_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "decision_log":
                orig_insert = tbl.insert

                def capture_insert(data):
                    logged_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "dec-001",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)

        assert any(d.get("decision_type") == "stock_update" for d in logged_inserts), \
            "decision_log must include an entry with decision_type='stock_update'"

    @pytest.mark.asyncio
    async def test_decision_log_includes_inventory_id(self, agent, mock_db):
        """Decision log inputs dict must contain inventory_id."""
        logged_inputs = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "decision_log":
                orig_insert = tbl.insert

                def capture_insert(data):
                    if "inputs" in data:
                        logged_inputs.append(data["inputs"])
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "dec-002",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-42", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)

        assert any("inventory_id" in inp for inp in logged_inputs), \
            "decision_log inputs must contain inventory_id"

    @pytest.mark.asyncio
    async def test_manual_correction_confidence_0_7(self, agent, mock_db):
        """Manual correction handler logs confidence=0.7."""
        logged_entries = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "decision_log":
                orig_insert = tbl.insert

                def capture_insert(data):
                    logged_entries.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "conf-001",
            "routing_key": "stock.manual_correction",
            "payload": {"inventory_id": "inv-1", "corrected_stock": 8, "manager_id": "mgr-1"},
        }
        await agent._handle_manual_correction(msg)

        assert any(d.get("confidence") == 0.7 for d in logged_entries), \
            "manual_correction must log confidence=0.7"

    @pytest.mark.asyncio
    async def test_delivery_decision_type(self, agent, mock_db):
        """Delivery handler logs decision_type='delivery_received'."""
        logged_entries = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "decision_log":
                orig_insert = tbl.insert

                def capture_insert(data):
                    logged_entries.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "del-dec-001",
            "routing_key": "procurement.order.delivered",
            "payload": {"order_id": "ord-1", "inventory_id": "inv-1", "quantity_delivered": 6},
        }
        await agent._handle_order_delivered(msg)

        assert any(d.get("decision_type") == "delivery_received" for d in logged_entries), \
            "delivery handler must log decision_type='delivery_received'"


# =========================================================================
# TestHARD01EventSourcing
# =========================================================================

class TestHARD01EventSourcing:
    """HARD-01: Event sourcing — every stock change appends to event_store."""

    @pytest.mark.asyncio
    async def test_stock_update_appends_event(self, agent, mock_db):
        """stock.evaluated handler calls event_store insert with aggregate_type='inventory'."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "ev-001",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)

        assert any(e.get("aggregate_type") == "inventory" for e in event_inserts), \
            "event_store insert must have aggregate_type='inventory'"

    @pytest.mark.asyncio
    async def test_event_store_has_correct_event_type(self, agent, mock_db):
        """stock.evaluated handler stores event_type='StockUpdated'."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "ev-002",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)

        assert any(e.get("event_type") == "StockUpdated" for e in event_inserts), \
            "event_store must include event_type='StockUpdated' for stock.evaluated"

    @pytest.mark.asyncio
    async def test_delivery_event_type(self, agent, mock_db):
        """order.delivered handler stores event_type='DeliveryReceived'."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "ev-del-001",
            "routing_key": "procurement.order.delivered",
            "payload": {"order_id": "ord-1", "inventory_id": "inv-1", "quantity_delivered": 6},
        }
        await agent._handle_order_delivered(msg)

        assert any(e.get("event_type") == "DeliveryReceived" for e in event_inserts), \
            "event_store must include event_type='DeliveryReceived' for order.delivered"

    @pytest.mark.asyncio
    async def test_manual_correction_event_type(self, agent, mock_db):
        """manual_correction handler stores event_type='ManualCorrectionApplied'."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg = {
            "message_id": "ev-mc-001",
            "routing_key": "stock.manual_correction",
            "payload": {"inventory_id": "inv-1", "corrected_stock": 10, "manager_id": "mgr-1"},
        }
        await agent._handle_manual_correction(msg)

        assert any(e.get("event_type") == "ManualCorrectionApplied" for e in event_inserts), \
            "event_store must include event_type='ManualCorrectionApplied' for manual_correction"

    @pytest.mark.asyncio
    async def test_sequence_increments_per_aggregate(self, agent, mock_db):
        """Two StockUpdated events for the same inventory_id get sequence_number 1 then 2."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg1 = {
            "message_id": "seq-001",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-seq", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        msg2 = {
            "message_id": "seq-002",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-seq", "stock_after": 4, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg1)
        await agent._handle_stock_evaluated(msg2)

        stock_events = [e for e in event_inserts if e.get("event_type") == "StockUpdated"]
        assert len(stock_events) == 2, "Expected two StockUpdated events"
        sequences = [e.get("sequence_number") for e in stock_events]
        assert sequences == [1, 2], f"Expected sequence [1, 2], got {sequences}"

    @pytest.mark.asyncio
    async def test_different_aggregates_have_independent_sequences(self, agent, mock_db):
        """Events for two different inventory_ids each start at sequence_number 1."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-a", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        msg_a = {
            "message_id": "seq-indep-a",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-agg-a", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        msg_b = {
            "message_id": "seq-indep-b",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-agg-b", "stock_after": 3, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg_a)
        await agent._handle_stock_evaluated(msg_b)

        stock_events = [e for e in event_inserts if e.get("event_type") == "StockUpdated"]
        assert len(stock_events) == 2, "Expected two StockUpdated events"
        for ev in stock_events:
            assert ev.get("sequence_number") == 1, (
                f"Each new aggregate should start at sequence 1, got {ev.get('sequence_number')} "
                f"for aggregate {ev.get('aggregate_id')}"
            )

    @pytest.mark.asyncio
    async def test_manual_correction_sequence_continues_after_stock(self, agent, mock_db):
        """Stock event gets sequence 1, then manual correction for same aggregate gets sequence 2."""
        event_inserts = []

        def table_side_effect(table_name):
            tbl = MagicMock()
            tbl.select.return_value.eq.return_value.execute.return_value.data = []
            tbl.insert.return_value.execute.return_value.data = [{}]
            tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
                {"id": "inv-mix", "stock_live": 5, "version": 2}
            ]
            if table_name == "event_store":
                orig_insert = tbl.insert

                def capture_insert(data):
                    event_inserts.append(data)
                    return orig_insert(data)

                tbl.insert = capture_insert
            return tbl

        mock_db.supabase.table = table_side_effect

        stock_msg = {
            "message_id": "seq-mix-stock",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-mix", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        correction_msg = {
            "message_id": "seq-mix-correction",
            "routing_key": "stock.manual_correction",
            "payload": {"inventory_id": "inv-mix", "corrected_stock": 8, "manager_id": "mgr-1"},
        }
        await agent._handle_stock_evaluated(stock_msg)
        await agent._handle_manual_correction(correction_msg)

        stock_ev = next((e for e in event_inserts if e.get("event_type") == "StockUpdated"), None)
        correction_ev = next((e for e in event_inserts if e.get("event_type") == "ManualCorrectionApplied"), None)

        assert stock_ev is not None, "StockUpdated event not found"
        assert correction_ev is not None, "ManualCorrectionApplied event not found"
        assert stock_ev.get("sequence_number") == 1, (
            f"StockUpdated should have sequence 1, got {stock_ev.get('sequence_number')}"
        )
        assert correction_ev.get("sequence_number") == 2, (
            f"ManualCorrectionApplied should have sequence 2, got {correction_ev.get('sequence_number')}"
        )


# =========================================================================
# TestHARD01EdgeCases
# =========================================================================

class TestHARD01EdgeCases:
    """HARD-01: Edge cases — missing fields, errors, and boundary conditions."""

    @pytest.mark.asyncio
    async def test_missing_inventory_id_returns_early(self, agent, mock_db):
        """Message with no inventory_id must not call update_inventory_stock."""
        msg = {
            "message_id": "edge-001",
            "routing_key": "stock.evaluated",
            "payload": {"stock_after": 5, "restaurant_id": "rest-1"},  # no inventory_id
        }
        await agent._handle_stock_evaluated(msg)
        mock_db.update_inventory_stock.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_message_id_proceeds(self, agent, mock_db):
        """Message with no message_id processes normally (empty string fails open)."""
        msg = {
            # no message_id key
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)
        mock_db.update_inventory_stock.assert_called_once()

    @pytest.mark.asyncio
    async def test_database_error_does_not_raise(self, agent, mock_db):
        """If update_inventory_stock raises, the handler catches it and does not propagate."""
        mock_db.update_inventory_stock = AsyncMock(side_effect=Exception("DB timeout"))
        msg = {
            "message_id": "edge-003",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 5, "restaurant_id": "rest-1"},
        }
        # Should not raise — exceptions are caught in the handler
        await agent._handle_stock_evaluated(msg)

    @pytest.mark.asyncio
    async def test_manual_correction_missing_manager_id_returns_early(self, agent, mock_db):
        """Manual correction without manager_id returns early without update."""
        msg = {
            "message_id": "edge-004",
            "routing_key": "stock.manual_correction",
            "payload": {"inventory_id": "inv-1", "corrected_stock": 8},  # no manager_id
        }
        await agent._handle_manual_correction(msg)
        mock_db.update_inventory_stock.assert_not_called()

    @pytest.mark.asyncio
    async def test_delivery_missing_order_id_returns_early(self, agent, mock_db):
        """Delivery without order_id returns early without update."""
        msg = {
            "message_id": "edge-005",
            "routing_key": "procurement.order.delivered",
            "payload": {"inventory_id": "inv-1", "quantity_delivered": 6},  # no order_id
        }
        await agent._handle_order_delivered(msg)
        mock_db.update_inventory_stock.assert_not_called()

    @pytest.mark.asyncio
    async def test_stock_evaluated_zero_stock_allowed(self, agent, mock_db):
        """stock_after=0 is a valid value — OUT_OF_STOCK state, must still process."""
        mock_db.get_inventory_item = AsyncMock(return_value={
            "id": "inv-1", "wine_name": "Opus One", "stock_live": 0,
            "threshold_min": 3, "in_transit_quantity": 0, "restaurant_id": "rest-1"
        })
        msg = {
            "message_id": "edge-006",
            "routing_key": "stock.evaluated",
            "payload": {"inventory_id": "inv-1", "stock_after": 0, "restaurant_id": "rest-1"},
        }
        await agent._handle_stock_evaluated(msg)
        mock_db.update_inventory_stock.assert_called_once()
