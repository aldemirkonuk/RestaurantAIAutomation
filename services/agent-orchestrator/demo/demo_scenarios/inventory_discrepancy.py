"""
Inventory Discrepancy Scenario
==============================
Standalone scenario for testing inventory count discrepancy detection.

Scenarios:
1. Sold 2 bottles but down 3 (shrinkage)
2. More bottles than expected (unrecorded delivery)
3. Investigation and reconciliation flow

Usage:
    python demo/demo_scenarios/inventory_discrepancy.py
"""

import asyncio
from datetime import datetime
from typing import Dict, Any, Optional
from uuid import uuid4
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings
from services.inventory_count_service import InventoryCountService
from services.mobile_count_simulator import MobileCountSimulator


class InventoryDiscrepancyScenario:
    """
    Inventory Discrepancy Detection Scenario
    
    Tests:
    - Physical count vs system stock
    - Discrepancy detection and classification
    - Manager notification with action buttons
    - Investigation and reconciliation
    """
    
    def __init__(self):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
        self.inventory_service: Optional[InventoryCountService] = None
        self.mobile_simulator: Optional[MobileCountSimulator] = None
    
    async def setup(self):
        """Initialize connections"""
        print("\n🔌 Setting up...")
        
        self.db = DatabaseClient(
            supabase_url=self.settings.supabase_url,
            supabase_key=self.settings.supabase_service_role_key,
            redis_url=self.settings.redis_url,
        )
        await self.db.connect()
        
        self.message_bus = MessageBus(self.settings.rabbitmq_url)
        await self.message_bus.connect()
        
        self.inventory_service = InventoryCountService(self.db, self.message_bus)
        self.mobile_simulator = MobileCountSimulator(self.db, self.inventory_service)
        
        print("   ✅ Connected")
    
    async def teardown(self):
        """Cleanup"""
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
    
    async def scenario_1_shrinkage(
        self,
        wine_name: str = "Caymus Cabernet",
        stock_live: int = 10,
        sales_today: int = 2,
        actual_physical: int = 7,
    ) -> Dict[str, Any]:
        """
        Scenario 1: Shrinkage - More missing than sold
        
        Flow:
        1. System shows: stock_live = 10 (already accounts for sales)
        2. Sales today: 2 bottles
        3. Expected: 10 bottles
        4. Physical count: 7 bottles
        5. Discrepancy: -3 (but only sold 2!)
        6. Alert: "Sold 2 bottles but we're down 3"
        """
        print(f"\n{'='*60}")
        print("SCENARIO 1: Shrinkage Detection")
        print(f"{'='*60}")
        
        inventory_id = str(uuid4())
        
        print(f"\n📋 Inventory Status:")
        print(f"   Wine: {wine_name}")
        print(f"   System Stock (stock_live): {stock_live} bottles")
        print(f"   Sales Today: {sales_today} bottles")
        print(f"   Expected Count: {stock_live} bottles")
        
        # Simulate physical count
        print(f"\n📱 Staff performs physical count...")
        await asyncio.sleep(1)
        print(f"   Physical Count: {actual_physical} bottles")
        
        # Calculate discrepancy
        expected = stock_live
        discrepancy = actual_physical - expected
        unaccounted = abs(discrepancy) - sales_today if discrepancy < 0 else 0
        
        if discrepancy < 0:
            print(f"\n⚠️ DISCREPANCY DETECTED!")
            print(f"   Expected: {expected} bottles")
            print(f"   Counted: {actual_physical} bottles")
            print(f"   Missing: {abs(discrepancy)} bottle(s)")
            print(f"   Unaccounted (beyond sales): {unaccounted} bottle(s)")
            
            # Send notification
            await self.message_bus.publish(
                exchange_name="notification.events",
                routing_key="notification.inventory_discrepancy",
                message_body={
                    "event_type": "InventoryDiscrepancyAlert",
                    "payload": {
                        "inventory_id": inventory_id,
                        "wine_name": wine_name,
                        "expected_stock": expected,
                        "physical_count": actual_physical,
                        "discrepancy": discrepancy,
                        "sales_today": sales_today,
                        "unaccounted": unaccounted,
                        "discrepancy_type": "shrinkage",
                        "message": f"[{wine_name}] sold {sales_today} bottles but we're down {abs(discrepancy)}",
                        "action_buttons": [
                            {"id": "investigate", "label": "Investigate"},
                            {"id": "adjust", "label": "Adjust Stock"},
                            {"id": "recount", "label": "Recount"},
                        ],
                    }
                },
                priority=7,
            )
            
            print(f"\n📱 Manager Notification Sent:")
            print(f"   \"[{wine_name}] sold {sales_today} bottles but we're down {abs(discrepancy)}\"")
            print(f"   [Investigate] [Adjust Stock] [Recount]")
        
        return {
            "inventory_id": inventory_id,
            "wine_name": wine_name,
            "stock_live": stock_live,
            "sales_today": sales_today,
            "physical_count": actual_physical,
            "discrepancy": discrepancy,
            "unaccounted": unaccounted,
        }
    
    async def scenario_2_surplus(
        self,
        wine_name: str = "Silver Oak Cabernet",
        stock_live: int = 8,
        actual_physical: int = 10,
    ) -> Dict[str, Any]:
        """
        Scenario 2: Surplus - More bottles than expected
        
        Possible causes:
        - Unrecorded delivery
        - Previous count error
        - Return not logged
        """
        print(f"\n{'='*60}")
        print("SCENARIO 2: Surplus Detection")
        print(f"{'='*60}")
        
        inventory_id = str(uuid4())
        
        print(f"\n📋 Inventory Status:")
        print(f"   Wine: {wine_name}")
        print(f"   System Stock: {stock_live} bottles")
        
        # Simulate physical count
        print(f"\n📱 Staff performs physical count...")
        await asyncio.sleep(1)
        print(f"   Physical Count: {actual_physical} bottles")
        
        # Calculate discrepancy
        discrepancy = actual_physical - stock_live
        
        if discrepancy > 0:
            print(f"\n📦 SURPLUS DETECTED!")
            print(f"   Expected: {stock_live} bottles")
            print(f"   Counted: {actual_physical} bottles")
            print(f"   Extra: {discrepancy} bottle(s)")
            
            # Send notification
            await self.message_bus.publish(
                exchange_name="notification.events",
                routing_key="notification.inventory_surplus",
                message_body={
                    "event_type": "InventorySurplusAlert",
                    "payload": {
                        "inventory_id": inventory_id,
                        "wine_name": wine_name,
                        "expected_stock": stock_live,
                        "physical_count": actual_physical,
                        "discrepancy": discrepancy,
                        "discrepancy_type": "surplus",
                        "message": f"[{wine_name}] has {discrepancy} more bottles than expected",
                        "possible_causes": [
                            "Unrecorded delivery",
                            "Previous count error",
                            "Return not logged",
                        ],
                    }
                },
                priority=5,
            )
            
            print(f"\n📱 Manager Notification Sent:")
            print(f"   \"[{wine_name}] has {discrepancy} more bottles than expected\"")
            print(f"   Possible: Unrecorded delivery, count error, or return")
        
        return {
            "inventory_id": inventory_id,
            "wine_name": wine_name,
            "stock_live": stock_live,
            "physical_count": actual_physical,
            "discrepancy": discrepancy,
        }
    
    async def scenario_3_investigation_flow(
        self,
        inventory_id: str,
        wine_name: str,
        action: str = "investigate",
    ) -> Dict[str, Any]:
        """
        Scenario 3: Investigation and resolution flow
        
        Actions:
        - investigate: Open investigation, check cameras, etc.
        - adjust: Accept physical count as truth
        - recount: Request another count
        """
        print(f"\n{'='*60}")
        print("SCENARIO 3: Investigation Flow")
        print(f"{'='*60}")
        
        print(f"\n👤 Manager Action: {action}")
        
        if action == "investigate":
            print(f"\n   🔍 Opening investigation for {wine_name}...")
            print(f"   Checklist:")
            print(f"   [ ] Review security footage")
            print(f"   [ ] Check delivery logs")
            print(f"   [ ] Verify POS transactions")
            print(f"   [ ] Interview staff")
            
            # Create investigation record
            await self.message_bus.publish(
                exchange_name="operations.events",
                routing_key="operations.investigation_opened",
                message_body={
                    "event_type": "InvestigationOpened",
                    "payload": {
                        "inventory_id": inventory_id,
                        "wine_name": wine_name,
                        "type": "inventory_discrepancy",
                        "opened_at": datetime.utcnow().isoformat(),
                    }
                },
                priority=5,
            )
            
            print(f"\n   ✓ Investigation opened")
            
        elif action == "adjust":
            print(f"\n   📝 Adjusting stock to match physical count...")
            
            await self.message_bus.publish(
                exchange_name="inventory.events",
                routing_key="inventory.stock_adjusted",
                message_body={
                    "event_type": "StockAdjusted",
                    "payload": {
                        "inventory_id": inventory_id,
                        "reason": "physical_count_reconciliation",
                        "adjusted_by": "manager",
                        "adjusted_at": datetime.utcnow().isoformat(),
                    }
                },
                priority=5,
            )
            
            print(f"   ✓ Stock adjusted to physical count")
            
        elif action == "recount":
            print(f"\n   🔄 Requesting recount...")
            print(f"   Assigning to different staff member...")
            
            await self.message_bus.publish(
                exchange_name="operations.events",
                routing_key="operations.recount_requested",
                message_body={
                    "event_type": "RecountRequested",
                    "payload": {
                        "inventory_id": inventory_id,
                        "wine_name": wine_name,
                        "requested_at": datetime.utcnow().isoformat(),
                    }
                },
                priority=5,
            )
            
            print(f"   ✓ Recount task created")
        
        return {
            "inventory_id": inventory_id,
            "action": action,
            "result": "success",
        }
    
    async def scenario_4_batch_count_with_discrepancies(
        self,
        num_items: int = 5,
        discrepancy_rate: float = 0.3,
    ) -> Dict[str, Any]:
        """
        Scenario 4: Batch inventory count with multiple discrepancies
        
        Simulates a full inventory count session where some items
        have discrepancies.
        """
        print(f"\n{'='*60}")
        print("SCENARIO 4: Batch Inventory Count")
        print(f"{'='*60}")
        
        # Get restaurant
        restaurants = self.db.supabase.table("restaurants").select("id").limit(1).execute()
        if not restaurants.data:
            print("   ⚠️ No restaurant found")
            return {"error": "No restaurant"}
        
        restaurant_id = restaurants.data[0]["id"]
        
        print(f"\n📱 Starting batch count session...")
        print(f"   Items to count: {num_items}")
        print(f"   Expected discrepancy rate: {discrepancy_rate*100:.0f}%")
        
        # Run simulated count session
        results = await self.mobile_simulator.run_count_session(
            restaurant_id=restaurant_id,
            items_to_count=num_items,
            simulate_discrepancies=True,
            discrepancy_rate=discrepancy_rate,
        )
        
        print(f"\n📊 Session Results:")
        print(f"   Items Counted: {results.get('total_items_counted', 0)}")
        print(f"   With Discrepancy: {results.get('items_with_discrepancy', 0)}")
        print(f"   Total Bottles Off: {results.get('total_discrepancy_bottles', 0)}")
        
        return results
    
    async def run_all_scenarios(self):
        """Run all inventory discrepancy scenarios"""
        print("\n" + "="*70)
        print("📦 INVENTORY DISCREPANCY SCENARIOS")
        print("="*70)
        
        try:
            await self.setup()
            
            # Scenario 1: Shrinkage
            result1 = await self.scenario_1_shrinkage(
                wine_name="Caymus Cabernet",
                stock_live=10,
                sales_today=2,
                actual_physical=7,
            )
            
            await asyncio.sleep(1)
            
            # Scenario 2: Surplus
            result2 = await self.scenario_2_surplus(
                wine_name="Silver Oak Cabernet",
                stock_live=8,
                actual_physical=10,
            )
            
            await asyncio.sleep(1)
            
            # Scenario 3: Investigation
            result3 = await self.scenario_3_investigation_flow(
                inventory_id=result1["inventory_id"],
                wine_name=result1["wine_name"],
                action="investigate",
            )
            
            await asyncio.sleep(1)
            
            # Scenario 4: Batch count
            result4 = await self.scenario_4_batch_count_with_discrepancies(
                num_items=3,
                discrepancy_rate=0.5,
            )
            
            # Summary
            print(f"\n{'='*70}")
            print("📊 SCENARIO SUMMARY")
            print(f"{'='*70}")
            print(f"   Scenario 1 (Shrinkage): {result1.get('unaccounted', 0)} bottles unaccounted")
            print(f"   Scenario 2 (Surplus): +{result2.get('discrepancy', 0)} bottles extra")
            print(f"   Scenario 3 (Investigation): {result3.get('action', 'N/A')}")
            print(f"   Scenario 4 (Batch): {result4.get('items_with_discrepancy', 0)} discrepancies")
            
        finally:
            await self.teardown()


async def main():
    scenario = InventoryDiscrepancyScenario()
    await scenario.run_all_scenarios()


if __name__ == "__main__":
    asyncio.run(main())

