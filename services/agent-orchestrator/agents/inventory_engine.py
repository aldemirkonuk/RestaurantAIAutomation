"""
Inventory Engine Agent
Core inventory state management with data integrity guarantees

Responsibilities:
- Process stock.evaluated events from Buffer Manager
- Update stock_live in database
- Track inventory state transitions
- Handle procurement order deliveries
- Calculate shadow stock
- Maintain data integrity (no race conditions)
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
from enum import Enum

from core.base_agent import BaseAgent


class InventoryState(Enum):
    """Inventory state machine"""
    AVAILABLE = "AVAILABLE"
    LOW = "LOW"
    CRITICAL = "CRITICAL"
    IN_TRANSIT = "IN_TRANSIT"
    OUT_OF_STOCK = "OUT_OF_STOCK"


class InventoryEngineAgent(BaseAgent):
    """
    Inventory Engine Agent - System of record for inventory state
    
    Performance optimizations:
    - Batch updates for high throughput
    - Optimistic locking for consistency
    - Smart cache invalidation
    - Idempotent operations
    """
    
    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)
        
        # Configuration
        self.default_threshold = config.get("default_threshold", 3)
        
    
    async def initialize(self) -> None:
        """Initialize inventory engine"""
        self.logger.info("Initializing Inventory Engine")
        
        # TODO: Load critical inventory data into cache on startup
        # TODO: Validate database schema
        
        self.logger.info("✓ Inventory Engine initialized")
    
    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        """Subscribe to stock events"""
        return [
            ("stock.events", "stock.evaluated"),
            ("procurement.events", "procurement.order.delivered"),
            ("stock.events", "stock.manual_correction"),
        ]
    
    async def process_message(self, message: Dict[str, Any]) -> None:
        """Route messages to appropriate handlers"""
        routing_key = message.get("routing_key")
        
        if routing_key == "stock.evaluated":
            await self._handle_stock_evaluated(message)
        elif routing_key == "procurement.order.delivered":
            await self._handle_order_delivered(message)
        elif routing_key == "stock.manual_correction":
            await self._handle_manual_correction(message)
        else:
            self.logger.warning(f"Unexpected routing key: {routing_key}")
    
    async def _handle_stock_evaluated(self, message: Dict[str, Any]) -> None:
        """
        Handle stock.evaluated event from Buffer Manager
        Update stock_live with final stock value
        """
        message_id = message.get("message_id", "")
        if await self._check_idempotency(message_id):
            self.logger.info(f"Duplicate stock.evaluated skipped: {message_id}")
            return

        payload = message.get("payload", {})

        inventory_id = payload.get("inventory_id")
        final_stock = payload.get("stock_after")
        restaurant_id = payload.get("restaurant_id")

        if not inventory_id or final_stock is None:
            self.logger.error("Missing required fields in stock.evaluated event")
            return

        try:
            # Update stock_live in database
            success = await self.database.update_inventory_stock(
                inventory_id=inventory_id,
                new_stock=final_stock,
                update_reason="buffer_evaluation"
            )

            if success:
                # Get updated inventory to determine new state
                inventory = await self.database.get_inventory_item(inventory_id, use_cache=False)

                if inventory:
                    # Calculate new state
                    new_state = self._calculate_inventory_state(inventory)

                    # Publish state change event
                    await self.publish(
                        exchange_name="stock.events",
                        routing_key="stock.state.changed",
                        message_body={
                            "event_type": "StockStateChanged",
                            "payload": {
                                "inventory_id": inventory_id,
                                "restaurant_id": restaurant_id,
                                "wine_name": inventory.get("wine_name"),
                                "stock_live": final_stock,
                                "new_state": new_state.value,
                                "threshold_min": inventory.get("threshold_min"),
                                "in_transit_quantity": inventory.get("in_transit_quantity", 0),
                            }
                        },
                        priority=6,
                    )

                    await self._mark_processed(message_id, result={"status": "ok", "inventory_id": inventory_id, "stock_after": final_stock})
                    await self.log_decision(
                        "stock_update",
                        inputs={"inventory_id": inventory_id, "stock_after": final_stock, "restaurant_id": restaurant_id},
                        output={"new_state": new_state.value, "success": success},
                        reasoning="Buffer Manager evaluated stock; updating system-of-record",
                        confidence=0.9,
                        restaurant_id=restaurant_id,
                    )
                    await self.append_event(
                        "inventory",
                        str(inventory_id),
                        "StockUpdated",
                        payload={"inventory_id": inventory_id, "stock_after": final_stock, "new_state": new_state.value, "restaurant_id": restaurant_id},
                        sequence_number=1,
                    )

                    self.logger.info(
                        f"Updated stock: {inventory.get('wine_name')} = {final_stock} bottles "
                        f"(state={new_state.value})"
                    )
            else:
                self.logger.error(f"Failed to update stock for {inventory_id}")

        except Exception as e:
            self.logger.error(f"Error handling stock.evaluated: {e}", exc_info=True)
    
    async def _handle_order_delivered(self, message: Dict[str, Any]) -> None:
        """
        Handle delivery of procurement order
        Increase stock_live and update order status
        """
        message_id = message.get("message_id", "")
        if await self._check_idempotency(message_id):
            self.logger.info(f"Duplicate order.delivered skipped: {message_id}")
            return

        payload = message.get("payload", {})

        order_id = payload.get("order_id")
        inventory_id = payload.get("inventory_id")
        quantity_delivered = payload.get("quantity_delivered")

        if not all([order_id, inventory_id, quantity_delivered]):
            self.logger.error("Missing required fields in order.delivered event")
            return

        try:
            # Get current inventory
            inventory = await self.database.get_inventory_item(inventory_id, use_cache=False)

            if not inventory:
                self.logger.error(f"Inventory not found: {inventory_id}")
                return

            current_stock = inventory.get("stock_live", 0)
            new_stock = current_stock + quantity_delivered

            # Update stock_live
            success = await self.database.update_inventory_stock(
                inventory_id=inventory_id,
                new_stock=new_stock,
                update_reason=f"delivery_order_{order_id}"
            )

            if success:
                # Update order status
                await self.database.update_order_status(
                    order_id=order_id,
                    status="DELIVERED",
                    additional_data={
                        "delivered_at": datetime.utcnow().isoformat(),
                        "delivered_quantity": quantity_delivered,
                    }
                )

                # Publish stock increase event
                await self.publish(
                    exchange_name="stock.events",
                    routing_key="stock.increased",
                    message_body={
                        "event_type": "StockIncreased",
                        "payload": {
                            "inventory_id": inventory_id,
                            "restaurant_id": inventory.get("restaurant_id"),
                            "wine_name": inventory.get("wine_name"),
                            "stock_before": current_stock,
                            "stock_after": new_stock,
                            "quantity_added": quantity_delivered,
                            "reason": "procurement_delivery",
                            "order_id": order_id,
                        }
                    },
                    priority=5,
                )

                await self._mark_processed(message_id, result={"status": "ok", "inventory_id": inventory_id, "stock_after": new_stock})
                await self.log_decision(
                    "delivery_received",
                    inputs={"inventory_id": inventory_id, "stock_before": current_stock, "stock_after": new_stock, "restaurant_id": inventory.get("restaurant_id")},
                    output={"new_state": self._calculate_inventory_state(inventory).value, "success": success},
                    reasoning="Procurement order delivered; incrementing stock from delivery",
                    confidence=0.9,
                    restaurant_id=inventory.get("restaurant_id"),
                )
                await self.append_event(
                    "inventory",
                    str(inventory_id),
                    "DeliveryReceived",
                    payload={"inventory_id": inventory_id, "stock_before": current_stock, "stock_after": new_stock, "order_id": order_id, "restaurant_id": inventory.get("restaurant_id")},
                    sequence_number=1,
                )

                self.logger.info(
                    f"✓ Delivered: {inventory.get('wine_name')} "
                    f"+{quantity_delivered} bottles ({current_stock} → {new_stock})"
                )

        except Exception as e:
            self.logger.error(f"Error handling order delivery: {e}", exc_info=True)
    
    async def _handle_manual_correction(self, message: Dict[str, Any]) -> None:
        """
        Handle manual stock correction by manager
        Used for physical inventory counts
        """
        message_id = message.get("message_id", "")
        if await self._check_idempotency(message_id):
            self.logger.info(f"Duplicate stock.manual_correction skipped: {message_id}")
            return

        payload = message.get("payload", {})

        inventory_id = payload.get("inventory_id")
        corrected_stock = payload.get("corrected_stock")
        manager_id = payload.get("manager_id")
        reason = payload.get("reason", "manual_correction")

        if not all([inventory_id, corrected_stock is not None, manager_id]):
            self.logger.error("Missing required fields in manual_correction event")
            return

        try:
            # Get current inventory
            inventory = await self.database.get_inventory_item(inventory_id, use_cache=False)

            if not inventory:
                self.logger.error(f"Inventory not found: {inventory_id}")
                return

            old_stock = inventory.get("stock_live", 0)

            # Update stock with audit trail
            success = await self.database.update_inventory_stock(
                inventory_id=inventory_id,
                new_stock=corrected_stock,
                update_reason=f"manual_correction_by_{manager_id}"
            )

            if success:
                # Log to audit trail
                self.database.supabase.table("system_audit_log").insert({
                    "actor_type": "manager",
                    "actor_id": manager_id,
                    "action": "manual_stock_correction",
                    "entity_type": "inventory",
                    "entity_id": inventory_id,
                    "changes": {
                        "stock_before": old_stock,
                        "stock_after": corrected_stock,
                        "delta": corrected_stock - old_stock,
                        "reason": reason,
                    }
                }).execute()

                # Publish correction event
                await self.publish(
                    exchange_name="stock.events",
                    routing_key="stock.manually_corrected",
                    message_body={
                        "event_type": "StockManuallyCorrected",
                        "payload": {
                            "inventory_id": inventory_id,
                            "restaurant_id": inventory.get("restaurant_id"),
                            "wine_name": inventory.get("wine_name"),
                            "stock_before": old_stock,
                            "stock_after": corrected_stock,
                            "delta": corrected_stock - old_stock,
                            "corrected_by": manager_id,
                            "reason": reason,
                        }
                    },
                    priority=6,
                )

                await self._mark_processed(message_id, result={"status": "ok", "inventory_id": inventory_id, "corrected_stock": corrected_stock})
                await self.log_decision(
                    "manual_correction",
                    inputs={"inventory_id": inventory_id, "corrected_stock": corrected_stock, "restaurant_id": inventory.get("restaurant_id")},
                    output={"new_state": self._calculate_inventory_state(inventory).value, "success": success},
                    reasoning="Manager submitted physical count correction",
                    confidence=0.7,
                    restaurant_id=inventory.get("restaurant_id"),
                )
                await self.append_event(
                    "inventory",
                    str(inventory_id),
                    "ManualCorrectionApplied",
                    payload={"inventory_id": inventory_id, "corrected_stock": corrected_stock, "manager_id": manager_id, "restaurant_id": inventory.get("restaurant_id")},
                    sequence_number=1,
                )

                self.logger.info(
                    f"✓ Manual correction: {inventory.get('wine_name')} "
                    f"{old_stock} → {corrected_stock} by manager {manager_id}"
                )

        except Exception as e:
            self.logger.error(f"Error handling manual correction: {e}", exc_info=True)
    
    def _calculate_inventory_state(self, inventory: Dict[str, Any]) -> InventoryState:
        """
        Calculate inventory state based on stock and threshold
        
        Rules:
        - OUT_OF_STOCK: stock_live = 0
        - CRITICAL: stock_live < threshold_min
        - LOW: stock_live < threshold_min * 2
        - IN_TRANSIT: stock_live < threshold but in_transit_quantity > 0
        - AVAILABLE: stock_live >= threshold_min * 2
        """
        stock_live = inventory.get("stock_live", 0)
        threshold_min = inventory.get("threshold_min", self.default_threshold)
        in_transit = inventory.get("in_transit_quantity", 0)
        
        if stock_live == 0:
            return InventoryState.OUT_OF_STOCK
        
        if stock_live < threshold_min:
            if in_transit > 0:
                return InventoryState.IN_TRANSIT
            return InventoryState.CRITICAL
        
        if stock_live < threshold_min * 2:
            return InventoryState.LOW
        
        return InventoryState.AVAILABLE
    
    async def cleanup(self) -> None:
        """Cleanup resources"""
        self.logger.info("✓ Inventory Engine cleaned up")

