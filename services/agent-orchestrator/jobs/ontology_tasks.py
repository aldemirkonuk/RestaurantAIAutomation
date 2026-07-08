"""
Ontology Cross-Validation Celery Task
======================================
Phase 9: Post-enrichment rule-based cross-validation of wine records against ontology facts.

Pipeline per invocation:
  1. Acquire Redis SET NX lock (wine:ontology:{wine_id}, TTL=3600) — dedup
  2. Fetch wine field_confidence from master_wine_library_submissions
  3. Call OntologyValidationService.run_ontology_validation(wine_id)
  4. Service writes ontology_validation JSONB + routes CRITICAL failures to field_review_queue
  5. Release Redis lock (finally block)

Triggered by:
  - web_verify_tasks._verify_async: at end of successful web verification (primary path)
  - haiku_tasks._enrich_async: fallback when web verification is skipped (ensures every wine is validated)

Retry policy: max_retries=3, countdown 60→120→240s (matching web_verify_tasks.py pattern).

Requirements: ONTO-05, ONTO-06, ONTO-07, ONTO-08
"""

import logging
from typing import Any, Dict, Optional

import redis as redis_lib

from config.settings import get_settings
from jobs.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(
    name="ontology.validate_wine",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    default_retry_delay=60,
)
def ontology_validate_task(self, wine_id: str) -> Optional[Dict[str, Any]]:
    """
    ONTO-05: Background ontology cross-validation for a single wine.

    Args:
        wine_id: UUID of the master_wine_library_submissions row to validate.

    Returns:
        Dict with validation summary on success, None if skipped or failed.

    Redis dedup: SET NX key wine:ontology:{wine_id} TTL=3600.
    Released in finally block — same pattern as web_verify_task.
    """
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:ontology:{wine_id}"

    # Atomic dedup — SET NX EX (only set if not exists, expire in 1 hour)
    acquired = r.set(lock_key, "1", nx=True, ex=3600)
    if not acquired:
        logger.info(
            "ontology_validate_task: deduplicated for wine_id=%s (already queued/running)",
            wine_id,
        )
        return None

    try:
        result = _validate_sync(wine_id)
        return result
    except Exception as exc:
        retry_num = self.request.retries  # 0, 1, 2
        countdown = 60 * (2**retry_num)  # 60, 120, 240
        logger.warning(
            "ontology_validate_task failed for wine_id=%s (attempt %d/3): %s. Retrying in %ds.",
            wine_id,
            retry_num + 1,
            exc,
            countdown,
        )
        if retry_num >= self.max_retries - 1:
            logger.warning(
                "ontology_validate_task exhausted retries for wine_id=%s — wine stays unvalidated",
                wine_id,
            )
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        # ALWAYS release lock — TTL is safety net, explicit delete is correct behavior
        r.delete(lock_key)


def _validate_sync(wine_id: str) -> Optional[Dict[str, Any]]:
    """
    Synchronous validation logic. Called from ontology_validate_task.

    Late import of OntologyValidationService to avoid circular imports at module load time.

    Returns:
        Dict summarising validation result, or None if wine not found.
    """
    # Late import to avoid circular imports (ontology_tasks imports celery_app;
    # OntologyValidationService imports supabase — keep import chain simple)
    from services.ontology_validation_service import OntologyValidationService

    service = OntologyValidationService()
    result = service.run_ontology_validation(wine_id)

    if result is None:
        logger.warning(
            "_validate_sync: wine_id=%s not found or validation returned None", wine_id
        )
        return None

    logger.info(
        "_validate_sync: wine_id=%s validated — checks=%d/%d failures=%d autofills=%d",
        wine_id,
        result.checks_passed,
        result.checks_total,
        result.checks_failed,
        result.autofills_applied,
    )

    # CRIT-01 / D-03a: Trigger score + dataset enrichment after ontology validation (chain end)
    try:
        from jobs.score_tasks import score_lookup_task, dataset_enrich_task

        score_lookup_task.delay(wine_id)
        dataset_enrich_task.delay(wine_id)
        logger.info(
            "_validate_sync: queued score_lookup_task + dataset_enrich_task for wine_id=%s",
            wine_id,
        )
    except Exception as exc:
        logger.warning(
            "_validate_sync: failed to queue score tasks for wine_id=%s: %s",
            wine_id,
            exc,
        )

    return {
        "wine_id": wine_id,
        "checks_passed": result.checks_passed,
        "checks_failed": result.checks_failed,
        "checks_total": result.checks_total,
        "autofills_applied": result.autofills_applied,
    }
