"""
Admin Wine Review & Governance Routes
=======================================
Endpoints for human reviewers to manage the wine library:
- View pending review queue (Tier 3 and 4 wines)
- Promote / demote wine governance tiers
- Mark wines as canonical (human-verified)
- Add name aliases for deduplication
- View governance statistics
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================


class TierUpdateRequest(BaseModel):
    """Request to update a wine's governance tier."""

    library_tier: int = Field(ge=0, le=4, description="New tier (0-4)")
    reason: Optional[str] = None
    canonical_name_verified: Optional[bool] = None


class AliasAddRequest(BaseModel):
    """Request to add a name alias for a wine."""

    alias_name: str = Field(
        description="Alternative name / OCR variant / regional name"
    )
    alias_source: str = Field(
        default="human_review", description="How alias was discovered"
    )
    language: Optional[str] = None


class WineEditRequest(BaseModel):
    """Request to edit wine fields during review."""

    fields: Dict[str, Any] = Field(description="Dict of field_name: corrected_value")
    field_sources: Optional[Dict[str, str]] = Field(
        default=None,
        description="Updated source types for edited fields (all set to 'documented' by default)",
    )


class ReviewQueueFilters(BaseModel):
    """Filters for the review queue."""

    tier: Optional[int] = Field(default=None, ge=0, le=4)
    restaurant_id: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


# =============================================================================
# ROUTES
# =============================================================================


@router.get("/wines/pending")
async def get_pending_wines(
    tier: Optional[int] = None,
    restaurant_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """
    Get wines pending human review.
    By default returns Tier 3 and Tier 4 wines.
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    query = supabase.table("master_wine_library").select("*")

    if tier is not None:
        query = query.eq("library_tier", tier)
    else:
        # Default: show Tier 3 and 4 (needs review)
        query = query.in_("library_tier", [3, 4])

    if restaurant_id:
        query = query.eq("restaurant_id", restaurant_id)

    query = query.order("created_at", desc=True)
    query = query.range(offset, offset + limit - 1)

    result = query.execute()

    return {
        "total": len(result.data) if result.data else 0,
        "offset": offset,
        "limit": limit,
        "wines": result.data or [],
    }


@router.patch("/wines/{wine_id}/tier")
async def update_wine_tier(wine_id: str, request: TierUpdateRequest):
    """
    Update a wine's governance tier.
    Used by reviewers to promote/demote wines after verification.
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    update_data = {
        "library_tier": request.library_tier,
        "updated_at": datetime.utcnow().isoformat(),
    }

    if request.canonical_name_verified is not None:
        update_data["canonical_name_verified"] = request.canonical_name_verified

    # If promoting to Tier 0, must set canonical_name_verified=True
    if request.library_tier == 0:
        update_data["canonical_name_verified"] = True

    try:
        result = (
            supabase.table("master_wine_library")
            .update(update_data)
            .eq("id", wine_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Wine {wine_id} not found")

        logger.info(
            f"Wine {wine_id} tier updated to {request.library_tier} "
            f"(reason: {request.reason or 'none given'})"
        )

        return {
            "success": True,
            "wine_id": wine_id,
            "new_tier": request.library_tier,
            "canonical_name_verified": update_data.get(
                "canonical_name_verified", False
            ),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update wine tier: {e}")
        raise HTTPException(status_code=500, detail="Failed to update wine tier")


@router.post("/wines/{wine_id}/alias")
async def add_wine_alias(wine_id: str, request: AliasAddRequest):
    """
    Add a name alias for a wine.
    Used for deduplication — maps variant spellings, OCR corruptions,
    and regional names back to the canonical wine entry.
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        # Verify wine exists
        wine = (
            supabase.table("master_wine_library")
            .select("id, name, producer")
            .eq("id", wine_id)
            .single()
            .execute()
        )

        if not wine.data:
            raise HTTPException(status_code=404, detail=f"Wine {wine_id} not found")

        # Insert alias
        alias_data = {
            "canonical_id": wine_id,
            "alias_name": request.alias_name,
            "alias_source": request.alias_source,
            "language": request.language,
            "created_at": datetime.utcnow().isoformat(),
        }

        supabase.table("wine_aliases").insert(alias_data).execute()

        logger.info(
            f"Alias added for wine {wine_id}: '{request.alias_name}' "
            f"(source: {request.alias_source})"
        )

        return {
            "success": True,
            "wine_id": wine_id,
            "alias": request.alias_name,
            "canonical_name": wine.data.get("name"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to add wine alias: {e}")
        raise HTTPException(status_code=500, detail="Failed to add alias")


@router.patch("/wines/{wine_id}/edit")
async def edit_wine_fields(wine_id: str, request: WineEditRequest):
    """
    Edit wine fields during review.
    Updates field values, sets source to 'documented', recalculates confidence.
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        # Fetch current wine data
        wine = (
            supabase.table("master_wine_library")
            .select("*")
            .eq("id", wine_id)
            .single()
            .execute()
        )

        if not wine.data:
            raise HTTPException(status_code=404, detail=f"Wine {wine_id} not found")

        # Build update
        update_data = {}
        current_field_sources = wine.data.get("field_sources", {})
        current_field_confidences = wine.data.get("field_confidences", {})

        for field_name, new_value in request.fields.items():
            update_data[field_name] = new_value
            # Human edits are documented sources with full confidence
            current_field_sources[field_name] = (request.field_sources or {}).get(
                field_name, "documented"
            )
            current_field_confidences[field_name] = 1.0  # Human-verified = 1.0

        update_data["field_sources"] = current_field_sources
        update_data["field_confidences"] = current_field_confidences
        update_data["updated_at"] = datetime.utcnow().isoformat()

        # Recalculate overall confidence with updated field confidences
        from services.governance import compute_overall_confidence

        update_data["confidence"] = compute_overall_confidence(
            current_field_confidences
        )

        supabase.table("master_wine_library").update(update_data).eq(
            "id", wine_id
        ).execute()

        logger.info(f"Wine {wine_id} edited: fields={list(request.fields.keys())}")

        return {
            "success": True,
            "wine_id": wine_id,
            "edited_fields": list(request.fields.keys()),
            "new_confidence": update_data["confidence"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to edit wine: {e}")
        raise HTTPException(status_code=500, detail="Failed to edit wine")


@router.get("/wines/stats")
async def get_governance_stats():
    """
    Get governance statistics: counts by tier, review velocity, enrichment rates.
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        # Return mock stats for dev mode
        return {
            "total_wines": 0,
            "by_tier": {0: 0, 1: 0, 2: 0, 3: 0, 4: 0},
            "canonical_verified": 0,
            "pending_review": 0,
            "enrichment_eligible": 0,
        }

    try:
        all_wines = (
            supabase.table("master_wine_library")
            .select("library_tier, canonical_name_verified")
            .execute()
        )

        if not all_wines.data:
            return {
                "total_wines": 0,
                "by_tier": {0: 0, 1: 0, 2: 0, 3: 0, 4: 0},
                "canonical_verified": 0,
                "pending_review": 0,
                "enrichment_eligible": 0,
            }

        tier_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
        canonical_count = 0

        for w in all_wines.data:
            tier = w.get("library_tier")
            if tier is not None and tier in tier_counts:
                tier_counts[tier] += 1
            if w.get("canonical_name_verified"):
                canonical_count += 1

        return {
            "total_wines": len(all_wines.data),
            "by_tier": tier_counts,
            "canonical_verified": canonical_count,
            "pending_review": tier_counts.get(3, 0) + tier_counts.get(4, 0),
            "enrichment_eligible": tier_counts.get(2, 0) + tier_counts.get(3, 0),
        }

    except Exception as e:
        logger.error(f"Failed to get governance stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get stats")


@router.get("/submissions/pending")
async def get_pending_submissions(
    limit: int = 50,
    offset: int = 0,
):
    """
    Get pending master_wine_library_submissions (from scans, crawlers, onboarding).
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        result = (
            supabase.table("master_wine_library_submissions")
            .select("*")
            .eq("status", "pending_review")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )

        return {
            "total": len(result.data) if result.data else 0,
            "submissions": result.data or [],
        }

    except Exception as e:
        logger.error(f"Failed to get pending submissions: {e}")
        raise HTTPException(status_code=500, detail="Failed to get submissions")


@router.post("/submissions/{submission_id}/approve")
async def approve_submission(submission_id: str):
    """
    Approve a library submission — move it into master_wine_library with assigned tier.
    """
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        # Fetch submission
        sub = (
            supabase.table("master_wine_library_submissions")
            .select("*")
            .eq("id", submission_id)
            .single()
            .execute()
        )

        if not sub.data:
            raise HTTPException(status_code=404, detail="Submission not found")

        payload = sub.data.get("payload", {})

        # Insert into master library with Tier 0 (human-approved)
        wine_data = {
            **payload,
            "library_tier": 0,  # Human-approved = Canonical
            "canonical_name_verified": True,
            "signature_hash": sub.data.get("signature_hash"),
            "created_at": datetime.utcnow().isoformat(),
        }

        supabase.table("master_wine_library").insert(wine_data).execute()

        # Update submission status
        supabase.table("master_wine_library_submissions").update(
            {"status": "approved", "reviewed_at": datetime.utcnow().isoformat()}
        ).eq("id", submission_id).execute()

        return {"success": True, "submission_id": submission_id, "action": "approved"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to approve submission: {e}")
        raise HTTPException(status_code=500, detail="Failed to approve submission")


@router.post("/submissions/{submission_id}/reject")
async def reject_submission(submission_id: str, reason: Optional[str] = None):
    """Reject a library submission."""
    from core.database import get_supabase_client

    # A None client means no database is configured -> 503 below. An import
    # fault is a wiring bug and propagates as a 500 rather than masquerading
    # as a transient outage.
    supabase = get_supabase_client()

    if supabase is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    try:
        supabase.table("master_wine_library_submissions").update(
            {
                "status": "rejected",
                "reviewed_at": datetime.utcnow().isoformat(),
            }
        ).eq("id", submission_id).execute()

        return {"success": True, "submission_id": submission_id, "action": "rejected"}

    except Exception as e:
        logger.error(f"Failed to reject submission: {e}")
        raise HTTPException(status_code=500, detail="Failed to reject submission")
