"""
Web Verification Celery Task
=============================
Phase 8: Background per-wine web search verification agent.

Pipeline per invocation:
  1. Acquire Redis SET NX lock (wine:verify:{wine_id}, TTL=3600) — dedup
  2. check_and_reserve_search_budget() — atomic Redis INCRBYFLOAT cap check
  3. Fetch wine from master_wine_library_submissions
  4. _should_web_verify() — tiered eligibility (WSRCH-07)
  5. lookup_producer() → if known: apply_producer_graph_enrichment(), skip Serper
  6. If new producer: serper_search() → parse_search_results() → concordance loop
  7. merge updated field_confidence to Supabase
  8. upsert_producer() → update knowledge graph
  9. Log Serper cost ($0.001) via SpendLogger
 10. Release Redis lock (finally block — Pitfall 7 prevention)

Retry policy: max_retries=3, countdown 60→120→240s (matching haiku_tasks.py pattern).
"""

import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

import redis as redis_lib
from supabase import create_client

from config.settings import get_settings
from jobs.celery_app import celery_app
from services.field_confidence import merge_field_confidence
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_supabase_client():
    return create_client(settings.supabase_url, settings.supabase_key)


# ---------------------------------------------------------------------------
# Budget cap helper (WSRCH-08)
# ---------------------------------------------------------------------------

def check_and_reserve_search_budget(
    cost_per_search: Optional[float] = None,
) -> bool:
    """
    Atomically check and reserve budget for one web search.

    Uses Redis INCRBYFLOAT — atomic across distributed Celery workers.
    This prevents Pitfall 3 (non-atomic cap check causing overspend when
    multiple workers all see budget under cap simultaneously).

    Strategy:
      1. INCRBYFLOAT the daily counter by cost_per_search
      2. If new total > daily cap: UNDO the increment, return False
      3. If new total <= cap: budget reserved, return True
      4. Set 2-day TTL on key (cleanup — key auto-expires)

    Returns:
        True if budget available and reserved, False if cap reached.
        Returns True on Redis error (fail open — never block on infra failure).
    """
    try:
        cost = cost_per_search or settings.serper_cost_per_query  # 0.001
        cap = settings.web_search_daily_budget_usd                  # 5.0

        r = redis_lib.from_url(settings.celery_broker_url)
        today_key = f"web_search:daily_spend:{date.today().isoformat()}"

        new_total = float(r.incrbyfloat(today_key, cost))
        r.expire(today_key, 86400 * 2)  # 2-day TTL for cleanup

        if new_total > cap:
            # Undo increment — we're over budget
            r.incrbyfloat(today_key, -cost)
            logger.warning(
                "web_verify: daily budget cap reached (%.4f > %.2f) — task skipped",
                new_total, cap,
            )
            return False
        return True
    except Exception as exc:
        logger.warning("check_and_reserve_search_budget: Redis error (fail open): %s", exc)
        return True  # fail open — never block verification on Redis infra issue


# ---------------------------------------------------------------------------
# Tiered search eligibility (WSRCH-07)
# ---------------------------------------------------------------------------

def _should_web_verify(
    fc: Dict[str, Dict[str, Any]],
    producer_in_graph: bool,
) -> bool:
    """
    Tiered search strategy — return True if this wine should be web-verified.

    Conditions (any True → verify):
      (a) Any field in FC has confidence < 0.8
      (b) Producer not in knowledge graph (new/unknown producer)
      (c) No field has verification_status that is not "unverified"
          (i.e., wine has never been web-verified)

    Wines already fully verified with all fields >= 0.8 AND known producer
    are skipped — avoid burning budget on already-verified records.
    """
    if not producer_in_graph:
        return True  # (b) always verify new producers

    if not fc:
        return True  # empty FC = needs everything

    # (a) any low-confidence field
    any_low_confidence = any(
        float(entry.get("confidence", 1.0)) < 0.8
        for entry in fc.values()
        if isinstance(entry, dict)
    )
    if any_low_confidence:
        return True

    # (c) never web-verified
    never_verified = not any(
        isinstance(entry, dict) and
        entry.get("verification_status") not in (None, "unverified")
        for entry in fc.values()
    )
    return never_verified


# ---------------------------------------------------------------------------
# Celery task (WSRCH-01)
# ---------------------------------------------------------------------------

@celery_app.task(
    name="web_verify.verify_wine",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    default_retry_delay=60,
)
def web_verify_task(self, wine_id: str) -> Optional[dict]:
    """
    WSRCH-01: Background web search verification for a single wine.

    Args:
        wine_id: UUID of the master_wine_library_submissions row to verify.

    Returns:
        Dict with verification summary on success, None if skipped or failed.

    Redis dedup: SET NX key wine:verify:{wine_id} TTL=3600.
    Released in finally block (Pitfall 7 — always release even on exception).
    """
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:verify:{wine_id}"

    # Atomic dedup — SET NX EX (only set if not exists, expire in 1 hour)
    acquired = r.set(lock_key, "1", nx=True, ex=3600)
    if not acquired:
        logger.info(
            "web_verify_task: deduplicated for wine_id=%s (already queued/running)", wine_id
        )
        return None

    try:
        result = asyncio.run(_verify_async(wine_id))
        return result
    except Exception as exc:
        retry_num = self.request.retries  # 0, 1, 2
        countdown = 60 * (2 ** retry_num)  # 60, 120, 240
        logger.warning(
            "web_verify_task failed for wine_id=%s (attempt %d/3): %s. Retrying in %ds.",
            wine_id, retry_num + 1, exc, countdown,
        )
        if retry_num >= self.max_retries - 1:
            logger.warning(
                "web_verify_task exhausted retries for wine_id=%s — wine stays unverified",
                wine_id,
            )
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        # ALWAYS release lock — TTL is safety net, explicit delete is correct behavior
        r.delete(lock_key)


# ---------------------------------------------------------------------------
# Async implementation
# ---------------------------------------------------------------------------

async def _verify_async(wine_id: str) -> Optional[dict]:
    """
    Core async verification logic. Called from web_verify_task via asyncio.run().

    Returns:
        Dict summarising what was verified, or None if skipped.
    """
    # Late imports to avoid circular imports at module load time
    from services.web_verification_service import (
        parse_search_results,
        check_concordance,
        apply_concordance_result,
        apply_producer_graph_enrichment,
        lookup_producer,
        upsert_producer,
    )
    from services.producer_normalization import normalize_producer_name, build_search_query
    from services.serper_client import serper_search

    supabase = _get_supabase_client()

    # Fetch wine record
    resp = (
        supabase.table("master_wine_library_submissions")
        .select("id, payload, field_confidence")
        .eq("id", wine_id)
        .maybe_single()
        .execute()
    )
    if not resp.data:
        logger.warning("_verify_async: wine_id=%s not found in submissions", wine_id)
        return None

    payload = resp.data.get("payload") or {}
    existing_fc: Dict[str, Any] = resp.data.get("field_confidence") or {}

    wine_name = (
        existing_fc.get("wine_name", {}).get("value")
        or payload.get("wine_name")
        or ""
    )
    producer_raw = (
        existing_fc.get("producer", {}).get("value")
        or payload.get("producer")
        or ""
    )
    vintage = (
        existing_fc.get("vintage", {}).get("value")
        or payload.get("vintage")
        or None
    )

    if not wine_name:
        logger.warning("_verify_async: wine_id=%s has no wine_name — skipping", wine_id)
        return None

    # WSRCH-05: Producer graph lookup BEFORE web search
    normalized_producer = normalize_producer_name(producer_raw) if producer_raw else ""
    producer_row = lookup_producer(normalized_producer) if normalized_producer else None
    producer_in_graph = producer_row is not None

    # WSRCH-07: Tiered eligibility check
    if not _should_web_verify(existing_fc, producer_in_graph):
        logger.info(
            "_verify_async: wine_id=%s already verified + known producer — skipping",
            wine_id,
        )
        return {"wine_id": wine_id, "status": "skipped_already_verified"}

    updated_fc = dict(existing_fc)
    fields_verified = 0

    if producer_in_graph:
        # Instant enrichment from producer graph — no API call needed
        updated_fc = apply_producer_graph_enrichment(updated_fc, producer_row)
        logger.info(
            "_verify_async: wine_id=%s enriched from producer graph (producer=%r)",
            wine_id, producer_raw,
        )
        fields_verified = sum(
            1 for v in updated_fc.values()
            if isinstance(v, dict) and v.get("verification_status") == "producer_graph"
        )
    else:
        # WSRCH-08: Daily budget cap — check BEFORE Serper call
        if not check_and_reserve_search_budget():
            logger.info(
                "_verify_async: wine_id=%s — daily budget cap reached, skipping web search",
                wine_id,
            )
            return {"wine_id": wine_id, "status": "skipped_budget_cap"}

        # Build search query per WSRCH-01 spec
        query = build_search_query(producer_raw, wine_name, str(vintage) if vintage else None)
        logger.info("_verify_async: searching wine_id=%s query=%r", wine_id, query)

        # Execute Serper search
        snippets = await serper_search(query, num_results=5)

        # Log Serper spend (fixed $0.001/query per Starter plan)
        try:
            get_spend_logger().log(
                provider="serper",
                model="serper-search",
                input_tokens=0,
                output_tokens=0,
                cost_usd=settings.serper_cost_per_query,
                restaurant_id=wine_id,
            )
        except Exception:
            pass

        if not snippets:
            logger.info(
                "_verify_async: wine_id=%s Serper returned 0 results — skipping concordance",
                wine_id,
            )
            return {"wine_id": wine_id, "status": "no_search_results"}

        # WSRCH-02: Parse snippets via Gemini 2.5 Flash
        verification_result = await parse_search_results(
            snippets=[{"title": s["title"], "snippet": s["snippet"], "link": s["link"]} for s in snippets],
            wine_name=wine_name,
            producer=producer_raw or None,
            vintage=str(vintage) if vintage else None,
        )

        if verification_result is None:
            logger.info(
                "_verify_async: wine_id=%s Gemini parse returned None — skipping concordance",
                wine_id,
            )
            return {"wine_id": wine_id, "status": "parse_failed"}

        # Source confidence from Gemini (0.0-1.0)
        web_confidence = verification_result.source_confidence or 0.7

        # WSRCH-03: Concordance loop — check each web field against existing FC
        verifiable_fields = {
            "producer": verification_result.producer,
            "region": verification_result.region,
            "sub_region": verification_result.sub_region,
            "appellation": verification_result.appellation,
            "country": verification_result.country,
            "grape_variety": verification_result.grape_variety,
            "color": verification_result.color,
            "primary_type": verification_result.primary_type,
            "sweetness_level": verification_result.sweetness_level,
            "alcohol_pct": verification_result.alcohol_pct,
            "tasting_notes": verification_result.tasting_notes,
        }

        for field_name, web_value in verifiable_fields.items():
            if web_value is None:
                continue  # web source had no data for this field
            existing_entry = updated_fc.get(field_name, {})
            concordance = check_concordance(field_name, existing_entry, web_value)
            updated_fc = apply_concordance_result(
                updated_fc, field_name, web_value, web_confidence, concordance
            )
            fields_verified += 1
            if concordance == "contradiction":
                logger.info(
                    "_verify_async: contradiction on field=%r wine_id=%s "
                    "existing=%r web=%r",
                    field_name, wine_id,
                    existing_entry.get("value"), web_value,
                )

        # WSRCH-05: Upsert producer into knowledge graph if we have enough data
        if producer_raw and verification_result.country:
            upsert_producer(
                name=producer_raw,
                normalized_name=normalized_producer,
                verification_result=verification_result,
                verification_source="web_search",
            )

    # Persist updated field_confidence back to Supabase
    supabase.table("master_wine_library_submissions").update(
        {
            "field_confidence": updated_fc,
            "web_verified_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", wine_id).execute()

    logger.info(
        "_verify_async: wine_id=%s complete — %d fields verified, producer_in_graph=%s",
        wine_id, fields_verified, producer_in_graph,
    )

    # ONTO-05: Trigger ontology cross-validation after web verification (primary path)
    # Non-fatal: web verification is already complete; ontology failure cannot block it
    try:
        from jobs.ontology_tasks import ontology_validate_task
        ontology_validate_task.delay(wine_id)
        logger.info(
            "_verify_async: queued ontology_validate_task for wine_id=%s", wine_id
        )
    except Exception as exc:
        logger.warning(
            "_verify_async: failed to queue ontology_validate_task for wine_id=%s: %s",
            wine_id, exc,
        )

    return {
        "wine_id": wine_id,
        "fields_verified": fields_verified,
        "producer_in_graph": producer_in_graph,
    }
