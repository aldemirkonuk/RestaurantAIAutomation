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
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import anthropic
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# =============================================================================
# CONSTANTS
# =============================================================================

MODEL_ID = "claude-haiku-4-5-20251001"
MAX_TOKENS = 8192          # 4096 truncates dense pages — proven in benchmark
CONCURRENCY_LIMIT = 5      # asyncio.Semaphore cap; prevents Anthropic rate limit
PRICE_INPUT_PER_M = 0.80   # USD per 1M input tokens (Haiku, 2026-04-02)
PRICE_OUTPUT_PER_M = 4.00  # USD per 1M output tokens

# Fields used for completeness scoring (per CONTEXT.md)
COMPLETENESS_FIELDS = ["wine_name", "vintage", "price_bottle", "region", "country", "section_name"]
COMPLETENESS_THRESHOLD = 0.5  # < 0.5 → needs_review (strict less-than per CONTEXT.md)

# Proven extraction prompt from benchmark (91–100% completeness on 8 Chicago menus)
EXTRACTION_PROMPT = """You are a wine menu extraction expert. Extract ALL wines from this menu image into structured JSON.

For each wine, extract these fields:
- wine_name: Full name of the wine (producer + cuvée)
- vintage: Year as integer (null if NV or not shown)
- price_bottle: Bottle price as float (null if not shown)
- price_glass: Glass price as float (null if not shown)
- region: Wine region (e.g., "Bordeaux", "Napa Valley")
- country: Country of origin
- grape_variety: Grape/blend if stated
- section_name: The section/category this wine appears under
- bin_number: Bin/item number if shown

Return ONLY valid JSON in this exact format:
{
  "wines": [...],
  "page_notes": "brief note about this page",
  "total_wines_extracted": 0
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

def parse_json_response(raw_text: str) -> Tuple[dict, bool]:
    """
    Multi-strategy JSON extractor. Handles markdown fences and partial JSON.
    Returns (parsed_dict, parse_error_bool).
    Claude occasionally wraps output in ```json ... ``` even when told not to.
    """
    # Strategy 1 & 2: strip ```json ... ``` or ``` ... ```
    for pattern in [r"```json\s*([\s\S]*?)```", r"```\s*([\s\S]*?)```"]:
        m = re.search(pattern, raw_text)
        if m:
            try:
                return json.loads(m.group(1).strip()), False
            except json.JSONDecodeError:
                pass
    # Strategy 3: find outermost { ... }
    m = re.search(r"\{[\s\S]*\}", raw_text)
    if m:
        try:
            return json.loads(m.group(0)), False
        except json.JSONDecodeError:
            pass
    # Strategy 4: raw parse
    try:
        return json.loads(raw_text.strip()), False
    except json.JSONDecodeError:
        return {"wines": [], "parse_error": True}, True


def compute_completeness(wine: dict) -> float:
    """
    Returns 0.0–1.0 completeness score for one wine.
    Scored over COMPLETENESS_FIELDS = [wine_name, vintage, price_bottle, region, country, section_name].
    """
    filled = sum(
        1 for f in COMPLETENESS_FIELDS
        if wine.get(f) is not None and wine.get(f) != ""
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
            api_key = os.getenv("CLAUDE_API_KEY")
            if not api_key:
                raise RuntimeError("CLAUDE_API_KEY not set in environment")
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
                    messages=[{
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
                    }],
                )
        except Exception as e:
            logger.error(f"Claude Vision API error on page {page_index}: {e}")
            return ClaudePageResult(page_index=page_index, error=str(e))

        # IMPORTANT: use response.content[0].text — NOT response.text (that's Gemini)
        raw_text = response.content[0].text
        parsed, parse_error = parse_json_response(raw_text)

        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost_usd = (input_tokens * PRICE_INPUT_PER_M / 1_000_000) + (output_tokens * PRICE_OUTPUT_PER_M / 1_000_000)

        # Annotate wines with completeness and needs_review
        wines = parsed.get("wines", [])
        for wine in wines:
            score = compute_completeness(wine)
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

        tasks = [
            self.extract_page(b64, i, media_type)
            for i, b64 in enumerate(pages)
        ]
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


# Module-level singleton (mirrors VLMExtractionService pattern)
_extractor: Optional[ClaudeVisionExtractor] = None


def get_claude_vision_extractor() -> ClaudeVisionExtractor:
    """Return module-level singleton extractor."""
    global _extractor
    if _extractor is None:
        _extractor = ClaudeVisionExtractor()
    return _extractor
