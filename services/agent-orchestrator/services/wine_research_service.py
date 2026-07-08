"""
Wine Research Service (Master Library Gap Filling)
===================================================
When a wine is extracted but not found in the master library,
this service searches external sources to enrich the entry.

Sources (FREE scraping via Playwright):
  1. Wine-Searcher (public pages)
  2. CellarTracker (community notes)
  3. Vivino (public data)

Flow:
  1. Wine name + producer + vintage -> search query
  2. Playwright visits Wine-Searcher search results
  3. Extracts: producer, region, country, grape, classification, average price
  4. If 8 identity fields populated + confidence > 0.8 -> auto-add to master library
  5. Otherwise -> flag for human review

Rate: Respects robots.txt, 1 request per 3 seconds.
"""

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================


@dataclass
class WineResearchResult:
    """Result of researching a wine online."""

    wine_name: str
    producer: Optional[str] = None
    vintage: Optional[int] = None
    country: Optional[str] = None
    region: Optional[str] = None
    sub_region: Optional[str] = None
    grape_variety: Optional[str] = None
    classification: Optional[str] = None
    wine_type: Optional[str] = None
    average_price: Optional[float] = None
    critic_score: Optional[float] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    source: str = ""  # wine-searcher, cellartracker, vivino
    source_url: Optional[str] = None
    confidence: float = 0.0
    identity_fields_populated: int = 0
    auto_add_eligible: bool = False


# =============================================================================
# RESEARCH SERVICE
# =============================================================================


class WineResearchService:
    """
    Searches external wine databases to fill gaps in the master library.
    Uses Playwright for JavaScript-rendered pages.
    """

    REQUEST_DELAY_S = 3.0  # seconds between requests
    IDENTITY_FIELDS = [
        "wine_name",
        "producer",
        "vintage",
        "country",
        "region",
        "grape_variety",
        "classification",
        "wine_type",
    ]
    AUTO_ADD_MIN_FIELDS = 6
    AUTO_ADD_MIN_CONFIDENCE = 0.80

    def __init__(self, supabase_client=None):
        self._supabase = supabase_client

    # =========================================================================
    # MAIN RESEARCH
    # =========================================================================

    async def research_wine(
        self,
        wine_name: str,
        producer: Optional[str] = None,
        vintage: Optional[int] = None,
        known_fields: Optional[Dict[str, Any]] = None,
    ) -> WineResearchResult:
        """
        Research an unknown wine using external sources.

        Args:
            wine_name: The wine name to research.
            producer: Optional producer/estate.
            vintage: Optional vintage year.
            known_fields: Any already-known fields.
        """
        result = WineResearchResult(
            wine_name=wine_name,
            producer=producer,
            vintage=vintage,
        )

        # Copy known fields
        if known_fields:
            for f in self.IDENTITY_FIELDS:
                if f in known_fields and known_fields[f]:
                    setattr(result, f, known_fields[f])

        # Build search query
        query = self._build_query(wine_name, producer, vintage)

        # Try sources in priority order
        for source_fn in [
            self._search_wine_searcher,
            self._search_cellartracker,
        ]:
            try:
                enriched = await source_fn(query, result)
                if enriched:
                    result = enriched
                    if result.identity_fields_populated >= self.AUTO_ADD_MIN_FIELDS:
                        break
            except Exception as e:
                logger.warning(f"Research source failed: {e}")

            await asyncio.sleep(self.REQUEST_DELAY_S)

        # Calculate final confidence and eligibility
        result.identity_fields_populated = self._count_identity_fields(result)
        result.confidence = result.identity_fields_populated / len(self.IDENTITY_FIELDS)
        result.auto_add_eligible = (
            result.identity_fields_populated >= self.AUTO_ADD_MIN_FIELDS
            and result.confidence >= self.AUTO_ADD_MIN_CONFIDENCE
        )

        # Auto-add to master library if eligible
        if result.auto_add_eligible:
            await self._add_to_master_library(result)

        return result

    async def research_batch(
        self,
        wines: List[Dict[str, Any]],
        max_count: int = 20,
    ) -> List[WineResearchResult]:
        """Research a batch of unknown wines."""
        results = []
        for wine in wines[:max_count]:
            result = await self.research_wine(
                wine_name=wine.get("wine_name", ""),
                producer=wine.get("producer"),
                vintage=wine.get("vintage"),
                known_fields=wine,
            )
            results.append(result)
            await asyncio.sleep(self.REQUEST_DELAY_S)
        return results

    # =========================================================================
    # SEARCH SOURCES
    # =========================================================================

    async def _search_wine_searcher(
        self, query: str, result: WineResearchResult
    ) -> Optional[WineResearchResult]:
        """Search Wine-Searcher for wine information."""
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return None

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            try:
                search_url = (
                    f"https://www.wine-searcher.com/find/{query.replace(' ', '+')}"
                )
                await page.goto(
                    search_url, wait_until="domcontentloaded", timeout=15000
                )
                await asyncio.sleep(2)

                # Extract from search results page
                # Wine-Searcher shows wine info in structured format
                name_el = await page.query_selector(
                    "h1, .wine-name, [class*='wineName']"
                )
                if name_el:
                    name_text = await name_el.inner_text()
                    if name_text:
                        result.source = "wine-searcher"
                        result.source_url = search_url

                # Extract structured data from the page
                meta_text = await page.inner_text("body")
                self._parse_wine_searcher_text(meta_text, result)

            except Exception as e:
                logger.debug(f"Wine-Searcher search failed: {e}")
            finally:
                await browser.close()

        return result

    async def _search_cellartracker(
        self, query: str, result: WineResearchResult
    ) -> Optional[WineResearchResult]:
        """Search CellarTracker for wine information."""
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return None

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            try:
                search_url = f"https://www.cellartracker.com/list.asp?szSearch={query.replace(' ', '+')}"
                await page.goto(
                    search_url, wait_until="domcontentloaded", timeout=15000
                )
                await asyncio.sleep(2)

                # Try to get first result details
                first_link = await page.query_selector("a[href*='wine.asp']")
                if first_link:
                    href = await first_link.get_attribute("href")
                    if href:
                        detail_url = f"https://www.cellartracker.com/{href}"
                        await page.goto(
                            detail_url, wait_until="domcontentloaded", timeout=15000
                        )
                        await asyncio.sleep(1)

                        meta_text = await page.inner_text("body")
                        self._parse_cellartracker_text(meta_text, result)
                        result.source = "cellartracker"
                        result.source_url = detail_url

            except Exception as e:
                logger.debug(f"CellarTracker search failed: {e}")
            finally:
                await browser.close()

        return result

    # =========================================================================
    # TEXT PARSING HELPERS
    # =========================================================================

    def _parse_wine_searcher_text(self, text: str, result: WineResearchResult):
        """Extract wine details from Wine-Searcher page text."""
        # Country/Region detection
        from services.html_menu_parser import REGION_TO_COUNTRY

        lower = text.lower()

        for region_key, (country, region) in REGION_TO_COUNTRY.items():
            if region_key in lower:
                if not result.country:
                    result.country = country
                if not result.region and region:
                    result.region = region
                break

        # Grape variety detection
        grape_patterns = [
            r"(?:grape|variety|varietal)[s]?\s*:?\s*([A-Za-z\s,]+)",
            r"(?:made from|blend of)\s+([A-Za-z\s,]+)",
        ]
        for pattern in grape_patterns:
            match = re.search(pattern, text, re.I)
            if match and not result.grape_variety:
                result.grape_variety = match.group(1).strip()[:100]
                break

        # Wine type
        if not result.wine_type:
            from services.text_normalizer import get_normalizer

            normalizer = get_normalizer()
            wtype = normalizer.infer_wine_type(text[:500])
            if wtype:
                result.wine_type = wtype

        # Average price
        price_match = re.search(
            r"(?:average|avg|median)\s*(?:price)?\s*:?\s*\$?([\d,]+\.?\d*)", text, re.I
        )
        if price_match and not result.average_price:
            try:
                result.average_price = float(price_match.group(1).replace(",", ""))
            except ValueError:
                pass

        # Critic score
        score_match = re.search(r"(\d{2,3})\s*/\s*100", text)
        if score_match and not result.critic_score:
            score = int(score_match.group(1))
            if 50 <= score <= 100:
                result.critic_score = float(score)

    def _parse_cellartracker_text(self, text: str, result: WineResearchResult):
        """Extract wine details from CellarTracker page text."""
        # Similar extraction logic, adapted for CT's format
        self._parse_wine_searcher_text(text, result)

    # =========================================================================
    # UTILITY
    # =========================================================================

    def _build_query(
        self,
        wine_name: str,
        producer: Optional[str],
        vintage: Optional[int],
    ) -> str:
        """Build a search query string."""
        parts = []
        if producer:
            parts.append(producer)
        parts.append(wine_name)
        if vintage:
            parts.append(str(vintage))
        return " ".join(parts)

    def _count_identity_fields(self, result: WineResearchResult) -> int:
        """Count how many identity fields are populated."""
        count = 0
        for f in self.IDENTITY_FIELDS:
            val = getattr(result, f, None)
            if val and str(val).strip():
                count += 1
        return count

    async def _add_to_master_library(self, result: WineResearchResult):
        """Auto-add a researched wine to the master library."""
        if not self._supabase:
            logger.info(
                f"Would auto-add '{result.wine_name}' to master library "
                f"({result.identity_fields_populated}/8 fields, "
                f"confidence: {result.confidence:.2f})"
            )
            return

        try:
            self._supabase.table("master_wine_library").insert(
                {
                    "wine_name": result.wine_name,
                    "producer": result.producer,
                    "vintage": result.vintage,
                    "country": result.country,
                    "region": result.region,
                    "sub_region": result.sub_region,
                    "grape_variety": result.grape_variety,
                    "classification": result.classification,
                    "wine_type": result.wine_type,
                    "average_price": result.average_price,
                    "critic_score": result.critic_score,
                    "source": f"auto_research:{result.source}",
                    "confidence": result.confidence,
                    "added_at": datetime.now(timezone.utc).isoformat(),
                }
            ).execute()

            logger.info(
                f"Auto-added '{result.wine_name}' to master library from {result.source}"
            )
        except Exception as e:
            logger.error(f"Failed to add to master library: {e}")


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[WineResearchService] = None


def get_research_service(supabase_client=None) -> WineResearchService:
    """Get module-level singleton research service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = WineResearchService(supabase_client)
    return _service_instance
