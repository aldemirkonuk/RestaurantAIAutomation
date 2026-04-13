"""
Realtime Week Demo - Monday 9am to 1am
======================================
Accelerated demo that compresses a full Monday into ~10 minutes.

Timeline:
- 9:00 AM  - Weekly Report (from past week)
- 12:00 PM - Delivery Arrives (vintage mismatch, wine type mismatch)
- 2:00 PM  - Inventory Count (discrepancy detection)
- 4:00 PM  - Low Stock Alert (one-tap order)
- 5:00 PM  - Order Approval
- 5:00 PM - 1:00 AM - Toast API Sync (continuous sales)

Usage:
    python demo/demo_realtime_week.py
    python demo/demo_realtime_week.py --use-real-toast
    python demo/demo_realtime_week.py --time 12pm  # Just delivery scenario
"""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from uuid import uuid4
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings

# Import our new services
from services.toast_api_client import ToastAPIClient
from services.inventory_count_service import InventoryCountService
from services.mobile_count_simulator import MobileCountSimulator


class RealtimeWeekDemo:
    """
    Accelerated Monday Demo
    
    Simulates a full day of restaurant operations:
    - Weekly reports
    - Delivery verification with mismatches
    - Inventory counting with discrepancies
    - Low stock alerts with one-tap ordering
    - Continuous Toast POS sales sync
    """
    
    def __init__(
        self,
        use_real_toast: bool = False,
        specific_time: Optional[str] = None,
        accelerated: bool = True,
    ):
        self.settings = get_settings()
        self.use_real_toast = use_real_toast
        self.specific_time = specific_time
        self.accelerated = accelerated
        
        # Components
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
        self.toast_client: Optional[ToastAPIClient] = None
        self.inventory_service: Optional[InventoryCountService] = None
        self.mobile_simulator: Optional[MobileCountSimulator] = None
        
        # Demo data
        self.restaurant_id: Optional[str] = None
        self.restaurant_name: str = "Demo Restaurant"
        self.demo_orders: List[str] = []
        self.demo_inventory: List[str] = []
        
        # Timing (accelerated vs real)
        self.time_scale = 1/60 if accelerated else 1  # 1 minute = 1 second in accelerated
        
    async def setup(self):
        """Initialize all components"""
        print("\n" + "="*70)
        print("🔌 SETTING UP REALTIME WEEK DEMO")
        print("="*70)
        
        # Database
        self.db = DatabaseClient(
            supabase_url=self.settings.supabase_url,
            supabase_key=self.settings.supabase_service_role_key,
            redis_url=self.settings.redis_url,
        )
        await self.db.connect()
        print("   ✅ Database connected")
        
        # Message Bus
        self.message_bus = MessageBus(self.settings.rabbitmq_url)
        await self.message_bus.connect()
        print("   ✅ Message bus connected")
        
        # Toast API Client
        self.toast_client = ToastAPIClient(
            mock_mode=not self.use_real_toast,
        )
        await self.toast_client.connect()
        print(f"   ✅ Toast API client ({('REAL' if self.use_real_toast else 'MOCK')} mode)")
        
        # Inventory Services
        self.inventory_service = InventoryCountService(self.db, self.message_bus)
        self.mobile_simulator = MobileCountSimulator(self.db, self.inventory_service)
        print("   ✅ Inventory services initialized")
        
        # Get restaurant
        await self._get_or_create_demo_data()
        
    async def teardown(self):
        """Cleanup"""
        if self.toast_client:
            await self.toast_client.disconnect()
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
        print("\n✅ Demo cleanup complete")
    
    async def _get_or_create_demo_data(self):
        """Get or create demo restaurant and inventory"""
        # Get restaurant
        restaurants = self.db.supabase.table("restaurants").select("*").limit(1).execute()
        if restaurants.data:
            self.restaurant_id = restaurants.data[0]["id"]
            self.restaurant_name = restaurants.data[0].get("name", "Demo Restaurant")
            print(f"   ✅ Using restaurant: {self.restaurant_name}")
        else:
            print("   ⚠️ No restaurant found - using demo IDs")
            self.restaurant_id = str(uuid4())
        
        # Get inventory items
        inventory = self.db.supabase.table("restaurant_inventory") \
            .select("id") \
            .eq("restaurant_id", self.restaurant_id) \
            .execute()
        
        self.demo_inventory = [i["id"] for i in (inventory.data or [])]
        print(f"   ✅ Found {len(self.demo_inventory)} inventory items")
    
    def _wait(self, minutes: int):
        """Wait scaled by time acceleration"""
        return asyncio.sleep(minutes * 60 * self.time_scale)
    
    def _print_time(self, time_str: str):
        """Print simulated time header"""
        print("\n" + "="*70)
        print(f"⏰ {time_str}")
        print("="*70)
    
    # =========================================================================
    # TIMELINE SCENARIOS
    # =========================================================================
    
    async def time_9am_weekly_report(self):
        """
        9:00 AM - Weekly Report
        
        Generate and send weekly report from past week's Supabase data.
        """
        self._print_time("9:00 AM - WEEKLY REPORT")
        
        print("\n📊 Generating weekly report from Supabase data...")
        
        # Import and run the LLM-guided report generator
        from demo.demo_weekly_report_llm import WeeklyReportLLM
        
        report_generator = WeeklyReportLLM(
            include_toast=self.use_real_toast,
            send_email=False,  # Preview only for demo
        )
        
        # Run report generation (abbreviated for demo)
        report_generator.db = self.db
        report_generator.message_bus = self.message_bus
        report_generator.restaurant_id = self.restaurant_id
        report_generator.restaurant_name = self.restaurant_name
        
        # Define period
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=7)
        
        print(f"   Period: {start_date.date()} to {end_date.date()}")
        
        # Query data
        print("\n   📈 Querying Supabase...")
        
        sales = await report_generator.query_sales_events(start_date, end_date)
        print(f"   ✓ sales_events: {len(sales.value) if sales.is_available() else 0} rows")
        
        orders = await report_generator.query_procurement_orders(start_date, end_date)
        print(f"   ✓ procurement_orders: {len(orders.value) if orders.is_available() else 0} rows")
        
        inventory = await report_generator.query_inventory()
        print(f"   ✓ restaurant_inventory: {len(inventory.value) if inventory.is_available() else 0} rows")
        
        # Aggregate
        report_data = report_generator.aggregate_report_data(
            sales_data=sales,
            orders_data=orders,
            inventory_data=inventory,
            providers_data=await report_generator.query_providers(),
            period_start=start_date,
            period_end=end_date,
        )
        
        # Generate email
        subject = report_generator.generate_gmail_subject(report_data)
        body = report_generator.generate_gmail_body(report_data)
        
        print(f"\n   📧 Report Generated:")
        print(f"   Subject: {subject}")
        print(f"   Body: {len(body)} characters")
        
        # Publish event
        await self.message_bus.publish(
            exchange_name="notification.events",
            routing_key="notification.weekly_report",
            message_body={
                "event_type": "WeeklyReportGenerated",
                "payload": {
                    "restaurant_id": self.restaurant_id,
                    "report_data": report_data,
                    "subject": subject,
                }
            },
            priority=5,
        )
        
        print("\n   ✅ Weekly report sent to manager!")
        
        await self._wait(5)  # 5 minutes
    
    async def time_12pm_delivery_verification(self):
        """
        12:00 PM - Delivery Arrives
        
        Scenarios:
        1. Vintage mismatch: Ordered 2019, received 2020
        2. Wine type mismatch: Ordered red, received white
        """
        self._print_time("12:00 PM - DELIVERY ARRIVES")
        
        print("\n🚚 Delivery truck arrives with orders...")
        
        # Create demo orders if needed
        await self._ensure_demo_orders()
        
        # Scenario 1: Vintage Mismatch
        print("\n" + "-"*50)
        print("📦 SCENARIO 1: Vintage Mismatch")
        print("-"*50)
        
        wine_name = "Château Demo Reserve"
        ordered_vintage = 2019
        received_vintage = 2020
        
        print(f"   Wine: {wine_name}")
        print(f"   Ordered: {ordered_vintage}")
        print(f"   Received: {received_vintage}")
        
        # Simulate OCR scan detecting vintage
        print("\n   🔍 Scanning invoice with OCR...")
        await asyncio.sleep(1)
        print(f"   ✓ OCR detected vintage: {received_vintage}")
        
        # Detect mismatch
        print(f"\n   ⚠️ MISMATCH DETECTED!")
        print(f"   SKU is {ordered_vintage} but they sent {received_vintage}")
        
        # Send notification
        await self.message_bus.publish(
            exchange_name="notification.events",
            routing_key="notification.vintage_mismatch",
            message_body={
                "event_type": "VintageMismatchAlert",
                "payload": {
                    "type": "vintage_mismatch",
                    "restaurant_id": self.restaurant_id,
                    "order_id": self.demo_orders[0] if self.demo_orders else str(uuid4()),
                    "wine_name": wine_name,
                    "expected_vintage": ordered_vintage,
                    "received_vintage": received_vintage,
                    "title": "⚠️ Vintage Mismatch Detected",
                    "message": f"SKU is {ordered_vintage} but they sent {received_vintage}. Do you want to update?",
                    "action_buttons": [
                        {"id": "approve", "label": f"Accept {received_vintage}"},
                        {"id": "reject", "label": "Reject Delivery"},
                        {"id": "contact", "label": "Contact Vendor"},
                    ],
                }
            },
            priority=9,
        )
        
        print("\n   📱 Push notification sent to manager:")
        print(f"   \"SKU is {ordered_vintage} but they sent {received_vintage}. Do you want to update?\"")
        print("   [Accept 2020] [Reject Delivery] [Contact Vendor]")
        
        await self._wait(2)
        
        # Scenario 2: Wine Type Mismatch
        print("\n" + "-"*50)
        print("📦 SCENARIO 2: Wine Type Mismatch")
        print("-"*50)
        
        wine_name_2 = "Domaine Demo Burgundy"
        vintage_2 = 2021
        ordered_type = "red"
        received_type = "white"
        
        print(f"   Wine: {wine_name_2} {vintage_2}")
        print(f"   Ordered: {ordered_type}")
        print(f"   Received: {received_type}")
        
        # Simulate visual inspection
        print("\n   🔍 Visual verification...")
        await asyncio.sleep(1)
        print(f"   ✓ Wine type detected: {received_type}")
        
        # Detect mismatch
        print(f"\n   🚨 WRONG WINE DELIVERED!")
        print(f"   Ordered {vintage_2} {ordered_type}, got {vintage_2} {received_type}")
        
        # Send notification
        await self.message_bus.publish(
            exchange_name="notification.events",
            routing_key="notification.wine_type_mismatch",
            message_body={
                "event_type": "WineTypeMismatchAlert",
                "payload": {
                    "type": "wine_type_mismatch",
                    "priority": "critical",
                    "restaurant_id": self.restaurant_id,
                    "order_id": self.demo_orders[1] if len(self.demo_orders) > 1 else str(uuid4()),
                    "wine_name": wine_name_2,
                    "vintage": vintage_2,
                    "expected_type": ordered_type,
                    "received_type": received_type,
                    "title": "🚨 Wrong Wine Delivered",
                    "message": f"Ordered {vintage_2} {ordered_type}, got {vintage_2} {received_type}",
                }
            },
            priority=10,
        )
        
        print("\n   📱 CRITICAL notification sent to manager:")
        print(f"   \"An order has been delivered wrong!\"")
        print(f"   \"Ordered {vintage_2} {ordered_type}, got {vintage_2} {received_type}\"")
        print("   [Accept White] [Reject & Return] [Call Vendor]")
        
        await self._wait(3)
    
    async def time_2pm_inventory_count(self):
        """
        2:00 PM - Inventory Count
        
        Physical count via mobile app with discrepancy detection.
        Scenario: "sold 2 bottles but we're down 3"
        """
        self._print_time("2:00 PM - INVENTORY COUNT")
        
        print("\n📱 Staff begins physical inventory count via mobile app...")
        
        if not self.demo_inventory:
            print("   ⚠️ No inventory items found - creating demo scenario")
            await self._create_demo_inventory_for_count()
        
        # Start count session
        session_id = await self.mobile_simulator.start_count_session(
            restaurant_id=self.restaurant_id,
            staff_name="Alex M."
        )
        print(f"   ✓ Count session started: {session_id[:8]}...")
        
        # Scenario: Discrepancy
        print("\n" + "-"*50)
        print("📦 SCENARIO: Inventory Discrepancy")
        print("-"*50)
        
        if self.demo_inventory:
            inventory_id = self.demo_inventory[0]
            
            # Get current stock
            item = self.db.supabase.table("restaurant_inventory") \
                .select("*, master_wine_library(name)") \
                .eq("id", inventory_id) \
                .single() \
                .execute()
            
            if item.data:
                wine_name = item.data.get("master_wine_library", {}).get("name", "Demo Wine")
                stock_live = item.data.get("stock_live", 10)
                
                # Simulate: System shows 10, sold 2 today, but physical count is 7
                # This means we're down 3 (2 sales + 1 unaccounted)
                sales_today = 2
                actual_missing = 1
                physical_count = stock_live - actual_missing
                
                print(f"\n   Wine: {wine_name}")
                print(f"   System stock: {stock_live} bottles")
                print(f"   Sales today: {sales_today} bottles")
                print(f"   Expected: {stock_live} bottles (sales already deducted)")
                
                # Simulate QR scan
                print("\n   📱 Scanning QR code...")
                await asyncio.sleep(0.5)
                scan_result = await self.mobile_simulator.scan_qr_code(inventory_id)
                print(f"   ✓ Scanned: {scan_result.get('wine_name', 'Unknown')}")
                
                # Record count
                print(f"\n   📱 Staff enters count: {physical_count} bottles")
                await asyncio.sleep(0.5)
                
                result = await self.mobile_simulator.record_count(
                    inventory_id=inventory_id,
                    count=physical_count,
                    location="Cellar A > North Wall > Shelf 2",
                    staff_name="Alex M.",
                )
                
                discrepancy = result.get("discrepancy", 0)
                
                if discrepancy != 0:
                    print(f"\n   ⚠️ DISCREPANCY DETECTED!")
                    print(f"   Expected: {result.get('expected_stock')} bottles")
                    print(f"   Counted: {physical_count} bottles")
                    print(f"   Difference: {discrepancy:+d} bottle(s)")
                    
                    print(f"\n   📱 Notification sent to manager:")
                    print(f"   \"[{wine_name}] has sold but we're down more than expected.\"")
                    print(f"   \"Missing: {abs(discrepancy)} bottle(s)\"")
                    print("   [Investigate] [Adjust Stock] [Recount]")
        
        # End session
        summary = await self.mobile_simulator.end_count_session()
        print(f"\n   ✓ Count session complete: {summary.get('total_items_counted', 0)} items")
        print(f"   ✓ Discrepancies found: {summary.get('items_with_discrepancy', 0)}")
        
        await self._wait(3)
    
    async def time_4pm_low_stock_alert(self):
        """
        4:00 PM - Low Stock Alert
        
        One-tap action to order.
        """
        self._print_time("4:00 PM - LOW STOCK ALERT")
        
        print("\n📉 System detects low stock items...")
        
        # Check for low stock
        if self.demo_inventory:
            inventory_id = self.demo_inventory[0]
            
            item = self.db.supabase.table("restaurant_inventory") \
                .select("*, master_wine_library(name), providers(name)") \
                .eq("id", inventory_id) \
                .single() \
                .execute()
            
            if item.data:
                wine_name = item.data.get("master_wine_library", {}).get("name", "Demo Wine")
                stock_live = item.data.get("stock_live", 3)
                threshold = item.data.get("threshold_min", 4)
                provider_name = item.data.get("providers", {}).get("name", "Demo Vendor") if item.data.get("providers") else "Demo Vendor"
                
                # Simulate low stock scenario
                if stock_live > threshold:
                    # Force low stock for demo
                    stock_live = 3
                    threshold = 4
                
                suggested_qty = 12
                unit_price = 25.00
                estimated_cost = suggested_qty * unit_price
                
                print(f"\n   Wine: {wine_name}")
                print(f"   Current Stock: {stock_live} bottles")
                print(f"   Threshold: {threshold} bottles")
                print(f"   Status: ⚠️ BELOW THRESHOLD")
                
                print(f"\n   🤖 AI Recommendation:")
                print(f"   Order {suggested_qty} bottles from {provider_name}")
                print(f"   Estimated cost: ${estimated_cost:.2f}")
                
                # Send one-tap notification
                await self.message_bus.publish(
                    exchange_name="notification.events",
                    routing_key="notification.low_stock_one_tap",
                    message_body={
                        "event_type": "LowStockOneTapAlert",
                        "payload": {
                            "type": "low_stock_one_tap",
                            "restaurant_id": self.restaurant_id,
                            "inventory_id": inventory_id,
                            "wine_name": wine_name,
                            "current_stock": stock_live,
                            "threshold": threshold,
                            "suggested_quantity": suggested_qty,
                            "provider_name": provider_name,
                            "estimated_cost": estimated_cost,
                            "title": f"⚠️ Low Stock: {wine_name}",
                            "message": f"Tap to order {suggested_qty} bottles from {provider_name}",
                            "one_tap_enabled": True,
                        }
                    },
                    priority=7,
                )
                
                print(f"\n   📱 ONE-TAP notification sent to manager:")
                print(f"   \"⚠️ Low Stock: {wine_name}\"")
                print(f"   \"Stock: {stock_live}/{threshold} - Tap to order {suggested_qty} bottles\"")
                print(f"   [Order {suggested_qty} bottles] [Customize] [Dismiss]")
        
        await self._wait(2)
    
    async def time_5pm_order_approval(self):
        """
        5:00 PM - Order Approval
        
        Manager approves the order via one-tap.
        """
        self._print_time("5:00 PM - ORDER APPROVAL")
        
        print("\n👤 Manager receives notification and approves order...")
        
        # Simulate manager approval
        await asyncio.sleep(1)
        
        print("\n   📱 Manager taps: [Order 12 bottles]")
        await asyncio.sleep(0.5)
        
        print("\n   ✅ Order approved!")
        print("   Creating procurement order...")
        
        # Create order
        order_id = str(uuid4())
        order_number = f"ORD-2026-{random.randint(1000, 9999)}"
        
        if self.demo_inventory:
            inventory_id = self.demo_inventory[0]
            
            # Get provider
            providers = self.db.supabase.table("providers") \
                .select("id, name") \
                .eq("is_active", True) \
                .limit(1) \
                .execute()
            
            provider_id = providers.data[0]["id"] if providers.data else str(uuid4())
            provider_name = providers.data[0]["name"] if providers.data else "Demo Vendor"
            
            # Create order
            self.db.supabase.table("procurement_orders").insert({
                "id": order_id,
                "order_number": order_number,
                "restaurant_id": self.restaurant_id,
                "inventory_id": inventory_id,
                "provider_id": provider_id,
                "quantity": 12,
                "unit_type": "bottles",
                "bottles_total": 12,
                "quoted_price": 25.00,
                "final_price": 25.00,
                "total_cost": 300.00,
                "status": "APPROVED",
                "approved_at": datetime.utcnow().isoformat(),
                "priority_level": 7,
            }).execute()
            
            self.demo_orders.append(order_id)
            
            print(f"\n   ✅ Order Created:")
            print(f"   Order #: {order_number}")
            print(f"   Vendor: {provider_name}")
            print(f"   Quantity: 12 bottles")
            print(f"   Total: $300.00")
            print(f"   Status: APPROVED")
        
        # Send confirmation
        await self.message_bus.publish(
            exchange_name="procurement.events",
            routing_key="procurement.order_approved",
            message_body={
                "event_type": "OrderApproved",
                "payload": {
                    "order_id": order_id,
                    "order_number": order_number,
                    "restaurant_id": self.restaurant_id,
                }
            },
            priority=5,  # NORMAL priority
        )
        
        print("\n   📧 Confirmation sent to vendor")
        print("   📱 Push notification: \"Order confirmed!\"")
        
        await self._wait(2)
    
    async def time_evening_toast_sync(self):
        """
        5:00 PM - 1:00 AM - Continuous Toast Sync
        
        Toast API streams sales data, updating stock in real-time.
        Low stock alerts triggered as needed.
        """
        self._print_time("5:00 PM - 1:00 AM - TOAST SALES SYNC")
        
        print("\n🍷 Starting Toast POS sales sync...")
        print(f"   Mode: {'REAL API' if self.use_real_toast else 'MOCK DATA'}")
        print("   Simulating 8 hours of sales (accelerated)...")
        
        # Track sales
        total_sales = 0
        total_revenue = 0.0
        low_stock_alerts_sent = 0
        
        # Simulate 8 hours (5pm to 1am)
        hours = ["5 PM", "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM", "12 AM", "1 AM"]
        
        for i, hour in enumerate(hours):
            print(f"\n   ⏰ {hour}")
            
            # Fetch sales for this hour
            start_time = datetime.utcnow() - timedelta(hours=8-i)
            end_time = start_time + timedelta(hours=1)
            
            sales = await self.toast_client.fetch_sales_data(start_time, end_time)
            
            hour_sales = len(sales)
            hour_revenue = sum(s.get("total_price", 0) for s in sales)
            
            total_sales += hour_sales
            total_revenue += hour_revenue
            
            print(f"      Sales: {hour_sales} transactions")
            print(f"      Revenue: ${hour_revenue:.2f}")
            
            # Process sales - update inventory
            for sale in sales:
                # In real system, this would update stock_live
                pass
            
            # Check for low stock (simulate)
            if random.random() < 0.2:  # 20% chance per hour
                low_stock_alerts_sent += 1
                wine = random.choice(self.toast_client.MOCK_WINES)
                print(f"      ⚠️ Low stock alert: {wine['name']}")
            
            await self._wait(1)  # 1 minute = 1 hour accelerated
        
        # Summary
        print("\n" + "-"*50)
        print("📊 TOAST SYNC SUMMARY")
        print("-"*50)
        print(f"   Total Sales: {total_sales} transactions")
        print(f"   Total Revenue: ${total_revenue:.2f}")
        print(f"   Low Stock Alerts: {low_stock_alerts_sent}")
        
        stats = self.toast_client.get_statistics()
        print(f"\n   Toast API Stats:")
        print(f"   - Mode: {stats['mode']}")
        print(f"   - API Calls: {stats['total_api_calls']}")
        print(f"   - Sales Fetched: {stats['total_sales_fetched']}")
    
    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    
    async def _ensure_demo_orders(self):
        """Ensure we have demo orders for delivery scenarios"""
        if not self.demo_orders:
            # Create demo orders
            for i in range(2):
                order_id = str(uuid4())
                self.demo_orders.append(order_id)
    
    async def _create_demo_inventory_for_count(self):
        """Create demo inventory if none exists"""
        # This would create inventory items for the count scenario
        pass
    
    # =========================================================================
    # MAIN EXECUTION
    # =========================================================================
    
    async def run(self):
        """Run the full Monday demo"""
        print("\n" + "="*70)
        print("🎬 WINEOPS AI - REALTIME WEEK DEMO")
        print("="*70)
        print(f"Date: Monday, {datetime.now().strftime('%B %d, %Y')}")
        print(f"Mode: {'Accelerated' if self.accelerated else 'Real-time'}")
        print(f"Toast API: {'Real' if self.use_real_toast else 'Mock'}")
        
        if self.specific_time:
            print(f"Running only: {self.specific_time}")
        
        try:
            await self.setup()
            
            # Run timeline
            if not self.specific_time or self.specific_time == "9am":
                await self.time_9am_weekly_report()
            
            if not self.specific_time or self.specific_time == "12pm":
                await self.time_12pm_delivery_verification()
            
            if not self.specific_time or self.specific_time == "2pm":
                await self.time_2pm_inventory_count()
            
            if not self.specific_time or self.specific_time == "4pm":
                await self.time_4pm_low_stock_alert()
            
            if not self.specific_time or self.specific_time == "5pm":
                await self.time_5pm_order_approval()
            
            if not self.specific_time or self.specific_time == "evening":
                await self.time_evening_toast_sync()
            
            # Final summary
            print("\n" + "="*70)
            print("🎉 DEMO COMPLETE!")
            print("="*70)
            print("\n📊 Summary:")
            print(f"   Restaurant: {self.restaurant_name}")
            print(f"   Orders Created: {len(self.demo_orders)}")
            print(f"   Inventory Items: {len(self.demo_inventory)}")
            
            if self.toast_client:
                stats = self.toast_client.get_statistics()
                print(f"   Toast Sales: {stats['total_sales_fetched']}")
            
            if self.mobile_simulator:
                stats = self.mobile_simulator.get_statistics()
                print(f"   QR Scans: {stats['qr_scans']}")
                print(f"   Counts Submitted: {stats['counts_submitted']}")
            
        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await self.teardown()


async def main():
    parser = argparse.ArgumentParser(description="Realtime Week Demo")
    parser.add_argument("--use-real-toast", action="store_true", help="Use real Toast API")
    parser.add_argument("--time", choices=["9am", "12pm", "2pm", "4pm", "5pm", "evening"], help="Run specific time slot")
    parser.add_argument("--real-time", action="store_true", help="Run in real-time (not accelerated)")
    args = parser.parse_args()
    
    demo = RealtimeWeekDemo(
        use_real_toast=args.use_real_toast,
        specific_time=args.time,
        accelerated=not args.real_time,
    )
    await demo.run()


if __name__ == "__main__":
    asyncio.run(main())

