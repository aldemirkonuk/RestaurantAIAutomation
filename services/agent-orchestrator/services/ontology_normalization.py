"""
Ontology Normalization Helpers
================================
DB-backed lookup helpers for grape alias normalization and region hierarchy traversal.
Used by OntologyValidationService to canonicalize wine record fields before checking.

All functions are synchronous (supabase-py is sync). Each function returns None on
DB error or missing data — callers must handle None gracefully (never crash on missing
ontology data).
"""

import logging
from typing import Any, Dict, List, Optional

from supabase import create_client

from config.settings import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level alias cache (T-09-06: loaded once from DB, no user input reaches it)
# ---------------------------------------------------------------------------

_GRAPE_CACHE: Optional[Dict[str, str]] = None  # {lower_name_or_alias: canonical_name}


def _get_supabase():
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_key)


def _ensure_grape_cache(supabase) -> Dict[str, str]:
    """Load all grape_varieties into a dict mapping any alias/name → canonical_name. Lazy-loaded."""
    global _GRAPE_CACHE
    if _GRAPE_CACHE is not None:
        return _GRAPE_CACHE
    try:
        resp = supabase.table("grape_varieties").select("name,canonical_name,aliases,color").execute()
        cache: Dict[str, str] = {}
        for row in (resp.data or []):
            cache[row["name"].lower()] = row["canonical_name"]
            cache[row["canonical_name"].lower()] = row["canonical_name"]
            for alias in (row.get("aliases") or []):
                cache[alias.lower()] = row["canonical_name"]
        _GRAPE_CACHE = cache
        return cache
    except Exception as exc:
        logger.warning("_ensure_grape_cache failed: %s", exc)
        return {}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def normalize_grape_name(raw_name: str) -> Optional[str]:
    """
    Resolve a raw grape name to its canonical form via the grape_varieties table.

    Lookup strategy:
    1. Check module-level alias cache (covers name, canonical_name, aliases — all case-insensitive)
    2. If cache miss: attempt direct DB ilike query on name column
    3. If still miss: attempt .contains() on aliases array

    Returns the canonical_name string if found, None if no match.
    Never raises — returns None on DB error.
    """
    if not raw_name:
        return None
    raw_lower = raw_name.strip().lower()
    try:
        supabase = _get_supabase()
        cache = _ensure_grape_cache(supabase)
        if raw_lower in cache:
            return cache[raw_lower]
        # Cache miss — direct DB query fallback
        resp = (
            supabase.table("grape_varieties")
            .select("name,canonical_name")
            .ilike("name", raw_lower)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]["canonical_name"]
        # Try aliases array contains (GIN index)
        resp2 = (
            supabase.table("grape_varieties")
            .select("name,canonical_name")
            .contains("aliases", [raw_lower])
            .limit(1)
            .execute()
        )
        if resp2.data:
            return resp2.data[0]["canonical_name"]
        return None
    except Exception as exc:
        logger.warning("normalize_grape_name failed for %r: %s", raw_name, exc)
        return None


def normalize_grape_name_batch(raw_names: List[str]) -> Dict[str, Optional[str]]:
    """Batch version: returns {raw_name: canonical_name_or_None}."""
    return {name: normalize_grape_name(name) for name in raw_names}


def lookup_appellation_rules(appellation_name: str) -> Optional[Dict[str, Any]]:
    """
    Fetch the appellation_rules row for a given appellation name.

    Lookup: appellation_rules.appellation_name ILIKE :appellation_name
    Returns the full row dict, or None if not found.
    Never raises.
    """
    if not appellation_name:
        return None
    try:
        supabase = _get_supabase()
        resp = (
            supabase.table("appellation_rules")
            .select(
                "id,appellation_id,appellation_name,required_grapes,allowed_grapes,"
                "min_aging_months,min_vintage_release_delay_months,allowed_colors,"
                "max_yield_hl_ha,classification_levels,effective_from,effective_to"
            )
            .ilike("appellation_name", appellation_name.strip())
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None
    except Exception as exc:
        logger.warning("lookup_appellation_rules failed for %r: %s", appellation_name, exc)
        return None


def lookup_region_by_name(region_name: str) -> Optional[Dict[str, Any]]:
    """
    Fetch a wine_regions row by name (case-insensitive exact match).
    Returns the row with all columns, or None.
    Prefers level='appellation' when multiple rows match (more specific).
    """
    if not region_name:
        return None
    try:
        supabase = _get_supabase()
        resp = (
            supabase.table("wine_regions")
            .select("id,name,level,parent_id,country_code,canonical_name,aliases,path")
            .ilike("name", region_name.strip())
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        # Prefer appellation level for specificity
        for row in rows:
            if row.get("level") == "appellation":
                return row
        return rows[0]
    except Exception as exc:
        logger.warning("lookup_region_by_name failed for %r: %s", region_name, exc)
        return None


def get_region_ancestors(region_id: str) -> List[Dict[str, Any]]:
    """
    Walk up the parent_id chain from region_id to the root (country).
    Returns list of wine_regions rows from region → country (ascending).

    Implementation: iterative parent_id chase (not recursive SQL CTE, since supabase-py
    does not support raw SQL). Maximum 10 hops to prevent infinite loops (T-09-07).
    Returns [] on DB error or if region_id not found.
    """
    if not region_id:
        return []
    try:
        supabase = _get_supabase()
        ancestors: List[Dict[str, Any]] = []
        current_id: Optional[str] = region_id
        visited: set = set()
        for _ in range(10):  # max 10 hops (T-09-07)
            if current_id in visited:
                break
            visited.add(current_id)
            resp = (
                supabase.table("wine_regions")
                .select("id,name,level,parent_id,country_code,canonical_name")
                .eq("id", current_id)
                .maybe_single()
                .execute()
            )
            if not resp.data:
                break
            row = resp.data
            ancestors.append(row)
            if row.get("parent_id") is None:
                break  # reached root (country level)
            current_id = row["parent_id"]
        return ancestors
    except Exception as exc:
        logger.warning("get_region_ancestors failed for region_id=%r: %s", region_id, exc)
        return []


def get_country_for_appellation(appellation_name: str) -> Optional[str]:
    """
    Convenience: given appellation_name, return the ISO country_code by walking ancestors.
    Returns country_code string (e.g. 'FR', 'IT') or None.
    """
    if not appellation_name:
        return None
    region_row = lookup_region_by_name(appellation_name)
    if not region_row:
        return None
    # First check if country_code is on the row itself
    if region_row.get("country_code"):
        return region_row["country_code"]
    # Walk ancestors to find country_code
    ancestors = get_region_ancestors(region_row["id"])
    for ancestor in ancestors:
        if ancestor.get("country_code"):
            return ancestor["country_code"]
        if ancestor.get("level") == "country":
            # Use canonical_name as fallback identifier
            return ancestor.get("country_code")
    return None


def get_region_for_appellation(appellation_name: str) -> Optional[Dict[str, Any]]:
    """
    Convenience: given appellation_name, return the region-level ancestor row.
    Returns wine_regions row with level='region', or None.
    Used for deterministic autofill (appellation → region).
    """
    if not appellation_name:
        return None
    region_row = lookup_region_by_name(appellation_name)
    if not region_row:
        return None
    ancestors = get_region_ancestors(region_row["id"])
    for ancestor in ancestors:
        if ancestor.get("level") == "region":
            return ancestor
    return None


def get_grape_color(canonical_grape_name: str) -> Optional[str]:
    """
    Return grape_varieties.color for a canonical grape name.
    Returns 'red', 'white', 'rosé', 'orange', or None.
    """
    if not canonical_grape_name:
        return None
    try:
        supabase = _get_supabase()
        resp = (
            supabase.table("grape_varieties")
            .select("color")
            .ilike("canonical_name", canonical_grape_name.strip())
            .limit(1)
            .execute()
        )
        if resp.data:
            color = resp.data[0].get("color")
            return color if color and color != "unknown" else None
        return None
    except Exception as exc:
        logger.warning("get_grape_color failed for %r: %s", canonical_grape_name, exc)
        return None
