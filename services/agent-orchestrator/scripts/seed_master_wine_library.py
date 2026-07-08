"""
🍷 Master Wine Library Seeder
============================
Seeds the master_wine_library table with curated wine data.

This is the foundation for:
- Wine enrichment (Sommelier Agent)
- Menu scanning (Menu Analyzer Agent)
- Barcode → Wine mapping
- Food pairing suggestions
- Price benchmarking

Usage:
    python scripts/seed_master_wine_library.py
    python scripts/seed_master_wine_library.py --clear  # Clear and reseed
"""

import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import DatabaseClient
from config.settings import get_settings


class MasterWineLibrarySeeder:
    """Seeds the master wine library with curated data"""

    def __init__(self):
        self.settings = get_settings()
        self.db: DatabaseClient = None
        self.data_file = (
            Path(__file__).parent.parent / "data" / "master_wine_library_seed.json"
        )

    async def setup(self):
        """Initialize database connection"""
        print("🔌 Connecting to database...")
        self.db = DatabaseClient(
            supabase_url=self.settings.supabase_url,
            supabase_key=self.settings.supabase_service_role_key,
            redis_url=self.settings.redis_url,
        )
        await self.db.connect()
        print("   ✅ Connected")

    async def teardown(self):
        """Cleanup"""
        if self.db:
            await self.db.disconnect()
        print("✅ Cleanup complete")

    def load_seed_data(self) -> Dict[str, Any]:
        """Load seed data from JSON file"""
        if not self.data_file.exists():
            print(f"❌ Seed data file not found: {self.data_file}")
            return None

        with open(self.data_file, "r") as f:
            return json.load(f)

    async def clear_existing_data(self):
        """Clear existing wine library data"""
        print("🗑️ Clearing existing data...")
        try:
            # Delete all records (be careful in production!)
            await self.db.supabase.table("master_wine_library").delete().neq(
                "id", "00000000-0000-0000-0000-000000000000"
            ).execute()
            print("   ✅ Cleared")
        except Exception as e:
            print(f"   ⚠️ Warning: {e}")

    async def seed_wines(self, wines: List[Dict[str, Any]]) -> int:
        """Seed wines into the database"""
        print(f"\n🍷 Seeding {len(wines)} wines...")

        success_count = 0

        for i, wine in enumerate(wines, 1):
            try:
                # Prepare wine record
                wine_record = {
                    "name": wine["name"],
                    "region": wine.get("region"),
                    "country": wine.get("country"),
                    "grape_varieties": wine.get("grape_varieties"),
                    "vintage": wine.get("vintage"),
                    "wine_type": wine.get("wine_type"),
                    "producer": wine.get("producer"),
                    "alcohol_content": wine.get("alcohol_content"),
                    "tasting_notes": wine.get("tasting_notes"),
                    "food_pairings": wine.get("food_pairings"),
                    "data_source": "seed_data",
                    "enrichment_date": datetime.utcnow().isoformat(),
                    "barcode": wine.get("barcode"),
                    "barcode_vintage_mapping": (
                        {wine.get("barcode"): wine.get("vintage")}
                        if wine.get("barcode") and wine.get("vintage")
                        else None
                    ),
                }

                # Insert into database
                result = (
                    await self.db.supabase.table("master_wine_library")
                    .insert(wine_record)
                    .execute()
                )

                if result.data:
                    success_count += 1
                    print(f"   [{i}/{len(wines)}] ✅ {wine['name']}")
                else:
                    print(f"   [{i}/{len(wines)}] ⚠️ {wine['name']} - No data returned")

            except Exception as e:
                print(f"   [{i}/{len(wines)}] ❌ {wine['name']} - {e}")

        return success_count

    async def verify_seed(self) -> Dict[str, Any]:
        """Verify seeded data"""
        print("\n🔍 Verifying seeded data...")

        # Count total wines
        count_result = (
            await self.db.supabase.table("master_wine_library")
            .select("id", count="exact")
            .execute()
        )
        total_count = count_result.count or 0

        # Count by wine type
        types_result = (
            await self.db.supabase.table("master_wine_library")
            .select("wine_type")
            .execute()
        )
        type_counts = {}
        for record in types_result.data or []:
            wine_type = record.get("wine_type", "unknown")
            type_counts[wine_type] = type_counts.get(wine_type, 0) + 1

        # Count by country
        countries_result = (
            await self.db.supabase.table("master_wine_library")
            .select("country")
            .execute()
        )
        country_counts = {}
        for record in countries_result.data or []:
            country = record.get("country", "unknown")
            country_counts[country] = country_counts.get(country, 0) + 1

        # Count with barcodes
        barcode_result = (
            await self.db.supabase.table("master_wine_library")
            .select("id")
            .not_.is_("barcode", "null")
            .execute()
        )
        barcode_count = len(barcode_result.data or [])

        stats = {
            "total_wines": total_count,
            "by_type": type_counts,
            "by_country": country_counts,
            "with_barcodes": barcode_count,
        }

        print("\n   📊 Statistics:")
        print(f"   Total Wines: {stats['total_wines']}")
        print(f"   With Barcodes: {stats['with_barcodes']}")
        print("\n   By Type:")
        for wine_type, count in sorted(stats["by_type"].items()):
            print(f"      {wine_type}: {count}")
        print("\n   By Country:")
        for country, count in sorted(stats["by_country"].items(), key=lambda x: -x[1]):
            print(f"      {country}: {count}")

        return stats

    async def run(self, clear_first: bool = False):
        """Run the seeder"""
        print("\n" + "=" * 60)
        print("🍷 MASTER WINE LIBRARY SEEDER")
        print("=" * 60)

        try:
            await self.setup()

            # Load seed data
            data = self.load_seed_data()
            if not data:
                return

            print("\n📋 Seed Data Info:")
            print(f"   Version: {data['metadata']['version']}")
            print(f"   Total Wines: {data['metadata']['total_wines']}")
            print(f"   Categories: {', '.join(data['metadata']['categories'])}")
            print(f"   Regions: {len(data['metadata']['regions'])} countries")

            # Clear if requested
            if clear_first:
                await self.clear_existing_data()

            # Seed wines
            wines = data.get("wines", [])
            success_count = await self.seed_wines(wines)

            # Verify
            stats = await self.verify_seed()

            print("\n" + "=" * 60)
            print("✅ SEEDING COMPLETE")
            print(f"   Attempted: {len(wines)}")
            print(f"   Succeeded: {success_count}")
            print(f"   Total in DB: {stats['total_wines']}")
            print("=" * 60)

        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback

            traceback.print_exc()
        finally:
            await self.teardown()


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Master Wine Library Seeder")
    parser.add_argument(
        "--clear", action="store_true", help="Clear existing data before seeding"
    )
    args = parser.parse_args()

    seeder = MasterWineLibrarySeeder()
    await seeder.run(clear_first=args.clear)


if __name__ == "__main__":
    asyncio.run(main())
