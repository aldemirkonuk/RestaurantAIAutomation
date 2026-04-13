"""
Mobile App Count Simulator
==========================
Simulates staff using mobile app to count inventory via QR codes.

Features:
- QR code scanning simulation
- Physical count recording with location
- Batch counting workflow
- Location tracking (zone/shelf/position)
- Discrepancy detection integration

Usage:
    simulator = MobileCountSimulator(db_client, inventory_count_service)
    
    # Simulate scanning a QR code
    wine_info = await simulator.scan_qr_code(qr_data="wine_uuid_here")
    
    # Record a count
    result = await simulator.record_count(
        wine_id="...",
        count=7,
        location="Cellar A > North Wall > Shelf 2"
    )
    
    # Run full count session
    results = await simulator.run_count_session(restaurant_id, items_to_count=10)
"""

import asyncio
import random
from datetime import datetime
from typing import Dict, List, Any, Optional
from uuid import uuid4
import logging

logger = logging.getLogger(__name__)


class MobileCountSimulator:
    """
    Simulates mobile app inventory counting
    
    Workflow:
    1. Staff opens app
    2. Scans QR code on wine bottle/shelf
    3. App shows wine info and current stock
    4. Staff enters actual count
    5. App records count with location
    6. System checks for discrepancies
    """
    
    # Mock storage locations
    STORAGE_LOCATIONS = [
        {"zone": "Main Bar", "section": "Back Bar", "shelf": "1", "position": "A"},
        {"zone": "Main Bar", "section": "Back Bar", "shelf": "1", "position": "B"},
        {"zone": "Main Bar", "section": "Display", "shelf": "2", "position": "A"},
        {"zone": "Cellar A", "section": "North Wall", "shelf": "1", "position": "A"},
        {"zone": "Cellar A", "section": "North Wall", "shelf": "2", "position": "A"},
        {"zone": "Cellar A", "section": "North Wall", "shelf": "2", "position": "B"},
        {"zone": "Cellar A", "section": "South Wall", "shelf": "1", "position": "A"},
        {"zone": "Reserve Room", "section": "Premium", "shelf": "1", "position": "A"},
        {"zone": "Reserve Room", "section": "Premium", "shelf": "1", "position": "B"},
        {"zone": "Storage", "section": "Overflow", "shelf": "1", "position": "A"},
    ]
    
    # Staff names for simulation
    STAFF_NAMES = [
        "Alex M.", "Jordan K.", "Sam T.", "Taylor R.", "Morgan P.",
        "Casey L.", "Riley J.", "Quinn S.", "Avery D.", "Blake H.",
    ]
    
    def __init__(self, database, inventory_count_service):
        self.database = database
        self.inventory_count_service = inventory_count_service
        
        # Session tracking
        self.current_session_id: Optional[str] = None
        self.session_counts: List[Dict[str, Any]] = []
        
        # Statistics
        self.qr_scans = 0
        self.counts_submitted = 0
    
    async def scan_qr_code(
        self,
        qr_data: str,
    ) -> Dict[str, Any]:
        """
        Simulate scanning a QR code on a wine bottle or shelf
        
        Args:
            qr_data: QR code content (typically inventory_id or wine_id)
            
        Returns:
            Wine information for display in app
        """
        self.qr_scans += 1
        logger.info(f"📱 QR Scan: {qr_data}")
        
        # Lookup wine in inventory
        try:
            inventory = self.database.supabase.table("restaurant_inventory") \
                .select("*, master_wine_library(name, producer, vintage, primary_type)") \
                .eq("id", qr_data) \
                .single() \
                .execute()
            
            if inventory.data:
                item = inventory.data
                wine_info = item.get("master_wine_library", {}) or {}
                
                return {
                    "success": True,
                    "inventory_id": item["id"],
                    "wine_name": wine_info.get("name", "Unknown Wine"),
                    "producer": wine_info.get("producer"),
                    "vintage": wine_info.get("vintage"),
                    "wine_type": wine_info.get("primary_type"),
                    "current_stock_live": item.get("stock_live", 0),
                    "last_physical_count": item.get("physical_stock"),
                    "threshold_min": item.get("threshold_min", 3),
                    "inventory_state": item.get("inventory_state"),
                    "scanned_at": datetime.utcnow().isoformat(),
                }
            else:
                return {
                    "success": False,
                    "error": "Wine not found in inventory",
                    "qr_data": qr_data,
                }
                
        except Exception as e:
            logger.error(f"QR scan error: {e}")
            return {
                "success": False,
                "error": str(e),
                "qr_data": qr_data,
            }
    
    async def record_count(
        self,
        inventory_id: str,
        count: int,
        location: Optional[str] = None,
        staff_id: Optional[str] = None,
        staff_name: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Record a physical count from the mobile app
        
        Args:
            inventory_id: Inventory item ID
            count: Physical count entered by staff
            location: Storage location string
            staff_id: Staff member ID
            staff_name: Staff member name
            notes: Optional notes
            
        Returns:
            Count result with discrepancy analysis
        """
        self.counts_submitted += 1
        
        # Generate location if not provided
        if not location:
            loc = random.choice(self.STORAGE_LOCATIONS)
            location = f"{loc['zone']} > {loc['section']} > Shelf {loc['shelf']} > Pos {loc['position']}"
        
        # Generate staff name if not provided
        if not staff_name:
            staff_name = random.choice(self.STAFF_NAMES)
        
        logger.info(f"📱 Count submitted: {inventory_id} = {count} bottles at {location}")
        
        # Use inventory count service to record
        result = await self.inventory_count_service.record_physical_count(
            inventory_id=inventory_id,
            physical_count=count,
            location=location,
            counted_by=staff_id or staff_name,
            notes=notes,
        )
        
        # Add to session if active
        if self.current_session_id:
            self.session_counts.append({
                "session_id": self.current_session_id,
                **result,
            })
        
        return result
    
    async def start_count_session(
        self,
        restaurant_id: str,
        staff_name: Optional[str] = None,
    ) -> str:
        """
        Start a new inventory count session
        
        Returns:
            Session ID
        """
        self.current_session_id = str(uuid4())
        self.session_counts = []
        
        logger.info(f"📱 Started count session: {self.current_session_id}")
        
        return self.current_session_id
    
    async def end_count_session(self) -> Dict[str, Any]:
        """
        End the current count session and get summary
        
        Returns:
            Session summary with all counts and discrepancies
        """
        if not self.current_session_id:
            return {"error": "No active session"}
        
        session_id = self.current_session_id
        counts = self.session_counts.copy()
        
        # Calculate summary
        total_counts = len(counts)
        discrepancies = [c for c in counts if c.get("discrepancy", 0) != 0]
        
        summary = {
            "session_id": session_id,
            "total_items_counted": total_counts,
            "items_with_discrepancy": len(discrepancies),
            "total_discrepancy_bottles": sum(abs(c.get("discrepancy", 0)) for c in discrepancies),
            "counts": counts,
            "ended_at": datetime.utcnow().isoformat(),
        }
        
        # Clear session
        self.current_session_id = None
        self.session_counts = []
        
        logger.info(f"📱 Ended count session: {session_id} - {total_counts} items counted")
        
        return summary
    
    async def run_count_session(
        self,
        restaurant_id: str,
        items_to_count: int = 10,
        simulate_discrepancies: bool = True,
        discrepancy_rate: float = 0.2,
    ) -> Dict[str, Any]:
        """
        Run a full simulated count session
        
        Args:
            restaurant_id: Restaurant ID
            items_to_count: Number of items to count
            simulate_discrepancies: Whether to simulate some discrepancies
            discrepancy_rate: Probability of discrepancy (0.0 to 1.0)
            
        Returns:
            Session summary
        """
        logger.info(f"📱 Starting simulated count session for {items_to_count} items")
        
        # Start session
        await self.start_count_session(restaurant_id)
        
        # Get inventory items to count
        inventory = self.database.supabase.table("restaurant_inventory") \
            .select("id, stock_live, master_wine_library(name)") \
            .eq("restaurant_id", restaurant_id) \
            .limit(items_to_count) \
            .execute()
        
        items = inventory.data or []
        
        if not items:
            logger.warning("No inventory items found to count")
            return await self.end_count_session()
        
        # Count each item
        for item in items:
            inventory_id = item["id"]
            stock_live = item.get("stock_live", 0)
            wine_name = item.get("master_wine_library", {}).get("name", "Unknown")
            
            # Simulate QR scan
            await self.scan_qr_code(inventory_id)
            await asyncio.sleep(0.5)  # Simulate scan time
            
            # Determine count (with possible discrepancy)
            if simulate_discrepancies and random.random() < discrepancy_rate:
                # Simulate discrepancy (usually short, sometimes over)
                if random.random() < 0.8:
                    # Short by 1-3 bottles
                    physical_count = max(0, stock_live - random.randint(1, 3))
                else:
                    # Over by 1-2 bottles
                    physical_count = stock_live + random.randint(1, 2)
            else:
                # Exact count
                physical_count = stock_live
            
            # Record count
            await self.record_count(
                inventory_id=inventory_id,
                count=physical_count,
                notes=f"Simulated count for {wine_name}",
            )
            
            await asyncio.sleep(0.3)  # Simulate entry time
        
        # End session
        return await self.end_count_session()
    
    async def simulate_specific_discrepancy(
        self,
        inventory_id: str,
        sales_today: int,
        actual_missing: int,
    ) -> Dict[str, Any]:
        """
        Simulate a specific discrepancy scenario
        
        Example: "sold 2 bottles but we're down 3"
        
        Args:
            inventory_id: Inventory item ID
            sales_today: Number of bottles sold today
            actual_missing: Additional bottles missing beyond sales
            
        Returns:
            Count result showing discrepancy
        """
        # Get current stock
        inventory = self.database.supabase.table("restaurant_inventory") \
            .select("*, master_wine_library(name)") \
            .eq("id", inventory_id) \
            .single() \
            .execute()
        
        if not inventory.data:
            return {"error": "Inventory not found"}
        
        item = inventory.data
        stock_live = item.get("stock_live", 0)
        wine_name = item.get("master_wine_library", {}).get("name", "Unknown Wine")
        
        # Calculate what physical count should show
        # If stock_live = 10, sales_today = 2, actual_missing = 1
        # Expected = 10 (stock_live already accounts for sales)
        # Physical = 10 - actual_missing = 9
        # But to show "sold 2, down 3", we need:
        # Physical = stock_live - actual_missing = 10 - 1 = 9
        # Discrepancy message: "sold 2, but down 3" means physical shows 3 less than start
        
        physical_count = stock_live - actual_missing
        
        logger.info(
            f"📱 Simulating discrepancy for {wine_name}: "
            f"stock_live={stock_live}, sales={sales_today}, missing={actual_missing}, "
            f"physical={physical_count}"
        )
        
        # Record the count
        result = await self.record_count(
            inventory_id=inventory_id,
            count=physical_count,
            notes=f"Simulated: sold {sales_today}, actually down {sales_today + actual_missing}",
        )
        
        # Add extra context for demo
        result["demo_context"] = {
            "sales_today": sales_today,
            "additional_missing": actual_missing,
            "explanation": (
                f"[{wine_name}] has sold {sales_today} bottles but we're down "
                f"{sales_today + actual_missing}. {actual_missing} bottle(s) unaccounted for."
            ),
        }
        
        return result
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get simulator statistics"""
        return {
            "qr_scans": self.qr_scans,
            "counts_submitted": self.counts_submitted,
            "active_session": self.current_session_id is not None,
            "session_count": len(self.session_counts) if self.current_session_id else 0,
        }

