#!/usr/bin/env python3
"""
Quick script to seed just the demo user for login testing
"""

import os
import sys
from pathlib import Path
import psycopg2
import bcrypt
from dotenv import load_dotenv

# Load environment variables
project_root = Path(__file__).parent.parent
load_dotenv(project_root / ".env")

# Database connection
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
DEMO_EMAIL = "demo@gmail.com"
DEMO_PASSWORD = "demo123"
DEFAULT_RESTAURANT_ID = "550e8400-e29b-41d4-a716-446655440000"

if not DATABASE_URL:
    print("❌ Error: DATABASE_URL or SUPABASE_DB_URL must be set in .env")
    sys.exit(1)

print("=" * 70)
print("🍷 WineOps AI - Quick Demo User Seed")
print("=" * 70)
print()

try:
    # Connect to database
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Hash password
    password_hash = bcrypt.hashpw(DEMO_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    
    # Check if restaurant exists, create if not
    print("📍 Ensuring demo restaurant exists...")
    cursor.execute("""
        INSERT INTO restaurants (id, name, slug, email, phone, timezone, currency, is_active, subscription_tier)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
    """, (
        DEFAULT_RESTAURANT_ID,
        "Demo Restaurant",
        "demo-restaurant",
        "demo@restaurant.com",
        "+1-555-0100",
        "America/Los_Angeles",
        "USD",
        True,
        "pilot"
    ))
    
    if cursor.fetchone():
        print("  ✅ Created demo restaurant")
    else:
        print("  ℹ️  Demo restaurant already exists")
    
    # Create or update demo user
    print(f"👤 Creating demo user: {DEMO_EMAIL}...")
    cursor.execute("""
        INSERT INTO users (email, name, phone, role, restaurant_id, password_hash)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (email) 
        DO UPDATE SET 
            password_hash = EXCLUDED.password_hash,
            restaurant_id = EXCLUDED.restaurant_id,
            role = EXCLUDED.role
        RETURNING user_id
    """, (
        DEMO_EMAIL,
        "Demo User",
        "+1-555-0100",
        "owner",
        DEFAULT_RESTAURANT_ID,
        password_hash
    ))
    
    user_id = cursor.fetchone()[0]
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print("  ✅ Demo user ready")
    print()
    print("=" * 70)
    print("✅ SEED COMPLETE!")
    print("=" * 70)
    print()
    print("🔑 Demo Login Credentials:")
    print(f"   Email: {DEMO_EMAIL}")
    print(f"   Password: {DEMO_PASSWORD}")
    print()
    print("🎯 Next Steps:")
    print("   1. Restart the API Gateway server (if running)")
    print("   2. Go to http://localhost:3000/login")
    print("   3. Sign in with the credentials above")
    print()
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
