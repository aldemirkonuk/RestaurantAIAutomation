"""
Haiku Enrichment Service
========================
Takes wine_name + vintage, checks two Supabase tables to avoid unnecessary API calls,
then calls claude-haiku-4-5-20251001 and returns structured enrichment fields.

Phase 4: Claude Haiku Enrichment
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import anthropic
from supabase import create_client

from config.settings import get_settings


@dataclass
class EnrichmentResult:
    """Structured result returned by HaikuEnrichmentService.enrich()."""

    wine_id: str
    region: Optional[str]
    country: Optional[str]
    grape_variety: Optional[str]
    producer_bio: Optional[str]
    enrichment_source: str = field(default="haiku")


class HaikuEnrichmentService:
    """
    Calls Claude Haiku to enrich wine records with region, country, grape_variety,
    and producer_bio. Skips enrichment if both tables already have the data (D-05).
    """

    MODEL = "claude-haiku-4-5-20251001"
    MAX_TOKENS = 512

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

        Check 1: master_wine_library_submissions — did Vision already return all 3 fields?
        Check 2: master_wine_library — does an approved record exist with full data?
        """
        supabase = self._get_supabase()

        # Check 1: submissions row — did Claude Vision already return all 3 fields?
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("payload")
            .eq("id", wine_id)
            .maybe_single()
            .execute()
        )
        if sub_resp.data:
            payload = sub_resp.data.get("payload") or {}
            if all([payload.get("region"), payload.get("country"), payload.get("grape_variety")]):
                self._logger.info(
                    "Skipping enrichment for %s: submission already complete", wine_id
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
                    "Skipping enrichment for %s: master library record complete", wine_id
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
            "You are a wine expert. Given the wine name and vintage below, return ONLY a JSON object "
            "with exactly these keys: region, country, grape_variety, producer_bio. "
            "If a field is unknown, use null. Do NOT include any other text or markdown.\n\n"
            f"Wine: {wine_name}{vintage_str}"
        )

        client = self._get_anthropic()
        response = await client.messages.create(
            model=self.MODEL,
            max_tokens=self.MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )

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

        return EnrichmentResult(
            wine_id=wine_id,
            region=data.get("region"),
            country=data.get("country"),
            grape_variety=data.get("grape_variety"),
            producer_bio=data.get("producer_bio"),
        )
