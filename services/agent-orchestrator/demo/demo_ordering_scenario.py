"""
🎬 Demo Ordering Scenario
========================
Full procurement workflow demonstration:

SCENARIO:
1. Low stock detected (threshold=4, current=3)
2. Manager gets push notification
3. Manager approves with price/amount/vendor selection
4. AI sends email/SMS to vendor (using templates)
5. Vendor responds
6. AI summarizes conversation
7. Manager approves (pending → approved)
8. AI confirms order with vendor
9. Order confirmed (status: ordered)
10. Delivery arrives
11. Invoice checking (visual verification)
12. Everything matches
13. Manager finalizes
14. Inventory updated (3 → 16)
15. Vendor sends receipt
16. AI analyzes and updates financial reports

Usage:
    python demo/demo_ordering_scenario.py
"""

import asyncio
from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings


class DemoOrderingScenario:
    """
    Orchestrates the full demo ordering workflow
    """

    def __init__(self):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None

        # Demo data
        self.demo_restaurant_id = None
        self.demo_manager_id = None
        self.demo_inventory_id = None
        self.demo_provider_id = None
        self.demo_order_id = None

    async def setup(self):
        """Initialize connections"""
        print("🔌 Setting up demo environment...")

        # Initialize database
        self.db = DatabaseClient(
            supabase_url=self.settings.supabase_url,
            supabase_key=self.settings.supabase_service_role_key,
            redis_url=self.settings.redis_url,
        )
        await self.db.connect()
        print("   ✅ Database connected")

        # Initialize message bus
        self.message_bus = MessageBus(self.settings.rabbitmq_url)
        await self.message_bus.connect()
        print("   ✅ Message bus connected")

    async def teardown(self):
        """Cleanup connections"""
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
        print("✅ Demo environment cleaned up")

    async def create_demo_data(self):
        """
        Create demo entities in Supabase

        Hierarchy:
        - Master Wine Library → Global wine database (open for all)
        - Wine Library → Restaurant-specific selections
        - Inventory → Physical stock + menu items
        """
        print("\n📦 Creating demo data...")
        print("   Hierarchy: Master Wine Library → Wine Library → Inventory")

        # 1. Get existing restaurant (required - must exist in DB)
        restaurants = (
            self.db.supabase.table("restaurants").select("*").limit(1).execute()
        )
        if restaurants.data:
            self.demo_restaurant_id = restaurants.data[0]["id"]
            print(
                f"   ✅ Using restaurant: {restaurants.data[0].get('name', 'Unknown')}"
            )
        else:
            print("   ❌ No restaurants found in database!")
            print("   Creating demo restaurant...")
            # Create with required slug
            new_restaurant = (
                self.db.supabase.table("restaurants")
                .insert(
                    {
                        "name": "Demo Wine Bar",
                        "slug": "demo-wine-bar",
                        "email": "demo@wineops.ai",
                        "timezone": "America/Los_Angeles",
                    }
                )
                .execute()
            )
            self.demo_restaurant_id = new_restaurant.data[0]["id"]
            print("   ✅ Created restaurant: Demo Wine Bar")

        # 2. Get manager from manager_preferences (no separate managers table)
        manager_prefs = (
            self.db.supabase.table("manager_preferences").select("*").limit(1).execute()
        )
        if manager_prefs.data:
            self.demo_manager_id = manager_prefs.data[0].get(
                "manager_id", "demo-manager"
            )
            print(f"   ✅ Using manager preferences: {self.demo_manager_id}")
        else:
            # Use placeholder - manager_preferences is optional
            self.demo_manager_id = "demo-manager-001"
            print("   ⚠️ No manager preferences - using placeholder")

        # 3. Get or create demo provider
        providers = self.db.supabase.table("providers").select("*").limit(1).execute()
        if providers.data:
            self.demo_provider_id = providers.data[0]["id"]
            provider_name = providers.data[0].get("name", "Unknown")
            print(f"   ✅ Using provider: {provider_name}")
        else:
            new_provider = (
                self.db.supabase.table("providers")
                .insert(
                    {
                        "name": "Demo Wine Distributors",
                        "primary_contact": {
                            "email": "orders@demowine.com",
                            "phone": "+1987654321",
                            "preferred_method": "email",
                        },
                        "lead_time_days": 3,
                        "minimum_order": 6,
                    }
                )
                .execute()
            )
            self.demo_provider_id = new_provider.data[0]["id"]
            print("   ✅ Created provider: Demo Wine Distributors")

        # 4. Create demo wine in MASTER WINE LIBRARY (global catalog - every wine in the world)
        wines = (
            self.db.supabase.table("master_wine_library").select("*").limit(1).execute()
        )
        if wines.data:
            master_wine_id = wines.data[0]["id"]
            print(
                f"   ✅ Using wine from Master Library: {wines.data[0].get('name', 'Unknown')}"
            )
        else:
            new_wine = (
                self.db.supabase.table("master_wine_library")
                .insert(
                    {
                        "wine_id": "WINE_DEMO_001",
                        "name": "Château Demo Reserve",
                        "producer": "Demo Vineyards",
                        "vintage": 2019,
                        "primary_type": "red",
                        "grape_variety": "Cabernet Sauvignon",
                        "country": "USA",
                        "region": "Napa Valley",
                    }
                )
                .execute()
            )
            master_wine_id = new_wine.data[0]["id"]
            print("   ✅ Added to Master Wine Library: Château Demo Reserve 2019")

        # 5. Get or create INVENTORY item with LOW STOCK (threshold=4, current=3)
        # This represents physical stock + menu items at the restaurant
        existing_inventory = (
            self.db.supabase.table("restaurant_inventory")
            .select("*")
            .eq("restaurant_id", self.demo_restaurant_id)
            .eq("master_wine_id", master_wine_id)
            .limit(1)
            .execute()
        )

        if existing_inventory.data:
            self.demo_inventory_id = existing_inventory.data[0]["id"]
            # Reset stock to 3 for demo
            self.db.supabase.table("restaurant_inventory").update(
                {
                    "stock_live": 3,  # Reset to low stock for demo
                    "threshold_min": 4,
                    "inventory_state": "LIVE",
                }
            ).eq("id", self.demo_inventory_id).execute()
            print("   ✅ Using existing inventory (reset to low stock)")
        else:
            self.demo_inventory_id = str(uuid4())
            self.db.supabase.table("restaurant_inventory").insert(
                {
                    "id": self.demo_inventory_id,
                    "restaurant_id": self.demo_restaurant_id,
                    "master_wine_id": master_wine_id,
                    "provider_id": self.demo_provider_id,
                    "stock_live": 3,
                    "threshold_min": 4,
                    "inventory_state": "LIVE",
                    "custom_price": 45.00,
                    "last_purchase_price": 25.00,
                }
            ).execute()
            print("   ✅ Created new inventory item")

        print("\n   📊 INVENTORY STATUS:")
        print("   Wine: Château Demo Reserve 2019")
        print("   Current Stock: 3 bottles")
        print("   Threshold: 4 bottles")
        print("   Status: ⚠️ LOW STOCK (below threshold)")

        print("\n✅ Demo data created successfully!")
        print("   - Restaurant: Demo Wine Bar")
        print("   - Provider: Demo Wine Distributors")
        print("   - Wine: Château Demo Reserve 2019 (in Master Library)")
        print("   - Inventory: 3/4 bottles (needs reorder)")
        return True

    async def step_1_detect_low_stock(self):
        """
        STEP 1: Detect low stock and trigger notification

        Simulates: Buffer Manager evaluates stock → Inequality Detector finds threshold breach
        """
        print("\n" + "=" * 60)
        print("📊 STEP 1: Low Stock Detection")
        print("=" * 60)
        print("   Wine: Château Demo Reserve 2019")
        print("   Current Stock: 3 bottles")
        print("   Threshold: 4 bottles")
        print("   Status: ⚠️ BELOW THRESHOLD")

        # Publish low stock event
        await self.message_bus.publish(
            exchange_name="stock.events",
            routing_key="stock.threshold.breached",
            message_body={
                "event_type": "StockThresholdBreached",
                "timestamp": datetime.utcnow().isoformat(),
                "payload": {
                    "inventory_id": self.demo_inventory_id,
                    "restaurant_id": self.demo_restaurant_id,
                    "wine_name": "Château Demo Reserve 2019",
                    "current_stock": 3,
                    "threshold": 4,
                    "deficit": 1,
                    "urgency": "medium",
                    "suggested_quantity": 12,
                    "primary_provider_id": self.demo_provider_id,
                },
            },
            priority=7,
        )

        print("\n   ✅ Low stock event published to message bus")
        print("   → Notification Agent will send push notification to manager")

        await asyncio.sleep(1)

    async def step_2_manager_push_notification(self):
        """
        STEP 2: Manager receives push notification

        Simulates: Notification Agent sends push notification
        """
        print("\n" + "=" * 60)
        print("📱 STEP 2: Manager Push Notification")
        print("=" * 60)

        notification_payload = {
            "type": "low_stock_alert",
            "title": "⚠️ Low Stock Alert",
            "body": "Château Demo Reserve 2019 is running low (3/4 bottles)",
            "data": {
                "inventory_id": self.demo_inventory_id,
                "wine_name": "Château Demo Reserve 2019",
                "current_stock": 3,
                "threshold": 4,
                "suggested_quantity": 12,
                "estimated_cost": "$300.00",
            },
            "actions": [
                {"id": "approve", "label": "Approve Reorder", "style": "primary"},
                {"id": "customize", "label": "Customize Order", "style": "secondary"},
                {"id": "dismiss", "label": "Dismiss", "style": "text"},
            ],
        }

        print("\n   📲 Push Notification Sent:")
        print(f"   Title: {notification_payload['title']}")
        print(f"   Body: {notification_payload['body']}")
        print("   Actions: Approve | Customize | Dismiss")

        # Publish notification event
        await self.message_bus.publish(
            exchange_name="notification.events",
            routing_key="notification.push.sent",
            message_body={
                "event_type": "PushNotificationSent",
                "timestamp": datetime.utcnow().isoformat(),
                "payload": {
                    "manager_id": self.demo_manager_id,
                    "notification": notification_payload,
                },
            },
            priority=7,
        )

        print("\n   ✅ Push notification sent to manager")

        await asyncio.sleep(1)

    async def step_3_manager_approves_order(self):
        """
        STEP 3: Manager approves and customizes order

        Simulates: Manager taps "Customize Order" and sets parameters
        """
        print("\n" + "=" * 60)
        print("👤 STEP 3: Manager Approves Order")
        print("=" * 60)

        # Manager's decisions
        order_config = {
            "quantity": 12,
            "target_price": 24.00,
            "max_price": 28.00,
            "preferred_vendors": [self.demo_provider_id],
            "delivery_date": (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d"),
            "notes": "Please prioritize this order - running low",
            "communication_preference": {
                "email": True,
                "sms": True,
                "template": "formal_negotiation",
            },
        }

        print("\n   📝 Manager's Order Configuration:")
        print(f"   Quantity: {order_config['quantity']} bottles")
        print(f"   Target Price: ${order_config['target_price']}/bottle")
        print(f"   Max Price: ${order_config['max_price']}/bottle")
        print(f"   Delivery Date: {order_config['delivery_date']}")
        print("   Communication: Email + SMS (Formal Template)")

        # Create procurement order (matching actual schema)
        import random

        order_number = f"ORD-2026-{random.randint(1000, 9999)}"
        self.demo_order_id = str(uuid4())
        self.db.supabase.table("procurement_orders").insert(
            {
                "id": self.demo_order_id,
                "order_number": order_number,
                "restaurant_id": self.demo_restaurant_id,
                "inventory_id": self.demo_inventory_id,
                "provider_id": self.demo_provider_id,
                "quantity": order_config["quantity"],
                "unit_type": "bottles",
                "bottles_total": order_config["quantity"],
                "quoted_price": order_config["target_price"],
                "final_price": order_config["target_price"],
                "total_cost": order_config["quantity"] * order_config["target_price"],
                "status": "PENDING",
                "expected_delivery_date": order_config["delivery_date"],
                "manager_notes": order_config["notes"],
                "priority_level": 7,
            }
        ).execute()

        print(f"\n   ✅ Order created: {self.demo_order_id}")
        print("   Status: NEGOTIATING")

        await asyncio.sleep(1)

    async def step_4_ai_contacts_vendor(self):
        """
        STEP 4: AI sends email/SMS to vendor

        Simulates: Procurement Agent generates and sends negotiation message
        """
        print("\n" + "=" * 60)
        print("🤖 STEP 4: AI Contacts Vendor")
        print("=" * 60)

        # Email template
        email_content = """
Subject: Wine Order Inquiry - Château Demo Reserve 2019

Dear Demo Wine Distributors,

I hope this email finds you well. I am reaching out on behalf of Demo Wine Bar regarding a wine order.

We would like to inquire about the availability and pricing for:
- Wine: Château Demo Reserve 2019
- Quantity: 12 bottles
- Preferred Delivery: Within 3 business days

Based on our previous orders, we were hoping to discuss a price around $24.00 per bottle for this quantity.

Could you please confirm:
1. Current availability
2. Your best price for this quantity
3. Estimated delivery date

Looking forward to your response.

Best regards,
Demo Wine Bar
Powered by WineOps AI
"""

        # SMS template
        sms_content = """
Hi Demo Wine Distributors! Demo Wine Bar here. Looking to order 12 bottles of Château Demo Reserve 2019. Target price: $24/bottle. Can you confirm availability and best price? Thanks!
"""

        print("\n   📧 Email Sent to: orders@demowine.com")
        print(f"   {'-'*50}")
        print(email_content[:500] + "...")

        print("\n   📱 SMS Sent to: +1987654321")
        print(f"   {'-'*50}")
        print(f"   {sms_content.strip()}")

        # Record interaction (uppercase values per schema constraint)
        self.db.supabase.table("order_interactions").insert(
            {
                "order_id": self.demo_order_id,
                "interaction_type": "EMAIL",
                "interaction_direction": "OUTBOUND",
                "ai_summary": "Initial negotiation email sent to vendor",
                "detected_intent": "price_negotiation",
            }
        ).execute()

        self.db.supabase.table("order_interactions").insert(
            {
                "order_id": self.demo_order_id,
                "interaction_type": "SMS",
                "interaction_direction": "OUTBOUND",
                "ai_summary": "Initial negotiation SMS sent to vendor",
                "detected_intent": "price_negotiation",
            }
        ).execute()

        print("\n   ✅ Communications sent and logged")

        await asyncio.sleep(1)

    async def step_5_vendor_responds(self):
        """
        STEP 5: Vendor responds

        Simulates: Vendor replies with availability and pricing
        """
        print("\n" + "=" * 60)
        print("📨 STEP 5: Vendor Responds")
        print("=" * 60)

        vendor_response = """
Hi Demo Wine Bar,

Thank you for your inquiry! Great to hear from you.

For Château Demo Reserve 2019:
- Availability: Yes, we have 24 bottles in stock
- Price: We can offer $25.50 per bottle for 12 bottles
- Delivery: We can deliver by Friday (2 business days)

Let me know if you'd like to proceed!

Best,
Demo Wine Distributors
"""

        print("\n   📧 Vendor Email Response:")
        print(f"   {'-'*50}")
        print(vendor_response)

        # Record vendor response
        self.db.supabase.table("order_interactions").insert(
            {
                "order_id": self.demo_order_id,
                "interaction_type": "EMAIL",
                "interaction_direction": "INBOUND",
                "transcript": vendor_response,
                "ai_summary": "Vendor confirmed availability (24 bottles), offered $25.50/bottle, 2-day delivery",
                "detected_intent": "price_offer",
                "detected_sentiment": "positive",
            }
        ).execute()

        print("\n   ✅ Vendor response received and logged")

        await asyncio.sleep(1)

    async def step_6_ai_summarizes_conversation(self):
        """
        STEP 6: AI summarizes conversation for manager

        Simulates: Procurement Agent analyzes vendor response
        """
        print("\n" + "=" * 60)
        print("🧠 STEP 6: AI Summarizes Conversation")
        print("=" * 60)

        ai_summary = {
            "vendor": "Demo Wine Distributors",
            "wine": "Château Demo Reserve 2019",
            "quantity_available": 24,
            "offered_price": 25.50,
            "target_price": 24.00,
            "price_difference": "+$1.50 (6.25% above target)",
            "delivery_time": "2 business days",
            "recommendation": "APPROVE - Price is within max budget ($28), fast delivery",
            "total_cost": 12 * 25.50,
        }

        print("\n   📊 AI Analysis Summary:")
        print(f"   {'-'*50}")
        print(f"   Vendor: {ai_summary['vendor']}")
        print(f"   Wine: {ai_summary['wine']}")
        print(f"   Available: {ai_summary['quantity_available']} bottles")
        print(f"   Offered Price: ${ai_summary['offered_price']}/bottle")
        print(f"   Your Target: ${ai_summary['target_price']}/bottle")
        print(f"   Difference: {ai_summary['price_difference']}")
        print(f"   Delivery: {ai_summary['delivery_time']}")
        print(f"   Total Cost: ${ai_summary['total_cost']:.2f}")
        print(f"\n   🤖 AI Recommendation: {ai_summary['recommendation']}")

        # Update order with negotiation results
        self.db.supabase.table("procurement_orders").update(
            {
                "negotiated_price": ai_summary["offered_price"],
                "status": "APPROVAL_NEEDED",
            }
        ).eq("id", self.demo_order_id).execute()

        # Send push notification to manager
        await self.message_bus.publish(
            exchange_name="notification.events",
            routing_key="notification.order_approval",
            message_body={
                "event_type": "OrderApprovalRequired",
                "payload": {
                    "manager_id": self.demo_manager_id,
                    "order_id": self.demo_order_id,
                    "summary": ai_summary,
                },
            },
            priority=7,
        )

        print("\n   ✅ Summary sent to manager for final approval")

        await asyncio.sleep(1)

    async def step_7_manager_final_approval(self):
        """
        STEP 7: Manager gives final approval

        Simulates: Manager approves the negotiated price
        """
        print("\n" + "=" * 60)
        print("✅ STEP 7: Manager Final Approval")
        print("=" * 60)

        print("\n   👤 Manager Action: APPROVED")
        print("   Approved Price: $25.50/bottle")
        print("   Approved Quantity: 12 bottles")
        print("   Total: $306.00")

        # Update order status
        self.db.supabase.table("procurement_orders").update(
            {
                "status": "APPROVED",
                "final_price": 25.50,
                "total_cost": 306.00,
                "approved_at": datetime.utcnow().isoformat(),
            }
        ).eq("id", self.demo_order_id).execute()

        print("\n   ✅ Order status: PENDING → APPROVED")

        await asyncio.sleep(1)

    async def step_8_ai_confirms_with_vendor(self):
        """
        STEP 8: AI confirms order with vendor

        Simulates: Procurement Agent sends confirmation to vendor
        """
        print("\n" + "=" * 60)
        print("🤖 STEP 8: AI Confirms Order with Vendor")
        print("=" * 60)

        confirmation_email = """
Subject: Order Confirmation - Château Demo Reserve 2019

Dear Demo Wine Distributors,

We are pleased to confirm our order:

ORDER DETAILS:
- Wine: Château Demo Reserve 2019
- Quantity: 12 bottles
- Agreed Price: $25.50 per bottle
- Total: $306.00
- Delivery: Friday (2 business days)

Please proceed with the order. We look forward to receiving the delivery.

Best regards,
Demo Wine Bar
Powered by WineOps AI
"""

        print("\n   📧 Confirmation Email Sent:")
        print(f"   {'-'*50}")
        print(confirmation_email)

        # Record confirmation
        self.db.supabase.table("order_interactions").insert(
            {
                "order_id": self.demo_order_id,
                "interaction_type": "EMAIL",
                "interaction_direction": "OUTBOUND",
                "ai_summary": "Order confirmation sent to vendor",
                "detected_intent": "order_confirmation",
            }
        ).execute()

        # Update order status
        self.db.supabase.table("procurement_orders").update(
            {
                "status": "CONFIRMED",
                "confirmed_at": datetime.utcnow().isoformat(),
            }
        ).eq("id", self.demo_order_id).execute()

        print("\n   ✅ Order status: APPROVED → CONFIRMED")

        # ============================================================
        # SHADOW STOCK UPDATE - Order confirmed, add to shadow stock
        # ============================================================
        print("\n   📊 Updating Shadow Stock...")
        print("   Previous shadow_stock: 0")
        print("   Adding: +12 bottles (confirmed order)")

        # Update shadow_stock in inventory (order is in transit)
        self.db.supabase.table("restaurant_inventory").update(
            {
                "shadow_stock": 12,  # Order quantity added to shadow
                "in_transit_quantity": 12,  # Mark as in transit
                "inventory_state": "IN_TRANSIT",
            }
        ).eq("id", self.demo_inventory_id).execute()

        print("   New shadow_stock: 12 bottles")
        print("   Status: IN_TRANSIT")
        print("\n   💡 Shadow stock = Confirmed orders not yet delivered")
        print("   💡 Expected total when delivered: 3 + 12 = 15 bottles")

        await asyncio.sleep(1)

    async def step_9_delivery_arrives(self):
        """
        STEP 9: Delivery arrives

        Simulates: Delivery received, invoice captured
        """
        print("\n" + "=" * 60)
        print("📦 STEP 9: Delivery Arrives")
        print("=" * 60)

        print("\n   🚚 Delivery Received!")
        print(f"   Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        print("   Vendor: Demo Wine Distributors")

        # Update order status
        self.db.supabase.table("procurement_orders").update(
            {
                "status": "DELIVERED",
                "delivered_at": datetime.utcnow().isoformat(),
            }
        ).eq("id", self.demo_order_id).execute()

        # Publish delivery event
        await self.message_bus.publish(
            exchange_name="delivery.events",
            routing_key="delivery.received",
            message_body={
                "event_type": "DeliveryReceived",
                "payload": {
                    "order_id": self.demo_order_id,
                    "restaurant_id": self.demo_restaurant_id,
                },
            },
            priority=5,
        )

        print("\n   ✅ Order status: ORDERED → DELIVERED")

        await asyncio.sleep(1)

    async def step_10_invoice_verification(self):
        """
        STEP 10: Invoice checking (Visual Verification Agent)

        Simulates: AI scans and verifies invoice
        """
        print("\n" + "=" * 60)
        print("🔍 STEP 10: Invoice Verification")
        print("=" * 60)

        # Simulated invoice data (would come from OCR)
        invoice_data = {
            "vendor": "Demo Wine Distributors",
            "invoice_number": "INV-2026-001234",
            "wine": "Château Demo Reserve 2019",
            "quantity": 12,
            "price_per_bottle": 25.50,
            "total": 306.00,
            "vintage": 2019,
        }

        # Order data

        print("\n   📄 Invoice Scanned (OCR):")
        print(f"   {'-'*50}")
        print(f"   Invoice #: {invoice_data['invoice_number']}")
        print(f"   Wine: {invoice_data['wine']}")
        print(f"   Quantity: {invoice_data['quantity']} bottles")
        print(f"   Price: ${invoice_data['price_per_bottle']}/bottle")
        print(f"   Total: ${invoice_data['total']}")

        print("\n   🔎 Verification Results:")
        print(f"   {'-'*50}")
        print("   Wine Name: ✅ MATCH")
        print("   Quantity: ✅ MATCH (12 = 12)")
        print("   Price: ✅ MATCH ($25.50 = $25.50)")
        print("   Total: ✅ MATCH ($306.00 = $306.00)")
        print("   Vintage: ✅ MATCH (2019)")

        # Note: Invoice verification is tracked in procurement_orders.price_verified
        # The order_interactions table only tracks VOICE/SMS/EMAIL/WHATSAPP
        print("   📝 Verification logged to order record")

        print("\n   ✅ All verification checks passed!")

        await asyncio.sleep(1)

    async def step_11_manager_finalizes(self):
        """
        STEP 11: Manager finalizes order

        Simulates: Manager confirms delivery is complete
        """
        print("\n" + "=" * 60)
        print("✅ STEP 11: Manager Finalizes Order")
        print("=" * 60)

        print("\n   👤 Manager Action: FINALIZE ORDER")
        print("   Verification: All items received and verified")

        # Update order status
        self.db.supabase.table("procurement_orders").update(
            {
                "status": "COMPLETED",
                "completed_at": datetime.utcnow().isoformat(),
                "quantity_received": 12,
                "price_verified": True,
            }
        ).eq("id", self.demo_order_id).execute()

        print("\n   ✅ Order status: DELIVERED → COMPLETED")

        await asyncio.sleep(1)

    async def step_12_inventory_updated(self):
        """
        STEP 12: Inventory is updated

        Simulates: Inventory Engine updates stock levels
        """
        print("\n" + "=" * 60)
        print("📊 STEP 12: Inventory Updated")
        print("=" * 60)

        print("\n   📦 Inventory Update:")
        print(f"   {'-'*50}")
        print("   Wine: Château Demo Reserve 2019")
        print("   Previous Stock: 3 bottles")
        print("   Received: +12 bottles")
        print("   New Stock: 15 bottles")
        print("   Threshold: 4 bottles")
        print("   Status: ✅ ABOVE THRESHOLD")

        # Update inventory - clear shadow stock, update live stock
        self.db.supabase.table("restaurant_inventory").update(
            {
                "stock_live": 15,  # 3 + 12 = 15
                "shadow_stock": 0,  # Clear shadow - order delivered
                "in_transit_quantity": 0,  # Clear in transit
                "inventory_state": "LIVE",
            }
        ).eq("id", self.demo_inventory_id).execute()

        print("\n   📊 Shadow Stock Cleared:")
        print("   shadow_stock: 12 → 0 (delivered)")
        print("   in_transit: 12 → 0 (received)")
        print("   stock_live: 3 → 15 (updated)")

        # Publish stock update event
        await self.message_bus.publish(
            exchange_name="stock.events",
            routing_key="stock.restocked",
            message_body={
                "event_type": "StockRestocked",
                "payload": {
                    "inventory_id": self.demo_inventory_id,
                    "previous_stock": 3,
                    "added_quantity": 12,
                    "new_stock": 15,
                },
            },
            priority=5,
        )

        print("\n   ✅ Inventory updated: 3 → 15 bottles")

        await asyncio.sleep(1)

    async def step_13_financial_reports_updated(self):
        """
        STEP 13: Financial reports updated

        Simulates: Reporting Agent updates financial data
        """
        print("\n" + "=" * 60)
        print("📈 STEP 13: Financial Reports Updated")
        print("=" * 60)

        financial_update = {
            "order_id": self.demo_order_id,
            "vendor": "Demo Wine Distributors",
            "wine": "Château Demo Reserve 2019",
            "quantity": 12,
            "unit_cost": 25.50,
            "total_cost": 306.00,
            "category": "Wine Procurement",
            "date": datetime.now().strftime("%Y-%m-%d"),
        }

        print("\n   💰 Financial Record Created:")
        print(f"   {'-'*50}")
        print(f"   Category: {financial_update['category']}")
        print(f"   Vendor: {financial_update['vendor']}")
        print(f"   Item: {financial_update['wine']}")
        print(f"   Quantity: {financial_update['quantity']} bottles")
        print(f"   Unit Cost: ${financial_update['unit_cost']}")
        print(f"   Total Cost: ${financial_update['total_cost']}")

        print("\n   📊 Updated Reports:")
        print("   - Daily Procurement Report")
        print("   - Weekly Financial Summary")
        print("   - Vendor Payment Tracking")
        print("   - Inventory Cost Analysis")

        print("\n   ✅ Financial reports updated")

        await asyncio.sleep(1)

    async def run_full_scenario(self):
        """Run the complete demo scenario"""
        print("\n" + "=" * 70)
        print("🎬 WINEOPS AI - DEMO ORDERING SCENARIO")
        print("=" * 70)
        print("\nThis demo simulates the complete procurement workflow:")
        print(
            "Low Stock → Notification → Approval → Negotiation → Order → Delivery → Update"
        )

        try:
            await self.setup()
            await self.create_demo_data()

            # Run all steps
            await self.step_1_detect_low_stock()
            await self.step_2_manager_push_notification()
            await self.step_3_manager_approves_order()
            await self.step_4_ai_contacts_vendor()
            await self.step_5_vendor_responds()
            await self.step_6_ai_summarizes_conversation()
            await self.step_7_manager_final_approval()
            await self.step_8_ai_confirms_with_vendor()
            await self.step_9_delivery_arrives()
            await self.step_10_invoice_verification()
            await self.step_11_manager_finalizes()
            await self.step_12_inventory_updated()
            await self.step_13_financial_reports_updated()

            print("\n" + "=" * 70)
            print("🎉 DEMO SCENARIO COMPLETED SUCCESSFULLY!")
            print("=" * 70)
            print("\n📊 Final Summary:")
            print(f"   Order ID: {self.demo_order_id}")
            print("   Wine: Château Demo Reserve 2019")
            print("   Quantity: 12 bottles")
            print("   Final Price: $25.50/bottle")
            print("   Total Cost: $306.00")
            print("   Inventory: 3 → 15 bottles")
            print("   Status: COMPLETED ✅")

        except Exception as e:
            print(f"\n❌ Error running demo: {e}")
            import traceback

            traceback.print_exc()
        finally:
            await self.teardown()


async def main():
    demo = DemoOrderingScenario()
    await demo.run_full_scenario()


if __name__ == "__main__":
    asyncio.run(main())
