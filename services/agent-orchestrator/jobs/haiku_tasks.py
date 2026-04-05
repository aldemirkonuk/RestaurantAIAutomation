"""
Haiku Enrichment Celery Task
============================
Background enrichment of wines missing region/country/grape_variety.
Calls HaikuEnrichmentService and persists results to master_wine_library.

Retry policy (D-04): autoretry_for=(Exception,), max_retries=3,
countdown escalates: 60s -> 120s -> 240s (exponential backoff matching DLQ pattern).
After exhaustion: logs WARNING, task terminates silently.
"""

import asyncio
import logging
from typing import Optional

from supabase import create_client

from config.settings import get_settings
from jobs.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_supabase_client():
    return create_client(settings.supabase_url, settings.supabase_key)


@celery_app.task(
    name="haiku.enrich_wine",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    default_retry_delay=60,
)
def haiku_enrich_task(
    self,
    wine_id: str,
    wine_name: str,
    vintage: Optional[str] = None,
) -> Optional[dict]:
    """
    Celery task: enrich a single wine via Claude Haiku.

    Args:
        wine_id: UUID string of the master_wine_library_submissions row.
        wine_name: Wine name string as extracted by Claude Vision.
        vintage: Vintage year as string, or None.

    Returns:
        Dict of enriched fields on success, None if skipped.
    Raises:
        Exception: Triggers Celery autoretry up to max_retries=3.
    """
    try:
        result = asyncio.run(_enrich_async(wine_id, wine_name, vintage))
        return result
    except Exception as exc:
        retry_num = self.request.retries  # 0, 1, 2
        countdown = 60 * (2 ** retry_num)  # 60, 120, 240
        logger.warning(
            f"haiku.enrich_wine failed for wine_id={wine_id} "
            f"(attempt {retry_num + 1}/3): {exc}. "
            f"Retrying in {countdown}s."
        )
        if retry_num >= self.max_retries - 1:
            logger.warning(
                f"haiku.enrich_wine exhausted retries for wine_id={wine_id}. "
                f"Wine stays unenriched — no user-visible error."
            )
            return None
        raise self.retry(exc=exc, countdown=countdown)


async def _enrich_async(
    wine_id: str,
    wine_name: str,
    vintage: Optional[str],
) -> Optional[dict]:
    """
    Async implementation: call service, persist result to master_wine_library.
    Returns dict of persisted fields, or None if enrichment was skipped.
    """
    from services.haiku_enrichment_service import HaikuEnrichmentService

    service = HaikuEnrichmentService()
    result = await service.enrich(wine_id=wine_id, wine_name=wine_name, vintage=vintage)

    if result is None:
        logger.info(f"Enrichment skipped for wine_id={wine_id} (already complete)")
        return None

    # Persist enriched fields to master_wine_library_submissions (the staging table).
    # The row lives here until a human reviewer promotes it via PATCH /quality/review-queue.
    # Updating the submissions table ensures enrichment data survives and is included when
    # quality_routes.py promotes the wine to master_wine_library.
    supabase = _get_supabase_client()
    update_payload = {
        "region": result.region,
        "country": result.country,
        "grape_variety": result.grape_variety,
        "producer_bio": result.producer_bio,
        "enrichment_source": result.enrichment_source,  # "haiku"
        "ai_enriched": True,
    }
    # Remove None values to avoid overwriting existing non-null fields
    update_payload = {k: v for k, v in update_payload.items() if v is not None}
    # Keep enrichment_source and ai_enriched regardless
    update_payload["enrichment_source"] = result.enrichment_source
    update_payload["ai_enriched"] = True

    supabase.table("master_wine_library_submissions").update(update_payload).eq("id", wine_id).execute()

    logger.info(
        f"Enriched wine_id={wine_id} ({wine_name}): "
        f"region={result.region}, country={result.country}, "
        f"grape_variety={result.grape_variety}, enrichment_source=haiku"
    )
    return update_payload
