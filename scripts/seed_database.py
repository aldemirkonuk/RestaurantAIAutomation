#!/usr/bin/env python3
"""
WineOps AI - Database Seed Script (Extended)
Loads initial data: wines, restaurants, managers, inventory, providers,
storage_locations, procurement_orders, conversations, calendar_events,
bottle_specifications, glass_pour_tracking, price_history, supplier_catalogs,
feature_flags, provider_important_dates
"""

import json
import os
import sys
import uuid
from datetime import datetime, timedelta, date
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv
import bcrypt

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.append(str(project_root))

# Load environment variables
load_dotenv(project_root / ".env")

# Supabase connection
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_RESTAURANT_ID = os.getenv("SEED_RESTAURANT_ID", "550e8400-e29b-41d4-a716-446655440000")
DEFAULT_MANAGER_PASSWORD = os.getenv("SEED_MANAGER_PASSWORD", "ChangeMe123!")
# Easy demo account for quick sign-in
DEMO_EMAIL = os.getenv("SEED_DEMO_EMAIL", "demo@gmail.com")
DEMO_PASSWORD = os.getenv("SEED_DEMO_PASSWORD", "demo123")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Deterministic UUIDs for cross-referencing ──────────────────────
PROVIDER_NAPA_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "Napa Valley Wine Distributors"))
PROVIDER_PACIFIC_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "Pacific Coast Beverages"))

# Storage location IDs
LOC_MAIN_CELLAR = str(uuid.uuid5(uuid.NAMESPACE_DNS, "storage-main-cellar"))
LOC_BAR_FRIDGE = str(uuid.uuid5(uuid.NAMESPACE_DNS, "storage-bar-fridge"))
LOC_RESERVE_ROOM = str(uuid.uuid5(uuid.NAMESPACE_DNS, "storage-reserve-room"))

# Order IDs for scenarios
ORDER_PENDING_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "order-pending-001"))
ORDER_APPROVED_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "order-approved-002"))
ORDER_ORDERED_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "order-ordered-003"))
ORDER_DELIVERED_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "order-delivered-004"))

# Thread IDs for conversation scenarios
THREAD_NEGOTIATION = str(uuid.uuid5(uuid.NAMESPACE_DNS, "thread-negotiation-001"))

print("=" * 70)
print("WineOps AI - Database Seed Script (Extended)")
print("=" * 70)
print()


def load_wine_dataset():
    """Load 200 wines from robust dataset"""
    wine_dataset_path = project_root / "library" / "wineops_basic_v1.jsonl"
    if not wine_dataset_path.exists():
        wine_dataset_path = project_root.parent / "Wine Agent (WinerAge)" / "database" / "library" / "restaurant_wine_dataset.jsonl"
    if not wine_dataset_path.exists():
        print(f"  Wine dataset not found at: {wine_dataset_path}")
        return []
    wines = []
    with open(wine_dataset_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                wines.append(json.loads(line))
    print(f"  Loaded {len(wines)} wines from dataset: {wine_dataset_path.name}")
    return wines


def _trunc(val, maxlen=140):
    """Truncate string value to maxlen, preserving None"""
    if val is None or not isinstance(val, str):
        return val
    return val[:maxlen] if len(val) > maxlen else val


def _table_exists(table_name):
    """Check if a table exists and is accessible via PostgREST"""
    try:
        supabase.table(table_name).select("*").limit(0).execute()
        return True
    except Exception:
        return False


def seed_master_wine_library(wines):
    """Seed master wine library table with rich data"""
    print("\n[1/15] Seeding Master Wine Library...")
    master_wines = []
    for idx, wine in enumerate(wines[:200], 1):
        classification = wine.get("classification", {})
        wine_structure = wine.get("wine_structure", {})
        sensory = wine.get("sensory_profile", {})
        quality = wine.get("quality_signals", {})
        wine_id = wine.get("wine_id") or f"WINE_{idx:03d}"
        master_wine = {
            "wine_id": wine_id,
            "sequential_id": idx,
            "name": _trunc(wine.get("name") or wine.get("wine_name", f"Wine {idx}"), 140),
            "producer": _trunc(wine.get("producer", "Unknown Producer"), 140),
            "vintage": wine.get("vintage"),
            "price_reference": wine.get("price") or wine.get("price_reference"),
            "primary_type": _trunc(classification.get("primary_type") or wine.get("wine_type") or "red", 50),
            "grape_variety": _trunc(classification.get("grape_variety") or wine.get("varietal"), 140),
            "country": _trunc(classification.get("country") or wine.get("country", "USA"), 100),
            "region": _trunc(classification.get("region") or wine.get("region"), 140),
            "appellation": _trunc(classification.get("appellation") or wine.get("appellation"), 140),
            "wine_structure": wine_structure or None,
            "sensory_profile": sensory or None,
            "quality_classification": quality or None,
            "practical_attributes": wine.get("practical_attributes"),
            "market_value": wine.get("market_value"),
            "advanced_categories": wine.get("advanced_categories"),
            "technical_specs": wine.get("technical_specs"),
            "producer_story": wine.get("producer_story"),
            "awards": wine.get("awards"),
            "historical_notes": wine.get("historical_notes"),
            "grape_blend_info": wine.get("grape_blend_info"),
            "region_hierarchy": wine.get("region_hierarchy"),
        }
        master_wines.append(master_wine)
    try:
        batch_size = 50
        for i in range(0, len(master_wines), batch_size):
            batch = master_wines[i:i + batch_size]
            supabase.table("master_wine_library").upsert(batch, on_conflict="wine_id").execute()
            print(f"    Inserted wines {i+1} to {min(i+batch_size, len(master_wines))}")
        print(f"  OK Seeded {len(master_wines)} wines")
        return True
    except Exception as e:
        print(f"  FAIL Error seeding wines: {e}")
        return False


def seed_demo_restaurant():
    """Create demo restaurant"""
    print("\n[2/15] Creating Demo Restaurant...")
    pos_guid = os.getenv("TOAST_RESTAURANT_GUID")
    restaurant_data = {
        "id": DEFAULT_RESTAURANT_ID,
        "name": "Meyhouse Palo Alto",
        "slug": "meyhouse-palo-alto",
        "email": "info@meyhouse-pa.com",
        "phone": "+1-650-123-4567",
        "address": {
            "street": "123 University Ave",
            "city": "Palo Alto",
            "state": "CA",
            "zip": "94301",
            "country": "USA",
        },
        "timezone": "America/Los_Angeles",
        "currency": "USD",
        "pos_system": "toast",
        "pos_credentials": {"restaurant_guid": pos_guid} if pos_guid else None,
        "buffer_window_minutes": 30,
        "default_threshold_min": 5,
        "is_active": True,
        "subscription_tier": "pilot",
    }
    try:
        response = supabase.table("restaurants").upsert(restaurant_data, on_conflict="id").execute()
        restaurant_id = response.data[0]["id"]
        print(f"  OK Created restaurant: {restaurant_data['name']} (ID: {restaurant_id})")
        return restaurant_id
    except Exception as e:
        print(f"  FAIL Error creating restaurant: {e}")
        return None


def seed_managers(restaurant_id):
    """Create demo managers"""
    print("\n[3/15] Creating Demo Managers...")
    password_hash = bcrypt.hashpw(DEFAULT_MANAGER_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    demo_password_hash = bcrypt.hashpw(DEMO_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    managers = [
        {
            "user_id": str(uuid.uuid4()),
            "email": DEMO_EMAIL,
            "name": "Demo User",
            "phone": "+1-555-0100",
            "role": "owner",
            "restaurant_id": restaurant_id,
            "password_hash": demo_password_hash,
        },
        {
            "user_id": str(uuid.uuid4()),
            "email": "manager.devseed@example.com",
            "name": "Aldemir Konuk",
            "phone": "+1-650-555-0101",
            "role": "manager",
            "restaurant_id": restaurant_id,
            "password_hash": password_hash,
        },
        {
            "user_id": str(uuid.uuid4()),
            "email": "manager@meyhouse-pa.com",
            "name": "Sarah Johnson",
            "phone": "+1-650-555-0103",
            "role": "manager",
            "restaurant_id": restaurant_id,
            "password_hash": password_hash,
        },
        {
            "user_id": str(uuid.uuid4()),
            "email": "owner@meyhouse-pa.com",
            "name": "David Chen",
            "phone": "+1-650-555-0102",
            "role": "owner",
            "restaurant_id": restaurant_id,
            "password_hash": password_hash,
        },
    ]
    try:
        response = supabase.table("users").upsert(managers, on_conflict="email").execute()
        print(f"  OK Created {len(managers)} managers")
        return [m.get("user_id") or m.get("id") for m in response.data]
    except Exception as e:
        print(f"  FAIL Error creating managers: {e}")
        return []


def seed_providers(wines):
    """Create wine providers from dataset"""
    print("\n[4/15] Creating Wine Providers...")
    providers_dict = {}
    for wine in wines[:200]:
        provider_info = wine.get("provider_info", {})
        primary = provider_info.get("primary", {})
        if primary and primary.get("name"):
            provider_name = primary.get("name")
            if provider_name not in providers_dict:
                contact_email = primary.get("contact", f"info@{provider_name.lower().replace(' ', '')}.com")
                contact_name = contact_email.split("@")[0].title()
                providers_dict[provider_name] = {
                    "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, provider_name)),
                    "name": provider_name,
                    "company_name": provider_name,
                    "primary_contact": {
                        "name": contact_name,
                        "email": contact_email,
                        "phone": primary.get("phone", "+1-XXX-XXX-XXXX"),
                        "preferred_method": "email",
                    },
                    "alternative_contacts": [],
                    "address": {"label": primary.get("location", "San Francisco, CA")},
                    "specialties": primary.get("specialties", ["Wine Distribution"]),
                    "regions_covered": primary.get("regions", []),
                    "minimum_order": int(primary.get("minimum_order", 12)),
                    "lead_time_days": int(primary.get("lead_time_days", 14)),
                    "tier": "primary",
                    "notes": f"Lead time: {primary.get('lead_time_days', 14)} days.",
                }
    default_providers = [
        {
            "id": PROVIDER_NAPA_ID,
            "name": "Napa Valley Wine Distributors",
            "company_name": "Napa Valley Wine Distributors",
            "contact_email": "konukald@msu.edu",
            "primary_contact": {
                "name": "Michael Roberts",
                "email": "konukald@msu.edu",
                "phone": "+1-707-555-0201",
                "preferred_method": "email",
            },
            "alternative_contacts": [],
            "address": {"street": "456 Vineyard Road", "city": "Napa", "state": "CA", "zip": "94558", "country": "USA"},
            "specialties": ["California Wines", "Premium Selection"],
            "regions_covered": ["California"],
            "minimum_order": 12,
            "lead_time_days": 5,
            "tier": "primary",
            "notes": "Preferred vendor for California wines. Ask for Michael directly.",
        },
        {
            "id": PROVIDER_PACIFIC_ID,
            "name": "Pacific Coast Beverages",
            "company_name": "Pacific Coast Beverages",
            "primary_contact": {
                "name": "James Wilson",
                "email": "james@pacificcoastbev.com",
                "phone": "+1-650-555-0203",
                "preferred_method": "email",
            },
            "alternative_contacts": [],
            "address": {"street": "321 Industrial Blvd", "city": "San Jose", "state": "CA", "zip": "95131", "country": "USA"},
            "specialties": ["Domestic Wines", "Budget-Friendly Options"],
            "regions_covered": ["California"],
            "minimum_order": 12,
            "lead_time_days": 3,
            "tier": "alternative",
            "notes": "Fast delivery, great for emergency orders.",
        },
    ]
    providers = list(providers_dict.values())
    for default in default_providers:
        if not any(p["name"] == default["name"] for p in providers):
            providers.append(default)
    try:
        response = supabase.table("providers").upsert(providers[:10], on_conflict="id").execute()
        print(f"  OK Created {len(response.data)} wine providers")
        return [p["id"] for p in response.data]
    except Exception as e:
        print(f"  FAIL Error creating providers: {e}")
        return []


def seed_restaurant_providers(restaurant_id, provider_ids):
    """Link providers to the restaurant"""
    if not provider_ids:
        return False
    print("\n    Linking Providers to Restaurant...")
    links = []
    for idx, provider_id in enumerate(provider_ids):
        links.append({
            "restaurant_id": restaurant_id,
            "provider_id": provider_id,
            "tier": "primary" if idx < 3 else "alternative",
            "wine_categories": [],
            "is_active": True,
        })
    try:
        supabase.table("restaurant_providers").upsert(links, on_conflict="restaurant_id,provider_id").execute()
        print(f"  OK Linked {len(links)} providers to restaurant")
        return True
    except Exception as e:
        print(f"  FAIL Error linking providers: {e}")
        return False


def seed_storage_locations(restaurant_id):
    """Create storage locations (wine cellars, fridges, etc.)"""
    print("\n[5/15] Creating Storage Locations...")
    locations = [
        {
            "id": LOC_MAIN_CELLAR,
            "restaurant_id": restaurant_id,
            "zone": "Wine Cellar",
            "section": "Main Cellar",
            "shelf": "A-D",
            "position": "1-10",
            "full_location": "Wine Cellar > Main Cellar > Shelves A-D",
            "capacity_bottles": 500,
            "current_occupancy": 180,
            "temperature_zone": "cool",
            "temperature_min": 12.8,
            "temperature_max": 14.4,
            "humidity_controlled": True,
            "requires_special_access": False,
            "display_order": 1,
            "color_code": "#7B2D8E",
            "is_active": True,
            "notes": "Primary underground storage for reserve and premium wines",
        },
        {
            "id": LOC_BAR_FRIDGE,
            "restaurant_id": restaurant_id,
            "zone": "Bar Area",
            "section": "Bar Fridge",
            "shelf": "Top/Bottom",
            "position": "1-4",
            "full_location": "Bar Area > Bar Fridge",
            "capacity_bottles": 48,
            "current_occupancy": 32,
            "temperature_zone": "cold",
            "temperature_min": 7.2,
            "temperature_max": 10.0,
            "humidity_controlled": False,
            "requires_special_access": False,
            "display_order": 2,
            "color_code": "#2563EB",
            "is_active": True,
            "notes": "Whites and sparkling wines served by the glass",
        },
        {
            "id": LOC_RESERVE_ROOM,
            "restaurant_id": restaurant_id,
            "zone": "Reserve Room",
            "section": "Rare Collection",
            "shelf": "R1-R4",
            "position": "1-5",
            "full_location": "Reserve Room > Rare Collection",
            "capacity_bottles": 200,
            "current_occupancy": 45,
            "temperature_zone": "cool",
            "temperature_min": 11.1,
            "temperature_max": 12.8,
            "humidity_controlled": True,
            "requires_special_access": True,
            "access_notes": "Manager approval required for access",
            "display_order": 3,
            "color_code": "#DC2626",
            "is_active": True,
            "notes": "Climate-controlled room for rare and collectible bottles. Locked access.",
        },
    ]
    try:
        supabase.table("storage_locations").upsert(locations, on_conflict="id").execute()
        print(f"  OK Created {len(locations)} storage locations")
        return True
    except Exception as e:
        print(f"  FAIL Error creating storage locations: {e}")
        return False


def seed_restaurant_inventory(restaurant_id, provider_ids):
    """Create initial inventory for demo restaurant"""
    print("\n[6/15] Creating Restaurant Inventory...")
    response = supabase.table("master_wine_library").select("*").limit(50).execute()
    master_wines = response.data
    if not master_wines:
        print("  FAIL No wines found in master library")
        return False, []

    storage_locations = [LOC_MAIN_CELLAR, LOC_BAR_FRIDGE, LOC_RESERVE_ROOM]
    inventory_items = []
    for idx, wine in enumerate(master_wines):
        provider_id = provider_ids[hash(wine["id"]) % len(provider_ids)] if provider_ids else None
        initial_stock = (hash(wine["id"]) % 21) + 5
        # Make 3 items have low stock for alert scenario
        if idx < 3:
            initial_stock = 2  # below threshold_min of 5

        inventory_item = {
            "restaurant_id": restaurant_id,
            "master_wine_id": wine["id"],
            "provider_id": provider_id,
            "stock_live": initial_stock,
            "shadow_stock": 3 if idx == 5 else 0,  # one item has shadow stock
            "threshold_min": 5,
            "inventory_state": "LIVE",
            "custom_price": wine.get("price_reference") or 30.0,
            "storage_location_id": storage_locations[idx % len(storage_locations)],
        }
        inventory_items.append(inventory_item)

    try:
        batch_size = 25
        for i in range(0, len(inventory_items), batch_size):
            batch = inventory_items[i:i + batch_size]
            supabase.table("restaurant_inventory").insert(batch).execute()
            print(f"    Inserted inventory items {i+1} to {min(i+batch_size, len(inventory_items))}")
        print(f"  OK Created {len(inventory_items)} inventory items")
        # Fetch inserted IDs
        inv_resp = supabase.table("restaurant_inventory").select("id, master_wine_id").eq("restaurant_id", restaurant_id).limit(50).execute()
        return True, inv_resp.data
    except Exception as e:
        print(f"  FAIL Error creating inventory: {e}")
        return False, []


def seed_procurement_orders(restaurant_id, provider_ids, inventory_items):
    """Create sample procurement orders in various statuses"""
    print("\n[7/15] Creating Procurement Orders...")
    if not inventory_items or len(inventory_items) < 4:
        print("  SKIP Not enough inventory items")
        return []

    now = datetime.utcnow()
    orders = [
        {
            "id": ORDER_PENDING_ID,
            "order_number": "ORD-2026-0001",
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_items[0]["id"],
            "provider_id": PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0],
            "quantity": 24,
            "bottles_total": 24,
            "unit_type": "bottles",
            "quoted_price": 320.00,
            "final_price": 320.00,
            "total_cost": 7680.00,
            "status": "pending",
            "state_machine_state": "pending_approval",
            "is_emergency": False,
            "priority_level": 2,
            "expected_delivery_date": (now + timedelta(days=14)).strftime("%Y-%m-%d"),
            "negotiation_attempts": 0,
            "manager_notes": "Initial order for spring wine list refresh",
            "created_at": (now - timedelta(hours=2)).isoformat(),
        },
        {
            "id": ORDER_APPROVED_ID,
            "order_number": "ORD-2026-0002",
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_items[1]["id"],
            "provider_id": PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0],
            "quantity": 12,
            "bottles_total": 12,
            "unit_type": "bottles",
            "quoted_price": 85.00,
            "negotiated_price": 82.50,
            "final_price": 82.50,
            "total_cost": 990.00,
            "total_estimated_cost": 990.00,
            "status": "approved",
            "state_machine_state": "approved",
            "is_emergency": False,
            "priority_level": 2,
            "expected_delivery_date": (now + timedelta(days=10)).strftime("%Y-%m-%d"),
            "negotiation_attempts": 2,
            "last_negotiation_at": (now - timedelta(hours=6)).isoformat(),
            "manager_notes": "Price agreed after 2 rounds of negotiation",
            "created_at": (now - timedelta(days=1)).isoformat(),
        },
        {
            "id": ORDER_ORDERED_ID,
            "order_number": "ORD-2026-0003",
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_items[2]["id"],
            "provider_id": PROVIDER_PACIFIC_ID if PROVIDER_PACIFIC_ID in provider_ids else (provider_ids[1] if len(provider_ids) > 1 else provider_ids[0]),
            "quantity": 6,
            "bottles_total": 6,
            "unit_type": "bottles",
            "quoted_price": 70.00,
            "negotiated_price": 68.00,
            "final_price": 68.00,
            "total_cost": 408.00,
            "total_estimated_cost": 408.00,
            "final_confirmed_cost": 408.00,
            "status": "ordered",
            "state_machine_state": "ordered",
            "is_emergency": True,
            "priority_level": 1,
            "expected_delivery_date": (now + timedelta(days=3)).strftime("%Y-%m-%d"),
            "negotiation_attempts": 1,
            "last_negotiation_at": (now - timedelta(days=2)).isoformat(),
            "manager_notes": "Confirmed and ordered - expect invoice",
            "created_at": (now - timedelta(days=3)).isoformat(),
        },
        {
            "id": ORDER_DELIVERED_ID,
            "order_number": "ORD-2026-0004",
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_items[3]["id"],
            "provider_id": PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0],
            "quantity": 18,
            "bottles_total": 18,
            "unit_type": "bottles",
            "quoted_price": 55.00,
            "negotiated_price": 52.00,
            "final_price": 52.00,
            "total_cost": 936.00,
            "total_estimated_cost": 936.00,
            "final_confirmed_cost": 936.00,
            "status": "delivered",
            "state_machine_state": "delivered",
            "is_emergency": False,
            "priority_level": 2,
            "expected_delivery_date": (now - timedelta(days=1)).strftime("%Y-%m-%d"),
            "delivered_at": (now - timedelta(hours=4)).isoformat(),
            "quantity_received": 18,
            "price_verified": True,
            "negotiation_attempts": 1,
            "last_negotiation_at": (now - timedelta(days=5)).isoformat(),
            "delivery_notes": "Delivery received - 18/18 bottles verified",
            "created_at": (now - timedelta(days=7)).isoformat(),
        },
    ]
    try:
        supabase.table("procurement_orders").upsert(orders, on_conflict="id").execute()
        print(f"  OK Created {len(orders)} procurement orders")
        return [o["id"] for o in orders]
    except Exception as e:
        print(f"  FAIL Error creating orders: {e}")
        return []


def seed_procurement_conversations(restaurant_id, provider_ids):
    """Create sample vendor conversations with threading"""
    print("\n[8/15] Creating Procurement Conversations...")
    now = datetime.utcnow()
    napa_id = PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0]

    conversations = [
        # Thread: Negotiation for ORDER_APPROVED (4-message thread)
        {
            "order_id": ORDER_APPROVED_ID,
            "restaurant_id": restaurant_id,
            "provider_id": napa_id,
            "direction": "outbound",
            "channel": "email",
            "message_text": "Hi Michael,\n\nWe'd like to order 12 bottles of Caymus Special Selection 2018. Our target price is $85/bottle. Can you provide a quote?\n\nBest,\nSarah Johnson\nMeyhouse Palo Alto",
            "ai_generated": True,
            "llm_model": "gemini-2.5-flash",
            "detected_intent": "initial_inquiry",
            "detected_sentiment": "neutral",
            "delivery_status": "delivered",
            "sent_at": (now - timedelta(days=1, hours=10)).isoformat(),
            "created_at": (now - timedelta(days=1, hours=10)).isoformat(),
        },
        {
            "order_id": ORDER_APPROVED_ID,
            "restaurant_id": restaurant_id,
            "provider_id": napa_id,
            "direction": "inbound",
            "channel": "email",
            "message_text": "Hi Sarah,\n\nGreat to hear from you! For the Caymus Special Selection 2018, I can offer $88/bottle for 12 bottles. Delivery in 10 business days.\n\nLet me know if that works.\n\nBest,\nMichael Roberts\nNapa Valley Wine Distributors",
            "ai_generated": False,
            "detected_intent": "price_quote",
            "detected_sentiment": "positive",
            "delivery_status": "delivered",
            "received_at": (now - timedelta(days=1, hours=6)).isoformat(),
            "created_at": (now - timedelta(days=1, hours=6)).isoformat(),
        },
        {
            "order_id": ORDER_APPROVED_ID,
            "restaurant_id": restaurant_id,
            "provider_id": napa_id,
            "direction": "outbound",
            "channel": "email",
            "message_text": "Hi Michael,\n\nThanks for the quote. We've been a regular customer and typically order in this range. Could you do $82.50/bottle? We're happy to commit to this order right away.\n\nBest,\nSarah",
            "ai_generated": True,
            "llm_model": "gemini-2.5-flash",
            "detected_intent": "counter_offer",
            "detected_sentiment": "positive",
            "delivery_status": "delivered",
            "sent_at": (now - timedelta(hours=18)).isoformat(),
            "created_at": (now - timedelta(hours=18)).isoformat(),
        },
        {
            "order_id": ORDER_APPROVED_ID,
            "restaurant_id": restaurant_id,
            "provider_id": napa_id,
            "direction": "inbound",
            "channel": "email",
            "message_text": "Hi Sarah,\n\n$82.50/bottle works for us. I'll get the order processed. Expect delivery around Feb 17th.\n\nPleasure doing business with you!\n\nMichael",
            "ai_generated": False,
            "detected_intent": "acceptance",
            "detected_sentiment": "positive",
            "delivery_status": "delivered",
            "received_at": (now - timedelta(hours=12)).isoformat(),
            "created_at": (now - timedelta(hours=12)).isoformat(),
        },
    ]
    try:
        supabase.table("procurement_conversations").insert(conversations).execute()
        print(f"  OK Created {len(conversations)} conversation messages")
        return True
    except Exception as e:
        print(f"  FAIL Error creating conversations: {e}")
        return False


def seed_calendar_events(restaurant_id, provider_ids):
    """Create calendar events for deliveries, tastings, etc."""
    print("\n[9/15] Creating Calendar Events...")
    now = datetime.utcnow()
    napa_id = PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0]
    pacific_id = PROVIDER_PACIFIC_ID if PROVIDER_PACIFIC_ID in provider_ids else (provider_ids[1] if len(provider_ids) > 1 else provider_ids[0])

    events = [
        {
            "restaurant_id": restaurant_id,
            "title": "Delivery: Caymus Special Selection 2018 (12 bottles)",
            "description": "Expected delivery from Napa Valley Wine Distributors. 12 bottles at $82.50/ea.",
            "event_type": "delivery",
            "event_date": (now + timedelta(days=10)).strftime("%Y-%m-%d"),
            "event_time": "10:00",
            "all_day": False,
            "provider_id": napa_id,
            "order_id": ORDER_APPROVED_ID,
            "source": "ai_agent",
            "status": "active",
            "reminder_enabled": True,
            "reminder_days_before": 1,
        },
        {
            "restaurant_id": restaurant_id,
            "title": "Delivery: Silver Oak Alexander Valley (6 bottles)",
            "description": "Urgent delivery from Pacific Coast Beverages.",
            "event_type": "delivery",
            "event_date": (now + timedelta(days=3)).strftime("%Y-%m-%d"),
            "event_time": "09:00",
            "all_day": False,
            "provider_id": pacific_id,
            "order_id": ORDER_ORDERED_ID,
            "source": "ai_agent",
            "status": "active",
            "reminder_enabled": True,
            "reminder_days_before": 1,
        },
        {
            "restaurant_id": restaurant_id,
            "title": "Monthly Inventory Audit",
            "description": "Scheduled physical count of all wine inventory.",
            "event_type": "audit",
            "event_date": (now + timedelta(days=21)).strftime("%Y-%m-%d"),
            "event_time": "08:00",
            "all_day": False,
            "source": "manual",
            "status": "active",
            "reminder_enabled": True,
            "reminder_days_before": 2,
        },
        {
            "restaurant_id": restaurant_id,
            "title": "Wine Tasting: Spring Collection Preview",
            "description": "Preview tasting with Napa Valley Wine Distributors for spring menu wines.",
            "event_type": "tasting",
            "event_date": (now + timedelta(days=14)).strftime("%Y-%m-%d"),
            "event_time": "14:00",
            "all_day": False,
            "provider_id": napa_id,
            "source": "manual",
            "status": "active",
            "reminder_enabled": True,
            "reminder_days_before": 3,
        },
    ]
    try:
        supabase.table("calendar_events").insert(events).execute()
        print(f"  OK Created {len(events)} calendar events")
        return True
    except Exception as e:
        print(f"  FAIL Error creating calendar events: {e}")
        return False


def seed_bottle_specifications():
    """Create bottle specifications for wine pours (skipped if table doesn't exist)"""
    print("\n[10/15] Creating Bottle Specifications...")
    try:
        supabase.table("bottle_specifications").select("id").limit(0).execute()
    except Exception:
        print("  SKIP Table 'bottle_specifications' does not exist yet")
        return False

    response = supabase.table("master_wine_library").select("id, name, primary_type").limit(10).execute()
    master_wines = response.data
    if not master_wines:
        print("  SKIP No wines found")
        return False

    specs = []
    for wine in master_wines:
        wtype = wine.get("primary_type", "red")
        pour_ml = 150.0 if wtype in ("red", "white") else 120.0 if wtype == "sparkling" else 90.0
        specs.append({
            "master_wine_id": wine["id"],
            "bottle_size_ml": 750,
            "pour_size_ml": pour_ml,
            "glass_size_ml": pour_ml,
            "cost_per_bottle": round(25 + hash(wine["id"]) % 200, 2),
            "weight_grams": 1200 if wtype == "red" else 1050,
            "closure_type": "cork" if wtype in ("red", "white") else "wire_cage",
        })
    try:
        supabase.table("bottle_specifications").upsert(specs, on_conflict="master_wine_id").execute()
        print(f"  OK Created {len(specs)} bottle specifications")
        return True
    except Exception as e:
        print(f"  FAIL Error creating bottle specs: {e}")
        return False


def seed_glass_pour_tracking(restaurant_id, inventory_items):
    """Create glass pour tracking for open bottles"""
    print("\n[11/15] Creating Glass Pour Tracking...")
    if not _table_exists("glass_pour_tracking"):
        print("  SKIP Table 'glass_pour_tracking' does not exist yet")
        return False
    if not inventory_items or len(inventory_items) < 2:
        print("  SKIP Not enough inventory items")
        return False

    now = datetime.utcnow()
    pours = [
        {
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_items[0]["id"],
            "bottle_opened_at": (now - timedelta(hours=3)).isoformat(),
            "pours_served": 3,
            "volume_poured_ml": 450.0,
            "waste_ml": 0.0,
            "remaining_ml": 300.0,
            "status": "open",
            "notes": "Opened for table 12 wine service",
        },
        {
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_items[1]["id"],
            "bottle_opened_at": (now - timedelta(hours=6)).isoformat(),
            "pours_served": 5,
            "volume_poured_ml": 750.0,
            "waste_ml": 0.0,
            "remaining_ml": 0.0,
            "status": "finished",
            "finished_at": (now - timedelta(hours=1)).isoformat(),
            "notes": "Finished - all 5 glasses served",
        },
    ]
    try:
        supabase.table("glass_pour_tracking").insert(pours).execute()
        print(f"  OK Created {len(pours)} pour tracking entries")
        return True
    except Exception as e:
        print(f"  FAIL Error creating pour tracking: {e}")
        return False


def seed_price_history(restaurant_id, provider_ids):
    """Create historical pricing data"""
    print("\n[12/15] Creating Price History...")
    if not _table_exists("price_history"):
        print("  SKIP Table 'price_history' does not exist yet")
        return False
    response = supabase.table("master_wine_library").select("id").limit(5).execute()
    wines = response.data
    if not wines:
        print("  SKIP No wines found")
        return False

    napa_id = PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0]
    now = datetime.utcnow()
    history = []
    for i, wine in enumerate(wines):
        base_price = 40 + i * 15
        for months_ago in range(6, 0, -1):
            variation = (months_ago % 3) * 2
            history.append({
                "restaurant_id": restaurant_id,
                "master_wine_id": wine["id"],
                "provider_id": napa_id,
                "price": round(base_price + variation, 2),
                "quantity": 12,
                "unit": "bottle",
                "effective_date": (now - timedelta(days=months_ago * 30)).strftime("%Y-%m-%d"),
                "source": "negotiation",
                "notes": f"Q{((12 - months_ago) // 3) + 1} pricing",
            })
    try:
        supabase.table("price_history").insert(history).execute()
        print(f"  OK Created {len(history)} price history entries")
        return True
    except Exception as e:
        print(f"  FAIL Error creating price history: {e}")
        return False


def seed_supplier_catalogs(provider_ids):
    """Create supplier catalog data"""
    print("\n[13/15] Creating Supplier Catalogs...")
    if not _table_exists("supplier_catalogs"):
        print("  SKIP Table 'supplier_catalogs' does not exist yet")
        return False
    napa_id = PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0]
    pacific_id = PROVIDER_PACIFIC_ID if PROVIDER_PACIFIC_ID in provider_ids else (provider_ids[1] if len(provider_ids) > 1 else provider_ids[0])
    now = datetime.utcnow()

    catalogs = [
        {
            "provider_id": napa_id,
            "catalog_name": "Spring 2026 Premium Collection",
            "items": json.dumps([
                {"name": "Opus One 2019", "sku": "OPO-2019", "price": 340.00, "min_qty": 6},
                {"name": "Caymus Special Selection 2018", "sku": "CAY-SS-2018", "price": 88.00, "min_qty": 12},
                {"name": "Silver Oak Alexander Valley 2017", "sku": "SO-AV-2017", "price": 72.00, "min_qty": 6},
            ]),
            "pricing_tier": "premium",
            "valid_from": now.strftime("%Y-%m-%d"),
            "valid_until": (now + timedelta(days=90)).strftime("%Y-%m-%d"),
            "source": "email",
        },
        {
            "provider_id": pacific_id,
            "catalog_name": "Q1 2026 Value Selection",
            "items": json.dumps([
                {"name": "Jordan Cabernet Sauvignon 2018", "sku": "JOR-CS-2018", "price": 55.00, "min_qty": 12},
                {"name": "Meiomi Pinot Noir 2020", "sku": "MEI-PN-2020", "price": 18.00, "min_qty": 24},
            ]),
            "pricing_tier": "standard",
            "valid_from": now.strftime("%Y-%m-%d"),
            "valid_until": (now + timedelta(days=90)).strftime("%Y-%m-%d"),
            "source": "catalog_upload",
        },
    ]
    try:
        supabase.table("supplier_catalogs").insert(catalogs).execute()
        print(f"  OK Created {len(catalogs)} supplier catalogs")
        return True
    except Exception as e:
        print(f"  FAIL Error creating supplier catalogs: {e}")
        return False


def seed_feature_flags(restaurant_id):
    """Create restaurant feature flags"""
    print("\n[14/15] Creating Feature Flags...")
    if not _table_exists("restaurant_feature_flags"):
        print("  SKIP Table 'restaurant_feature_flags' does not exist yet")
        return False
    flags = [
        {"restaurant_id": restaurant_id, "flag_name": "ai_negotiation", "enabled": True, "metadata": {"version": "v2"}},
        {"restaurant_id": restaurant_id, "flag_name": "voice_ordering", "enabled": False, "metadata": {"reason": "beta"}},
        {"restaurant_id": restaurant_id, "flag_name": "auto_reorder", "enabled": True, "metadata": {}},
        {"restaurant_id": restaurant_id, "flag_name": "glass_pour_tracking", "enabled": True, "metadata": {}},
        {"restaurant_id": restaurant_id, "flag_name": "self_evolution", "enabled": False, "metadata": {"reason": "disabled_by_default"}},
        {"restaurant_id": restaurant_id, "flag_name": "email_inbound_processing", "enabled": True, "metadata": {}},
        {"restaurant_id": restaurant_id, "flag_name": "invoice_scanning", "enabled": True, "metadata": {}},
    ]
    try:
        for flag in flags:
            supabase.table("restaurant_feature_flags").upsert(
                flag, on_conflict="restaurant_id,flag_name"
            ).execute()
        print(f"  OK Created {len(flags)} feature flags")
        return True
    except Exception as e:
        print(f"  FAIL Error creating feature flags: {e}")
        return False


def seed_provider_important_dates(restaurant_id, provider_ids):
    """Create provider important dates"""
    print("\n[15/15] Creating Provider Important Dates...")
    if not _table_exists("provider_important_dates"):
        print("  SKIP Table 'provider_important_dates' does not exist yet")
        return False
    napa_id = PROVIDER_NAPA_ID if PROVIDER_NAPA_ID in provider_ids else provider_ids[0]
    now = datetime.utcnow()

    dates = [
        {
            "provider_id": napa_id,
            "restaurant_id": restaurant_id,
            "date": (now + timedelta(days=30)).strftime("%Y-%m-%d"),
            "event_type": "holiday",
            "description": "Napa Valley harvest festival - office closed, no deliveries",
            "confidence": 0.95,
            "source": "vendor_communication",
        },
        {
            "provider_id": napa_id,
            "restaurant_id": restaurant_id,
            "date": (now + timedelta(days=60)).strftime("%Y-%m-%d"),
            "event_type": "promotion",
            "description": "Spring promotion - 10% off orders over $1000",
            "confidence": 0.85,
            "source": "ai_extracted",
        },
    ]
    try:
        supabase.table("provider_important_dates").insert(dates).execute()
        print(f"  OK Created {len(dates)} provider important dates")
        return True
    except Exception as e:
        print(f"  FAIL Error creating provider dates: {e}")
        return False


def seed_notification_preferences(manager_ids, restaurant_id):
    """Set up notification preferences for managers"""
    print("\n    Setting Up Notification Preferences...")
    if not _table_exists("notification_preferences"):
        print("  SKIP Table 'notification_preferences' does not exist yet")
        return False
    preferences = []
    for manager_id in manager_ids:
        pref = {
            "restaurant_id": restaurant_id,
            "user_id": manager_id,
            "low_stock_enabled": True,
            "order_approval_enabled": True,
            "delivery_enabled": True,
            "financial_reports_enabled": True,
            "calendar_reminders_enabled": True,
        }
        preferences.append(pref)
    try:
        supabase.table("notification_preferences").insert(preferences).execute()
        print(f"  OK Set up notification preferences for {len(manager_ids)} managers")
        return True
    except Exception as e:
        print(f"  FAIL Error setting preferences: {e}")
        return False


def main():
    """Main seeding function"""
    print("Starting database seeding...\n")

    # Step 1: Load wine dataset
    wines = load_wine_dataset()
    if not wines:
        print("Cannot proceed without wine data")
        return

    # Step 2: Seed master wine library
    if not seed_master_wine_library(wines):
        print("Failed to seed wine library")
        return

    # Step 3: Create demo restaurant
    restaurant_id = seed_demo_restaurant()
    if not restaurant_id:
        print("Failed to create restaurant")
        return

    # Step 4: Create managers
    manager_ids = seed_managers(restaurant_id)
    if not manager_ids:
        print("Warning: No managers created")

    # Step 5: Create providers
    provider_ids = seed_providers(wines)
    if not provider_ids:
        print("Warning: No providers created")
    else:
        seed_restaurant_providers(restaurant_id, provider_ids)

    # Step 6: Create storage locations
    seed_storage_locations(restaurant_id)

    # Step 7: Create inventory (with low-stock items for alerts)
    success, inventory_items = seed_restaurant_inventory(restaurant_id, provider_ids)
    if not success:
        print("Failed to create inventory")
        return

    # Step 8: Create procurement orders (lifecycle scenarios)
    order_ids = seed_procurement_orders(restaurant_id, provider_ids, inventory_items)

    # Step 9: Create procurement conversations (threaded)
    if order_ids:
        seed_procurement_conversations(restaurant_id, provider_ids)

    # Step 10: Create calendar events
    seed_calendar_events(restaurant_id, provider_ids)

    # Step 11: Bottle specifications
    seed_bottle_specifications()

    # Step 12: Glass pour tracking
    seed_glass_pour_tracking(restaurant_id, inventory_items)

    # Step 13: Price history
    seed_price_history(restaurant_id, provider_ids)

    # Step 14: Supplier catalogs
    seed_supplier_catalogs(provider_ids)

    # Step 15: Feature flags
    seed_feature_flags(restaurant_id)

    # Step 16: Provider important dates
    seed_provider_important_dates(restaurant_id, provider_ids)

    # Step 17: Notification preferences
    if manager_ids:
        seed_notification_preferences(manager_ids, restaurant_id)

    print("\n" + "=" * 70)
    print("DATABASE SEEDING COMPLETE!")
    print("=" * 70)
    print()
    print("Summary:")
    print(f"  Master Wine Library: 200 wines")
    print(f"  Restaurants: 1 (Meyhouse Palo Alto)")
    print(f"  Managers: {len(manager_ids)}")
    print(f"  Providers: {len(provider_ids)}")
    print(f"  Storage Locations: 3")
    print(f"  Inventory Items: {len(inventory_items)} (3 low-stock for alerts)")
    print(f"  Procurement Orders: {len(order_ids)} (pending/approved/ordered/delivered)")
    print(f"  Conversations: 4 messages (threaded negotiation)")
    print(f"  Calendar Events: 4")
    print(f"  Bottle Specs: 10")
    print(f"  Pour Tracking: 2 (1 open, 1 finished)")
    print(f"  Price History: 30 entries")
    print(f"  Supplier Catalogs: 2")
    print(f"  Feature Flags: 7")
    print(f"  Provider Dates: 2")
    print()
    print(f"Demo / Test Login:")
    print(f"  Easy demo: {DEMO_EMAIL} / {DEMO_PASSWORD}")
    print(f"  Manager: manager@meyhouse-pa.com / {DEFAULT_MANAGER_PASSWORD}")
    print(f"  Owner: owner@meyhouse-pa.com / {DEFAULT_MANAGER_PASSWORD}")
    print()
    print(f"Restaurant ID: {restaurant_id}")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nSeeding interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
