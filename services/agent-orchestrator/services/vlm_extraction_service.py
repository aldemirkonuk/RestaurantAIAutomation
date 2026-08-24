"""
VLM Extraction Service (Gemini Vision — Primary Labeler)
========================================================
Primary extraction engine for gold-quality wine dataset:
  1. Every annotation image is processed by Gemini Vision
  2. VLM output drives labeling (not regex heuristics)
  3. Structured wines stored as gold reference
  4. Text fallback for parser failures (cheaper)

Every API call is saved to the training_datasets table for
future local VLM fine-tuning.

Cost:
  - Gemini Vision: ~$0.001/image
  - Gemini TEXT:   ~$0.0001/page
"""

import base64
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google import genai as _genai
from pydantic import BaseModel, Field

from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================


class VLMExtractionResult(BaseModel):
    """Result of VLM-based extraction."""

    wines: List[Dict[str, Any]] = Field(default_factory=list)
    sections: List[Dict[str, Any]] = Field(default_factory=list)
    section_hierarchy: Dict[str, Any] = Field(default_factory=dict)
    total_wines: int = 0
    confidence: float = 0.0
    extraction_method: str = "gemini_vision"  # gemini_vision or gemini_text
    cost_estimate: float = 0.0
    model_used: str = ""
    warnings: List[str] = Field(default_factory=list)
    raw_response: Optional[str] = None
    invoice_metadata: Optional[Dict[str, Any]] = None


# =============================================================================
# GEMINI VISION PROMPT
# =============================================================================

MENU_VISION_PROMPT = """You are a world-class sommelier and wine data extraction expert.

Analyze this wine menu image and extract EVERY wine entry you can find.

For each wine, extract these fields (use null if not visible):
- wine_name: The primary wine name / cuvée
- producer: Winery / estate / producer name
- vintage: Harvest year (4-digit integer, or null)
- wine_type: red | white | rose | sparkling | dessert | fortified
- country: Country of origin
- region: Wine region (e.g., Bordeaux, Napa Valley)
- sub_region: Sub-region if visible
- appellation: Official appellation (AOC, DOC, AVA, etc.)
- grape_variety: Grape variety or comma-separated blend
- price: Listed price (number only, bottle price if two prices shown)
- price_glass: Glass price if a separate glass price is listed (null otherwise)
- price_currency: USD, EUR, GBP, etc.
- serving_type: glass | bottle | carafe
- classification: Grand Cru, Reserva, Riserva, etc.
- tasting_notes: Any tasting description if visible
- confidence: Your confidence in this extraction (0.0 to 1.0)

Also extract the SECTION HIERARCHY:
- Identify section headers (e.g., "RED WINES", "Burgundy", "Pinot Noir")
- Build a hierarchy: Category > Subcategory > Sub-subcategory
- Assign each wine to its section path

For fields NOT visible on the menu, use your wine knowledge to INFER:
- "Pauillac" → country: France, region: Bordeaux
- "Barolo" → country: Italy, region: Piedmont, grape: Nebbiolo
Mark inferred fields in field_sources.

Return ONLY valid JSON (no markdown fences):
{
  "sections": [
    {"name": "Section Name", "level": 0, "parent": null}
  ],
  "wines": [
    {
      "wine_name": "...",
      "producer": "...",
      "vintage": 2018,
      "wine_type": "red",
      "country": "France",
      "region": "Bordeaux",
      "sub_region": null,
      "appellation": null,
      "grape_variety": "Cabernet Sauvignon, Merlot",
      "price": 150.0,
      "price_glass": 18.0,
      "price_currency": "USD",
      "serving_type": "bottle",
      "classification": null,
      "tasting_notes": null,
      "section_path": "Red/Bordeaux",
      "confidence": 0.9,
      "field_sources": {"country": "inferred", "vintage": "visible"}
    }
  ]
}"""

INVOICE_VISION_PROMPT = """You are an expert invoice data extraction AI.

Analyze this invoice image and extract all line items and metadata.

Extract:
1. Invoice metadata:
   - invoice_number
   - invoice_date
   - vendor_name
   - vendor_address
   - total_amount
   - subtotal
   - tax_amount

2. Line items (each wine/product):
   - wine_name
   - quantity (number of bottles/cases)
   - unit_type (bottle, case)
   - unit_price
   - line_total
   - vintage (if visible)

Return ONLY valid JSON (no markdown fences):
{
  "invoice_metadata": {
    "invoice_number": "...",
    "invoice_date": "...",
    "vendor_name": "...",
    "vendor_address": "...",
    "total_amount": 0.0,
    "subtotal": 0.0,
    "tax_amount": 0.0
  },
  "line_items": [
    {
      "wine_name": "...",
      "quantity": 12,
      "unit_type": "bottle",
      "unit_price": 25.0,
      "line_total": 300.0,
      "vintage": 2019
    }
  ]
}"""

TEXT_FALLBACK_PROMPT = """You are a world-class sommelier and wine data extraction expert.

The following text was extracted from a wine menu but the local parser
could not structure it reliably. Parse it into structured wine entries.

TEXT:
{text}

For each wine found, extract:
- wine_name, producer, vintage, primary_type, country, region, sub_region,
  appellation, grape_variety, price_reference, price_glass,
  serving_type, classification, tasting_notes
- confidence (0.0-1.0)
- field_sources (which fields are "visible" vs "inferred")

Also identify section headers and build the hierarchy.

Return ONLY valid JSON matching the same schema as a vision extraction."""


# =============================================================================
# VLM SERVICE
# =============================================================================


class VLMExtractionService:
    """Gemini Vision/TEXT extraction service — primary labeler for gold dataset."""

    def __init__(self):
        self._client = None
        self._initialized = False
        self._training_store = None

    def _initialize(self):
        """Lazy-initialize the Gemini client."""
        if self._initialized:
            return
        try:
            from google import genai

            self._client = genai.Client()
            self._initialized = True
            logger.info("Gemini client initialized for VLM extraction")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini client: {e}")
            self._initialized = False

    def _get_training_store(self):
        """Lazy-load training data store.

        Failure modes are kept distinct on purpose:
          - the module or symbol not resolving is a wiring bug (the store ships
            in this service) and is logged as an error with a traceback
          - Supabase not being configured is a legitimate state — the store
            buffers records in memory, so that is only worth an info line
        """
        if self._training_store is not None:
            return self._training_store

        try:
            from services.training_data_store import get_training_data_store
        except ImportError:
            logger.error(
                "Training data store could not be imported — VLM training "
                "capture is disabled. This is a wiring bug, not a missing "
                "optional dependency.",
                exc_info=True,
            )
            return None

        from core.database import get_supabase_client

        supabase = get_supabase_client()
        if supabase is None:
            # Legitimate state in local/mock runs: the store buffers in memory.
            logger.info(
                "Training capture running without Supabase; records buffer in memory"
            )

        try:
            from config.settings import get_settings

            self._training_store = get_training_data_store(
                supabase_client=supabase,
                mock_mode=get_settings().mock_llm,
            )
        except Exception:
            logger.error(
                "Failed to construct the training data store — VLM training "
                "capture is disabled",
                exc_info=True,
            )
            return None

        return self._training_store

    # =========================================================================
    # VISION EXTRACTION (for images)
    # =========================================================================

    async def extract_from_image(
        self,
        image_bytes: bytes,
        document_type: str = "menu",
        restaurant_name: Optional[str] = None,
        mime_type: str = "image/jpeg",
    ) -> VLMExtractionResult:
        """
        Extract wine data from an image using Gemini Vision.

        Args:
            image_bytes: Raw image bytes.
            document_type: 'menu' or 'invoice'.
            restaurant_name: Optional restaurant name.
            mime_type: Image MIME type.
        """
        self._initialize()
        if not self._initialized or not self._client:
            return VLMExtractionResult(
                warnings=["Gemini client not available"],
                extraction_method="gemini_vision",
            )

        prompt = (
            MENU_VISION_PROMPT if document_type == "menu" else INVOICE_VISION_PROMPT
        )
        if restaurant_name:
            prompt += f"\n\nRestaurant: {restaurant_name}"

        try:
            image_b64 = base64.b64encode(image_bytes).decode("utf-8")

            _t0 = time.perf_counter()
            response = self._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": mime_type,
                                    "data": image_b64,
                                },
                            },
                        ],
                    },
                ],
            )

            raw_text = response.text if response.text else ""
            result = self._parse_response(raw_text, "gemini_vision")

            # Log spend — non-fatal
            try:
                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
                _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                    getattr(_usage, "thoughts_token_count", 0) or 0
                )
                get_spend_logger().log(
                    provider="google",
                    model="gemini-2.5-flash",
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=0.001,
                    agent_fallback="vlm_extraction_service",
                    task_type="vision_extraction",
                    choice=f"wines:{result.total_wines}",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={
                        "document_type": document_type,
                        "wines_found": result.total_wines,
                    },
                )
            except Exception:
                pass

            # Save to training data
            await self._save_training_data(
                method="gemini_vision",
                prompt=prompt,
                response=raw_text,
                document_type=document_type,
                restaurant_name=restaurant_name,
            )

            result.cost_estimate = 0.001  # ~$0.001 per image
            result.model_used = "gemini-2.5-flash"
            return result

        except Exception as e:
            logger.error(f"Gemini Vision extraction failed: {e}")
            return VLMExtractionResult(
                warnings=[f"Gemini Vision failed: {str(e)}"],
                extraction_method="gemini_vision",
            )

    # =========================================================================
    # TEXT EXTRACTION (cheaper fallback for parser failures)
    # =========================================================================

    async def extract_from_text(
        self,
        text: str,
        document_type: str = "menu",
        restaurant_name: Optional[str] = None,
    ) -> VLMExtractionResult:
        """
        Extract wine data from raw text using Gemini TEXT.
        Cheaper than Vision. Used when local parser fails.

        Args:
            text: Raw text that local parser couldn't handle.
            document_type: 'menu' or 'invoice'.
            restaurant_name: Optional restaurant name.
        """
        self._initialize()
        if not self._initialized or not self._client:
            return VLMExtractionResult(
                warnings=["Gemini client not available"],
                extraction_method="gemini_text",
            )

        prompt = TEXT_FALLBACK_PROMPT.format(text=text[:50000])
        if restaurant_name:
            prompt += f"\n\nRestaurant: {restaurant_name}"

        try:
            _t0 = time.perf_counter()
            response = self._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )

            raw_text = response.text if response.text else ""
            result = self._parse_response(raw_text, "gemini_text")

            # Log spend — non-fatal (P1: this call was previously unlogged)
            try:
                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
                _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                    getattr(_usage, "thoughts_token_count", 0) or 0
                )
                get_spend_logger().log(
                    provider="google",
                    model="gemini-2.5-flash",
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=0.0001,
                    agent_fallback="vlm_extraction_service",
                    task_type="text_extraction",
                    choice=f"wines:{result.total_wines}",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={
                        "document_type": document_type,
                        "wines_found": result.total_wines,
                    },
                )
            except Exception:
                pass

            # Save to training data
            await self._save_training_data(
                method="gemini_text",
                prompt=prompt,
                response=raw_text,
                document_type=document_type,
                restaurant_name=restaurant_name,
            )

            result.cost_estimate = 0.0001  # ~$0.0001 per text call
            result.model_used = "gemini-2.5-flash"
            return result

        except Exception as e:
            logger.error(f"Gemini TEXT extraction failed: {e}")
            return VLMExtractionResult(
                warnings=[f"Gemini TEXT failed: {str(e)}"],
                extraction_method="gemini_text",
            )

    # =========================================================================
    # RESPONSE PARSING
    # =========================================================================

    def _parse_response(self, raw_text: str, method: str) -> VLMExtractionResult:
        """Parse the JSON response from Gemini."""
        result = VLMExtractionResult(extraction_method=method)
        result.raw_response = raw_text

        if not raw_text:
            result.warnings.append("Empty response from Gemini")
            return result

        # Clean up response (remove markdown fences if present)
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse Gemini response as JSON: {e}")
            result.warnings.append(f"JSON parse error: {str(e)}")
            return result

        wines = data.get("wines", data.get("line_items", []))
        result.wines = wines
        result.total_wines = len(wines)

        sections = data.get("sections", [])
        result.sections = sections

        hierarchy = {}
        for s in sections:
            name = s.get("name", "")
            level = s.get("level", 0)
            parent = s.get("parent")
            if level == 0:
                hierarchy[name] = {"subsections": {}}
            elif parent and parent in hierarchy:
                hierarchy[parent]["subsections"][name] = {"subsections": {}}
        result.section_hierarchy = hierarchy

        if wines:
            confidences = [w.get("confidence", 0.5) for w in wines]
            result.confidence = sum(confidences) / len(confidences)
        else:
            result.confidence = 0.0

        if "invoice_metadata" in data:
            result.invoice_metadata = data["invoice_metadata"]

        return result

    # =========================================================================
    # TRAINING DATA COLLECTION
    # =========================================================================

    async def _save_training_data(
        self,
        method: str,
        prompt: str,
        response: str,
        document_type: str,
        restaurant_name: Optional[str],
    ):
        """Save every VLM call for future fine-tuning of local models."""
        store = self._get_training_store()
        if not store:
            return

        try:
            await store.save_scan_pair(
                dataset_type=f"vlm_{document_type}",
                input_data={
                    "method": method,
                    "prompt": prompt[:2000],
                    "restaurant_name": restaurant_name,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                output_data={"response": response[:5000]},
                model_version="gemini-2.5-flash",
                confidence=0.0,
            )
        except Exception:
            # save_scan_pair swallows transient DB errors itself and falls back
            # to its in-memory buffer, so anything surfacing here is a bug in
            # this call — log it loudly rather than as a benign warning.
            logger.error(
                f"Failed to save VLM training data for vlm_{document_type}",
                exc_info=True,
            )


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[VLMExtractionService] = None


def get_vlm_service() -> VLMExtractionService:
    """Get module-level singleton VLM extraction service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = VLMExtractionService()
    return _service_instance


# =============================================================================
# CRAWL TEXT PROMPT
# =============================================================================

CRAWL_TEXT_PROMPT = """You are a world-class sommelier and wine data extraction expert.

The following text was crawled from {restaurant}'s website. Extract every wine entry you can identify.

TEXT (first 50000 chars):
{text}

For each wine extract: wine_name, producer, vintage (int or null), primary_type
(red|white|rose|sparkling|dessert|fortified), country, region, sub_region (if visible),
appellation (AOC/DOC/AVA if visible), grape_variety, price_reference (bottle price as
float or null), price_glass (float or null), section_path, confidence (0.0-1.0).

Return ONLY valid JSON (no markdown fences):
{{
  "sections": [{{"name": "...", "level": 0, "parent": null}}],
  "wines": [{{"wine_name": "...", "producer": "...", "vintage": 2018,
              "primary_type": "red", "country": "...", "region": "...",
              "sub_region": null, "appellation": null,
              "grape_variety": "...", "price_reference": 150.0,
              "price_glass": null, "section_path": "...", "confidence": 0.9}}]
}}"""


# =============================================================================
# GEMINI FLASH CRAWLER EXTRACTOR (Phase 2 — crawl pipeline only)
# =============================================================================


class GeminiFlashCrawlerExtractor:
    """
    Async Gemini Flash extractor for the background crawl pipeline.
    Uses AsyncClient + gemini-2.0-flash (not gemini-2.5-flash).
    Do NOT use for onboarding (that is ClaudeVisionExtractor).
    """

    MODEL_ID = "gemini-2.5-flash"

    def __init__(self):
        self._client = None

    def _get_client(self):
        if self._client is None:
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise RuntimeError(
                    "GEMINI_API_KEY not set — cannot initialize GeminiFlashCrawlerExtractor"
                )
            self._client = _genai.Client(api_key=api_key)
        return self._client

    async def extract_from_text(
        self, text: str, restaurant_name: str = "Unknown"
    ) -> VLMExtractionResult:
        try:
            client = self._get_client()
            _t0 = time.perf_counter()
            response = await client.aio.models.generate_content(
                model=self.MODEL_ID,
                contents=CRAWL_TEXT_PROMPT.format(
                    text=text[:50000], restaurant=restaurant_name
                ),
            )
            raw_text = response.text or ""
            result = self._parse_crawl_response(raw_text)
            result.model_used = self.MODEL_ID
            result.cost_estimate = 0.0001 * max(1, len(text) // 1000)
            try:
                usage = getattr(response, "usage_metadata", None)
                input_tokens = getattr(usage, "prompt_token_count", 0) or 0
                # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
                output_tokens = (getattr(usage, "candidates_token_count", 0) or 0) + (
                    getattr(usage, "thoughts_token_count", 0) or 0
                )
                get_spend_logger().log(
                    provider="google",
                    model=self.MODEL_ID,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost_usd=result.cost_estimate,
                    agent_fallback="vlm_extraction_service",
                    task_type="crawl_extraction",
                    choice=f"wines:{result.total_wines}",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    context={"wines_found": result.total_wines},
                )
            except Exception:
                pass
            return result
        except Exception as e:
            logger.error(f"GeminiFlashCrawlerExtractor failed: {e}")
            return VLMExtractionResult(
                warnings=[f"Gemini Flash crawl extraction failed: {str(e)}"],
                extraction_method="gemini_flash_crawl",
                model_used=self.MODEL_ID,
            )

    def _parse_crawl_response(self, raw_text: str) -> VLMExtractionResult:
        result = VLMExtractionResult(extraction_method="gemini_flash_crawl")
        result.raw_response = raw_text
        if not raw_text:
            result.warnings.append("Empty response from Gemini Flash")
            return result
        cleaned = raw_text.strip()
        # Strip markdown fences
        if cleaned.startswith("```"):
            lines = cleaned.split("\n", 1)
            cleaned = lines[1] if len(lines) > 1 else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
        # Fallback: find first { ... } block
        if not cleaned.startswith("{"):
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1:
                cleaned = cleaned[start : end + 1]
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            result.warnings.append(f"JSON parse error: {str(e)}")
            return result
        wines = data.get("wines", [])
        # Field names in wine dicts match CRAWL_TEXT_PROMPT schema:
        # primary_type (not wine_type), price_reference (not price)
        result.wines = wines
        result.total_wines = len(wines)
        result.sections = data.get("sections", [])
        result.confidence = (
            sum(w.get("confidence", 0.5) for w in wines) / len(wines) if wines else 0.0
        )
        return result


# =============================================================================
# CRAWLER EXTRACTOR SINGLETON
# =============================================================================

_crawler_extractor_instance: Optional[GeminiFlashCrawlerExtractor] = None


def get_gemini_crawler_extractor() -> GeminiFlashCrawlerExtractor:
    """Get module-level singleton GeminiFlashCrawlerExtractor."""
    global _crawler_extractor_instance
    if _crawler_extractor_instance is None:
        _crawler_extractor_instance = GeminiFlashCrawlerExtractor()
    return _crawler_extractor_instance
