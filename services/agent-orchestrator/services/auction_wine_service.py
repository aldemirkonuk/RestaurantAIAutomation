"""
Auction Wine Research Service
Uses AI (Gemini/OpenAI) to research unknown wines from auctions
Provides fallback mechanisms and confidence scoring
"""

import logging
import os
from typing import Dict, Optional
import asyncio

try:
    import google.generativeai as genai

    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logging.warning(
        "Google Generative AI not available. Install with: pip install google-generativeai"
    )

try:
    import openai

    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    logging.warning("OpenAI not available. Install with: pip install openai")

logger = logging.getLogger(__name__)


class AuctionWineService:
    """
    Service for researching unknown wines using AI
    Provides Gemini API with OpenAI fallback
    """

    def __init__(
        self, gemini_api_key: Optional[str] = None, openai_api_key: Optional[str] = None
    ):
        """
        Initialize auction wine service with API keys

        Args:
            gemini_api_key: Google Gemini API key
            openai_api_key: OpenAI API key
        """
        self.gemini_api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
        self.openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY")

        # Initialize clients
        if self.gemini_api_key and GEMINI_AVAILABLE:
            try:
                genai.configure(api_key=self.gemini_api_key)
                self.gemini_model = genai.GenerativeModel("gemini-2.5-flash")
                self.gemini_available = True
                logger.info("Gemini API initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Gemini: {e}")
                self.gemini_available = False
        else:
            self.gemini_available = False

        if self.openai_api_key and OPENAI_AVAILABLE:
            try:
                self.openai_client = openai.Client(api_key=self.openai_api_key)
                self.openai_available = True
                logger.info("OpenAI API initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize OpenAI: {e}")
                self.openai_available = False
        else:
            self.openai_available = False

    async def research_wine(self, wine_name: str) -> Dict:
        """
        Research wine details using AI with fallback mechanism

        Args:
            wine_name: Name of the wine to research

        Returns:
            Dict containing wine details and confidence score
        """
        try:
            # Try Gemini first
            if self.gemini_available:
                try:
                    result = await self._query_gemini(wine_name)
                    result["source"] = "gemini"
                    return result
                except Exception as e:
                    logger.warning(f"Gemini query failed: {e}, falling back to OpenAI")

            # Fallback to OpenAI
            if self.openai_available:
                try:
                    result = await self._query_openai(wine_name)
                    result["source"] = "openai"
                    return result
                except Exception as e:
                    logger.error(f"OpenAI query failed: {e}")

            # No AI available, return error
            return {
                "success": False,
                "error": "No AI service available",
                "confidence": "low",
            }

        except Exception as e:
            logger.error(f"Error researching wine: {e}")
            return {"success": False, "error": str(e), "confidence": "low"}

    async def _query_gemini(self, wine_name: str) -> Dict:
        """Query Gemini API for wine information"""
        prompt = self._build_research_prompt(wine_name)

        try:
            response = await asyncio.to_thread(
                self.gemini_model.generate_content, prompt
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                _out = getattr(_usage, "candidates_token_count", 0) or 0
                get_spend_logger().log(
                    provider="google",
                    model="gemini-2.5-flash",
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost("gemini-2.5-flash", _in, _out),
                    agent_fallback="auction_wine_service",
                    task_type="auction_wine_research",
                    outcome="success",  # call-level: response returned
                    context={"wine_name": str(wine_name)[:120]},
                )
            except Exception:
                pass

            # Parse response
            result = self._parse_ai_response(response.text, wine_name)
            return result

        except Exception as e:
            logger.error(f"Gemini query error: {e}")
            raise

    async def _query_openai(self, wine_name: str) -> Dict:
        """Query OpenAI API for wine information"""
        prompt = self._build_research_prompt(wine_name)

        try:
            response = await asyncio.to_thread(
                self.openai_client.chat.completions.create,
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a wine expert specializing in wine identification and classification.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,  # Lower temperature for more factual responses
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                _usage = getattr(response, "usage", None)
                _in = getattr(_usage, "prompt_tokens", 0) or 0
                _out = getattr(_usage, "completion_tokens", 0) or 0
                get_spend_logger().log(
                    provider="openai",
                    model="gpt-4o",
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost("gpt-4o", _in, _out),
                    agent_fallback="auction_wine_service",
                    task_type="auction_wine_research",
                    outcome="success",  # call-level: response returned
                    context={"wine_name": str(wine_name)[:120]},
                )
            except Exception:
                pass

            # Parse response
            result = self._parse_ai_response(
                response.choices[0].message.content, wine_name
            )
            return result

        except Exception as e:
            logger.error(f"OpenAI query error: {e}")
            raise

    def _build_research_prompt(self, wine_name: str) -> str:
        """Build comprehensive research prompt for AI"""
        return f"""
You are a wine expert. I need detailed information about a wine purchased at auction. Please provide structured information about:

Wine Name: "{wine_name}"

Please provide the following information in a structured format:

1. Full Wine Name: (official name with any corrections)
2. Producer/Winery: (name of producer)
3. Vintage: (year, or "NV" if non-vintage)
4. Wine Type: (red, white, sparkling, rose, or dessert)
5. Grape Variety: (primary grape or blend)
6. Region: (specific region)
7. Country: (country of origin)
8. Appellation: (AOC, DOC, AVA, etc.)
9. Estimated Market Price: (current market price in USD per bottle)
10. Confidence Level: (high, medium, or low - based on how well-known the wine is)

Please format your response as JSON:
{{
  "name": "Full wine name",
  "producer": "Producer name",
  "vintage": 2020,
  "type": "red",
  "grape": "Cabernet Sauvignon",
  "region": "Napa Valley",
  "country": "USA",
  "appellation": "Oakville AVA",
  "estimated_price": 150.00,
  "confidence": "high",
  "notes": "Any additional relevant information"
}}

If you're uncertain about any field, use your best estimate and note it in the confidence level.
"""

    def _parse_ai_response(self, response_text: str, original_name: str) -> Dict:
        """
        Parse AI response into structured wine data

        Attempts to extract JSON, falls back to text parsing if needed
        """
        try:
            import json

            # Try to find JSON in response
            json_match = response_text.find("{")
            if json_match != -1:
                json_end = response_text.rfind("}") + 1
                json_str = response_text[json_match:json_end]
                data = json.loads(json_str)

                # Validate and normalize
                return {
                    "success": True,
                    "name": data.get("name", original_name),
                    "producer": data.get("producer", "Unknown"),
                    "vintage": self._parse_vintage(data.get("vintage")),
                    "type": self._normalize_wine_type(data.get("type", "red")),
                    "grape": data.get("grape", "Unknown"),
                    "region": data.get("region", "Unknown"),
                    "country": data.get("country", "Unknown"),
                    "appellation": data.get("appellation", "Unknown"),
                    "estimated_price": float(data.get("estimated_price", 0)),
                    "confidence": data.get("confidence", "medium"),
                    "notes": data.get("notes", ""),
                    "acquisition_type": "auction",
                }

        except Exception as e:
            logger.warning(f"Failed to parse JSON from AI response: {e}")

        # Fallback: text parsing
        return self._parse_text_response(response_text, original_name)

    def _parse_text_response(self, text: str, original_name: str) -> Dict:
        """Fallback parser for non-JSON responses"""
        import re

        result = {
            "success": True,
            "name": original_name,
            "producer": "Unknown",
            "vintage": None,
            "type": "red",
            "grape": "Unknown",
            "region": "Unknown",
            "country": "Unknown",
            "appellation": "Unknown",
            "estimated_price": 0.0,
            "confidence": "low",
            "acquisition_type": "auction",
        }

        # Extract key information using regex
        patterns = {
            "producer": r"producer[:\s]+([^\n]+)",
            "vintage": r"vintage[:\s]+(\d{4}|NV)",
            "type": r"type[:\s]+(red|white|sparkling|ros[eé]|dessert)",
            "grape": r"grape[:\s]+([^\n]+)",
            "region": r"region[:\s]+([^\n]+)",
            "country": r"country[:\s]+([^\n]+)",
            "price": r"price[:\s]+[\$]?([\d,]+\.?\d{0,2})",
        }

        for key, pattern in patterns.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = match.group(1).strip()
                if key == "vintage":
                    result["vintage"] = self._parse_vintage(value)
                elif key == "type":
                    result["type"] = self._normalize_wine_type(value)
                elif key == "price":
                    result["estimated_price"] = float(value.replace(",", ""))
                else:
                    result[key] = value

        return result

    def _parse_vintage(self, vintage) -> Optional[int]:
        """Parse vintage value to integer or None"""
        if vintage in [None, "NV", "nv", "N/V"]:
            return None
        try:
            return int(vintage)
        except (ValueError, TypeError):
            return None

    def _normalize_wine_type(self, wine_type: str) -> str:
        """Normalize wine type to standard values"""
        wine_type = wine_type.lower().strip()

        type_map = {
            "red": "red",
            "white": "white",
            "sparkling": "sparkling",
            "champagne": "sparkling",
            "prosecco": "sparkling",
            "rose": "rose",
            "rosé": "rose",
            "dessert": "dessert",
            "port": "dessert",
            "sherry": "dessert",
            "sweet": "dessert",
        }

        return type_map.get(wine_type, "red")

    async def batch_research(self, wine_names: list[str]) -> list[Dict]:
        """
        Research multiple wines in batch

        Args:
            wine_names: List of wine names to research

        Returns:
            List of research results
        """
        tasks = [self.research_wine(name) for name in wine_names]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle exceptions in results
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Error researching wine '{wine_names[i]}': {result}")
                processed_results.append(
                    {"success": False, "error": str(result), "name": wine_names[i]}
                )
            else:
                processed_results.append(result)

        return processed_results


# Singleton instance
_auction_wine_service = None


def get_auction_wine_service() -> AuctionWineService:
    """Get singleton instance of AuctionWineService"""
    global _auction_wine_service
    if _auction_wine_service is None:
        _auction_wine_service = AuctionWineService()
    return _auction_wine_service
