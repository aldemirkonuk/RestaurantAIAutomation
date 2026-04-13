"""
Google Maps Discovery Service
==============================
Uses the Google Maps Places API (New) Text Search to discover
wine-focused restaurants across curated cities.

Only metadata is collected (name, address, rating, website URL).
No menu content is scraped from Google.

Uses `requests` (already in requirements) — no extra dependencies.
Rate: 2-second delay between requests, respects API quotas.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests as http_requests

from services.opentable_discovery import DiscoveredRestaurant

logger = logging.getLogger(__name__)

PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

FIELD_MASK = ",".join([
    "places.displayName",
    "places.formattedAddress",
    "places.id",
    "places.rating",
    "places.priceLevel",
    "places.websiteUri",
    "places.types",
    "places.userRatingCount",
    "nextPageToken",
])

CITY_CONFIGS: List[Dict[str, Any]] = [
    # Bay Area priority
    {"name": "Palo Alto", "state": "CA"},
    {"name": "San Jose", "state": "CA"},
    {"name": "Oakland", "state": "CA"},
    {"name": "Napa", "state": "CA"},
    {"name": "Sonoma", "state": "CA"},
    {"name": "Berkeley", "state": "CA"},
    {"name": "Walnut Creek", "state": "CA"},
    # Chicago neighborhoods
    {"name": "River North", "state": "IL"},
    {"name": "Downtown / Loop", "state": "IL"},
    # Major metros
    {"name": "New York", "state": "NY"},
    {"name": "San Francisco", "state": "CA"},
    {"name": "Los Angeles", "state": "CA"},
    {"name": "Chicago", "state": "IL"},
    {"name": "Miami", "state": "FL"},
    {"name": "Washington DC", "state": "DC"},
    {"name": "Boston", "state": "MA"},
    {"name": "Seattle", "state": "WA"},
    {"name": "Portland", "state": "OR"},
    {"name": "Nashville", "state": "TN"},
    {"name": "Denver", "state": "CO"},
    {"name": "Austin", "state": "TX"},
    {"name": "Philadelphia", "state": "PA"},
    {"name": "Atlanta", "state": "GA"},
    {"name": "Las Vegas", "state": "NV"},
]

PRICE_LEVEL_MAP = {
    "PRICE_LEVEL_FREE": "$",
    "PRICE_LEVEL_INEXPENSIVE": "$",
    "PRICE_LEVEL_MODERATE": "$$",
    "PRICE_LEVEL_EXPENSIVE": "$$$",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$",
}

DEFAULT_QUERIES = [
    "wine restaurant",
    "wine bar",
    "fine dining restaurant",
    "Michelin restaurant",
    "steakhouse",
    "Italian restaurant",
    "French restaurant",
    "tasting menu restaurant",
    "seafood restaurant",
    "cocktail wine bar",
    "mediterranean restaurant",
    "award winning restaurant",
    "editor's choice restaurant",
]

MIN_RATING = 3.6
MIN_PRICE_LEVEL_INDEX = 3  # $$$ or higher


@dataclass
class GoogleMapsDiscoveryResult:
    """Result of a Google Maps discovery session for one city."""
    city: str
    restaurants_found: int = 0
    restaurants_new: int = 0
    restaurants_filtered: int = 0
    queries_run: int = 0
    errors: List[str] = field(default_factory=list)


class GoogleMapsDiscoveryService:
    """
    Discovers wine-focused restaurants via Google Maps Places API (New).
    Uses Text Search with pagination (up to 60 results per query).
    """

    REQUEST_DELAY_S = 2.0
    MAX_PAGES_PER_QUERY = 3  # 20 results/page x 3 = 60 max

    def __init__(self, api_key: str, supabase_client=None):
        self._api_key = api_key
        self._supabase = supabase_client
        self._seen_place_ids: set = set()

    def discover_city(
        self,
        city_name: str,
        state: str,
        queries: Optional[List[str]] = None,
    ) -> GoogleMapsDiscoveryResult:
        """
        Discover restaurants in a city using wine-focused search queries.
        Synchronous — uses requests library.
        """
        search_queries = queries or DEFAULT_QUERIES
        result = GoogleMapsDiscoveryResult(city=city_name)

        for query_template in search_queries:
            full_query = f"{query_template} in {city_name}, {state}"
            try:
                restaurants = self._search_with_pagination(full_query, city_name, state)
                result.queries_run += 1

                for rest in restaurants:
                    if rest.google_place_id in self._seen_place_ids:
                        continue
                    self._seen_place_ids.add(rest.google_place_id)
                    result.restaurants_found += 1

                    if self._passes_quality_filter(rest):
                        result.restaurants_new += 1
                    else:
                        result.restaurants_filtered += 1

            except Exception as e:
                logger.error(f"Google Maps query failed: {full_query}: {e}")
                result.errors.append(f"{full_query}: {str(e)}")

        logger.info(
            f"Google Maps discovery for {city_name}: "
            f"{result.restaurants_found} found, {result.restaurants_new} passed filter"
        )
        return result

    def discover_city_restaurants(
        self,
        city_name: str,
        state: str,
        queries: Optional[List[str]] = None,
    ) -> List[DiscoveredRestaurant]:
        """
        Discover and return the filtered restaurant list for a city.
        """
        search_queries = queries or DEFAULT_QUERIES
        all_restaurants: List[DiscoveredRestaurant] = []
        seen_ids: set = set()

        for query_template in search_queries:
            full_query = f"{query_template} in {city_name}, {state}"
            try:
                restaurants = self._search_with_pagination(full_query, city_name, state)
                for rest in restaurants:
                    pid = rest.google_place_id
                    if pid and pid not in seen_ids:
                        seen_ids.add(pid)
                        if self._passes_quality_filter(rest):
                            all_restaurants.append(rest)
            except Exception as e:
                logger.error(f"Google Maps query failed: {full_query}: {e}")

        return all_restaurants

    def _search_with_pagination(
        self,
        text_query: str,
        city: str,
        state: str,
    ) -> List[DiscoveredRestaurant]:
        """Execute Text Search with nextPageToken pagination (up to 60 results)."""
        all_restaurants: List[DiscoveredRestaurant] = []
        page_token: Optional[str] = None

        for page_num in range(self.MAX_PAGES_PER_QUERY):
            restaurants, next_token = self._search_page(
                text_query, city, state, page_token
            )
            all_restaurants.extend(restaurants)

            if not next_token:
                break
            page_token = next_token
            time.sleep(self.REQUEST_DELAY_S)

        return all_restaurants

    def _search_page(
        self,
        text_query: str,
        city: str,
        state: str,
        page_token: Optional[str] = None,
    ) -> tuple:
        """Execute a single Text Search request, return (restaurants, nextPageToken)."""
        headers = {
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": FIELD_MASK,
            "Content-Type": "application/json",
        }

        body: Dict[str, Any] = {
            "textQuery": text_query,
            "maxResultCount": 20,
            "priceLevels": ["PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"],
            "minRating": MIN_RATING,
        }

        if page_token:
            body["pageToken"] = page_token

        resp = http_requests.post(
            PLACES_TEXT_SEARCH_URL, json=body, headers=headers, timeout=30
        )
        resp.raise_for_status()
        data = resp.json()

        restaurants: List[DiscoveredRestaurant] = []
        for place in data.get("places", []):
            rest = self._parse_place(place, city, state)
            if rest:
                restaurants.append(rest)

        next_page_token = data.get("nextPageToken")
        time.sleep(self.REQUEST_DELAY_S)

        return restaurants, next_page_token

    def _parse_place(
        self, place: Dict[str, Any], city: str, state: str
    ) -> Optional[DiscoveredRestaurant]:
        """Parse a Places API result into a DiscoveredRestaurant."""
        display_name = place.get("displayName", {})
        name = display_name.get("text") if isinstance(display_name, dict) else str(display_name)
        if not name:
            return None

        address = place.get("formattedAddress", "")
        place_id = place.get("id", "")
        rating = place.get("rating")
        price_level_str = place.get("priceLevel", "")
        website = place.get("websiteUri")
        primary_type = place.get("primaryType", "")

        price_range = PRICE_LEVEL_MAP.get(price_level_str)

        neighborhood = None
        if address:
            parts = [p.strip() for p in address.split(",")]
            if len(parts) >= 3:
                neighborhood = parts[-3]

        rest = DiscoveredRestaurant(
            restaurant_name=name.strip(),
            city=city,
            state=state,
            neighborhood=neighborhood,
            cuisine_type=primary_type or None,
            price_range=price_range,
            rating=rating,
            website_url=website,
            google_place_id=place_id,
            discovery_source="google_maps",
        )
        return rest

    def _passes_quality_filter(self, rest: DiscoveredRestaurant) -> bool:
        """Filter for wine-worthy restaurants (rating >= 4.0, price >= $$$)."""
        if rest.rating is not None and rest.rating < MIN_RATING:
            return False
        if rest.price_range and rest.price_range.count("$") < MIN_PRICE_LEVEL_INDEX:
            return False
        return True


_service_instance: Optional[GoogleMapsDiscoveryService] = None


def get_google_maps_service(
    api_key: Optional[str] = None,
    supabase_client=None,
) -> Optional[GoogleMapsDiscoveryService]:
    """Get module-level singleton. Returns None if no API key is available."""
    global _service_instance
    if _service_instance is None:
        if not api_key:
            return None
        _service_instance = GoogleMapsDiscoveryService(api_key, supabase_client)
    return _service_instance
