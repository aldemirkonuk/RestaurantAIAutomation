"""
Haiku Enrichment Service
========================
Phase 7 expansion: Takes wine_name + vintage, returns 20+ fields with per-field
confidence scoring. Each field returned as {value, confidence, source="knowledge"}.
Also returns 6 JSONB structured enrichments (grape_family, wine_structure, etc.).

Phase 4 original: 4 fields (region, country, grape_variety, producer_bio).
Phase 7 expansion: 14 scalar fields + 6 JSONB enrichments, all with confidence.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import anthropic
from supabase import create_client

from config.settings import get_settings
from services.spend_logger import get_spend_logger


@dataclass
class EnrichmentResult:
    """
    Structured result returned by HaikuEnrichmentService.enrich().

    field_confidence: Per-field {value, confidence, source="knowledge"} map
    6 JSONB enrichment dicts: structured nested objects for master_wine_library columns
    """

    wine_id: str
    field_confidence: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    # JSONB structured enrichments (FCONF-08 / CONTEXT.md D-07)
    grape_family: Optional[Dict[str, Any]] = None
    wine_structure: Optional[Dict[str, Any]] = None
    sensory_profile: Optional[Dict[str, Any]] = None
    practical_attributes: Optional[Dict[str, Any]] = None
    region_hierarchy: Optional[Dict[str, Any]] = None
    critic_scores: Optional[Dict[str, Any]] = None
    winemaking_details: Optional[Dict[str, Any]] = None
    enrichment_source: str = field(default="haiku")


class HaikuEnrichmentService:
    """
    Calls Claude Haiku to enrich wine records with 20+ fields + 6 JSONB enrichments.
    Skips enrichment if both tables already have the data (D-05).

    Two-pass architecture (Phase 7):
    - Pass 1: Claude Vision extracts visible menu fields with confidence
    - Pass 2: Haiku fills gaps and cross-checks inferences with wine knowledge
    """

    MODEL = "claude-haiku-4-5-20251001"
    MAX_TOKENS = 2048  # Increased from 512 for 20+ field response (D-09)

    # Scalar fields Haiku enriches with per-field {value, confidence, source}
    SCALAR_FIELDS = [
        "producer",
        "region",
        "sub_region",
        "appellation",
        "country",
        "grape_variety",
        "color",
        "primary_type",
        "sweetness_level",
        "food_pairing",
        "producer_bio",
        "tasting_notes",
        "alcohol_pct",
        "description",
    ]

    # 6 JSONB keys returned as raw dicts (not wrapped in {value, confidence})
    JSONB_KEYS = [
        "grape_family",
        "wine_structure",
        "sensory_profile",
        "practical_attributes",
        "region_hierarchy",
        "critic_scores",
    ]

    def __init__(self):
        self._settings = get_settings()
        self._logger = logging.getLogger(__name__)

    def _get_supabase(self):
        """Create Supabase client from settings."""
        return create_client(self._settings.supabase_url, self._settings.supabase_key)

    def _get_anthropic(self):
        """Create AsyncAnthropic client from settings."""
        return anthropic.AsyncAnthropic(api_key=self._settings.claude_api_key)

    async def _is_already_enriched(self, wine_id: str, wine_name: str) -> bool:
        """
        D-05: Check both tables. Return True if enrichment should be skipped.

        Check 1: master_wine_library_submissions — does field_confidence already have
                 enrichment fields with source="knowledge" (meaning Haiku already ran)?
        Check 2: master_wine_library — does an approved record exist with all 3 core fields?
        """
        supabase = self._get_supabase()

        # Check 1: submissions — does field_confidence already have Haiku-sourced fields?
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("payload, field_confidence")
            .eq("id", wine_id)
            .maybe_single()
            .execute()
        )
        if sub_resp.data:
            fc = sub_resp.data.get("field_confidence") or {}
            # Already enriched if field_confidence has knowledge-sourced fields
            knowledge_fields = [
                k
                for k, v in fc.items()
                if isinstance(v, dict) and v.get("source") == "knowledge"
            ]
            if len(knowledge_fields) >= 3:
                self._logger.info(
                    "Skipping enrichment for %s: field_confidence has %d knowledge fields",
                    wine_id,
                    len(knowledge_fields),
                )
                return True
            # Legacy check: flat payload fields
            payload = sub_resp.data.get("payload") or {}
            if all(
                [
                    payload.get("region"),
                    payload.get("country"),
                    payload.get("grape_variety"),
                ]
            ):
                self._logger.info(
                    "Skipping enrichment for %s: payload already complete", wine_id
                )
                return True

        # Check 2: master library — does approved record exist with wine_name match AND all 3 fields?
        lib_resp = (
            supabase.table("master_wine_library")
            .select("id, region, country, grape_variety")
            .ilike("name", wine_name)
            .limit(1)
            .execute()
        )
        if lib_resp.data:
            rec = lib_resp.data[0]
            if all([rec.get("region"), rec.get("country"), rec.get("grape_variety")]):
                self._logger.info(
                    "Skipping enrichment for %s: master library record complete",
                    wine_id,
                )
                return True

        return False

    async def enrich(
        self,
        wine_id: str,
        wine_name: str,
        vintage: Optional[str],
    ) -> Optional[EnrichmentResult]:
        """
        Main entry point. Returns EnrichmentResult or None if skipped.
        Raises ValueError on malformed Haiku response (let Celery retry — D-04).
        """
        if await self._is_already_enriched(wine_id, wine_name):
            return None

        vintage_str = f", vintage {vintage}" if vintage else ""

        prompt = (
            "You are a wine expert. Given the wine name and vintage below, return ONLY a JSON object.\n\n"
            "For each scalar field, return an object: "
            '{"value": ..., "confidence": 0.0-1.0, "source": "knowledge"}.\n'
            "Rate confidence 0.9+ only when certain from well-known wine knowledge. "
            "Use 0.5-0.8 for reasonable inferences. Use < 0.5 when genuinely uncertain.\n\n"
            "Scalar fields to provide (all with {value, confidence, source}):\n"
            "- producer: Winery/producer name\n"
            "- region: Wine region (e.g. 'Bordeaux', 'Napa Valley')\n"
            "- sub_region: Sub-region if known (e.g. 'Pauillac', 'Rutherford')\n"
            "- appellation: AOC/DOC/AVA designation\n"
            "- country: Country of origin\n"
            "- grape_variety: Primary grape or blend description\n"
            "- color: 'red', 'white', 'rosé', or 'amber'\n"
            "- primary_type: 'red', 'white', 'rosé', 'sparkling', 'dessert', 'fortified', or 'orange'\n"
            "- sweetness_level: 'dry', 'off-dry', 'semi-sweet', 'sweet', 'brut', or 'extra-dry'\n"
            "- food_pairing: Comma-separated food pairing suggestions\n"
            "- producer_bio: 1-2 sentence producer/winery description\n"
            "- tasting_notes: Typical aroma and palate descriptors\n"
            "- alcohol_pct: Typical ABV as a float (e.g. 13.5)\n"
            "- description: Brief wine description\n\n"
            "Also provide these structured objects (raw dicts, NOT wrapped in {value,confidence}):\n"
            '- grape_family: {"primary": "...", "blend": bool, "percentages": null, "family": "..."}\n'
            '- wine_structure: {"body": "light/medium/full", "tannin": "low/medium/high", '
            '"acidity": "low/medium/high", "finish": "short/medium/long"}\n'
            '- sensory_profile: {"aromas": [...], "palate": [...], "color_descriptor": "..."}\n'
            '- practical_attributes: {"serving_temp_c": int, "decant_minutes": int, '
            '"aging_potential_years": "...", "glass_type": "..."}\n'
            '- winemaking_details: {"production_method": "e.g. Metodo Classico / Charmat / Pétillant Naturel / Traditional / etc. (null if not applicable)", '
            '"lees_contact_months": int or null, "fermentation": "...", '
            '"oak_aging": "...", "harvest": "..."}\n'
            '- region_hierarchy: {"country": "...", "region": "...", "sub_region": "...", '
            '"appellation": "...", "classification": "...", "commune": "..."}\n'
            "- critic_scores: {} (leave empty — populated by Phase 10)\n\n"
            "Return ONLY valid JSON. No markdown, no explanation.\n\n"
            f"Wine: {wine_name}{vintage_str}"
        )

        client = self._get_anthropic()
        response = await client.messages.create(
            model=self.MODEL,
            max_tokens=self.MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )

        # Log spend — non-fatal.
        # P1 fix: wine_id is NOT a restaurant_id — it now rides in context.
        try:
            _in = response.usage.input_tokens
            _out = response.usage.output_tokens
            _cost = (_in * 0.80 / 1_000_000) + (_out * 4.00 / 1_000_000)
            get_spend_logger().log(
                provider="anthropic",
                model=self.MODEL,
                input_tokens=_in,
                output_tokens=_out,
                cost_usd=_cost,
                restaurant_id=None,
                agent_fallback="haiku_enrichment_service",
                task_type="wine_enrichment",
                outcome="success",  # call-level: completion returned
                context={"wine_id": str(wine_id)},
            )
        except Exception:
            pass

        raw = response.content[0].text.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Haiku returned non-JSON for wine {wine_id}: {raw!r}"
            ) from e

        # Build field_confidence from scalar fields with nested {value, confidence, source}
        fc: Dict[str, Dict[str, Any]] = {}
        for fname in self.SCALAR_FIELDS:
            raw_val = data.get(fname)
            if raw_val is None:
                continue
            if isinstance(raw_val, dict) and "confidence" in raw_val:
                fc[fname] = {
                    "value": raw_val.get("value"),
                    "confidence": float(raw_val.get("confidence", 0.5)),
                    "source": str(raw_val.get("source", "knowledge")),
                }
            else:
                # Haiku returned flat value — wrap with default confidence
                fc[fname] = {"value": raw_val, "confidence": 0.5, "source": "knowledge"}

        return EnrichmentResult(
            wine_id=wine_id,
            field_confidence=fc,
            grape_family=data.get("grape_family"),
            wine_structure=data.get("wine_structure"),
            sensory_profile=data.get("sensory_profile"),
            practical_attributes=data.get("practical_attributes"),
            region_hierarchy=data.get("region_hierarchy"),
            critic_scores=data.get("critic_scores") or {},
            winemaking_details=data.get("winemaking_details"),
        )
