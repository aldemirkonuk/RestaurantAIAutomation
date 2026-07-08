"""
OpenTable Discovery Pipeline
=============================
Uses OpenTable as a structured directory to discover wine-focused
restaurants and extract their website URLs + metadata.

No menu content is scraped from OpenTable. It is used purely as
a search engine to find restaurant website URLs.

Discovery flow:
  1. Playwright visits OpenTable search results by city + filters
  2. Extracts: name, cuisine, price range, neighborhood, rating, website URL
  3. Stores in restaurant_directory Supabase table (or local JSON)
  4. Dedup by (restaurant_name, city)

Legal: Only reads publicly visible search result data.
Rate: ~50-100 OpenTable pages per session.
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

# =============================================================================
# CURATED CITY LIST
# =============================================================================

CITY_CONFIGS: List[Dict[str, Any]] = [
    {"name": "New York", "state": "NY", "opentable_metro_id": 4, "slug": "new-york"},
    {
        "name": "San Francisco",
        "state": "CA",
        "opentable_metro_id": 6,
        "slug": "san-francisco",
    },
    {
        "name": "Los Angeles",
        "state": "CA",
        "opentable_metro_id": 8,
        "slug": "los-angeles",
    },
    {"name": "Chicago", "state": "IL", "opentable_metro_id": 3, "slug": "chicago"},
    {"name": "Miami", "state": "FL", "opentable_metro_id": 11, "slug": "miami"},
    {
        "name": "Washington DC",
        "state": "DC",
        "opentable_metro_id": 13,
        "slug": "washington-dc",
    },
    {"name": "Boston", "state": "MA", "opentable_metro_id": 2, "slug": "boston"},
    {"name": "Seattle", "state": "WA", "opentable_metro_id": 9, "slug": "seattle"},
    {"name": "Portland", "state": "OR", "opentable_metro_id": 16, "slug": "portland"},
    {"name": "Nashville", "state": "TN", "opentable_metro_id": 22, "slug": "nashville"},
    {"name": "Denver", "state": "CO", "opentable_metro_id": 5, "slug": "denver"},
    {"name": "Austin", "state": "TX", "opentable_metro_id": 30, "slug": "austin"},
    {
        "name": "Philadelphia",
        "state": "PA",
        "opentable_metro_id": 10,
        "slug": "philadelphia",
    },
    {"name": "Atlanta", "state": "GA", "opentable_metro_id": 1, "slug": "atlanta"},
    {"name": "Las Vegas", "state": "NV", "opentable_metro_id": 15, "slug": "las-vegas"},
]


# =============================================================================
# DATA MODELS
# =============================================================================


def _normalize_name(name: str) -> str:
    """Normalize restaurant name for dedup: lowercase, strip articles, collapse whitespace."""
    n = name.lower().strip()
    n = re.sub(r"^the\s+", "", n)
    n = re.sub(r"[^\w\s]", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


@dataclass
class DiscoveredRestaurant:
    """A restaurant discovered from any source."""

    restaurant_name: str
    city: str
    state: str
    neighborhood: Optional[str] = None
    cuisine_type: Optional[str] = None
    price_range: Optional[str] = None  # $, $$, $$$, $$$$
    rating: Optional[float] = None
    opentable_url: Optional[str] = None
    website_url: Optional[str] = None
    yelp_url: Optional[str] = None
    google_place_id: Optional[str] = None
    discovery_source: str = "opentable"
    discovered_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass
class DiscoveryResult:
    """Result of a discovery session."""

    city: str
    restaurants_found: int = 0
    restaurants_new: int = 0
    restaurants_skipped: int = 0
    pages_crawled: int = 0
    errors: List[str] = field(default_factory=list)


# =============================================================================
# DISCOVERY SERVICE
# =============================================================================


class OpenTableDiscoveryService:
    """
    Discovers wine-focused restaurants using OpenTable as a directory.
    Uses Playwright for JavaScript-rendered content.
    """

    # Rate limiting
    PAGE_DELAY_SECONDS = 2.0
    MAX_PAGES_PER_CITY = 25  # ~500 restaurants per city max
    RESTAURANT_DELAY_SECONDS = 1.0

    def __init__(self, supabase_client=None):
        self._supabase = supabase_client
        self._known_restaurants: Dict[str, set] = {}  # city -> set of names
        DISCOVERY_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # =========================================================================
    # MAIN DISCOVERY
    # =========================================================================

    async def discover_city(
        self,
        city_config: Dict[str, Any],
        max_pages: int = 10,
    ) -> DiscoveryResult:
        """
        Discover restaurants in a city using OpenTable search.

        Args:
            city_config: City configuration from CITY_CONFIGS.
            max_pages: Maximum search result pages to crawl.
        """
        city = city_config["name"]
        state = city_config["state"]
        slug = city_config["slug"]

        result = DiscoveryResult(city=city)

        try:
            from playwright.async_api import async_playwright
        except ImportError:
            result.errors.append(
                "Playwright not installed. Install: pip install playwright && playwright install chromium"
            )
            return result

        # Load known restaurants for dedup
        self._load_known(city)

        restaurants: List[DiscoveredRestaurant] = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            for page_num in range(1, min(max_pages, self.MAX_PAGES_PER_CITY) + 1):
                try:
                    # Build search URL with wine/fine dining focus
                    url = (
                        f"https://www.opentable.com/{slug}/restaurants"
                        f"?page={page_num}&sortBy=rating"
                    )
                    logger.info(f"Crawling OpenTable: {url}")

                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(self.PAGE_DELAY_SECONDS)

                    # Extract restaurant listings from the page
                    listings = await self._extract_listings(page, city, state)

                    if not listings:
                        logger.info(f"No more listings on page {page_num}")
                        break

                    for rest in listings:
                        norm = _normalize_name(rest.restaurant_name)
                        if norm in self._known_restaurants.get(city, set()):
                            result.restaurants_skipped += 1
                            continue

                        restaurants.append(rest)
                        result.restaurants_new += 1

                    result.pages_crawled += 1
                    result.restaurants_found += len(listings)

                except Exception as e:
                    logger.error(f"Error on page {page_num}: {e}")
                    result.errors.append(f"Page {page_num}: {str(e)}")
                    continue

            # For each new restaurant, try to get website URL from profile page
            for rest in restaurants[:50]:  # Limit profile visits per session
                if not rest.website_url:
                    try:
                        rest.website_url = await self._get_website_url(
                            page, rest.opentable_url
                        )
                        await asyncio.sleep(self.RESTAURANT_DELAY_SECONDS)
                    except Exception as e:
                        logger.debug(
                            f"Could not get website for {rest.restaurant_name}: {e}"
                        )

            await browser.close()

        # Save discovered restaurants
        await self._save_discoveries(restaurants, city)

        return result

    # =========================================================================
    # EXTRACT LISTINGS FROM SEARCH PAGE
    # =========================================================================

    async def _extract_listings(
        self, page, city: str, state: str
    ) -> List[DiscoveredRestaurant]:
        """Extract restaurant listings from an OpenTable search results page."""
        restaurants = []

        try:
            # OpenTable uses various selectors for restaurant cards
            cards = await page.query_selector_all(
                '[data-test="restaurant-card"], '
                ".restaurant-card, "
                '[class*="RestaurantCard"], '
                'a[href*="/r/"]'
            )

            for card in cards:
                try:
                    rest = await self._parse_card(card, city, state)
                    if rest:
                        restaurants.append(rest)
                except Exception:
                    continue

        except Exception as e:
            logger.error(f"Failed to extract listings: {e}")

        return restaurants

    async def _parse_card(
        self, card, city: str, state: str
    ) -> Optional[DiscoveredRestaurant]:
        """Parse a single restaurant card element."""
        try:
            # Extract name
            name_el = await card.query_selector(
                'h2, [class*="name"], [class*="Name"], a'
            )
            name = await name_el.inner_text() if name_el else None
            if not name or len(name) < 2:
                return None
            name = name.strip()

            # Extract link
            href = await card.get_attribute("href")
            if not href:
                link_el = await card.query_selector("a[href*='/r/']")
                if link_el:
                    href = await link_el.get_attribute("href")

            opentable_url = None
            if href:
                if href.startswith("/"):
                    opentable_url = f"https://www.opentable.com{href}"
                elif href.startswith("http"):
                    opentable_url = href

            # Extract cuisine type
            cuisine_el = await card.query_selector(
                '[class*="cuisine"], [class*="Cuisine"], '
                '[class*="category"], [class*="Category"]'
            )
            cuisine = await cuisine_el.inner_text() if cuisine_el else None

            # Extract price range
            price_el = await card.query_selector('[class*="price"], [class*="Price"]')
            price_text = await price_el.inner_text() if price_el else None
            price_range = None
            if price_text:
                dollar_count = price_text.count("$")
                if dollar_count > 0:
                    price_range = "$" * dollar_count

            # Extract rating
            rating_el = await card.query_selector(
                '[class*="rating"], [class*="Rating"], '
                '[class*="score"], [class*="Score"]'
            )
            rating_text = await rating_el.inner_text() if rating_el else None
            rating = None
            if rating_text:
                match = re.search(r"(\d+\.?\d*)", rating_text)
                if match:
                    rating = float(match.group(1))

            # Extract neighborhood
            neighborhood_el = await card.query_selector(
                '[class*="neighborhood"], [class*="Neighborhood"], '
                '[class*="location"], [class*="Location"]'
            )
            neighborhood = (
                await neighborhood_el.inner_text() if neighborhood_el else None
            )

            return DiscoveredRestaurant(
                restaurant_name=name,
                city=city,
                state=state,
                neighborhood=neighborhood.strip() if neighborhood else None,
                cuisine_type=cuisine.strip() if cuisine else None,
                price_range=price_range,
                rating=rating,
                opentable_url=opentable_url,
            )

        except Exception:
            return None

    async def _get_website_url(
        self, page, opentable_url: Optional[str]
    ) -> Optional[str]:
        """Visit restaurant's OpenTable profile to find their website URL."""
        if not opentable_url:
            return None

        try:
            await page.goto(opentable_url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(1)

            # Look for external website link
            website_link = await page.query_selector(
                'a[href*="://"][target="_blank"][class*="website"], '
                'a[href*="://"][class*="Website"], '
                'a[data-test="restaurant-website"], '
                'a[href]:not([href*="opentable"]):not([href*="facebook"])'
                ':not([href*="instagram"]):not([href*="twitter"])'
                '[class*="link"]'
            )

            if website_link:
                href = await website_link.get_attribute("href")
                if href and not any(
                    domain in href
                    for domain in [
                        "opentable.com",
                        "facebook.com",
                        "instagram.com",
                        "twitter.com",
                        "yelp.com",
                    ]
                ):
                    return href

        except Exception as e:
            logger.debug(f"Failed to get website URL from {opentable_url}: {e}")

        return None

    # =========================================================================
    # PERSISTENCE
    # =========================================================================

    def _load_known(self, city: str):
        """Load known restaurant names for a city from the directory cache."""
        if city in self._known_restaurants:
            return

        known = set()
        cache_file = DISCOVERY_CACHE_DIR / f"_directory_{self._slugify(city)}.json"
        if cache_file.exists():
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                    known = {
                        _normalize_name(r["restaurant_name"])
                        for r in data.get("restaurants", [])
                    }
            except Exception:
                pass

        self._known_restaurants[city] = known

    async def _save_discoveries(
        self,
        restaurants: List[DiscoveredRestaurant],
        city: str,
    ):
        """Save discovered restaurants to cache file and Supabase."""
        if not restaurants:
            return

        cache_file = DISCOVERY_CACHE_DIR / f"_directory_{self._slugify(city)}.json"

        # Load existing
        existing = []
        if cache_file.exists():
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                    existing = data.get("restaurants", [])
            except Exception:
                pass

        # Merge new restaurants (fuzzy-safe via normalized names)
        existing_names = {_normalize_name(r["restaurant_name"]) for r in existing}
        for rest in restaurants:
            norm = _normalize_name(rest.restaurant_name)
            if norm not in existing_names:
                existing.append(
                    {
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
                    }
                )
                existing_names.add(norm)
                self._known_restaurants.setdefault(city, set()).add(norm)

        # Save updated file
        with open(cache_file, "w") as f:
            json.dump(
                {
                    "city": city,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "total_restaurants": len(existing),
                    "restaurants": existing,
                },
                f,
                indent=2,
            )

        logger.info(
            f"Saved {len(restaurants)} new restaurants for {city} (total: {len(existing)})"
        )

        # Also save to Supabase if available
        if self._supabase:
            for rest in restaurants:
                try:
                    self._supabase.table("restaurant_directory").upsert(
                        {
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
                        },
                        on_conflict="restaurant_name,city",
                    ).execute()
                except Exception as e:
                    logger.debug(
                        f"Supabase upsert failed for {rest.restaurant_name}: {e}"
                    )

    def get_pending_restaurants(self, city: str) -> List[Dict[str, Any]]:
        """Get restaurants that haven't been crawled yet."""
        cache_file = DISCOVERY_CACHE_DIR / f"_directory_{self._slugify(city)}.json"
        if not cache_file.exists():
            return []

        with open(cache_file) as f:
            data = json.load(f)

        return [
            r
            for r in data.get("restaurants", [])
            if r.get("crawl_status") == "pending" and r.get("website_url")
        ]

    @staticmethod
    def _slugify(text: str) -> str:
        slug = text.lower().strip()
        slug = re.sub(r"[^\w\s-]", "", slug)
        slug = re.sub(r"[\s-]+", "_", slug)
        return slug


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[OpenTableDiscoveryService] = None


def get_discovery_service(supabase_client=None) -> OpenTableDiscoveryService:
    """Get module-level singleton discovery service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = OpenTableDiscoveryService(supabase_client)
    return _service_instance
