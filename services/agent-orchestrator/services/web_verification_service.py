"""
Web Verification Service
========================
Phase 8: per-field concordance engine + Gemini Flash structured extraction
+ producer knowledge graph operations.

Pipeline per wine:
  1. lookup_producer(normalized_name) → instant enrichment if known (skip Serper)
  2. parse_search_results(snippets) → WineVerificationResult via Gemini 2.5 Flash
  3. For each web field: check_concordance() → apply_concordance_result()
  4. upsert_producer() → update knowledge graph

Key invariant (WSRCH-06): verification_status is the 4th key INSIDE each
field_confidence JSONB entry: {value, confidence, source, verification_status}
It is NOT a separate column. merge_field_confidence() propagates it correctly.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google import genai
from pydantic import BaseModel, Field
from supabase import create_client

from config.settings import get_settings
from services.field_confidence import merge_field_confidence
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Region alias table — prevents false contradictions from name variants
# (Pitfall 1 from RESEARCH.md)
# Canonical form on right side; both directions mapped to canonical.
# ---------------------------------------------------------------------------
REGION_ALIASES: dict[str, str] = {
    "burgundy": "bourgogne",
    "bourgogne": "bourgogne",
    "champagne": "champagne",
    "bordeaux": "bordeaux",
    "rhone valley": "rhone",
    "rhône valley": "rhone",
    "rhone": "rhone",
    "alsace": "alsace",
    "loire valley": "loire",
    "loire": "loire",
    "tuscany": "toscana",
    "toscana": "toscana",
    "piedmont": "piemonte",
    "piemonte": "piemonte",
    "napa valley": "napa valley",
    "napa": "napa valley",
    "sonoma": "sonoma county",
    "sonoma county": "sonoma county",
    "rioja": "rioja",
    "la rioja": "rioja",
    "priorat": "priorat",
    "priorato": "priorat",
    "barossa": "barossa valley",
    "barossa valley": "barossa valley",
    "mclaren vale": "mclaren vale",
}

# Color synonym mapping — prevents false contradictions from descriptive colors
# (e.g., "deep garnet" vs "red", "ruby" vs "red", "pale yellow" vs "white")
COLOR_SYNONYMS: dict[str, str] = {
    # Red variants
    "red": "red",
    "ruby": "red",
    "garnet": "red",
    "deep garnet": "red",
    "crimson": "red",
    "burgundy": "red",
    "cherry": "red",
    "brick red": "red",
    # White variants
    "white": "white",
    "pale yellow": "white",
    "golden": "white",
    "straw": "white",
    "lemon": "white",
    "greenish": "white",
    # Rosé variants
    "rosé": "rosé",
    "rose": "rosé",
    "pink": "rosé",
    "salmon": "rosé",
    # Amber/Orange
    "amber": "amber",
    "orange": "orange",
}

# Numeric fields that must be compared as floats, not strings (Pitfall 6)
NUMERIC_FIELDS = {"alcohol_pct", "price_bottle", "price_glass"}


# ---------------------------------------------------------------------------
# Pydantic schema for Gemini 2.5 Flash structured extraction (WSRCH-02)
# ---------------------------------------------------------------------------


class WineVerificationResult(BaseModel):
    """
    Structured extraction result from Gemini 2.5 Flash parsing Serper snippets.
    All fields Optional — web sources may not mention every field.
    source_confidence is Gemini's self-reported confidence in web source quality (0.0-1.0).
    """

    producer: Optional[str] = Field(None, description="Producer/winery name")
    region: Optional[str] = Field(
        None, description="Wine region (e.g. Burgundy, Napa Valley)"
    )
    sub_region: Optional[str] = Field(
        None, description="Sub-region (e.g. Pauillac, Rutherford)"
    )
    appellation: Optional[str] = Field(None, description="AOC/DOC/AVA/GI appellation")
    country: Optional[str] = Field(None, description="Country of origin")
    grape_variety: Optional[str] = Field(
        None, description="Primary grape variety or blend"
    )
    color: Optional[str] = Field(None, description="red, white, rosé, or amber")
    primary_type: Optional[str] = Field(
        None,
        description="red, white, rosé, sparkling, dessert, fortified, or orange",
    )
    sweetness_level: Optional[str] = Field(
        None,
        description="dry, off-dry, semi-sweet, sweet, brut, or extra-dry",
    )
    alcohol_pct: Optional[float] = Field(None, description="ABV as float, e.g. 13.5")
    tasting_notes: Optional[str] = Field(
        None, description="Aroma and palate descriptors"
    )
    # Producer knowledge graph fields
    founding_year: Optional[int] = Field(None, description="Producer founding year")
    winemaker_name: Optional[str] = Field(None, description="Head winemaker name")
    website_url: Optional[str] = Field(None, description="Producer website URL")
    certifications_organic: Optional[bool] = Field(
        None, description="Organic certified?"
    )
    certifications_biodynamic: Optional[bool] = Field(
        None, description="Biodynamic certified?"
    )
    certifications_sustainable: Optional[bool] = Field(
        None, description="Sustainable certified?"
    )
    # Source confidence (Gemini's assessment of snippet quality)
    source_confidence: Optional[float] = Field(
        None,
        description="Confidence 0.0-1.0 in quality of web source data",
    )


async def parse_search_results(
    snippets: List[Dict[str, str]],
    wine_name: str,
    producer: Optional[str] = None,
    vintage: Optional[str] = None,
) -> Optional[WineVerificationResult]:
    """
    Send Serper search snippets to Gemini 2.5 Flash for structured extraction.

    Uses google-genai SDK (new SDK, v1.66.0) with response_mime_type="application/json"
    and WineVerificationResult Pydantic schema for reliable structured output.

    IMPORTANT: Uses `from google import genai` (new SDK), NOT `google.generativeai`
    (deprecated). Both are installed; only the new SDK supports response_mime_type.

    Args:
        snippets: List of Serper organic results (title + snippet text).
        wine_name: Wine name for context.
        producer: Producer name for context (optional).
        vintage: Vintage year for context (optional).

    Returns:
        WineVerificationResult if extraction succeeded, None if Gemini returned
        unparseable output or if no API key configured.
    """
    settings = get_settings()
    if not settings.google_api_key:
        logger.warning("parse_search_results: GEMINI_API_KEY not configured — skipping")
        return None
    if not snippets:
        logger.debug("parse_search_results: no snippets provided — skipping")
        return None

    # Build prompt from snippets
    snippets_text = "\n\n".join(
        f"Source {i+1} ({s.get('link', 'unknown')}):\n"
        f"Title: {s.get('title', '')}\n"
        f"Snippet: {s.get('snippet', '')}"
        for i, s in enumerate(snippets[:5])  # cap at 5 per WSRCH-01
    )

    context_parts = [f"Wine name: {wine_name}"]
    if producer:
        context_parts.append(f"Producer: {producer}")
    if vintage:
        context_parts.append(f"Vintage: {vintage}")
    context_str = "\n".join(context_parts)

    prompt = (
        f"You are a wine data extraction expert. Based on the web search results below,\n"
        f"extract verified information about this wine.\n\n"
        f"Wine context:\n{context_str}\n\n"
        f"Web search results:\n{snippets_text}\n\n"
        f"Extract ONLY information explicitly stated in the snippets. "
        f"Do not infer or guess. Set source_confidence to 0.9+ only when multiple "
        f"authoritative sources (Wine-Searcher, Vivino, producer website) agree. "
        f"Use 0.6-0.8 for single source. Use < 0.5 if information is unclear or conflicting."
    )

    try:
        client = genai.Client(api_key=settings.google_api_key)
        _t0 = time.perf_counter()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_json_schema": WineVerificationResult.model_json_schema(),
            },
        )
    except Exception as exc:
        logger.warning("parse_search_results: Gemini call failed: %s", exc)
        return None

    # Log Gemini Flash spend (non-fatal per pattern from haiku_enrichment_service.py)
    try:
        usage = getattr(response, "usage_metadata", None)
        if usage:
            _in = getattr(usage, "prompt_token_count", 0) or 0
            _out = getattr(usage, "candidates_token_count", 0) or 0
            # Gemini 2.5 Flash pricing: ~$0.075/$0.30 per 1M tokens (input/output)
            _cost = (_in * 0.075 / 1_000_000) + (_out * 0.30 / 1_000_000)
            get_spend_logger().log(
                provider="google",
                model="gemini-2.5-flash",
                input_tokens=_in,
                output_tokens=_out,
                cost_usd=_cost,
                agent_fallback="web_verification_service",
                task_type="snippet_parse",
                outcome="success",  # call-level: response returned
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                context={"wine_name": str(wine_name)[:120]},
            )
    except Exception:
        pass

    try:
        result = WineVerificationResult.model_validate_json(response.text)
        logger.debug(
            "parse_search_results: extracted %d non-null fields for wine=%r",
            sum(1 for v in result.model_dump().values() if v is not None),
            wine_name,
        )
        return result
    except Exception as exc:
        logger.warning(
            "parse_search_results: failed to parse Gemini response for wine=%r: %s",
            wine_name,
            exc,
        )
        return None


# ---------------------------------------------------------------------------
# Concordance engine (WSRCH-03, WSRCH-06)
# ---------------------------------------------------------------------------


def _normalize_for_compare(value: str, field_name: str) -> str:
    """Lowercase + strip for concordance comparison. Apply alias for region/color fields."""
    normalized = str(value).lower().strip()
    if field_name in ("region", "sub_region", "appellation"):
        return REGION_ALIASES.get(normalized, normalized)
    if field_name == "color":
        return COLOR_SYNONYMS.get(normalized, normalized)
    return normalized


def check_concordance(
    field_name: str,
    existing_entry: Dict[str, Any],
    web_value: Any,
) -> str:
    """
    Compare a web-extracted field value against the existing field_confidence entry.

    Returns:
        "concordance"  — web value matches existing (confidence boost to 0.95+)
        "web_data_more_complete" — web value is a superset of existing (e.g., blend breakdown)
        "contradiction" — web value differs from existing (flag for human review)
        "new_data"     — field not yet in field_confidence (add with web_search source)

    Numeric fields (alcohol_pct, price_bottle, price_glass) use float comparison
    with 0.01 tolerance to handle "13.5" vs "13.50" representation differences
    (Pitfall 6, RESEARCH.md).

    Region/sub_region/appellation fields apply REGION_ALIASES before comparing
    to prevent false contradictions from "Burgundy" vs "Bourgogne" (Pitfall 1).
    """
    existing_value = existing_entry.get("value")
    if existing_value is None:
        return "new_data"

    # Numeric fields: float comparison with tolerance
    if field_name in NUMERIC_FIELDS:
        try:
            existing_float = float(existing_value)
            web_float = float(web_value)
            if abs(existing_float - web_float) < 0.01:
                return "concordance"
            return "contradiction"
        except (TypeError, ValueError):
            pass  # fall through to string comparison

    # Grape variety substring matching: if existing value is a substring of web value
    # (case-insensitive), treat as "web_data_more_complete" instead of contradiction.
    # Example: existing="Cabernet Sauvignon", web="87% Cabernet Sauvignon, 8% Merlot..."
    # → web data is more complete (blend breakdown), not a contradiction.
    if field_name == "grape_variety":
        norm_existing = str(existing_value).lower().strip()
        norm_web = str(web_value).lower().strip()
        if norm_existing in norm_web:
            return "web_data_more_complete"
        if norm_web in norm_existing:
            # Edge case: web data is less specific (e.g., "Cabernet" vs "Cabernet Sauvignon")
            # Still treat as concordance since it's not contradictory
            return "concordance"

    # String fields: normalized comparison
    norm_existing = _normalize_for_compare(str(existing_value), field_name)
    norm_web = _normalize_for_compare(str(web_value), field_name)
    if norm_existing == norm_web:
        return "concordance"
    return "contradiction"


def apply_concordance_result(
    existing_fc: Dict[str, Dict[str, Any]],
    field_name: str,
    web_value: Any,
    web_confidence: float,
    concordance: str,
) -> Dict[str, Dict[str, Any]]:
    """
    Update field_confidence JSONB based on concordance result.

    Concordance outcomes (WSRCH-03):
    - "concordance":  boost confidence to max(0.95, web_confidence),
                      set verification_status="web_verified",
                      keep existing value (already correct)
    - "web_data_more_complete": replace with more complete web value,
                      boost confidence to max(0.90, web_confidence),
                      set verification_status="web_enriched"
    - "contradiction": do NOT change value or confidence,
                       set verification_status="contradicted",
                       add contradicted_value=web_value for human review
    - "new_data":      add new entry with value=web_value,
                       confidence=web_confidence, source="web_search",
                       verification_status="web_verified"

    Uses merge_field_confidence(overwrite_lower=True) which correctly handles
    the confidence boost for concordance case (new 0.95 >= existing 0.85 → overwrites).

    Args:
        existing_fc:    Current field_confidence JSONB dict for the wine record.
        field_name:     Field being updated (e.g. "region", "grape_variety").
        web_value:      Value extracted from web search.
        web_confidence: Confidence from WineVerificationResult.source_confidence (0.0-1.0).
        concordance:    Result from check_concordance(): "concordance"|"web_data_more_complete"|"contradiction"|"new_data"

    Returns:
        Updated field_confidence dict (merged, not mutated in place).
    """
    if concordance == "concordance":
        existing_entry = existing_fc.get(field_name, {})
        new_entry: Dict[str, Any] = {
            "value": existing_entry.get("value", web_value),  # keep original value
            "confidence": max(0.95, web_confidence),  # WSRCH-03: boost to 0.95+
            "source": "web_verified",
            "verification_status": "web_verified",
        }
    elif concordance == "web_data_more_complete":
        # Web data is more complete than existing (e.g., blend breakdown vs single grape).
        # Replace existing value with more complete web value, boost confidence to 0.90+,
        # set verification_status="web_enriched" to distinguish from exact concordance.
        new_entry = {
            "value": web_value,  # use more complete web value
            "confidence": max(0.90, web_confidence),
            "source": "web_enriched",
            "verification_status": "web_enriched",
        }
    elif concordance == "contradiction":
        existing_entry = existing_fc.get(field_name, {})
        # Keep existing value and confidence — just flag the contradiction
        new_entry = {
            **existing_entry,
            "verification_status": "contradicted",
            "contradicted_value": web_value,  # show both for human reviewer
        }
        # Bypass merge_field_confidence intentionally: confidence is unchanged on
        # contradiction, only verification_status="contradicted" is added. Calling
        # merge_field_confidence(overwrite_lower=False) would be a no-op here since
        # there is no new confidence value to compare — direct dict assignment is clearer.
        merged = dict(existing_fc)
        merged[field_name] = new_entry
        return merged
    else:  # new_data
        new_entry = {
            "value": web_value,
            "confidence": web_confidence,
            "source": "web_search",
            "verification_status": "web_verified",
        }

    return merge_field_confidence(
        existing_fc, {field_name: new_entry}, overwrite_lower=True
    )


def apply_producer_graph_enrichment(
    existing_fc: Dict[str, Dict[str, Any]],
    producer_row: Dict[str, Any],
) -> Dict[str, Dict[str, Any]]:
    """
    Apply instant enrichment from the producers knowledge graph (WSRCH-05).

    Fields populated from producer graph get:
      confidence=0.92, source="producer_graph", verification_status="producer_graph"

    Only populates fields that are missing (None value) or have low confidence < 0.7
    in existing_fc — never downgrades an existing high-confidence field.

    Args:
        existing_fc:   Current field_confidence JSONB dict.
        producer_row:  Row from producers table (dict with country, region, etc.)

    Returns:
        Updated field_confidence dict.
    """
    producer_graph_fields = {
        "country": producer_row.get("country"),
        "region": producer_row.get("region"),
        "sub_region": producer_row.get("sub_region"),
        "appellation": producer_row.get("appellation"),
    }
    graph_fc: Dict[str, Dict[str, Any]] = {}
    for field_name, value in producer_graph_fields.items():
        if value is None:
            continue
        existing_entry = existing_fc.get(field_name, {})
        existing_conf = float(existing_entry.get("confidence", 0.0))
        # Only supply from graph if field is absent or existing confidence is low
        if existing_conf < 0.7:
            graph_fc[field_name] = {
                "value": value,
                "confidence": 0.92,
                "source": "producer_graph",
                "verification_status": "producer_graph",
            }
    return merge_field_confidence(existing_fc, graph_fc, overwrite_lower=True)


# ---------------------------------------------------------------------------
# Producer knowledge graph operations (WSRCH-04, WSRCH-05)
# ---------------------------------------------------------------------------


def lookup_producer(normalized_name: str) -> Optional[Dict[str, Any]]:
    """
    Check producers table for a known producer by normalized_name.
    Runs BEFORE web search (WSRCH-05) — known producer = instant enrichment.

    Returns:
        Producer row dict if found, None if not in graph or DB unavailable.
    """
    if not normalized_name:
        return None
    settings = get_settings()
    try:
        supabase = create_client(settings.supabase_url, settings.supabase_key)
        resp = (
            supabase.table("producers")
            .select("*")
            .eq("normalized_name", normalized_name)
            .maybe_single()
            .execute()
        )
        return resp.data or None
    except Exception as exc:
        logger.warning(
            "lookup_producer: DB error for %r (fail open): %s", normalized_name, exc
        )
        return None


def upsert_producer(
    name: str,
    normalized_name: str,
    verification_result: WineVerificationResult,
    verification_source: str = "web_search",
) -> Optional[str]:
    """
    Insert or update producer in knowledge graph via on_conflict='normalized_name'.

    REQUIRES: UNIQUE INDEX producers_normalized_name_key on producers(normalized_name)
    (created by supabase/migrations/20260407000000_producers_table.sql Plan 01 Task 1).
    Without the UNIQUE INDEX, supabase-py upsert silently inserts duplicates (Pitfall 4).

    Args:
        name:               Raw producer name (stored for display).
        normalized_name:    Output of normalize_producer_name() — the upsert key.
        verification_result: Parsed WineVerificationResult from Gemini Flash.
        verification_source: Source string for verification_sources array.

    Returns:
        Producer UUID string if upsert succeeded, None on error.
    """
    if not normalized_name:
        logger.debug("upsert_producer: empty normalized_name — skipping")
        return None

    settings = get_settings()
    certifications: Dict[str, Any] = {}
    if verification_result.certifications_organic is not None:
        certifications["organic"] = verification_result.certifications_organic
    if verification_result.certifications_biodynamic is not None:
        certifications["biodynamic"] = verification_result.certifications_biodynamic
    if verification_result.certifications_sustainable is not None:
        certifications["sustainable"] = verification_result.certifications_sustainable

    row: Dict[str, Any] = {
        "name": name,
        "normalized_name": normalized_name,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "verification_sources": [verification_source],
    }
    # Only include non-None fields to avoid clobbering existing data
    optional_fields = {
        "country": verification_result.country,
        "region": verification_result.region,
        "sub_region": verification_result.sub_region,
        "appellation": verification_result.appellation,
        "founding_year": verification_result.founding_year,
        "winemaker_name": verification_result.winemaker_name,
        "website_url": verification_result.website_url,
    }
    for k, v in optional_fields.items():
        if v is not None:
            row[k] = v
    if certifications:
        row["certifications"] = certifications

    try:
        supabase = create_client(settings.supabase_url, settings.supabase_key)
        resp = (
            supabase.table("producers")
            .upsert(row, on_conflict="normalized_name")
            .execute()
        )
        if resp.data:
            producer_id = resp.data[0].get("id")
            logger.info(
                "upsert_producer: upserted producer=%r normalized=%r id=%s",
                name,
                normalized_name,
                producer_id,
            )
            return producer_id
    except Exception as exc:
        logger.warning("upsert_producer: DB error for %r: %s", normalized_name, exc)
    return None
