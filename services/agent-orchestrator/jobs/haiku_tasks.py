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
from services.field_confidence import merge_field_confidence, JSONB_ENRICHMENT_KEYS

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
        countdown = 60 * (2**retry_num)  # 60, 120, 240
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

    supabase = _get_supabase_client()

    # Read existing field_confidence from submissions row (Vision data from Pass 1)
    sub_resp = (
        supabase.table("master_wine_library_submissions")
        .select("field_confidence")
        .eq("id", wine_id)
        .maybe_single()
        .execute()
    )
    existing_fc = (sub_resp.data or {}).get("field_confidence") or {}

    # Merge Haiku field_confidence into Vision field_confidence
    # Vision data preserved when its confidence >= Haiku confidence (D-08)
    merged_fc = merge_field_confidence(existing_fc, result.field_confidence)

    # Build update payload: merged field_confidence + 6 JSONB enrichment columns
    update_payload = {
        "field_confidence": merged_fc,
        "enrichment_source": result.enrichment_source,
        "ai_enriched": True,
    }

    # Add 6 JSONB enrichment fields if Haiku returned them
    for jsonb_key in JSONB_ENRICHMENT_KEYS:
        val = getattr(result, jsonb_key, None)
        if val is not None:
            update_payload[jsonb_key] = val

    supabase.table("master_wine_library_submissions").update(update_payload).eq(
        "id", wine_id
    ).execute()

    # WSRCH-07: Trigger web verification if eligible
    # Late import to avoid circular deps (web_verify_tasks imports celery_app which imports haiku_tasks)
    try:
        from jobs.web_verify_tasks import web_verify_task, _should_web_verify
        from services.producer_normalization import normalize_producer_name
        from services.web_verification_service import lookup_producer

        producer_value = merged_fc.get("producer", {}).get("value") or ""
        normalized_producer = normalize_producer_name(producer_value)
        producer_in_graph = (
            lookup_producer(normalized_producer) is not None
            if normalized_producer
            else False
        )

        if _should_web_verify(merged_fc, producer_in_graph):
            web_verify_task.delay(wine_id)
            logger.info(
                "haiku_tasks: queued web_verify_task for wine_id=%s (producer_in_graph=%s)",
                wine_id,
                producer_in_graph,
            )
            # web_verify_tasks will trigger ontology_validate_task at its end (primary path)
        else:
            # Web verify skipped — trigger ontology directly (fallback path)
            # Ensures every wine gets ontology validation even if web search was skipped
            try:
                from jobs.ontology_tasks import ontology_validate_task

                ontology_validate_task.delay(wine_id)
                logger.info(
                    "haiku_tasks: queued ontology_validate_task directly for wine_id=%s "
                    "(web verify skipped — fallback path)",
                    wine_id,
                )
            except Exception as onto_exc:
                logger.warning(
                    "haiku_tasks: failed to queue ontology_validate_task for wine_id=%s: %s",
                    wine_id,
                    onto_exc,
                )
    except Exception as exc:
        # Non-fatal: enrichment already complete; web verification can run later
        logger.warning(
            "haiku_tasks: failed to queue web_verify_task for wine_id=%s: %s",
            wine_id,
            exc,
        )

    logger.info(
        "Enriched wine_id=%s (%s): %d FC fields merged, enrichment_source=haiku",
        wine_id,
        wine_name,
        len(result.field_confidence),
    )
    return {"fields_enriched": len(result.field_confidence), "wine_id": wine_id}
