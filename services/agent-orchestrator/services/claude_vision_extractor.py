"""
Claude Vision Extraction Service
=================================
Standalone extraction engine for menu images → structured wine JSON.
Uses Claude Vision (claude-haiku-4-5-20251001) with async parallel page
dispatch via asyncio.gather + Semaphore(5).

Architecture Decision:
- This file is the ONLY place Claude Vision is called for onboarding.
- vlm_extraction_service.py (Gemini path) is NOT modified.
- Follows VLMExtractionResult Pydantic pattern from vlm_extraction_service.py.
- Model switched from Sonnet → Haiku 2026-04-02: benchmark confirmed equal quality,
  3.8x lower cost ($0.13 vs $0.49/restaurant), 2.1x lower p50 latency.
"""

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

import anthropic
from pydantic import BaseModel, Field

from services.spend_logger import get_spend_logger
from services.field_confidence import (
    build_field_confidence,
    compute_completeness_from_fc,
    VISION_FIELDS,
)

logger = logging.getLogger(__name__)

# =============================================================================
# CONSTANTS
# =============================================================================

MODEL_ID = "claude-haiku-4-5-20251001"
MAX_TOKENS = 8192  # Haiku max; truncation handled by parse_json_response recovery
CONCURRENCY_LIMIT = 5  # asyncio.Semaphore cap; prevents Anthropic rate limit
PRICE_INPUT_PER_M = 0.80  # USD per 1M input tokens (Haiku, 2026-04-02)
PRICE_OUTPUT_PER_M = 4.00  # USD per 1M output tokens

# Legacy completeness fields kept for backward compat in compute_completeness()
COMPLETENESS_FIELDS = [
    "wine_name",
    "vintage",
    "price_bottle",
    "region",
    "country",
    "section_name",
]
COMPLETENESS_THRESHOLD = 0.5  # < 0.5 → needs_review

# Phase 7: 18-field extraction prompt with per-field {value, confidence, source} format
# confidence: 0.0–1.0 (how confident Claude is in this field's accuracy)
# source: "visible" = printed on menu exactly | "inferred" = Claude's best guess from context
EXTRACTION_PROMPT = """You are a wine menu extraction expert. Extract ALL wines from this menu image into structured JSON.

For each wine, return EVERY field with a nested object containing value, confidence (0.0-1.0), and source.

Fields to extract per wine:
- wine_name: Full name of the wine (producer + cuvée). NEVER include a year/vintage in this field.
- producer: Producer/winery name ONLY. STRICT RULES:
  * NEVER start producer with a year (e.g. "2022 Domaine X" → producer="Domaine X", vintage=2022)
  * NEVER include region, country, appellation, or DOC in producer (e.g. "Domaine X Loire Valley" → producer="Domaine X", region="Loire Valley")
  * If the menu prints "2022 Bodegas Y Viñedos Toledo" — vintage=2022, producer="Bodegas Y Viñedos Toledo"
  * If the menu prints "Domaine de Justices Loire Valley Spain" — producer="Domaine de Justices", region="Loire Valley", country="Spain"
- vintage: Year as integer (null if NV or not shown). Extract from producer/wine_name if printed there.
- primary_type: One of "red", "white", "rosé", "sparkling", "dessert", "fortified", "orange"
- color: "red", "white", "rosé", "amber" — based on grape/type if not stated
- country: Country of origin
- region: Wine region (e.g., "Bordeaux", "Napa Valley")
- sub_region: Sub-region if known (e.g., "Pauillac", "Rutherford")
- appellation: Appellation/DOC/AOC designation if stated
- grape_variety: Grape or blend if stated or strongly inferable
- alcohol_pct: Alcohol percentage as float (null if not shown)
- price_bottle: Bottle price as float (null if not shown)
- price_glass: Glass price as float (null if not shown)
- tasting_notes: Tasting notes text if printed on menu (null otherwise)
- description: Any description text on the menu for this wine
- section_name: The section/category this wine appears under on the menu
- bin_number: Bin/item number if shown (null otherwise)
- sweetness_level: One of "dry", "off-dry", "semi-sweet", "sweet", "brut", "extra-dry" (null if unknown)

Confidence guidelines:
- 1.0: Explicitly printed on the menu — no interpretation needed
- 0.8-0.95: Clearly visible and unambiguous
- 0.6-0.8: Inferred from context (e.g., region from producer name, color from grape)
- 0.4-0.6: Best guess with meaningful uncertainty
- Below 0.4: Very uncertain — still return but flag low confidence

Source values:
- "visible": Information is printed on the menu
- "inferred": Claude's best estimate from wine knowledge or context

Return ONLY valid JSON in this exact format:
{
  "wines": [
    {
      "wine_name":      {"value": "Château Margaux", "confidence": 0.99, "source": "visible"},
      "producer":       {"value": "Château Margaux", "confidence": 0.99, "source": "visible"},
      "vintage":        {"value": 2018,              "confidence": 0.99, "source": "visible"},
      "primary_type":   {"value": "red",             "confidence": 0.95, "source": "inferred"},
      "color":          {"value": "red",             "confidence": 0.95, "source": "inferred"},
      "country":        {"value": "France",          "confidence": 0.92, "source": "inferred"},
      "region":         {"value": "Bordeaux",        "confidence": 0.92, "source": "inferred"},
      "sub_region":     {"value": "Margaux",         "confidence": 0.88, "source": "inferred"},
      "appellation":    {"value": "Margaux AOC",     "confidence": 0.85, "source": "inferred"},
      "grape_variety":  {"value": "Cabernet Sauvignon blend", "confidence": 0.80, "source": "inferred"},
      "alcohol_pct":    {"value": null,              "confidence": 0.0,  "source": "visible"},
      "price_bottle":   {"value": 285.00,            "confidence": 0.99, "source": "visible"},
      "price_glass":    {"value": null,              "confidence": 0.99, "source": "visible"},
      "tasting_notes":  {"value": null,              "confidence": 0.99, "source": "visible"},
      "description":    {"value": null,              "confidence": 0.99, "source": "visible"},
      "section_name":   {"value": "Red Bordeaux",   "confidence": 0.99, "source": "visible"},
      "bin_number":     {"value": null,              "confidence": 0.99, "source": "visible"},
      "sweetness_level":{"value": "dry",             "confidence": 0.75, "source": "inferred"}
    }
  ],
  "page_notes": "brief note about this page",
  "total_wines_extracted": 1
}"""


# =============================================================================
# DATA MODELS
# =============================================================================


class ClaudePageResult(BaseModel):
    """Result for a single extracted page."""

    page_index: int
    wines: List[Dict[str, Any]] = Field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    parse_error: bool = False
    output_tokens_hit_limit: bool = False
    error: Optional[str] = None  # set if Claude API call itself failed


class ClaudeExtractionResult(BaseModel):
    """Aggregated result for a full menu extraction request."""

    scan_session_id: str
    wines: List[Dict[str, Any]] = Field(default_factory=list)
    total_wines: int = 0
    pages_processed: int = 0
    total_cost_usd: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    needs_review_count: int = 0
    page_errors: List[Dict[str, Any]] = Field(default_factory=list)
    extraction_method: str = "claude_vision"
    model_used: str = MODEL_ID


# =============================================================================
# HELPERS
# =============================================================================

# =============================================================================
# PRODUCER NORMALIZER
# =============================================================================

# Common wine region/country tokens that leak into the producer field.
# Lower-cased for matching; producer casing is preserved.
_REGION_TOKENS: set = {
    "loire valley",
    "loire",
    "bordeaux",
    "burgundy",
    "bourgogne",
    "champagne",
    "rhône",
    "rhone",
    "alsace",
    "provence",
    "languedoc",
    "roussillon",
    "tuscany",
    "toscana",
    "piedmont",
    "piemonte",
    "veneto",
    "sicily",
    "sicilia",
    "rioja",
    "ribera del duero",
    "priorat",
    "rias baixas",
    "galicia",
    "napa valley",
    "napa",
    "sonoma",
    "paso robles",
    "willamette valley",
    "mendoza",
    "malbec country",
    "barossa valley",
    "barossa",
    "mclaren vale",
    "coonawarra",
    "yarra valley",
    "marlborough",
    "hawke's bay",
    "central otago",
    "mosel",
    "rheingau",
    "rheinhessen",
    "pfalz",
    "franken",
    "douro",
    "alentejo",
    "vinho verde",
    "tokaj",
    "eger",
}

_COUNTRY_TOKENS: set = {
    "france",
    "italy",
    "spain",
    "portugal",
    "germany",
    "austria",
    "switzerland",
    "usa",
    "united states",
    "argentina",
    "chile",
    "australia",
    "new zealand",
    "south africa",
    "greece",
    "hungary",
    "croatia",
    "slovenia",
}

_YEAR_RE = re.compile(r"^\s*(\d{4})\s+(.+)$", re.DOTALL)


def _strip_field_value(wine_entry: object) -> str | None:
    """Extract plain string value from a {value, confidence, source} entry or raw string."""
    if wine_entry is None:
        return None
    if isinstance(wine_entry, dict):
        return wine_entry.get("value")
    return wine_entry


def normalize_wine_fields(wine: dict) -> dict:
    """
    Deterministic post-extraction cleanup for common Claude field-bleeding errors:

    1. Vintage prefix in producer: "2022 Domaine X" → vintage=2022, producer="Domaine X"
    2. Region/country suffix in producer: "Domaine X Loire Valley" → producer="Domaine X"

    Works on both raw {value, confidence, source} dict entries and plain string values.
    Preserves existing vintage if already set.
    """

    def _get(field: str):
        e = wine.get(field)
        if isinstance(e, dict):
            return e.get("value")
        return e

    def _set_value(
        field: str, new_val, confidence: float = 0.90, source: str = "inferred"
    ):
        existing = wine.get(field)
        if isinstance(existing, dict):
            existing["value"] = new_val
        else:
            wine[field] = new_val

    producer = _get("producer")
    if not producer or not isinstance(producer, str):
        return wine

    cleaned = producer.strip()

    # Rule 1: strip leading vintage year if producer starts with YYYY
    m = _YEAR_RE.match(cleaned)
    if m:
        year_str, remainder = m.group(1), m.group(2).strip()
        # Only move year to vintage if vintage is unset or null
        existing_vintage = _get("vintage")
        if not existing_vintage:
            _set_value("vintage", int(year_str))
        cleaned = remainder

    # Rule 2: strip trailing region/country tokens (longest match first)
    lower_cleaned = cleaned.lower()
    changed = True
    while changed:
        changed = False
        for token in sorted(_REGION_TOKENS | _COUNTRY_TOKENS, key=len, reverse=True):
            if lower_cleaned.endswith(" " + token) or lower_cleaned == token:
                # Strip token from end and trim punctuation/whitespace
                trimmed = cleaned[: len(cleaned) - len(token)].rstrip(" ,–-")
                if trimmed:
                    cleaned = trimmed
                    lower_cleaned = cleaned.lower()
                    changed = True
                    break

    if cleaned != producer.strip():
        _set_value("producer", cleaned)

    return wine


def parse_json_response(raw_text: str) -> Tuple[dict, bool]:
    """
    Multi-strategy JSON extractor. Handles markdown fences and partial/truncated JSON.
    Returns (parsed_dict, parse_error_bool).
    Claude occasionally wraps output in ```json ... ``` even when told not to.
    When Claude hits max_tokens the JSON is cut mid-stream — we salvage all complete
    wine objects found before the truncation point.
    """
    # Strip markdown fences (with or without closing fence — handles truncation)
    text = raw_text.strip()
    text = re.sub(r"^```json?\s*", "", text)
    text = re.sub(r"```\s*$", "", text)
    text = text.strip()

    # Strategy 1: clean complete JSON
    try:
        return json.loads(text), False
    except json.JSONDecodeError:
        pass

    # Strategy 2: find outermost complete { ... }
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group(0)), False
        except json.JSONDecodeError:
            pass

    # Strategy 3: truncated JSON recovery — find all complete wine objects
    # Claude hits max_tokens mid-JSON; the array is cut off. Extract every
    # complete {...} block from inside the "wines" array.
    wine_objects = []
    # Find the start of the wines array
    wines_start = text.find('"wines"')
    if wines_start != -1:
        bracket_start = text.find("[", wines_start)
        if bracket_start != -1:
            # Walk character by character to find each complete top-level wine object
            depth = 0
            obj_start = None
            for i, ch in enumerate(text[bracket_start:], bracket_start):
                if ch == "{":
                    if depth == 0:
                        obj_start = i
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0 and obj_start is not None:
                        try:
                            wine = json.loads(text[obj_start : i + 1])
                            wine_objects.append(wine)
                        except json.JSONDecodeError:
                            pass
                        obj_start = None

    if wine_objects:
        logger.warning(
            f"Truncated JSON recovery: salvaged {len(wine_objects)} complete wine objects "
            f"from partial response (hit max_tokens)"
        )
        return {
            "wines": wine_objects,
            "page_notes": "partial — response truncated at token limit",
        }, False

    return {"wines": [], "parse_error": True}, True


def compute_completeness(wine: dict) -> float:
    """
    Returns 0.0–1.0 completeness score for one wine.
    Scored over COMPLETENESS_FIELDS = [wine_name, vintage, price_bottle, region, country, section_name].
    """
    filled = sum(
        1 for f in COMPLETENESS_FIELDS if wine.get(f) is not None and wine.get(f) != ""
    )
    return round(filled / len(COMPLETENESS_FIELDS), 3)


def get_media_type(b64_header: Optional[str] = None) -> str:
    """Infer media type from base64 prefix or default to image/png."""
    # PNG magic bytes in base64 start with 'iVBOR'
    # JPEG magic bytes start with '/9j/'
    if b64_header:
        if b64_header.startswith("/9j/"):
            return "image/jpeg"
        if b64_header.startswith("iVBOR"):
            return "image/png"
    return "image/png"


# =============================================================================
# EXTRACTOR CLASS
# =============================================================================


class ClaudeVisionExtractor:
    """
    Async Claude Vision extraction service.
    Mirrors VLMExtractionService singleton/lazy-init pattern.

    Usage:
        extractor = ClaudeVisionExtractor()
        result = await extractor.extract_menu(["base64page1", "base64page2"])
    """

    def __init__(self):
        self._client: Optional[anthropic.AsyncAnthropic] = None
        self._semaphore: Optional[asyncio.Semaphore] = None

    def _get_client(self) -> anthropic.AsyncAnthropic:
        """Lazy-init client. Called inside async context only."""
        if self._client is None:
            # Accept both naming conventions — ANTHROPIC_API_KEY is the standard name
            api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY not set in environment")
            self._client = anthropic.AsyncAnthropic(api_key=api_key)
        return self._client

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Lazy-init semaphore. Must be created inside async context."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
        return self._semaphore

    async def extract_page(
        self,
        b64_image: str,
        page_index: int,
        media_type: Optional[str] = None,
    ) -> ClaudePageResult:
        """
        Send one page image to Claude Vision. Returns wines + cost.
        On Claude API error: returns ClaudePageResult with error set (does not raise).
        """
        if media_type is None:
            media_type = get_media_type(b64_image[:10] if b64_image else None)

        try:
            async with self._get_semaphore():
                response = await self._get_client().messages.create(
                    model=MODEL_ID,
                    max_tokens=MAX_TOKENS,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": media_type,
                                        "data": b64_image,
                                    },
                                },
                                {"type": "text", "text": EXTRACTION_PROMPT},
                            ],
                        }
                    ],
                )
        except Exception as e:
            logger.error(f"Claude Vision API error on page {page_index}: {e}")
            return ClaudePageResult(page_index=page_index, error=str(e))

        # IMPORTANT: use response.content[0].text — NOT response.text (that's Gemini)
        raw_text = response.content[0].text
        parsed, parse_error = parse_json_response(raw_text)

        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost_usd = (input_tokens * PRICE_INPUT_PER_M / 1_000_000) + (
            output_tokens * PRICE_OUTPUT_PER_M / 1_000_000
        )

        # Log spend — non-fatal, never raises
        try:
            get_spend_logger().log(
                provider="anthropic",
                model=MODEL_ID,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                agent_fallback="claude_vision_extractor",
                task_type="menu_page_extraction",
                choice=f"wines:{len(parsed.get('wines', []))}",
                outcome="partial" if parse_error else "success",  # call-level
                context={
                    "page_index": page_index,
                    "parse_error": bool(parse_error),
                },
            )
        except Exception:
            pass

        # Annotate wines with field_confidence JSONB + completeness + needs_review
        wines = parsed.get("wines", [])
        wines = [normalize_wine_fields(w) for w in wines]
        for wine in wines:
            # Build per-field confidence JSONB (Phase 7 FCONF-03)
            fc = build_field_confidence(wine, source="visible")
            wine["field_confidence"] = fc
            # Compute completeness from FC (replaces flat-field scoring for FC-aware wines)
            fc_completeness = compute_completeness_from_fc(fc, fields=VISION_FIELDS)
            # Fall back to legacy scoring for any wine without FC structure
            legacy_score = compute_completeness(wine)
            score = fc_completeness if fc else legacy_score
            wine["completeness_score"] = score
            wine["needs_review"] = score < COMPLETENESS_THRESHOLD

        return ClaudePageResult(
            page_index=page_index,
            wines=wines,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            parse_error=parse_error,
            output_tokens_hit_limit=output_tokens >= (MAX_TOKENS - 100),
        )

    async def extract_menu(
        self,
        pages: List[str],
        media_type: Optional[str] = None,
    ) -> ClaudeExtractionResult:
        """
        Parallel extraction of all menu pages.
        Returns aggregated ClaudeExtractionResult.

        Per-page errors: marked in page_errors, other pages continue.
        All pages fail: raises RuntimeError (caller converts to HTTP 503).
        """
        scan_session_id = str(uuid.uuid4())

        tasks = [self.extract_page(b64, i, media_type) for i, b64 in enumerate(pages)]
        page_results = await asyncio.gather(*tasks, return_exceptions=True)

        all_wines: List[Dict[str, Any]] = []
        page_errors: List[Dict[str, Any]] = []
        total_cost = 0.0
        total_input = 0
        total_output = 0

        for pr in page_results:
            if isinstance(pr, Exception):
                page_errors.append({"page": "unknown", "error": str(pr)})
                continue
            if pr.error:
                page_errors.append({"page": pr.page_index, "error": pr.error})
                continue
            all_wines.extend(pr.wines)
            total_cost += pr.cost_usd
            total_input += pr.input_tokens
            total_output += pr.output_tokens

        if not all_wines and page_errors:
            raise RuntimeError(f"All {len(pages)} pages failed extraction")

        needs_review_count = sum(1 for w in all_wines if w.get("needs_review", False))

        return ClaudeExtractionResult(
            scan_session_id=scan_session_id,
            wines=all_wines,
            total_wines=len(all_wines),
            pages_processed=len(pages) - len(page_errors),
            total_cost_usd=round(total_cost, 6),
            total_input_tokens=total_input,
            total_output_tokens=total_output,
            needs_review_count=needs_review_count,
            page_errors=page_errors,
        )

    async def extract_pdf(self, pdf_bytes: bytes) -> ClaudeExtractionResult:
        """
        Send a full PDF to Claude via the native Anthropic document content block.
        Single API call covers all pages — Claude handles multi-page PDFs natively.
        Returns ClaudeExtractionResult with extraction_method="claude_pdf".
        source_type tag in JSONL: "pdf_vision_fallback" (set by caller in web_crawler.py).
        """
        scan_session_id = str(uuid.uuid4())
        b64_pdf = base64.standard_b64encode(pdf_bytes).decode("utf-8")

        try:
            async with self._get_semaphore():
                response = await self._get_client().messages.create(
                    model=MODEL_ID,
                    max_tokens=MAX_TOKENS,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "document",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "application/pdf",
                                        "data": b64_pdf,
                                    },
                                },
                                {"type": "text", "text": EXTRACTION_PROMPT},
                            ],
                        }
                    ],
                )
        except Exception as e:
            logger.error(f"Claude Vision PDF API error: {e}")
            return ClaudeExtractionResult(
                scan_session_id=scan_session_id,
                page_errors=[{"page": "pdf", "error": str(e)}],
            )

        raw_text = response.content[0].text
        logger.info(f"Claude PDF raw response (first 800 chars): {raw_text[:800]!r}")
        parsed, parse_error = parse_json_response(raw_text)
        logger.info(
            f"Claude PDF parse_error={parse_error}, wines_found={len(parsed.get('wines', []))}"
        )
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost_usd = (input_tokens * PRICE_INPUT_PER_M / 1_000_000) + (
            output_tokens * PRICE_OUTPUT_PER_M / 1_000_000
        )
        logger.info(
            f"Claude PDF tokens: input={input_tokens} output={output_tokens} cost=${cost_usd:.4f}"
        )

        try:
            get_spend_logger().log(
                provider="anthropic",
                model=MODEL_ID,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                agent_fallback="claude_vision_extractor",
                task_type="pdf_extraction",
                choice=f"wines:{len(parsed.get('wines', []))}",
                outcome="partial" if parse_error else "success",  # call-level
                context={"parse_error": bool(parse_error)},
            )
        except Exception:
            pass

        wines = parsed.get("wines", [])
        wines = [normalize_wine_fields(w) for w in wines]
        for wine in wines:
            fc = build_field_confidence(wine, source="visible")
            wine["field_confidence"] = fc
            fc_completeness = compute_completeness_from_fc(fc, fields=VISION_FIELDS)
            legacy_score = compute_completeness(wine)
            score = fc_completeness if fc else legacy_score
            wine["completeness_score"] = score
            wine["needs_review"] = score < COMPLETENESS_THRESHOLD

        return ClaudeExtractionResult(
            scan_session_id=scan_session_id,
            wines=wines,
            total_wines=len(wines),
            pages_processed=1,
            total_cost_usd=round(cost_usd, 6),
            total_input_tokens=input_tokens,
            total_output_tokens=output_tokens,
            needs_review_count=sum(1 for w in wines if w.get("needs_review", False)),
            page_errors=(
                [{"page": "pdf", "error": "JSON parse error on PDF response"}]
                if parse_error
                else []
            ),
            extraction_method="claude_pdf",
        )


# Module-level singleton (mirrors VLMExtractionService pattern)
_extractor: Optional[ClaudeVisionExtractor] = None


def get_claude_vision_extractor() -> ClaudeVisionExtractor:
    """Return module-level singleton extractor."""
    global _extractor
    if _extractor is None:
        _extractor = ClaudeVisionExtractor()
    return _extractor
