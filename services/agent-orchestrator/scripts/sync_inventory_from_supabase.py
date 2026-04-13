"""
📊 Inventory Sync from Supabase
==============================
Synchronizes local inventory display with Supabase data.

This ensures:
- All stock numbers match Supabase values
- Real-time inventory visibility
- No manual editing required
- Single source of truth (Supabase)

Features:
- Real-time sync via Supabase Realtime
- Periodic full sync (every 5 minutes)
- Cache invalidation on changes
- Event publishing for UI updates

Usage:
    python scripts/sync_inventory_from_supabase.py
    python scripts/sync_inventory_from_supabase.py --once  # Single sync
    python scripts/sync_inventory_from_supabase.py --watch # Real-time watch
"""

import asyncio
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings


class InventorySyncService:
    """
    Synchronizes inventory data from Supabase
    
    Architecture:
    - Supabase is the single source of truth
    - This service pulls data and broadcasts updates
    - UI/Frontend subscribes to updates via WebSocket
    """
    
    def __init__(self):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
        self.last_sync: Optional[datetime] = None
        self.sync_interval_seconds = 300  # 5 minutes
        
    async def setup(self):
        """Initialize connections"""
        print("🔌 Setting up Inventory Sync Service...")
        
        self.db = DatabaseClient(
            supabase_url=self.settings.supabase_url,
            supabase_key=self.settings.supabase_service_role_key,
            redis_url=self.settings.redis_url,
        )
        await self.db.connect()
        print("   ✅ Database connected")
        
        self.message_bus = MessageBus(self.settings.rabbitmq_url)
        await self.message_bus.connect()
        print("   ✅ Message bus connected")
        
    async def teardown(self):
        """Cleanup"""
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
        print("✅ Cleanup complete")
    
    async def get_all_inventory(self, restaurant_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Fetch all inventory items from Supabase
        
        Joins with master_wine_library for wine details
        """
        query = self.db.supabase.table("restaurant_inventory").select(
            "*, master_wine_library(id, name, region, grape_varieties, vintage, wine_type, producer)"
        )
        
        if restaurant_id:
            query = query.eq("restaurant_id", restaurant_id)
        
        result = await query.execute()
        return result.data or []
    
    async def sync_inventory(self, restaurant_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Perform full inventory sync
        
        Returns:
            Sync result with statistics
        """
        print(f"\n📊 Syncing inventory from Supabase...")
        start_time = datetime.utcnow()
        
        try:
            # Fetch all inventory
            inventory_items = await self.get_all_inventory(restaurant_id)
            
            # Process and format items
            formatted_items = []
            low_stock_items = []
            out_of_stock_items = []
            
            for item in inventory_items:
                wine_data = item.get("master_wine_library", {}) or {}
                
                formatted_item = {
                    "id": item["id"],
                    "restaurant_id": item["restaurant_id"],
                    "wine_id": item.get("master_wine_id"),
                    "wine_name": wine_data.get("name", "Unknown Wine"),
                    "wine_region": wine_data.get("region"),
                    "wine_type": wine_data.get("wine_type"),
                    "vintage": wine_data.get("vintage"),
                    "producer": wine_data.get("producer"),
                    
                    # Stock levels (from Supabase - single source of truth)
                    "stock_live": item.get("stock_live", 0),
                    "physical_stock": item.get("physical_stock"),
                    "shadow_stock": item.get("shadow_stock", 0),
                    "expected_stock": item.get("expected_stock", 0),
                    "in_transit": item.get("in_transit_quantity", 0),
                    
                    # Thresholds
                    "threshold_min": item.get("threshold_min", 3),
                    "threshold_max": item.get("validation_max"),
                    
                    # Status
                    "inventory_state": item.get("inventory_state", "LIVE"),
                    "is_low_stock": item.get("stock_live", 0) <= item.get("threshold_min", 3),
                    "is_out_of_stock": item.get("stock_live", 0) == 0,
                    
                    # Timestamps
                    "last_sold_at": item.get("last_sold_at"),
                    "last_restocked_at": item.get("last_restocked_at"),
                    "updated_at": item.get("updated_at"),
                }
                
                formatted_items.append(formatted_item)
                
                if formatted_item["is_out_of_stock"]:
                    out_of_stock_items.append(formatted_item)
                elif formatted_item["is_low_stock"]:
                    low_stock_items.append(formatted_item)
            
            # Update cache (Redis)
            if self.db.distributed_cache:
                cache_key = f"inventory:all:{restaurant_id or 'global'}"
                await self.db.distributed_cache.set(
                    cache_key,
                    json.dumps(formatted_items, default=str),
                    ex=self.sync_interval_seconds,
                )
                print(f"   ✅ Cached {len(formatted_items)} items")
            
            # Publish sync event
            sync_result = {
                "synced_at": datetime.utcnow().isoformat(),
                "total_items": len(formatted_items),
                "low_stock_count": len(low_stock_items),
                "out_of_stock_count": len(out_of_stock_items),
                "restaurant_id": restaurant_id,
                "items": formatted_items,
            }
            
            await self.message_bus.publish(
                queue="inventory.events",
                message={
                    "event_type": "InventorySynced",
                    "routing_key": "inventory.synced",
                    "timestamp": datetime.utcnow().isoformat(),
                    "payload": {
                        "total_items": len(formatted_items),
                        "low_stock_count": len(low_stock_items),
                        "out_of_stock_count": len(out_of_stock_items),
                        "low_stock_items": [
                            {"id": i["id"], "name": i["wine_name"], "stock": i["stock_live"]}
                            for i in low_stock_items[:10]  # Top 10
                        ],
                    },
                },
            )
            
            self.last_sync = datetime.utcnow()
            duration = (datetime.utcnow() - start_time).total_seconds()
            
            print(f"   ✅ Sync complete in {duration:.2f}s")
            print(f"   📦 Total Items: {len(formatted_items)}")
            print(f"   ⚠️ Low Stock: {len(low_stock_items)}")
            print(f"   ❌ Out of Stock: {len(out_of_stock_items)}")
            
            return sync_result
            
        except Exception as e:
            print(f"   ❌ Sync failed: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e)}
    
    async def get_inventory_item(self, inventory_id: str) -> Optional[Dict[str, Any]]:
        """Get single inventory item from Supabase"""
        result = await self.db.supabase.table("restaurant_inventory").select(
            "*, master_wine_library(id, name, region, grape_varieties, vintage, wine_type, producer)"
        ).eq("id", inventory_id).single().execute()
        
        return result.data
    
    async def update_stock(
        self,
        inventory_id: str,
        new_stock: int,
        reason: str = "manual_update",
    ) -> bool:
        """
        Update stock level in Supabase
        
        This is the ONLY way to update stock - goes directly to Supabase
        """
        try:
            result = await self.db.supabase.table("restaurant_inventory").update({
                "stock_live": new_stock,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", inventory_id).execute()
            
            if result.data:
                # Publish stock update event
                await self.message_bus.publish(
                    queue="stock.events",
                    message={
                        "event_type": "StockUpdated",
                        "routing_key": "stock.updated",
                        "payload": {
                            "inventory_id": inventory_id,
                            "new_stock": new_stock,
                            "reason": reason,
                        },
                    },
                )
                return True
            return False
            
        except Exception as e:
            print(f"Error updating stock: {e}")
            return False
    
    async def watch_changes(self):
        """
        Watch for real-time changes via Supabase Realtime
        
        Note: This requires Supabase Realtime to be enabled
        """
        print("\n👀 Watching for inventory changes...")
        print("   (Supabase Realtime subscription)")
        
        # Note: Supabase Python client realtime support is limited
        # For production, use Supabase JS client in frontend
        # or implement webhook-based updates
        
        # Fallback: Periodic sync
        while True:
            await asyncio.sleep(self.sync_interval_seconds)
            await self.sync_inventory()
    
    async def run_once(self, restaurant_id: Optional[str] = None):
        """Run single sync"""
        await self.setup()
        result = await self.sync_inventory(restaurant_id)
        await self.teardown()
        return result
    
    async def run_periodic(self, restaurant_id: Optional[str] = None):
        """Run periodic sync"""
        await self.setup()
        
        print(f"\n🔄 Starting periodic sync (every {self.sync_interval_seconds}s)")
        print("   Press Ctrl+C to stop\n")
        
        try:
            while True:
                await self.sync_inventory(restaurant_id)
                await asyncio.sleep(self.sync_interval_seconds)
        except KeyboardInterrupt:
            print("\n⏹️ Stopped by user")
        finally:
            await self.teardown()


async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Inventory Sync from Supabase")
    parser.add_argument("--once", action="store_true", help="Run single sync")
    parser.add_argument("--watch", action="store_true", help="Run periodic sync")
    parser.add_argument("--restaurant", type=str, help="Filter by restaurant ID")
    args = parser.parse_args()
    
    service = InventorySyncService()
    
    if args.once:
        await service.run_once(args.restaurant)
    elif args.watch:
        await service.run_periodic(args.restaurant)
    else:
        print("Usage:")
        print("  python sync_inventory_from_supabase.py --once   # Single sync")
        print("  python sync_inventory_from_supabase.py --watch  # Periodic sync")
        print("  python sync_inventory_from_supabase.py --once --restaurant <id>")


if __name__ == "__main__":
    asyncio.run(main())

