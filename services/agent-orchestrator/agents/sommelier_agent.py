"""
Sommelier Agent
===============
AI-powered wine expertise with:
- Master Wine Library management
- Calendar-aware suggestions
- Vintage recommendations
- Tasting notes and pairing suggestions
- Event-based wine recommendations
"""

from typing import Dict, List, Any, Optional
import json

from core.base_agent import BaseAgent
from core.database import MasterWineLibrary
from services.spend_logger import estimate_llm_cost, get_spend_logger
from config.settings import get_settings


class SommelierAgent(BaseAgent):
    """
    Sommelier Agent - AI-powered wine expertise

    Core Responsibilities:
    ✅ Master Wine Library management
    ✅ Calendar-aware suggestions (Valentine's Day → Champagne)
    ✅ Vintage recommendations
    ✅ Tasting notes and pairing suggestions
    ✅ Event-based wine recommendations
    ✅ Wine data enrichment from external sources

    Integration Points:
    - Google Calendar for event detection
    - Gemini/OpenAI for wine interpretation
    - Vivino/Wine-Searcher for data enrichment
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # LLM configuration
        # gemini-pro is retired (404). Enrichment is extraction-shaped and this
        # agent uses the Gemini SDK, so it falls back to the Gemini default.
        self.llm_model = config.get("llm_model", get_settings().gemini_model)
        self.google_api_key = config.get("google_api_key")
        self.mock_mode = config.get("mock_mode", True)

        # LLM client
        self.llm_client = None

        # Event-wine mapping (calendar-aware)
        self.event_wine_mapping = {
            "valentine": ["sparkling", "rosé", "champagne"],
            "christmas": ["red", "sparkling", "port"],
            "new year": ["sparkling", "champagne"],
            "thanksgiving": ["red", "white"],
            "easter": ["white", "rosé"],
            "summer": ["white", "rosé", "sparkling"],
            "winter": ["red", "port"],
            "seafood": ["white", "sparkling"],
            "steak": ["red"],
            "pasta": ["red", "white"],
            "dessert": ["dessert", "port"],
            "celebration": ["sparkling", "champagne"],
            "romantic": ["rosé", "sparkling", "champagne"],
            "business": ["red", "white"],
        }

        # Wine pairing database
        self.food_wine_pairings = {
            "beef": ["Cabernet Sauvignon", "Malbec", "Syrah"],
            "lamb": ["Pinot Noir", "Syrah", "Merlot"],
            "pork": ["Riesling", "Pinot Noir", "Chardonnay"],
            "chicken": ["Chardonnay", "Pinot Grigio", "Sauvignon Blanc"],
            "fish": ["Sauvignon Blanc", "Pinot Grigio", "Chablis"],
            "seafood": ["Champagne", "Muscadet", "Albariño"],
            "pasta_red": ["Chianti", "Sangiovese", "Montepulciano"],
            "pasta_white": ["Pinot Grigio", "Vermentino", "Soave"],
            "cheese": ["Port", "Sauternes", "Riesling"],
            "chocolate": ["Port", "Banyuls", "Maury"],
        }

    async def initialize(self) -> None:
        """Initialize Sommelier Agent"""
        self.logger.info("Initializing Sommelier Agent")

        if self.mock_mode:
            self.logger.warning("⚠️ Running in MOCK mode (no real LLM calls)")
        else:
            # Initialize Gemini client using new google-genai SDK
            try:
                from google import genai

                self.genai_client = genai.Client(api_key=self.google_api_key)
                self.logger.info(
                    f"✓ Gemini client initialized (google-genai SDK, model: {self.llm_model})"
                )
            except ImportError:
                # Fallback to legacy SDK
                try:
                    import google.generativeai as genai_legacy

                    genai_legacy.configure(api_key=self.google_api_key)
                    self.llm_client = genai_legacy.GenerativeModel(self.llm_model)
                    self.genai_client = None
                    self.logger.info("✓ Gemini Pro client initialized (legacy SDK)")
                except Exception as e:
                    self.logger.error(f"Failed to initialize LLM client: {e}")
                    self.mock_mode = True

        self.logger.info("✓ Sommelier Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("calendar.events", "calendar.event_detected"),
            ("sommelier.events", "sommelier.wine_query"),
            ("sommelier.events", "sommelier.pairing_request"),
            ("sommelier.events", "sommelier.enrichment_request"),
            ("inventory.events", "inventory.new_wine_added"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "calendar.event_detected":
            await self._handle_calendar_event(message)
        elif routing_key == "sommelier.wine_query":
            await self._handle_wine_query(message)
        elif routing_key == "sommelier.pairing_request":
            await self._handle_pairing_request(message)
        elif routing_key == "sommelier.enrichment_request":
            await self._handle_enrichment_request(message)
        elif routing_key == "inventory.new_wine_added":
            await self._enrich_new_wine(message)

    async def _handle_calendar_event(self, message: Dict[str, Any]) -> None:
        """
        Handle calendar event and suggest wines

        Example: Valentine's Day detected → suggest Champagne, Rosé
        """
        payload = message.get("payload", {})

        event_name = payload.get("event_name", "")
        event_date = payload.get("event_date")
        restaurant_id = payload.get("restaurant_id")

        self.logger.info(f"Processing calendar event: {event_name}")

        try:
            # Detect event type
            event_type = self._detect_event_type(event_name)

            # Get wine suggestions
            suggestions = await self._suggest_wines_for_event(
                event_type=event_type,
                restaurant_id=restaurant_id,
            )

            # Publish suggestions
            await self.publish(
                exchange_name="sommelier.events",
                routing_key="sommelier.event_suggestions",
                message_body={
                    "event_type": "WineSuggestionsForEvent",
                    "payload": {
                        "event_name": event_name,
                        "event_date": event_date,
                        "event_type": event_type,
                        "suggestions": suggestions,
                        "restaurant_id": restaurant_id,
                    },
                },
                priority=5,
            )

            # Notify manager
            if suggestions:
                await self._notify_event_suggestions(
                    event_name=event_name,
                    event_date=event_date,
                    suggestions=suggestions,
                    restaurant_id=restaurant_id,
                )

        except Exception as e:
            self.logger.error(f"Error handling calendar event: {e}", exc_info=True)

    async def _handle_wine_query(self, message: Dict[str, Any]) -> None:
        """
        Handle wine query from user

        Uses LLM to interpret natural language queries
        """
        payload = message.get("payload", {})

        query = payload.get("query", "")
        payload.get("restaurant_id")
        conversation_id = payload.get("conversation_id")

        self.logger.info(f"Processing wine query: {query[:50]}...")

        try:
            # Interpret query with LLM
            interpretation = await self._interpret_wine_query(query)

            # Search wine library
            wines = await self._search_wines(interpretation)

            # Generate response
            response = await self._generate_wine_response(
                query=query,
                wines=wines,
                interpretation=interpretation,
            )

            # Publish response
            await self.publish(
                exchange_name="sommelier.events",
                routing_key="sommelier.query_response",
                message_body={
                    "event_type": "WineQueryResponse",
                    "payload": {
                        "query": query,
                        "response": response,
                        "wines": [
                            w.model_dump() if hasattr(w, "model_dump") else w
                            for w in wines[:5]
                        ],
                        "conversation_id": conversation_id,
                    },
                },
                priority=5,
            )

        except Exception as e:
            self.logger.error(f"Error handling wine query: {e}", exc_info=True)

    async def _handle_pairing_request(self, message: Dict[str, Any]) -> None:
        """
        Handle food-wine pairing request
        """
        payload = message.get("payload", {})

        food = payload.get("food", "")
        occasion = payload.get("occasion")
        price_range = payload.get("price_range")
        restaurant_id = payload.get("restaurant_id")

        self.logger.info(f"Processing pairing request for: {food}")

        try:
            # Get pairing suggestions
            pairings = await self._get_food_pairings(
                food=food,
                occasion=occasion,
                price_range=price_range,
                restaurant_id=restaurant_id,
            )

            # Publish pairings
            await self.publish(
                exchange_name="sommelier.events",
                routing_key="sommelier.pairing_response",
                message_body={
                    "event_type": "WinePairingResponse",
                    "payload": {
                        "food": food,
                        "pairings": pairings,
                        "occasion": occasion,
                    },
                },
                priority=5,
            )

        except Exception as e:
            self.logger.error(f"Error handling pairing request: {e}", exc_info=True)

    async def _handle_enrichment_request(self, message: Dict[str, Any]) -> None:
        """
        Handle wine data enrichment request

        Enriches wine data from external sources:
        - Gemini/OpenAI for interpretation
        - Vivino API
        - Wine-Searcher API
        """
        payload = message.get("payload", {})

        wine_id = payload.get("wine_id")
        wine_name = payload.get("wine_name")

        self.logger.info(f"Enriching wine data: {wine_name}")

        try:
            # Get current wine data
            await self.database.wine_library.get_by_id(wine_id) if wine_id else None

            # Enrich via LLM
            enrichment = await self._enrich_wine_via_llm(wine_name)

            # Update wine library
            if wine_id and enrichment:
                await self.database.wine_library.enrich_wine(
                    wine_id=wine_id,
                    enrichment_data=enrichment,
                    source="gemini",
                )

            # Publish enrichment result
            await self.publish(
                exchange_name="sommelier.events",
                routing_key="sommelier.enrichment_complete",
                message_body={
                    "event_type": "WineEnrichmentComplete",
                    "payload": {
                        "wine_id": wine_id,
                        "wine_name": wine_name,
                        "enrichment": enrichment,
                    },
                },
                priority=4,
            )

        except Exception as e:
            self.logger.error(f"Error enriching wine: {e}", exc_info=True)

    async def _enrich_new_wine(self, message: Dict[str, Any]) -> None:
        """
        Auto-enrich newly added wine
        """
        payload = message.get("payload", {})

        wine_id = payload.get("wine_id")
        wine_name = payload.get("wine_name")

        self.logger.info(f"Auto-enriching new wine: {wine_name}")

        # Trigger enrichment
        await self.publish(
            exchange_name="sommelier.events",
            routing_key="sommelier.enrichment_request",
            message_body={
                "event_type": "WineEnrichmentRequest",
                "payload": {
                    "wine_id": wine_id,
                    "wine_name": wine_name,
                    "auto_triggered": True,
                },
            },
            priority=3,
        )

    def _detect_event_type(self, event_name: str) -> str:
        """
        Detect event type from event name
        """
        event_lower = event_name.lower()

        for event_type, keywords in [
            ("valentine", ["valentine", "romantic", "love"]),
            ("christmas", ["christmas", "xmas", "holiday"]),
            ("new year", ["new year", "nye", "new years"]),
            ("thanksgiving", ["thanksgiving", "turkey"]),
            ("easter", ["easter", "spring"]),
            ("summer", ["summer", "bbq", "outdoor"]),
            ("winter", ["winter", "cozy"]),
            ("celebration", ["birthday", "anniversary", "celebration"]),
            ("business", ["business", "corporate", "meeting"]),
        ]:
            if any(kw in event_lower for kw in keywords):
                return event_type

        return "general"

    async def _suggest_wines_for_event(
        self,
        event_type: str,
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Suggest wines for an event type
        """
        self.event_wine_mapping.get(event_type, ["red", "white"])

        # Get wines from library
        wines = await self.database.wine_library.get_wines_for_event(
            event_type=event_type,
            limit=10,
        )

        suggestions = []
        for wine in wines:
            suggestions.append(
                {
                    "wine_id": wine.id,
                    "name": wine.name,
                    "wine_type": wine.wine_type,
                    "region": wine.region,
                    "tasting_notes": wine.tasting_notes,
                    "food_pairings": wine.food_pairings,
                    "avg_price": wine.avg_retail_price,
                }
            )

        return suggestions

    def _log_llm_spend(self, response, model: str, task_type: str) -> None:
        """P1: emit one spend/NF row for a Gemini call (never raises)."""
        try:
            _usage = getattr(response, "usage_metadata", None)
            _in = getattr(_usage, "prompt_token_count", 0) or 0
            # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
            _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                getattr(_usage, "thoughts_token_count", 0) or 0
            )
            get_spend_logger().log(
                provider="google",
                model=model,
                input_tokens=_in,
                output_tokens=_out,
                cost_usd=estimate_llm_cost(model, _in, _out),
                agent=self.agent_name,
                task_type=task_type,
                outcome="success",  # call-level: response returned
                correlation_id=getattr(self, "_current_correlation_id", None),
            )
        except Exception:
            pass

    async def _interpret_wine_query(self, query: str) -> Dict[str, Any]:
        """
        Interpret natural language wine query using LLM
        """
        if self.mock_mode:
            # Mock interpretation
            return {
                "wine_type": "red",
                "region": None,
                "grape": None,
                "price_range": "medium",
                "occasion": None,
                "food_pairing": None,
                "intent": "recommendation",
            }

        try:
            prompt = f"""Interpret this wine query and extract structured information.

Query: "{query}"

Extract the following (if mentioned):
- wine_type: red, white, rosé, sparkling, dessert, or null
- region: wine region mentioned, or null
- grape: grape variety mentioned, or null
- price_range: budget, medium, premium, luxury, or null
- occasion: event or occasion mentioned, or null
- food_pairing: food mentioned for pairing, or null
- intent: recommendation, information, pairing, or purchase

Respond with valid JSON only."""

            response = self.llm_client.generate_content(
                prompt, generation_config={"temperature": 0.1}
            )
            self._log_llm_spend(response, self.llm_model, "query_interpretation")  # P1

            return json.loads(response.text)

        except Exception as e:
            self.logger.error(f"Query interpretation failed: {e}")
            return {"intent": "recommendation"}

    async def _search_wines(
        self,
        interpretation: Dict[str, Any],
    ) -> List[MasterWineLibrary]:
        """
        Search wine library based on interpretation
        """
        # Build search criteria
        wine_type = interpretation.get("wine_type")
        region = interpretation.get("region")

        if wine_type:
            wines = await self.database.wine_library.find_many(
                {"wine_type": wine_type},
                limit=10,
            )
        elif region:
            wines = await self.database.wine_library.find_many(
                {"region": region},
                limit=10,
            )
        else:
            # General search
            wines = await self.database.wine_library.find_many({}, limit=10)

        return wines

    async def _generate_wine_response(
        self,
        query: str,
        wines: List[MasterWineLibrary],
        interpretation: Dict[str, Any],
    ) -> str:
        """
        Generate natural language response about wines
        """
        if self.mock_mode or not wines:
            if not wines:
                return "I couldn't find any wines matching your criteria. Would you like me to suggest some alternatives?"

            wine_names = [w.name for w in wines[:3]]
            return f"Based on your query, I recommend: {', '.join(wine_names)}. Would you like more details about any of these?"

        try:
            wine_info = "\n".join(
                [
                    f"- {w.name}: {w.wine_type}, {w.region}, {w.tasting_notes or 'No notes'}"
                    for w in wines[:5]
                ]
            )

            prompt = f"""You are a professional sommelier. Generate a helpful response to this wine query.

Query: "{query}"

Available wines:
{wine_info}

Provide a friendly, knowledgeable response recommending wines from the list. Keep it concise (2-3 sentences)."""

            response = self.llm_client.generate_content(
                prompt, generation_config={"temperature": 0.7, "max_output_tokens": 150}
            )
            self._log_llm_spend(response, self.llm_model, "wine_response")  # P1

            return response.text.strip()

        except Exception as e:
            self.logger.error(f"Response generation failed: {e}")
            wine_names = [w.name for w in wines[:3]]
            return f"I recommend: {', '.join(wine_names)}."

    async def _get_food_pairings(
        self,
        food: str,
        occasion: Optional[str] = None,
        price_range: Optional[str] = None,
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get wine pairings for a food item
        """
        food_lower = food.lower()

        # Find matching food category
        grape_suggestions = []
        for food_type, grapes in self.food_wine_pairings.items():
            if food_type in food_lower or food_lower in food_type:
                grape_suggestions.extend(grapes)

        if not grape_suggestions:
            # Default suggestions
            grape_suggestions = ["Chardonnay", "Pinot Noir", "Sauvignon Blanc"]

        # Search for wines with these grapes
        pairings = []
        for grape in grape_suggestions[:3]:
            wines = await self.database.wine_library.search_by_name(grape, limit=2)
            for wine in wines:
                pairings.append(
                    {
                        "wine_id": wine.id,
                        "name": wine.name,
                        "grape": grape,
                        "wine_type": wine.wine_type,
                        "pairing_reason": f"Pairs well with {food}",
                        "tasting_notes": wine.tasting_notes,
                    }
                )

        return pairings

    async def _enrich_wine_via_llm(self, wine_name: str) -> Dict[str, Any]:
        """
        Enrich wine data using Gemini with Google Search grounding.
        Uses the new google-genai SDK when available, falls back to legacy.
        """
        if self.mock_mode:
            return {
                "region": "Bordeaux, France",
                "grape_varieties": ["Cabernet Sauvignon", "Merlot"],
                "wine_type": "red",
                "tasting_notes": "Full-bodied with notes of blackcurrant, cedar, and tobacco",
                "food_pairings": ["beef", "lamb", "aged cheese"],
            }

        prompt = f"""Provide detailed information about this wine: "{wine_name}"

Use web search to verify accuracy. Return JSON with:
- name: official wine name
- producer: producer/winery
- region: wine region
- sub_region: specific sub-region if known
- country: country of origin
- grape_varieties: list of grape varieties
- wine_type: red, white, rosé, sparkling, or dessert
- color: wine color description
- alcohol_pct: alcohol percentage (number)
- body: light, medium, or full
- sweetness: dry, off-dry, semi-sweet, or sweet
- tasting_notes: brief tasting description
- food_pairings: list of food pairings
- avg_retail_price: estimated retail price in USD (number only)
- description: brief consumer description
- appellation: wine appellation if known
- classification: wine classification if any

Respond with valid JSON only."""

        # Try new google-genai SDK with grounding first
        if hasattr(self, "genai_client") and self.genai_client:
            try:
                from google.genai import types

                grounding_tool = types.Tool(google_search=types.GoogleSearch())
                config = types.GenerateContentConfig(
                    tools=[grounding_tool],
                    temperature=0.1,
                )
                # one binding for the call and its spend label (OD-57)
                model_id = get_settings().gemini_model
                response = self.genai_client.models.generate_content(
                    model=model_id,
                    contents=prompt,
                    config=config,
                )
                self._log_llm_spend(response, model_id, "wine_enrichment_grounded")  # P1
                result_text = response.text.strip()
                if "```json" in result_text:
                    result_text = (
                        result_text.split("```json")[1].split("```")[0].strip()
                    )
                elif "```" in result_text:
                    result_text = result_text.split("```")[1].split("```")[0].strip()
                return json.loads(result_text)
            except Exception as e:
                self.logger.warning(f"New SDK enrichment failed, trying legacy: {e}")

        # Fallback to legacy SDK
        try:
            if hasattr(self, "llm_client") and self.llm_client:
                response = self.llm_client.generate_content(
                    prompt, generation_config={"temperature": 0.1}
                )
                self._log_llm_spend(  # P1
                    response, self.llm_model, "wine_enrichment_fallback"
                )
                result_text = response.text.strip()
                if "```json" in result_text:
                    result_text = (
                        result_text.split("```json")[1].split("```")[0].strip()
                    )
                elif "```" in result_text:
                    result_text = result_text.split("```")[1].split("```")[0].strip()
                return json.loads(result_text)
        except Exception as e:
            self.logger.error(f"LLM enrichment failed: {e}")

        return {}

    async def _notify_event_suggestions(
        self,
        event_name: str,
        event_date: str,
        suggestions: List[Dict[str, Any]],
        restaurant_id: str,
    ) -> None:
        """
        Notify manager of wine suggestions for upcoming event
        """
        wine_names = [s["name"] for s in suggestions[:3]]

        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.info",
            message_body={
                "event_type": "EventWineSuggestions",
                "payload": {
                    "type": "event_wine_suggestions",
                    "priority": "medium",
                    "event_name": event_name,
                    "event_date": event_date,
                    "message": (
                        f"🍷 Wine suggestions for {event_name}:\n"
                        f"{', '.join(wine_names)}\n"
                        f"Check inventory levels before the event!"
                    ),
                    "suggestions": suggestions,
                    "notification_channels": {"push": True},
                },
            },
            priority=4,
        )

    # =========================================================================
    # PUBLIC API METHODS (for direct calls)
    # =========================================================================

    async def suggest_wines_for_event(
        self,
        event_type: str,
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Public API: Get wine suggestions for an event
        """
        return await self._suggest_wines_for_event(event_type, restaurant_id)

    async def get_food_pairings(
        self,
        food: str,
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Public API: Get wine pairings for food
        """
        return await self._get_food_pairings(food, restaurant_id=restaurant_id)

    async def enrich_wine_data(
        self,
        wine_name: str,
    ) -> Dict[str, Any]:
        """
        Public API: Enrich wine data from external sources
        """
        return await self._enrich_wine_via_llm(wine_name)

    async def add_to_master_library(
        self,
        wine_data: Dict[str, Any],
    ) -> Optional[MasterWineLibrary]:
        """
        Public API: Add wine to master library
        """
        wine = MasterWineLibrary(**wine_data)
        return await self.database.wine_library.create(wine)

    async def cleanup(self) -> None:
        """Cleanup LLM resources"""
        self.llm_client = None
        self.logger.info("✓ Sommelier Agent cleaned up")
