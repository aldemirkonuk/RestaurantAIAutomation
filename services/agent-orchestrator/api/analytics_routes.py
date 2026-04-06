"""
Analytics Routes (CRIT-07)
===========================
GET /api/v1/analytics/wine/{wine_id}/scores
    Returns aggregated critic scores, composite score, retail price, and
    per-restaurant markup ratios for a wine from master_wine_library.

Pattern: follows quality_routes.py (APIRouter prefix, late Supabase import,
         Pydantic response models, UUID validation guard).
"""

import logging
import uuid
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
        scores_last_updated_at=str(scores_last_updated) if scores_last_updated else None,
        per_restaurant_markup=per_restaurant,
    )
