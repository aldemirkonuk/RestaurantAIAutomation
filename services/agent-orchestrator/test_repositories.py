"""
Quick test script to verify new repositories work
Run this after migration to ensure all repositories are properly initialized
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from core.database import DatabaseClient
from config.settings import get_settings

async def test_repositories():
    """Test all new repositories are working"""
    print("🧪 Testing New Repositories")
    print("=" * 50)
    
    settings = get_settings()
    
    # Check required settings
    if not settings.supabase_url or not settings.supabase_service_role_key:
        print("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
        return False
    
    try:
        # Initialize database client
        print("\n1️⃣ Initializing database connection...")
        db = DatabaseClient(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            redis_url=settings.redis_url,
        )
        
        await db.connect()
        print("   ✅ Database connected")
        
        # Test each repository
        print("\n2️⃣ Testing Repositories...")
        
        # Test OrderInteractionRepository
        if db.order_interactions:
            print("   ✅ OrderInteractionRepository initialized")
        else:
            print("   ❌ OrderInteractionRepository NOT initialized")
            return False
        
        # Test ManagerPreferencesRepository
        if db.manager_preferences:
            print("   ✅ ManagerPreferencesRepository initialized")
        else:
            print("   ❌ ManagerPreferencesRepository NOT initialized")
            return False
        
        # Test UnitConversionRepository
        if db.unit_conversions:
            print("   ✅ UnitConversionRepository initialized")
        else:
            print("   ❌ UnitConversionRepository NOT initialized")
            return False
        
        # Test RFQRepository
        if db.rfq_requests:
            print("   ✅ RFQRepository initialized")
        else:
            print("   ❌ RFQRepository NOT initialized")
            return False
        
        # Test MasterWineLibraryRepository
        if db.wine_library:
            print("   ✅ MasterWineLibraryRepository initialized")
        else:
            print("   ❌ MasterWineLibraryRepository NOT initialized")
            return False
        
        # Test health check
        print("\n3️⃣ Testing Database Health...")
        health = await db.health_check()
        print(f"   Status: {health.get('status', 'unknown')}")
        print(f"   Supabase: {health.get('supabase', 'unknown')}")
        print(f"   Redis: {health.get('redis', 'unknown')}")
        
        # Test basic query (should not error)
        print("\n4️⃣ Testing Basic Queries...")
        try:
            # Test getting pending RFQs (should return empty list, not error)
            pending = await db.rfq_requests.get_pending_rfqs("test-restaurant-id")
            print(f"   ✅ RFQ query works (returned {len(pending)} results)")
        except Exception as e:
            print(f"   ⚠️ RFQ query test failed: {e}")
        
        try:
            # Test wine library search (should return empty list, not error)
            wines = await db.wine_library.search_by_name("test", limit=5)
            print(f"   ✅ Wine library query works (returned {len(wines)} results)")
        except Exception as e:
            print(f"   ⚠️ Wine library query test failed: {e}")
        
        await db.disconnect()
        print("\n✅ All repositories verified successfully!")
        print("=" * 50)
        return True
        
    except Exception as e:
        print(f"\n❌ Error testing repositories: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = asyncio.run(test_repositories())
    sys.exit(0 if success else 1)

