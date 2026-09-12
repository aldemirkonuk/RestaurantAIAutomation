"""
Quality Review Queue Routes (FCONF-06, FCONF-07, QUAL-01, QUAL-02)
===================================================================
GET  /api/v1/quality/review-queue          — Field-level pending reviews grouped by wine
PATCH /api/v1/quality/review-queue/{id}    — Apply per-field corrections and promote to library
GET  /api/v1/quality/calibration           — Per-field accuracy stats (Phase 7 Plan 05)

Phase 7 field-level architecture:
  - Reviews operate at field granularity (not whole-wine records)
  - GET returns pending field_review_queue rows grouped by submission
  - PATCH accepts {"corrections": {"sub_region": "...", "appellation": "..."}}
  - Each correction: updates field_confidence JSONB + logs to field_corrections +
    marks field_review_queue row as corrected/approved
  - Promotion maps field_confidence values to all master_wine_library columns
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import verify_admin_key
from services.field_confidence import (
    should_auto_block,
    JSONB_ENRICHMENT_KEYS,
)
from services.log_safety import sanitize_for_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/quality", tags=["quality"])


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================


class ReviewQueuePatchRequest(BaseModel):
    """
    PATCH body for /review-queue/{submission_id}.

    corrections: dict of field_name -> corrected_value
                 Each correction sets confidence=1.0, source="human_corrected"
    approvals:   list of field_names approved as-is (no value change needed)
    corrected_by: reviewer identifier (email or user_id string)
    """

    corrections: Dict[str, Any] = {}
    approvals: List[str] = []
    corrected_by: Optional[str] = None


# =============================================================================
# HELPERS
# =============================================================================


def _get_supabase():
    """Return Supabase client. Returns None if not configured."""
    try:
        from config.settings import get_settings

        settings = get_settings()
        return settings.supabase_client
    except Exception:
        return None


def _fc_value(fc: Dict[str, Any], field_name: str) -> Any:
    """Extract value from field_confidence entry, or None."""
    entry = fc.get(field_name)
    if not entry:
        return None
    if isinstance(entry, dict):
        return entry.get("value")
    return entry


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/review-queue")
def get_review_queue(
    limit: int = 50,
    offset: int = 0,
    _key: str = Depends(verify_admin_key),
):
    """
    GET /api/v1/quality/review-queue

    Returns field-level review items grouped by wine submission.
    Only fields with status='pending' in field_review_queue are returned.
    Fields are ordered by confidence ascending (most uncertain first).

    Query params:
        limit:  max wine submissions to return (default 50)
        offset: pagination offset (default 0)
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        resp = (
            supabase.table("field_review_queue")
            .select(
                "id, submission_id, field_name, current_value, confidence, source, status, created_at"
            )
            .eq("status", "pending")
            .order("confidence", desc=False)
            .range(offset, offset + limit * 10 - 1)  # over-fetch to fill limit groups
            .execute()
        )
    except Exception as exc:
        logger.error("get_review_queue DB error: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")

    rows = resp.data or []

    # Group pending field rows by submission_id
    grouped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        sid = row["submission_id"]
        if sid not in grouped:
            grouped[sid] = {"submission_id": sid, "pending_fields": []}
        grouped[sid]["pending_fields"].append(
            {
                "review_id": row["id"],
                "field_name": row["field_name"],
                "current_value": row["current_value"],
                "confidence": float(row["confidence"]),
                "source": row["source"],
            }
        )

    # Enrich each group with wine context from submissions table
    submission_ids = list(grouped.keys())
    if submission_ids:
        try:
            sub_resp = (
                supabase.table("master_wine_library_submissions")
                .select(
                    "id, payload, field_confidence, auto_blocked, restaurant_id, status"
                )
                .in_("id", submission_ids)
                .execute()
            )
            for sub in sub_resp.data or []:
                sid = sub["id"]
                if sid in grouped:
                    payload = sub.get("payload") or {}
                    fc = sub.get("field_confidence") or {}
                    grouped[sid]["wine_name"] = payload.get("wine_name") or _fc_value(
                        fc, "wine_name"
                    )
                    grouped[sid]["vintage"] = payload.get("vintage") or _fc_value(
                        fc, "vintage"
                    )
                    grouped[sid]["restaurant_id"] = sub.get("restaurant_id")
                    grouped[sid]["auto_blocked"] = sub.get("auto_blocked", False)
                    grouped[sid]["submission_status"] = sub.get("status")
        except Exception as exc:
            logger.warning("Failed to fetch submission context: %s", exc)

    items = list(grouped.values())[:limit]

    return {
        "total": len(items),
        "offset": offset,
        "limit": limit,
        "items": items,
    }


@router.patch("/review-queue/{submission_id}")
def patch_review_queue(
    submission_id: str,
    body: ReviewQueuePatchRequest,
    _key: str = Depends(verify_admin_key),
):
    """
    PATCH /api/v1/quality/review-queue/{submission_id}

    Apply per-field corrections and/or approvals to a wine submission.

    Flow:
      1. Fetch submission + field_confidence + pending field_review_queue rows
      2. For each correction: log to field_corrections, update FC to {value, confidence=1.0, source="human_corrected"}
      3. For each approval: update field_review_queue row to status="approved"
      4. Write updated field_confidence back to submission
      5. Recompute auto_blocked via should_auto_block(fc)
      6. If no pending fields remain + not auto_blocked: promote to master_wine_library
      7. Update submission status
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # 1. Fetch submission — include top-level JSONB enrichment columns written by haiku_tasks
    jsonb_cols = ", ".join(JSONB_ENRICHMENT_KEYS)
    try:
        resp = (
            supabase.table("master_wine_library_submissions")
            .select(
                f"id, payload, field_confidence, status, auto_blocked, restaurant_id, {jsonb_cols}"
            )
            .eq("id", submission_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.error("patch_review_queue fetch error: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")

    if not resp.data:
        raise HTTPException(
            status_code=404, detail=f"Submission {submission_id} not found"
        )

    submission = resp.data
    if submission.get("status") not in ("pending_review",):
        raise HTTPException(
            status_code=409,
            detail=f"Submission not in pending_review state (current: {submission.get('status')})",
        )

    fc: Dict[str, Any] = dict(submission.get("field_confidence") or {})
    dict(submission.get("payload") or {})
    now_iso = datetime.now(timezone.utc).isoformat()

    # 2. Process corrections
    correction_log_rows = []
    if body.corrections:
        for field_name, corrected_value in body.corrections.items():
            # Get original value from field_confidence
            original_entry = fc.get(field_name) or {}
            original_value = (
                original_entry.get("value")
                if isinstance(original_entry, dict)
                else None
            )

            # Log to field_corrections only if value changed
            if str(original_value) != str(corrected_value):
                correction_log_rows.append(
                    {
                        "submission_id": submission_id,
                        "field_name": field_name,
                        "original_value": (
                            str(original_value) if original_value is not None else None
                        ),
                        "corrected_value": (
                            str(corrected_value)
                            if corrected_value is not None
                            else None
                        ),
                        "corrected_at": now_iso,
                        "corrected_by": body.corrected_by,
                    }
                )

            # Update field_confidence: human correction = confidence 1.0
            fc[field_name] = {
                "value": corrected_value,
                "confidence": 1.0,
                "source": "human_corrected",
            }

            # Update matching field_review_queue row to status="corrected"
            try:
                supabase.table("field_review_queue").update(
                    {
                        "status": "corrected",
                        "reviewer": body.corrected_by,
                        "reviewed_at": now_iso,
                    }
                ).eq("submission_id", submission_id).eq("field_name", field_name).eq(
                    "status", "pending"
                ).execute()
            except Exception as exc:
                logger.warning(
                    "field_review_queue update failed for %s.%s: %s",
                    sanitize_for_log(submission_id),
                    sanitize_for_log(field_name),
                    exc,
                )

    # Log corrections to field_corrections table (QUAL-02)
    if correction_log_rows:
        try:
            supabase.table("field_corrections").insert(correction_log_rows).execute()
        except Exception as exc:
            logger.warning("field_corrections insert failed (non-fatal): %s", exc)

    # 3. Process approvals (accept field as-is, boost confidence)
    if body.approvals:
        for field_name in body.approvals:
            existing_entry = fc.get(field_name)
            if isinstance(existing_entry, dict):
                fc[field_name] = {
                    **existing_entry,
                    "confidence": 1.0,
                    "source": "human_approved",
                }
            # Update field_review_queue row to status="approved"
            try:
                supabase.table("field_review_queue").update(
                    {
                        "status": "approved",
                        "reviewer": body.corrected_by,
                        "reviewed_at": now_iso,
                    }
                ).eq("submission_id", submission_id).eq("field_name", field_name).eq(
                    "status", "pending"
                ).execute()
            except Exception as exc:
                logger.warning(
                    "field_review_queue approval update failed for %s.%s: %s",
                    sanitize_for_log(submission_id),
                    sanitize_for_log(field_name),
                    exc,
                )

    # 4. Write updated field_confidence back to submission
    try:
        supabase.table("master_wine_library_submissions").update(
            {
                "field_confidence": fc,
            }
        ).eq("id", submission_id).execute()
    except Exception as exc:
        logger.error(
            "field_confidence update failed for %s: %s",
            sanitize_for_log(submission_id),
            exc,
        )
        raise HTTPException(
            status_code=503, detail=f"Failed to update field_confidence: {exc}"
        )

    # 5. Check for remaining pending fields
    try:
        pending_resp = (
            supabase.table("field_review_queue")
            .select("id", count="exact")
            .eq("submission_id", submission_id)
            .eq("status", "pending")
            .execute()
        )
        remaining_pending = pending_resp.count or 0
    except Exception:
        remaining_pending = (
            1  # Assume pending if query fails — err on side of not promoting
        )

    # 6. Recompute auto_blocked using field-ratio logic
    still_blocked = should_auto_block(fc) if fc else True

    # 7. Promote to master_wine_library if cleared
    promoted = False
    if not still_blocked and remaining_pending == 0:
        try:
            # Map field_confidence values to all master_wine_library columns (D-20)
            promo_row: Dict[str, Any] = {
                "restaurant_id": submission.get("restaurant_id"),
                "submission_id": submission_id,
                "name": _fc_value(fc, "wine_name"),
                "producer": _fc_value(fc, "producer"),
                "vintage": _fc_value(fc, "vintage"),
                "region": _fc_value(fc, "region"),
                "sub_region": _fc_value(fc, "sub_region"),
                "appellation": _fc_value(fc, "appellation"),
                "country": _fc_value(fc, "country"),
                "grape_variety": _fc_value(fc, "grape_variety"),
                "wine_type": _fc_value(fc, "primary_type"),
                "color": _fc_value(fc, "color"),
                "alcohol_pct": _fc_value(fc, "alcohol_pct"),
                "sweetness_level": _fc_value(fc, "sweetness_level"),
                "tasting_notes": _fc_value(fc, "tasting_notes"),
                "description": _fc_value(fc, "description"),
                "food_pairing": _fc_value(fc, "food_pairing"),
                "producer_bio": _fc_value(fc, "producer_bio"),
                "avg_price": _fc_value(fc, "price_bottle"),
                "price_glass": _fc_value(fc, "price_glass"),
                "section_name": _fc_value(fc, "section_name"),
                "bin_number": _fc_value(fc, "bin_number"),
                "source": "human_reviewed",
                "ai_enriched": True,
                "enrichment_source": "haiku",
                "created_at": now_iso,
            }
            # Add 6 JSONB enrichment columns — stored as top-level columns by haiku_tasks.py
            for jk in JSONB_ENRICHMENT_KEYS:
                promo_row[jk] = submission.get(jk) or {}

            supabase.table("master_wine_library").insert(promo_row).execute()
            promoted = True
        except Exception as exc:
            logger.error(
                "master_wine_library promotion failed for %s: %s",
                sanitize_for_log(submission_id),
                exc,
            )
            raise HTTPException(
                status_code=503,
                detail=f"Failed to promote submission to master library: {exc}",
            )

    # Update submission status
    new_status = (
        "approved" if promoted else ("blocked" if still_blocked else "pending_review")
    )
    try:
        supabase.table("master_wine_library_submissions").update(
            {
                "status": new_status,
                "auto_blocked": still_blocked,
            }
        ).eq("id", submission_id).execute()
    except Exception as exc:
        logger.error(
            "submission status update failed for %s: %s",
            sanitize_for_log(submission_id),
            exc,
        )
        raise HTTPException(
            status_code=503, detail=f"Failed to update submission status: {exc}"
        )

    return {
        "submission_id": submission_id,
        "status": new_status,
        "auto_blocked": still_blocked,
        "promoted_to_library": promoted,
        "remaining_pending_fields": remaining_pending,
        "corrections_applied": len(body.corrections),
        "approvals_applied": len(body.approvals),
        "field_corrections_logged": len(correction_log_rows),
    }


@router.get("/calibration")
def get_calibration(_key: str = Depends(verify_admin_key)):
    """
    GET /api/v1/quality/calibration

    Returns current per-field confidence thresholds and accuracy stats.
    Populated by the daily calibration Celery task (Phase 7 Plan 05).
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        thresholds_resp = (
            supabase.table("confidence_thresholds")
            .select(
                "field_name, review_threshold, accept_threshold, last_calibrated_at"
            )
            .order("field_name")
            .execute()
        )
        calibration_resp = (
            supabase.table("field_calibration")
            .select(
                "field_name, confidence_bin, total_reviewed, total_correct, actual_accuracy, measured_at"
            )
            .order("field_name")
            .execute()
        )
    except Exception as exc:
        logger.error("get_calibration DB error: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")

    thresholds = thresholds_resp.data or []
    calibration = calibration_resp.data or []

    # Index calibration by field_name
    cal_by_field: Dict[str, list] = {}
    for row in calibration:
        fname = row["field_name"]
        if fname not in cal_by_field:
            cal_by_field[fname] = []
        cal_by_field[fname].append(row)

    return {
        "thresholds": thresholds,
        "calibration_stats": calibration,
        "fields_with_calibration_data": len(cal_by_field),
        "total_calibration_rows": len(calibration),
    }
