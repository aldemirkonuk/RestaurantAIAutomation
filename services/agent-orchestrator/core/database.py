"""
State-of-the-Art Database Client
================================
Production-grade Supabase client with:
- Repository pattern for clean architecture
- Type-safe queries with Pydantic models
- Multi-level caching (local + Redis)
- Connection resilience with retry logic
- Query optimization with batch operations
- Comprehensive observability
"""

from __future__ import annotations

from abc import ABC
from typing import Dict, List, Any, Optional, TypeVar, Generic, Type
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum

import redis.asyncio as redis
from supabase import create_client, Client
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field, ConfigDict

from utils.logger import setup_logger


def _is_upstash_host(url: str) -> bool:
    """True when the URL's host is upstash.io or a subdomain of it."""
    from urllib.parse import urlparse

    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host == "upstash.io" or host.endswith(".upstash.io")

logger = setup_logger(__name__)

T = TypeVar("T", bound=BaseModel)
ModelT = TypeVar("ModelT", bound=BaseModel)


# =============================================================================
# DOMAIN MODELS (Type-Safe Data Contracts)
# =============================================================================


class BaseEntity(BaseModel):
    """Base class for all database entities"""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
    )

    id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class InventoryItem(BaseEntity):
    """Restaurant inventory item model"""

    restaurant_id: str
    master_wine_id: str
    provider_id: Optional[str] = None

    # Stock levels
    stock_live: int = 0
    physical_stock: Optional[int] = None
    shadow_stock: int = 0
    expected_stock: int = 0
    in_transit_quantity: int = 0

    # Configuration
    threshold_min: int = 3
    validation_max: Optional[int] = None
    buffer_window_minutes: Optional[int] = None

    # State
    inventory_state: str = "LIVE"
    last_sold_at: Optional[datetime] = None
    last_restocked_at: Optional[datetime] = None
    last_alert_level: Optional[int] = None

    # Computed (from joins)
    wine_name: Optional[str] = None
    sales_velocity_7d: Optional[float] = None


class Provider(BaseEntity):
    """Wine provider model"""

    name: str
    # Legacy flat fields (backward-compatible)
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_name: Optional[str] = None
    address: Optional[Dict[str, Any]] = None
    # New JSONB structure (matches database schema)
    primary_contact: Optional[Dict[str, Any]] = (
        None  # {email, phone, whatsapp, preferred_method}
    )
    alternative_contacts: Optional[List[Dict[str, Any]]] = None

    lead_time_days: int = 7
    minimum_order_quantity: int = 12
    payment_terms: Optional[str] = None

    is_active: bool = True
    rating: Optional[float] = None
    restaurant_id: Optional[str] = None
    tier: Optional[str] = None

    @property
    def effective_email(self) -> Optional[str]:
        """Get email from primary_contact JSONB or legacy field."""
        if self.primary_contact and self.primary_contact.get("email"):
            return self.primary_contact["email"]
        return self.contact_email

    @property
    def effective_phone(self) -> Optional[str]:
        """Get phone from primary_contact JSONB or legacy field."""
        if self.primary_contact and self.primary_contact.get("phone"):
            return self.primary_contact["phone"]
        return self.contact_phone


class Contact(BaseEntity):
    """Contact directory entry - supports provider, staff, manager, customer, sommelier"""

    type: str  # 'provider', 'staff', 'manager', 'customer', 'sommelier'
    display_name: str
    restaurant_id: Optional[str] = None  # NULL = global/shared
    linked_user_id: Optional[str] = None
    linked_provider_id: Optional[str] = None
    is_active: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ContactAddress(BaseEntity):
    """Communication address for a contact (email, phone, whatsapp, etc.)"""

    contact_id: str
    channel: str  # 'email', 'phone', 'whatsapp', 'fax', 'linkedin', 'custom'
    address_value: str
    label: str = "work"  # 'work', 'personal', 'main', 'billing'
    is_primary: bool = False
    is_verified: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)
    verified_at: Optional[datetime] = None


class ProcurementOrder(BaseEntity):
    """Procurement order model"""

    restaurant_id: str
    inventory_id: str
    provider_id: str

    order_number: Optional[str] = None
    wine_name: str
    quantity: int

    target_price_per_bottle: Optional[float] = None
    negotiated_price_per_bottle: Optional[float] = None
    final_price_per_bottle: Optional[float] = None

    status: str = "DRAFT"
    urgency: str = "normal"

    negotiation_message: Optional[str] = None
    negotiation_attempt: int = 0


class SalesEvent(BaseEntity):
    """POS sales event model"""

    restaurant_id: str
    inventory_id: str

    quantity: int
    unit_price: Optional[float] = None

    pos_event_id: Optional[str] = None
    pos_event_timestamp: Optional[datetime] = None
    pos_event_type: str = "sale"


class ProcurementConversation(BaseEntity):
    """AI conversation with provider (with manager approval support)"""

    order_id: Optional[str] = None
    restaurant_id: str
    provider_id: str

    # Message details
    direction: str  # 'outbound', 'inbound'
    channel: str  # 'sms', 'email', 'whatsapp'
    message_text: str
    ai_generated: bool = False
    llm_model: Optional[str] = None

    # AI Analysis
    detected_intent: Optional[str] = None
    detected_sentiment: Optional[str] = None
    important_dates_detected: Optional[Dict[str, Any]] = None

    # Message delivery
    sent_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    delivery_status: Optional[str] = None

    # Manager approval fields (NEW for hybrid 80/20 approach)
    manager_approval_status: str = (
        "pending"  # 'pending', 'approved', 'modified', 'rejected'
    )
    manager_approved_message: Optional[str] = None
    manager_notes: Optional[str] = None
    conversation_context: Optional[Dict[str, Any]] = None
    paused_at: Optional[datetime] = None
    resumed_at: Optional[datetime] = None
    notification_sent: bool = False
    approval_channel: Optional[str] = (
        None  # 'push_notification', 'onetap_center', 'web_app'
    )
    time_to_approval_seconds: Optional[int] = None


class OrderInteraction(BaseEntity):
    """Order interaction model - Voice calls, SMS, Email, WhatsApp"""

    order_id: str

    # Interaction Details
    interaction_type: str  # 'VOICE', 'SMS', 'EMAIL', 'WHATSAPP'
    interaction_direction: str  # 'OUTBOUND', 'INBOUND'

    # Voice Call Details (for VOICE type)
    recording_url: Optional[str] = None
    transcript: Optional[str] = None
    call_duration_seconds: Optional[int] = None
    call_uuid: Optional[str] = None

    # AI Analysis
    ai_summary: Optional[str] = None
    detected_intent: Optional[str] = None
    detected_sentiment: Optional[str] = None
    important_dates_detected: Optional[Dict[str, Any]] = None

    # Barcode/Vintage Tracking (for Visual Verification)
    barcode_scanned: Optional[str] = None
    vintage_confirmed: Optional[int] = None
    vintage_mismatch_detected: bool = False
    vintage_mismatch_details: Optional[Dict[str, Any]] = None


class ManagerPreferences(BaseEntity):
    """Manager preferences model - Unified preferences"""

    manager_id: str

    # Report Preferences
    report_frequency: Optional[str] = None  # 'DAILY', 'WEEKLY', 'MONTHLY', 'NONE'
    report_delivery_time: Optional[str] = "07:00:00"
    report_timezone: str = "America/Los_Angeles"

    # Notification Channels
    notification_channels: Dict[str, bool] = Field(
        default_factory=lambda: {
            "sms": True,
            "email": True,
            "push": True,
            "voice": False,
        }
    )

    # Low Stock Alerts
    low_stock_alert_enabled: bool = True
    low_stock_alert_channels: Dict[str, bool] = Field(
        default_factory=lambda: {"sms": True, "push": True}
    )

    # Quiet Hours
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None


class UnitConversion(BaseEntity):
    """Unit conversion model - Purchase Unit → Pour Unit mapping"""

    restaurant_id: str
    inventory_id: str

    # Unit Mapping
    purchase_unit: str  # 'case', 'bottle', 'liter'
    pour_unit: str  # 'shot', 'glass', 'bottle'

    # Conversion Rates
    purchase_to_pour_ratio: float  # e.g., 1 case = 12 bottles = 144 shots
    pour_to_purchase_ratio: float  # Inverse


class RFQRequest(BaseEntity):
    """RFQ (Request for Quotation) model - Polite bidding"""

    inventory_id: str
    restaurant_id: str

    # RFQ Details
    wine_name: str
    quantity: int
    requested_delivery_date: Optional[datetime] = None

    # Vendor Responses (stored as JSONB array)
    vendor_responses: Optional[List[Dict[str, Any]]] = None

    # Selection
    selected_vendor_id: Optional[str] = None
    selected_price: Optional[float] = None
    selection_reason: Optional[str] = None

    # Status
    status: str = (
        "pending"  # 'pending', 'responses_received', 'presented', 'approved', 'cancelled'
    )
    presented_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None


class MasterWineLibrary(BaseEntity):
    """Master Wine Library model - Wine data enrichment"""

    # Wine Identification
    name: str
    producer: Optional[str] = None
    vintage: Optional[int] = None

    # Bottle specs (migrated from bottle_specifications)
    bottle_size_ml: int = 750
    weight_grams: Optional[int] = None
    closure_type: Optional[str] = None

    # Classification
    region: Optional[str] = None
    sub_region: Optional[str] = None
    country: Optional[str] = None
    grape_varieties: Optional[List[str]] = None
    wine_type: Optional[str] = None  # 'red', 'white', 'rosé', 'sparkling', 'dessert'

    # Tasting Notes
    tasting_notes: Optional[str] = None
    food_pairings: Optional[List[str]] = None

    # Pricing
    avg_retail_price: Optional[float] = None
    avg_wholesale_price: Optional[float] = None

    # Barcode Tracking
    barcode: Optional[str] = None
    barcode_vintage_mapping: Optional[Dict[str, Any]] = None

    # Enrichment Source
    data_source: Optional[str] = None  # 'vivino', 'wine-searcher', 'gemini', 'manual'
    enrichment_date: Optional[datetime] = None


# =============================================================================
# CACHING INFRASTRUCTURE
# =============================================================================


class CacheStrategy(Enum):
    """Cache invalidation strategies"""

    WRITE_THROUGH = "write_through"  # Update cache on write
    WRITE_BEHIND = "write_behind"  # Async cache update
    CACHE_ASIDE = "cache_aside"  # Application manages cache


@dataclass
class CacheConfig:
    """Cache configuration"""

    ttl_seconds: int = 300
    max_size: int = 1000
    strategy: CacheStrategy = CacheStrategy.CACHE_ASIDE


@dataclass
class CacheEntry(Generic[T]):
    """Cached value with metadata"""

    value: T
    cached_at: datetime
    ttl_seconds: int
    hit_count: int = 0

    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() - self.cached_at > timedelta(seconds=self.ttl_seconds)


class LocalCache(Generic[T]):
    """High-performance local LRU cache"""

    def __init__(self, config: Optional[CacheConfig] = None):
        self.config = config or CacheConfig()
        self._cache: Dict[str, CacheEntry[T]] = {}
        self._access_order: List[str] = []

        # Metrics
        self.hits: int = 0
        self.misses: int = 0

    def get(self, key: str) -> Optional[T]:
        """Get cached value"""
        entry = self._cache.get(key)

        if entry is None:
            self.misses += 1
            return None

        if entry.is_expired:
            self._cache.pop(key, None)
            self.misses += 1
            return None

        # Update access order (LRU)
        entry.hit_count += 1
        if key in self._access_order:
            self._access_order.remove(key)
        self._access_order.append(key)

        self.hits += 1
        return entry.value

    def set(self, key: str, value: T, ttl_seconds: Optional[int] = None) -> None:
        """Cache a value"""
        # Evict if at capacity
        while len(self._cache) >= self.config.max_size:
            if self._access_order:
                oldest_key = self._access_order.pop(0)
                self._cache.pop(oldest_key, None)

        self._cache[key] = CacheEntry(
            value=value,
            cached_at=datetime.utcnow(),
            ttl_seconds=ttl_seconds or self.config.ttl_seconds,
        )

        if key not in self._access_order:
            self._access_order.append(key)

    def invalidate(self, key: str) -> None:
        """Invalidate specific key"""
        self._cache.pop(key, None)
        if key in self._access_order:
            self._access_order.remove(key)

    def invalidate_pattern(self, pattern: str) -> int:
        """Invalidate keys matching pattern"""
        keys_to_remove = [k for k in self._cache.keys() if pattern in k]
        for key in keys_to_remove:
            self.invalidate(key)
        return len(keys_to_remove)

    def clear(self) -> None:
        """Clear all cache"""
        self._cache.clear()
        self._access_order.clear()

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def stats(self) -> Dict[str, Any]:
        return {
            "size": len(self._cache),
            "max_size": self.config.max_size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": f"{self.hit_rate:.2%}",
        }


class DistributedCache:
    """Redis-backed distributed cache"""

    def __init__(self, redis_client: redis.Redis, prefix: str = "wineops"):
        self.redis = redis_client
        self.prefix = prefix

    def _key(self, key: str) -> str:
        return f"{self.prefix}:{key}"

    async def get(self, key: str, model: Type[T]) -> Optional[T]:
        """Get and deserialize cached value"""
        try:
            data = await self.redis.get(self._key(key))
            if data:
                return model.model_validate_json(data)
            return None
        except Exception as e:
            logger.debug(f"Redis get failed: {e}")
            return None

    async def set(
        self,
        key: str,
        value: BaseModel,
        ttl_seconds: int = 300,
    ) -> bool:
        """Serialize and cache value"""
        try:
            await self.redis.setex(
                self._key(key),
                ttl_seconds,
                value.model_dump_json(),
            )
            return True
        except Exception as e:
            logger.debug(f"Redis set failed: {e}")
            return False

    async def invalidate(self, key: str) -> bool:
        """Invalidate key"""
        try:
            await self.redis.delete(self._key(key))
            return True
        except Exception:
            return False

    async def invalidate_pattern(self, pattern: str) -> int:
        """Invalidate keys matching pattern"""
        try:
            keys = await self.redis.keys(f"{self.prefix}:{pattern}*")
            if keys:
                return await self.redis.delete(*keys)
            return 0
        except Exception:
            return 0


# =============================================================================
# REPOSITORY PATTERN
# =============================================================================


class BaseRepository(ABC, Generic[ModelT]):
    """
    Abstract repository implementing data access patterns

    Benefits:
    - Decouples business logic from data access
    - Enables easy testing with mocks
    - Centralizes caching and query optimization
    """

    def __init__(
        self,
        supabase: Client,
        table_name: str,
        model: Type[ModelT],
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        self.supabase = supabase
        self.table_name = table_name
        self.model = model
        self.local_cache = local_cache or LocalCache(CacheConfig(ttl_seconds=300))
        self.distributed_cache = distributed_cache

        # Metrics
        self.queries_executed: int = 0
        self.cache_hits: int = 0

    def _cache_key(self, *parts: str) -> str:
        """Generate cache key"""
        return f"{self.table_name}:{':'.join(parts)}"

    async def get_by_id(
        self,
        id: str,
        use_cache: bool = True,
    ) -> Optional[ModelT]:
        """Get entity by ID with multi-level caching"""
        # A missing id is a legitimate "not found", not a crash. Without this,
        # `_cache_key` raises TypeError joining None, and the traceback names the
        # cache layer rather than the caller that had no id — which is how a
        # missing provider on an inventory row presented as a caching bug.
        # Every caller already handles a None return.
        if not id:
            return None
        cache_key = self._cache_key("id", id)

        # L1: Local cache
        if use_cache:
            cached = self.local_cache.get(cache_key)
            if cached:
                self.cache_hits += 1
                return cached

        # L2: Distributed cache
        if use_cache and self.distributed_cache:
            cached = await self.distributed_cache.get(cache_key, self.model)
            if cached:
                self.local_cache.set(cache_key, cached)
                self.cache_hits += 1
                return cached

        # L3: Database
        self.queries_executed += 1

        try:
            response = (
                self.supabase.table(self.table_name)
                .select("*")
                .eq("id", id)
                .single()
                .execute()
            )

            if response.data:
                entity = self.model.model_validate(response.data)

                # Populate caches
                if use_cache:
                    self.local_cache.set(cache_key, entity)
                    if self.distributed_cache:
                        await self.distributed_cache.set(cache_key, entity)

                return entity

            return None

        except APIError as e:
            logger.error(f"Database error in {self.table_name}.get_by_id: {e}")
            return None

    async def find_many(
        self,
        filters: Dict[str, Any],
        limit: int = 100,
        offset: int = 0,
        order_by: Optional[str] = None,
        order_desc: bool = False,
    ) -> List[ModelT]:
        """Query multiple entities with filters"""
        self.queries_executed += 1

        try:
            query = self.supabase.table(self.table_name).select("*")

            # Apply filters
            for key, value in filters.items():
                if isinstance(value, list):
                    query = query.in_(key, value)
                elif value is None:
                    query = query.is_(key, "null")
                else:
                    query = query.eq(key, value)

            # Ordering
            if order_by:
                query = query.order(order_by, desc=order_desc)

            # Pagination
            query = query.range(offset, offset + limit - 1)

            response = query.execute()

            if response.data:
                return [self.model.model_validate(item) for item in response.data]

            return []

        except APIError as e:
            logger.error(f"Database error in {self.table_name}.find_many: {e}")
            return []

    async def create(self, entity: ModelT) -> Optional[ModelT]:
        """Create new entity"""
        self.queries_executed += 1

        try:
            data = entity.model_dump(
                exclude_unset=True, exclude={"id", "created_at", "updated_at"}
            )

            response = self.supabase.table(self.table_name).insert(data).execute()

            if response.data:
                created = self.model.model_validate(response.data[0])

                # Invalidate related caches
                await self._invalidate_related_caches(created)

                return created

            return None

        except APIError as e:
            logger.error(f"Database error in {self.table_name}.create: {e}")
            return None

    async def update(
        self,
        id: str,
        updates: Dict[str, Any],
    ) -> Optional[ModelT]:
        """Update entity by ID"""
        self.queries_executed += 1

        try:
            updates["updated_at"] = datetime.utcnow().isoformat()

            response = (
                self.supabase.table(self.table_name)
                .update(updates)
                .eq("id", id)
                .execute()
            )

            if response.data:
                updated = self.model.model_validate(response.data[0])

                # Invalidate caches
                self.local_cache.invalidate(self._cache_key("id", id))
                if self.distributed_cache:
                    await self.distributed_cache.invalidate(self._cache_key("id", id))

                await self._invalidate_related_caches(updated)

                return updated

            return None

        except APIError as e:
            logger.error(f"Database error in {self.table_name}.update: {e}")
            return None

    async def delete(self, id: str, soft: bool = True) -> bool:
        """Delete entity (soft delete by default)"""
        self.queries_executed += 1

        try:
            if soft:
                self.supabase.table(self.table_name).update(
                    {"deleted_at": datetime.utcnow().isoformat()}
                ).eq("id", id).execute()
            else:
                self.supabase.table(self.table_name).delete().eq("id", id).execute()

            # Invalidate caches
            self.local_cache.invalidate(self._cache_key("id", id))
            if self.distributed_cache:
                await self.distributed_cache.invalidate(self._cache_key("id", id))

            return True

        except APIError as e:
            logger.error(f"Database error in {self.table_name}.delete: {e}")
            return False

    async def batch_create(self, entities: List[ModelT]) -> List[ModelT]:
        """Batch insert for high throughput"""
        if not entities:
            return []

        self.queries_executed += 1

        try:
            data = [
                e.model_dump(
                    exclude_unset=True, exclude={"id", "created_at", "updated_at"}
                )
                for e in entities
            ]

            response = self.supabase.table(self.table_name).insert(data).execute()

            if response.data:
                return [self.model.model_validate(item) for item in response.data]

            return []

        except APIError as e:
            logger.error(f"Database error in {self.table_name}.batch_create: {e}")
            return []

    async def _invalidate_related_caches(self, entity: ModelT) -> None:
        """Override in subclass to invalidate related caches"""
        pass

    def stats(self) -> Dict[str, Any]:
        return {
            "table": self.table_name,
            "queries_executed": self.queries_executed,
            "cache_hits": self.cache_hits,
            "local_cache": self.local_cache.stats(),
        }


# =============================================================================
# SPECIALIZED REPOSITORIES
# =============================================================================


class InventoryRepository(BaseRepository[InventoryItem]):
    """Specialized repository for inventory operations"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "restaurant_inventory",
            InventoryItem,
            local_cache,
            distributed_cache,
        )

    async def get_by_restaurant(
        self,
        restaurant_id: str,
        include_out_of_stock: bool = True,
    ) -> List[InventoryItem]:
        """Get all inventory for a restaurant"""
        filters = {"restaurant_id": restaurant_id}

        if not include_out_of_stock:
            # This would need a different query approach
            pass

        return await self.find_many(
            filters,
            limit=500,
            order_by="wine_name",
        )

    async def find_wine_by_name_similarity(
        self,
        wine_name: str,
        restaurant_id: str,
        *,
        min_score: float = 0.62,
    ) -> Optional[Dict[str, Any]]:
        """Resolve a POS item name to an inventory row.

        `POSIntegrationAgent.match_wine_to_library` has always called this method
        and it was never implemented, so every wine sale raised AttributeError,
        the sale event went out with no `inventory_id`, and BufferManager dropped
        it with "Sale event missing inventory_id". That is one of the reasons the
        POS-to-stock path never moved a bottle.

        The matching problem is real: a POS button reads "MASSOLINO BARBERA
        D'ALBA (Glass)" while inventory holds wine_name "BARBERA D'ALBA" with
        producer "MASSOLINO" — the strings are never equal.

        Deliberately conservative. A wrong match silently decrements the wrong
        wine and nobody notices for months, which is far worse than not matching
        at all: an unmatched sale is visible in the logs, a mismatched one is
        invisible everywhere. So below `min_score` this returns None rather than
        the best of a bad set, and exact matches always win over fuzzy ones.

        The durable fix is `pos_item_mappings` (the NestJS hub already resolves
        that way); this is the fallback for items nobody has mapped yet.
        """
        import difflib
        import re as _re

        def normalise(text: str) -> str:
            text = (text or "").lower()
            # Serving-format suffixes are how the same wine appears twice on a POS.
            text = _re.sub(r"\((glass|btl|bottle|carafe|pour)\)", " ", text)
            text = _re.sub(r"[^a-z0-9\s]", " ", text)
            return _re.sub(r"\s+", " ", text).strip()

        target = normalise(wine_name)
        if not target:
            return None

        items = await self.get_by_restaurant(restaurant_id)
        if not items:
            return None

        target_tokens = set(target.split())
        best: Optional[Dict[str, Any]] = None
        best_score = 0.0

        for item in items:
            raw = item.model_dump() if hasattr(item, "model_dump") else dict(item)
            name = normalise(str(raw.get("wine_name") or ""))
            producer = normalise(str(raw.get("producer") or ""))
            if not name:
                continue

            combined = f"{producer} {name}".strip()

            # Exact on either form ends the search — nothing fuzzy can beat it.
            if target in (name, combined):
                return raw

            ratio = max(
                difflib.SequenceMatcher(None, target, name).ratio(),
                difflib.SequenceMatcher(None, target, combined).ratio(),
            )
            # Token containment catches "massolino barbera d alba glass" against
            # "barbera d alba", where raw ratio is dragged down by the extra words.
            tokens = set(combined.split())
            overlap = len(target_tokens & tokens) / len(tokens) if tokens else 0.0
            score = max(ratio, overlap)

            if score > best_score:
                best_score, best = score, raw

        if best_score < min_score:
            logger.debug(
                "No inventory match for %r (best score %.2f < %.2f)",
                wine_name,
                best_score,
                min_score,
            )
            return None
        return best

    async def get_low_stock(
        self,
        restaurant_id: str,
    ) -> List[InventoryItem]:
        """
        Get items below their reorder threshold.

        OD-99: this used to make two queries before the one that worked, and
        both were dead.

        The first passed a *query builder object* as the value of
        `.lt("stock_live", ...)` -- PostgREST cannot compare two columns that
        way, so it received a stringified builder -- and then discarded its own
        result by reassigning `response` on the very next statement. The second
        called an RPC named `get_low_stock_items`, for which no CREATE FUNCTION
        exists anywhere in this repository and which production does not have
        (PGRST202, verified 2026-08-26). It raised `APIError` on every call.

        So the `except APIError` fallback below was never a fallback: it was
        the implementation, and the only code here that has ever returned a
        row. It is now simply the body. Same results, two fewer round trips,
        and no exception on the happy path.
        """
        self.queries_executed += 1

        all_items = await self.get_by_restaurant(restaurant_id)
        return [item for item in all_items if item.stock_live < item.threshold_min]

    async def update_stock(
        self,
        inventory_id: str,
        new_stock: int,
        reason: str = "automated",
        max_retries: int = 3,
    ) -> Optional[InventoryItem]:
        """Set live stock via the apply_stock_movement RPC (Phase 2 write cutover).

        stock_live is now a PROJECTION of inventory_lots — a direct write would desync from the
        lots and get clobbered by the projection trigger. Read the current projection, compute the
        signed delta, and apply it through the RPC (delta-based, row-locked via FOR UPDATE,
        idempotent, negative-guarded, ledger-writing). This replaces the old optimistic-lock CAS +
        retry-then-drop, which the SOTA audit flagged as a lost-update / dropped-write risk.
        `max_retries` is retained only for call-site signature compatibility.
        """
        current = (
            self.supabase.table(self.table_name)
            .select("id, stock_live")
            .eq("id", inventory_id)
            .single()
            .execute()
        ).data

        if not current:
            logger.warning(f"update_stock: inventory_id {inventory_id} not found")
            return None

        delta = int(new_stock) - int(current.get("stock_live") or 0)
        if delta != 0:
            try:
                self.supabase.rpc(
                    "apply_stock_movement",
                    {
                        "p_inventory_id": inventory_id,
                        "p_stock_state": "live",
                        "p_delta": delta,
                        "p_transaction_type": "purchase" if delta > 0 else "adjustment",
                        "p_source": "system",
                        "p_reason": reason,
                    },
                ).execute()
            except Exception as e:
                logger.error(
                    f"update_stock: apply_stock_movement failed for {inventory_id}: {e}"
                )
                return None

        updated = (
            self.supabase.table(self.table_name)
            .select("*")
            .eq("id", inventory_id)
            .single()
            .execute()
        ).data
        if updated:
            try:
                return InventoryItem.model_validate(updated)
            except Exception:
                return updated
        return None

    async def _log_stock_change(
        self,
        inventory_id: str,
        new_stock: int,
        reason: str,
    ) -> None:
        """Async audit logging"""
        try:
            await self.supabase.table("system_audit_log").insert(
                {
                    "actor_type": "agent",
                    "actor_id": "inventory_engine",
                    "action": "stock_updated",
                    "entity_type": "inventory",
                    "entity_id": inventory_id,
                    "changes": {"stock_live": new_stock, "reason": reason},
                }
            ).execute()
        except Exception as e:
            logger.warning(f"Audit log failed: {e}")

    async def _invalidate_related_caches(self, entity: InventoryItem) -> None:
        """Invalidate restaurant-level caches"""
        self.local_cache.invalidate_pattern(f"restaurant:{entity.restaurant_id}")


class ProviderRepository(BaseRepository[Provider]):
    """Specialized repository for provider operations"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "providers",
            Provider,
            LocalCache(CacheConfig(ttl_seconds=600)),  # Longer TTL for providers
            distributed_cache,
        )

    async def get_active_providers(self) -> List[Provider]:
        """Get all active providers"""
        return await self.find_many(
            {"is_active": True},
            order_by="name",
        )


class ContactRepository:
    """Repository for contacts and contact_addresses tables."""

    def __init__(self, supabase_client):
        self.client = supabase_client
        self.table = "contacts"
        self.addresses_table = "contact_addresses"

    async def get_by_id(self, contact_id: str) -> Optional[Dict[str, Any]]:
        """Get contact with addresses by ID."""
        try:
            resp = (
                self.client.table(self.table)
                .select("*")
                .eq("id", contact_id)
                .single()
                .execute()
            )
            if resp.data:
                # Also fetch addresses
                addr_resp = (
                    self.client.table(self.addresses_table)
                    .select("*")
                    .eq("contact_id", contact_id)
                    .execute()
                )
                resp.data["addresses"] = addr_resp.data or []
            return resp.data
        except Exception:
            return None

    async def search_by_name(
        self, name: str, restaurant_id: Optional[str] = None, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Trigram search by display_name."""
        try:
            query = (
                self.client.table(self.table)
                .select("*")
                .ilike("display_name", f"%{name}%")
                .eq("is_active", True)
                .limit(limit)
            )
            if restaurant_id:
                query = query.eq("restaurant_id", restaurant_id)
            resp = query.execute()
            return resp.data or []
        except Exception:
            return []

    async def find_by_channel(self, channel: str, value: str) -> List[Dict[str, Any]]:
        """Find contacts by a specific address (e.g., email or phone)."""
        try:
            resp = (
                self.client.table(self.addresses_table)
                .select("contact_id, channel, address_value")
                .eq("channel", channel)
                .eq("address_value", value)
                .execute()
            )
            if not resp.data:
                return []
            contact_ids = list(set(a["contact_id"] for a in resp.data))
            contacts_resp = (
                self.client.table(self.table)
                .select("*")
                .in_("id", contact_ids)
                .execute()
            )
            return contacts_resp.data or []
        except Exception:
            return []

    async def get_for_restaurant(
        self,
        restaurant_id: str,
        contact_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Get all contacts for a restaurant, optionally filtered by type."""
        try:
            query = (
                self.client.table(self.table)
                .select("*")
                .eq("restaurant_id", restaurant_id)
                .eq("is_active", True)
                .range(offset, offset + limit - 1)
            )
            if contact_type:
                query = query.eq("type", contact_type)
            resp = query.order("display_name").execute()
            return resp.data or []
        except Exception:
            return []

    async def get_provider_contacts(self, provider_id: str) -> List[Dict[str, Any]]:
        """Get contacts linked to a specific provider."""
        try:
            resp = (
                self.client.table(self.table)
                .select("*")
                .eq("linked_provider_id", provider_id)
                .eq("is_active", True)
                .execute()
            )
            contacts = resp.data or []
            # Fetch addresses for each
            for contact in contacts:
                addr_resp = (
                    self.client.table(self.addresses_table)
                    .select("*")
                    .eq("contact_id", contact["id"])
                    .execute()
                )
                contact["addresses"] = addr_resp.data or []
            return contacts
        except Exception:
            return []

    async def create(
        self,
        contact_data: Dict[str, Any],
        addresses: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a contact with optional addresses."""
        try:
            resp = self.client.table(self.table).insert(contact_data).execute()
            if not resp.data:
                return None
            contact = resp.data[0]

            if addresses:
                for addr in addresses:
                    addr["contact_id"] = contact["id"]
                self.client.table(self.addresses_table).insert(addresses).execute()

            return contact
        except Exception as e:
            logger.error(f"Failed to create contact: {e}")
            return None

    async def update(
        self, contact_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update a contact."""
        try:
            resp = (
                self.client.table(self.table)
                .update(data)
                .eq("id", contact_id)
                .execute()
            )
            return resp.data[0] if resp.data else None
        except Exception:
            return None

    async def add_address(
        self, contact_id: str, address_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Add an address to a contact."""
        try:
            address_data["contact_id"] = contact_id
            resp = (
                self.client.table(self.addresses_table).insert(address_data).execute()
            )
            return resp.data[0] if resp.data else None
        except Exception:
            return None

    async def bulk_create(self, contacts: List[Dict[str, Any]]) -> int:
        """Bulk create contacts. Returns count of created contacts."""
        try:
            resp = self.client.table(self.table).insert(contacts).execute()
            return len(resp.data) if resp.data else 0
        except Exception:
            return 0


class ProcurementRepository(BaseRepository[ProcurementOrder]):
    """Specialized repository for procurement operations"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "procurement_orders",
            ProcurementOrder,
            local_cache,
            distributed_cache,
        )

    async def get_active_orders(self, restaurant_id: str) -> List[ProcurementOrder]:
        """Get orders that are in progress"""
        return await self.find_many(
            {
                "restaurant_id": restaurant_id,
                "status": [
                    "DRAFT",
                    "NEGOTIATING",
                    "PENDING_APPROVAL",
                    "APPROVED",
                    "IN_TRANSIT",
                ],
            },
            order_by="created_at",
            order_desc=True,
        )

    async def generate_order_number(self) -> str:
        """Generate unique order number"""
        today = datetime.utcnow().date().isoformat().replace("-", "")

        self.queries_executed += 1

        response = (
            self.supabase.table("procurement_orders")
            .select("id", count="exact")
            .gte("created_at", f"{datetime.utcnow().date()}T00:00:00")
            .execute()
        )

        count = response.count if hasattr(response, "count") and response.count else 0
        return f"ORD-{today}-{count + 1:04d}"


class SalesEventRepository(BaseRepository[SalesEvent]):
    """Specialized repository for sales events - optimized for high volume"""

    def __init__(
        self,
        supabase: Client,
    ):
        # No caching for high-volume writes
        super().__init__(
            supabase,
            "sales_events",
            SalesEvent,
            local_cache=None,
            distributed_cache=None,
        )

    async def batch_insert(self, events: List[SalesEvent]) -> int:
        """Optimized batch insert for POS events"""
        if not events:
            return 0

        created = await self.batch_create(events)
        logger.info(f"Batch inserted {len(created)} sales events")
        return len(created)


class OrderInteractionRepository(BaseRepository[OrderInteraction]):
    """Repository for order interactions (voice calls, SMS, email, WhatsApp)"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "order_interactions",
            OrderInteraction,
            local_cache,
            distributed_cache,
        )

    async def get_by_order(self, order_id: str) -> List[OrderInteraction]:
        """Get all interactions for an order"""
        return await self.find_many(
            {"order_id": order_id},
            order_by="created_at",
            order_desc=True,
        )

    async def get_voice_calls(self, order_id: str) -> List[OrderInteraction]:
        """Get only voice call interactions for an order"""
        return await self.find_many(
            {"order_id": order_id, "interaction_type": "VOICE"},
            order_by="created_at",
            order_desc=True,
        )

    async def create_voice_interaction(
        self,
        order_id: str,
        call_uuid: str,
        direction: str = "OUTBOUND",
        recording_url: Optional[str] = None,
        transcript: Optional[str] = None,
        ai_summary: Optional[str] = None,
    ) -> Optional[OrderInteraction]:
        """Create a voice call interaction record"""
        interaction = OrderInteraction(
            order_id=order_id,
            interaction_type="VOICE",
            interaction_direction=direction,
            call_uuid=call_uuid,
            recording_url=recording_url,
            transcript=transcript,
            ai_summary=ai_summary,
        )
        return await self.create(interaction)


class ManagerPreferencesRepository(BaseRepository[ManagerPreferences]):
    """Repository for manager preferences"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "manager_preferences",
            ManagerPreferences,
            LocalCache(CacheConfig(ttl_seconds=600)),  # Longer TTL for preferences
            distributed_cache,
        )

    async def get_by_manager(self, manager_id: str) -> Optional[ManagerPreferences]:
        """Get preferences for a specific manager"""
        results = await self.find_many({"manager_id": manager_id}, limit=1)
        return results[0] if results else None

    async def upsert_preferences(
        self, manager_id: str, preferences: Dict[str, Any]
    ) -> Optional[ManagerPreferences]:
        """Create or update manager preferences"""
        existing = await self.get_by_manager(manager_id)

        if existing:
            return await self.update(existing.id, preferences)
        else:
            prefs = ManagerPreferences(manager_id=manager_id, **preferences)
            return await self.create(prefs)

    async def is_quiet_hours(self, manager_id: str) -> bool:
        """Check if current time is within quiet hours"""
        prefs = await self.get_by_manager(manager_id)
        if not prefs or not prefs.quiet_hours_start or not prefs.quiet_hours_end:
            return False

        from datetime import datetime
        import pytz

        tz = pytz.timezone(prefs.report_timezone)
        now = datetime.now(tz).time()

        start = datetime.strptime(prefs.quiet_hours_start, "%H:%M:%S").time()
        end = datetime.strptime(prefs.quiet_hours_end, "%H:%M:%S").time()

        if start <= end:
            return start <= now <= end
        else:  # Spans midnight
            return now >= start or now <= end


class UnitConversionRepository(BaseRepository[UnitConversion]):
    """Repository for unit conversions"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "unit_conversions",
            UnitConversion,
            LocalCache(CacheConfig(ttl_seconds=3600)),  # Long TTL for conversions
            distributed_cache,
        )

    async def get_for_inventory(
        self, restaurant_id: str, inventory_id: str
    ) -> List[UnitConversion]:
        """Get all unit conversions for an inventory item"""
        return await self.find_many(
            {
                "restaurant_id": restaurant_id,
                "inventory_id": inventory_id,
            }
        )

    async def convert_units(
        self,
        restaurant_id: str,
        inventory_id: str,
        quantity: float,
        from_unit: str,
        to_unit: str,
    ) -> Optional[float]:
        """Convert quantity from one unit to another"""
        conversions = await self.get_for_inventory(restaurant_id, inventory_id)

        for conv in conversions:
            if conv.purchase_unit == from_unit and conv.pour_unit == to_unit:
                return quantity * conv.purchase_to_pour_ratio
            elif conv.pour_unit == from_unit and conv.purchase_unit == to_unit:
                return quantity * conv.pour_to_purchase_ratio

        return None  # No conversion found


class RFQRepository(BaseRepository[RFQRequest]):
    """Repository for RFQ (Request for Quotation) requests"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "rfq_requests",
            RFQRequest,
            local_cache,
            distributed_cache,
        )

    async def get_pending_rfqs(self, restaurant_id: str) -> List[RFQRequest]:
        """Get all pending RFQ requests for a restaurant"""
        return await self.find_many(
            {"restaurant_id": restaurant_id, "status": "pending"},
            order_by="created_at",
            order_desc=True,
        )

    async def get_by_inventory(self, inventory_id: str) -> List[RFQRequest]:
        """Get all RFQ requests for an inventory item"""
        return await self.find_many(
            {"inventory_id": inventory_id},
            order_by="created_at",
            order_desc=True,
        )

    async def add_vendor_response(
        self,
        rfq_id: str,
        vendor_id: str,
        price: float,
        availability: str,
        delivery_date: Optional[str] = None,
    ) -> Optional[RFQRequest]:
        """Add a vendor response to an RFQ"""
        rfq = await self.get_by_id(rfq_id)
        if not rfq:
            return None

        response = {
            "vendor_id": vendor_id,
            "price": price,
            "availability": availability,
            "delivery_date": delivery_date,
            "received_at": datetime.utcnow().isoformat(),
        }

        responses = rfq.vendor_responses or []
        responses.append(response)

        return await self.update(
            rfq_id,
            {
                "vendor_responses": responses,
                "status": "responses_received" if len(responses) >= 1 else rfq.status,
            },
        )

    async def select_winner(
        self, rfq_id: str, vendor_id: str, price: float, reason: str
    ) -> Optional[RFQRequest]:
        """Select a winning vendor for an RFQ"""
        return await self.update(
            rfq_id,
            {
                "selected_vendor_id": vendor_id,
                "selected_price": price,
                "selection_reason": reason,
                "status": "presented",
                "presented_at": datetime.utcnow().isoformat(),
            },
        )


class MasterWineLibraryRepository(BaseRepository[MasterWineLibrary]):
    """Repository for Master Wine Library"""

    def __init__(
        self,
        supabase: Client,
        local_cache: Optional[LocalCache] = None,
        distributed_cache: Optional[DistributedCache] = None,
    ):
        super().__init__(
            supabase,
            "master_wine_library",
            MasterWineLibrary,
            LocalCache(CacheConfig(ttl_seconds=3600)),  # Long TTL for wine data
            distributed_cache,
        )

    async def search_by_name(
        self, name: str, limit: int = 10
    ) -> List[MasterWineLibrary]:
        """Search wines by name (fuzzy match)"""
        self.queries_executed += 1

        try:
            response = (
                self.supabase.table(self.table_name)
                .select("*")
                .ilike("name", f"%{name}%")
                .limit(limit)
                .execute()
            )

            if response.data:
                return [self.model.model_validate(item) for item in response.data]
            return []
        except APIError as e:
            logger.error(f"Search error: {e}")
            return []

    async def get_by_barcode(self, barcode: str) -> Optional[MasterWineLibrary]:
        """Get wine by barcode"""
        results = await self.find_many({"barcode": barcode}, limit=1)
        return results[0] if results else None

    async def enrich_wine(
        self, wine_id: str, enrichment_data: Dict[str, Any], source: str
    ) -> Optional[MasterWineLibrary]:
        """Enrich wine data from external source"""
        enrichment_data["data_source"] = source
        enrichment_data["enrichment_date"] = datetime.utcnow().isoformat()
        return await self.update(wine_id, enrichment_data)

    async def get_wines_for_event(
        self, event_type: str, limit: int = 10
    ) -> List[MasterWineLibrary]:
        """Get wines suitable for a specific event type"""
        # Event type to wine type mapping
        event_wine_mapping = {
            "valentines": ["sparkling", "rosé", "red"],
            "christmas": ["red", "sparkling"],
            "new_years": ["sparkling"],
            "summer_party": ["white", "rosé", "sparkling"],
            "seafood_dinner": ["white", "sparkling"],
            "steak_dinner": ["red"],
        }

        wine_types = event_wine_mapping.get(event_type.lower(), ["red", "white"])

        self.queries_executed += 1

        try:
            response = (
                self.supabase.table(self.table_name)
                .select("*")
                .in_("wine_type", wine_types)
                .limit(limit)
                .execute()
            )

            if response.data:
                return [self.model.model_validate(item) for item in response.data]
            return []
        except APIError as e:
            logger.error(f"Event wine query error: {e}")
            return []


# =============================================================================
# DATABASE CLIENT (Facade)
# =============================================================================


class DatabaseClient:
    """
    Production-grade database client facade

    Features:
    ✅ Repository pattern for clean architecture
    ✅ Multi-level caching (local + Redis)
    ✅ Type-safe queries with Pydantic
    ✅ Connection resilience
    ✅ Comprehensive observability
    """

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        redis_url: str,
    ):
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        # Upstash Redis requires TLS — normalise redis:// → rediss://
        #
        # Compare the parsed hostname rather than testing `"upstash.io" in
        # redis_url`: the substring also matches hosts like
        # `upstash.io.example.com`, which are not Upstash. Mirrors
        # isUpstashHost() in apps/api-gateway/src/common/cache/cache.service.ts.
        if redis_url and redis_url.startswith("redis://") and _is_upstash_host(redis_url):
            redis_url = "rediss://" + redis_url[len("redis://") :]
        self.redis_url = redis_url

        # Clients
        self.supabase: Optional[Client] = None
        self.redis: Optional[redis.Redis] = None
        self.distributed_cache: Optional[DistributedCache] = None

        # Repositories (initialized on connect)
        self.inventory: Optional[InventoryRepository] = None
        self.providers: Optional[ProviderRepository] = None
        self.procurement: Optional[ProcurementRepository] = None
        self.sales_events: Optional[SalesEventRepository] = None

        # New repositories (Phase 2)
        self.order_interactions: Optional[OrderInteractionRepository] = None
        self.manager_preferences: Optional[ManagerPreferencesRepository] = None
        self.unit_conversions: Optional[UnitConversionRepository] = None
        self.rfq_requests: Optional[RFQRepository] = None
        self.wine_library: Optional[MasterWineLibraryRepository] = None
        self.contacts: Optional[ContactRepository] = None

    async def connect(self) -> None:
        """Initialize all connections and repositories"""
        logger.info("🔌 Initializing database connections...")

        try:
            # Supabase client
            self.supabase = create_client(self.supabase_url, self.supabase_key)
            logger.info("✅ Supabase client initialized")

            # Redis (optional)
            try:
                self.redis = await redis.from_url(
                    self.redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    max_connections=20,
                    socket_timeout=5.0,
                    socket_connect_timeout=5.0,
                )
                await self.redis.ping()
                self.distributed_cache = DistributedCache(self.redis)
                logger.info("✅ Redis connected")
            except Exception as e:
                logger.warning(f"⚠️ Redis unavailable (using local cache only): {e}")
                self.redis = None
                self.distributed_cache = None

            # Initialize repositories
            self.inventory = InventoryRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.providers = ProviderRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.procurement = ProcurementRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.sales_events = SalesEventRepository(self.supabase)

            # Initialize new repositories (Phase 2)
            self.order_interactions = OrderInteractionRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.manager_preferences = ManagerPreferencesRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.unit_conversions = UnitConversionRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.rfq_requests = RFQRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.wine_library = MasterWineLibraryRepository(
                self.supabase,
                distributed_cache=self.distributed_cache,
            )
            self.contacts = ContactRepository(self.supabase)

            logger.info("✅ All repositories initialized (including Phase 2)")

        except Exception as e:
            logger.error(f"❌ Database initialization failed: {e}")
            raise

    async def disconnect(self) -> None:
        """Close all connections"""
        try:
            if self.redis:
                await self.redis.close()
                logger.info("✅ Redis disconnected")
        except Exception as e:
            logger.error(f"Error disconnecting: {e}")

    # =========================================================================
    # LEGACY COMPATIBILITY METHODS
    # =========================================================================

    async def get_inventory_item(
        self,
        inventory_id: str,
        use_cache: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """Legacy method - use self.inventory.get_by_id instead"""
        item = await self.inventory.get_by_id(inventory_id, use_cache)
        return item.model_dump() if item else None

    async def update_inventory_stock(
        self,
        inventory_id: str,
        new_stock: int,
        update_reason: str = "automated",
    ) -> bool:
        """Legacy method - use self.inventory.update_stock instead"""
        result = await self.inventory.update_stock(
            inventory_id, new_stock, update_reason
        )
        return result is not None

    async def get_low_stock_items(
        self,
        restaurant_id: str,
        include_in_transit: bool = False,
    ) -> List[Dict[str, Any]]:
        """Legacy method - use self.inventory.get_low_stock instead"""
        items = await self.inventory.get_low_stock(restaurant_id)
        return [item.model_dump() for item in items]

    async def get_provider(
        self,
        provider_id: str,
        use_cache: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """Legacy method - use self.providers.get_by_id instead"""
        provider = await self.providers.get_by_id(provider_id, use_cache)
        return provider.model_dump() if provider else None

    async def create_procurement_order(
        self,
        order_data: Dict[str, Any],
    ) -> Optional[str]:
        """Legacy method - use self.procurement.create instead"""
        if "order_number" not in order_data:
            order_data["order_number"] = await self.procurement.generate_order_number()

        order = ProcurementOrder.model_validate(order_data)
        created = await self.procurement.create(order)
        return created.id if created else None

    async def insert_sales_event(self, sales_data: Dict[str, Any]) -> bool:
        """Legacy method"""
        event = SalesEvent.model_validate(sales_data)
        created = await self.sales_events.create(event)
        return created is not None

    async def batch_insert_sales_events(
        self,
        sales_events: List[Dict[str, Any]],
    ) -> int:
        """Legacy method"""
        events = [SalesEvent.model_validate(e) for e in sales_events]
        return await self.sales_events.batch_insert(events)

    # =========================================================================
    # CONVERSATION METHODS (AI Approval Workflow)
    # =========================================================================

    async def create_conversation(
        self, conversation_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Create a new AI conversation with manager approval tracking"""
        try:
            response = (
                self.supabase.table("procurement_conversations")
                .insert(conversation_data)
                .execute()
            )

            if response.data and len(response.data) > 0:
                conversation = response.data[0]
                logger.info(f"Created conversation {conversation.get('id')}")
                return conversation

            return None
        except Exception as e:
            logger.error(f"Failed to create conversation: {e}")
            return None

    async def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Get conversation by ID"""
        try:
            response = (
                self.supabase.table("procurement_conversations")
                .select("*")
                .eq("id", conversation_id)
                .single()
                .execute()
            )

            return response.data if response.data else None
        except Exception as e:
            logger.error(f"Failed to get conversation {conversation_id}: {e}")
            return None

    async def update_conversation(
        self, conversation_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update conversation fields"""
        try:
            response = (
                self.supabase.table("procurement_conversations")
                .update(updates)
                .eq("id", conversation_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                logger.info(
                    f"Updated conversation {conversation_id}: {list(updates.keys())}"
                )
                return response.data[0]

            return None
        except Exception as e:
            logger.error(f"Failed to update conversation {conversation_id}: {e}")
            return None

    async def get_pending_conversations(
        self, restaurant_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get all conversations pending manager approval"""
        try:
            query = (
                self.supabase.table("procurement_conversations")
                .select(
                    "*, providers(name), procurement_orders(wine_name, quantity, target_price_per_bottle)"
                )
                .eq("manager_approval_status", "pending")
                .order("paused_at", desc=False)
            )

            if restaurant_id:
                query = query.eq("restaurant_id", restaurant_id)

            response = query.execute()
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get pending conversations: {e}")
            return []

    async def get_provider_by_id_direct(
        self, provider_id: str
    ) -> Optional[Dict[str, Any]]:
        """Direct Supabase provider lookup (bypasses repository cache)."""
        try:
            response = (
                self.supabase.table("providers")
                .select("*")
                .eq("id", provider_id)
                .single()
                .execute()
            )

            return response.data if response.data else None
        except Exception as e:
            logger.error(f"Failed to get provider {provider_id}: {e}")
            return None

    async def get_manager(self, restaurant_id: str) -> Optional[Dict[str, Any]]:
        """Get manager preferences for notification routing"""
        try:
            # Get restaurant with manager preferences
            response = (
                self.supabase.table("restaurants")
                .select("*, users(*)")
                .eq("id", restaurant_id)
                .single()
                .execute()
            )

            if response.data:
                # Extract manager from users array (assuming first user is manager)
                restaurant = response.data
                if restaurant.get("users") and len(restaurant["users"]) > 0:
                    manager = restaurant["users"][0]
                    manager["push_enabled"] = restaurant.get("push_enabled", True)
                    return manager

            return None
        except Exception as e:
            logger.error(f"Failed to get manager for restaurant {restaurant_id}: {e}")
            return None

    # =========================================================================
    # HEALTH & METRICS
    # =========================================================================

    async def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics"""
        stats = {
            "connected": self.supabase is not None,
            "redis_connected": self.redis is not None,
            "repositories": {},
        }

        if self.inventory:
            stats["repositories"]["inventory"] = self.inventory.stats()
        if self.providers:
            stats["repositories"]["providers"] = self.providers.stats()
        if self.procurement:
            stats["repositories"]["procurement"] = self.procurement.stats()
        if self.sales_events:
            stats["repositories"]["sales_events"] = self.sales_events.stats()

        return stats

    async def health_check(self) -> Dict[str, Any]:
        """Perform health check"""
        health = {"status": "healthy"}

        # Check Supabase
        try:
            self.supabase.table("restaurants").select("id").limit(1).execute()
            health["supabase"] = "connected"
        except Exception as e:
            health["supabase"] = f"error: {e}"
            health["status"] = "unhealthy"

        # Check Redis
        if self.redis:
            try:
                await self.redis.ping()
                health["redis"] = "connected"
            except Exception as e:
                health["redis"] = f"error: {e}"
                health["status"] = "degraded"
        else:
            health["redis"] = "disabled"

        return health


# =============================================================================
# SINGLETON ACCESS
# =============================================================================

_db_client_instance: Optional[DatabaseClient] = None


def get_database() -> Optional[DatabaseClient]:
    """Get global database client"""
    return _db_client_instance


def set_database(client: DatabaseClient) -> None:
    """Set global database client"""
    global _db_client_instance
    _db_client_instance = client


def get_supabase_client() -> Optional[Client]:
    """Get the raw Supabase client, or None when no database is configured.

    Resolution order:
      1. the connected DatabaseClient facade, so callers share the same client
         the repositories already use
      2. the lazily-built client on Settings (SUPABASE_URL / SUPABASE_KEY)

    Returning None is a legitimate state — local and mock runs have no
    database — and callers are expected to branch on it. Import or
    configuration faults are a different thing entirely, so callers should
    not wrap this in a bare `except Exception` that makes a wiring bug
    indistinguishable from "no database configured".
    """
    db = _db_client_instance
    if db is not None and db.supabase is not None:
        return db.supabase

    try:
        from config.settings import get_settings

        return get_settings().supabase_client
    except Exception as e:
        logger.warning(f"Could not build a Supabase client from settings: {e}")
        return None
