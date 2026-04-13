"""
Restaurant Wine Menu Dataset Service
=====================================
Saves each restaurant's wine menu as a structured dataset for
future AI recommendations, wine pairing, and market intelligence.

Schema (evolving - start minimal):
  Phase 1: restaurant_name, city, menu_date, source, sections, wines, total_wines
  Phase 2: + cuisine_type, price_tier, sommelier, food_menu, distributions

Storage:
  - Supabase: restaurant_wine_menus table (for API queries)
  - JSONL files: datasets/restaurant_menus/{city}.jsonl (for batch processing)

Versioned: each re-scan creates a new dated snapshot.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
RESTAURANT_MENUS_DIR = PROJECT_ROOT / "datasets" / "restaurant_menus"


# =============================================================================
# DATA MODELS
# =============================================================================

class RestaurantWineEntry(BaseModel):
    """A single wine on a restaurant's menu."""
    master_wine_id: Optional[str] = None
    wine_name: str
    producer: Optional[str] = None
    vintage: Optional[int] = None
    primary_type: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    grape_variety: Optional[str] = None
    classification: Optional[str] = None
    price_bottle: Optional[float] = None
    price_glass: Optional[float] = None
    currency: str = "USD"
    serving_type: Optional[str] = None
    menu_position: Optional[int] = None
    extraction_confidence: float = 0.0


class RestaurantMenuSection(BaseModel):
    """A section in the restaurant's wine menu."""
    name: str
    hierarchy_path: str = ""
    wines: List[RestaurantWineEntry] = Field(default_factory=list)


class RestaurantMenuSnapshot(BaseModel):
    """A point-in-time snapshot of a restaurant's wine menu."""
    restaurant_id: Optional[str] = None
    restaurant_name: str
    city: str
    state: Optional[str] = None
    menu_date: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d")
    )
    source_type: str = "unknown"  # public_pdf, html, user_upload, scraped, etc.
    source_url: Optional[str] = None
    extraction_method: str = "free"  # free, surya_ocr, gemini_text, gemini_vision
    extraction_confidence: float = 0.0
    human_verified: bool = False
    total_wines: int = 0
    sections: List[RestaurantMenuSection] = Field(default_factory=list)
    # Phase 2 fields (populated later)
    cuisine_type: Optional[str] = None
    price_range: Optional[str] = None
    neighborhood: Optional[str] = None
    rating: Optional[float] = None
    opentable_url: Optional[str] = None
    website_url: Optional[str] = None


# =============================================================================
# SERVICE
# =============================================================================

class RestaurantDatasetService:
    """
    Manages per-restaurant wine menu datasets.
    Saves to both JSONL files and (optionally) Supabase.
    """

    def __init__(self, supabase_client=None):
        self._supabase = supabase_client
        RESTAURANT_MENUS_DIR.mkdir(parents=True, exist_ok=True)

    # =========================================================================
    # SAVE SNAPSHOT
    # =========================================================================

    async def save_snapshot(
        self,
        snapshot: RestaurantMenuSnapshot,
    ) -> Dict[str, Any]:
        """
        Save a restaurant menu snapshot to JSONL + Supabase.

        Args:
            snapshot: The menu snapshot to save.

        Returns:
            Dict with save status and file path.
        """
        # Normalize city for filename
        city_slug = self._slugify(snapshot.city)
        jsonl_path = RESTAURANT_MENUS_DIR / f"{city_slug}.jsonl"

        # Serialize to JSON line
        data = snapshot.model_dump()
        data["saved_at"] = datetime.now(timezone.utc).isoformat()

        # Append to city JSONL file
        with open(jsonl_path, "a") as f:
            f.write(json.dumps(data, default=str) + "\n")

        logger.info(
            f"Saved menu snapshot: {snapshot.restaurant_name} ({snapshot.city}) "
            f"-> {snapshot.total_wines} wines -> {jsonl_path.name}"
        )

        # Save to Supabase if available
        supabase_id = None
        if self._supabase:
            try:
                supabase_id = await self._save_to_supabase(data)
            except Exception as e:
                logger.warning(f"Supabase save failed: {e}")

        return {
            "status": "saved",
            "jsonl_path": str(jsonl_path),
            "city_file": jsonl_path.name,
            "supabase_id": supabase_id,
            "total_wines": snapshot.total_wines,
        }

    # =========================================================================
    # BUILD SNAPSHOT FROM PARSE RESULT
    # =========================================================================

    def build_snapshot(
        self,
        parse_result: Dict[str, Any],
        restaurant_name: str,
        city: str,
        state: Optional[str] = None,
        source_type: str = "unknown",
        source_url: Optional[str] = None,
        extraction_method: str = "free",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> RestaurantMenuSnapshot:
        """
        Build a RestaurantMenuSnapshot from a menu parse result.

        Args:
            parse_result: Output from HtmlMenuParser.parse_menu() or VLM extraction.
            restaurant_name: Name of the restaurant.
            city: City where the restaurant is located.
            state: State (US) or province.
            source_type: How the menu was obtained.
            source_url: URL where menu was found.
            extraction_method: Which method extracted the data.
            metadata: Additional metadata from OpenTable discovery, etc.
        """
        wines_data = parse_result.get("wines", [])
        sections_data = parse_result.get("sections", [])

        # Build sections with their wines
        section_map: Dict[str, RestaurantMenuSection] = {}
        unsectioned_wines: List[RestaurantWineEntry] = []

        for i, wine in enumerate(wines_data):
            entry = RestaurantWineEntry(
                wine_name=wine.get("wine_name", "Unknown"),
                producer=wine.get("producer"),
                vintage=wine.get("vintage"),
                primary_type=wine.get("wine_type"),
                country=wine.get("country"),
                region=wine.get("region"),
                grape_variety=wine.get("grape_variety"),
                classification=wine.get("classification"),
                price_bottle=wine.get("price") if wine.get("serving_type") != "glass" else None,
                price_glass=wine.get("price") if wine.get("serving_type") == "glass" else None,
                currency=wine.get("price_currency", "USD"),
                serving_type=wine.get("serving_type"),
                menu_position=i + 1,
                extraction_confidence=wine.get("confidence", 0.0),
            )

            section_path = wine.get("section_path", "")
            if section_path:
                if section_path not in section_map:
                    section_map[section_path] = RestaurantMenuSection(
                        name=section_path.split("/")[-1],
                        hierarchy_path=section_path,
                    )
                section_map[section_path].wines.append(entry)
            else:
                unsectioned_wines.append(entry)

        # Build final sections list
        sections = list(section_map.values())
        if unsectioned_wines:
            sections.append(RestaurantMenuSection(
                name="Uncategorized",
                hierarchy_path="",
                wines=unsectioned_wines,
            ))

        # Apply metadata from OpenTable discovery if available
        cuisine_type = None
        price_range = None
        neighborhood = None
        rating = None
        opentable_url = None
        website_url = None

        if metadata:
            cuisine_type = metadata.get("cuisine_type")
            price_range = metadata.get("price_range")
            neighborhood = metadata.get("neighborhood")
            rating = metadata.get("rating")
            opentable_url = metadata.get("opentable_url")
            website_url = metadata.get("website_url")

        return RestaurantMenuSnapshot(
            restaurant_name=restaurant_name,
            city=city,
            state=state,
            source_type=source_type,
            source_url=source_url,
            extraction_method=extraction_method,
            extraction_confidence=parse_result.get("parser_confidence", 0.0),
            total_wines=len(wines_data),
            sections=sections,
            cuisine_type=cuisine_type,
            price_range=price_range,
            neighborhood=neighborhood,
            rating=rating,
            opentable_url=opentable_url,
            website_url=website_url or source_url,
        )

    # =========================================================================
    # QUERY
    # =========================================================================

    def get_restaurants_by_city(self, city: str) -> List[Dict[str, Any]]:
        """Get all restaurant snapshots for a city from JSONL."""
        city_slug = self._slugify(city)
        jsonl_path = RESTAURANT_MENUS_DIR / f"{city_slug}.jsonl"

        if not jsonl_path.exists():
            return []

        restaurants = []
        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        restaurants.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

        return restaurants

    def get_all_cities(self) -> List[Dict[str, Any]]:
        """List all cities with dataset files."""
        cities = []
        for f in sorted(RESTAURANT_MENUS_DIR.glob("*.jsonl")):
            line_count = sum(1 for line in open(f) if line.strip())
            cities.append({
                "city": f.stem.replace("_", " ").title(),
                "file": f.name,
                "restaurant_count": line_count,
            })
        return cities

    # =========================================================================
    # HELPERS
    # =========================================================================

    @staticmethod
    def _slugify(text: str) -> str:
        """Convert text to URL-safe slug for filenames."""
        import re
        slug = text.lower().strip()
        slug = re.sub(r"[^\w\s-]", "", slug)
        slug = re.sub(r"[\s-]+", "_", slug)
        return slug

    async def _save_to_supabase(self, data: Dict[str, Any]) -> Optional[str]:
        """Save snapshot to Supabase restaurant_wine_menus table."""
        if not self._supabase:
            return None

        try:
            result = self._supabase.table("restaurant_wine_menus").insert({
                "restaurant_name": data["restaurant_name"],
                "city": data["city"],
                "state": data.get("state"),
                "menu_date": data["menu_date"],
                "source_type": data["source_type"],
                "source_url": data.get("source_url"),
                "extraction_method": data["extraction_method"],
                "extraction_confidence": data["extraction_confidence"],
                "human_verified": data["human_verified"],
                "total_wines": data["total_wines"],
                "menu_data": data,
            }).execute()

            if result.data:
                return result.data[0].get("id")
        except Exception as e:
            logger.error(f"Supabase insert failed: {e}")
        return None


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[RestaurantDatasetService] = None


def get_restaurant_dataset_service(
    supabase_client=None,
) -> RestaurantDatasetService:
    """Get module-level singleton restaurant dataset service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = RestaurantDatasetService(supabase_client)
    return _service_instance
