"""
Vintage Mismatch Scenario
=========================
Standalone scenario for testing vintage mismatch detection.

Scenarios:
1. Ordered 2019, received 2020
2. Barcode shows different vintage than invoice
3. Manager approval flow

Usage:
    python demo/demo_scenarios/vintage_mismatch.py
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


class VintageMismatchScenario:
    """
    Vintage Mismatch Detection Scenario
    
    Tests:
    - OCR scanning detecting vintage
    - Comparison with order vintage
    - Manager notification with action buttons
    - Approval/rejection flow
    """
    
    def __init__(self):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
    
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
        
        print("   ✅ Connected")
    
    async def teardown(self):
        """Cleanup"""
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
    
    async def scenario_1_invoice_vintage_mismatch(
        self,
        wine_name: str = "Château Margaux",
        ordered_vintage: int = 2019,
        received_vintage: int = 2020,
    ) -> Dict[str, Any]:
        """
        Scenario 1: Invoice shows different vintage than ordered
        
        Flow:
        1. Order created for 2019 vintage
        2. Delivery arrives
        3. OCR scans invoice → detects 2020
        4. System compares → MISMATCH
        5. Manager notified: "SKU is 2019 but they sent 2020. Update?"
        """
        print(f"\n{'='*60}")
        print("SCENARIO 1: Invoice Vintage Mismatch")
        print(f"{'='*60}")
        
        order_id = str(uuid4())
        
        print(f"\n📋 Order Details:")
        print(f"   Wine: {wine_name}")
        print(f"   Ordered Vintage: {ordered_vintage}")
        
        # Simulate OCR scan
        print(f"\n🔍 Scanning invoice...")
        await asyncio.sleep(1)
        print(f"   OCR Result: {wine_name} {received_vintage}")
        
        # Detect mismatch
        mismatch = ordered_vintage != received_vintage
        
        if mismatch:
            print(f"\n⚠️ VINTAGE MISMATCH DETECTED!")
            print(f"   Expected: {ordered_vintage}")
            print(f"   Received: {received_vintage}")
            
            # Send notification
            await self.message_bus.publish(
                exchange_name="notification.events",
                routing_key="notification.vintage_mismatch",
                message_body={
                    "event_type": "VintageMismatchAlert",
                    "payload": {
                        "order_id": order_id,
                        "wine_name": wine_name,
                        "expected_vintage": ordered_vintage,
                        "received_vintage": received_vintage,
                        "message": f"SKU is {ordered_vintage} but they sent {received_vintage}. Update?",
                        "action_buttons": [
                            {"id": "approve_change", "label": f"Accept {received_vintage}"},
                            {"id": "reject_delivery", "label": "Reject Delivery"},
                            {"id": "contact_vendor", "label": "Contact Vendor"},
                        ],
                    }
                },
                priority=9,
            )
            
            print(f"\n📱 Manager Notification Sent:")
            print(f"   \"SKU is {ordered_vintage} but they sent {received_vintage}. Update?\"")
            print(f"   [Accept {received_vintage}] [Reject Delivery] [Contact Vendor]")
        
        return {
            "order_id": order_id,
            "wine_name": wine_name,
            "ordered_vintage": ordered_vintage,
            "received_vintage": received_vintage,
            "mismatch_detected": mismatch,
        }
    
    async def scenario_2_barcode_vintage_mismatch(
        self,
        wine_name: str = "Opus One",
        barcode: str = "0123456789012",
        barcode_vintage: int = 2018,
        invoice_vintage: int = 2019,
    ) -> Dict[str, Any]:
        """
        Scenario 2: Barcode shows different vintage than invoice
        
        Flow:
        1. Staff scans barcode on bottle
        2. System looks up barcode → 2018 vintage
        3. Invoice shows 2019
        4. MISMATCH between barcode and invoice
        5. Manager notified to verify
        """
        print(f"\n{'='*60}")
        print("SCENARIO 2: Barcode vs Invoice Mismatch")
        print(f"{'='*60}")
        
        order_id = str(uuid4())
        
        print(f"\n📋 Delivery Details:")
        print(f"   Wine: {wine_name}")
        print(f"   Invoice Vintage: {invoice_vintage}")
        
        # Simulate barcode scan
        print(f"\n📷 Scanning barcode: {barcode}")
        await asyncio.sleep(0.5)
        
        # Lookup barcode (mock)
        print(f"   Barcode Database: {wine_name} {barcode_vintage}")
        
        # Detect mismatch
        mismatch = barcode_vintage != invoice_vintage
        
        if mismatch:
            print(f"\n⚠️ VINTAGE CONFLICT!")
            print(f"   Barcode shows: {barcode_vintage}")
            print(f"   Invoice shows: {invoice_vintage}")
            print(f"   Which is correct?")
            
            # Send notification
            await self.message_bus.publish(
                exchange_name="notification.events",
                routing_key="notification.vintage_conflict",
                message_body={
                    "event_type": "VintageConflictAlert",
                    "payload": {
                        "order_id": order_id,
                        "wine_name": wine_name,
                        "barcode": barcode,
                        "barcode_vintage": barcode_vintage,
                        "invoice_vintage": invoice_vintage,
                        "message": f"Barcode shows {barcode_vintage} but invoice shows {invoice_vintage}. Please verify.",
                        "action_buttons": [
                            {"id": "use_barcode", "label": f"Use Barcode ({barcode_vintage})"},
                            {"id": "use_invoice", "label": f"Use Invoice ({invoice_vintage})"},
                            {"id": "manual_check", "label": "Manual Check"},
                        ],
                    }
                },
                priority=7,
            )
            
            print(f"\n📱 Manager Notification Sent:")
            print(f"   \"Barcode shows {barcode_vintage} but invoice shows {invoice_vintage}. Please verify.\"")
        
        return {
            "order_id": order_id,
            "wine_name": wine_name,
            "barcode": barcode,
            "barcode_vintage": barcode_vintage,
            "invoice_vintage": invoice_vintage,
            "mismatch_detected": mismatch,
        }
    
    async def scenario_3_manager_approval_flow(
        self,
        order_id: str,
        action: str = "approve_change",
        new_vintage: int = 2020,
    ) -> Dict[str, Any]:
        """
        Scenario 3: Manager approval/rejection flow
        
        Actions:
        - approve_change: Accept the new vintage, update inventory
        - reject_delivery: Reject and contact vendor
        - contact_vendor: Keep pending, initiate contact
        """
        print(f"\n{'='*60}")
        print("SCENARIO 3: Manager Approval Flow")
        print(f"{'='*60}")
        
        print(f"\n👤 Manager Action: {action}")
        
        if action == "approve_change":
            print(f"\n   ✅ Vintage change approved!")
            print(f"   Updating inventory to {new_vintage}...")
            
            # Publish approval event
            await self.message_bus.publish(
                exchange_name="inventory.events",
                routing_key="inventory.vintage_updated",
                message_body={
                    "event_type": "VintageUpdated",
                    "payload": {
                        "order_id": order_id,
                        "new_vintage": new_vintage,
                        "approved_by": "manager",
                        "approved_at": datetime.utcnow().isoformat(),
                    }
                },
                priority=5,
            )
            
            print(f"   ✓ Inventory updated to {new_vintage}")
            
        elif action == "reject_delivery":
            print(f"\n   ❌ Delivery rejected!")
            print(f"   Initiating return process...")
            
            # Publish rejection event
            await self.message_bus.publish(
                exchange_name="procurement.events",
                routing_key="procurement.delivery_rejected",
                message_body={
                    "event_type": "DeliveryRejected",
                    "payload": {
                        "order_id": order_id,
                        "reason": "vintage_mismatch",
                        "rejected_by": "manager",
                    }
                },
                priority=7,
            )
            
            print(f"   ✓ Vendor notified of rejection")
            
        elif action == "contact_vendor":
            print(f"\n   📞 Contacting vendor...")
            print(f"   Order status: PENDING_VERIFICATION")
            
        return {
            "order_id": order_id,
            "action": action,
            "result": "success",
        }
    
    async def run_all_scenarios(self):
        """Run all vintage mismatch scenarios"""
        print("\n" + "="*70)
        print("🍷 VINTAGE MISMATCH SCENARIOS")
        print("="*70)
        
        try:
            await self.setup()
            
            # Scenario 1
            result1 = await self.scenario_1_invoice_vintage_mismatch(
                wine_name="Château Margaux",
                ordered_vintage=2019,
                received_vintage=2020,
            )
            
            await asyncio.sleep(1)
            
            # Scenario 2
            result2 = await self.scenario_2_barcode_vintage_mismatch(
                wine_name="Opus One",
                barcode="0123456789012",
                barcode_vintage=2018,
                invoice_vintage=2019,
            )
            
            await asyncio.sleep(1)
            
            # Scenario 3: Manager approves the first mismatch
            result3 = await self.scenario_3_manager_approval_flow(
                order_id=result1["order_id"],
                action="approve_change",
                new_vintage=2020,
            )
            
            # Summary
            print(f"\n{'='*70}")
            print("📊 SCENARIO SUMMARY")
            print(f"{'='*70}")
            print(f"   Scenario 1: {'✅ Mismatch detected' if result1['mismatch_detected'] else '✓ OK'}")
            print(f"   Scenario 2: {'✅ Conflict detected' if result2['mismatch_detected'] else '✓ OK'}")
            print(f"   Scenario 3: Manager action = {result3['action']}")
            
        finally:
            await self.teardown()


async def main():
    scenario = VintageMismatchScenario()
    await scenario.run_all_scenarios()


if __name__ == "__main__":
    asyncio.run(main())

