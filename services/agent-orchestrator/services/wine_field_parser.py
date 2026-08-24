"""
Wine Field Parser
=================
Gemini-powered structured field extraction from OCR text.
Extracts 25+ wine fields, scores confidence per field,
and injects section context (e.g., "under RED WINES header").

Pipeline:
  OCR text + YOLO hints + section context → Gemini Pro → WineParsedFields
"""

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from services.text_normalizer import get_normalizer
from services.wine_prompts import build_wine_prompt
from services.governance import assign_governance_tier, compute_overall_confidence

logger = logging.getLogger(__name__)

ML_PER_OZ = 29.5735


def normalize_bottle_volume(raw: str) -> Optional[int]:
    """
    Normalize bottle volume text to ml integer.
    Handles: 750ml, 750 ml, 1.5L, 25.4oz, 375ml, bare 750, etc.
    Returns None if unparseable.
    """
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip().lower()
    if not s:
        return None

    # ml patterns: 750ml, 750 ml, 375ml
    ml_match = re.search(r"(\d+(?:\.\d+)?)\s*ml", s)
    if ml_match:
        try:
            val = float(ml_match.group(1))
            return int(round(val)) if 0 < val < 100_000 else None
        except ValueError:
            return None

    # L patterns: 1.5L, 1.5 l, 1.5 L
    l_match = re.search(r"(\d+(?:\.\d+)?)\s*l\b", s)
    if l_match:
        try:
            val = float(l_match.group(1))
            return int(round(val * 1000)) if 0 < val < 100 else None
        except ValueError:
            return None

    # oz patterns: 25.4oz, 25.4 oz
    oz_match = re.search(r"(\d+(?:\.\d+)?)\s*oz", s)
    if oz_match:
        try:
            val = float(oz_match.group(1))
            return int(round(val * ML_PER_OZ)) if 0 < val < 1000 else None
        except ValueError:
            return None

    # Bare number: 750, 375
    bare_match = re.search(r"(\d{3,4})\b", s)
    if bare_match:
        try:
            val = int(bare_match.group(1))
            return val if 100 <= val <= 100_000 else None
        except ValueError:
            return None

    return None


# =============================================================================
# OUTPUT SCHEMA (25 fields)
# =============================================================================


class WineParsedFields(BaseModel):
    """Structured output for a single detected wine entry."""

    # --- Core Identification (always attempt) ---
    wine_name: str = Field(
        default="Unknown Wine", description="Primary wine name / cuvée"
    )
    producer: Optional[str] = Field(
        default=None, description="Winery / estate / producer name"
    )
    vintage: Optional[int] = Field(default=None, description="Harvest year")
    wine_type: Optional[str] = Field(
        default=None,
        description="red | white | rose | sparkling | dessert | fortified",
    )

    # --- Origin ---
    country: Optional[str] = Field(default=None, description="Country of origin")
    region: Optional[str] = Field(
        default=None, description="Wine region (e.g. Bordeaux)"
    )
    sub_region: Optional[str] = Field(
        default=None, description="Sub-region (e.g. Pauillac)"
    )
    appellation: Optional[str] = Field(
        default=None, description="Official appellation (e.g. AOC Pauillac)"
    )
    appellation_class: Optional[str] = Field(
        default=None,
        description="Appellation system: DOC, DOCG, AOC, AOP, AVA, DO, DOCA, etc.",
    )

    # --- Grape ---
    grape_variety: Optional[str] = Field(
        default=None,
        description="Single grape or comma-separated blend (e.g. 'Cabernet Sauvignon, Merlot')",
    )
    is_blend: Optional[bool] = Field(default=None, description="True if blend")

    # --- Pricing ---
    price: Optional[float] = Field(default=None, description="Listed price")
    price_currency: Optional[str] = Field(
        default=None, description="USD, EUR, TRY, GBP, etc."
    )
    serving_type: Optional[str] = Field(
        default=None, description="glass | bottle | carafe"
    )

    # --- Structure ---
    body: Optional[str] = Field(default=None, description="light | medium | full")
    sweetness: Optional[str] = Field(default=None, description="dry | off-dry | sweet")

    # --- Additional ---
    alcohol_pct: Optional[float] = Field(default=None, description="Alcohol %")
    bottle_volume: Optional[str] = Field(
        default=None, description="750ml, 375ml, 1.5L, etc."
    )
    bottle_size_ml: Optional[int] = Field(
        default=None,
        description="Bottle volume in ml. Normalized from text like '750ml', '1.5L', '25.4oz'. Standard bottle = 750.",
    )
    tasting_notes: Optional[str] = Field(
        default=None, description="Flavour description"
    )
    food_pairings: Optional[List[str]] = Field(
        default=None, description="Pairing suggestions"
    )
    rating: Optional[str] = Field(default=None, description="Score (e.g. '92pts WS')")
    classification: Optional[str] = Field(
        default=None,
        description="Grand Cru, Reserva, Riserva, Premier Cru, etc.",
    )

    # --- Meta ---
    confidence: float = Field(default=0.0, description="Overall confidence 0.0-1.0")
    field_confidences: Dict[str, float] = Field(
        default_factory=dict,
        description="Per-field confidence scores 0.0-1.0",
    )
    field_sources: Dict[str, str] = Field(
        default_factory=dict,
        description="Source per field: 'documented', 'ocr_extracted', 'inferred', 'section_context', 'web_search', 'uncertain', 'unknown'",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Warnings such as 'Country inferred by AI, not on menu'",
    )

    # --- Governance (set after parsing) ---
    library_tier: Optional[int] = Field(
        default=None,
        description="0=Canonical, 1=Auto-Validated, 2=Web-Enriched, 3=Provisional, 4=Unresolved",
    )
    canonical_name_verified: bool = Field(
        default=False, description="True if name matched canonical library entry"
    )


# =============================================================================
# GEMINI PROMPT TEMPLATE
# =============================================================================

_PARSE_PROMPT = """You are a world-class wine expert and sommelier AI.
Your task: given OCR text extracted from a wine menu (or label/invoice), extract ALL structured wine fields.

## Input
OCR text: "{ocr_text}"
{section_ctx}{yolo_hints}{normalized_ctx}

## Rules
1. Extract every field you can directly read from the text.
2. For fields NOT explicitly stated, use your wine knowledge to INFER them.
   Example: if text says "Sevilen", you know producer=Sevilen, country=Turkey, region=Aegean.
   Example: if text says "Pauillac", you know country=France, region=Bordeaux, sub_region=Médoc.
3. For abbreviated or sloppy text, expand abbreviations before extracting.
   "Ch. Margaux 15" → Château Margaux, vintage 2015.
   "Sev. Beyaz 18" → Sevilen Beyaz (White), vintage 2018.
4. For each field, mark its source in field_sources:
   - "ocr_extracted" = directly read from the text
   - "yolo_detected" = detected by YOLO bounding box
   - "ai_inferred" = inferred using your wine knowledge (not in text)
   - "section_context" = inferred from the section header context
5. If a 2-digit number appears in wine context (e.g., "'15", "18"), treat it as a vintage: 2015, 2018.
6. wine_type must be one of: red, white, rose, sparkling, dessert, fortified, or null.
7. When bottle_volume is present (e.g. 750ml, 1.5L, 25.4oz), set bottle_size_ml to the integer ml value. Standard bottle = 750. Use 29.5735 ml per oz for oz values.
8. Set confidence between 0.0 and 1.0 reflecting your certainty about the overall parse.
9. Add a warning for every AI-inferred field (e.g., "Country 'Turkey' inferred by AI").

## Output
Return ONLY valid JSON matching this exact schema (no markdown fences):
{{
  "wine_name": "...",
  "producer": "..." or null,
  "vintage": 2018 or null,
  "wine_type": "red" or null,
  "country": "..." or null,
  "region": "..." or null,
  "sub_region": "..." or null,
  "appellation": "..." or null,
  "appellation_class": "..." or null,
  "grape_variety": "..." or null,
  "is_blend": true/false or null,
  "price": 45.0 or null,
  "price_currency": "USD" or null,
  "serving_type": "bottle" or null,
  "body": "medium" or null,
  "sweetness": "dry" or null,
  "alcohol_pct": 13.5 or null,
  "bottle_volume": "750ml" or null,
  "bottle_size_ml": 750 or null,
  "tasting_notes": "..." or null,
  "food_pairings": ["..."] or null,
  "rating": "..." or null,
  "classification": "..." or null,
  "confidence": 0.85,
  "field_sources": {{"country": "ai_inferred", "vintage": "ocr_extracted", ...}},
  "warnings": ["Country 'Turkey' inferred by AI, not on menu"]
}}"""


# =============================================================================
# REGEX-BASED FALLBACK PARSER
# =============================================================================


class RegexWineParser:
    """Fallback parser using regex when Gemini is unavailable."""

    _VINTAGE_RE = re.compile(r"\b(19\d{2}|20[0-3]\d)\b")
    _PRICE_PATTERNS = [
        (re.compile(r"\$\s*([\d,]+\.?\d{0,2})"), "USD"),
        (re.compile(r"([\d,]+\.?\d{0,2})\s*\$"), "USD"),
        (re.compile(r"€\s*([\d,]+\.?\d{0,2})"), "EUR"),
        (re.compile(r"([\d,]+\.?\d{0,2})\s*€"), "EUR"),
        (re.compile(r"£\s*([\d,]+\.?\d{0,2})"), "GBP"),
        (re.compile(r"₺\s*([\d,]+\.?\d{0,2})"), "TRY"),
        (re.compile(r"([\d,]+\.?\d{0,2})\s*TL\b"), "TRY"),
        (re.compile(r"([\d,]+\.?\d{0,2})\s*TRY\b"), "TRY"),
    ]
    _ALCOHOL_RE = re.compile(
        r"(\d{1,2}(?:\.\d)?)\s*%\s*(?:abv|alc|vol)?", re.IGNORECASE
    )
    _VOLUME_RE = re.compile(
        r"\b(\d{3,4})\s*ml\b|\b(\d+(?:\.\d+)?)\s*[lL]\b|\b(\d+(?:\.\d+)?)\s*oz\b|\b(375|750)\b",
        re.IGNORECASE,
    )

    def parse(
        self,
        ocr_text: str,
        section_header: Optional[str] = None,
        yolo_detections: Optional[Dict[str, Any]] = None,
    ) -> WineParsedFields:
        """Parse wine text using regex patterns as Gemini fallback."""
        normalizer = get_normalizer()
        norm = normalizer.normalize(ocr_text)
        corrected = norm["corrected"]

        fields: Dict[str, Any] = {
            "field_sources": {},
            "warnings": [],
        }

        # Vintage
        vintage_match = self._VINTAGE_RE.search(corrected)
        if vintage_match:
            fields["vintage"] = int(vintage_match.group(1))
            fields["field_sources"]["vintage"] = "ocr_extracted"

        # Price
        for pattern, currency in self._PRICE_PATTERNS:
            price_match = pattern.search(corrected)
            if price_match:
                try:
                    fields["price"] = float(price_match.group(1).replace(",", ""))
                    fields["price_currency"] = currency
                    fields["field_sources"]["price"] = "ocr_extracted"
                except ValueError:
                    pass
                break

        # Alcohol
        alc_match = self._ALCOHOL_RE.search(corrected)
        if alc_match:
            fields["alcohol_pct"] = float(alc_match.group(1))
            fields["field_sources"]["alcohol_pct"] = "ocr_extracted"

        # Volume
        vol_match = self._VOLUME_RE.search(corrected)
        if vol_match:
            vol = vol_match.group(0).strip()
            fields["bottle_volume"] = vol
            fields["field_sources"]["bottle_volume"] = "ocr_extracted"
            normalized_ml = normalize_bottle_volume(vol)
            if normalized_ml is not None:
                fields["bottle_size_ml"] = normalized_ml
                fields["field_sources"]["bottle_size_ml"] = "ocr_extracted"

        # Wine type from section header or text
        wine_type = normalizer.infer_wine_type((section_header or "") + " " + corrected)
        if wine_type:
            fields["wine_type"] = wine_type
            if section_header and normalizer.infer_wine_type(section_header):
                fields["field_sources"]["wine_type"] = "section_context"
            else:
                fields["field_sources"]["wine_type"] = "ocr_extracted"

        # Wine name: strip price, vintage, alcohol, volume from text
        name_text = corrected
        # Collapse newlines/tabs first so injected linebreak tricks are neutralised
        name_text = re.sub(r"[\r\n\t]+", " ", name_text)
        if vintage_match:
            name_text = name_text.replace(vintage_match.group(0), "")
        for pattern, _ in self._PRICE_PATTERNS:
            name_text = pattern.sub("", name_text)
        name_text = self._ALCOHOL_RE.sub("", name_text)
        name_text = self._VOLUME_RE.sub("", name_text)
        # Remove common delimiters/separators
        name_text = re.sub(r"\s*[-–—|/]\s*", " ", name_text)
        name_text = re.sub(r"\s+", " ", name_text).strip()

        # Sanitise: remove SQL/script-injection artefacts and non-printable chars.
        # We keep letters, digits, spaces, and common wine-label punctuation.
        name_text = re.sub(
            r"[;'\"`<>\\]|"  # SQL/HTML injection chars
            r"--[^\n]*|"  # SQL line comments (-- ...)
            r"\b(?:drop|table|insert|update|delete|select|union|exec|script|"
            r"truncate|alter|create|database|schema)\b",  # SQL keywords
            " ",
            name_text,
            flags=re.IGNORECASE,
        )
        name_text = re.sub(
            r"[^\x20-\x7Eàáâãäåæçèéêëìíîïðñòóôõöùúûüýÿ"
            r"ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝŸ"
            r"ğĞışİöÖüÜçÇ"  # Turkish chars
            r"αβγδεζηθ"  # Greek (extend as needed)
            r"]",
            " ",
            name_text,
        )
        name_text = re.sub(r"\s+", " ", name_text).strip()
        # Hard cap: wine names longer than 120 chars after cleanup are truncated
        name_text = name_text[:120]

        if name_text:
            fields["wine_name"] = name_text
            fields["field_sources"]["wine_name"] = "ocr_extracted"
        else:
            # Fallback: use raw text but apply same sanitisation + 80-char cap
            safe_fallback = re.sub(
                r"[;'\"`<>\\]|--[^\n]*|"
                r"\b(?:drop|table|insert|update|delete|select|union|exec|script|"
                r"truncate|alter|create|database|schema)\b",
                " ",
                ocr_text,
                flags=re.IGNORECASE,
            )
            safe_fallback = re.sub(r"[\r\n\t]+", " ", safe_fallback)
            safe_fallback = re.sub(r"\s+", " ", safe_fallback).strip()[:80]
            fields["wine_name"] = safe_fallback or "Unknown Wine"
            fields["field_sources"]["wine_name"] = "ocr_extracted"

        # YOLO hint overrides
        if yolo_detections:
            for key in ("vintage", "price", "wine_name", "producer", "grape_variety"):
                if key in yolo_detections and yolo_detections[key]:
                    val = yolo_detections[key]
                    if key == "vintage" and isinstance(val, str):
                        try:
                            val = int(val)
                        except ValueError:
                            continue
                    if key == "price" and isinstance(val, str):
                        try:
                            val = float(
                                val.replace(",", "").replace("$", "").replace("€", "")
                            )
                        except ValueError:
                            continue
                    fields[key] = val
                    fields["field_sources"][key] = "yolo_detected"

        # Confidence: low for regex-only parse
        fields["confidence"] = 0.40
        fields["warnings"].append("Parsed with regex fallback (Gemini unavailable)")

        return WineParsedFields(**fields)


# =============================================================================
# MAIN PARSER CLASS
# =============================================================================


class WineFieldParser:
    """
    Parses OCR text into 25 structured wine fields using Gemini Pro.
    Falls back to regex parsing when Gemini is unavailable.
    """

    def __init__(self, google_api_key: Optional[str] = None, mock_mode: bool = True):
        self.google_api_key = google_api_key
        self.mock_mode = mock_mode
        self._llm_client = None
        self._regex_parser = RegexWineParser()
        self._normalizer = get_normalizer()

    def _get_llm_client(self, system_instruction: Optional[str] = None):
        """Lazy-init Gemini client using the new google.genai SDK.

        Uses gemini-2.5-flash — best quality/cost ratio (~$0.00005/wine).
        Returns a (client, config) tuple ready for generate_content calls.
        """
        if self.mock_mode or not self.google_api_key:
            return None
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.google_api_key)

            config = types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
                system_instruction=system_instruction,
            )
            return (client, config)
        except Exception as e:
            logger.error(f"Failed to initialize Gemini for field parser: {e}")
            return None

    async def parse(
        self,
        ocr_text: str,
        section_header: Optional[str] = None,
        yolo_detections: Optional[Dict[str, Any]] = None,
        source_type: str = "menu",
    ) -> WineParsedFields:
        """
        Parse OCR text into structured wine fields.

        Args:
            ocr_text: Raw OCR text for one wine entry
            section_header: The section header this wine was under (e.g. "RED WINES")
            yolo_detections: Dict of YOLO-detected sub-fields and their OCR text
                e.g. {"vintage": "2018", "price": "$45", "wine_name": "Ch. Margaux"}
            source_type: "menu", "label", or "invoice"

        Returns:
            WineParsedFields with all 25 fields populated as much as possible
        """
        # Step 1: Normalize input text
        norm = self._normalizer.normalize(ocr_text)

        # Step 2: Try Gemini
        gemini_result = await self._parse_with_gemini(
            ocr_text=ocr_text,
            corrected_text=norm["corrected"],
            section_header=section_header,
            yolo_detections=yolo_detections,
        )

        if gemini_result is not None:
            # Merge YOLO hints into Gemini result (YOLO takes priority for detected fields)
            merged = self._merge_yolo_hints(gemini_result, yolo_detections)
            return merged

        # Step 3: Fallback to regex parser
        logger.info("Gemini unavailable, using regex fallback parser")
        return self._regex_parser.parse(
            ocr_text=ocr_text,
            section_header=section_header,
            yolo_detections=yolo_detections,
        )

    async def parse_batch(
        self,
        entries: List[Dict[str, Any]],
    ) -> List[WineParsedFields]:
        """
        Parse multiple wine entries.

        Each entry dict should have:
        - 'ocr_text': str
        - 'section_header': Optional[str]
        - 'yolo_detections': Optional[Dict]
        - 'source_type': Optional[str] (default 'menu')
        """
        results = []
        for entry in entries:
            parsed = await self.parse(
                ocr_text=entry.get("ocr_text", ""),
                section_header=entry.get("section_header"),
                yolo_detections=entry.get("yolo_detections"),
                source_type=entry.get("source_type", "menu"),
            )
            results.append(parsed)
        return results

    # ---- Gemini integration ----

    async def _parse_with_gemini(
        self,
        ocr_text: str,
        corrected_text: str,
        section_header: Optional[str],
        yolo_detections: Optional[Dict[str, Any]],
        restaurant_country: Optional[str] = None,
        restaurant_city: Optional[str] = None,
        restaurant_tier: Optional[str] = None,
        cuisine_type: Optional[str] = None,
    ) -> Optional[WineParsedFields]:
        """Parse via Gemini using the 3-layer prompt system + governance tier assignment."""
        if self.mock_mode:
            return self._mock_parse(ocr_text, section_header, yolo_detections)

        # Build YOLO hints and merge into normalized text so prompt receives them
        # (build_wine_prompt / build_layer_3_prompt has no yolo_hints param —
        #  we surface them via normalized_text instead)
        effective_normalized = corrected_text or ocr_text
        if yolo_detections:
            hints_parts = []
            for key, val in yolo_detections.items():
                if val:
                    hints_parts.append(f'  - {key}: "{val}"')
            if hints_parts:
                yolo_block = "YOLO detection hints:\n" + "\n".join(hints_parts)
                effective_normalized = f"{effective_normalized}\n\n{yolo_block}"

        # ── Build 3-layer prompt via wine_prompts module ──
        prompt = build_wine_prompt(
            ocr_text=ocr_text,
            ocr_confidence=0.7,  # default; will be overridden when OCR provides this
            normalized_text=effective_normalized,
            section_header=section_header,
            restaurant_country=restaurant_country or "USA",
            restaurant_city=restaurant_city,
            restaurant_tier=restaurant_tier or "casual",
            cuisine_type=cuisine_type,
        )

        # ── Init Gemini client (new google.genai SDK) ──
        llm = self._get_llm_client(system_instruction=prompt["system"])
        if llm is None:
            return None

        client, config = llm

        try:
            _t0 = time.perf_counter()
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt["user"],
                config=config,
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

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
                    cost_usd=estimate_llm_cost("gemini-2.5-flash", _in, _out),
                    agent_fallback="wine_field_parser",
                    task_type="wine_field_parse",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                )
            except Exception:
                pass

            result_text = response.text.strip()

            # Extract JSON (belt-and-suspenders: Gemini should return raw JSON
            # with response_mime_type, but handle markdown fences just in case)
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0].strip()

            data = json.loads(result_text)

            # ── Flatten nested field objects ──────────────────────────────────
            # Gemini returns each field as {value, confidence, source} objects.
            # WineParsedFields expects flat values with separate dicts for
            # field_confidences and field_sources.
            SCHEMA_FIELDS = {
                "wine_name",
                "producer",
                "vintage",
                "wine_type",
                "country",
                "region",
                "sub_region",
                "appellation",
                "appellation_class",
                "grape_variety",
                "is_blend",
                "price",
                "price_currency",
                "serving_type",
                "body",
                "sweetness",
                "alcohol_pct",
                "bottle_volume",
                "bottle_size_ml",
                "tasting_notes",
                "food_pairings",
                "rating",
                "classification",
                "appellation_tier",
                "acidity",
                "tannins",
                "texture",
                "finish",
                "primary_aromas",
                "secondary_aromas",
                "tertiary_aromas",
                "quality_level",
                "classification_name",
                "classification_system",
                "reserve_status",
                "vintage_quality",
                "farming",
                "aging_vessel",
                "aging_duration",
                "serving_temp_celsius",
                "glass_type",
                "decanting_recommended",
                "aging_potential_years",
                "rating_ws",
                "rating_rp",
                "rating_jr",
            }
            field_confidences: Dict[str, float] = {}
            field_sources: Dict[str, str] = {}
            flat_data: Dict[str, Any] = {}

            for key, raw_val in data.items():
                if (
                    key in SCHEMA_FIELDS
                    and isinstance(raw_val, dict)
                    and "value" in raw_val
                ):
                    # Nested object — extract value, confidence, source
                    flat_data[key] = raw_val.get("value")
                    if "confidence" in raw_val:
                        field_confidences[key] = float(raw_val["confidence"])
                    if "source" in raw_val:
                        field_sources[key] = str(raw_val["source"])
                else:
                    flat_data[key] = raw_val

            # Restore extracted dicts back into flat_data
            flat_data["field_confidences"] = field_confidences
            flat_data["field_sources"] = field_sources
            # Preserve any top-level warnings/confidence from Gemini
            if "warnings" not in flat_data:
                flat_data["warnings"] = []
            # Guard: wine_name must be a non-empty string (Pydantic requires str)
            if not flat_data.get("wine_name"):
                flat_data["wine_name"] = "Unknown Wine"
            data = flat_data
            # ── End flatten ───────────────────────────────────────────────────

            # Derive bottle_size_ml from bottle_volume if missing
            if data.get("bottle_size_ml") is None and data.get("bottle_volume"):
                vol_ml = normalize_bottle_volume(str(data["bottle_volume"]))
                if vol_ml is not None:
                    data["bottle_size_ml"] = vol_ml

            if field_confidences:
                overall_conf = compute_overall_confidence(field_confidences)
            else:
                overall_conf = data.get("confidence", 0.5)

            governance = assign_governance_tier(
                overall_confidence=overall_conf,
                field_confidences=field_confidences,
                field_values=data,
                field_sources=field_sources,
            )

            # Merge governance results into parsed data
            data["library_tier"] = governance["library_tier"]
            data["canonical_name_verified"] = governance["canonical_name_verified"]
            data["confidence"] = governance["overall_confidence"]
            existing_warnings = data.get("warnings", [])
            existing_warnings.extend(governance.get("warnings", []))
            data["warnings"] = existing_warnings

            return WineParsedFields(**data)

        except json.JSONDecodeError as e:
            logger.error(f"Gemini returned invalid JSON: {e}")
            return None
        except Exception as e:
            logger.error(f"Gemini field parsing failed: {e}")
            return None

    def _mock_parse(
        self,
        ocr_text: str,
        section_header: Optional[str],
        yolo_detections: Optional[Dict[str, Any]],
    ) -> WineParsedFields:
        """Mock parse using regex + heuristics (for development)."""
        result = self._regex_parser.parse(
            ocr_text=ocr_text,
            section_header=section_header,
            yolo_detections=yolo_detections,
        )
        # Boost confidence for mock mode to indicate "would be better with Gemini"
        result.confidence = min(0.75, result.confidence + 0.20)
        result.warnings = [
            w.replace("regex fallback (Gemini unavailable)", "mock mode (development)")
            for w in result.warnings
        ]
        return result

    # ---- Utility ----

    @staticmethod
    def _merge_yolo_hints(
        parsed: WineParsedFields,
        yolo_detections: Optional[Dict[str, Any]],
    ) -> WineParsedFields:
        """Merge YOLO-detected fields into parsed result. YOLO has higher trust."""
        if not yolo_detections:
            return parsed

        data = parsed.model_dump()

        for field_key, yolo_value in yolo_detections.items():
            if not yolo_value:
                continue
            # Map YOLO class names to field keys
            mapping = {
                "vintage": "vintage",
                "price": "price",
                "wine_name": "wine_name",
                "producer": "producer",
                "grape_variety": "grape_variety",
                "origin_info": None,  # Parsed by Gemini into country/region/etc.
                "description": "tasting_notes",
                "rating": "rating",
                "classification": "classification",
                "bottle_info": None,  # Contains volume or ABV
                "serving_type": "serving_type",
            }
            target_key = mapping.get(field_key, field_key)
            if target_key and target_key in data:
                # Type coerce
                if target_key == "vintage":
                    try:
                        data[target_key] = int(str(yolo_value).strip())
                    except ValueError:
                        continue
                elif target_key == "price":
                    try:
                        cleaned = (
                            str(yolo_value)
                            .replace(",", "")
                            .replace("$", "")
                            .replace("€", "")
                            .replace("£", "")
                            .replace("₺", "")
                            .strip()
                        )
                        data[target_key] = float(cleaned)
                    except ValueError:
                        continue
                else:
                    data[target_key] = str(yolo_value).strip()

                data["field_sources"][target_key] = "yolo_detected"

        return WineParsedFields(**data)


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_parser_instance: Optional[WineFieldParser] = None


def get_field_parser(
    google_api_key: Optional[str] = None,
    mock_mode: bool = True,
) -> WineFieldParser:
    """Get or create module-level singleton parser."""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = WineFieldParser(
            google_api_key=google_api_key,
            mock_mode=mock_mode,
        )
    return _parser_instance
