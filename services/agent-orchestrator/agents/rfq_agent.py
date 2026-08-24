"""
RFQ Agent (Request for Quotation)
=================================
AI-powered polite bidding system with:
- Multi-vendor RFQ distribution
- Response parsing and comparison
- Best offer selection
- Manager notification
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import json

from core.base_agent import BaseAgent
from core.database import RFQRequest, Provider


class RFQAgent(BaseAgent):
    """
    RFQ Agent - Polite Bidding System

    Workflow:
    1. Trigger: Low stock detected
    2. Select 3 vendors from `competitor_group` for the wine category
    3. Send RFQ template via Email/SMS:
       "Hi [Name], I'm looking to buy [Qty] cases of [Wine Name] for this Friday.
       What is the best price you can do for us? Thanks."
    4. Parse vendor replies (via email/SMS webhooks)
    5. Extract price, availability, delivery timeline
    6. Compare offers
    7. Present winner to manager for approval

    Core Philosophy: "Polite Bidding"
    - Professional, friendly tone
    - No aggressive negotiation
    - Let vendors compete naturally
    - Present best offer transparently
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # Configuration
        self.mock_mode = config.get("mock_mode", True)
        self.default_vendor_count = config.get("default_vendor_count", 3)
        self.response_timeout_hours = config.get("response_timeout_hours", 24)

        # LLM for response parsing
        self.llm_model = config.get("llm_model", "gemini-2.5-flash")
        self.google_api_key = config.get("google_api_key")
        self.llm_client = None

        # RFQ templates
        self.rfq_templates = {
            "standard": (
                "Hi {vendor_name},\n\n"
                "I'm looking to buy {quantity} {unit} of {wine_name} "
                "for delivery by {delivery_date}.\n\n"
                "What is the best price you can do for us?\n\n"
                "Thanks!"
            ),
            "urgent": (
                "Hi {vendor_name},\n\n"
                "We need {quantity} {unit} of {wine_name} urgently - "
                "delivery needed by {delivery_date}.\n\n"
                "Please let us know your best price and availability ASAP.\n\n"
                "Thanks!"
            ),
            "bulk": (
                "Hi {vendor_name},\n\n"
                "We're looking to place a bulk order for {quantity} {unit} of {wine_name}.\n\n"
                "Given the volume, what is the best price you can offer? "
                "Delivery needed by {delivery_date}.\n\n"
                "Thanks!"
            ),
        }

    async def initialize(self) -> None:
        """Initialize RFQ Agent"""
        self.logger.info("Initializing RFQ Agent")

        if self.mock_mode:
            self.logger.warning("⚠️ Running in MOCK mode")
        else:
            # Initialize Gemini Pro client
            if self.google_api_key:
                try:
                    import google.generativeai as genai

                    genai.configure(api_key=self.google_api_key)
                    self.llm_client = genai.GenerativeModel(self.llm_model)
                    self.logger.info("✓ Gemini Pro client initialized")
                except Exception as e:
                    self.logger.error(f"Failed to initialize LLM client: {e}")

        self.logger.info("✓ RFQ Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("stock.events", "stock.threshold.breached"),
            ("rfq.events", "rfq.initiate_request"),
            ("rfq.events", "rfq.vendor_response_received"),
            ("rfq.events", "rfq.timeout_check"),
            ("rfq.events", "rfq.manager_selection"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "stock.threshold.breached":
            await self._handle_low_stock(message)
        elif routing_key == "rfq.initiate_request":
            await self._initiate_rfq(message)
        elif routing_key == "rfq.vendor_response_received":
            await self._process_vendor_response(message)
        elif routing_key == "rfq.timeout_check":
            await self._check_rfq_timeouts(message)
        elif routing_key == "rfq.manager_selection":
            await self._handle_manager_selection(message)

    async def _handle_low_stock(self, message: Dict[str, Any]) -> None:
        """
        Handle low stock event - initiate RFQ process
        """
        payload = message.get("payload", {})

        inventory_id = payload.get("inventory_id")
        wine_name = payload.get("wine_name")
        restaurant_id = payload.get("restaurant_id")
        urgency = payload.get("urgency", "normal")

        self.logger.info(f"Low stock detected for {wine_name}, initiating RFQ")

        # Check if RFQ already exists for this item
        existing_rfqs = await self.database.rfq_requests.get_by_inventory(inventory_id)
        pending_rfqs = [
            r for r in existing_rfqs if r.status in ["pending", "responses_received"]
        ]

        if pending_rfqs:
            self.logger.info(f"RFQ already pending for {wine_name}, skipping")
            return

        # Initiate new RFQ
        await self._initiate_rfq(
            {
                "payload": {
                    "inventory_id": inventory_id,
                    "wine_name": wine_name,
                    "restaurant_id": restaurant_id,
                    "urgency": urgency,
                }
            }
        )

    async def _initiate_rfq(self, message: Dict[str, Any]) -> None:
        """
        Initiate RFQ process for a wine

        Steps:
        1. Get inventory details
        2. Select competitor vendors
        3. Create RFQ record
        4. Send RFQ to vendors
        """
        payload = message.get("payload", {})

        inventory_id = payload.get("inventory_id")
        wine_name = payload.get("wine_name")
        restaurant_id = payload.get("restaurant_id")
        urgency = payload.get("urgency", "normal")
        quantity = payload.get("quantity")

        self.logger.info(f"Initiating RFQ for {wine_name}")

        try:
            # Get inventory details
            inventory = await self.database.inventory.get_by_id(inventory_id)
            if not inventory:
                self.logger.error(f"Inventory not found: {inventory_id}")
                return

            # Calculate quantity if not provided
            if not quantity:
                threshold = inventory.threshold_min
                quantity = max(threshold * 3, 12)  # Default to 3x threshold or 12

            # Calculate delivery date (default: 5 days from now)
            delivery_date = (datetime.utcnow() + timedelta(days=5)).strftime("%Y-%m-%d")
            if urgency == "urgent":
                delivery_date = (datetime.utcnow() + timedelta(days=2)).strftime(
                    "%Y-%m-%d"
                )

            # Select competitor vendors
            vendors = await self._select_competitor_vendors(
                wine_name=wine_name,
                count=self.default_vendor_count,
            )

            if not vendors:
                self.logger.warning(f"No vendors found for {wine_name}")
                return

            # Create RFQ record
            rfq = RFQRequest(
                inventory_id=inventory_id,
                restaurant_id=restaurant_id,
                wine_name=wine_name,
                quantity=quantity,
                requested_delivery_date=datetime.strptime(delivery_date, "%Y-%m-%d"),
                status="pending",
            )

            created_rfq = await self.database.rfq_requests.create(rfq)
            if not created_rfq:
                self.logger.error("Failed to create RFQ record")
                return

            # Send RFQ to vendors
            for vendor in vendors:
                await self._send_rfq_to_vendor(
                    rfq_id=created_rfq.id,
                    vendor=vendor,
                    wine_name=wine_name,
                    quantity=quantity,
                    delivery_date=delivery_date,
                    urgency=urgency,
                )

            self.logger.info(
                f"✓ RFQ initiated: {wine_name} x{quantity} to {len(vendors)} vendors"
            )

            # Publish RFQ initiated event
            await self.publish(
                exchange_name="rfq.events",
                routing_key="rfq.initiated",
                message_body={
                    "event_type": "RFQInitiated",
                    "payload": {
                        "rfq_id": created_rfq.id,
                        "wine_name": wine_name,
                        "quantity": quantity,
                        "vendors_contacted": len(vendors),
                        "delivery_date": delivery_date,
                    },
                },
                priority=5,
            )

        except Exception as e:
            self.logger.error(f"Error initiating RFQ: {e}", exc_info=True)

    async def _select_competitor_vendors(
        self,
        wine_name: str,
        count: int = 3,
    ) -> List[Provider]:
        """
        Select competitor vendors for RFQ

        Selection criteria:
        1. Match competitor_group if available
        2. Active vendors only
        3. Prefer vendors with good ratings
        """
        try:
            # Get all active providers
            providers = await self.database.providers.get_active_providers()

            if not providers:
                return []

            # Filter by competitor group if possible
            # (In real implementation, would match wine category to competitor_group)

            # Sort by rating (if available)
            sorted_providers = sorted(
                providers,
                key=lambda p: p.rating or 0,
                reverse=True,
            )

            # Return top N vendors
            return sorted_providers[:count]

        except Exception as e:
            self.logger.error(f"Error selecting vendors: {e}")
            return []

    async def _send_rfq_to_vendor(
        self,
        rfq_id: str,
        vendor: Provider,
        wine_name: str,
        quantity: int,
        delivery_date: str,
        urgency: str = "normal",
    ) -> bool:
        """
        Send RFQ message to a vendor
        """
        # Select template based on urgency and quantity
        if urgency == "urgent":
            template_key = "urgent"
        elif quantity >= 24:
            template_key = "bulk"
        else:
            template_key = "standard"

        template = self.rfq_templates[template_key]

        # Format message
        message = template.format(
            vendor_name=vendor.name,
            quantity=quantity,
            unit="bottles",
            wine_name=wine_name,
            delivery_date=delivery_date,
        )

        self.logger.info(f"Sending RFQ to {vendor.name}:")
        self.logger.info(f"  Message: {message[:100]}...")

        if self.mock_mode:
            self.logger.info("  [MOCK] Would send via SMS/Email")
            return True

        # Send via preferred channel
        if vendor.contact_phone:
            # Send SMS
            await self.publish(
                exchange_name="notification.events",
                routing_key="notification.send_sms",
                message_body={
                    "event_type": "SendSMS",
                    "payload": {
                        "to": vendor.contact_phone,
                        "message": message,
                        "context": {
                            "rfq_id": rfq_id,
                            "vendor_id": vendor.id,
                            "type": "rfq_request",
                        },
                    },
                },
                priority=6,
            )

        if vendor.contact_email:
            # Send Email
            await self.publish(
                exchange_name="notification.events",
                routing_key="notification.send_email",
                message_body={
                    "event_type": "SendEmail",
                    "payload": {
                        "to": vendor.contact_email,
                        "subject": f"Quote Request: {wine_name}",
                        "body": message,
                        "context": {
                            "rfq_id": rfq_id,
                            "vendor_id": vendor.id,
                            "type": "rfq_request",
                        },
                    },
                },
                priority=6,
            )

        return True

    async def _process_vendor_response(self, message: Dict[str, Any]) -> None:
        """
        Process vendor response to RFQ

        Parse response to extract:
        - Price
        - Availability
        - Delivery timeline
        """
        payload = message.get("payload", {})

        rfq_id = payload.get("rfq_id")
        vendor_id = payload.get("vendor_id")
        response_text = payload.get("response_text")
        payload.get("channel", "sms")

        self.logger.info(f"Processing vendor response for RFQ {rfq_id}")

        try:
            # Parse response
            parsed = await self._parse_vendor_response(response_text)

            # Add response to RFQ
            await self.database.rfq_requests.add_vendor_response(
                rfq_id=rfq_id,
                vendor_id=vendor_id,
                price=parsed.get("price", 0),
                availability=parsed.get("availability", "unknown"),
                delivery_date=parsed.get("delivery_date"),
            )

            # Get updated RFQ
            rfq = await self.database.rfq_requests.get_by_id(rfq_id)

            # Check if we have enough responses
            if rfq and rfq.vendor_responses and len(rfq.vendor_responses) >= 2:
                # Compare offers and present winner
                await self._compare_and_present_offers(rfq)

        except Exception as e:
            self.logger.error(f"Error processing vendor response: {e}", exc_info=True)

    async def _parse_vendor_response(self, response_text: str) -> Dict[str, Any]:
        """
        Parse vendor response using LLM
        """
        if self.mock_mode:
            return {
                "price": 25.00,
                "availability": "in_stock",
                "delivery_date": (datetime.utcnow() + timedelta(days=3)).strftime(
                    "%Y-%m-%d"
                ),
                "notes": "Mock parsed response",
            }

        if not self.llm_client:
            return self._fallback_parse_response(response_text)

        try:
            prompt = f"""Parse this vendor response to an RFQ (Request for Quotation).

Response: "{response_text}"

Extract JSON:
{{
  "price": <price per bottle as number, or null>,
  "availability": "in_stock" | "limited" | "backorder" | "unavailable",
  "delivery_date": "<YYYY-MM-DD format, or null>",
  "minimum_order": <minimum order quantity, or null>,
  "notes": "<any special conditions or notes>"
}}

Respond with valid JSON only."""

            response = self.llm_client.generate_content(
                prompt, generation_config={"temperature": 0.1}
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                _out = getattr(_usage, "candidates_token_count", 0) or 0
                get_spend_logger().log(
                    provider="google",
                    model=self.llm_model,
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost(self.llm_model, _in, _out),
                    agent=self.agent_name,
                    task_type="rfq_response_parse",
                    outcome="success",  # call-level: response returned
                    correlation_id=getattr(self, "_current_correlation_id", None),
                )
            except Exception:
                pass

            return json.loads(response.text)

        except Exception as e:
            self.logger.error(f"LLM parsing failed: {e}")
            return self._fallback_parse_response(response_text)

    def _fallback_parse_response(self, response_text: str) -> Dict[str, Any]:
        """
        Fallback regex-based response parsing
        """
        import re

        result = {
            "price": None,
            "availability": "unknown",
            "delivery_date": None,
            "notes": "",
        }

        # Extract price
        price_match = re.search(r"\$?\s*(\d+(?:\.\d{2})?)", response_text)
        if price_match:
            result["price"] = float(price_match.group(1))

        # Detect availability
        text_lower = response_text.lower()
        if any(word in text_lower for word in ["in stock", "available", "have"]):
            result["availability"] = "in_stock"
        elif any(word in text_lower for word in ["limited", "few", "last"]):
            result["availability"] = "limited"
        elif any(word in text_lower for word in ["backorder", "week", "wait"]):
            result["availability"] = "backorder"
        elif any(
            word in text_lower for word in ["unavailable", "out of stock", "sorry"]
        ):
            result["availability"] = "unavailable"

        return result

    async def _compare_and_present_offers(self, rfq: RFQRequest) -> None:
        """
        Compare vendor offers and present best to manager
        """
        responses = rfq.vendor_responses or []

        if not responses:
            self.logger.warning(f"No responses to compare for RFQ {rfq.id}")
            return

        # Filter valid responses (with price)
        valid_responses = [r for r in responses if r.get("price")]

        if not valid_responses:
            self.logger.warning(f"No valid price responses for RFQ {rfq.id}")
            return

        # Sort by price (lowest first)
        sorted_responses = sorted(
            valid_responses, key=lambda r: r.get("price", float("inf"))
        )

        # Select winner
        winner = sorted_responses[0]

        # Calculate savings
        if len(sorted_responses) > 1:
            savings = sorted_responses[-1]["price"] - winner["price"]
            savings_percent = (savings / sorted_responses[-1]["price"]) * 100
        else:
            savings = 0
            savings_percent = 0

        # Update RFQ with selection
        await self.database.rfq_requests.select_winner(
            rfq_id=rfq.id,
            vendor_id=winner["vendor_id"],
            price=winner["price"],
            reason=f"Lowest price: ${winner['price']:.2f}/bottle",
        )

        # Get vendor details
        vendor = await self.database.providers.get_by_id(winner["vendor_id"])
        vendor_name = vendor.name if vendor else "Unknown Vendor"

        # Notify manager
        await self._present_winner_to_manager(
            rfq=rfq,
            winner=winner,
            vendor_name=vendor_name,
            all_responses=sorted_responses,
            savings=savings,
            savings_percent=savings_percent,
        )

    async def _present_winner_to_manager(
        self,
        rfq: RFQRequest,
        winner: Dict[str, Any],
        vendor_name: str,
        all_responses: List[Dict[str, Any]],
        savings: float,
        savings_percent: float,
    ) -> None:
        """
        Present winning offer to manager for approval
        """
        self.logger.info(
            f"🏆 Presenting winner for RFQ {rfq.id}: "
            f"{vendor_name} at ${winner['price']:.2f}/bottle"
        )

        # Build comparison summary
        comparison_summary = []
        for i, resp in enumerate(all_responses):
            vendor = await self.database.providers.get_by_id(resp["vendor_id"])
            comparison_summary.append(
                {
                    "rank": i + 1,
                    "vendor_name": vendor.name if vendor else "Unknown",
                    "price": resp["price"],
                    "availability": resp.get("availability", "unknown"),
                    "is_winner": i == 0,
                }
            )

        # Publish notification
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.rfq_winner",
            message_body={
                "event_type": "RFQWinnerPresentation",
                "payload": {
                    "type": "rfq_winner",
                    "priority": "high",
                    "rfq_id": rfq.id,
                    "wine_name": rfq.wine_name,
                    "quantity": rfq.quantity,
                    "winner": {
                        "vendor_name": vendor_name,
                        "price": winner["price"],
                        "availability": winner.get("availability"),
                        "delivery_date": winner.get("delivery_date"),
                    },
                    "comparison": comparison_summary,
                    "savings": {
                        "amount": savings,
                        "percent": savings_percent,
                    },
                    "message": (
                        f"🍷 Best Quote for {rfq.wine_name} x{rfq.quantity}:\n\n"
                        f"Winner: {vendor_name}\n"
                        f"Price: ${winner['price']:.2f}/bottle\n"
                        f"Total: ${winner['price'] * rfq.quantity:.2f}\n"
                        f"Savings: ${savings:.2f} ({savings_percent:.1f}%)\n\n"
                        f"Approve this order?"
                    ),
                    "actions": [
                        {
                            "id": "approve",
                            "label": "Approve & Order",
                            "style": "primary",
                        },
                        {
                            "id": "view_all",
                            "label": "View All Quotes",
                            "style": "secondary",
                        },
                        {"id": "reject", "label": "Reject", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=7,
        )

    async def _check_rfq_timeouts(self, message: Dict[str, Any]) -> None:
        """
        Check for RFQ timeouts and handle accordingly
        """
        # Get all pending RFQs
        # In real implementation, would query by created_at < timeout threshold
        pass

    async def _handle_manager_selection(self, message: Dict[str, Any]) -> None:
        """
        Handle manager's selection from RFQ offers
        """
        payload = message.get("payload", {})

        rfq_id = payload.get("rfq_id")
        action = payload.get("action")
        vendor_id = payload.get("vendor_id")

        self.logger.info(f"Manager selection for RFQ {rfq_id}: {action}")

        if action == "approve":
            # Create procurement order
            await self._create_order_from_rfq(rfq_id, vendor_id)
        elif action == "reject":
            # Cancel RFQ
            await self.database.rfq_requests.update(rfq_id, {"status": "cancelled"})

    async def _create_order_from_rfq(
        self,
        rfq_id: str,
        vendor_id: Optional[str] = None,
    ) -> None:
        """
        Create procurement order from approved RFQ
        """
        rfq = await self.database.rfq_requests.get_by_id(rfq_id)
        if not rfq:
            return

        # Use selected vendor or winner
        final_vendor_id = vendor_id or rfq.selected_vendor_id
        final_price = rfq.selected_price

        # Publish order creation event
        await self.publish(
            exchange_name="procurement.events",
            routing_key="procurement.create_order",
            message_body={
                "event_type": "CreateProcurementOrder",
                "payload": {
                    "inventory_id": rfq.inventory_id,
                    "restaurant_id": rfq.restaurant_id,
                    "provider_id": final_vendor_id,
                    "wine_name": rfq.wine_name,
                    "quantity": rfq.quantity,
                    "price_per_bottle": final_price,
                    "source": "rfq",
                    "rfq_id": rfq_id,
                },
            },
            priority=7,
        )

        # Update RFQ status
        await self.database.rfq_requests.update(
            rfq_id,
            {
                "status": "approved",
                "approved_at": datetime.utcnow().isoformat(),
            },
        )

        self.logger.info(f"✓ Order created from RFQ {rfq_id}")

    # =========================================================================
    # PUBLIC API METHODS
    # =========================================================================

    async def initiate_rfq(
        self,
        inventory_id: str,
        wine_name: str,
        restaurant_id: str,
        quantity: int,
        urgency: str = "normal",
    ) -> Optional[str]:
        """
        Public API: Initiate RFQ for a wine

        Returns:
            RFQ ID if created successfully
        """
        await self._initiate_rfq(
            {
                "payload": {
                    "inventory_id": inventory_id,
                    "wine_name": wine_name,
                    "restaurant_id": restaurant_id,
                    "quantity": quantity,
                    "urgency": urgency,
                }
            }
        )

        # Get the created RFQ
        rfqs = await self.database.rfq_requests.get_by_inventory(inventory_id)
        if rfqs:
            return rfqs[0].id
        return None

    async def get_rfq_status(self, rfq_id: str) -> Optional[Dict[str, Any]]:
        """
        Public API: Get RFQ status and responses
        """
        rfq = await self.database.rfq_requests.get_by_id(rfq_id)
        if not rfq:
            return None

        return {
            "rfq_id": rfq.id,
            "wine_name": rfq.wine_name,
            "quantity": rfq.quantity,
            "status": rfq.status,
            "responses_count": len(rfq.vendor_responses or []),
            "selected_vendor_id": rfq.selected_vendor_id,
            "selected_price": rfq.selected_price,
            "created_at": rfq.created_at.isoformat() if rfq.created_at else None,
        }

    async def cleanup(self) -> None:
        """Cleanup resources"""
        self.llm_client = None
        self.logger.info("✓ RFQ Agent cleaned up")
