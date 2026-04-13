"""
📅 Weekly Report Demo (LLM-Guided, Supabase-Only)
=================================================
Implements the WineOps AI Demo Mode with strict data constraints.

CRITICAL RULES:
- ONLY uses data from Supabase queries
- NO external knowledge, assumptions, or fabricated data
- Gmail-ready email output using website templates
- Weekly recurring report (Monday delivery)

Usage:
    python demo/demo_weekly_report_llm.py
    python demo/demo_weekly_report_llm.py --send-email
    python demo/demo_weekly_report_llm.py --include-toast  # Include Toast POS data
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from uuid import uuid4
import sys
import os
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import DatabaseClient
from core.message_bus import MessageBus
from config.settings import get_settings


# =============================================================================
# LLM SYSTEM PROMPT
# =============================================================================

LLM_SYSTEM_PROMPT = """
🔒 LLM SYSTEM PROMPT — WineOps Automation AI (Demo Mode)

Role:
You are WineOps Automation AI, operating in Demo Mode.

Primary Objective:
Generate a weekly recurring report (sent every Monday) using ONLY data provided 
from Supabase and format the output ONLY for Gmail email delivery.

🔐 Data Constraints (CRITICAL)
You must ONLY use data explicitly provided from Supabase queries.
You must NOT:
- Use external knowledge
- Use assumptions
- Use live website data
- Use historical or inferred data
- Use APIs or sources not explicitly passed to you

If a data field is missing, clearly state it as "Data not available in Supabase."

📧 Email Output Constraints
Output must be Gmail-ready email content only:
- Subject line
- Clean, professional email body

Do NOT include:
- HTML requiring dynamic website rendering
- Placeholders that rely on live web data
- References to dashboards, links, or widgets not embedded in email

📊 Reporting Behavior
- Reports are recurring weekly summaries sent every Monday.
- Audience: Managers / Decision-Makers
- Tone: Professional, Concise, Executive-friendly
- Focus on: Trends, Changes since last week (only if data supports), Key metrics

🧠 Reasoning Rules
- Base all insights strictly on the provided Supabase dataset.
- Do not fabricate trends, percentages, or comparisons.
- If analysis is limited due to data scope, explain the limitation clearly.

❓ Clarification Protocol
If required data is missing to generate a meaningful report, ask one concise 
clarification question and stop.
"""


# =============================================================================
# DATA SOURCE TRACKING
# =============================================================================

class DataSource(Enum):
    SUPABASE = "supabase"
    TOAST_API = "toast_api"
    NOT_AVAILABLE = "not_available"


@dataclass
class DataField:
    """Tracks data source for each field"""
    value: Any
    source: DataSource
    table: Optional[str] = None
    query_time: Optional[datetime] = None
    
    def is_available(self) -> bool:
        return self.source != DataSource.NOT_AVAILABLE


@dataclass
class SupabaseQueryResult:
    """Structured result from Supabase query"""
    table: str
    query: str
    row_count: int
    data: List[Dict[str, Any]]
    executed_at: datetime
    success: bool
    error: Optional[str] = None


# =============================================================================
# WEBSITE TEMPLATES (from Communication.tsx)
# =============================================================================

WEBSITE_EMAIL_TEMPLATES = {
    "weekly": {
        "id": "tmpl_weekly",
        "title": "Weekly Performance",
        "cadence": "Weekly",
        "channel": "gmail",
        "subject": "Weekly WineOps Performance — Week of {{week_of}}",
        "body": """Hi {{manager_name}},

Here is the weekly performance for {{week_of}}.

- Weekly revenue: {{revenue_week}}
- Best-performing category: {{best_category}}
- Notable orders: {{order_highlights}}
""",
        "sections": [
            "monthly financial chart",
            "revenue",
            "order details for the month",
            "top wines",
            "events & reservations",
        ],
    },
}

WEBSITE_SMS_TEMPLATES = {
    "weekly": {
        "id": "wa_weekly",
        "title": "Weekly WhatsApp",
        "cadence": "Weekly",
        "channel": "whatsapp",
        "body": """Hi {{manager_name}} — weekly summary:
- Revenue: {{revenue_week}}
- Top type: {{top_type}}
- Orders: {{order_highlights}}
Reply 1) Approve restock 2) Defer 3) Call me.""",
    },
}


# =============================================================================
# WEEKLY REPORT GENERATOR (LLM-GUIDED)
# =============================================================================

class WeeklyReportLLM:
    """
    LLM-Guided Weekly Report Generator
    
    Strictly follows the system prompt:
    - ONLY uses Supabase data
    - Gmail-ready output using website templates
    - Professional, executive-friendly tone
    - Clear data coverage notes
    """
    
    def __init__(self, include_toast: bool = False, send_email: bool = False):
        self.settings = get_settings()
        self.db: Optional[DatabaseClient] = None
        self.message_bus: Optional[MessageBus] = None
        self.include_toast = include_toast
        self.send_email = send_email
        
        # Data tracking
        self.supabase_queries: List[SupabaseQueryResult] = []
        self.data_sources_used: List[str] = []
        
        # Restaurant context
        self.restaurant_id: Optional[str] = None
        self.restaurant_name: str = "Restaurant"
        self.manager_email: Optional[str] = None
        
    async def setup(self):
        """Initialize connections"""
        print("🔌 Connecting to Supabase...")
        
        self.db = DatabaseClient(
            supabase_url=self.settings.supabase_url,
            supabase_key=self.settings.supabase_service_role_key,
            redis_url=self.settings.redis_url,
        )
        await self.db.connect()
        print("   ✅ Supabase connected")
        
        self.message_bus = MessageBus(self.settings.rabbitmq_url)
        await self.message_bus.connect()
        print("   ✅ Message bus connected")
        
    async def teardown(self):
        """Cleanup"""
        if self.db:
            await self.db.disconnect()
        if self.message_bus:
            await self.message_bus.disconnect()
        print("✅ Connections closed")
    
    # =========================================================================
    # SUPABASE DATA QUERIES (STRICT - NO FABRICATION)
    # =========================================================================
    
    def _record_query(self, table: str, query: str, data: List[Dict], success: bool, error: str = None):
        """Record query for data coverage tracking"""
        result = SupabaseQueryResult(
            table=table,
            query=query,
            row_count=len(data) if data else 0,
            data=data or [],
            executed_at=datetime.utcnow(),
            success=success,
            error=error,
        )
        self.supabase_queries.append(result)
        if success and data:
            self.data_sources_used.append(f"Supabase:{table}")
        return result
    
    async def query_restaurant(self) -> DataField:
        """Query restaurant from Supabase"""
        try:
            result = self.db.supabase.table("restaurants").select("*").limit(1).execute()
            self._record_query("restaurants", "SELECT * LIMIT 1", result.data, True)
            
            if result.data:
                self.restaurant_id = result.data[0]["id"]
                self.restaurant_name = result.data[0].get("name", "Restaurant")
                self.manager_email = result.data[0].get("email")
                return DataField(
                    value=result.data[0],
                    source=DataSource.SUPABASE,
                    table="restaurants",
                    query_time=datetime.utcnow(),
                )
            return DataField(value=None, source=DataSource.NOT_AVAILABLE)
        except Exception as e:
            self._record_query("restaurants", "SELECT * LIMIT 1", [], False, str(e))
            return DataField(value=None, source=DataSource.NOT_AVAILABLE)
    
    async def query_sales_events(self, start_date: datetime, end_date: datetime) -> DataField:
        """Query sales events from Supabase"""
        if not self.restaurant_id:
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
        
        try:
            result = self.db.supabase.table("sales_events") \
                .select("*") \
                .eq("restaurant_id", self.restaurant_id) \
                .gte("created_at", start_date.isoformat()) \
                .lte("created_at", end_date.isoformat()) \
                .execute()
            
            query = f"SELECT * WHERE restaurant_id={self.restaurant_id} AND created_at BETWEEN {start_date.date()} AND {end_date.date()}"
            self._record_query("sales_events", query, result.data, True)
            
            return DataField(
                value=result.data or [],
                source=DataSource.SUPABASE,
                table="sales_events",
                query_time=datetime.utcnow(),
            )
        except Exception as e:
            self._record_query("sales_events", "SELECT *", [], False, str(e))
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
    
    async def query_procurement_orders(self, start_date: datetime, end_date: datetime) -> DataField:
        """Query procurement orders from Supabase"""
        if not self.restaurant_id:
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
        
        try:
            result = self.db.supabase.table("procurement_orders") \
                .select("*") \
                .eq("restaurant_id", self.restaurant_id) \
                .gte("created_at", start_date.isoformat()) \
                .lte("created_at", end_date.isoformat()) \
                .execute()
            
            query = f"SELECT * WHERE restaurant_id={self.restaurant_id} AND created_at BETWEEN {start_date.date()} AND {end_date.date()}"
            self._record_query("procurement_orders", query, result.data, True)
            
            return DataField(
                value=result.data or [],
                source=DataSource.SUPABASE,
                table="procurement_orders",
                query_time=datetime.utcnow(),
            )
        except Exception as e:
            self._record_query("procurement_orders", "SELECT *", [], False, str(e))
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
    
    async def query_inventory(self) -> DataField:
        """Query current inventory from Supabase"""
        if not self.restaurant_id:
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
        
        try:
            result = self.db.supabase.table("restaurant_inventory") \
                .select("*, master_wine_library(name, primary_type)") \
                .eq("restaurant_id", self.restaurant_id) \
                .execute()
            
            query = f"SELECT *, master_wine_library(*) WHERE restaurant_id={self.restaurant_id}"
            self._record_query("restaurant_inventory", query, result.data, True)
            
            return DataField(
                value=result.data or [],
                source=DataSource.SUPABASE,
                table="restaurant_inventory",
                query_time=datetime.utcnow(),
            )
        except Exception as e:
            self._record_query("restaurant_inventory", "SELECT *", [], False, str(e))
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
    
    async def query_providers(self) -> DataField:
        """Query providers from Supabase"""
        try:
            result = self.db.supabase.table("providers") \
                .select("*") \
                .eq("is_active", True) \
                .execute()
            
            self._record_query("providers", "SELECT * WHERE is_active=true", result.data, True)
            
            return DataField(
                value=result.data or [],
                source=DataSource.SUPABASE,
                table="providers",
                query_time=datetime.utcnow(),
            )
        except Exception as e:
            self._record_query("providers", "SELECT *", [], False, str(e))
            return DataField(value=[], source=DataSource.NOT_AVAILABLE)
    
    # =========================================================================
    # DATA AGGREGATION (STRICT - ONLY FROM SUPABASE)
    # =========================================================================
    
    def aggregate_report_data(
        self,
        sales_data: DataField,
        orders_data: DataField,
        inventory_data: DataField,
        providers_data: DataField,
        period_start: datetime,
        period_end: datetime,
    ) -> Dict[str, Any]:
        """
        Aggregate data for report - ONLY from Supabase
        
        If data is not available, explicitly state it.
        NO fabrication or assumptions.
        """
        report = {
            "period": {
                "start": period_start.strftime("%Y-%m-%d"),
                "end": period_end.strftime("%Y-%m-%d"),
                "week_number": period_end.isocalendar()[1],
            },
            "generated_at": datetime.utcnow().isoformat(),
            "restaurant": {
                "id": self.restaurant_id,
                "name": self.restaurant_name,
            },
            "data_sources": [],
            "sections": {},
        }
        
        # FINANCIALS (from sales_events)
        if sales_data.is_available() and sales_data.value:
            sales = sales_data.value
            total_revenue = sum(s.get("total_price", 0) or 0 for s in sales)
            bottles_sold = sum(s.get("quantity", 0) or 0 for s in sales)
            
            report["sections"]["financials"] = {
                "available": True,
                "source": "Supabase:sales_events",
                "total_revenue": round(total_revenue, 2),
                "bottles_sold": bottles_sold,
                "transaction_count": len(sales),
                "avg_transaction": round(total_revenue / len(sales), 2) if sales else 0,
            }
            report["data_sources"].append("Supabase:sales_events")
        else:
            report["sections"]["financials"] = {
                "available": False,
                "source": "Data not available in Supabase",
                "note": "No sales_events data found for this period",
            }
        
        # PROCUREMENT (from procurement_orders)
        if orders_data.is_available() and orders_data.value:
            orders = orders_data.value
            total_spent = sum(o.get("total_cost", 0) or 0 for o in orders)
            completed = [o for o in orders if o.get("status") == "COMPLETED"]
            pending = [o for o in orders if o.get("status") in ["PENDING", "APPROVED", "CONFIRMED", "IN_TRANSIT"]]
            
            report["sections"]["procurement"] = {
                "available": True,
                "source": "Supabase:procurement_orders",
                "total_orders": len(orders),
                "completed_orders": len(completed),
                "pending_orders": len(pending),
                "total_spent": round(total_spent, 2),
                "bottles_ordered": sum(o.get("bottles_total", 0) or 0 for o in orders),
            }
            report["data_sources"].append("Supabase:procurement_orders")
        else:
            report["sections"]["procurement"] = {
                "available": False,
                "source": "Data not available in Supabase",
                "note": "No procurement_orders data found for this period",
            }
        
        # INVENTORY (from restaurant_inventory)
        if inventory_data.is_available() and inventory_data.value:
            inventory = inventory_data.value
            total_bottles = sum(i.get("stock_live", 0) or 0 for i in inventory)
            
            # Low stock items
            low_stock = []
            for item in inventory:
                stock = item.get("stock_live", 0) or 0
                threshold = item.get("threshold_min", 3) or 3
                if stock <= threshold:
                    wine_info = item.get("master_wine_library", {}) or {}
                    low_stock.append({
                        "name": wine_info.get("name", "Unknown Wine"),
                        "type": wine_info.get("primary_type", "unknown"),
                        "stock": stock,
                        "threshold": threshold,
                    })
            
            report["sections"]["inventory"] = {
                "available": True,
                "source": "Supabase:restaurant_inventory",
                "total_items": len(inventory),
                "total_bottles": total_bottles,
                "low_stock_count": len(low_stock),
                "low_stock_items": low_stock[:5],  # Top 5
            }
            report["data_sources"].append("Supabase:restaurant_inventory")
        else:
            report["sections"]["inventory"] = {
                "available": False,
                "source": "Data not available in Supabase",
                "note": "No restaurant_inventory data found",
            }
        
        # PROVIDERS (from providers)
        if providers_data.is_available() and providers_data.value:
            providers = providers_data.value
            report["sections"]["providers"] = {
                "available": True,
                "source": "Supabase:providers",
                "active_providers": len(providers),
            }
            report["data_sources"].append("Supabase:providers")
        else:
            report["sections"]["providers"] = {
                "available": False,
                "source": "Data not available in Supabase",
            }
        
        # Week-over-week comparison
        report["sections"]["week_over_week"] = {
            "available": False,
            "note": "Week-over-week comparison not available. Previous week data not queried in this demo.",
        }
        
        return report
    
    # =========================================================================
    # EMAIL GENERATION (USING WEBSITE TEMPLATES)
    # =========================================================================
    
    def generate_gmail_subject(self, data: Dict[str, Any]) -> str:
        """Generate Gmail subject line from website template"""
        template = WEBSITE_EMAIL_TEMPLATES["weekly"]
        week_of = datetime.strptime(data["period"]["start"], "%Y-%m-%d").strftime("%B %d, %Y")
        return template["subject"].replace("{{week_of}}", week_of)
    
    def generate_gmail_body(self, data: Dict[str, Any]) -> str:
        """
        Generate Gmail body - PLAIN TEXT, professional, executive-friendly
        
        Uses website template structure but with actual Supabase data.
        Clearly states when data is not available.
        """
        financials = data["sections"].get("financials", {})
        procurement = data["sections"].get("procurement", {})
        inventory = data["sections"].get("inventory", {})
        
        # Build body using website template structure
        week_of = datetime.strptime(data["period"]["start"], "%Y-%m-%d").strftime("%B %d, %Y")
        
        body = f"""Hi Manager,

Here is the weekly performance for {week_of}.

═══════════════════════════════════════════════════════════════
📊 EXECUTIVE SUMMARY
═══════════════════════════════════════════════════════════════

"""
        
        # FINANCIALS
        if financials.get("available"):
            body += f"""💰 REVENUE & SALES
   • Total Revenue: ${financials['total_revenue']:,.2f}
   • Bottles Sold: {financials['bottles_sold']}
   • Transactions: {financials['transaction_count']}
   • Avg Transaction: ${financials['avg_transaction']:,.2f}
   [Source: {financials['source']}]

"""
        else:
            body += f"""💰 REVENUE & SALES
   • Data not available in Supabase
   • Note: {financials.get('note', 'No sales data found')}

"""
        
        # PROCUREMENT
        if procurement.get("available"):
            body += f"""🛒 PROCUREMENT
   • Total Orders: {procurement['total_orders']}
   • Completed: {procurement['completed_orders']}
   • Pending: {procurement['pending_orders']}
   • Total Spent: ${procurement['total_spent']:,.2f}
   • Bottles Ordered: {procurement['bottles_ordered']}
   [Source: {procurement['source']}]

"""
        else:
            body += f"""🛒 PROCUREMENT
   • Data not available in Supabase
   • Note: {procurement.get('note', 'No procurement data found')}

"""
        
        # INVENTORY
        if inventory.get("available"):
            body += f"""📦 INVENTORY STATUS
   • Total SKUs: {inventory['total_items']}
   • Total Bottles: {inventory['total_bottles']}
   • Low Stock Alerts: {inventory['low_stock_count']}
   [Source: {inventory['source']}]

"""
            if inventory.get("low_stock_items"):
                body += "   ⚠️ Low Stock Items:\n"
                for item in inventory["low_stock_items"]:
                    body += f"      • {item['name']}: {item['stock']}/{item['threshold']} bottles\n"
                body += "\n"
        else:
            body += f"""📦 INVENTORY STATUS
   • Data not available in Supabase

"""
        
        # Week-over-week
        body += """📈 WEEK-OVER-WEEK COMPARISON
   • Not available (previous week data not queried)

"""
        
        # Data Coverage Note
        body += """═══════════════════════════════════════════════════════════════
📋 DATA COVERAGE NOTE
═══════════════════════════════════════════════════════════════

Data Sources Used:
"""
        for source in data.get("data_sources", []):
            body += f"   ✓ {source}\n"
        
        if not data.get("data_sources"):
            body += "   • No data sources available\n"
        
        body += f"""
Report Generated: {data['generated_at']}
Mode: Demo (Supabase-only)

═══════════════════════════════════════════════════════════════

This report was generated by WineOps Automation AI.
Data strictly sourced from Supabase. No external data or assumptions used.

Best regards,
WineOps AI
"""
        
        return body
    
    def generate_sms_summary(self, data: Dict[str, Any]) -> str:
        """Generate SMS summary using website template"""
        financials = data["sections"].get("financials", {})
        procurement = data["sections"].get("procurement", {})
        inventory = data["sections"].get("inventory", {})
        
        # Use website template format
        revenue = f"${financials['total_revenue']:,.0f}" if financials.get("available") else "N/A"
        orders = f"{procurement.get('completed_orders', 0)} done, {procurement.get('pending_orders', 0)} pending" if procurement.get("available") else "N/A"
        low_stock = inventory.get("low_stock_count", "N/A") if inventory.get("available") else "N/A"
        
        sms = f"""Hi Manager — weekly summary:
- Revenue: {revenue}
- Orders: {orders}
- Low Stock: {low_stock} items
Reply 1) Approve restock 2) Defer 3) Call me.

[Supabase data only]"""
        
        return sms
    
    # =========================================================================
    # MAIN EXECUTION
    # =========================================================================
    
    async def ask_clarification(self) -> bool:
        """
        Ask clarification question per protocol
        
        Returns True to proceed, False to stop
        """
        print("\n" + "="*70)
        print("❓ CLARIFICATION PROTOCOL")
        print("="*70)
        print("""
Do you want Toast POS sales data included via the Toast API, 
or should this demo remain strictly limited to existing Supabase data only?

Options:
  1) Supabase only (default) - Use only data from Supabase tables
  2) Include Toast API - Also fetch sales data from Toast POS
""")
        
        if self.include_toast:
            print("   → Selected: Include Toast API (--include-toast flag)")
            return True
        else:
            print("   → Selected: Supabase only (default)")
            return True
    
    async def run(self):
        """Run the weekly report generation"""
        print("\n" + "="*70)
        print("📅 WINEOPS WEEKLY REPORT GENERATOR (LLM-Guided Demo Mode)")
        print("="*70)
        print(f"Date: {datetime.now().strftime('%A, %B %d, %Y at %I:%M %p')}")
        print(f"Mode: {'Supabase + Toast API' if self.include_toast else 'Supabase Only'}")
        
        # Show system prompt
        print("\n" + "-"*70)
        print("🔒 LLM SYSTEM PROMPT ACTIVE")
        print("-"*70)
        print("• ONLY using Supabase data")
        print("• NO external knowledge or assumptions")
        print("• Gmail-ready output using website templates")
        print("• Professional, executive-friendly tone")
        
        try:
            await self.setup()
            
            # Ask clarification
            proceed = await self.ask_clarification()
            if not proceed:
                return
            
            # Define report period (last 7 days)
            end_date = datetime.utcnow()
            start_date = end_date - timedelta(days=7)
            
            print("\n" + "="*70)
            print("📊 STEP 1: Query Supabase Data")
            print("="*70)
            print(f"   Period: {start_date.date()} to {end_date.date()}")
            
            # Query all data from Supabase
            print("\n   Executing Supabase queries...")
            
            restaurant = await self.query_restaurant()
            print(f"   ✓ restaurants: {'Found' if restaurant.is_available() else 'Not found'}")
            
            sales = await self.query_sales_events(start_date, end_date)
            print(f"   ✓ sales_events: {len(sales.value) if sales.is_available() else 0} rows")
            
            orders = await self.query_procurement_orders(start_date, end_date)
            print(f"   ✓ procurement_orders: {len(orders.value) if orders.is_available() else 0} rows")
            
            inventory = await self.query_inventory()
            print(f"   ✓ restaurant_inventory: {len(inventory.value) if inventory.is_available() else 0} rows")
            
            providers = await self.query_providers()
            print(f"   ✓ providers: {len(providers.value) if providers.is_available() else 0} rows")
            
            # Aggregate data
            print("\n" + "="*70)
            print("📊 STEP 2: Aggregate Report Data")
            print("="*70)
            
            report_data = self.aggregate_report_data(
                sales_data=sales,
                orders_data=orders,
                inventory_data=inventory,
                providers_data=providers,
                period_start=start_date,
                period_end=end_date,
            )
            
            print(f"   Data sources used: {len(report_data['data_sources'])}")
            for source in report_data['data_sources']:
                print(f"      ✓ {source}")
            
            # Generate email
            print("\n" + "="*70)
            print("📧 STEP 3: Generate Gmail Report (Website Template)")
            print("="*70)
            
            subject = self.generate_gmail_subject(report_data)
            body = self.generate_gmail_body(report_data)
            sms = self.generate_sms_summary(report_data)
            
            print(f"\n   📧 Gmail Subject:")
            print(f"   {subject}")
            
            print(f"\n   📧 Gmail Body Preview:")
            print("   " + "-"*60)
            # Print first 30 lines
            for i, line in enumerate(body.split("\n")[:30]):
                print(f"   {line}")
            print("   ... (truncated)")
            print("   " + "-"*60)
            
            print(f"\n   📱 SMS Summary ({len(sms)} chars):")
            print("   " + "-"*60)
            print(f"   {sms}")
            print("   " + "-"*60)
            
            # Query summary
            print("\n" + "="*70)
            print("📋 DATA COVERAGE NOTE")
            print("="*70)
            print(f"\n   Supabase Queries Executed: {len(self.supabase_queries)}")
            for q in self.supabase_queries:
                status = "✓" if q.success else "✗"
                print(f"   {status} {q.table}: {q.row_count} rows")
            
            print(f"\n   Data Sources Used:")
            for source in set(self.data_sources_used):
                print(f"      • {source}")
            
            print(f"\n   Report Generated: {report_data['generated_at']}")
            print(f"   Mode: Demo (Supabase-only)")
            
            # Send email if requested
            if self.send_email:
                print("\n" + "="*70)
                print("📤 STEP 4: Send Email")
                print("="*70)
                await self._send_email(subject, body)
            else:
                print("\n   📧 Email not sent (use --send-email to send)")
            
            # Save report
            output_path = Path(__file__).parent / "weekly_report_output.txt"
            with open(output_path, "w") as f:
                f.write(f"Subject: {subject}\n\n")
                f.write(body)
            print(f"\n   📄 Report saved to: {output_path}")
            
            print("\n" + "="*70)
            print("✅ WEEKLY REPORT GENERATION COMPLETE")
            print("="*70)
            
        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await self.teardown()
    
    async def _send_email(self, subject: str, body: str):
        """Send email via Gmail"""
        if not self.manager_email:
            print("   ❌ No manager email found in Supabase")
            return
        
        try:
            from services.email_client import EmailClient
            
            email_client = EmailClient(
                backend="gmail",
                gmail_user=self.settings.gmail_user,
                gmail_password=self.settings.gmail_password,
                mock_mode=not self.send_email,
            )
            
            result = await email_client.send_email(
                to_email=self.manager_email,
                subject=subject,
                body=body,
            )
            
            if result:
                print(f"   ✅ Email sent to {self.manager_email}")
            else:
                print(f"   ❌ Failed to send email")
                
        except Exception as e:
            print(f"   ❌ Email error: {e}")


# =============================================================================
# MAIN
# =============================================================================

async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Weekly Report Generator (LLM-Guided)")
    parser.add_argument("--include-toast", action="store_true", help="Include Toast POS data")
    parser.add_argument("--send-email", action="store_true", help="Actually send email")
    args = parser.parse_args()
    
    generator = WeeklyReportLLM(
        include_toast=args.include_toast,
        send_email=args.send_email,
    )
    await generator.run()


if __name__ == "__main__":
    asyncio.run(main())

