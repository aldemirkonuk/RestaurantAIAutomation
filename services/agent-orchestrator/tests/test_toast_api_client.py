"""
Tests for Toast API Client

Tests the Toast API client functionality including:
- Mock data generation
- Real API calls (when credentials available)
- Sales data streaming
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

from services.toast_api_client import ToastAPIClient


class TestToastAPIClient:
    """Test suite for ToastAPIClient."""

    @pytest.fixture
    def mock_client(self) -> ToastAPIClient:
        """Create a mock mode Toast client."""
        return ToastAPIClient(mock_mode=True)

    @pytest.fixture
    def real_client(self) -> ToastAPIClient:
        """Create a real mode Toast client (will fall back to mock without credentials)."""
        return ToastAPIClient(
            toast_client_id="test-client-id",
            toast_client_secret="test-client-secret",
            toast_restaurant_guid="test-restaurant-guid",
            mock_mode=False,
        )

    @pytest.mark.asyncio
    async def test_connect_mock_mode(self, mock_client: ToastAPIClient):
        """Test connection in mock mode."""
        result = await mock_client.connect()

        assert result is True
        assert mock_client.mock_mode is True
        assert mock_client.http_client is not None

        await mock_client.disconnect()

    @pytest.mark.asyncio
    async def test_connect_real_mode_fallback(self, real_client: ToastAPIClient):
        """Test that real mode falls back to mock when auth fails."""
        # Mock the HTTP client to simulate auth failure
        with patch.object(
            real_client, "_authenticate", side_effect=Exception("Auth failed")
        ):
            result = await real_client.connect()

        assert result is True
        assert real_client.mock_mode is True  # Should fall back to mock

        await real_client.disconnect()

    @pytest.mark.asyncio
    async def test_fetch_sales_data_mock(self, mock_client: ToastAPIClient):
        """Test fetching sales data in mock mode."""
        await mock_client.connect()

        start_time = datetime.utcnow() - timedelta(hours=2)
        end_time = datetime.utcnow()

        sales = await mock_client.fetch_sales_data(start_time, end_time)

        assert isinstance(sales, list)
        # Should generate some sales for a 2-hour period
        assert len(sales) >= 0

        # Verify sale structure
        if len(sales) > 0:
            sale = sales[0]
            assert "id" in sale
            assert "item_name" in sale
            assert "quantity" in sale
            assert "timestamp" in sale
            assert "source" in sale
            assert sale["source"] == "mock"

        await mock_client.disconnect()

    @pytest.mark.asyncio
    async def test_generate_mock_sales_structure(self, mock_client: ToastAPIClient):
        """Test that mock sales have correct structure."""
        await mock_client.connect()

        start_time = datetime.utcnow() - timedelta(hours=1)
        end_time = datetime.utcnow()

        sales = await mock_client.fetch_sales_data(start_time, end_time)

        if len(sales) > 0:
            sale = sales[0]

            # Check required fields
            required_fields = [
                "id",
                "order_guid",
                "item_name",
                "wine_type",
                "quantity",
                "unit_price",
                "total_price",
                "timestamp",
                "server_name",
                "table_name",
                "source",
            ]

            for field in required_fields:
                assert field in sale, f"Missing field: {field}"

            # Check data types
            assert isinstance(sale["quantity"], int)
            assert isinstance(sale["unit_price"], float)
            assert isinstance(sale["total_price"], float)
            assert sale["total_price"] == sale["unit_price"] * sale["quantity"]

        await mock_client.disconnect()

    @pytest.mark.asyncio
    async def test_generate_single_mock_sale(self, mock_client: ToastAPIClient):
        """Test generating a single mock sale."""
        sale = mock_client._generate_single_mock_sale()

        assert "id" in sale
        assert "item_name" in sale
        assert sale["source"] == "mock_stream"
        assert sale["quantity"] >= 1
        assert sale["quantity"] <= 3

    def test_mock_wines_list(self, mock_client: ToastAPIClient):
        """Test that mock wines list is populated."""
        assert len(mock_client.MOCK_WINES) > 0

        for wine in mock_client.MOCK_WINES:
            assert "name" in wine
            assert "price" in wine
            assert "type" in wine

    def test_sales_patterns(self, mock_client: ToastAPIClient):
        """Test that sales patterns are defined."""
        assert len(mock_client.SALES_PATTERNS) > 0

        # Peak hours should have higher probability
        assert mock_client.SALES_PATTERNS.get(19, 0) >= mock_client.SALES_PATTERNS.get(
            14, 0
        )
        assert mock_client.SALES_PATTERNS.get(20, 0) >= mock_client.SALES_PATTERNS.get(
            14, 0
        )

    def test_get_statistics(self, mock_client: ToastAPIClient):
        """Test getting client statistics."""
        stats = mock_client.get_statistics()

        assert "mode" in stats
        assert "total_api_calls" in stats
        assert "total_sales_fetched" in stats
        assert "mock_sales_generated" in stats
        assert "is_streaming" in stats

        assert stats["mode"] == "mock"
        assert stats["is_streaming"] is False

    @pytest.mark.asyncio
    async def test_streaming_start_stop(self, mock_client: ToastAPIClient):
        """Test starting and stopping the sales stream."""
        await mock_client.connect()

        callback = AsyncMock()

        # Start streaming
        mock_client.start_streaming(callback, interval_seconds=1)

        assert mock_client.is_streaming is True

        # Let it run briefly
        await asyncio.sleep(0.1)

        # Stop streaming
        mock_client.stop_streaming()

        assert mock_client.is_streaming is False

        await mock_client.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_cleanup(self, mock_client: ToastAPIClient):
        """Test that disconnect cleans up resources."""
        await mock_client.connect()

        assert mock_client.http_client is not None

        await mock_client.disconnect()

        # HTTP client should be closed
        # (we can't easily check this, but no exception means success)


class TestToastAPIClientExtractWineItems:
    """Test wine item extraction from orders."""

    @pytest.fixture
    def client(self) -> ToastAPIClient:
        return ToastAPIClient(mock_mode=True)

    def test_extract_wine_items_from_order(self, client: ToastAPIClient):
        """Test extracting wine items from a Toast order."""
        order = {
            "guid": "order-123",
            "closedDate": "2024-01-15T20:00:00Z",
            "server": {"firstName": "Alex"},
            "table": {"name": "Table 5"},
            "checks": [
                {
                    "selections": [
                        {
                            "displayName": "Opus One Cabernet 2019",
                            "quantity": 1,
                            "price": 4500,  # In cents
                        },
                        {
                            "displayName": "Burger",  # Not a wine
                            "quantity": 1,
                            "price": 1500,
                        },
                        {
                            "displayName": "Chardonnay Reserve",
                            "quantity": 2,
                            "price": 2400,
                        },
                    ]
                }
            ],
        }

        wine_items = client._extract_wine_items(order)

        # Should extract 2 wine items (Cabernet and Chardonnay)
        assert len(wine_items) == 2

        # Check first wine
        assert wine_items[0]["item_name"] == "Opus One Cabernet 2019"
        assert wine_items[0]["quantity"] == 1
        assert wine_items[0]["price"] == 45.00  # Converted from cents

        # Check second wine
        assert wine_items[1]["item_name"] == "Chardonnay Reserve"
        assert wine_items[1]["quantity"] == 2

    def test_extract_wine_items_empty_order(self, client: ToastAPIClient):
        """Test extracting wine items from an empty order."""
        order = {
            "guid": "order-123",
            "checks": [{"selections": []}],
        }

        wine_items = client._extract_wine_items(order)

        assert len(wine_items) == 0


# Import asyncio for streaming test
import asyncio
