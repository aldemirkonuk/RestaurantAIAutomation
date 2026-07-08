"""
Analytics Routes (CRIT-07 + Phase 11 TEMP-07, TEMP-08)
=======================================================
GET /api/v1/analytics/wine/{wine_id}/scores
    Returns aggregated critic scores, composite score, retail price, and
    per-restaurant markup ratios for a wine from master_wine_library.

GET /api/v1/analytics/trends
    Returns velocity-ranked trending wines with category/grape/region breakdown.

GET /api/v1/analytics/wine/{wine_id}/timeline
    Returns the full temporal lifecycle of a wine across all restaurants.

Pattern: follows quality_routes.py (APIRouter prefix, late Supabase import,
         Pydantic response models, UUID validation guard).
"""

import logging
import uuid
from collections import defaultdict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


# =============================================================================
# RESPONSE MODELS
# =============================================================================


class PerRestaurantMarkup(BaseModel):
    restaurant_id: Optional[str] = None
    markup_ratio: Optional[float] = None
    markup_classification: Optional[str] = None


class WineScoresResponse(BaseModel):
    wine_id: str
    wine_name: Optional[str] = None
    critic_scores: Optional[Dict[str, Any]] = None
    retail_price_avg: Optional[float] = None
    scores_last_updated_at: Optional[str] = None
    per_restaurant_markup: List[PerRestaurantMarkup] = []


# =============================================================================
# HELPER
# =============================================================================


def _get_supabase():
    """Return Supabase client. Returns None if not configured (graceful degradation)."""
    try:
        from supabase import create_client
        from config.settings import get_settings

        settings = get_settings()
        return create_client(settings.supabase_url, settings.supabase_key)
    except Exception as exc:
        logger.warning("analytics_routes: Supabase client unavailable: %s", exc)
        return None


# =============================================================================
# ENDPOINT
# =============================================================================


@router.get("/wine/{wine_id}/scores", response_model=WineScoresResponse)
async def get_wine_scores(wine_id: str) -> WineScoresResponse:
    """
    CRIT-07: Return aggregated critic scores, composite score, retail price, and
    per-restaurant markup ratios for a wine.

    Path params:
      wine_id: UUID of the master_wine_library row

    Returns 200 with WineScoresResponse (fields may be null if not yet populated).
    Returns 404 if wine_id not found in master_wine_library.
    Returns 422 if wine_id is not a valid UUID format.
    """
    # V5 Input Validation: UUID format check prevents injection
    try:
        uuid.UUID(wine_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid wine_id: must be a UUID")

    supabase = _get_supabase()
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Fetch wine from master_wine_library
    wine_resp = (
        supabase.table("master_wine_library")
        .select("id, name, critic_scores, retail_price_avg, scores_last_updated_at")
        .eq("id", wine_id)
        .maybe_single()
        .execute()
    )

    if not wine_resp.data:
        raise HTTPException(status_code=404, detail=f"Wine {wine_id} not found")

    wine = wine_resp.data
    critic_scores = wine.get("critic_scores") or {}
    # Normalise empty dict → None for cleaner response
    if critic_scores == {} or critic_scores == "{}":
        critic_scores = None

    # Fetch per-restaurant markup from restaurant_inventory
    inv_resp = (
        supabase.table("restaurant_inventory")
        .select("restaurant_id, markup_ratio, markup_classification")
        .eq("master_wine_id", wine_id)
        .execute()
    )
    inventory_rows = inv_resp.data or []

    per_restaurant = [
        PerRestaurantMarkup(
            restaurant_id=row.get("restaurant_id"),
            markup_ratio=row.get("markup_ratio"),
            markup_classification=row.get("markup_classification"),
        )
        for row in inventory_rows
    ]

    scores_last_updated = wine.get("scores_last_updated_at")
    if scores_last_updated and hasattr(scores_last_updated, "isoformat"):
        scores_last_updated = scores_last_updated.isoformat()

    return WineScoresResponse(
        wine_id=wine_id,
        wine_name=wine.get("name"),
        critic_scores=critic_scores,
        retail_price_avg=wine.get("retail_price_avg"),
        scores_last_updated_at=(
            str(scores_last_updated) if scores_last_updated else None
        ),
        per_restaurant_markup=per_restaurant,
    )


# =============================================================================
# TEMPORAL ANALYTICS MODELS (Phase 11 TEMP-07, TEMP-08)
# =============================================================================


class TrendingWineItem(BaseModel):
    wine_id: str
    wine_name: Optional[str] = None
    trend_score: Optional[float] = None
    delta_30d: Optional[int] = None
    restaurant_count: Optional[int] = None
    burst_detected: bool = False


class CategoryShiftItem(BaseModel):
    name: str
    additions: int
    removals: int
    net_delta: int


class GrapeTrendItem(BaseModel):
    name: str
    additions: int
    removals: int
    net_delta: int


class RegionShiftItem(BaseModel):
    name: str
    additions: int
    removals: int
    net_delta: int


class TrendsResponse(BaseModel):
    metro: Optional[str] = None
    period: str
    trending_up: List[TrendingWineItem] = []
    trending_down: List[TrendingWineItem] = []
    category_shifts: List[CategoryShiftItem] = []
    grape_trends: List[GrapeTrendItem] = []
    region_shifts: List[RegionShiftItem] = []


class WineTimelineResponse(BaseModel):
    wine_id: str
    wine_name: Optional[str] = None
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    restaurants_currently_carrying: int = 0
    price_history: List[Dict[str, Any]] = []
    menu_changes: List[Dict[str, Any]] = []


_PERIOD_MAP = {"30d": 30, "60d": 60, "90d": 90}


# =============================================================================
# TEMPORAL ANALYTICS ENDPOINTS
# =============================================================================


@router.get("/trends", response_model=TrendsResponse)
async def get_trends(
    metro: Optional[str] = None,
    period: str = "90d",
) -> TrendsResponse:
    """
    TEMP-07: Return velocity-ranked trending wines.

    Query params:
      metro: optional city substring filter (e.g., "chicago") — case-insensitive ILIKE
      period: "30d" | "60d" | "90d" (default "90d")

    Returns 200 with TrendsResponse.
    Returns 400 if period is not in {30d, 60d, 90d}.
    """
    if period not in _PERIOD_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"period must be one of: {', '.join(_PERIOD_MAP.keys())}",
        )
    window_days = _PERIOD_MAP[period]

    supabase = _get_supabase()
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Optional metro filter: find restaurant_ids in the metro area
    metro_wine_ids: Optional[set] = None
    if metro:
        metro_norm = metro.strip().lower()
        try:
            rest_resp = (
                supabase.table("restaurant_directory")
                .select("id")
                .ilike("city", f"%{metro_norm}%")
                .execute()
            )
            metro_rest_ids = {row["id"] for row in (rest_resp.data or [])}

            if metro_rest_ids:
                roster_resp = (
                    supabase.table("restaurant_wine_roster")
                    .select("signature_hash")
                    .in_("restaurant_id", list(metro_rest_ids))
                    .execute()
                )
                metro_hashes = {
                    row["signature_hash"] for row in (roster_resp.data or [])
                }

                if metro_hashes:
                    sub_resp = (
                        supabase.table("master_wine_library_submissions")
                        .select("master_wine_id, signature_hash")
                        .in_("signature_hash", list(metro_hashes))
                        .not_.is_("master_wine_id", "null")
                        .execute()
                    )
                    metro_wine_ids = {
                        row["master_wine_id"]
                        for row in (sub_resp.data or [])
                        if row.get("master_wine_id")
                    }
                else:
                    metro_wine_ids = set()
            else:
                metro_wine_ids = set()
        except Exception as exc:
            logger.warning("get_trends: metro filter failed: %s — ignoring metro", exc)
            metro_wine_ids = None

    # Fetch trending_wines for the requested window
    try:
        tw_resp = (
            supabase.table("trending_wines")
            .select(
                "wine_id, trend_score, delta, restaurant_count_end, burst_detected_at"
            )
            .eq("window_days", window_days)
            .order("trend_score", desc=True)
            .limit(100)
            .execute()
        )
        tw_rows = tw_resp.data or []
    except Exception as exc:
        logger.error("get_trends: failed to fetch trending_wines: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to fetch trending data")

    # Fetch wine names + classification fields for display and aggregation
    wine_ids_in_result = [row["wine_id"] for row in tw_rows]
    wine_names: Dict[str, str] = {}
    wine_meta: Dict[str, Dict[str, Any]] = {}
    if wine_ids_in_result:
        try:
            meta_resp = (
                supabase.table("master_wine_library")
                .select("id, name, primary_type, grape_variety, region")
                .in_("id", wine_ids_in_result)
                .execute()
            )
            for row in meta_resp.data or []:
                wine_names[row["id"]] = row.get("name") or ""
                wine_meta[row["id"]] = row
        except Exception:
            pass  # names and meta are optional display data

    # Build response items, applying metro filter if set
    trending_up: List[TrendingWineItem] = []
    trending_down: List[TrendingWineItem] = []

    cat_counts: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"additions": 0, "removals": 0}
    )
    grape_counts: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"additions": 0, "removals": 0}
    )
    region_counts: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"additions": 0, "removals": 0}
    )

    for row in tw_rows:
        wine_id = row["wine_id"]
        if metro_wine_ids is not None and wine_id not in metro_wine_ids:
            continue
        delta = row.get("delta", 0) or 0
        item = TrendingWineItem(
            wine_id=wine_id,
            wine_name=wine_names.get(wine_id),
            trend_score=row.get("trend_score"),
            delta_30d=delta if window_days == 30 else None,
            restaurant_count=row.get("restaurant_count_end"),
            burst_detected=bool(row.get("burst_detected_at")),
        )
        if delta >= 0:
            trending_up.append(item)
        else:
            trending_down.append(item)

        direction = "additions" if delta >= 0 else "removals"
        meta = wine_meta.get(wine_id, {})
        cat_counts[meta.get("primary_type") or "Unknown"][direction] += 1
        grape_counts[meta.get("grape_variety") or "Unknown"][direction] += 1
        region_counts[meta.get("region") or "Unknown"][direction] += 1

    def _build_shift_list(counts: Dict[str, Dict[str, int]], model_cls):
        return [
            model_cls(
                name=k,
                additions=v["additions"],
                removals=v["removals"],
                net_delta=v["additions"] - v["removals"],
            )
            for k, v in sorted(
                counts.items(),
                key=lambda x: x[1]["additions"] - x[1]["removals"],
                reverse=True,
            )
        ]

    return TrendsResponse(
        metro=metro,
        period=period,
        trending_up=trending_up,
        trending_down=trending_down,
        category_shifts=_build_shift_list(cat_counts, CategoryShiftItem),
        grape_trends=_build_shift_list(grape_counts, GrapeTrendItem),
        region_shifts=_build_shift_list(region_counts, RegionShiftItem),
    )


@router.get("/wine/{wine_id}/timeline", response_model=WineTimelineResponse)
async def get_wine_timeline(wine_id: str) -> WineTimelineResponse:
    """
    TEMP-08: Return full temporal lifecycle of a wine across all restaurants.

    Path params:
      wine_id: UUID of the master_wine_library row

    Returns 200 with WineTimelineResponse.
    Returns 404 if wine_id not found in master_wine_library.
    Returns 422 if wine_id is not a valid UUID format.

    Data assembled from:
      - master_wine_library (name lookup)
      - wine_popularity (restaurant_count)
      - restaurant_wine_roster (first_seen_at, last_seen_at via signature_hash)
      - menu_changes (full event history via signature_hash)
    """
    try:
        uuid.UUID(wine_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid wine_id: must be a UUID")

    supabase = _get_supabase()
    if supabase is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    wine_resp = (
        supabase.table("master_wine_library")
        .select("id, name")
        .eq("id", wine_id)
        .maybe_single()
        .execute()
    )
    if not wine_resp.data:
        raise HTTPException(status_code=404, detail=f"Wine {wine_id} not found")

    wine_name = wine_resp.data.get("name")

    sig_hashes: List[str] = []
    try:
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("signature_hash")
            .eq("master_wine_id", wine_id)
            .execute()
        )
        sig_hashes = [
            row["signature_hash"]
            for row in (sub_resp.data or [])
            if row.get("signature_hash")
        ]
    except Exception as exc:
        logger.warning(
            "get_wine_timeline: could not resolve signature_hashes for %s: %s",
            wine_id,
            exc,
        )

    restaurants_carrying = 0
    try:
        pop_resp = (
            supabase.table("wine_popularity")
            .select("restaurant_count")
            .eq("wine_id", wine_id)
            .maybe_single()
            .execute()
        )
        if pop_resp.data:
            restaurants_carrying = pop_resp.data.get("restaurant_count") or 0
    except Exception as exc:
        logger.warning("get_wine_timeline: popularity fetch failed: %s", exc)

    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    price_history: List[Dict[str, Any]] = []

    if sig_hashes:
        try:
            roster_resp = (
                supabase.table("restaurant_wine_roster")
                .select("restaurant_id, first_seen_at, last_seen_at, price_reference")
                .in_("signature_hash", sig_hashes)
                .execute()
            )
            roster_rows = roster_resp.data or []
            if roster_rows:
                first_seens = [
                    r["first_seen_at"] for r in roster_rows if r.get("first_seen_at")
                ]
                last_seens = [
                    r["last_seen_at"] for r in roster_rows if r.get("last_seen_at")
                ]
                if first_seens:
                    first_seen_at = min(first_seens)
                if last_seens:
                    last_seen_at = max(last_seens)
                price_history = [
                    {
                        "restaurant_id": r.get("restaurant_id"),
                        "price_reference": r.get("price_reference"),
                        "last_seen_at": r.get("last_seen_at"),
                    }
                    for r in roster_rows
                    if r.get("price_reference") is not None
                ]
        except Exception as exc:
            logger.warning("get_wine_timeline: roster fetch failed: %s", exc)

    changes: List[Dict[str, Any]] = []
    if sig_hashes:
        try:
            changes_resp = (
                supabase.table("menu_changes")
                .select("restaurant_id, change_type, old_value, new_value, detected_at")
                .in_("wine_signature_hash", sig_hashes)
                .order("detected_at", desc=True)
                .limit(200)
                .execute()
            )
            changes = changes_resp.data or []
        except Exception as exc:
            logger.warning("get_wine_timeline: menu_changes fetch failed: %s", exc)

    return WineTimelineResponse(
        wine_id=wine_id,
        wine_name=wine_name,
        first_seen_at=str(first_seen_at) if first_seen_at else None,
        last_seen_at=str(last_seen_at) if last_seen_at else None,
        restaurants_currently_carrying=restaurants_carrying,
        price_history=price_history,
        menu_changes=changes,
    )
