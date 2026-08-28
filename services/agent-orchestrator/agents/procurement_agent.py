"""
Procurement Agent — Lean Decision Engine
==========================================
Order decision logic and status management.

Architecture (Gateway Pattern):
- This agent decides WHAT to buy, HOW MUCH, and at WHAT PRICE TARGET
- ProviderConversationAgent handles ALL provider communication
- This agent publishes intents and receives parsed responses

Responsibilities:
- Stock threshold breach → create procurement order + publish negotiation intent
- Manual order requests → create order + publish intent
- Receive parsed intent responses from ProviderConversationAgent
- Order status state machine (NEGOTIATING → CONFIRMED → IN_TRANSIT → DELIVERED)
- Price history and target calculation
- Voice call initiation (Plivo API), but message content via ProviderConversationAgent

Voice is a binding surface and is gated (FUTURES §8.1): `_initiate_voice_negotiation`
requires a recorded human approval for the exact terms, and the whole capability is
off unless VOICE_ORDER_CALLS_ENABLED=true. Enforcement lives in PlivoVoiceClient, not
here. See services/plivo_voice_client.py.
"""

from typing import Dict, List, Any, Optional, TYPE_CHECKING
from datetime import datetime

from core.base_agent import BaseAgent

if TYPE_CHECKING:  # import-time cost only for type checkers, not for the orchestrator
    from services.plivo_voice_client import VoiceOrderApproval


class ProcurementAgent(BaseAgent):
    """
    Procurement Agent - AI-powered wine ordering

    Negotiation Strategy:
    1. Check historical prices for this wine/provider
    2. Generate negotiation message with target price
    3. Parse provider response
    4. If rejected, negotiate up to 3 times
    5. If still outside range, escalate to manager
    6. If accepted, create order and notify manager for approval

    LLM Usage:
    - Gemini Pro for conversation generation
    - Max 100 tokens per message
    - Context: provider history, wine details, price range
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # LLM configuration
        # Kept because the orchestrator still passes llm_model and callers may
        # read it, but nothing in this agent uses it any more — the client it fed
        # was removed in initialize() (OD-57). Default is None rather than a
        # retired id so it cannot quietly become a live model name again.
        self.llm_model = config.get("llm_model")
        self.llm_temperature = config.get("llm_temperature", 0.7)
        self.google_api_key = config.get("google_api_key")
        self.mock_mode = config.get("mock_mode", True)

        # Negotiation settings
        self.max_negotiation_attempts = 3
        self.price_tolerance_percent = 15  # ±15% from target

        # LLM client (will initialize in initialize())
        self.llm_client = None

        # Voice client for Plivo voice calls
        self.voice_client = None
        self.plivo_auth_id = config.get("plivo_auth_id")
        self.plivo_auth_token = config.get("plivo_auth_token")
        self.plivo_phone_number = config.get("plivo_phone_number")
        self.plivo_webhook_base_url = config.get(
            "plivo_webhook_base_url", "https://your-domain.com/webhooks/plivo"
        )

    async def initialize(self) -> None:
        self.logger.info("Initializing Procurement Agent")

        if self.mock_mode:
            self.logger.warning("⚠️ Running in MOCK mode (no real LLM calls)")
        # The Gemini client built here was REMOVED rather than repointed (OD-57).
        # It was constructed on every non-mock boot and never called — llm_client
        # had three references in this file: None, this assignment, None again in
        # cleanup. It was also handed llm_model, which the orchestrator fills from
        # llm_primary_model — a CLAUDE id going into the Gemini SDK. Repointing it
        # would make procurement look like it does LLM work it does not do.

        # Initialize Plivo Voice client
        if self.plivo_auth_id and self.plivo_auth_token:
            try:
                from services.plivo_voice_client import PlivoVoiceClient

                self.voice_client = PlivoVoiceClient(
                    auth_id=self.plivo_auth_id,
                    auth_token=self.plivo_auth_token,
                    from_number=self.plivo_phone_number,
                    webhook_base_url=self.plivo_webhook_base_url,
                    mock_mode=self.mock_mode,
                )
                self.logger.info("✓ Plivo Voice client initialized")
            except Exception as e:
                self.logger.error(f"Failed to initialize Voice client: {e}")
                self.voice_client = None
        else:
            self.logger.warning(
                "⚠️ Plivo credentials not configured, voice calling disabled"
            )

        self.logger.info("✓ Procurement Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("stock.events", "stock.threshold.breached"),
            ("procurement.events", "procurement.manual_order_request"),
            ("procurement.events", "procurement.intent_response"),
            ("procurement.events", "procurement.vendor_response"),
            # Voice call events
            ("voice.events", "voice.call_completed"),
            ("voice.events", "voice.transcription_ready"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "stock.threshold.breached":
            await self._initiate_procurement(message)
        elif routing_key == "procurement.manual_order_request":
            await self._handle_manual_order(message)
        elif routing_key == "procurement.intent_response":
            await self._handle_intent_response(message)
        elif routing_key == "procurement.vendor_response":
            await self._handle_vendor_email_response(message)
        elif routing_key == "voice.call_completed":
            await self._process_voice_call_completed(message)
        elif routing_key == "voice.transcription_ready":
            await self._process_voice_transcription(message)
        else:
            self.logger.warning(f"Unhandled routing key: {routing_key}")

    async def _initiate_procurement(self, message: Dict[str, Any]) -> None:
        """
        Initiate procurement for low-stock item.

        Gateway Pattern: creates order and publishes a conversation intent
        to ProviderConversationAgent instead of generating messages directly.
        """
        payload = message.get("payload", {})

        inventory_id = payload.get("inventory_id")
        wine_name = payload.get("wine_name")
        payload.get("stock_after", 0)
        urgency = payload.get("urgency", "medium")

        is_manual = payload.get("_manual", False)
        manual_provider_id = payload.get("_provider_id")
        manual_quantity = payload.get("_quantity")
        manual_target_price = payload.get("_target_price")
        manual_notes = payload.get("_notes", "")

        try:
            inventory = await self.database.get_inventory_item(inventory_id)

            if not inventory:
                self.logger.error(f"Inventory not found: {inventory_id}")
                return

            # The column is `provider_id`. `primary_provider_id` does not exist on
            # restaurant_inventory in any environment, so this lookup returned None
            # for EVERY wine and procurement could never be initiated at all — the
            # failure surfaced as `get_provider(None)` crashing on a cache key.
            # It stayed invisible because local databases were hand-built and never
            # had the real column set either. `primary_provider_id` is kept as a
            # fallback in case some row somewhere carries it.
            primary_provider_id = (
                manual_provider_id
                or inventory.get("provider_id")
                or inventory.get("primary_provider_id")
            )
            if not primary_provider_id:
                self.logger.error(
                    "No provider on inventory %s (%s) — cannot reorder",
                    inventory_id,
                    wine_name,
                )
                return

            provider = await self.database.get_provider(primary_provider_id)

            if not provider:
                self.logger.error(f"Provider not found: {primary_provider_id}")
                return

            threshold_min = inventory.get("threshold_min", 3)
            reorder_quantity = manual_quantity or inventory.get(
                "reorder_quantity", threshold_min * 3
            )

            price_history = await self._get_price_history(
                inventory_id, primary_provider_id
            )
            avg_price = self._calculate_avg_price(price_history)
            target_price = manual_target_price or (avg_price * 0.95)

            # Create draft procurement order
            order_id = await self.database.create_procurement_order(
                {
                    "restaurant_id": inventory.get("restaurant_id"),
                    "inventory_id": inventory_id,
                    "provider_id": primary_provider_id,
                    "wine_name": wine_name,
                    "quantity": reorder_quantity,
                    "target_price_per_bottle": target_price,
                    "status": "NEGOTIATING",
                    "urgency": urgency,
                    "negotiation_attempt": 1,
                    "max_acceptable_price": target_price
                    * (1 + self.price_tolerance_percent / 100),
                    **({"notes": manual_notes, "is_manual": True} if is_manual else {}),
                }
            )

            if order_id:
                # Publish conversation intent to ProviderConversationAgent
                await self.publish(
                    exchange_name="procurement.events",
                    routing_key="procurement.conversation_request",
                    message_body={
                        "event_type": "ProcurementConversationRequest",
                        "payload": {
                            "intent_type": "negotiate_price",
                            "order_id": order_id,
                            "provider_id": primary_provider_id,
                            "restaurant_id": inventory.get("restaurant_id"),
                            "wine_name": wine_name,
                            "quantity": reorder_quantity,
                            "target_price": target_price,
                            "max_acceptable_price": target_price
                            * (1 + self.price_tolerance_percent / 100),
                            "urgency": urgency,
                            "channel_preference": "email",
                        },
                    },
                    priority=7 if urgency == "high" else 5,
                )

                # Also publish order created for other consumers
                await self.publish(
                    exchange_name="procurement.events",
                    routing_key="procurement.order.created",
                    message_body={
                        "event_type": "ProcurementOrderCreated",
                        "payload": {
                            "order_id": order_id,
                            "inventory_id": inventory_id,
                            "wine_name": wine_name,
                            "provider_name": provider.get("name"),
                            "quantity": reorder_quantity,
                            "target_price": target_price,
                        },
                    },
                    priority=7 if urgency == "high" else 5,
                )

                self.logger.info(
                    f"Created procurement order {order_id}: "
                    f"{wine_name} x{reorder_quantity} from {provider.get('name')} "
                    f"(intent published to ProviderConversationAgent)"
                )

        except Exception as e:
            self.logger.error(f"Error initiating procurement: {e}", exc_info=True)

    async def _handle_intent_response(self, message: Dict[str, Any]) -> None:
        """
        Handle parsed response from ProviderConversationAgent.

        The intelligence extraction and message parsing has already been done
        by ProviderConversationAgent. This method only manages the order state machine.
        """
        payload = message.get("payload", {})
        order_id = payload.get("order_id")
        response_type = payload.get("response_type", "unknown")
        parsed_price = payload.get("parsed_price")
        restaurant_id = payload.get("restaurant_id")

        if not order_id:
            self.logger.warning("Intent response missing order_id")
            return

        self.logger.info(
            f"Intent response for order {order_id}: type={response_type}, "
            f"price={parsed_price}"
        )

        try:
            order_result = (
                self.database.supabase.table("procurement_orders")
                .select("*")
                .eq("id", order_id)
                .single()
                .execute()
            )
            order = order_result.data if order_result.data else None

            if not order:
                self.logger.error(f"Order {order_id} not found")
                return

            if response_type in ("price_acceptance", "acceptance", "confirmed"):
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "CONFIRMED",
                        "negotiated_price_per_bottle": parsed_price,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                await self.publish(
                    exchange_name="procurement.events",
                    routing_key="procurement.order.confirmed",
                    message_body={
                        "event_type": "ProcurementOrderConfirmed",
                        "payload": {
                            "order_id": order_id,
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "wine_name": order.get("wine_name", ""),
                            "negotiated_price": parsed_price,
                            "status": "CONFIRMED",
                        },
                    },
                )

                # Notify manager that the order was confirmed by the vendor
                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.order_confirmed",
                    message_body={
                        "event_type": "OrderConfirmedByVendor",
                        "payload": {
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "order_id": order_id,
                            "type": "order_confirmed",
                            "title": f"Order confirmed: {order.get('wine_name', 'Wine')}",
                            "message": (
                                f"Vendor confirmed the order for {order.get('wine_name', 'Wine')}. "
                                f"Status is now ORDERED."
                                + (
                                    f" Negotiated price: ${parsed_price}/bottle."
                                    if parsed_price
                                    else ""
                                )
                            ),
                            "urgency": "normal",
                        },
                    },
                )

                self.logger.info(f"Order {order_id} confirmed at ${parsed_price}")

            elif response_type == "counter_offer":
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "COUNTER_OFFERED",
                        "negotiated_price_per_bottle": parsed_price,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.procurement_counter_offer",
                    message_body={
                        "event_type": "ProcurementCounterOffer",
                        "payload": {
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "order_id": order_id,
                            "title": "Counter offer received",
                            "message": (
                                f"Provider counter-offered ${parsed_price}/bottle "
                                f"for {order.get('wine_name', 'Unknown')} "
                                f"(target was ${order.get('target_price_per_bottle', 0)})"
                            ),
                            "urgency": "high",
                        },
                    },
                )
                self.logger.info(f"Order {order_id} counter-offered at ${parsed_price}")

            elif response_type in ("rejection", "declined"):
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "REJECTED",
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.procurement_rejected",
                    message_body={
                        "event_type": "ProcurementRejected",
                        "payload": {
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "order_id": order_id,
                            "title": "Order rejected by vendor",
                            "message": f"Vendor rejected order for {order.get('wine_name', 'Unknown')}",
                            "urgency": "high",
                        },
                    },
                )
                self.logger.info(f"Order {order_id} rejected by vendor")

            elif response_type == "unavailable":
                # Full OOS cascade — provider reported the wine is out of stock.
                effective_restaurant_id = restaurant_id or order.get("restaurant_id")
                wine_name = order.get("wine_name", "Unknown wine")
                inventory_id = order.get("inventory_id")
                quantity = order.get("quantity", 0)
                current_provider_id = order.get("provider_id")

                # 1. Mark order CANCELLED (out-of-stock = effectively cancelled)
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "CANCELLED",
                        "rejection_reason": "Out of stock — provider email confirmation",
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                # 2. Cancel the calendar delivery event for this order
                await self._cancel_order_calendar_event(
                    effective_restaurant_id, order_id
                )

                # 3. Release shadow stock that was reserved for this order
                if inventory_id and quantity:
                    await self._release_shadow_stock(
                        effective_restaurant_id, inventory_id, int(quantity)
                    )

                # 4. Find alternative providers for the manager notification
                alternatives = await self._find_alternative_providers(
                    effective_restaurant_id, current_provider_id, wine_name
                )
                alt_text = ""
                if alternatives:
                    alt_names = ", ".join(alternatives[:3])
                    alt_text = f" Consider these alternatives: {alt_names}."

                # 5. Notify manager with full context
                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.procurement_oos",
                    message_body={
                        "event_type": "ProcurementOutOfStock",
                        "payload": {
                            "restaurant_id": effective_restaurant_id,
                            "order_id": order_id,
                            "type": "order_out_of_stock",
                            "title": f"Out of stock: {wine_name}",
                            "message": (
                                f"Provider reports {wine_name} is out of stock. "
                                f"Order cancelled and delivery removed from calendar."
                                f"{alt_text}"
                            ),
                            "urgency": "high",
                            "action_url": f"/orders?highlight={order_id}",
                            "metadata": {
                                "wine_name": wine_name,
                                "order_id": order_id,
                                "alternatives": alternatives,
                            },
                        },
                    },
                )
                self.logger.info(
                    f"Order {order_id} OOS: cancelled, calendar removed, "
                    f"shadow stock released, manager notified"
                )
            else:
                self.logger.info(
                    f"Unknown response type '{response_type}' for order {order_id}"
                )

        except Exception as e:
            self.logger.error(f"Error handling intent response: {e}")

    # =========================================================================
    # OOS HELPERS
    # =========================================================================

    async def _cancel_order_calendar_event(
        self, restaurant_id: str, order_id: str
    ) -> None:
        """Cancel the calendar delivery event that was linked to order_id."""
        try:
            result = (
                self.database.supabase.table("calendar_events")
                .select("id, tags")
                .eq("restaurant_id", restaurant_id)
                .eq("event_type", "delivery")
                .not_("status", "in", '("COMPLETED","CANCELLED")')
                .execute()
            )
            for event in result.data or []:
                try:
                    tags = event.get("tags", {})
                    if isinstance(tags, str):
                        import json as _json

                        tags = _json.loads(tags)
                    if isinstance(tags, dict) and tags.get("order_id") == order_id:
                        self.database.supabase.table("calendar_events").update(
                            {
                                "status": "CANCELLED",
                                "description": f"Order {order_id} cancelled (OOS).",
                            }
                        ).eq("id", event["id"]).execute()
                        self.logger.info(
                            f"Calendar event {event['id']} cancelled for OOS order {order_id}"
                        )
                        break
                except Exception:
                    pass
        except Exception as e:
            self.logger.warning(f"_cancel_order_calendar_event failed: {e}")

    async def _release_shadow_stock(
        self, restaurant_id: str, inventory_id: str, quantity: int
    ) -> None:
        """Subtract order quantity from shadow_stock, floored at 0."""
        try:
            result = (
                self.database.supabase.table("restaurant_inventory")
                .select("shadow_stock")
                .eq("restaurant_id", restaurant_id)
                .eq("id", inventory_id)
                .single()
                .execute()
            )
            if result.data:
                current = result.data.get("shadow_stock") or 0
                released = max(0, current - quantity)
                self.database.supabase.table("restaurant_inventory").update(
                    {"shadow_stock": released}
                ).eq("restaurant_id", restaurant_id).eq("id", inventory_id).execute()
                self.logger.info(
                    f"Released {quantity} shadow stock for inventory {inventory_id} "
                    f"({current} → {released})"
                )
        except Exception as e:
            self.logger.warning(f"_release_shadow_stock failed: {e}")

    async def _find_alternative_providers(
        self, restaurant_id: str, exclude_provider_id: str | None, wine_name: str
    ) -> list:
        """Return names of active providers for this restaurant, excluding the current one."""
        try:
            q = (
                self.database.supabase.table("providers")
                .select("name")
                .eq("restaurant_id", restaurant_id)
                .eq("is_active", True)
                .limit(5)
            )
            if exclude_provider_id:
                q = q.neq("id", exclude_provider_id)
            result = q.execute()
            return [p["name"] for p in (result.data or [])]
        except Exception as e:
            self.logger.warning(f"_find_alternative_providers failed: {e}")
            return []

    async def _handle_vendor_email_response(self, message: Dict[str, Any]) -> None:
        """Handle a vendor email response routed by EmailParsingAgent.

        Maps the email-level fields (subject, body, source) to the intent_response
        format the state machine already handles, using keyword-based intent detection.
        """
        payload = message.get("payload", message)
        order_id = payload.get("order_id")
        body = payload.get("body", "")
        subject = payload.get("subject", "")

        if not order_id:
            self.logger.warning("Vendor email response missing order_id — ignoring")
            return

        text = f"{subject} {body}".lower()

        # Map email text to response_type
        response_type = "unknown"
        parsed_price = None
        if any(
            w in text
            for w in [
                "confirm",
                "approved",
                "agreed",
                "accept",
                "deal",
                "order confirmed",
            ]
        ):
            response_type = "confirmed"
        elif any(w in text for w in ["cancel", "reject", "unable", "sorry", "cannot"]):
            response_type = "rejection"
        elif any(w in text for w in ["unavailable", "out of stock", "sold out"]):
            response_type = "unavailable"
        elif any(
            w in text for w in ["price", "cost", "quote", "offer", "$", "per bottle"]
        ):
            response_type = "price_update"

            # Try to extract a price
            import re

            price_match = re.search(r"\$\s*(\d+(?:\.\d{1,2})?)", text)
            if price_match:
                try:
                    parsed_price = float(price_match.group(1))
                except ValueError:
                    pass

        self.logger.info(
            f"Vendor email for order {order_id}: detected response_type={response_type}"
        )

        # Delegate to the existing intent_response handler
        await self._handle_intent_response(
            {
                "payload": {
                    "order_id": order_id,
                    "response_type": response_type,
                    "parsed_price": parsed_price,
                    "provider_id": payload.get("provider_id"),
                    "restaurant_id": payload.get("restaurant_id"),
                }
            }
        )

    async def _get_price_history(
        self, inventory_id: str, provider_id: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent price history for this wine/provider"""
        try:
            response = (
                self.database.supabase.table("procurement_orders")
                .select("price_per_bottle, created_at")
                .eq("inventory_id", inventory_id)
                .eq("provider_id", provider_id)
                .eq("status", "DELIVERED")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )

            return response.data if response.data else []
        except Exception as e:
            self.logger.error(f"Failed to get price history: {e}")
            return []

    def _calculate_avg_price(self, price_history: List[Dict[str, Any]]) -> float:
        """Calculate average price from history"""
        if not price_history:
            return 25.0  # Default fallback price

        prices = [
            p.get("price_per_bottle", 0)
            for p in price_history
            if p.get("price_per_bottle")
        ]

        if not prices:
            return 25.0

        return sum(prices) / len(prices)

    async def _handle_manual_order(self, message: Dict[str, Any]) -> None:
        """Handle manual order request from manager -- same flow as auto but with explicit params"""
        payload = message.get("payload", {})

        wine_name = payload.get("wine_name", "Unknown")
        wine_id = payload.get("wine_id") or payload.get("inventory_id")
        provider_id = payload.get("provider_id")
        quantity = payload.get("quantity", 6)
        target_price = payload.get("target_price")
        notes = payload.get("notes", "")

        self.logger.info(f"Manual order request: {wine_name} x{quantity}")

        if not wine_id or not provider_id:
            self.logger.error("Manual order missing wine_id or provider_id")
            return

        # Re-use the auto-procurement flow with manual overrides
        synthetic_message = {
            "routing_key": "stock.threshold.breached",
            "payload": {
                "inventory_id": wine_id,
                "restaurant_id": payload.get("restaurant_id"),
                "wine_name": wine_name,
                "stock_after": payload.get("current_stock", 0),
                "threshold": payload.get("threshold", 3),
                "urgency": payload.get("urgency", "medium"),
                "estimated_stockout_days": 5,
                "sales_velocity_7d": 0,
                "in_transit_quantity": 0,
                "master_wine_id": payload.get("master_wine_id", wine_id),
                # Manual overrides
                "_manual": True,
                "_provider_id": provider_id,
                "_quantity": quantity,
                "_target_price": target_price,
                "_notes": notes,
            },
        }

        await self._initiate_procurement(synthetic_message)

    # NOTE: _generate_negotiation_message, _parse_provider_response, _fallback_parser,
    # _send_sms_to_provider, _send_email_to_provider, _pause_for_approval,
    # _resume_conversation, _handle_conversation_rejection, and _handle_vendor_response
    # have been migrated to ProviderConversationAgent (Gateway Pattern).
    # ProcurementAgent now publishes intents and receives pre-parsed responses.

    # =========================================================================
    # VOICE NEGOTIATION METHODS
    # =========================================================================

    async def _initiate_voice_negotiation(
        self,
        order_id: str,
        provider_id: str,
        wine_name: str,
        quantity: int,
        target_price: float,
        *,
        order_approval: "VoiceOrderApproval",
    ) -> Optional[str]:
        """
        Initiate voice call negotiation with provider.

        BINDING SURFACE (FUTURES §8.1). This speaks a quantity and a price to a
        vendor and gathers an acceptance, so ``order_approval`` — a recorded
        human confirmation of these exact terms — is REQUIRED, not optional.
        The gate itself lives one layer down in ``PlivoVoiceClient`` so that a
        future caller cannot reach the phone line by going round this method;
        this signature exists so the requirement is visible at the call site too.

        The capability is additionally off unless ``VOICE_ORDER_CALLS_ENABLED``
        is set — this path has no in-repo caller today, and the flag is what
        stops it acquiring one silently.

        Args:
            order_id: Procurement order ID
            provider_id: Provider ID
            wine_name: Wine name
            quantity: Order quantity
            target_price: Target price per bottle
            order_approval: Human approval evidence for this order and terms

        Returns:
            Call UUID if successful

        Raises:
            VoiceBindingGateError: gate not satisfied. Deliberately propagates —
                the broad ``except`` below must never turn a refusal to place an
                unapproved vendor call into a quiet ``None``.
        """
        if not self.voice_client:
            self.logger.warning("Voice client not available")
            return None

        # Imported here (not at module scope) so the orchestrator's import graph
        # is unchanged; by this point the voice client module is already loaded.
        from services.plivo_voice_client import VoiceBindingGateError

        try:
            # Get provider details
            provider = await self.database.get_provider(provider_id)
            if not provider or not provider.get("contact_phone"):
                self.logger.error(f"Provider {provider_id} has no phone number")
                return None

            provider_name = provider.get("name", "Vendor")
            provider_phone = provider.get("contact_phone")

            # Generate negotiation XML. This is the gated call: it refuses unless
            # the flag is on, `order_approval` covers this order at these exact
            # terms, and the greeting passes the hard constraints.
            #
            # The XML is still not wired to an answer URL — `make_call` below
            # falls back to the default `/voice/answer` webhook — so today this
            # both builds the script and enforces the gate on it. Serving this
            # XML from the answer webhook is the follow-up slice; until then the
            # call must not be placed on a script the gate never saw.
            self.voice_client.generate_negotiation_xml(
                wine_name=wine_name,
                quantity=quantity,
                target_price=target_price,
                provider_name=provider_name,
                order_id=order_id,
                order_approval=order_approval,
            )

            # Make the call — gated again at the client on the order-shaped
            # context, so the dial cannot happen even if the XML step is skipped.
            result = await self.voice_client.make_call(
                to_number=provider_phone,
                record=True,
                context={
                    "order_id": order_id,
                    "provider_id": provider_id,
                    "wine_name": wine_name,
                    "quantity": quantity,
                    "target_price": target_price,
                    "negotiation_type": "voice",
                },
                order_approval=order_approval,
            )

            if result.get("success"):
                call_uuid = result.get("call_uuid")

                # Store voice interaction
                await self.database.order_interactions.create_voice_interaction(
                    order_id=order_id,
                    call_uuid=call_uuid,
                    direction="OUTBOUND",
                    ai_summary=f"Voice negotiation initiated for {wine_name} x{quantity}",
                )

                # Update order with voice negotiation status
                await self.database.procurement.update(
                    order_id,
                    {
                        "negotiation_attempt": 1,
                        "last_negotiation_at": datetime.now().isoformat(),
                        "state_machine_state": "AI_NEGOTIATING",
                    },
                )

                self.logger.info(
                    f"📞 Voice negotiation initiated: {wine_name} x{quantity} "
                    f"to {provider_name} (Call: {call_uuid})"
                )

                return call_uuid
            else:
                self.logger.error(f"Voice call failed: {result.get('error')}")
                return None

        except VoiceBindingGateError:
            # Never swallowed. A gate refusal means the system was one step away
            # from an unapproved commitment to a vendor; collapsing that into
            # `None` would make the most important failure here look like a
            # transient one (FUTURES §8.1).
            self.logger.error(
                f"Voice binding gate refused order {order_id} — no call placed",
                exc_info=True,
            )
            raise
        except Exception as e:
            self.logger.error(f"Error initiating voice negotiation: {e}", exc_info=True)
            return None

    async def _process_voice_call_completed(self, message: Dict[str, Any]) -> None:
        """
        Process completed voice call
        """
        payload = message.get("payload", {})

        call_uuid = payload.get("call_uuid")
        order_id = payload.get("order_id")
        duration_seconds = payload.get("duration_seconds", 0)
        recording_url = payload.get("recording_url")

        self.logger.info(f"Voice call completed: {call_uuid} ({duration_seconds}s)")

        try:
            # Update interaction with recording
            interactions = await self.database.order_interactions.get_voice_calls(
                order_id
            )
            for interaction in interactions:
                if interaction.call_uuid == call_uuid:
                    await self.database.order_interactions.update(
                        interaction.id,
                        {
                            "recording_url": recording_url,
                            "call_duration_seconds": duration_seconds,
                        },
                    )
                    break

        except Exception as e:
            self.logger.error(f"Error processing voice call completion: {e}")

    async def _process_voice_transcription(self, message: Dict[str, Any]) -> None:
        """
        Process voice call transcription by routing to ProviderConversationAgent
        for intelligence extraction (Gateway Pattern).
        """
        payload = message.get("payload", {})

        call_uuid = payload.get("call_uuid")
        order_id = payload.get("order_id")
        transcript = payload.get("transcript")
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")

        self.logger.info(f"Transcription received for call {call_uuid}")

        try:
            # Route to ProviderConversationAgent for extraction
            await self.publish(
                exchange_name="conversation.events",
                routing_key="conversation.inbound.voice_transcript",
                message_body={
                    "event_type": "InboundVoiceTranscript",
                    "payload": {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "order_id": order_id,
                        "call_uuid": call_uuid,
                        "content": transcript,
                        "channel": "voice",
                    },
                },
                priority=7,
            )

            # Update interaction record with raw transcript
            interactions = await self.database.order_interactions.get_voice_calls(
                order_id
            )
            for interaction in interactions:
                if interaction.call_uuid == call_uuid:
                    await self.database.order_interactions.update(
                        interaction.id,
                        {
                            "transcript": transcript,
                        },
                    )
                    break

        except Exception as e:
            self.logger.error(f"Error processing transcription: {e}", exc_info=True)

    async def _handle_voice_response(
        self,
        order_id: str,
        parsed_response: Dict[str, Any],
    ) -> None:
        """
        Handle parsed voice response from provider
        """
        # Get order details
        order = await self.database.procurement.get_by_id(order_id)
        if not order:
            return

        price = parsed_response.get("price")
        parsed_response.get("availability", "unknown")

        if not price:
            # No price extracted - request manager review
            await self._request_voice_review(order_id, parsed_response)
            return

        # Compare with target price
        target_price = order.target_price_per_bottle or 0
        price_diff_percent = (
            abs(price - target_price) / target_price * 100 if target_price else 100
        )

        if price <= target_price:
            # Price accepted - proceed to approval
            await self.database.procurement.update(
                order_id,
                {
                    "negotiated_price_per_bottle": price,
                    "status": "PENDING_APPROVAL",
                    "state_machine_state": "NEGOTIATION_REVIEW",
                },
            )

            # Notify manager
            await self._notify_voice_negotiation_success(order_id, order, price)

        elif price_diff_percent <= self.price_tolerance_percent:
            # Price within tolerance - auto-approve
            await self.database.procurement.update(
                order_id,
                {
                    "negotiated_price_per_bottle": price,
                    "status": "PENDING_APPROVAL",
                    "state_machine_state": "NEGOTIATION_REVIEW",
                },
            )

            await self._notify_voice_negotiation_success(order_id, order, price)

        else:
            # Price too high - request manager decision
            await self._request_voice_review(order_id, parsed_response, price)

    def _generate_transcript_summary(self, parsed: Dict[str, Any]) -> str:
        """
        Generate summary from parsed transcript
        """
        parts = []

        if parsed.get("price"):
            parts.append(f"Price offered: ${parsed['price']:.2f}/bottle")

        if parsed.get("availability"):
            parts.append(f"Availability: {parsed['availability']}")

        if parsed.get("delivery_days"):
            parts.append(f"Delivery: {parsed['delivery_days']} days")

        if parsed.get("conditions"):
            parts.append(f"Conditions: {parsed['conditions']}")

        return " | ".join(parts) if parts else "No specific details extracted"

    async def _notify_voice_negotiation_success(
        self,
        order_id: str,
        order,
        negotiated_price: float,
    ) -> None:
        """
        Notify manager of successful voice negotiation
        """
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.voice_negotiation_complete",
            message_body={
                "event_type": "VoiceNegotiationComplete",
                "payload": {
                    "type": "voice_negotiation_success",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": order.wine_name,
                    "quantity": order.quantity,
                    "negotiated_price": negotiated_price,
                    "target_price": order.target_price_per_bottle,
                    "message": (
                        f"📞 Voice negotiation successful!\n"
                        f"Wine: {order.wine_name}\n"
                        f"Quantity: {order.quantity}\n"
                        f"Price: ${negotiated_price:.2f}/bottle\n"
                        f"Total: ${negotiated_price * order.quantity:.2f}\n\n"
                        f"Approve this order?"
                    ),
                    "actions": [
                        {"id": "approve", "label": "Approve Order", "style": "primary"},
                        {
                            "id": "listen",
                            "label": "Listen to Recording",
                            "style": "secondary",
                        },
                        {"id": "reject", "label": "Reject", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=7,
        )

    async def _request_voice_review(
        self,
        order_id: str,
        parsed_response: Dict[str, Any],
        price: Optional[float] = None,
    ) -> None:
        """
        Request manager review of voice negotiation
        """
        order = await self.database.procurement.get_by_id(order_id)
        if not order:
            return

        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.voice_review_needed",
            message_body={
                "event_type": "VoiceReviewNeeded",
                "payload": {
                    "type": "voice_review_needed",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": order.wine_name,
                    "parsed_response": parsed_response,
                    "offered_price": price,
                    "target_price": order.target_price_per_bottle,
                    "message": (
                        f"📞 Voice negotiation needs review\n"
                        f"Wine: {order.wine_name}\n"
                        f"Offered: ${price:.2f}/bottle\n"
                        if price
                        else "Price unclear\n"
                        f"Target: ${order.target_price_per_bottle:.2f}/bottle\n"
                        f"Please review the call recording."
                    ),
                    "actions": [
                        {
                            "id": "listen",
                            "label": "Listen to Recording",
                            "style": "primary",
                        },
                        {"id": "accept", "label": "Accept Offer", "style": "secondary"},
                        {
                            "id": "counter",
                            "label": "Counter Offer",
                            "style": "secondary",
                        },
                        {"id": "reject", "label": "Reject", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=8,
        )

    async def cleanup(self) -> None:
        """Cleanup voice resources (LLM now owned by ProviderConversationAgent)"""
        self.llm_client = None
        self.voice_client = None
        self.logger.info("Procurement Agent cleaned up")
