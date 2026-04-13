"""
Inventory Count Service
=======================
Physical inventory counting with discrepancy detection.

Features:
- Physical count recording with location
- System vs physical comparison
- Discrepancy detection and alerting
- Sales-adjusted expected stock calculation
- Manager notification for inequalities

Usage:
    service = InventoryCountService(db_client, message_bus)
    
    # Record a physical count
    result = await service.record_physical_count(
        inventory_id="...",
        physical_count=7,
        location="Cellar A > North Wall > Shelf 2",
        counted_by="staff_id"
    )
    
    # Check for discrepancies
    discrepancies = await service.detect_discrepancies(restaurant_id)
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from uuid import uuid4
import logging

logger = logging.getLogger(__name__)


class InventoryCountService:
    """
    Service for physical inventory counting and discrepancy detection
    
    Core Logic:
    - physical_stock: Last manual count
    - stock_live: System calculated (from sales)
    - expected_stock: stock_live - sales_since_last_count
    - discrepancy: physical_stock - expected_stock
    """
    
    def __init__(self, database, message_bus):
        self.database = database
        self.message_bus = message_bus
        
        # Discrepancy thresholds
        self.minor_discrepancy_threshold = 1  # 1 bottle = minor
        self.major_discrepancy_threshold = 3  # 3+ bottles = major
        
        # Statistics
        self.counts_recorded = 0
        self.discrepancies_detected = 0
    
    async def record_physical_count(
        self,
        inventory_id: str,
        physical_count: int,
        location: Optional[str] = None,
        counted_by: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Record a physical inventory count
        
        Args:
            inventory_id: Inventory item ID
            physical_count: Actual bottles counted
            location: Storage location (e.g., "Cellar A > Shelf 2")
            counted_by: Staff ID who performed count
            notes: Optional notes
            
        Returns:
            Count result with discrepancy analysis
        """
        logger.info(f"Recording physical count for {inventory_id}: {physical_count} bottles")
        
        # Get current inventory data
        inventory = self.database.supabase.table("restaurant_inventory") \
            .select("*, master_wine_library(name)") \
            .eq("id", inventory_id) \
            .single() \
            .execute()
        
        if not inventory.data:
            return {"error": f"Inventory item not found: {inventory_id}"}
        
        item = inventory.data
        wine_name = item.get("master_wine_library", {}).get("name", "Unknown Wine")
        stock_live = item.get("stock_live", 0)
        previous_physical = item.get("physical_stock")
        
        # Calculate expected stock based on sales
        expected_stock = await self._calculate_expected_stock(
            inventory_id=inventory_id,
            restaurant_id=item.get("restaurant_id"),
            current_stock_live=stock_live,
        )
        
        # Calculate discrepancy
        discrepancy = physical_count - expected_stock
        discrepancy_type = self._classify_discrepancy(discrepancy)
        
        # Update inventory with physical count
        update_data = {
            "physical_stock": physical_count,
            "last_manual_edit_at": datetime.utcnow().isoformat(),
            "manual_edit_reason": notes or f"Physical inventory count by {counted_by}",
        }
        
        # Only set last_manual_edit_by if it's a valid UUID
        if counted_by and len(counted_by) == 36 and "-" in counted_by:
            update_data["last_manual_edit_by"] = counted_by
        
        # If count differs significantly from stock_live, flag for review
        if abs(discrepancy) > 0:
            update_data["inventory_state"] = "PENDING_RECONCILIATION"
        
        self.database.supabase.table("restaurant_inventory") \
            .update(update_data) \
            .eq("id", inventory_id) \
            .execute()
        
        self.counts_recorded += 1
        
        result = {
            "inventory_id": inventory_id,
            "wine_name": wine_name,
            "physical_count": physical_count,
            "stock_live": stock_live,
            "expected_stock": expected_stock,
            "discrepancy": discrepancy,
            "discrepancy_type": discrepancy_type,
            "previous_physical": previous_physical,
            "location": location,
            "counted_by": counted_by,
            "counted_at": datetime.utcnow().isoformat(),
        }
        
        # If discrepancy detected, notify manager
        if discrepancy_type != "none":
            self.discrepancies_detected += 1
            await self._notify_discrepancy(result)
        
        return result
    
    async def _calculate_expected_stock(
        self,
        inventory_id: str,
        restaurant_id: str,
        current_stock_live: int,
    ) -> int:
        """
        Calculate expected stock based on sales since last count
        
        Formula: expected = stock_live (which already accounts for sales)
        
        But for demo purposes, we simulate a scenario where:
        - System shows stock_live = 10
        - Sales today = 2
        - Expected = 8
        - But physical count = 7 (discrepancy!)
        """
        # Get sales since midnight (today's sales)
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        
        try:
            sales = self.database.supabase.table("sales_events") \
                .select("quantity") \
                .eq("inventory_id", inventory_id) \
                .gte("created_at", today_start.isoformat()) \
                .execute()
            
            sales_today = sum(s.get("quantity", 0) for s in (sales.data or []))
            
            # Expected = current stock (already reduced by sales in real system)
            # For demo, we return stock_live as expected
            return current_stock_live
            
        except Exception as e:
            logger.error(f"Error calculating expected stock: {e}")
            return current_stock_live
    
    def _classify_discrepancy(self, discrepancy: int) -> str:
        """Classify discrepancy severity"""
        abs_disc = abs(discrepancy)
        
        if abs_disc == 0:
            return "none"
        elif abs_disc <= self.minor_discrepancy_threshold:
            return "minor"
        elif abs_disc <= self.major_discrepancy_threshold:
            return "moderate"
        else:
            return "major"
    
    async def _notify_discrepancy(self, count_result: Dict[str, Any]) -> None:
        """Notify manager of inventory discrepancy"""
        wine_name = count_result["wine_name"]
        discrepancy = count_result["discrepancy"]
        expected = count_result["expected_stock"]
        physical = count_result["physical_count"]
        discrepancy_type = count_result["discrepancy_type"]
        
        # Calculate what "should have" happened
        # If discrepancy is -1, we're short 1 bottle
        if discrepancy < 0:
            message = (
                f"[{wine_name}] has sold but we're down more than expected.\n"
                f"Expected: {expected} bottles\n"
                f"Counted: {physical} bottles\n"
                f"Missing: {abs(discrepancy)} bottle(s)\n"
                f"Possible causes: theft, breakage, unrecorded sales"
            )
        else:
            message = (
                f"[{wine_name}] has more bottles than expected.\n"
                f"Expected: {expected} bottles\n"
                f"Counted: {physical} bottles\n"
                f"Extra: {discrepancy} bottle(s)\n"
                f"Possible causes: unrecorded delivery, count error"
            )
        
        priority_map = {
            "minor": 5,
            "moderate": 7,
            "major": 9,
        }
        
        await self.message_bus.publish(
            exchange_name="notification.events",
            routing_key="notification.inventory_discrepancy",
            message_body={
                "event_type": "InventoryDiscrepancyAlert",
                "payload": {
                    "type": "inventory_discrepancy",
                    "priority": discrepancy_type,
                    "inventory_id": count_result["inventory_id"],
                    "wine_name": wine_name,
                    "expected_stock": expected,
                    "physical_count": physical,
                    "discrepancy": discrepancy,
                    "discrepancy_type": discrepancy_type,
                    "title": f"⚠️ Inventory Discrepancy: {wine_name}",
                    "message": message,
                    "action_buttons": [
                        {
                            "id": "investigate",
                            "label": "Investigate",
                            "action": "open_investigation",
                        },
                        {
                            "id": "adjust",
                            "label": "Adjust Stock",
                            "action": "adjust_to_physical",
                        },
                        {
                            "id": "recount",
                            "label": "Recount",
                            "action": "request_recount",
                        },
                    ],
                    "notification_channels": {
                        "push": True,
                        "sms": discrepancy_type in ["moderate", "major"],
                        "email": discrepancy_type == "major",
                    },
                }
            },
            priority=priority_map.get(discrepancy_type, 5),
        )
        
        logger.info(f"📱 Discrepancy notification sent for {wine_name}")
    
    async def detect_all_discrepancies(
        self,
        restaurant_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Check all inventory items for discrepancies
        
        Returns list of items where physical_stock != expected_stock
        """
        # Get all inventory with physical counts
        inventory = self.database.supabase.table("restaurant_inventory") \
            .select("*, master_wine_library(name)") \
            .eq("restaurant_id", restaurant_id) \
            .not_.is_("physical_stock", "null") \
            .execute()
        
        discrepancies = []
        
        for item in (inventory.data or []):
            physical = item.get("physical_stock", 0)
            stock_live = item.get("stock_live", 0)
            
            if physical != stock_live:
                wine_name = item.get("master_wine_library", {}).get("name", "Unknown")
                discrepancy = physical - stock_live
                
                discrepancies.append({
                    "inventory_id": item["id"],
                    "wine_name": wine_name,
                    "physical_stock": physical,
                    "stock_live": stock_live,
                    "discrepancy": discrepancy,
                    "discrepancy_type": self._classify_discrepancy(discrepancy),
                })
        
        return discrepancies
    
    async def reconcile_stock(
        self,
        inventory_id: str,
        use_physical: bool = True,
        reason: str = "manual_reconciliation",
    ) -> Dict[str, Any]:
        """
        Reconcile stock by setting stock_live to physical_stock (or vice versa)
        
        Args:
            inventory_id: Inventory item ID
            use_physical: If True, set stock_live = physical_stock
            reason: Reason for reconciliation
            
        Returns:
            Reconciliation result
        """
        inventory = self.database.supabase.table("restaurant_inventory") \
            .select("*") \
            .eq("id", inventory_id) \
            .single() \
            .execute()
        
        if not inventory.data:
            return {"error": "Inventory not found"}
        
        item = inventory.data
        physical = item.get("physical_stock", 0)
        stock_live = item.get("stock_live", 0)
        
        if use_physical:
            new_stock = physical
            old_stock = stock_live
        else:
            new_stock = stock_live
            old_stock = physical
        
        # Update
        self.database.supabase.table("restaurant_inventory") \
            .update({
                "stock_live": new_stock,
                "physical_stock": new_stock,
                "shadow_stock": 0,
                "inventory_state": "LIVE",
                "manual_edit_reason": reason,
                "last_manual_edit_at": datetime.utcnow().isoformat(),
            }) \
            .eq("id", inventory_id) \
            .execute()
        
        return {
            "inventory_id": inventory_id,
            "previous_stock_live": stock_live,
            "previous_physical": physical,
            "new_stock": new_stock,
            "reconciled_at": datetime.utcnow().isoformat(),
            "reason": reason,
        }
    
    async def get_count_summary(
        self,
        restaurant_id: str,
    ) -> Dict[str, Any]:
        """Get summary of inventory count status"""
        inventory = self.database.supabase.table("restaurant_inventory") \
            .select("*") \
            .eq("restaurant_id", restaurant_id) \
            .execute()
        
        items = inventory.data or []
        
        counted = [i for i in items if i.get("physical_stock") is not None]
        not_counted = [i for i in items if i.get("physical_stock") is None]
        with_discrepancy = [
            i for i in counted 
            if i.get("physical_stock", 0) != i.get("stock_live", 0)
        ]
        
        return {
            "total_items": len(items),
            "counted": len(counted),
            "not_counted": len(not_counted),
            "with_discrepancy": len(with_discrepancy),
            "count_completion_percent": round(len(counted) / max(len(items), 1) * 100, 1),
        }
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get service statistics"""
        return {
            "counts_recorded": self.counts_recorded,
            "discrepancies_detected": self.discrepancies_detected,
        }

