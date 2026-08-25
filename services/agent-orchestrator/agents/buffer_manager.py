"""
Buffer Manager Agent
Implements 30-minute LIFO buffer to prevent notification spam during busy hours

Critical Performance Optimizations:
- In-memory buffer with Redis backup
- Efficient window evaluation
- Batch processing
- Intelligent alert deduplication
"""

import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import redis.asyncio as redis

from core.base_agent import BaseAgent


class BufferWindow:
    """Represents a 30-minute buffer window for a specific inventory item"""

    def __init__(self, inventory_id: str, window_minutes: int = 30):
        self.inventory_id = inventory_id
        self.window_minutes = window_minutes
        self.window_start: datetime = datetime.utcnow()
        self.window_end: datetime = self.window_start + timedelta(
            minutes=window_minutes
        )

        # Sales tracking
        self.sales: List[Dict[str, Any]] = []
        self.initial_stock: Optional[int] = None
        self.final_stock: Optional[int] = None

        # Metadata
        self.last_alert_level: Optional[int] = None

    def add_sale(
        self, quantity: int, timestamp: datetime, sale_data: Dict[str, Any]
    ) -> None:
        """Add a sale to the buffer"""
        self.sales.append({"quantity": quantity, "timestamp": timestamp, **sale_data})

    def calculate_final_stock(self, current_stock: int) -> int:
        """Apply the window's sales to the stock on hand.

        This previously did:

            self.initial_stock = current_stock + self.total_sold   # invent a "before"
            self.final_stock = current_stock                       # return input unchanged

        which never subtracted anything. It reconstructed a pre-sale figure by
        adding the sales back on, then returned the value it was given — so the
        evaluation logged a convincing "41 -> 40, sold 1" while writing back
        exactly the number already in the database. Depletion was a no-op by
        construction, and the log made it look like it was working. That single
        line is why a POS sale never moved a bottle.

        `current_stock` is read fresh from the database immediately before this
        call (`_evaluate_buffer` passes `use_cache=False`), so it is the stock on
        hand BEFORE this window is applied, and the sales must be subtracted.

        Floored at zero: overselling past empty is a real occurrence — the count
        was wrong, or a bottle was poured that was never in the system — and it
        must not be recorded as negative inventory, which would corrupt valuation
        and every downstream average.
        """
        if self.initial_stock is None:
            self.initial_stock = current_stock

        self.final_stock = max(0, current_stock - self.total_sold)
        return self.final_stock

    @property
    def total_sold(self) -> int:
        """Total bottles sold in this window"""
        return sum(sale["quantity"] for sale in self.sales)

    @property
    def is_expired(self) -> bool:
        """Check if window has expired"""
        return datetime.utcnow() >= self.window_end

    @property
    def remaining_seconds(self) -> float:
        """Seconds remaining in window"""
        return max(0, (self.window_end - datetime.utcnow()).total_seconds())

    def to_dict(self) -> Dict[str, Any]:
        """Serialize for caching"""
        return {
            "inventory_id": self.inventory_id,
            "window_start": self.window_start.isoformat(),
            "window_end": self.window_end.isoformat(),
            "sales_count": len(self.sales),
            "total_sold": self.total_sold,
            "initial_stock": self.initial_stock,
            "final_stock": self.final_stock,
        }


class BufferManagerAgent(BaseAgent):
    """
    Buffer Manager Agent - Prevents notification spam with intelligent buffering

    Algorithm:
    1. Collect all sale events in 30-minute windows
    2. Ignore intermediate stock states (5→4→3→2)
    3. Evaluate ONLY final state at window end
    4. Trigger alert once per threshold breach
    5. Deduplicate alerts using last_alert_level

    Performance:
    - In-memory buffers for speed
    - Redis backup for reliability
    - Batch evaluation every 60 seconds
    - Efficient data structures (defaultdict)
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # Configuration
        self.buffer_window_minutes: int = config.get("buffer_window_minutes", 30)
        self.evaluation_interval: int = config.get("evaluation_interval_seconds", 60)

        # Active buffers (in-memory for performance)
        self.active_buffers: Dict[str, BufferWindow] = {}

        # Redis client for distributed buffering (optional)
        self.redis_client: Optional[redis.Redis] = None

        # Background task for periodic evaluation
        self.evaluation_task: Optional[asyncio.Task] = None

    async def initialize(self) -> None:
        """Initialize buffer manager"""
        self.logger.info(
            f"Initializing Buffer Manager (window={self.buffer_window_minutes}min)"
        )

        # Try to connect to Redis for distributed buffering
        try:
            self.redis_client = await redis.from_url(
                self.database.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await self.redis_client.ping()
            self.logger.info("✓ Redis connected for buffer persistence")
        except Exception as e:
            self.logger.warning(f"Redis unavailable (buffer not persistent): {e}")
            self.redis_client = None

        # Start periodic evaluation task
        self.evaluation_task = asyncio.create_task(self._periodic_evaluation())

        self.logger.info("✓ Buffer Manager initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        """Subscribe to POS sale events and manual stock overrides"""
        return [
            ("pos.events", "pos.sale.completed"),
            ("stock.events", "stock.manual_override"),
            ("system.control", "system.emergency.flush_buffer"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        """
        Process incoming messages
        """
        routing_key = message.get("routing_key")

        if routing_key == "pos.sale.completed":
            await self._handle_sale_event(message)
        elif routing_key == "stock.manual_override":
            await self._handle_manual_override(message)
        elif routing_key == "system.emergency.flush_buffer":
            await self._emergency_flush()
        else:
            self.logger.warning(f"Unexpected routing key: {routing_key}")

    async def _handle_sale_event(self, message: Dict[str, Any]) -> None:
        """
        Handle POS sale event - add to buffer

        High-performance: O(1) operation
        """
        payload = message.get("payload", {})

        # Extract sale details
        inventory_id = payload.get("inventory_id")
        quantity_sold = payload.get("quantity", 1)
        timestamp = datetime.fromisoformat(
            payload.get("timestamp", datetime.utcnow().isoformat())
        )

        if not inventory_id:
            self.logger.error("Sale event missing inventory_id")
            return

        # Get or create buffer for this inventory item
        buffer = self.active_buffers.get(inventory_id)

        if buffer is None:
            # Create new buffer window
            buffer = BufferWindow(inventory_id, self.buffer_window_minutes)
            self.active_buffers[inventory_id] = buffer
            self.logger.debug(f"Created new buffer for {inventory_id}")

        # Add sale to buffer
        buffer.add_sale(quantity_sold, timestamp, payload)

        self.logger.debug(
            f"Added sale to buffer: {inventory_id} "
            f"(total in window: {buffer.total_sold}, "
            f"window expires in {buffer.remaining_seconds:.0f}s)"
        )

        # Persist to Redis (async, non-blocking)
        if self.redis_client:
            asyncio.create_task(self._persist_buffer_to_redis(buffer))

    async def _handle_manual_override(self, message: Dict[str, Any]) -> None:
        """
        Handle manual stock override - IMMEDIATE threshold evaluation.
        No buffer delay: manual changes are evaluated instantly because
        the manager explicitly set a new stock level.
        """
        payload = message.get("payload", {})

        inventory_id = payload.get("inventory_id")
        new_stock_live = payload.get("new_stock_live")
        old_stock_live = payload.get("old_stock_live", 0)
        threshold_min = payload.get("threshold_min", 6)
        restaurant_id = payload.get("restaurant_id")
        wine_id = payload.get("wine_id")

        if not inventory_id or new_stock_live is None:
            self.logger.error(
                "Manual override event missing inventory_id or new_stock_live"
            )
            return

        self.logger.info(
            f"Manual override: inventory={inventory_id}, "
            f"stock {old_stock_live} → {new_stock_live}, threshold={threshold_min}"
        )

        # Immediate threshold check (no buffer delay)
        if new_stock_live < threshold_min:
            # Calculate urgency
            sales_velocity_7d = 0
            try:
                inventory = await self.database.get_inventory_item(
                    inventory_id, use_cache=False
                )
                if inventory:
                    sales_velocity_7d = inventory.get("sales_velocity_7d", 0)
            except Exception:
                pass

            estimated_stockout_days = (
                new_stock_live / sales_velocity_7d if sales_velocity_7d > 0 else 999
            )

            in_transit = 0
            try:
                if inventory:
                    in_transit = inventory.get("in_transit_quantity", 0)
            except Exception:
                pass

            if in_transit == 0:
                urgency = (
                    "critical"
                    if new_stock_live == 0
                    else "high" if estimated_stockout_days < 2 else "medium"
                )

                await self.publish(
                    exchange_name="stock.events",
                    routing_key="stock.threshold.breached",
                    message_body={
                        "event_type": "StockThresholdBreached",
                        "payload": {
                            "inventory_id": inventory_id,
                            "restaurant_id": restaurant_id,
                            "master_wine_id": wine_id,
                            "wine_name": (
                                inventory.get("wine_name", "Unknown")
                                if inventory
                                else "Unknown"
                            ),
                            "stock_before": old_stock_live,
                            "stock_after": new_stock_live,
                            "threshold": threshold_min,
                            "in_transit_quantity": in_transit,
                            "sales_velocity_7d": sales_velocity_7d,
                            "estimated_stockout_days": round(
                                estimated_stockout_days, 1
                            ),
                            "urgency": urgency,
                            "source": "manual_override",
                        },
                    },
                    priority=9 if urgency == "critical" else 8,
                )

                self.logger.warning(
                    f"🚨 THRESHOLD BREACHED (manual override): "
                    f"stock={new_stock_live}, threshold={threshold_min}, urgency={urgency}"
                )
            else:
                self.logger.info(
                    f"Manual override: stock low but {in_transit} bottles in transit"
                )
        else:
            self.logger.info(
                f"Manual override: stock {new_stock_live} above threshold {threshold_min}, no alert"
            )

    async def _periodic_evaluation(self) -> None:
        """
        Periodically evaluate expired buffers

        Runs every 60 seconds to check for expired windows
        """
        self.logger.info(
            f"Started periodic buffer evaluation (interval={self.evaluation_interval}s)"
        )

        while True:
            try:
                await asyncio.sleep(self.evaluation_interval)

                # Find expired buffers
                expired_buffers = [
                    (inv_id, buffer)
                    for inv_id, buffer in self.active_buffers.items()
                    if buffer.is_expired
                ]

                if expired_buffers:
                    self.logger.info(
                        f"Evaluating {len(expired_buffers)} expired buffers..."
                    )

                    # Evaluate each expired buffer
                    for inventory_id, buffer in expired_buffers:
                        await self._evaluate_buffer(inventory_id, buffer)

                        # Remove from active buffers
                        del self.active_buffers[inventory_id]

                    self.logger.info(f"✓ Evaluated {len(expired_buffers)} buffers")

            except asyncio.CancelledError:
                self.logger.info("Periodic evaluation cancelled")
                break
            except Exception as e:
                self.logger.error(f"Error in periodic evaluation: {e}", exc_info=True)

    async def _evaluate_buffer(self, inventory_id: str, buffer: BufferWindow) -> None:
        """
        Evaluate buffer at end of window - THIS IS THE CRITICAL LOGIC

        Steps:
        1. Get current stock from database
        2. Calculate final stock (LIFO)
        3. Check if threshold breached
        4. Publish stock.evaluated event
        5. Publish stock.threshold.breached if needed (with deduplication)
        """
        try:
            # Get current inventory state
            inventory = await self.database.get_inventory_item(
                inventory_id, use_cache=False
            )

            if not inventory:
                self.logger.error(f"Inventory not found: {inventory_id}")
                return

            current_stock = inventory.get("stock_live", 0)
            threshold = inventory.get("threshold_min", 3)
            last_alert_level = inventory.get("last_alert_level")

            # Calculate final stock
            final_stock = buffer.calculate_final_stock(current_stock)

            self.logger.info(
                f"Buffer evaluation: {inventory.get('wine_name', 'Unknown')} "
                f"({buffer.initial_stock} → {final_stock}, "
                f"sold {buffer.total_sold}, threshold {threshold})"
            )

            # Always publish stock.evaluated event
            await self.publish(
                exchange_name="stock.events",
                routing_key="stock.evaluated",
                message_body={
                    "event_type": "StockEvaluated",
                    "payload": {
                        "inventory_id": inventory_id,
                        "restaurant_id": inventory.get("restaurant_id"),
                        "wine_name": inventory.get("wine_name"),
                        "stock_before": buffer.initial_stock,
                        "stock_after": final_stock,
                        "total_sold_in_window": buffer.total_sold,
                        "threshold": threshold,
                        "buffer_window_minutes": self.buffer_window_minutes,
                        "evaluation_timestamp": datetime.utcnow().isoformat(),
                    },
                },
                priority=7,
            )

            # Check if threshold breached AND not already alerted at this level
            if final_stock < threshold:
                # Deduplication: Only alert if stock level changed since last alert
                if last_alert_level is None or final_stock < last_alert_level:

                    # Check for active IN_TRANSIT orders
                    in_transit = inventory.get("in_transit_quantity") or 0

                    if in_transit == 0:
                        # Calculate urgency metrics.
                        #
                        # `or 0`, not `.get(key, 0)`: the column exists and is
                        # NULL for any wine without seven days of sales history,
                        # and dict.get's default only fires when the KEY is
                        # absent, not when its value is None. The comparison then
                        # raised "'>' not supported between NoneType and int",
                        # the whole evaluation aborted in its except block, and no
                        # threshold breach was ever published — so a wine with no
                        # velocity, which is precisely a newly stocked wine, could
                        # never trigger a reorder.
                        sales_velocity_7d = inventory.get("sales_velocity_7d") or 0
                        in_transit = inventory.get("in_transit_quantity") or 0
                        estimated_stockout_days = (
                            final_stock / sales_velocity_7d
                            if sales_velocity_7d > 0
                            else 999
                        )

                        # Publish threshold breach event
                        await self.publish(
                            exchange_name="stock.events",
                            routing_key="stock.threshold.breached",
                            message_body={
                                "event_type": "StockThresholdBreached",
                                "payload": {
                                    "inventory_id": inventory_id,
                                    "restaurant_id": inventory.get("restaurant_id"),
                                    "master_wine_id": inventory.get("master_wine_id"),
                                    "wine_name": inventory.get("wine_name"),
                                    "stock_before": buffer.initial_stock,
                                    "stock_after": final_stock,
                                    "threshold": threshold,
                                    "in_transit_quantity": in_transit,
                                    "sales_velocity_7d": sales_velocity_7d,
                                    "estimated_stockout_days": round(
                                        estimated_stockout_days, 1
                                    ),
                                    "urgency": (
                                        "high"
                                        if estimated_stockout_days < 2
                                        else "medium"
                                    ),
                                },
                            },
                            priority=8 if estimated_stockout_days < 1 else 7,
                        )

                        self.logger.warning(
                            f"🚨 THRESHOLD BREACHED: {inventory.get('wine_name')} "
                            f"(stock={final_stock}, threshold={threshold}, "
                            f"stockout in {estimated_stockout_days:.1f} days)"
                        )
                    else:
                        self.logger.info(
                            f"Stock low but {in_transit} bottles in transit, skipping alert"
                        )
                else:
                    self.logger.debug(
                        f"Alert suppressed (already alerted at level {last_alert_level})"
                    )

        except Exception as e:
            self.logger.error(
                f"Failed to evaluate buffer for {inventory_id}: {e}", exc_info=True
            )

    async def _emergency_flush(self) -> None:
        """
        Emergency flush - evaluate all buffers immediately
        Used for critical stockouts
        """
        self.logger.warning("🚨 EMERGENCY BUFFER FLUSH - Evaluating all buffers NOW")

        buffers_to_flush = list(self.active_buffers.items())

        for inventory_id, buffer in buffers_to_flush:
            await self._evaluate_buffer(inventory_id, buffer)
            del self.active_buffers[inventory_id]

        self.logger.info(f"✓ Emergency flushed {len(buffers_to_flush)} buffers")

    async def _persist_buffer_to_redis(self, buffer: BufferWindow) -> None:
        """Persist buffer to Redis for reliability (async, non-blocking)"""
        if not self.redis_client:
            return

        try:
            key = f"buffer:{buffer.inventory_id}"
            value = str(buffer.to_dict())
            ttl_seconds = int(buffer.remaining_seconds) + 60  # Extra 60s buffer

            await self.redis_client.setex(key, ttl_seconds, value)
        except Exception as e:
            # Don't fail if Redis unavailable
            self.logger.debug(f"Redis persist failed (non-critical): {e}")

    async def cleanup(self) -> None:
        """Cleanup resources"""
        if self.evaluation_task:
            self.evaluation_task.cancel()
            try:
                await self.evaluation_task
            except asyncio.CancelledError:
                pass

        if self.redis_client:
            await self.redis_client.close()

        self.logger.info("✓ Buffer Manager cleaned up")
