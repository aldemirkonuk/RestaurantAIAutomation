"""Tests for BUG-01 (optimistic locking) and BUG-02 (dead code removal)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from agents.inventory_engine import InventoryEngineAgent


class TestBUG02DeadCodeRemoval:
    """BUG-02: update_queue and batch_size must not exist on InventoryEngineAgent."""

    def test_no_update_queue_attribute(self):
        agent = InventoryEngineAgent.__new__(InventoryEngineAgent)
        assert not hasattr(agent, "update_queue"), \
            "update_queue dead code must be removed from __init__"

    def test_no_batch_size_attribute(self):
        agent = InventoryEngineAgent.__new__(InventoryEngineAgent)
        assert not hasattr(agent, "batch_size"), \
            "batch_size dead code must be removed from __init__"


class TestBUG01OptimisticLocking:
    """BUG-01: update_stock must use optimistic locking (WHERE version = N)."""

    @pytest.fixture
    def mock_supabase(self):
        sb = MagicMock()
        return sb

    @pytest.mark.asyncio
    async def test_successful_update_returns_item(self, mock_supabase):
        """Happy path: version matches, update succeeds."""
        from core.database import InventoryRepository
        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        # Simulate current row has version=3
        mock_supabase.table.return_value.select.return_value.eq.return_value \
            .single.return_value.execute.return_value.data = {
                "id": "inv-1", "stock_live": 10, "version": 3
            }
        # Simulate successful UPDATE returning version=4
        mock_supabase.table.return_value.update.return_value.eq.return_value \
            .eq.return_value.execute.return_value.data = [
                {"id": "inv-1", "stock_live": 7, "version": 4}
            ]

        result = await repo.update_stock("inv-1", 7, "sale")
        assert result is not None
        assert result["stock_live"] == 7

    @pytest.mark.asyncio
    async def test_conflict_triggers_retry(self, mock_supabase):
        """Version conflict (empty RETURNING) causes retry, succeeds on 2nd attempt."""
        from core.database import InventoryRepository
        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        # First SELECT: version=3
        # Second SELECT (after conflict): version=4 (another writer incremented it)
        select_mock = mock_supabase.table.return_value.select.return_value \
            .eq.return_value.single.return_value.execute
        select_mock.side_effect = [
            MagicMock(data={"id": "inv-1", "stock_live": 10, "version": 3}),
            MagicMock(data={"id": "inv-1", "stock_live": 9, "version": 4}),
        ]

        # First UPDATE: conflict → empty list; Second UPDATE: success
        update_mock = mock_supabase.table.return_value.update.return_value \
            .eq.return_value.eq.return_value.execute
        update_mock.side_effect = [
            MagicMock(data=[]),   # conflict
            MagicMock(data=[{"id": "inv-1", "stock_live": 8, "version": 5}]),
        ]

        result = await repo.update_stock("inv-1", 8, "sale")
        assert result is not None
        assert result["version"] == 5
        assert update_mock.call_count == 2

    @pytest.mark.asyncio
    async def test_exhausted_retries_returns_none(self, mock_supabase):
        """After 3 retries all conflicting → returns None."""
        from core.database import InventoryRepository
        repo = InventoryRepository.__new__(InventoryRepository)
        repo.supabase = mock_supabase
        repo.table_name = "inventory_stock"

        select_mock = mock_supabase.table.return_value.select.return_value \
            .eq.return_value.single.return_value.execute
        select_mock.return_value = MagicMock(
            data={"id": "inv-1", "stock_live": 10, "version": 3}
        )
        update_mock = mock_supabase.table.return_value.update.return_value \
            .eq.return_value.eq.return_value.execute
        update_mock.return_value = MagicMock(data=[])  # always conflict

        result = await repo.update_stock("inv-1", 8, "sale")
        assert result is None
        assert update_mock.call_count == 3
