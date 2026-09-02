"""
Toast API Hybrid Client
=======================
Hybrid Toast POS API client that:
- Attempts real Toast API calls if credentials exist
- Falls back to realistic mock data if API unavailable
- Simulates sales data streaming
- Updates Supabase sales_events table
- Triggers stock updates via Buffer Manager

Usage:
    client = ToastAPIClient(settings, db_client, mock_mode=False)
    await client.connect()
    
    # Fetch sales data
    sales = await client.fetch_sales_data(start_time, end_time)
    
    # Stream continuously (background task)
    await client.stream_sales_continuously(callback)
"""

import asyncio
import random
import httpx
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
from uuid import uuid4
import logging

logger = logging.getLogger(__name__)

# The client's long-standing constant. NOTE: config/settings.py:152-154 defaults
# TOAST_API_URL to "https://ws-api.toasttab.com" instead, and the two have never
# agreed. Neither has been checked against a live Toast call. This value is only
# the last-resort fallback now that the factory passes the setting through.
DEFAULT_TOAST_BASE_URL = "https://api.toasttab.com"


def _require_safe_id(value: str, kind: str) -> None:
    """Reject an id that cannot be safely interpolated into an outbound URL.

    Enforced in the client rather than only in the router because the client is
    importable by agents and scripts too, and a sink is only closed if it is
    closed at the sink.
    """
    from services.safe_path import is_safe_path_segment  # noqa: PLC0415

    if not is_safe_path_segment(value):
        raise ToastInvalidIdentifier(f"Invalid Toast {kind} id")


class ToastError(RuntimeError):
    """Base class for Toast failures that must be surfaced, never papered over."""


class ToastNotConfigured(ToastError):
    """No usable Toast credentials, so no real call could even be attempted.

    Raised only in `strict=True` mode. The permissive default keeps falling back
    to mock data for the demo scripts that want it.
    """


class ToastUnavailable(ToastError):
    """A real Toast call was attempted and failed (auth, network, HTTP status).

    Raised only in `strict=True` mode, in place of the mock fallback.
    """


class ToastInvalidIdentifier(ToastError):
    """A caller-supplied id cannot be safely interpolated into an outbound URL.

    Raised before any request is made, in every mode. See services/safe_path.py:
    an id that is not a single literal path segment can escape the path it was
    meant to be confined to (CodeQL py/partial-ssrf).
    """


class ToastNotFound(ToastError):
    """Toast answered, and the answer was that the resource does not exist.

    Split out from ToastUnavailable because "this menu is not there" is a real,
    trustworthy answer that must reach the caller as 404 — while "we could not
    reach Toast" must reach it as 503. Collapsing the two would let an outage
    read as a deletion.
    """


class ToastAPIClient:
    """
    Hybrid Toast POS API Client

    Modes:
    - Real: Uses actual Toast API with credentials
    - Mock: Generates realistic wine sales data
    - Hybrid: Tries real API, falls back to mock

    `strict=True` disables every mock fallback: each operation raises
    ToastNotConfigured (no credentials) or ToastUnavailable (the real call
    failed) instead of returning invented data. Required by ADR 0020 for any
    caller that puts the result in front of a user — see
    `.planning/decisions/0020-no-fabricated-answers.md`. Default stays False so
    existing callers (demo/, tests/) behave exactly as before.
    """

    # Wine items for mock data generation
    MOCK_WINES = [
        {"name": "Opus One 2019", "price": 45.00, "type": "red"},
        {"name": "Caymus Cabernet 2020", "price": 24.00, "type": "red"},
        {"name": "Whispering Angel Rosé", "price": 16.00, "type": "rosé"},
        {"name": "Cloudy Bay Sauvignon Blanc", "price": 18.00, "type": "white"},
        {"name": "Dom Pérignon 2012", "price": 85.00, "type": "sparkling"},
        {"name": "Château Margaux 2018", "price": 120.00, "type": "red"},
        {"name": "Silver Oak Cabernet", "price": 38.00, "type": "red"},
        {"name": "Kendall-Jackson Chardonnay", "price": 14.00, "type": "white"},
        {"name": "Veuve Clicquot Brut", "price": 55.00, "type": "sparkling"},
        {"name": "Rombauer Chardonnay", "price": 28.00, "type": "white"},
    ]

    # Time-based sales patterns (hour -> relative probability)
    SALES_PATTERNS = {
        11: 0.3,  # Late morning
        12: 0.6,  # Lunch
        13: 0.5,  # After lunch
        14: 0.2,  # Afternoon lull
        15: 0.2,
        16: 0.3,
        17: 0.5,  # Happy hour starts
        18: 0.8,  # Dinner rush begins
        19: 1.0,  # Peak dinner
        20: 1.0,  # Peak dinner
        21: 0.8,  # Late dinner
        22: 0.5,  # Late night
        23: 0.3,
        0: 0.2,  # After midnight
    }

    # Mock menu data
    MOCK_MENUS = [
        {
            "guid": "menu-001",
            "name": "Main Wine List",
            "lastModified": "2026-01-10T12:00:00Z",
            "items": [
                {
                    "guid": "item-001",
                    "name": "Opus One 2019",
                    "price": 4500,
                    "type": "red",
                },
                {
                    "guid": "item-002",
                    "name": "Whispering Angel Rosé",
                    "price": 1600,
                    "type": "rosé",
                },
                {
                    "guid": "item-003",
                    "name": "Dom Pérignon 2012",
                    "price": 8500,
                    "type": "sparkling",
                },
            ],
        },
        {
            "guid": "menu-002",
            "name": "By The Glass",
            "lastModified": "2026-01-12T15:30:00Z",
            "items": [
                {
                    "guid": "item-101",
                    "name": "Caymus Cabernet 2020",
                    "price": 2400,
                    "type": "red",
                },
                {
                    "guid": "item-102",
                    "name": "Cloudy Bay Sauvignon Blanc",
                    "price": 1800,
                    "type": "white",
                },
            ],
        },
    ]

    def __init__(
        self,
        toast_client_id: Optional[str] = None,
        toast_client_secret: Optional[str] = None,
        toast_restaurant_guid: Optional[str] = None,
        mock_mode: bool = True,
        base_url: str = "https://api.toasttab.com",
        strict: bool = False,
    ):
        self.client_id = toast_client_id
        self.client_secret = toast_client_secret
        self.restaurant_guid = toast_restaurant_guid
        self.mock_mode = mock_mode
        self.base_url = base_url
        self.strict = strict

        # HTTP client
        self.http_client: Optional[httpx.AsyncClient] = None
        self.access_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None

        # Streaming state
        self.is_streaming = False
        self._stream_task: Optional[asyncio.Task] = None

        # Statistics
        self.total_sales_fetched = 0
        self.total_api_calls = 0
        self.mock_sales_generated = 0

    async def connect(self) -> bool:
        """Initialize connection to Toast API"""
        logger.info("Initializing Toast API client...")

        self.http_client = httpx.AsyncClient(timeout=30.0)

        if self.mock_mode:
            if self.strict:
                raise ToastNotConfigured(
                    "Toast client is in mock mode; strict callers must not serve mock data."
                )
            logger.info("✓ Toast API client initialized (MOCK mode)")
            return True

        # Try to authenticate with real API
        if self.client_id and self.client_secret:
            try:
                await self._authenticate()
                logger.info("✓ Toast API client initialized (REAL mode)")
                return True
            except Exception as e:
                logger.warning(f"Toast API authentication failed: {e}")
                if self.strict:
                    # Do NOT flip mock_mode — that is the exact silent
                    # degradation this mode exists to prevent.
                    raise ToastUnavailable(f"Toast authentication failed: {e}") from e
                logger.info("Falling back to MOCK mode")
                self.mock_mode = True
                return True
        else:
            if self.strict:
                raise ToastNotConfigured(
                    "Toast credentials are not configured "
                    "(TOAST_CLIENT_ID / TOAST_CLIENT_SECRET)."
                )
            logger.info("No Toast credentials provided, using MOCK mode")
            self.mock_mode = True
            return True

    async def disconnect(self):
        """Close connections"""
        self.is_streaming = False
        if self._stream_task:
            self._stream_task.cancel()
            try:
                await self._stream_task
            except asyncio.CancelledError:
                pass

        if self.http_client:
            await self.http_client.aclose()

        logger.info("✓ Toast API client disconnected")

    async def _authenticate(self) -> str:
        """Authenticate with Toast API and get access token"""
        if self.access_token and self.token_expires_at:
            if datetime.utcnow() < self.token_expires_at - timedelta(minutes=5):
                return self.access_token

        auth_url = f"{self.base_url}/authentication/v1/authentication/login"

        response = await self.http_client.post(
            auth_url,
            json={
                "clientId": self.client_id,
                "clientSecret": self.client_secret,
                "userAccessType": "TOAST_MACHINE_CLIENT",
            },
        )
        response.raise_for_status()

        data = response.json()
        self.access_token = data["token"]["accessToken"]
        expires_in = data["token"]["expiresIn"]
        self.token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

        return self.access_token

    def _refuse_mock(self, operation: str) -> None:
        """Strict mode: refuse to answer `operation` with fabricated data."""
        if self.strict:
            raise ToastNotConfigured(
                f"Toast is not configured; refusing to serve mock data for {operation}."
            )

    def _refuse_fallback(self, operation: str, exc: Exception) -> None:
        """Strict mode: surface a real failure instead of falling back to mock."""
        if not self.strict:
            return
        if (
            isinstance(exc, httpx.HTTPStatusError)
            and exc.response is not None
            and exc.response.status_code == 404
        ):
            raise ToastNotFound(f"Toast {operation}: not found") from exc
        raise ToastUnavailable(f"Toast {operation} failed: {exc}") from exc

    async def fetch_menus(self, restaurant_id: Optional[str] = None) -> Dict[str, Any]:
        """Fetch menus from Toast API (or mock data)."""
        self.total_api_calls += 1

        if self.mock_mode:
            self._refuse_mock("fetch_menus")
            return {"menus": self.MOCK_MENUS}

        try:
            token = await self._authenticate()
            menus_url = f"{self.base_url}/config/v2/menus"
            response = await self.http_client.get(
                menus_url,
                headers={"Authorization": f"Bearer {token}"},
                params={"restaurantGuid": restaurant_id or self.restaurant_guid},
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Toast menus fetch failed: {e}. Falling back to mock.")
            self._refuse_fallback("menus fetch", e)
            return {"menus": self.MOCK_MENUS}

    async def fetch_menu(self, menu_id: str) -> Dict[str, Any]:
        """Fetch a single menu by ID (or mock data)."""
        _require_safe_id(menu_id, "menu")
        if self.mock_mode:
            self._refuse_mock("fetch_menu")
            for menu in self.MOCK_MENUS:
                if menu["guid"] == menu_id:
                    return menu
            raise ValueError("Menu not found")

        try:
            token = await self._authenticate()
            menu_url = f"{self.base_url}/config/v2/menus/{menu_id}"
            response = await self.http_client.get(
                menu_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Toast menu fetch failed: {e}. Falling back to mock.")
            self._refuse_fallback("menu fetch", e)
            for menu in self.MOCK_MENUS:
                if menu["guid"] == menu_id:
                    return menu
            raise

    async def fetch_order(self, order_id: str) -> Dict[str, Any]:
        """Fetch a single order by GUID from Toast's orders API.

        Endpoint: GET /orders/v2/orders/{guid}

        Unlike its siblings this method has NO mock fallback in either mode, and
        that is deliberate. `create_order`'s mock path mints a random uuid that is
        never stored, so there is no mock order any caller could legitimately read
        back — a mock `fetch_order` could only invent an order that does not
        exist, at a vendor, with money attached. ADR 0020 forbids exactly that.
        Non-strict callers therefore get ToastNotConfigured rather than a fiction.
        """
        _require_safe_id(order_id, "order")
        self.total_api_calls += 1

        if self.mock_mode:
            raise ToastNotConfigured(
                "Toast is not configured; order lookup has no mock answer "
                "(an invented order is never a safe fallback)."
            )

        try:
            token = await self._authenticate()
            order_url = f"{self.base_url}/orders/v2/orders/{order_id}"
            response = await self.http_client.get(
                order_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            return response.json()
        except ToastError:
            raise
        except httpx.HTTPStatusError as e:
            logger.warning(f"Toast order fetch failed: {e}")
            if e.response is not None and e.response.status_code == 404:
                raise ToastNotFound(f"Toast order '{order_id}' not found") from e
            raise ToastUnavailable(f"Toast order fetch failed: {e}") from e
        except Exception as e:
            logger.warning(f"Toast order fetch failed: {e}")
            raise ToastUnavailable(f"Toast order fetch failed: {e}") from e

    async def create_order(
        self, restaurant_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create an order (mock or API)."""
        if self.mock_mode:
            self._refuse_mock("create_order")
            return {
                "order_id": str(uuid4()),
                "restaurant_id": restaurant_id,
                "status": "created",
                "items": payload.get("items", []),
                "created_at": datetime.utcnow().isoformat(),
            }

        try:
            token = await self._authenticate()
            orders_url = f"{self.base_url}/orders/v2/orders"
            response = await self.http_client.post(
                orders_url,
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Toast order create failed: {e}. Falling back to mock.")
            # Strict mode refuses hardest here: a fabricated "mock_created" order
            # tells the caller a real order was placed at a vendor when none was.
            self._refuse_fallback("order create", e)
            return {
                "order_id": str(uuid4()),
                "restaurant_id": restaurant_id,
                "status": "mock_created",
                "items": payload.get("items", []),
                "created_at": datetime.utcnow().isoformat(),
            }

    async def fetch_sales_data(
        self,
        start_time: datetime,
        end_time: datetime,
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch wine sales data from Toast API

        Args:
            start_time: Start of time range
            end_time: End of time range
            restaurant_id: Optional restaurant filter

        Returns:
            List of sale events
        """
        self.total_api_calls += 1

        if self.mock_mode:
            self._refuse_mock("fetch_sales_data")
            return self._generate_mock_sales(start_time, end_time)

        # Real API call
        try:
            token = await self._authenticate()

            orders_url = f"{self.base_url}/orders/v2/orders"

            response = await self.http_client.get(
                orders_url,
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "restaurantGuid": self.restaurant_guid,
                    "startDate": start_time.isoformat(),
                    "endDate": end_time.isoformat(),
                },
            )
            response.raise_for_status()

            orders = response.json()

            # Extract wine sales from orders
            sales = []
            for order in orders:
                wine_items = self._extract_wine_items(order)
                sales.extend(wine_items)

            self.total_sales_fetched += len(sales)
            return sales

        except Exception as e:
            logger.error(f"Toast API error: {e}, falling back to mock")
            self._refuse_fallback("sales fetch", e)
            return self._generate_mock_sales(start_time, end_time)

    def _extract_wine_items(self, order: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract wine items from a Toast order"""
        wine_keywords = [
            "wine",
            "cabernet",
            "merlot",
            "chardonnay",
            "pinot",
            "sauvignon",
            "riesling",
            "champagne",
            "prosecco",
            "rosé",
            "rose",
            "bordeaux",
            "burgundy",
            "napa",
        ]

        sales = []
        selections = order.get("checks", [{}])[0].get("selections", [])

        for selection in selections:
            item_name = selection.get("displayName", "").lower()

            # Check if this is a wine item
            if any(keyword in item_name for keyword in wine_keywords):
                sale = {
                    "id": str(uuid4()),
                    "order_guid": order.get("guid"),
                    "item_name": selection.get("displayName"),
                    "quantity": selection.get("quantity", 1),
                    "price": selection.get("price", 0) / 100,  # Cents to dollars
                    "timestamp": order.get("closedDate")
                    or datetime.utcnow().isoformat(),
                    "server_name": order.get("server", {}).get("firstName"),
                    "table_name": order.get("table", {}).get("name"),
                    "source": "toast_api",
                }
                sales.append(sale)

        return sales

    def _generate_mock_sales(
        self,
        start_time: datetime,
        end_time: datetime,
    ) -> List[Dict[str, Any]]:
        """Generate realistic mock wine sales data"""
        sales = []
        current_time = start_time

        while current_time < end_time:
            hour = current_time.hour

            # Get sales probability for this hour
            probability = self.SALES_PATTERNS.get(hour, 0.3)

            # Generate 0-3 sales per 15-minute interval based on probability
            num_sales = 0
            if random.random() < probability:
                num_sales = random.choices([0, 1, 2, 3], weights=[0.3, 0.4, 0.2, 0.1])[
                    0
                ]

            for _ in range(num_sales):
                wine = random.choice(self.MOCK_WINES)
                quantity = random.choices([1, 2, 3], weights=[0.7, 0.25, 0.05])[0]

                sale = {
                    "id": str(uuid4()),
                    "order_guid": f"mock-order-{uuid4().hex[:8]}",
                    "item_name": wine["name"],
                    "wine_type": wine["type"],
                    "quantity": quantity,
                    "unit_price": wine["price"],
                    "total_price": wine["price"] * quantity,
                    "timestamp": (
                        current_time + timedelta(minutes=random.randint(0, 14))
                    ).isoformat(),
                    "server_name": random.choice(
                        ["Alex", "Jordan", "Sam", "Taylor", "Morgan"]
                    ),
                    "table_name": f"Table {random.randint(1, 20)}",
                    "source": "mock",
                }
                sales.append(sale)
                self.mock_sales_generated += 1

            current_time += timedelta(minutes=15)

        self.total_sales_fetched += len(sales)
        logger.info(
            f"Generated {len(sales)} mock sales for {start_time.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"
        )
        return sales

    def _generate_single_mock_sale(self) -> Dict[str, Any]:
        """Generate a single mock sale (for streaming)"""
        wine = random.choice(self.MOCK_WINES)
        quantity = random.choices([1, 2, 3], weights=[0.7, 0.25, 0.05])[0]

        return {
            "id": str(uuid4()),
            "order_guid": f"mock-order-{uuid4().hex[:8]}",
            "item_name": wine["name"],
            "wine_type": wine["type"],
            "quantity": quantity,
            "unit_price": wine["price"],
            "total_price": wine["price"] * quantity,
            "timestamp": datetime.utcnow().isoformat(),
            "server_name": random.choice(["Alex", "Jordan", "Sam", "Taylor", "Morgan"]),
            "table_name": f"Table {random.randint(1, 20)}",
            "source": "mock_stream",
        }

    async def stream_sales_continuously(
        self,
        callback: Callable[[Dict[str, Any]], Any],
        interval_seconds: int = 300,  # 5 minutes
        sales_per_interval: int = 3,
    ):
        """
        Stream sales data continuously (background task)

        Args:
            callback: Async function to call with each sale
            interval_seconds: How often to generate/fetch sales
            sales_per_interval: Average sales per interval (mock mode)
        """
        self.is_streaming = True
        logger.info(f"Starting Toast sales stream (interval: {interval_seconds}s)")

        while self.is_streaming:
            try:
                if self.mock_mode:
                    # Generate mock sales
                    num_sales = random.randint(1, sales_per_interval * 2)
                    for _ in range(num_sales):
                        sale = self._generate_single_mock_sale()
                        await callback(sale)
                        self.mock_sales_generated += 1
                        await asyncio.sleep(random.uniform(0.5, 2.0))  # Stagger sales
                else:
                    # Fetch real sales from last interval
                    end_time = datetime.utcnow()
                    start_time = end_time - timedelta(seconds=interval_seconds)

                    sales = await self.fetch_sales_data(start_time, end_time)
                    for sale in sales:
                        await callback(sale)

                await asyncio.sleep(interval_seconds)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in sales stream: {e}")
                await asyncio.sleep(10)  # Back off on error

        logger.info("Toast sales stream stopped")

    def start_streaming(
        self,
        callback: Callable[[Dict[str, Any]], Any],
        interval_seconds: int = 300,
    ):
        """Start streaming in background"""
        # Set the flag synchronously so is_streaming reflects the started state
        # immediately, rather than only once the scheduled coroutine first runs.
        self.is_streaming = True
        self._stream_task = asyncio.create_task(
            self.stream_sales_continuously(callback, interval_seconds)
        )
        return self._stream_task

    def stop_streaming(self):
        """Stop the streaming task"""
        self.is_streaming = False

    def get_statistics(self) -> Dict[str, Any]:
        """Get client statistics.

        `credentials_present` reports only whether the keys are set — never any
        part of their value.
        """
        return {
            "mode": "mock" if self.mock_mode else "real",
            "total_api_calls": self.total_api_calls,
            "total_sales_fetched": self.total_sales_fetched,
            "mock_sales_generated": self.mock_sales_generated,
            "is_streaming": self.is_streaming,
            "strict": self.strict,
            "credentials_present": bool(self.client_id and self.client_secret),
        }


# Convenience function to create client from settings
def create_toast_client_from_settings(settings, strict: bool = False) -> ToastAPIClient:
    """Create Toast API client from application settings.

    Two defects fixed here, both of which had to be fixed before this factory
    could have a first caller:

    1. It read `settings.toast_mock_mode` directly. `Settings` is a plain class
       (config/settings.py:13-16) that never defined that attribute, so the read
       raised AttributeError on every call. There were zero callers, which is
       why nobody hit it. The read is now via `getattr` with a
       credentials-derived default: when `toast_mock_mode` is defined the
       setting wins, and when it is not this factory still works instead of
       500ing. That deference is deliberate — it must not depend on a
       particular settings revision to avoid crashing.

    2. It never passed `base_url`, so `settings.toast_api_url` was dead config
       and every call went to the client's hardcoded constant regardless of what
       the operator had set. The setting is now wired through, which is what
       makes the host operator-controlled rather than baked in.

    `strict` callers are forced out of mock mode. Strict means "never serve
    invented data", so strict-plus-mock is a contradiction that could only ever
    produce a 503 — an operator with valid credentials would otherwise find the
    integration dead because an unrelated mock flag defaulted on.
    """
    mock_mode = getattr(
        settings,
        "toast_mock_mode",
        not (settings.toast_client_id and settings.toast_client_secret),
    )
    if strict:
        mock_mode = False

    return ToastAPIClient(
        toast_client_id=settings.toast_client_id,
        toast_client_secret=settings.toast_client_secret,
        toast_restaurant_guid=settings.toast_restaurant_guid,
        mock_mode=mock_mode,
        # UNVERIFIED which host is correct. The settings default
        # ("https://ws-api.toasttab.com", config/settings.py:152-154) and this
        # client's own constant ("https://api.toasttab.com") disagree, and that
        # cannot be settled without a live Toast call, which this work is
        # forbidden from making. Wiring the setting through is nonetheless
        # right regardless of which string wins: it makes the host something an
        # operator sets via TOAST_API_URL instead of dead config next to a
        # hardcoded constant.
        base_url=getattr(settings, "toast_api_url", None) or DEFAULT_TOAST_BASE_URL,
        strict=strict,
    )
