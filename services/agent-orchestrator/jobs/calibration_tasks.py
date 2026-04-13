"""
Field Confidence Calibration Task (FCONF-11)
============================================
Daily Celery beat task that measures actual accuracy per field per confidence bin,
then adjusts thresholds in confidence_thresholds table to maintain >= 0.95 accuracy.

Per D-21: Reads resolved field_review_queue entries (approved/corrected/rejected).
Per D-22: Adjusts thresholds by +/- 0.05, clamped to [0.30, 0.95].
Per D-23: Only calibrates fields with >= 50 total resolved reviews (statistical significance).

Accuracy definition:
  - "approved"  = field was correct (human accepted original value)
  - "corrected" = field was wrong (human supplied different value)
  - "rejected"  = field was wrong (human removed the field entirely)
"""

import logging
from datetime import datetime, timezone

from jobs.celery_app import celery_app
from config.settings import get_settings
from supabase import create_client

logger = logging.getLogger(__name__)
settings = get_settings()

# Calibration constants
MIN_REVIEWS_FOR_CALIBRATION = 50   # minimum resolved reviews per field before adjusting
ACCURACY_TARGET_LOW = 0.95         # below this → raise accept_threshold
ACCURACY_TARGET_HIGH = 0.98        # above this → lower review_threshold
THRESHOLD_STEP = 0.05
THRESHOLD_MIN = 0.30               # floor for review_threshold (D-22)
THRESHOLD_MAX = 0.95               # ceiling for accept_threshold (D-22)

# 10 confidence bins from 0.0 to 1.0
CONFIDENCE_BINS = [
    "0.0-0.1", "0.1-0.2", "0.2-0.3", "0.3-0.4", "0.4-0.5",
    "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0",
]


def _get_supabase():
    return create_client(settings.supabase_url, settings.supabase_key)


def _confidence_to_bin(confidence: float) -> str:
    """Map a 0.0–1.0 confidence value to its bin string (e.g. 0.73 → '0.7-0.8')."""
    idx = min(int(float(confidence) * 10), 9)
    return CONFIDENCE_BINS[idx]


@celery_app.task(name="calibration.calibrate_field_thresholds")
def calibrate_field_thresholds_task():
    """
    Daily calibration task.

    Steps:
    1. Read all resolved field_review_queue entries (status: approved/corrected/rejected)
    2. Per field+bin, compute total_reviewed and total_correct
    3. Upsert field_calibration table (per D-21)
    4. For fields with >= MIN_REVIEWS_FOR_CALIBRATION resolved:
       - accuracy < 0.95 in any bin → raise accept_threshold
       - accuracy > 0.98 in any bin → lower review_threshold
    5. Return summary dict
    """
    supabase = _get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Read all resolved field_review_queue entries
    try:
        resp = (
            supabase.table("field_review_queue")
            .select("field_name, confidence, status")
            .in_("status", ["approved", "corrected", "rejected"])
            .execute()
        )
        resolved = resp.data or []
    except Exception as exc:
        logger.error("Calibration: failed to read field_review_queue: %s", exc)
        return {"error": str(exc)}

    if not resolved:
        logger.info("Calibration: no resolved reviews found, skipping")
        return {"status": "skipped", "reason": "no_resolved_reviews"}

    logger.info("Calibration: processing %d resolved reviews", len(resolved))

    # 2. Aggregate: (field_name, confidence_bin) → {total, correct}
    stats: dict = {}
    for row in resolved:
        fname = row["field_name"]
        conf = float(row["confidence"])
        bin_str = _confidence_to_bin(conf)
        key = (fname, bin_str)
        if key not in stats:
            stats[key] = {"total": 0, "correct": 0}
        stats[key]["total"] += 1
        if row["status"] == "approved":
            stats[key]["correct"] += 1
        # corrected and rejected are not correct

    # 3. Upsert field_calibration rows
    calibration_rows = []
    for (fname, bin_str), s in stats.items():
        accuracy = s["correct"] / s["total"] if s["total"] > 0 else 0.0
        calibration_rows.append({
            "field_name": fname,
            "confidence_bin": bin_str,
            "total_reviewed": s["total"],
            "total_correct": s["correct"],
            "actual_accuracy": round(accuracy, 4),
            "measured_at": now_iso,
        })

    try:
        supabase.table("field_calibration").upsert(
            calibration_rows,
            on_conflict="field_name,confidence_bin",
        ).execute()
        logger.info("Calibration: upserted %d field_calibration rows", len(calibration_rows))
    except Exception as exc:
        logger.error("Calibration: field_calibration upsert failed: %s", exc)

    # 4. Adjust thresholds for fields with sufficient data
    # Compute total resolved reviews per field across all bins
    field_totals: dict = {}
    for (fname, _), s in stats.items():
        field_totals[fname] = field_totals.get(fname, 0) + s["total"]

    adjusted = 0
    for fname, total in field_totals.items():
        if total < MIN_REVIEWS_FOR_CALIBRATION:
            logger.debug(
                "Calibration: skipping %s (only %d reviews, need %d)",
                fname, total, MIN_REVIEWS_FOR_CALIBRATION,
            )
            continue

        # Fetch current thresholds for this field
        try:
            t_resp = (
                supabase.table("confidence_thresholds")
                .select("review_threshold, accept_threshold")
                .eq("field_name", fname)
                .maybe_single()
                .execute()
            )
            if not t_resp.data:
                continue
            current_review = float(t_resp.data["review_threshold"])
            current_accept = float(t_resp.data["accept_threshold"])
        except Exception as exc:
            logger.warning("Calibration: failed to read thresholds for %s: %s", fname, exc)
            continue

        new_review = current_review
        new_accept = current_accept

        # Check accuracy across all bins for this field
        for (fn, bin_str), s in stats.items():
            if fn != fname or s["total"] < 5:
                continue
            accuracy = s["correct"] / s["total"]
            # Accuracy too low in any bin → raise accept_threshold to reduce auto-accepts
            if accuracy < ACCURACY_TARGET_LOW:
                new_accept = min(current_accept + THRESHOLD_STEP, THRESHOLD_MAX)
            # Accuracy very high in all bins → lower review_threshold to reduce review burden
            if accuracy > ACCURACY_TARGET_HIGH:
                new_review = max(current_review - THRESHOLD_STEP, THRESHOLD_MIN)

        if new_review != current_review or new_accept != current_accept:
            try:
                supabase.table("confidence_thresholds").update({
                    "review_threshold": round(new_review, 2),
                    "accept_threshold": round(new_accept, 2),
                    "last_calibrated_at": now_iso,
                }).eq("field_name", fname).execute()
                adjusted += 1
                logger.info(
                    "Calibration: adjusted %s → review %.2f→%.2f accept %.2f→%.2f",
                    fname, current_review, new_review, current_accept, new_accept,
                )
            except Exception as exc:
                logger.warning("Calibration: threshold update failed for %s: %s", fname, exc)

    return {
        "status": "completed",
        "resolved_reviews_processed": len(resolved),
        "calibration_rows_written": len(calibration_rows),
        "thresholds_adjusted": adjusted,
        "timestamp": now_iso,
    }
