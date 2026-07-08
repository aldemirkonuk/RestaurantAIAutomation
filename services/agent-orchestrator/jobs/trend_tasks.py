"""
trend_tasks.py — Phase 11 TEMP-05 / TEMP-06

Celery task for nightly popularity and trend metrics computation.

Tasks:
  compute_trend_metrics_task — Nightly beat (5:00 AM UTC). Computes wine_popularity
                               and trending_wines in a single task (popularity first
                               to guarantee ordering — see RESEARCH.md Pitfall 9).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Set

from jobs.celery_app import celery_app
from config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

WINDOWS = [30, 60, 90]
BURST_WINDOW_DAYS = 14
BURST_RESTAURANT_THRESHOLD = 3
BURST_BONUS = 2.0

TREND_WEIGHTS = {30: 3.0, 60: 1.5, 90: 1.0}


# =============================================================================
# BEAT TASK
# =============================================================================


@celery_app.task(name="trend.compute_metrics")
def compute_trend_metrics_task() -> Dict[str, Any]:
    """
    Nightly beat (5:00 AM UTC, after recrawl at 4:30 AM).

    Step 1: Compute wine_popularity (current restaurant count per wine_id).
    Step 2: Compute trending_wines velocity scores using menu_changes events.

    Both steps run in sequence within one task to guarantee Step 1 is committed
    before Step 2 reads from wine_popularity (RESEARCH.md Pitfall 9).
    """
    from supabase import create_client

    supabase = create_client(settings.supabase_url, settings.supabase_key)

    popularity_count = _compute_popularity(supabase)
    trending_count = _compute_trending(supabase)

    result = {
        "popularity_wines_updated": popularity_count,
        "trending_wines_updated": trending_count,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("compute_trend_metrics_task: %s", result)
    return result


# =============================================================================
# POPULARITY COMPUTATION (TEMP-05)
# =============================================================================


def _compute_popularity(supabase: Any) -> int:
    """
    Compute how many distinct restaurants currently carry each wine.

    Join path: restaurant_wine_roster.signature_hash →
               master_wine_library_submissions.signature_hash →
               master_wine_library_submissions.master_wine_id (= wine_id)

    NOTE: master_wine_library does NOT have signature_hash. Must go via submissions.
    Wines in the roster that haven't been promoted (no master_wine_id) are skipped.
    """
    # Build hash → wine_id map from promoted submissions
    try:
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("master_wine_id, signature_hash")
            .not_.is_("master_wine_id", "null")
            .execute()
        )
        hash_to_wine_id: Dict[str, str] = {
            row["signature_hash"]: row["master_wine_id"]
            for row in (sub_resp.data or [])
            if row.get("signature_hash") and row.get("master_wine_id")
        }
    except Exception as exc:
        logger.error("_compute_popularity: failed to fetch submissions: %s", exc)
        return 0

    if not hash_to_wine_id:
        logger.info("_compute_popularity: no promoted submissions found — skipping")
        return 0

    # Fetch current roster
    try:
        roster_resp = (
            supabase.table("restaurant_wine_roster")
            .select("restaurant_id, signature_hash")
            .execute()
        )
        roster_rows = roster_resp.data or []
    except Exception as exc:
        logger.error("_compute_popularity: failed to fetch roster: %s", exc)
        return 0

    # Count distinct restaurants per wine_id
    wine_to_restaurants: Dict[str, Set[str]] = defaultdict(set)
    for row in roster_rows:
        h = row.get("signature_hash")
        wine_id = hash_to_wine_id.get(h)
        if wine_id and row.get("restaurant_id"):
            wine_to_restaurants[wine_id].add(row["restaurant_id"])

    if not wine_to_restaurants:
        logger.info("_compute_popularity: no wine-restaurant matches found")
        return 0

    # Upsert wine_popularity
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "wine_id": wine_id,
            "restaurant_count": len(restaurants),
            "computed_at": now_iso,
        }
        for wine_id, restaurants in wine_to_restaurants.items()
    ]
    try:
        supabase.table("wine_popularity").upsert(
            rows,
            on_conflict="wine_id",
        ).execute()
        logger.info("_compute_popularity: upserted %d wine_popularity rows", len(rows))
        return len(rows)
    except Exception as exc:
        logger.error("_compute_popularity: upsert failed: %s", exc)
        return 0


# =============================================================================
# TRENDING COMPUTATION (TEMP-06)
# =============================================================================


def _window_start_iso(days: int) -> str:
    """Return ISO string for the start of a rolling window N days ago."""
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _compute_trending(supabase: Any) -> int:
    """
    Compute velocity-weighted trending_wines rows for 30/60/90d windows.

    Uses menu_changes events (added/removed) as the historical signal.
    trend_score = (delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus

    Burst bonus (+2.0): wine appeared in ≥3 distinct NEW restaurants in last 14 days.

    The combined trend_score is written to all 3 window rows for the same wine.
    Each row's delta and pct_change reflect its own window.
    """
    # Build hash → wine_id map (same as popularity)
    try:
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("master_wine_id, signature_hash")
            .not_.is_("master_wine_id", "null")
            .execute()
        )
        hash_to_wine_id: Dict[str, str] = {
            row["signature_hash"]: row["master_wine_id"]
            for row in (sub_resp.data or [])
            if row.get("signature_hash") and row.get("master_wine_id")
        }
    except Exception as exc:
        logger.error("_compute_trending: failed to fetch submissions: %s", exc)
        return 0

    if not hash_to_wine_id:
        return 0

    # Fetch last 90 days of menu_changes (covers all windows)
    oldest_window_start = _window_start_iso(max(WINDOWS))
    try:
        events_resp = (
            supabase.table("menu_changes")
            .select("wine_signature_hash, change_type, restaurant_id, detected_at")
            .gte("detected_at", oldest_window_start)
            .execute()
        )
        events = events_resp.data or []
    except Exception as exc:
        logger.error("_compute_trending: failed to fetch menu_changes: %s", exc)
        return 0

    if not events:
        logger.info("_compute_trending: no menu_changes in last 90 days")
        return 0

    # Resolve hashes to wine_ids; discard events with unknown hash
    resolved_events = []
    for ev in events:
        h = ev.get("wine_signature_hash")
        wine_id = hash_to_wine_id.get(h)
        if wine_id:
            resolved_events.append({**ev, "wine_id": wine_id})

    if not resolved_events:
        return 0

    # Get current restaurant_count from wine_popularity (just written in _compute_popularity)
    try:
        pop_resp = (
            supabase.table("wine_popularity")
            .select("wine_id, restaurant_count")
            .execute()
        )
        current_count: Dict[str, int] = {
            row["wine_id"]: row["restaurant_count"] for row in (pop_resp.data or [])
        }
    except Exception as exc:
        logger.error("_compute_trending: failed to fetch wine_popularity: %s", exc)
        current_count = {}

    # Compute per-wine deltas for each window
    now_iso = datetime.now(timezone.utc).isoformat()
    burst_cutoff = _window_start_iso(BURST_WINDOW_DAYS)

    # Collect all wine_ids that appear in events
    all_wine_ids = {ev["wine_id"] for ev in resolved_events}

    rows_to_upsert = []
    for wine_id in all_wine_ids:
        wine_events = [ev for ev in resolved_events if ev["wine_id"] == wine_id]

        # Per-window delta
        window_deltas: Dict[int, int] = {}
        for days in WINDOWS:
            cutoff = _window_start_iso(days)
            adds = len(
                {
                    ev["restaurant_id"]
                    for ev in wine_events
                    if ev["change_type"] == "added" and ev["detected_at"] >= cutoff
                }
            )
            removes = len(
                {
                    ev["restaurant_id"]
                    for ev in wine_events
                    if ev["change_type"] == "removed" and ev["detected_at"] >= cutoff
                }
            )
            window_deltas[days] = adds - removes

        # Burst detection: ≥3 distinct restaurants added wine in last 14 days
        new_rests_14d = {
            ev["restaurant_id"]
            for ev in wine_events
            if ev["change_type"] == "added" and ev["detected_at"] >= burst_cutoff
        }
        burst_detected = len(new_rests_14d) >= BURST_RESTAURANT_THRESHOLD
        burst_detected_at = now_iso if burst_detected else None
        burst_bonus = BURST_BONUS if burst_detected else 0.0

        # Combined trend_score (written to all 3 window rows)
        trend_score = (
            window_deltas.get(30, 0) * TREND_WEIGHTS[30]
            + window_deltas.get(60, 0) * TREND_WEIGHTS[60]
            + window_deltas.get(90, 0) * TREND_WEIGHTS[90]
            + burst_bonus
        )

        count_end = current_count.get(wine_id, 0)

        # One row per window
        for days in WINDOWS:
            delta = window_deltas.get(days, 0)
            count_start = max(0, count_end - delta)
            pct_change = (delta / count_start * 100.0) if count_start > 0 else None

            rows_to_upsert.append(
                {
                    "wine_id": wine_id,
                    "window_days": days,
                    "restaurant_count_start": count_start,
                    "restaurant_count_end": count_end,
                    "delta": delta,
                    "pct_change": (
                        round(pct_change, 4) if pct_change is not None else None
                    ),
                    "trend_score": round(
                        trend_score, 4
                    ),  # same combined score on all rows
                    "burst_detected_at": burst_detected_at,
                    "computed_at": now_iso,
                }
            )

    if not rows_to_upsert:
        return 0

    try:
        supabase.table("trending_wines").upsert(
            rows_to_upsert,
            on_conflict="wine_id,window_days",
        ).execute()
        wine_count = len(all_wine_ids)
        logger.info(
            "_compute_trending: upserted %d trending_wines rows for %d wines",
            len(rows_to_upsert),
            wine_count,
        )
        return wine_count
    except Exception as exc:
        logger.error("_compute_trending: upsert failed: %s", exc)
        return 0
