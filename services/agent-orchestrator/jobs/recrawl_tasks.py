"""
recrawl_tasks.py — Phase 11 TEMP-02

Celery tasks for scheduled restaurant re-crawling with diff detection.

Tasks:
  scheduled_recrawl_task  — Daily beat (4:30 AM UTC). Selects due restaurants
                             from crawl_schedule and fans out crawl_and_diff_task.
  crawl_and_diff_task     — Per-restaurant: crawl → diff → update schedule.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import redis as redis_lib

from config.settings import get_settings
from jobs.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()

# Consecutive failure threshold before status='error'
CONSECUTIVE_FAILURE_THRESHOLD = 3
# Frequency-to-days mapping for next_crawl_at computation
FREQUENCY_DAYS = {"weekly": 7, "biweekly": 14, "monthly": 30}


# =============================================================================
# BEAT TASK: select due restaurants and fan out
# =============================================================================


@celery_app.task(name="recrawl.scheduled")
def scheduled_recrawl_task() -> Dict[str, Any]:
    """
    Daily beat task (4:30 AM UTC). Selects all crawl_schedule rows where
    next_crawl_at <= NOW() AND status='active'. Fires one crawl_and_diff_task
    per due restaurant.

    NEVER does the crawl inline — always fans out to crawl_and_diff_task.delay().
    """
    from supabase import create_client

    supabase = create_client(settings.supabase_url, settings.supabase_key)

    now_iso = datetime.now(timezone.utc).isoformat()
    resp = (
        supabase.table("crawl_schedule")
        .select("restaurant_id")
        .eq("status", "active")
        .lte("next_crawl_at", now_iso)
        .execute()
    )
    rows = resp.data or []
    queued = 0
    for row in rows:
        crawl_and_diff_task.delay(row["restaurant_id"])
        queued += 1

    logger.info("scheduled_recrawl_task: queued %d restaurants", queued)
    return {"queued": queued, "timestamp": now_iso}


# =============================================================================
# WORKER TASK: crawl one restaurant and run diff
# =============================================================================


@celery_app.task(
    name="recrawl.crawl_and_diff",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def crawl_and_diff_task(self, restaurant_id: str) -> Optional[Dict[str, Any]]:
    """
    Per-restaurant crawl + diff task. Redis NX dedup prevents concurrent crawls.

    Flow:
      1. Acquire Redis NX lock (crawl:{restaurant_id}, TTL=7200s)
      2. Fetch restaurant URL + name from restaurant_directory
      3. crawl_restaurant() → CrawlResult with result.wines populated
      4. MenuDiffService.run_diff() → menu_changes events + roster upsert
      5. _update_crawl_schedule() → last_crawled_at + next_crawl_at
    """
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"crawl:{restaurant_id}"
    acquired = r.set(lock_key, "1", nx=True, ex=7200)
    if not acquired:
        logger.info("crawl_and_diff_task: deduplicated restaurant_id=%s", restaurant_id)
        return None

    try:
        return asyncio.run(_crawl_and_diff_async(restaurant_id))
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2**retry_num)
        if retry_num >= self.max_retries - 1:
            # Final failure — mark error in crawl_schedule
            try:
                _mark_crawl_error(restaurant_id, consecutive_inc=True)
            except Exception:
                pass
            logger.error(
                "crawl_and_diff_task: max retries reached for restaurant_id=%s: %s",
                restaurant_id,
                exc,
            )
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)


# =============================================================================
# ASYNC HELPER
# =============================================================================


async def _crawl_and_diff_async(restaurant_id: str) -> Dict[str, Any]:
    """Async body of crawl_and_diff_task. Called via asyncio.run()."""
    from supabase import create_client
    from services.web_crawler import WebCrawlerService
    from services.menu_diff_service import MenuDiffService

    supabase = create_client(settings.supabase_url, settings.supabase_key)

    # Fetch restaurant info from restaurant_directory (website_url + name only)
    rest_resp = (
        supabase.table("restaurant_directory")
        .select("id, name, website_url")
        .eq("id", restaurant_id)
        .maybe_single()
        .execute()
    )
    if not rest_resp.data:
        logger.warning(
            "crawl_and_diff_task: restaurant_id=%s not found in restaurant_directory",
            restaurant_id,
        )
        return {"error": "restaurant_not_found", "restaurant_id": restaurant_id}

    restaurant = rest_resp.data
    website_url = restaurant.get("website_url") or ""
    restaurant_name = restaurant.get("name") or restaurant_id

    # Fetch crawl_frequency from crawl_schedule (D-04: crawl_frequency is on crawl_schedule)
    sched_resp = (
        supabase.table("crawl_schedule")
        .select("crawl_frequency")
        .eq("restaurant_id", restaurant_id)
        .maybe_single()
        .execute()
    )
    frequency = (sched_resp.data or {}).get("crawl_frequency") or "weekly"

    if not website_url:
        logger.warning(
            "crawl_and_diff_task: restaurant_id=%s has no website_url", restaurant_id
        )
        _mark_crawl_error(restaurant_id, consecutive_inc=True)
        return {"error": "no_website_url", "restaurant_id": restaurant_id}

    # Crawl
    crawler = WebCrawlerService()
    result = await crawler.crawl_restaurant(
        website_url=website_url, restaurant_name=restaurant_name
    )

    # Run diff (result.wines populated by patched _persist_crawled_wines)
    diff_service = MenuDiffService(supabase)
    diff_result = diff_service.run_diff(restaurant_id, result.wines)

    # Update schedule on success
    _update_crawl_schedule(supabase, restaurant_id, frequency)

    logger.info(
        "crawl_and_diff_task: restaurant_id=%s — diff: added=%d removed=%d price_changed=%d skipped=%s",
        restaurant_id,
        diff_result.get("added", 0),
        diff_result.get("removed", 0),
        diff_result.get("price_changed", 0),
        diff_result.get("skipped", False),
    )
    return {
        "restaurant_id": restaurant_id,
        "wines_crawled": len(result.wines),
        "diff": diff_result,
    }


# =============================================================================
# SCHEDULE HELPERS
# =============================================================================


def _update_crawl_schedule(supabase: Any, restaurant_id: str, frequency: str) -> None:
    """Update last_crawled_at, next_crawl_at, and reset consecutive_failures to 0."""
    days = FREQUENCY_DAYS.get(frequency, 7)
    now = datetime.now(timezone.utc)
    next_crawl = (now + timedelta(days=days)).isoformat()
    try:
        supabase.table("crawl_schedule").update(
            {
                "last_crawled_at": now.isoformat(),
                "next_crawl_at": next_crawl,
                "consecutive_failures": 0,
                "status": "active",
            }
        ).eq("restaurant_id", restaurant_id).execute()
    except Exception as exc:
        logger.error("_update_crawl_schedule: failed for %s: %s", restaurant_id, exc)


def _mark_crawl_error(restaurant_id: str, consecutive_inc: bool = False) -> None:
    """Increment consecutive_failures; set status='error' after CONSECUTIVE_FAILURE_THRESHOLD."""
    from supabase import create_client

    supabase = create_client(settings.supabase_url, settings.supabase_key)
    try:
        resp = (
            supabase.table("crawl_schedule")
            .select("consecutive_failures")
            .eq("restaurant_id", restaurant_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            return
        current = resp.data.get("consecutive_failures") or 0
        new_count = current + (1 if consecutive_inc else 0)
        new_status = "error" if new_count >= CONSECUTIVE_FAILURE_THRESHOLD else "active"
        supabase.table("crawl_schedule").update(
            {
                "consecutive_failures": new_count,
                "status": new_status,
            }
        ).eq("restaurant_id", restaurant_id).execute()
    except Exception as exc:
        logger.error("_mark_crawl_error: failed for %s: %s", restaurant_id, exc)
