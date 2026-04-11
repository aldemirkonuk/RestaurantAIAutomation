"""
Pytest Configuration and Fixtures

This file contains shared fixtures and configuration for all tests.
"""

import os
import sys
import pytest
import asyncio
from typing import Generator, AsyncGenerator
from unittest.mock import MagicMock, AsyncMock

# ---------------------------------------------------------------------------
# Stub weasyprint before any agent module imports it.
# On macOS dev machines (and CI) without libgobject/pango, weasyprint raises
# OSError at import time.  The reporting_agent already guards with try/except,
# but providing a module-level stub here ensures patch() works in tests.
# ---------------------------------------------------------------------------
import importlib
if importlib.util.find_spec("weasyprint") is None or True:
    import types as _types
    _wp_stub = _types.ModuleType("weasyprint")
    _wp_stub.HTML = MagicMock()  # type: ignore[attr-defined]
    sys.modules.setdefault("weasyprint", _wp_stub)


_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    # Ensure `import jobs`, `import services`, etc. resolve during pytest runs
    sys.path.insert(0, _PROJECT_ROOT)


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_supabase_client() -> MagicMock:
    """Create a mock Supabase client."""
    client = MagicMock()
    
    # Mock common methods
    client.table = MagicMock(return_value=client)
    client.select = MagicMock(return_value=client)
    client.insert = MagicMock(return_value=client)
    client.update = MagicMock(return_value=client)
    client.delete = MagicMock(return_value=client)
    client.eq = MagicMock(return_value=client)
    client.execute = AsyncMock(return_value=MagicMock(data=[], error=None))
    
    return client


@pytest.fixture
def mock_redis_client() -> MagicMock:
    """Create a mock Redis client."""
    client = MagicMock()
    
    client.get = AsyncMock(return_value=None)
    client.set = AsyncMock(return_value=True)
    client.delete = AsyncMock(return_value=True)
    client.exists = AsyncMock(return_value=False)
    client.expire = AsyncMock(return_value=True)
    
    return client


@pytest.fixture
def mock_rabbitmq_connection() -> MagicMock:
    """Create a mock RabbitMQ connection."""
    connection = MagicMock()
    channel = MagicMock()
    
    connection.channel = MagicMock(return_value=channel)
    channel.basic_publish = MagicMock()
    channel.basic_consume = MagicMock()
    channel.queue_declare = MagicMock()
    
    return connection


@pytest.fixture
def sample_restaurant_id() -> str:
    """Sample restaurant ID for testing."""
    return "test-restaurant-123"


@pytest.fixture
def sample_user_id() -> str:
    """Sample user ID for testing."""
    return "test-user-456"


@pytest.fixture
def sample_wine_data() -> dict:
    """Sample wine data for testing."""
    return {
        "id": "wine-001",
        "name": "Opus One 2019",
        "vintage": 2019,
        "region": "Napa Valley",
        "varietal": "Bordeaux Blend",
        "price": 450.00,
        "stock_live": 12,
        "par_level": 6,
    }


@pytest.fixture
def sample_order_data() -> dict:
    """Sample order data for testing."""
    return {
        "id": "order-001",
        "restaurant_id": "test-restaurant-123",
        "wine_id": "wine-001",
        "quantity": 6,
        "unit_price": 450.00,
        "total_price": 2700.00,
        "status": "pending",
        "provider_id": "provider-001",
    }


@pytest.fixture
def sample_notification_data() -> dict:
    """Sample notification data for testing."""
    return {
        "id": "notification-001",
        "type": "low_stock",
        "title": "Low Stock Alert",
        "body": "Opus One 2019 is running low (12 bottles remaining)",
        "restaurant_id": "test-restaurant-123",
        "wine_id": "wine-001",
        "priority": "high",
    }


@pytest.fixture
def test_client():
    """FastAPI TestClient wrapping the main app.

    Applies a compatibility shim for starlette 0.35.1 + httpx 0.28: httpx 0.28
    removed the `app` parameter from Client.__init__, but starlette still passes it.
    The shim absorbs the keyword arg so the real transport kwarg is used instead.
    """
    import httpx
    from fastapi.testclient import TestClient
    from main import app

    _orig_client_init = httpx.Client.__init__

    def _shim(self, *args, app=None, **kwargs):  # absorb `app` kwarg
        _orig_client_init(self, *args, **kwargs)

    httpx.Client.__init__ = _shim  # type: ignore[method-assign]
    try:
        client = TestClient(app)
        yield client
    finally:
        httpx.Client.__init__ = _orig_client_init  # type: ignore[method-assign]


@pytest.fixture
def sample_sales_data() -> list:
    """Sample sales data for testing."""
    return [
        {
            "id": "sale-001",
            "order_guid": "order-guid-001",
            "item_name": "Opus One 2019",
            "wine_type": "red",
            "quantity": 1,
            "unit_price": 45.00,
            "total_price": 45.00,
            "timestamp": "2024-01-15T19:30:00Z",
            "server_name": "Alex",
            "table_name": "Table 5",
            "source": "mock",
        },
        {
            "id": "sale-002",
            "order_guid": "order-guid-002",
            "item_name": "Caymus Cabernet 2020",
            "wine_type": "red",
            "quantity": 2,
            "unit_price": 24.00,
            "total_price": 48.00,
            "timestamp": "2024-01-15T20:15:00Z",
            "server_name": "Jordan",
            "table_name": "Table 12",
            "source": "mock",
        },
    ]
