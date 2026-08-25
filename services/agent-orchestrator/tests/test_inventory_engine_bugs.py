"""Tests for BUG-01 (stock write via apply_stock_movement RPC) and BUG-02 (dead code removal)."""

import pytest
from unittest.mock import MagicMock
from agents.inventory_engine import InventoryEngineAgent


class TestBUG02DeadCodeRemoval:
    """BUG-02: update_queue and batch_size must not exist on InventoryEngineAgent."""

    def test_no_update_queue_attribute(self):
        agent = InventoryEngineAgent.__new__(InventoryEngineAgent)
        assert not hasattr(
            agent, "update_queue"
        ), "update_queue dead code must be removed from __init__"

    def test_no_batch_size_attribute(self):
        agent = InventoryEngineAgent.__new__(InventoryEngineAgent)
        assert not hasattr(
            agent, "batch_size"
        ), "batch_size dead code must be removed from __init__"


class TestBUG01StockWriteViaRpc:
    """BUG-01: update_stock must apply deltas through apply_stock_movement (not direct CAS)."""

    @pytest.fixture
    def mock_supabase(self):
        return MagicMock()

    @pytest.mark.asyncio
    async def test_successful_update_returns_item(self, mock_supabase):
        """Happy path: read current, apply delta via RPC, return refreshed row."""
        from core.database import InventoryRepository

        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        select_execute = (
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute
        )
        select_execute.side_effect = [
            MagicMock(data={"id": "inv-1", "stock_live": 10}),
            MagicMock(data={"id": "inv-1", "stock_live": 7, "version": 4}),
        ]
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(data=None)

        result = await repo.update_stock("inv-1", 7, "sale")
        assert result is not None
        assert result["stock_live"] == 7
        mock_supabase.rpc.assert_called_once()
        args, kwargs = mock_supabase.rpc.call_args
        assert args[0] == "apply_stock_movement"
        assert args[1]["p_inventory_id"] == "inv-1"
        assert args[1]["p_delta"] == -3
        assert args[1]["p_stock_state"] == "live"

    @pytest.mark.asyncio
    async def test_zero_delta_skips_rpc(self, mock_supabase):
        """When target equals current stock, skip RPC and return refreshed row."""
        from core.database import InventoryRepository

        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        select_execute = (
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute
        )
        select_execute.side_effect = [
            MagicMock(data={"id": "inv-1", "stock_live": 8}),
            MagicMock(data={"id": "inv-1", "stock_live": 8, "version": 2}),
        ]

        result = await repo.update_stock("inv-1", 8, "sale")
        assert result is not None
        assert result["stock_live"] == 8
        mock_supabase.rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_rpc_failure_returns_none(self, mock_supabase):
        """If apply_stock_movement raises, update_stock returns None."""
        from core.database import InventoryRepository

        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        select_execute = (
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute
        )
        select_execute.return_value = MagicMock(data={"id": "inv-1", "stock_live": 10})
        mock_supabase.rpc.return_value.execute.side_effect = RuntimeError("rpc down")

        result = await repo.update_stock("inv-1", 8, "sale")
        assert result is None

    @pytest.mark.asyncio
    async def test_missing_inventory_returns_none(self, mock_supabase):
        """Missing inventory row returns None without calling RPC."""
        from core.database import InventoryRepository

        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        select_execute = (
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute
        )
        select_execute.return_value = MagicMock(data=None)

        result = await repo.update_stock("missing", 1, "sale")
        assert result is None
        mock_supabase.rpc.assert_not_called()
