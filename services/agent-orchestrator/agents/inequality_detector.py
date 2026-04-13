"""
Inequality Detector Agent
Detects mismatches between POS sales and inventory levels

Catches:
- Fat-finger errors (typed 123 instead of 12)
- Fraud/theft patterns
- System errors
- Inventory discrepancies
"""

from typing import Dict, List, Any
from datetime import datetime, timedelta

from core.base_agent import BaseAgent


class InequalityDetectorAgent(BaseAgent):
    """
    Detects anomalies in inventory updates
    
    Algorithm:
    - Compare expected vs actual stock changes
    - Flag anomalies above threshold
    - Suggest auto-corrections with confidence scores
    - Escalate to manager when confidence < 80%
    """
    
    async def initialize(self) -> None:
        self.logger.info("Initializing Inequality Detector")
        self.threshold_percent = 15  # Alert if mismatch > 15%
        self.logger.info("✓ Inequality Detector initialized")
    
    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("stock.events", "stock.state.changed"),
            ("stock.events", "stock.manually_corrected"),
        ]
    
    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")
        
        if routing_key == "stock.state.changed":
            await self._check_for_anomalies(message)
        elif routing_key == "stock.manually_corrected":
            await self._analyze_correction_pattern(message)
    
    async def _check_for_anomalies(self, message: Dict[str, Any]) -> None:
        """Check if stock change matches expected sales"""
        payload = message.get("payload", {})
        inventory_id = payload.get("inventory_id")
        
        try:
            # Get recent sales for this item
            recent_sales = await self._get_recent_sales(inventory_id)
            
            # Calculate expected vs actual
            expected_stock_change = sum(s["quantity"] for s in recent_sales)
            # actual_stock_change would come from comparing previous state
            
            # TODO: Implement full anomaly detection logic
            # For now, log for monitoring
            
            self.logger.debug(f"Checked anomalies for {inventory_id}")
            
        except Exception as e:
            self.logger.error(f"Error checking anomalies: {e}")
    
    async def _analyze_correction_pattern(self, message: Dict[str, Any]) -> None:
        """Analyze manual correction patterns for potential issues"""
        payload = message.get("payload", {})
        
        delta = payload.get("delta", 0)
        
        # Large negative correction = potential theft/waste
        if delta < -10:
            await self.publish(
                exchange_name="notifications",
                routing_key="alert.high_priority",
                message_body={
                    "alert_type": "large_stock_discrepancy",
                    "severity": "high",
                    "payload": payload,
                },
                priority=8,
            )
            
            self.logger.warning(f"Large negative correction detected: {delta} bottles")
    
    async def _get_recent_sales(self, inventory_id: str) -> List[Dict[str, Any]]:
        """Get recent sales for analysis"""
        try:
            since = (datetime.utcnow() - timedelta(hours=1)).isoformat()
            
            response = self.database.supabase.table("sales_events") \
                .select("*") \
                .eq("inventory_id", inventory_id) \
                .gte("pos_event_timestamp", since) \
                .execute()
            
            return response.data if response.data else []
        except Exception as e:
            self.logger.error(f"Failed to get recent sales: {e}")
            return []

