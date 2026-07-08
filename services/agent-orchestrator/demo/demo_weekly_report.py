"""
📅 Weekly Report Demo
====================
Demonstrates the Monday 9 AM weekly report workflow:

1. Report triggered (Monday 9 AM or manual)
2. AI collects all data per manager template
3. Generates report in multiple formats (PDF, Excel, CSV)
4. Sends via email and/or SMS
5. Includes summarization for SMS

Usage:
    python demo/demo_weekly_report.py
    python demo/demo_weekly_report.py --send-email  # Actually send email
    python demo/demo_weekly_report.py --send-sms    # Actually send SMS
"""

import asyncio
import csv
import io
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings


class WeeklyReportDemo:
    """
    Demonstrates weekly report generation and delivery
    """

    def __init__(self, send_email: bool = False, send_sms: bool = False):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
        self.send_email = send_email
        self.send_sms = send_sms

        # Demo data
        self.restaurant_id = None
        self.manager_email = None
        self.manager_phone = None

    async def setup(self):
        """Initialize connections"""
        print("🔌 Setting up Weekly Report Demo...")

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
        print("✅ Demo cleanup complete")

    async def get_restaurant_data(self):
        """Get restaurant and manager info"""
        print("\n📋 Loading restaurant data...")

        # Get restaurant
        restaurants = (
            self.db.supabase.table("restaurants").select("*").limit(1).execute()
        )
        if restaurants.data:
            self.restaurant_id = restaurants.data[0]["id"]
            restaurant_name = restaurants.data[0].get("name", "Demo Restaurant")
            self.manager_email = restaurants.data[0].get("email", "demo@wineops.ai")
            print(f"   ✅ Restaurant: {restaurant_name}")
            print(f"   ✅ Email: {self.manager_email}")
        else:
            print("   ⚠️ No restaurant found - using demo data")
            self.restaurant_id = "demo-restaurant"
            self.manager_email = "demo@wineops.ai"

        # Get manager phone from preferences
        prefs = (
            self.db.supabase.table("manager_preferences").select("*").limit(1).execute()
        )
        if prefs.data:
            self.manager_phone = prefs.data[0].get("phone_number", "+1234567890")
        else:
            self.manager_phone = "+1234567890"

        print(f"   ✅ Phone: {self.manager_phone}")

    async def collect_report_data(self) -> Dict[str, Any]:
        """
        Collect all data for the weekly report

        Sections:
        - Financials (revenue, costs, margins)
        - Purchases (orders, spending)
        - Inventory usage
        - Low stock alerts
        """
        print("\n📊 Collecting report data...")

        # Date range (last 7 days)
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=7)

        report_data = {
            "report_type": "weekly",
            "period": {
                "start": start_date.strftime("%Y-%m-%d"),
                "end": end_date.strftime("%Y-%m-%d"),
                "week_number": end_date.isocalendar()[1],
            },
            "generated_at": datetime.utcnow().isoformat(),
            "restaurant_id": self.restaurant_id,
        }

        # 1. FINANCIALS
        print("   📈 Collecting financials...")
        try:
            sales = (
                self.db.supabase.table("sales_events")
                .select("*")
                .eq("restaurant_id", self.restaurant_id)
                .gte("created_at", start_date.isoformat())
                .execute()
            )

            sales_data = sales.data or []
            total_revenue = sum(s.get("total_price", 0) for s in sales_data)
            bottles_sold = sum(s.get("quantity", 0) for s in sales_data)

            report_data["financials"] = {
                "total_revenue": round(total_revenue, 2),
                "bottles_sold": bottles_sold,
                "avg_bottle_price": (
                    round(total_revenue / bottles_sold, 2) if bottles_sold > 0 else 0
                ),
                "transaction_count": len(sales_data),
            }
        except Exception:
            # Use demo data if no sales
            report_data["financials"] = {
                "total_revenue": 4250.00,
                "bottles_sold": 127,
                "avg_bottle_price": 33.46,
                "transaction_count": 89,
            }
        print(f"      Revenue: ${report_data['financials']['total_revenue']}")
        print(f"      Bottles Sold: {report_data['financials']['bottles_sold']}")

        # 2. PURCHASES
        print("   🛒 Collecting purchases...")
        try:
            orders = (
                self.db.supabase.table("procurement_orders")
                .select("*")
                .eq("restaurant_id", self.restaurant_id)
                .gte("created_at", start_date.isoformat())
                .execute()
            )

            orders_data = orders.data or []
            total_spent = sum(o.get("total_cost", 0) or 0 for o in orders_data)
            completed = [o for o in orders_data if o.get("status") == "COMPLETED"]
            pending = [
                o
                for o in orders_data
                if o.get("status") in ["PENDING", "APPROVED", "CONFIRMED"]
            ]

            report_data["purchases"] = {
                "total_orders": len(orders_data),
                "completed_orders": len(completed),
                "pending_orders": len(pending),
                "total_spent": round(total_spent, 2),
                "bottles_ordered": sum(
                    o.get("bottles_total", 0) or 0 for o in orders_data
                ),
            }
        except Exception:
            report_data["purchases"] = {
                "total_orders": 5,
                "completed_orders": 3,
                "pending_orders": 2,
                "total_spent": 1850.00,
                "bottles_ordered": 72,
            }
        print(f"      Orders: {report_data['purchases']['total_orders']}")
        print(f"      Spent: ${report_data['purchases']['total_spent']}")

        # 3. INVENTORY USAGE
        print("   📦 Collecting inventory usage...")
        try:
            inventory = (
                self.db.supabase.table("restaurant_inventory")
                .select("*, master_wine_library(name, primary_type)")
                .eq("restaurant_id", self.restaurant_id)
                .execute()
            )

            inv_data = inventory.data or []
            total_stock = sum(i.get("stock_live", 0) for i in inv_data)

            # Calculate velocity (sales per day)
            avg_velocity = report_data["financials"]["bottles_sold"] / 7

            report_data["inventory"] = {
                "total_items": len(inv_data),
                "total_bottles": total_stock,
                "avg_daily_usage": round(avg_velocity, 1),
                "turnover_rate": round(
                    report_data["financials"]["bottles_sold"] / max(total_stock, 1), 2
                ),
            }
        except Exception:
            report_data["inventory"] = {
                "total_items": 45,
                "total_bottles": 312,
                "avg_daily_usage": 18.1,
                "turnover_rate": 0.41,
            }
        print(f"      Total Items: {report_data['inventory']['total_items']}")
        print(
            f"      Daily Usage: {report_data['inventory']['avg_daily_usage']} bottles"
        )

        # 4. LOW STOCK ALERTS
        print("   ⚠️ Collecting low stock alerts...")
        try:
            # Get items where stock_live <= threshold_min
            low_stock = []
            for item in inv_data:
                if item.get("stock_live", 0) <= item.get("threshold_min", 3):
                    wine_info = item.get("master_wine_library", {}) or {}
                    low_stock.append(
                        {
                            "name": wine_info.get("name", "Unknown"),
                            "type": wine_info.get("primary_type", "unknown"),
                            "stock": item.get("stock_live", 0),
                            "threshold": item.get("threshold_min", 3),
                        }
                    )

            report_data["low_stock_alerts"] = {
                "count": len(low_stock),
                "items": low_stock[:5],  # Top 5
            }
        except Exception:
            report_data["low_stock_alerts"] = {
                "count": 3,
                "items": [
                    {
                        "name": "Château Demo Reserve",
                        "type": "red",
                        "stock": 3,
                        "threshold": 4,
                    },
                    {
                        "name": "Cloudy Bay Sauvignon",
                        "type": "white",
                        "stock": 2,
                        "threshold": 5,
                    },
                    {
                        "name": "Dom Pérignon 2012",
                        "type": "sparkling",
                        "stock": 1,
                        "threshold": 2,
                    },
                ],
            }
        print(f"      Low Stock Items: {report_data['low_stock_alerts']['count']}")

        # 5. TOP PERFORMERS
        print("   🏆 Identifying top performers...")
        report_data["top_performers"] = {
            "wines": [
                {"name": "Opus One 2019", "sold": 12, "revenue": 540.00},
                {"name": "Caymus Cabernet", "sold": 18, "revenue": 432.00},
                {"name": "Whispering Angel Rosé", "sold": 24, "revenue": 384.00},
            ],
            "categories": {
                "red": {"percentage": 45, "revenue": 1912.50},
                "white": {"percentage": 30, "revenue": 1275.00},
                "sparkling": {"percentage": 15, "revenue": 637.50},
                "rosé": {"percentage": 10, "revenue": 425.00},
            },
        }

        # 6. GROSS MARGIN
        gross_margin = (
            report_data["financials"]["total_revenue"]
            - report_data["purchases"]["total_spent"]
        )
        margin_pct = (
            (gross_margin / report_data["financials"]["total_revenue"] * 100)
            if report_data["financials"]["total_revenue"] > 0
            else 0
        )

        report_data["margins"] = {
            "gross_margin": round(gross_margin, 2),
            "margin_percentage": round(margin_pct, 1),
        }

        print("\n   ✅ Data collection complete!")
        print(
            f"   Gross Margin: ${report_data['margins']['gross_margin']} ({report_data['margins']['margin_percentage']}%)"
        )

        return report_data

    def generate_email_html(self, data: Dict[str, Any]) -> str:
        """Generate HTML email report"""

        # Low stock items HTML
        low_stock_html = ""
        for item in data["low_stock_alerts"]["items"]:
            low_stock_html += f"""
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">{item['name']}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">{item['type']}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #dc3545;">{item['stock']}/{item['threshold']}</td>
            </tr>
            """

        # Top wines HTML
        top_wines_html = ""
        for wine in data["top_performers"]["wines"]:
            top_wines_html += f"""
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">{wine['name']}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">{wine['sold']} bottles</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${wine['revenue']:.2f}</td>
            </tr>
            """

        html = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Weekly WineOps Report</title>
</head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
    <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #8B2635, #5a1a23); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🍷 Weekly WineOps Report</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0;">
                Week {data['period']['week_number']} | {data['period']['start']} to {data['period']['end']}
            </p>
        </div>
        
        <!-- Executive Summary -->
        <div style="padding: 25px;">
            <h2 style="color: #333; border-bottom: 2px solid #8B2635; padding-bottom: 10px;">📊 Executive Summary</h2>
            
            <div style="display: flex; flex-wrap: wrap; gap: 15px; margin: 20px 0;">
                <!-- Revenue Card -->
                <div style="flex: 1; min-width: 150px; background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 32px; color: #28a745; font-weight: bold;">${data['financials']['total_revenue']:,.2f}</div>
                    <div style="color: #666; margin-top: 5px;">Total Revenue</div>
                </div>
                
                <!-- Bottles Sold Card -->
                <div style="flex: 1; min-width: 150px; background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 32px; color: #007bff; font-weight: bold;">{data['financials']['bottles_sold']}</div>
                    <div style="color: #666; margin-top: 5px;">Bottles Sold</div>
                </div>
                
                <!-- Margin Card -->
                <div style="flex: 1; min-width: 150px; background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 32px; color: #17a2b8; font-weight: bold;">{data['margins']['margin_percentage']}%</div>
                    <div style="color: #666; margin-top: 5px;">Gross Margin</div>
                </div>
            </div>
        </div>
        
        <!-- Financials -->
        <div style="padding: 0 25px 25px;">
            <h2 style="color: #333; border-bottom: 2px solid #28a745; padding-bottom: 10px;">💰 Financial Summary</h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr>
                    <td style="padding: 12px; background: #f8f9fa;">Total Revenue</td>
                    <td style="padding: 12px; background: #f8f9fa; text-align: right; font-weight: bold;">${data['financials']['total_revenue']:,.2f}</td>
                </tr>
                <tr>
                    <td style="padding: 12px;">Procurement Costs</td>
                    <td style="padding: 12px; text-align: right; color: #dc3545;">-${data['purchases']['total_spent']:,.2f}</td>
                </tr>
                <tr style="border-top: 2px solid #333;">
                    <td style="padding: 12px; font-weight: bold;">Gross Margin</td>
                    <td style="padding: 12px; text-align: right; font-weight: bold; color: #28a745;">${data['margins']['gross_margin']:,.2f}</td>
                </tr>
            </table>
        </div>
        
        <!-- Purchases -->
        <div style="padding: 0 25px 25px;">
            <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">🛒 Procurement Summary</h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr>
                    <td style="padding: 10px; background: #f8f9fa;">Total Orders</td>
                    <td style="padding: 10px; background: #f8f9fa; text-align: right;">{data['purchases']['total_orders']}</td>
                </tr>
                <tr>
                    <td style="padding: 10px;">Completed</td>
                    <td style="padding: 10px; text-align: right; color: #28a745;">{data['purchases']['completed_orders']} ✓</td>
                </tr>
                <tr>
                    <td style="padding: 10px; background: #f8f9fa;">Pending</td>
                    <td style="padding: 10px; background: #f8f9fa; text-align: right; color: #ffc107;">{data['purchases']['pending_orders']} ⏳</td>
                </tr>
                <tr>
                    <td style="padding: 10px;">Bottles Ordered</td>
                    <td style="padding: 10px; text-align: right;">{data['purchases']['bottles_ordered']}</td>
                </tr>
            </table>
        </div>
        
        <!-- Top Performers -->
        <div style="padding: 0 25px 25px;">
            <h2 style="color: #333; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">🏆 Top Performing Wines</h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; text-align: left;">Wine</th>
                        <th style="padding: 10px; text-align: left;">Sold</th>
                        <th style="padding: 10px; text-align: left;">Revenue</th>
                    </tr>
                </thead>
                <tbody>
                    {top_wines_html}
                </tbody>
            </table>
        </div>
        
        <!-- Low Stock Alerts -->
        <div style="padding: 0 25px 25px;">
            <h2 style="color: #333; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">⚠️ Low Stock Alerts ({data['low_stock_alerts']['count']})</h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <thead>
                    <tr style="background: #fff3cd;">
                        <th style="padding: 10px; text-align: left;">Wine</th>
                        <th style="padding: 10px; text-align: left;">Type</th>
                        <th style="padding: 10px; text-align: left;">Stock</th>
                    </tr>
                </thead>
                <tbody>
                    {low_stock_html}
                </tbody>
            </table>
        </div>
        
        <!-- Inventory Summary -->
        <div style="padding: 0 25px 25px;">
            <h2 style="color: #333; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">📦 Inventory Status</h2>
            <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-top: 15px;">
                <div style="flex: 1; min-width: 120px; background: #d1ecf1; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">{data['inventory']['total_items']}</div>
                    <div style="color: #0c5460; font-size: 12px;">Total SKUs</div>
                </div>
                <div style="flex: 1; min-width: 120px; background: #d1ecf1; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">{data['inventory']['total_bottles']}</div>
                    <div style="color: #0c5460; font-size: 12px;">Total Bottles</div>
                </div>
                <div style="flex: 1; min-width: 120px; background: #d1ecf1; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold;">{data['inventory']['avg_daily_usage']}</div>
                    <div style="color: #0c5460; font-size: 12px;">Avg Daily Usage</div>
                </div>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #eee;">
            <p style="color: #666; margin: 0; font-size: 14px;">
                Generated by <strong>WineOps AI</strong> on {datetime.now().strftime('%B %d, %Y at %I:%M %p')}
            </p>
            <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">
                <a href="#" style="color: #8B2635;">View Full Dashboard</a> | 
                <a href="#" style="color: #8B2635;">Manage Preferences</a> |
                <a href="#" style="color: #8B2635;">Download PDF</a>
            </p>
        </div>
    </div>
</body>
</html>
"""
        return html

    def generate_csv_report(self, data: Dict[str, Any]) -> str:
        """Generate CSV report"""
        output = io.StringIO()
        writer = csv.writer(output)

        # Header
        writer.writerow(["WineOps Weekly Report"])
        writer.writerow(
            [f"Period: {data['period']['start']} to {data['period']['end']}"]
        )
        writer.writerow([])

        # Financials
        writer.writerow(["FINANCIAL SUMMARY"])
        writer.writerow(["Metric", "Value"])
        writer.writerow(
            ["Total Revenue", f"${data['financials']['total_revenue']:.2f}"]
        )
        writer.writerow(["Bottles Sold", data["financials"]["bottles_sold"]])
        writer.writerow(
            ["Avg Bottle Price", f"${data['financials']['avg_bottle_price']:.2f}"]
        )
        writer.writerow(["Transactions", data["financials"]["transaction_count"]])
        writer.writerow([])

        # Purchases
        writer.writerow(["PROCUREMENT SUMMARY"])
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Total Orders", data["purchases"]["total_orders"]])
        writer.writerow(["Completed", data["purchases"]["completed_orders"]])
        writer.writerow(["Pending", data["purchases"]["pending_orders"]])
        writer.writerow(["Total Spent", f"${data['purchases']['total_spent']:.2f}"])
        writer.writerow([])

        # Low Stock
        writer.writerow(["LOW STOCK ALERTS"])
        writer.writerow(["Wine", "Type", "Current Stock", "Threshold"])
        for item in data["low_stock_alerts"]["items"]:
            writer.writerow(
                [item["name"], item["type"], item["stock"], item["threshold"]]
            )

        return output.getvalue()

    def generate_sms_summary(self, data: Dict[str, Any]) -> str:
        """Generate SMS-friendly summary (160 chars max per message)"""

        summary = f"""📊 WEEKLY REPORT
Week {data['period']['week_number']}

💰 Revenue: ${data['financials']['total_revenue']:,.0f}
🍷 Sold: {data['financials']['bottles_sold']} bottles
📈 Margin: {data['margins']['margin_percentage']}%
⚠️ Low Stock: {data['low_stock_alerts']['count']} items

Reply DETAILS for full report"""

        return summary

    async def send_report_email(self, html: str, data: Dict[str, Any]):
        """Send report via email"""
        if not self.send_email:
            print("\n   📧 Email preview (--send-email to actually send):")
            print(f"   To: {self.manager_email}")
            print(
                f"   Subject: 📊 Weekly WineOps Report - Week {data['period']['week_number']}"
            )
            return

        try:
            from services.email_client import EmailClient

            email_client = EmailClient(
                backend="gmail",
                gmail_user=self.settings.gmail_user,
                gmail_password=self.settings.gmail_password,
                mock_mode=False,
            )

            result = await email_client.send_email(
                to_email=self.manager_email,
                subject=f"📊 Weekly WineOps Report - Week {data['period']['week_number']}",
                html_body=html,
            )

            if result:
                print(f"\n   ✅ Email sent to {self.manager_email}")
            else:
                print("\n   ❌ Failed to send email")

        except Exception as e:
            print(f"\n   ❌ Email error: {e}")

    async def send_report_sms(self, summary: str, data: Dict[str, Any]):
        """Send report summary via SMS"""
        if not self.send_sms:
            print("\n   📱 SMS preview (--send-sms to actually send):")
            print(f"   To: {self.manager_phone}")
            print(f"   Message ({len(summary)} chars):")
            print(f"   {'-'*40}")
            print(f"   {summary}")
            return

        try:
            from services.sms_client import SMSClient

            sms_client = SMSClient(
                plivo_auth_id=self.settings.plivo_auth_id,
                plivo_auth_token=self.settings.plivo_auth_token,
                from_number=self.settings.plivo_phone_number,
                mock_mode=False,
            )

            result = await sms_client.send_sms(
                to_number=self.manager_phone,
                message=summary,
            )

            if result:
                print(f"\n   ✅ SMS sent to {self.manager_phone}")
            else:
                print("\n   ❌ Failed to send SMS")

        except Exception as e:
            print(f"\n   ❌ SMS error: {e}")

    async def run_demo(self):
        """Run the weekly report demo"""
        print("\n" + "=" * 70)
        print("📅 WEEKLY REPORT DEMO - Monday 9:00 AM")
        print("=" * 70)
        print(f"Date: {datetime.now().strftime('%A, %B %d, %Y at %I:%M %p')}")

        try:
            await self.setup()
            await self.get_restaurant_data()

            # Step 1: Trigger report
            print("\n" + "=" * 60)
            print("⏰ STEP 1: Report Triggered")
            print("=" * 60)
            print("   Trigger: Monday 9:00 AM (scheduled)")
            print("   Template: Weekly Performance Report")

            # Step 2: Collect data
            print("\n" + "=" * 60)
            print("🤖 STEP 2: AI Collects Data")
            print("=" * 60)
            data = await self.collect_report_data()

            # Step 3: Generate reports
            print("\n" + "=" * 60)
            print("📄 STEP 3: Generate Report Formats")
            print("=" * 60)

            # HTML
            html = self.generate_email_html(data)
            print(f"   ✅ HTML Report: {len(html):,} characters")

            # CSV
            csv_report = self.generate_csv_report(data)
            print(f"   ✅ CSV Report: {len(csv_report.split(chr(10)))} rows")

            # SMS Summary
            sms_summary = self.generate_sms_summary(data)
            print(f"   ✅ SMS Summary: {len(sms_summary)} characters")

            # Step 4: Send Email
            print("\n" + "=" * 60)
            print("📧 STEP 4: Send Email Report")
            print("=" * 60)
            await self.send_report_email(html, data)

            # Step 5: Send SMS
            print("\n" + "=" * 60)
            print("📱 STEP 5: Send SMS Summary")
            print("=" * 60)
            await self.send_report_sms(sms_summary, data)

            # Summary
            print("\n" + "=" * 70)
            print("🎉 WEEKLY REPORT DEMO COMPLETE!")
            print("=" * 70)
            print("\n📊 Report Summary:")
            print(
                f"   Period: Week {data['period']['week_number']} ({data['period']['start']} to {data['period']['end']})"
            )
            print(f"   Revenue: ${data['financials']['total_revenue']:,.2f}")
            print(f"   Bottles Sold: {data['financials']['bottles_sold']}")
            print(
                f"   Gross Margin: ${data['margins']['gross_margin']:,.2f} ({data['margins']['margin_percentage']}%)"
            )
            print(f"   Low Stock Alerts: {data['low_stock_alerts']['count']}")
            print("\n📬 Delivery:")
            print(
                f"   Email: {self.manager_email} {'✅ SENT' if self.send_email else '(preview only)'}"
            )
            print(
                f"   SMS: {self.manager_phone} {'✅ SENT' if self.send_sms else '(preview only)'}"
            )

            # Save HTML to file for preview
            output_path = Path(__file__).parent / "weekly_report_preview.html"
            with open(output_path, "w") as f:
                f.write(html)
            print(f"\n   📄 HTML saved to: {output_path}")
            print("   Open in browser to preview the email")

        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback

            traceback.print_exc()
        finally:
            await self.teardown()


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Weekly Report Demo")
    parser.add_argument("--send-email", action="store_true", help="Actually send email")
    parser.add_argument("--send-sms", action="store_true", help="Actually send SMS")
    args = parser.parse_args()

    demo = WeeklyReportDemo(
        send_email=args.send_email,
        send_sms=args.send_sms,
    )
    await demo.run_demo()


if __name__ == "__main__":
    asyncio.run(main())
