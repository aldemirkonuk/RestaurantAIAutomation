"""
POS Integration Agent - Real-Time Toast POS Webhook Handler

Receives webhook events from Toast POS and normalizes them into internal events
for the WineOps AI system.

Handles:
- Order completed events (wine sales)
- Item voided events
- Refunds
- Menu modifications

Publishes to RabbitMQ exchanges for consumption by other agents.
"""

import asyncio
import hashlib
import hmac
import json
import re
from datetime import datetime
from typing import Dict, Any, List, Optional
from uuid import uuid4

from core.base_agent import BaseAgent
from core.message_bus import MessageBus
from core.database import DatabaseClient
from config.settings import get_settings

logger = None  # Will be set by BaseAgent
settings = get_settings()


# ---------------------------------------------------------------------------
# Wine identification
# ---------------------------------------------------------------------------
# Mirrors apps/api-gateway/src/pos-hub/pos-hub.service.ts token for token, in the
# same order. That file carries the reasoning: why the category is consulted
# before the name, why an UNRECOGNISED category falls through to the name scan
# instead of vetoing it, and why certain good grapes ('pecorino', 'bianco') are
# deliberately absent because they are more often food.
#
# The two ingresses used to disagree about how wine is identified: the NestJS hub
# scanned names only, this agent scanned category-then-keywords off a shorter
# list. They now run the same rule off the same tokens, and
# scripts/test_simulate.py fails if the copies drift apart.
WINE_CATEGORY_WORDS = (
    "wine",
    "wines",
    "vino",
    "vini",
    "vin",
    "vins",
    "vinho",
    "vinhos",
    "weine",
    "şarap",
    "sarap",
    "şaraplar",
    "saraplar",
)

WINE_STYLE_CATEGORY_WORDS = (
    "champagne",
    "sparkling",
    "bubbles",
    "bubbly",
    "prosecco",
    "cava",
    "rosé",
    "rose",
    "rosato",
    "by the glass",
    "by the bottle",
    "btg",
    "cellar",
    "sommelier",
    "somm",
)

NON_WINE_CATEGORY_WORDS = (
    "beer",
    "beers",
    "draft",
    "draught",
    "cider",
    "seltzer",
    "kombucha",
    "cocktail",
    "cocktails",
    "mocktail",
    "spirit",
    "spirits",
    "liquor",
    "whiskey",
    "whisky",
    "bourbon",
    "vodka",
    "gin",
    "tequila",
    "mezcal",
    "rum",
    "sake",
    "water",
    "soda",
    "juice",
    "coffee",
    "espresso",
    "tea",
    "food",
    "kitchen",
    "appetizer",
    "appetizers",
    "starter",
    "starters",
    "snack",
    "snacks",
    "salad",
    "salads",
    "soup",
    "soups",
    "pasta",
    "pizza",
    "entree",
    "entrée",
    "entrees",
    "main",
    "mains",
    "side",
    "sides",
    "dessert",
    "desserts",
    "bread",
    "charcuterie",
    "cheese",
    "sushi",
    "raw bar",
    "breakfast",
    "brunch",
    "lunch",
    "kids",
    "retail",
    "merch",
)

WINE_WORDS = (
    "wine",
    "vino",
    "vinho",
    "vin santo",
    "şarap",
    "sarap",
    "rosé",
    "rose",
    "rosato",
    "rosado",
    "red blend",
    "white blend",
    "meritage",
    "cuvee",
    "cuvée",
    "house red",
    "house white",
    "cru",
    "reserva",
    "riserva",
    "port",
    "sherry",
    "madeira",
    "winery",
    "vineyard",
    "weingut",
    "domaine",
    "chateau",
    "château",
    "tenuta",
    "quinta",
    "vignoble",
    "champagne",
    "prosecco",
    "cava",
    "brut",
    "blanc de",
    "cremant",
    "crémant",
    "franciacorta",
    "lambrusco",
    "sekt",
    "chardonnay",
    "sauvignon",
    "riesling",
    "pinot",
    "merlot",
    "cabernet",
    "syrah",
    "sirah",
    "shiraz",
    "malbec",
    "tempranillo",
    "nebbiolo",
    "sangiovese",
    "grenache",
    "garnacha",
    "zinfandel",
    "viognier",
    "chenin",
    "gamay",
    "semillon",
    "sémillon",
    "mourvedre",
    "mourvèdre",
    "monastrell",
    "cinsault",
    "carignan",
    "marsanne",
    "roussanne",
    "petit verdot",
    "gewurztraminer",
    "gewürztraminer",
    "moscato",
    "muscat",
    "carmenere",
    "carménère",
    "pinotage",
    "tannat",
    "torrontes",
    "torrontés",
    "chianti",
    "barolo",
    "barbaresco",
    "montalcino",
    "brunello",
    "montepulciano",
    "vernaccia",
    "valpolicella",
    "ripasso",
    "amarone",
    "soave",
    "gavi",
    "roero",
    "etna",
    "taurasi",
    "orvieto",
    "frascati",
    "bolgheri",
    "morellino",
    "cannonau",
    "cerasuolo",
    "super tuscan",
    "barbera",
    "dolcetto",
    "arneis",
    "vermentino",
    "verdicchio",
    "falanghina",
    "fiano",
    "greco",
    "grechetto",
    "grillo",
    "ribolla",
    "vitovska",
    "rossese",
    "malvasia",
    "trebbiano",
    "garganega",
    "cortese",
    "corvina",
    "nerello",
    "mascalese",
    "aglianico",
    "avola",
    "timorasso",
    "bellone",
    "friulano",
    "teroldego",
    "lagrein",
    "sagrantino",
    "negroamaro",
    "primitivo",
    "bordeaux",
    "burgundy",
    "bourgogne",
    "chablis",
    "sancerre",
    "vouvray",
    "chinon",
    "muscadet",
    "pouilly",
    "gigondas",
    "cotes du",
    "côtes du",
    "chateauneuf",
    "châteauneuf",
    "beaujolais",
    "macon",
    "mâcon",
    "sauternes",
    "medoc",
    "médoc",
    "pauillac",
    "margaux",
    "montrachet",
    "echezeaux",
    "échezeaux",
    "corton",
    "romanee",
    "romanée",
    "bonnezeaux",
    "rioja",
    "priorat",
    "ribera",
    "rueda",
    "bierzo",
    "mencia",
    "mencía",
    "albarino",
    "albariño",
    "alvarinho",
    "verdejo",
    "godello",
    "txakoli",
    "txakolina",
    "tinto",
    "tinta",
    "tintillo",
    "douro",
    "dao",
    "dão",
    "alentejo",
    "touriga",
    "gruner",
    "grüner",
    "veltliner",
    "blaufrankisch",
    "blaufränkisch",
    "zweigelt",
    "spatlese",
    "spätlese",
    "kabinett",
    "trocken",
    "assyrtiko",
    "xinomavro",
    "agiorgitiko",
    "agioritiko",
    "malagousia",
    "moschofilero",
    "moscofilero",
    "monemvasia",
    "monemvasios",
    "kidonitsa",
    "savatiano",
    "retsina",
    "santorini",
    "nemea",
    "okuzgozu",
    "öküzgözü",
    "bogazkere",
    "boğazkere",
    "kalecik",
    "narince",
    "calkarasi",
    "çalkarası",
)


def _bounded_matcher(words) -> "re.Pattern[str]":
    """One alternation per list, compiled once.

    Word boundaries rather than bare substrings: that is what lets short tokens
    live on the list safely — 'cava' no longer fires on Cavatelli, and 'rose' no
    longer fires on Rosemary. Python's `\\w` is unicode-aware, which the
    TypeScript side spells out as `[\\p{L}\\p{N}_]` so the two agree.
    """
    return re.compile(
        r"(?<!\w)(?:" + "|".join(re.escape(w) for w in words) + r")(?!\w)",
        re.IGNORECASE,
    )


_WINE_CATEGORY_RE = _bounded_matcher(WINE_CATEGORY_WORDS)
_WINE_STYLE_CATEGORY_RE = _bounded_matcher(WINE_STYLE_CATEGORY_WORDS)
_NON_WINE_CATEGORY_RE = _bounded_matcher(NON_WINE_CATEGORY_WORDS)
_WINE_WORD_RE = _bounded_matcher(WINE_WORDS)


def selection_category(selection: Optional[Dict[str, Any]]) -> str:
    """The category a Toast selection carries, from whichever key holds it.

    Toast payloads in this repo populate `menuGroup.name` (see the fixtures in
    tests/test_pos_integration_hardening.py and scripts/simulate/payloads.py);
    some carry `menuGroup.category` as well. Reading only `category` — as this
    agent did — meant the category signal was silently dead against the payloads
    the handler actually receives, and every item fell through to the keyword scan.
    """
    menu_group = (selection or {}).get("menuGroup") or {}
    return str(menu_group.get("category") or menu_group.get("name") or "").strip()


def classify_wine_category(
    category: str, wine_categories: Optional[List[str]] = None
) -> str:
    """'wine' | 'not_wine' | 'unknown' — signal 1."""
    value = (category or "").strip()
    if not value:
        return "unknown"
    # An exactly configured category name stays authoritative.
    if wine_categories and value in wine_categories:
        return "wine"
    if _WINE_CATEGORY_RE.search(value):
        return "wine"
    if _NON_WINE_CATEGORY_RE.search(value):
        return "not_wine"
    if _WINE_STYLE_CATEGORY_RE.search(value):
        return "wine"
    return "unknown"


def looks_like_wine_name(name: str, words: Optional[List[str]] = None) -> bool:
    """Signal 2 — the name backstop."""
    matcher = _WINE_WORD_RE if words is None else _bounded_matcher(words)
    return bool(matcher.search(name or ""))


class POSIntegrationAgent(BaseAgent):
    """
    POS Integration Agent - Handles Toast POS webhooks and converts them to internal events

    Responsibilities:
    - Receive and validate Toast webhooks
    - Extract wine sales from orders
    - Normalize data into standard format
    - Publish events to message bus
    - Handle errors and retries
    """

    def __init__(
        self,
        agent_name: str,
        message_bus: MessageBus,
        database: DatabaseClient,
        config: Dict[str, Any],
    ):
        super().__init__(agent_name, message_bus, database, config)

        # Toast configuration (from config dict)
        self.toast_api_url = config.get("toast_api_url", "https://ws-api.toasttab.com")
        self.toast_client_id = config.get("toast_client_id")
        self.toast_client_secret = config.get("toast_client_secret")
        self.toast_restaurant_guid = config.get("toast_restaurant_guid")
        self.toast_webhook_secret = config.get("toast_webhook_secret")
        self.toast_environment = config.get("toast_environment", "sandbox")
        self.mock_mode = config.get("mock_mode", True)

        # Wine name keywords. Now the shared list rather than a shorter local one
        # that resolved New World varietal labelling and missed roughly two thirds
        # of an Old World appellation-labelled list. Note that 'sparkling' is NOT
        # on it: as a NAME token it fires on Sparkling Water, and a food item
        # resolving as wine inflates depletion for wine that was never poured. It
        # is a category token instead, where it is safe.
        self.wine_category_keywords = list(WINE_WORDS)

        # Toast menu category names that indicate wine — category-first detection
        # (BUG-04). Exact names, kept for tenants configured against them; the
        # shared token lists handle the general case.
        self.wine_menu_categories = [
            "Wine",
            "Wines",
            "Wine List",
            "Bottle Wine",
            "Glass Wine",
            "Sparkling Wine",
            "Red Wine",
            "White Wine",
            "Rose Wine",
            "Dessert Wine",
            "By The Glass",
            "By The Bottle",
        ]

        self.logger.info(
            f"POS Integration Agent configured (environment: {self.toast_environment}, mock: {self.mock_mode})"
        )

    async def initialize(self) -> None:
        """Initialize the agent"""
        self.logger.info("Initializing POS Integration Agent...")

        # No specific initialization needed beyond BaseAgent
        # The agent is primarily webhook-driven

        self.logger.info(
            "POS Integration Agent initialized and ready to receive webhooks"
        )

    def get_subscribed_routing_keys(self) -> List[tuple]:
        """
        Define routing keys this agent subscribes to

        This agent primarily receives HTTP webhooks, but can also process
        manual POS sync requests via message bus
        """
        return [
            ("pos.commands", "pos.sync.manual"),
            ("pos.commands", "pos.test"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        """
        Process messages from message bus

        Handles:
        - Manual sync requests
        - Test messages
        """
        try:
            event_type = message.get("event_type")

            if event_type == "ManualSyncRequest":
                await self.handle_manual_sync_request(message)
            elif event_type == "TestMessage":
                self.logger.info(f"Received test message: {message}")
            else:
                self.logger.warning(f"Unknown message type: {event_type}")

        except Exception as e:
            self.logger.error(f"Error processing message: {e}", exc_info=True)
            raise

    # =========================================================================
    # WEBHOOK PROCESSING (Called from FastAPI endpoint)
    # =========================================================================

    def verify_webhook_signature(self, payload: str, signature: str) -> bool:
        """
        Verify Toast webhook signature to ensure authenticity

        Args:
            payload: Raw webhook payload as string
            signature: Signature from Toast-Signature header

        Returns:
            True if signature is valid, False otherwise
        """
        if not self.toast_webhook_secret:
            self.logger.warning(
                "No Toast webhook secret configured - skipping signature verification"
            )
            return True

        try:
            expected_signature = hmac.HMAC(
                self.toast_webhook_secret.encode("utf-8"),
                payload.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()

            return hmac.compare_digest(expected_signature, signature)
        except Exception as e:
            self.logger.error(f"Error verifying webhook signature: {e}")
            return False

    async def process_toast_webhook(
        self,
        webhook_data: Dict[str, Any],
        signature: Optional[str] = None,
        raw_payload: Optional[
            bytes
        ] = None,  # raw bytes from HTTP request body (BUG-05)
    ) -> Dict[str, Any]:
        """
        Main webhook processing entry point

        Args:
            webhook_data: Parsed JSON webhook data from Toast
            signature: Optional signature for verification
            raw_payload: Optional raw bytes of the original HTTP request body.
                         When provided, used verbatim for HMAC verification so
                         signature computed by Toast over the exact wire bytes is
                         reproduced correctly.  Falls back to re-serialized JSON
                         only when raw bytes are unavailable (e.g. unit tests).

        Returns:
            Processing result with status and details
        """
        try:
            # Verify signature if provided — must happen BEFORE idempotency check
            # so forged replays are rejected at the HMAC gate (T-20-02-01)
            if signature and not self.mock_mode:
                # BUG-05 fix: use raw_payload bytes when available; re-serialised
                # JSON changes byte order / spacing and causes valid signatures to fail.
                payload_for_sig = (
                    raw_payload.decode("utf-8")
                    if raw_payload is not None
                    else json.dumps(webhook_data, separators=(",", ":"), sort_keys=True)
                )
                if not self.verify_webhook_signature(payload_for_sig, signature):
                    self.logger.error("Invalid webhook signature")
                    return {"status": "error", "message": "Invalid signature"}

            # HARD-02: Composite idempotency key — (order_guid, event_type) pair
            # Prevents duplicate webhook deliveries from being double-processed
            # while still allowing different event types for the same order (T-20-02-02)
            order_guid = webhook_data.get("order_guid") or webhook_data.get("guid", "")
            event_type_raw = webhook_data.get("event_type", "OrderCompleted")
            idempotency_key = f"{order_guid}:{event_type_raw}"

            if await self._check_idempotency(idempotency_key):
                self.logger.info(f"Duplicate webhook skipped: {idempotency_key}")
                return {"status": "duplicate", "order_guid": order_guid}

            # Extract event type for routing (Toast uses eventType/type fields)
            event_type = (
                webhook_data.get("eventType")
                or webhook_data.get("type")
                or event_type_raw
            )

            if not event_type:
                self.logger.error("No event type in webhook data")
                return {"status": "error", "message": "Missing event type"}

            self.logger.info(f"Processing Toast webhook: {event_type}")

            # Route to appropriate handler
            handler_map = {
                "OrderCompleted": self.handle_order_completed,
                "OrderItemVoided": self.handle_item_voided,
                "OrderRefunded": self.handle_order_refunded,
                "MenuItemModified": self.handle_menu_modified,
            }

            handler = handler_map.get(event_type)
            if not handler:
                self.logger.warning(f"No handler for event type: {event_type}")
                return {"status": "ignored", "message": f"No handler for {event_type}"}

            result = await handler(webhook_data)

            # Mark as processed after successful handling
            await self._mark_processed(
                idempotency_key,
                result={
                    "wine_count": result.get("wine_count", 0),
                    "order_guid": order_guid,
                },
            )

            # Log to database
            await self.log_webhook_event(webhook_data, event_type, result)

            # Update metrics
            self.metrics.messages_processed += 1

            return result

        except Exception as e:
            self.logger.error(f"Error processing webhook: {e}", exc_info=True)
            self.metrics.record_error(str(e))
            return {"status": "error", "message": str(e)}

    async def process_pos_event(self, event) -> dict:
        """Process a normalized POSEvent from any POS provider.

        This is the provider-agnostic entry point (POS-ABSTRACT).
        Delegates to internal logic shared with process_toast_webhook().

        Args:
            event: POSEvent instance from any POSProvider adapter

        Returns:
            dict with status key ("accepted", "ignored", "error")
        """
        from core.pos_provider import POSEvent as _POSEvent

        if not isinstance(event, _POSEvent):
            return {
                "status": "error",
                "reason": "Invalid event type — expected POSEvent",
            }

        # Reconstruct webhook_data-compatible dict from POSEvent for internal processing
        webhook_data = event.raw_payload

        # Delegate to existing internal processing logic via process_toast_webhook
        # using raw_payload as both source and raw_bytes (signature already verified by adapter)
        import json as _json  # noqa: PLC0415

        raw_bytes = _json.dumps(webhook_data).encode("utf-8")

        try:
            return await self.process_toast_webhook(
                webhook_data=webhook_data,
                signature=None,  # Signature already verified by POSProvider adapter
                raw_payload=raw_bytes,
            )
        except Exception as exc:
            self.logger.error("process_pos_event error: %s", exc)
            return {"status": "error", "reason": str(exc)}

    async def handle_order_completed(
        self, webhook_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Handle completed order from Toast POS

        Extracts wine items and publishes sales events
        """
        try:
            order = webhook_data.get("data", {}).get("order", {})
            restaurant_guid = order.get("restaurantGuid")
            order_guid = order.get("guid")
            closed_date = order.get("closedDate") or datetime.utcnow().isoformat()

            if not restaurant_guid or not order_guid:
                return {
                    "status": "error",
                    "message": "Missing restaurant or order GUID",
                }

            # Extract wine items from order
            wine_sales = []

            # Gap D fix: support both nested Toast shape (order.selections) and
            # top-level items shape ({"items": [...], "order_guid": "x"}).
            nested_found = False
            toplevel_found = False

            selections = order.get("selections", [])
            if selections:
                nested_found = True
            else:
                # Fallback: caller sent items at envelope top level
                top_level_items = webhook_data.get("items", [])
                if top_level_items:
                    selections = top_level_items
                    toplevel_found = True

            self.logger.debug(
                f"Item source: "
                f"{'nested selections' if nested_found else 'top-level items' if toplevel_found else 'saga fallback'}"
            )

            # HARD-02: Check for incomplete webhook (empty selections may need polling)
            if not selections:
                self.logger.info(
                    f"Order {order_guid} has no selections — triggering polling saga"
                )
                enriched_items = await self._handle_incomplete_webhook(
                    order_guid, webhook_data
                )
                if enriched_items:
                    selections = enriched_items

            for selection in selections:
                item_name = selection.get("itemGroup", {}).get("name", "")
                quantity = selection.get("quantity", 1)
                price = (
                    selection.get("preDiscountPrice", 0) / 100
                )  # Convert cents to dollars

                # Check if this is a wine item (BUG-04: pass full selection for category check)
                is_wine = self.is_wine_item(item_name, selection=selection)

                # HARD-02: Log wine detection decision for auditability. Resolved
                # the same way is_wine_item resolves it, so the logged category and
                # confidence describe the decision that was actually made rather
                # than a second, differing opinion about it.
                category = selection_category(selection)
                decided_by_category = (
                    classify_wine_category(category, self.wine_menu_categories)
                    != "unknown"
                )
                confidence = 0.9 if decided_by_category else 0.7
                await self.log_decision(
                    "wine_detection",
                    inputs={
                        "item_name": item_name,
                        "category": category,
                        "order_guid": order_guid,
                    },
                    output={"is_wine": is_wine},
                    reasoning=(
                        "Category decided it"
                        if decided_by_category
                        else "Category absent or unrecognised; name keyword scan decided it"
                    ),
                    confidence=confidence,
                    restaurant_id=webhook_data.get("restaurant_id"),
                )

                if is_wine:
                    wine_sale = {
                        "item_name": item_name,
                        "quantity": quantity,
                        "price": price,
                        "selection_guid": selection.get("guid"),
                        "voided": selection.get("voided", False),
                    }
                    wine_sales.append(wine_sale)

            if not wine_sales:
                self.logger.info(f"No wine items found in order {order_guid}")
                return {"status": "success", "wine_count": 0}

            # Publish sales events for each wine
            events_published = 0
            for wine_sale in wine_sales:
                if not wine_sale["voided"]:
                    await self.publish_wine_sale_event(
                        restaurant_guid=restaurant_guid,
                        order_guid=order_guid,
                        wine_sale=wine_sale,
                        sale_timestamp=closed_date,
                    )
                    events_published += 1

            self.logger.info(
                f"Published {events_published} wine sale events from order {order_guid}"
            )

            return {
                "status": "success",
                "wine_count": len(wine_sales),
                "events_published": events_published,
            }

        except Exception as e:
            self.logger.error(f"Error handling order completed: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    async def handle_item_voided(self, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle voided item - reverse the sale"""
        try:
            data = webhook_data.get("data", {})
            item_name = data.get("itemName", "")

            if not self.is_wine_item(item_name):
                return {"status": "ignored", "message": "Not a wine item"}

            # Publish void event
            await self.publish_wine_void_event(
                restaurant_guid=data.get("restaurantGuid"),
                order_guid=data.get("orderGuid"),
                item_name=item_name,
                quantity=data.get("quantity", 1),
            )

            return {"status": "success", "action": "wine_sale_voided"}

        except Exception as e:
            self.logger.error(f"Error handling voided item: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    async def handle_order_refunded(
        self, webhook_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Handle refunded order (BUG-06 fix).

        Separate from void logic: refunds carry a monetary amount and may be partial.
        Publishes POSSaleRefunded with refund_amount_dollars, reason, and items list
        for credit tracking in the inventory and financial systems.

        Refund events go on routing key 'pos.sale.refunded' (distinct from
        'pos.sale.voided' used by publish_wine_void_event).
        """
        try:
            data = webhook_data.get("data", {})
            refund = data.get("refund", {})
            restaurant_guid = data.get("restaurantGuid", "")
            order_guid = data.get("orderGuid", "")

            refund_amount_cents = refund.get("amount", 0)
            refund_amount_dollars = refund_amount_cents / 100
            reason = refund.get("reason", "unknown")
            items = refund.get("items", [])

            if not restaurant_guid or not order_guid:
                return {
                    "status": "error",
                    "message": "Missing restaurant or order GUID in refund",
                }

            restaurant_id = await self.get_restaurant_id(restaurant_guid)

            # Publish one refund event per wine item in the refund
            events_published = 0
            for item in items:
                item_name = item.get("name", "")
                quantity = item.get("quantity", 1)

                if not self.is_wine_item(item_name, selection=item):
                    continue

                wine_id = await self.match_wine_to_library(item_name, restaurant_guid)

                event_data = {
                    "message_id": str(uuid4()),
                    "timestamp": datetime.utcnow().isoformat(),
                    "source_agent": self.agent_name,
                    "event_type": "POSSaleRefunded",
                    "routing_key": "pos.sale.refunded",
                    "exchange": "pos.events",
                    "payload": {
                        "restaurant_guid": restaurant_guid,
                        "restaurant_id": restaurant_id,
                        "order_guid": order_guid,
                        "wine_id": wine_id,
                        "wine_name": item_name,
                        "quantity": quantity,
                        "refund_amount_dollars": refund_amount_dollars,
                        "reason": reason,
                        "refund_timestamp": datetime.utcnow().isoformat(),
                        "credit_tracking": {
                            "original_order_guid": order_guid,
                            "refund_reason": reason,
                            "amount_credited": refund_amount_dollars,
                        },
                    },
                    "priority": 7,
                }

                await self.message_bus.publish(
                    exchange="pos.events",
                    routing_key="pos.sale.refunded",
                    message=event_data,
                )
                events_published += 1

            # If no item breakdown provided, publish a single order-level refund event
            if events_published == 0 and not items:
                event_data = {
                    "message_id": str(uuid4()),
                    "timestamp": datetime.utcnow().isoformat(),
                    "source_agent": self.agent_name,
                    "event_type": "POSSaleRefunded",
                    "routing_key": "pos.sale.refunded",
                    "exchange": "pos.events",
                    "payload": {
                        "restaurant_guid": restaurant_guid,
                        "restaurant_id": restaurant_id,
                        "order_guid": order_guid,
                        "refund_amount_dollars": refund_amount_dollars,
                        "reason": reason,
                        "refund_timestamp": datetime.utcnow().isoformat(),
                    },
                    "priority": 7,
                }
                await self.message_bus.publish(
                    exchange="pos.events",
                    routing_key="pos.sale.refunded",
                    message=event_data,
                )

            self.logger.info(
                f"Published {events_published} refund events for order {order_guid} "
                f"(amount=${refund_amount_dollars:.2f}, reason={reason})"
            )
            return {
                "status": "success",
                "action": "wine_sale_refunded",
                "events_published": events_published,
                "refund_amount_dollars": refund_amount_dollars,
            }

        except Exception as e:
            self.logger.error(f"Error handling order refunded: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    async def handle_menu_modified(
        self, webhook_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle menu modification - update wine library if needed"""
        self.logger.info("Menu modified event received - triggering wine library sync")

        # Publish event for inventory engine to handle
        event_data = {
            "message_id": str(uuid4()),
            "timestamp": datetime.utcnow().isoformat(),
            "source_agent": self.agent_name,
            "target_agent": "inventory_engine",
            "event_type": "MenuModified",
            "routing_key": "pos.menu.modified",
            "exchange": "pos.events",
            "payload": webhook_data.get("data", {}),
            "priority": 5,
        }

        # Publish to message bus
        await self.message_bus.publish(
            exchange="pos.events", routing_key="pos.menu.modified", message=event_data
        )

        return {"status": "success", "action": "sync_triggered"}

    def is_wine_item(
        self, item_name: str, selection: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if an item is a wine product.

        Strategy (BUG-04 fix, reconciled with PosHubService.resolveWine):
        1. If a Toast selection dict is provided, check its menu category first.
           Toast categorises wines correctly for named wines (Caymus, Opus One,
           etc.) that contain no wine keywords in their name. Read from
           menuGroup.category OR menuGroup.name — reading only the former meant
           the whole signal was dead against the payloads this handler receives.
        2. Fall back to a keyword scan of the name for uncategorised items or when
           selection is None.

        A category we do not recognise is NOT treated as a verdict. It falls
        through to step 2, because real POS menus file wine under headings we will
        not have seen ('Beverages' being the common one), and calling those 'not
        wine' undercounts every wine analytic downstream. Only a category that is
        positively a non-wine family (beer, coffee, pasta, water) stops the scan.

        Args:
            item_name: Name of the menu item
            selection: Full Toast selection dict (optional). If provided, its
                       menu category is consulted first.

        Returns:
            True if item is a wine, False otherwise
        """
        # Step 1: Category-based detection (accurate for brand-name wines)
        if selection:
            verdict = classify_wine_category(
                selection_category(selection), self.wine_menu_categories
            )
            if verdict != "unknown":
                return verdict == "wine"

        # Step 2: Keyword fallback — reached when the category is empty, absent, or
        # unrecognised (catches uncategorised wines).
        return looks_like_wine_name(item_name, self.wine_category_keywords)

    # =========================================================================
    # HARD-02: Toast Polling Saga — handles incomplete webhooks with empty items
    # =========================================================================

    async def _handle_incomplete_webhook(
        self,
        order_guid: str,
        payload: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """
        Handle a Toast webhook that arrived with an empty items/selections array.

        Starts a saga of type 'toast_order_enrichment' and polls Toast API up to
        3 times with exponential backoff (1s / 2s / 4s).

        On success: completes saga, returns enriched items list.
        On exhaustion: compensates saga, publishes PartialOrderReceived event, returns [].

        Security (T-20-02-04): This method is only reachable after HMAC signature
        verification, and duplicates are already blocked by idempotency checks, so
        crafted empty-items webhooks cannot retrigger the saga for the same key.
        """
        saga_id = await self.start_saga(
            "toast_order_enrichment",
            context={"order_guid": order_guid, "attempt": 0},
            deadline_minutes=5,
        )

        backoff = [1, 2, 4]
        for attempt, delay in enumerate(backoff):
            await asyncio.sleep(delay)
            await self.advance_saga(saga_id, f"POLL_ATTEMPT_{attempt + 1}")
            enriched_items = await self._poll_toast_for_order(order_guid)
            if enriched_items:
                await self.complete_saga(saga_id)
                return enriched_items

        # All retries exhausted — compensate and publish partial order event
        await self.compensate_saga(
            saga_id, error="Toast API polling exhausted after 3 attempts"
        )
        await self.publish(
            exchange_name="pos.events",
            routing_key="pos.partial_order_received",
            message_body={
                "event_type": "PartialOrderReceived",
                "payload": {
                    "order_guid": order_guid,
                    "available_data": payload,
                    "saga_id": saga_id,
                },
            },
            priority=3,
        )
        return []

    async def _poll_toast_for_order(self, order_guid: str) -> List[Dict[str, Any]]:
        """
        Poll Toast API for a specific order's items.

        In mock_mode returns [] (no external calls).
        In production, performs a GET to the Toast Orders API and returns
        the selections list from the first check.

        Args:
            order_guid: Toast order GUID to fetch

        Returns:
            List of selection dicts, or [] if not available / on error.
        """
        if self.mock_mode:
            return []

        try:
            import aiohttp

            url = f"{self.toast_api_url}/orders/{order_guid}"
            headers = {}
            if self.toast_client_id and self.toast_client_secret:
                import base64

                creds = f"{self.toast_client_id}:{self.toast_client_secret}"
                headers["Authorization"] = (
                    "Basic " + base64.b64encode(creds.encode()).decode()
                )

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        checks = data.get("checks", [{}])
                        return checks[0].get("selections", []) if checks else []
                    self.logger.warning(
                        f"Toast API returned {resp.status} for order {order_guid}"
                    )
                    return []
        except Exception as e:
            self.logger.error(f"Error polling Toast for order {order_guid}: {e}")
            return []

    # =========================================================================
    # PUBLISHING HELPERS
    # =========================================================================

    async def publish_wine_sale_event(
        self,
        restaurant_guid: str,
        order_guid: str,
        wine_sale: Dict[str, Any],
        sale_timestamp: str,
    ):
        """
        Publish a wine sale event to the message bus

        This event will be consumed by:
        - Buffer Manager (to update shadow stock)
        - Inventory Engine (to update live stock)
        - Reporting Agent (for analytics)
        """
        try:
            # Try to match wine name to master wine library
            wine_id = await self.match_wine_to_library(
                wine_sale["item_name"], restaurant_guid
            )
            restaurant_id = await self.get_restaurant_id(restaurant_guid)

            event_data = {
                "message_id": str(uuid4()),
                "timestamp": datetime.utcnow().isoformat(),
                "source_agent": self.agent_name,
                "event_type": "POSSaleCompleted",
                "routing_key": "pos.sale.completed",
                "exchange": "pos.events",
                "payload": {
                    "restaurant_guid": restaurant_guid,
                    "restaurant_id": restaurant_id,
                    "order_guid": order_guid,
                    "wine_id": wine_id,
                    "wine_name": wine_sale["item_name"],
                    "quantity": wine_sale["quantity"],
                    "price": wine_sale["price"],
                    "sale_timestamp": sale_timestamp,
                    "pos_system": "toast",
                    "selection_guid": wine_sale["selection_guid"],
                },
                "context": {
                    "pos_environment": self.toast_environment,
                    "sale_type": "completed",
                },
                "priority": 7,
            }

            await self.message_bus.publish(
                exchange="pos.events",
                routing_key="pos.sale.completed",
                message=event_data,
            )

            self.logger.debug(f"Published wine sale event for {wine_sale['item_name']}")

        except Exception as e:
            self.logger.error(f"Error publishing wine sale event: {e}", exc_info=True)

    async def publish_wine_void_event(
        self, restaurant_guid: str, order_guid: str, item_name: str, quantity: int
    ):
        """Publish a wine void/refund event"""
        try:
            wine_id = await self.match_wine_to_library(item_name, restaurant_guid)
            restaurant_id = await self.get_restaurant_id(restaurant_guid)

            event_data = {
                "message_id": str(uuid4()),
                "timestamp": datetime.utcnow().isoformat(),
                "source_agent": self.agent_name,
                "event_type": "POSSaleVoided",
                "routing_key": "pos.sale.voided",
                "exchange": "pos.events",
                "payload": {
                    "restaurant_guid": restaurant_guid,
                    "restaurant_id": restaurant_id,
                    "order_guid": order_guid,
                    "wine_id": wine_id,
                    "wine_name": item_name,
                    "quantity": quantity,
                    "void_timestamp": datetime.utcnow().isoformat(),
                },
                "priority": 7,
            }

            await self.message_bus.publish(
                exchange="pos.events", routing_key="pos.sale.voided", message=event_data
            )

            self.logger.debug(f"Published wine void event for {item_name}")

        except Exception as e:
            self.logger.error(f"Error publishing wine void event: {e}", exc_info=True)

    async def match_wine_to_library(
        self, item_name: str, restaurant_guid: str
    ) -> Optional[str]:
        """
        Match a POS item name to a wine in the master library

        Uses fuzzy matching (database similarity function)
        """
        try:
            # Get restaurant ID first
            restaurant_id = await self.get_restaurant_id(restaurant_guid)
            if not restaurant_id:
                return None

            # Query for best match using Supabase
            result = await self.database.inventory.find_wine_by_name_similarity(
                wine_name=item_name, restaurant_id=restaurant_id
            )

            if result:
                return result.get("id")

            self.logger.warning(f"No match found for wine: {item_name}")
            return None

        except Exception as e:
            self.logger.error(f"Error matching wine to library: {e}")
            return None

    async def get_restaurant_id(self, restaurant_guid: str) -> Optional[str]:
        """Get internal restaurant ID from Toast GUID"""
        try:
            # Use Supabase to query restaurants table
            response = (
                self.database.supabase.table("restaurants")
                .select("id")
                .eq("toast_restaurant_guid", restaurant_guid)
                .single()
                .execute()
            )

            return response.data.get("id") if response.data else None
        except Exception as e:
            self.logger.error(f"Error getting restaurant ID: {e}")
            return None

    async def log_webhook_event(
        self, webhook_data: Dict[str, Any], event_type: str, result: Dict[str, Any]
    ):
        """Log webhook event to database for audit trail"""
        try:
            await self.database.supabase.table("pos_webhook_logs").insert(
                {
                    "event_type": event_type,
                    "payload": webhook_data,
                    "processing_result": result,
                    "processed_at": datetime.utcnow().isoformat(),
                    "pos_system": "toast",
                }
            ).execute()
        except Exception as e:
            self.logger.error(f"Error logging webhook event: {e}")

    async def handle_manual_sync_request(self, message: Dict[str, Any]):
        """Handle manual sync request from admin"""
        self.logger.info("Manual POS sync requested")

        try:
            restaurant_id = message.get("payload", {}).get("restaurant_id")

            # In real implementation, this would fetch recent orders from Toast API
            # For now, just acknowledge

            response_data = {
                "message_id": str(uuid4()),
                "timestamp": datetime.utcnow().isoformat(),
                "source_agent": self.agent_name,
                "target_agent": message.get("source_agent"),
                "event_type": "POSSyncCompleted",
                "routing_key": "pos.sync.completed",
                "exchange": "pos.events",
                "payload": {
                    "restaurant_id": restaurant_id,
                    "sync_status": "completed",
                    "timestamp": datetime.utcnow().isoformat(),
                },
                "correlation_id": message.get("message_id"),
            }

            await self.message_bus.publish(
                exchange="pos.events",
                routing_key="pos.sync.completed",
                message=response_data,
            )

        except Exception as e:
            self.logger.error(f"Error handling manual sync: {e}", exc_info=True)
