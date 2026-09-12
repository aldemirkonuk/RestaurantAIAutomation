"""
📅 Weekly Report Scheduler
=========================
Schedules and triggers weekly reports every Monday at 9 AM

Features:
- Timezone-aware scheduling (per manager preference)
- Multiple report types (sales, financials, orders review)
- Configurable delivery channels (email, push, SMS)

Usage:
    # Run as standalone scheduler
    python demo/weekly_report_scheduler.py
    
    # Or integrate with APScheduler in main app
"""

import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings


class WeeklyReportScheduler:
    """
    Schedules and triggers weekly reports for all managers
    """

    def __init__(self):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
        self.scheduler: Optional[AsyncIOScheduler] = None

    async def setup(self):
        """Initialize connections and scheduler"""
        print("🔌 Setting up Weekly Report Scheduler...")

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

        # Initialize scheduler
        self.scheduler = AsyncIOScheduler()
        print("   ✅ Scheduler initialized")

    async def teardown(self):
        """Cleanup"""
        if self.scheduler and self.scheduler.running:
            self.scheduler.shutdown()
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
        print("✅ Scheduler cleaned up")

    async def get_all_managers_with_preferences(self) -> List[Dict[str, Any]]:
        """
        Get all managers with their report preferences.

        OD-99: this read a table called `managers`. No migration in this
        repository declares it and production returns 404 PGRST205 (verified
        2026-08-26), so the `except` below caught it, printed "Error getting
        managers", and returned `[]` -- meaning this scheduler has never had a
        single manager to report to, and every downstream method here has been
        unreachable since the baseline.

        The real table is `manager_report_profiles`: it exists in production,
        it is what `generated_reports.profile_id` points at, and it carries
        `manager_id`, `restaurant_id`, `weekly_enabled`, `timezone` and
        `delivery_channels` -- i.e. exactly "managers with report
        preferences". Note the join key changed with it: rows here are
        *profiles*, so the per-manager preference lookup below must use
        `manager_id`, not the profile's own `id`.

        `manager_report_profiles` holds 0 rows in production today, so this
        demo still has nothing to report on -- but it is now empty because
        nobody has configured a report profile, which is a true statement,
        rather than empty because the query 404'd, which was not.
        """
        try:
            # Get managers
            managers_result = (
                await self.db.supabase.table("manager_report_profiles")
                .select("*")
                .execute()
            )
            managers = managers_result.data or []

            # Get preferences for each manager
            for manager in managers:
                prefs_result = (
                    await self.db.supabase.table("manager_preferences")
                    .select("*")
                    .eq("manager_id", manager["manager_id"])
                    .limit(1)
                    .execute()
                )

                if prefs_result.data:
                    manager["preferences"] = prefs_result.data[0]
                else:
                    # Default preferences
                    manager["preferences"] = {
                        "report_frequency": "WEEKLY",
                        "report_delivery_time": "09:00:00",
                        "report_timezone": "America/Los_Angeles",
                        "notification_channels": {
                            "email": True,
                            "push": True,
                            "sms": False,
                        },
                    }

            return managers

        except Exception as e:
            print(f"Error getting managers: {e}")
            return []

    async def generate_weekly_report(self, manager: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate comprehensive weekly report for a manager

        Includes:
        - Sales summary (7-day)
        - Financial overview
        - Orders review
        - Inventory status
        - Vendor performance
        """
        restaurant_id = manager.get("restaurant_id")

        report = {
            "type": "weekly",
            "manager_id": manager["manager_id"],
            "restaurant_id": restaurant_id,
            "generated_at": datetime.utcnow().isoformat(),
            "period": {
                "start": (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d"),
                "end": datetime.utcnow().strftime("%Y-%m-%d"),
            },
            "sections": {},
        }

        try:
            # 1. Sales Summary
            sales_result = (
                await self.db.supabase.table("sales_events")
                .select("*")
                .eq("restaurant_id", restaurant_id)
                .gte("created_at", report["period"]["start"])
                .execute()
            )

            sales_data = sales_result.data or []
            total_sales = sum(s.get("total_amount", 0) for s in sales_data)
            wine_sales = sum(s.get("wine_amount", 0) for s in sales_data)

            report["sections"]["sales"] = {
                "total_revenue": total_sales,
                "wine_revenue": wine_sales,
                "transaction_count": len(sales_data),
                "avg_transaction": total_sales / len(sales_data) if sales_data else 0,
            }

            # 2. Orders Review
            orders_result = (
                await self.db.supabase.table("procurement_orders")
                .select("*")
                .eq("restaurant_id", restaurant_id)
                .gte("created_at", report["period"]["start"])
                .execute()
            )

            orders_data = orders_result.data or []
            completed_orders = [
                o for o in orders_data if o.get("status") == "COMPLETED"
            ]
            pending_orders = [
                o
                for o in orders_data
                if o.get("status") in ["PENDING", "NEGOTIATING", "APPROVED"]
            ]

            report["sections"]["orders"] = {
                "total_orders": len(orders_data),
                "completed": len(completed_orders),
                "pending": len(pending_orders),
                "total_spent": sum(
                    o.get("final_confirmed_cost", 0) or 0 for o in completed_orders
                ),
            }

            # 3. Inventory Status
            inventory_result = (
                await self.db.supabase.table("restaurant_inventory")
                .select("*, master_wine_library(name)")
                .eq("restaurant_id", restaurant_id)
                .execute()
            )

            inventory_data = inventory_result.data or []
            low_stock_items = [
                i
                for i in inventory_data
                if i.get("stock_live", 0) <= i.get("threshold_min", 3)
            ]

            report["sections"]["inventory"] = {
                "total_items": len(inventory_data),
                "low_stock_count": len(low_stock_items),
                "low_stock_items": [
                    {
                        "name": i.get("master_wine_library", {}).get("name", "Unknown"),
                        "stock": i.get("stock_live", 0),
                        "threshold": i.get("threshold_min", 3),
                    }
                    for i in low_stock_items[:5]  # Top 5 low stock
                ],
            }

            # 4. Financial Summary
            report["sections"]["financials"] = {
                "revenue": total_sales,
                "procurement_cost": report["sections"]["orders"]["total_spent"],
                "gross_margin": total_sales
                - report["sections"]["orders"]["total_spent"],
            }

        except Exception as e:
            print(f"Error generating report sections: {e}")

        return report

    async def send_weekly_report(self, manager: Dict[str, Any]):
        """Send weekly report to a specific manager"""
        print(f"\n📊 Generating weekly report for: {manager.get('name', 'Unknown')}")

        # Generate report
        report = await self.generate_weekly_report(manager)

        # Get notification channels
        prefs = manager.get("preferences", {})
        channels = prefs.get("notification_channels", {"email": True, "push": True})

        # Publish report event
        await self.message_bus.publish(
            queue="reporting.events",
            message={
                "event_type": "WeeklyReportGenerated",
                "routing_key": "report.weekly",
                "timestamp": datetime.utcnow().isoformat(),
                "payload": {
                    "manager_id": manager["manager_id"],
                    "manager_email": manager.get("email"),
                    "manager_phone": manager.get("phone"),
                    "report": report,
                    "channels": channels,
                },
            },
        )

        print(f"   ✅ Weekly report sent to {manager.get('name')}")
        print(f"   📧 Email: {'Yes' if channels.get('email') else 'No'}")
        print(f"   📱 Push: {'Yes' if channels.get('push') else 'No'}")
        print(f"   💬 SMS: {'Yes' if channels.get('sms') else 'No'}")

        return report

    async def trigger_all_weekly_reports(self):
        """Trigger weekly reports for all managers"""
        print("\n" + "=" * 60)
        print("📅 WEEKLY REPORT TRIGGER - Monday 9:00 AM")
        print("=" * 60)
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        managers = await self.get_all_managers_with_preferences()

        if not managers:
            print("⚠️ No managers found")
            return

        print(f"\n📋 Generating reports for {len(managers)} manager(s)...")

        for manager in managers:
            try:
                await self.send_weekly_report(manager)
            except Exception as e:
                print(f"   ❌ Error for {manager.get('name')}: {e}")

        print("\n" + "=" * 60)
        print("✅ All weekly reports generated and sent!")
        print("=" * 60)

    def schedule_weekly_reports(self):
        """Schedule weekly reports for Monday 9 AM"""
        # Schedule for every Monday at 9:00 AM (America/Los_Angeles)
        trigger = CronTrigger(
            day_of_week="mon",
            hour=9,
            minute=0,
            timezone=pytz.timezone("America/Los_Angeles"),
        )

        self.scheduler.add_job(
            self.trigger_all_weekly_reports,
            trigger=trigger,
            id="weekly_report_job",
            name="Weekly Report Generation",
            replace_existing=True,
        )

        print("📅 Weekly reports scheduled for Monday 9:00 AM (America/Los_Angeles)")

    async def run_scheduler(self):
        """Run the scheduler"""
        await self.setup()

        self.schedule_weekly_reports()
        self.scheduler.start()

        print("\n🚀 Weekly Report Scheduler is running!")
        print("   Next run: Monday 9:00 AM (America/Los_Angeles)")
        print("   Press Ctrl+C to stop\n")

        try:
            # Keep running
            while True:
                await asyncio.sleep(60)
        except KeyboardInterrupt:
            print("\n⏹️ Scheduler stopped by user")
        finally:
            await self.teardown()

    async def run_now(self):
        """Run weekly reports immediately (for testing)"""
        await self.setup()
        await self.trigger_all_weekly_reports()
        await self.teardown()


# Add missing import
from datetime import timedelta


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Weekly Report Scheduler")
    parser.add_argument("--now", action="store_true", help="Run reports immediately")
    parser.add_argument(
        "--schedule", action="store_true", help="Run as scheduler daemon"
    )
    args = parser.parse_args()

    scheduler = WeeklyReportScheduler()

    if args.now:
        await scheduler.run_now()
    elif args.schedule:
        await scheduler.run_scheduler()
    else:
        print("Usage:")
        print(
            "  python weekly_report_scheduler.py --now      # Run reports immediately"
        )
        print(
            "  python weekly_report_scheduler.py --schedule # Run as scheduler daemon"
        )


if __name__ == "__main__":
    asyncio.run(main())
