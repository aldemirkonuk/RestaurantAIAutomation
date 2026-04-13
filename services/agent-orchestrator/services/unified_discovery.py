"""
Unified Discovery Service
==========================
Orchestrates restaurant discovery from multiple sources
(Google Maps, OpenTable — Yelp pluggable later) with
cross-source deduplication.

Flow:
  1. Run discovery on selected sources for a given city
  2. Merge results with fuzzy dedup (Jaro-Winkler > 0.9 on normalized name+city)
  3. Save to Supabase restaurant_directory table (+ local JSON cache)
  4. Optionally auto-chain to WebCrawlerService for pending restaurants
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DISCOVERY_CACHE_DIR = PROJECT_ROOT / "datasets" / "restaurant_menus"


def _normalize_name(name: str) -> str:
    """Normalize restaurant name for dedup: lowercase, strip articles, collapse whitespace."""
    n = name.lower().strip()
    n = re.sub(r"^the\s+", "", n)
    n = re.sub(r"[^\w\s]", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _jaro_winkler(s1: str, s2: str) -> float:
    """Jaro-Winkler similarity between two strings (0.0 to 1.0)."""
    if s1 == s2:
        return 1.0
    len1, len2 = len(s1), len(s2)
    if len1 == 0 or len2 == 0:
        return 0.0

    match_distance = max(len1, len2) // 2 - 1
    if match_distance < 0:
        match_distance = 0

    s1_matches = [False] * len1
    s2_matches = [False] * len2
    matches = 0
    transpositions = 0

    for i in range(len1):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len2)
        for j in range(start, end):
            if s2_matches[j] or s1[i] != s2[j]:
                continue
            s1_matches[i] = True
            s2_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    k = 0
    for i in range(len1):
        if not s1_matches[i]:
            continue
        while not s2_matches[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1

    jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3

    prefix_len = 0
    for i in range(min(len1, len2, 4)):
        if s1[i] == s2[i]:
            prefix_len += 1
        else:
            break

    return jaro + prefix_len * 0.1 * (1 - jaro)


DEDUP_THRESHOLD = 0.9


@dataclass
class UnifiedDiscoveryResult:
    """Aggregated result across all sources for one city."""
    city: str
    google_maps_found: int = 0
    opentable_found: int = 0
    total_after_dedup: int = 0
    duplicates_removed: int = 0
    saved_to_db: int = 0
    auto_chained: int = 0
    errors: List[str] = field(default_factory=list)


class UnifiedDiscoveryService:
    """
    Orchestrates multi-source restaurant discovery with cross-source dedup.
    Structured for easy Yelp addition later (just add elif branch).
    """

    def __init__(self, settings, supabase_client=None):
        self._settings = settings
        self._supabase = supabase_client
        DISCOVERY_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    async def discover_city(
        self,
        city_name: str,
        state: str,
        sources: Optional[List[str]] = None,
        auto_chain: Optional[bool] = None,
    ) -> UnifiedDiscoveryResult:
        """
        Discover restaurants in a city from multiple sources.

        Args:
            city_name: City name (e.g. "New York")
            state: State abbreviation (e.g. "NY")
            sources: List of sources to use. Defaults to settings.
            auto_chain: Whether to auto-queue for crawling. Defaults to settings.
        """
        from services.opentable_discovery import (
            DiscoveredRestaurant, OpenTableDiscoveryService, CITY_CONFIGS,
        )
        from services.google_maps_discovery import GoogleMapsDiscoveryService

        if sources is None:
            sources = [s.strip() for s in self._settings.crawl_discovery_sources.split(",")]
        if auto_chain is None:
            auto_chain = self._settings.crawl_auto_chain_discovery_to_crawl

        result = UnifiedDiscoveryResult(city=city_name)
        all_restaurants: List[DiscoveredRestaurant] = []

        for source in sources:
            if source == "google_maps":
                if not self._settings.google_maps_api_key:
                    result.errors.append("google_maps: no API key configured")
                    continue
                try:
                    gm_service = GoogleMapsDiscoveryService(
                        api_key=self._settings.google_maps_api_key,
                        supabase_client=self._supabase,
                    )
                    queries = [
                        q.strip()
                        for q in self._settings.crawl_google_maps_queries.split(",")
                    ]
                    gm_restaurants = gm_service.discover_city_restaurants(
                        city_name, state, queries
                    )
                    for r in gm_restaurants:
                        r.discovery_source = "google_maps"
                    all_restaurants.extend(gm_restaurants)
                    result.google_maps_found = len(gm_restaurants)
                    logger.info(f"Google Maps: {len(gm_restaurants)} restaurants for {city_name}")
                except Exception as e:
                    logger.error(f"Google Maps discovery failed for {city_name}: {e}")
                    result.errors.append(f"google_maps: {str(e)}")

            elif source == "opentable":
                try:
                    ot_service = OpenTableDiscoveryService(self._supabase)
                    city_config = next(
                        (c for c in CITY_CONFIGS if c["name"] == city_name), None
                    )
                    if city_config:
                        await ot_service.discover_city(city_config, max_pages=5)
                        pending = ot_service.get_pending_restaurants(city_name)
                        ot_restaurants = []
                        for p in pending:
                            r = DiscoveredRestaurant(
                                restaurant_name=p["restaurant_name"],
                                city=p["city"],
                                state=p.get("state", state),
                                neighborhood=p.get("neighborhood"),
                                cuisine_type=p.get("cuisine_type"),
                                price_range=p.get("price_range"),
                                rating=p.get("rating"),
                                opentable_url=p.get("opentable_url"),
                                website_url=p.get("website_url"),
                                discovery_source="opentable",
                            )
                            ot_restaurants.append(r)
                        all_restaurants.extend(ot_restaurants)
                        result.opentable_found = len(ot_restaurants)
                        logger.info(f"OpenTable: {len(ot_restaurants)} restaurants for {city_name}")
                except Exception as e:
                    logger.error(f"OpenTable discovery failed for {city_name}: {e}")
                    result.errors.append(f"opentable: {str(e)}")

            elif source == "yelp":
                # Yelp deferred — add YelpDiscoveryService import + call here
                logger.info("Yelp discovery not yet implemented — skipping")
                continue

            else:
                logger.warning(f"Unknown discovery source: {source}")

        # --- Cross-source dedup ---
        deduped = self._deduplicate(all_restaurants)
        result.duplicates_removed = len(all_restaurants) - len(deduped)
        result.total_after_dedup = len(deduped)

        # --- Save to local JSON cache ---
        self._save_to_json_cache(deduped, city_name)

        # --- Save to Supabase ---
        if self._supabase and deduped:
            saved = self._save_to_db(deduped)
            result.saved_to_db = saved

        # --- Auto-chain to crawler ---
        if auto_chain and deduped:
            chained = await self._auto_chain_crawl(deduped)
            result.auto_chained = chained

        logger.info(
            f"Unified discovery for {city_name}: "
            f"{result.total_after_dedup} unique restaurants "
            f"({result.duplicates_removed} duplicates removed)"
        )
        return result

    async def discover_all_cities(
        self,
        sources: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Run discovery across all 15 curated US cities.
        Returns aggregated stats.
        """
        from services.opentable_discovery import CITY_CONFIGS
        from services.google_maps_discovery import CITY_CONFIGS as GM_CITIES

        city_list = GM_CITIES
        stats = {"cities": [], "total_new": 0, "total_deduped": 0}

        for city_config in city_list:
            try:
                result = await self.discover_city(
                    city_name=city_config["name"],
                    state=city_config["state"],
                    sources=sources,
                )
                stats["cities"].append({
                    "city": result.city,
                    "google_maps": result.google_maps_found,
                    "opentable": result.opentable_found,
                    "after_dedup": result.total_after_dedup,
                    "duplicates_removed": result.duplicates_removed,
                    "saved_to_db": result.saved_to_db,
                    "auto_chained": result.auto_chained,
                })
                stats["total_new"] += result.total_after_dedup
                stats["total_deduped"] += result.duplicates_removed
            except Exception as e:
                stats["cities"].append({
                    "city": city_config["name"],
                    "error": str(e),
                })

        return stats

    # =========================================================================
    # DEDUP
    # =========================================================================

    def _deduplicate(self, restaurants) -> list:
        """Remove cross-source duplicates using Jaro-Winkler similarity > 0.9."""
        if not restaurants:
            return []

        unique = []
        normalized_keys = []

        for rest in restaurants:
            norm = _normalize_name(rest.restaurant_name)
            norm_city = _normalize_name(rest.city)
            key = f"{norm}|{norm_city}"

            is_dup = False
            for idx, existing_key in enumerate(normalized_keys):
                existing_name, existing_city = existing_key.split("|", 1)
                if norm_city == existing_city:
                    sim = _jaro_winkler(norm, existing_name)
                    if sim >= DEDUP_THRESHOLD:
                        is_dup = True
                        # Merge: prefer Google Maps website_url, keep all source URLs
                        existing_rest = unique[idx]
                        if rest.website_url and not existing_rest.website_url:
                            existing_rest.website_url = rest.website_url
                        if rest.opentable_url and not existing_rest.opentable_url:
                            existing_rest.opentable_url = rest.opentable_url
                        if rest.google_place_id and not existing_rest.google_place_id:
                            existing_rest.google_place_id = rest.google_place_id
                        break

            if not is_dup:
                unique.append(rest)
                normalized_keys.append(key)

        return unique

    # =========================================================================
    # PERSISTENCE
    # =========================================================================

    def _save_to_json_cache(self, restaurants, city_name: str):
        """Save discovered restaurants to local JSON cache."""
        if not restaurants:
            return

        slug = re.sub(r"[^\w]", "_", city_name.lower())
        cache_file = DISCOVERY_CACHE_DIR / f"_unified_{slug}.json"

        existing = []
        if cache_file.exists():
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                    existing = data.get("restaurants", [])
            except Exception:
                pass

        existing_names = {_normalize_name(r["restaurant_name"]) for r in existing}
        for rest in restaurants:
            norm = _normalize_name(rest.restaurant_name)
            if norm not in existing_names:
                existing.append({
                    "restaurant_name": rest.restaurant_name,
                    "city": rest.city,
                    "state": rest.state,
                    "neighborhood": rest.neighborhood,
                    "cuisine_type": rest.cuisine_type,
                    "price_range": rest.price_range,
                    "rating": rest.rating,
                    "opentable_url": rest.opentable_url,
                    "website_url": rest.website_url,
                    "yelp_url": rest.yelp_url,
                    "google_place_id": rest.google_place_id,
                    "discovery_source": rest.discovery_source,
                    "discovered_at": rest.discovered_at,
                    "crawl_status": "pending",
                })
                existing_names.add(norm)

        with open(cache_file, "w") as f:
            json.dump({
                "city": city_name,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "total_restaurants": len(existing),
                "restaurants": existing,
            }, f, indent=2)

        logger.info(f"Cached {len(restaurants)} restaurants for {city_name}")

    def _save_to_db(self, restaurants) -> int:
        """Upsert restaurants into Supabase restaurant_directory."""
        saved = 0
        for rest in restaurants:
            try:
                row = {
                    "restaurant_name": rest.restaurant_name,
                    "city": rest.city,
                    "state": rest.state,
                    "neighborhood": rest.neighborhood,
                    "cuisine_type": rest.cuisine_type,
                    "price_range": rest.price_range,
                    "rating": rest.rating,
                    "opentable_url": rest.opentable_url,
                    "website_url": rest.website_url,
                    "yelp_url": rest.yelp_url,
                    "google_place_id": rest.google_place_id,
                    "discovery_sources": [rest.discovery_source],
                    "crawl_status": "pending",
                }
                self._supabase.table("restaurant_directory").upsert(
                    row, on_conflict="restaurant_name,city"
                ).execute()
                saved += 1
            except Exception as e:
                logger.debug(f"DB upsert failed for {rest.restaurant_name}: {e}")
        return saved

    async def _auto_chain_crawl(self, restaurants) -> int:
        """Queue restaurants with website URLs for crawling."""
        from services.web_crawler import get_crawler_service

        crawler = get_crawler_service(
            rate_limit=self._settings.crawl_rate_limit_per_day
        )
        chained = 0
        for rest in restaurants:
            if rest.website_url and crawler.remaining_today > 0:
                try:
                    await crawler.crawl_restaurant(rest.website_url, rest.restaurant_name)
                    chained += 1
                except Exception as e:
                    logger.debug(f"Auto-chain crawl failed for {rest.restaurant_name}: {e}")
        return chained


_service_instance: Optional[UnifiedDiscoveryService] = None


def get_unified_discovery_service(
    settings=None, supabase_client=None
) -> UnifiedDiscoveryService:
    """Get module-level singleton."""
    global _service_instance
    if _service_instance is None:
        if settings is None:
            from config.settings import get_settings
            settings = get_settings()
        _service_instance = UnifiedDiscoveryService(settings, supabase_client)
    return _service_instance
