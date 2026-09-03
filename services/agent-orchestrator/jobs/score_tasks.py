"""
Score Lookup & Dataset Enrichment Celery Tasks
=================================================
Phase 10: Background critic score aggregation and dataset metadata enrichment.

score_lookup_task:
  1. Acquire Redis SET NX lock (wine:scores:{wine_id}, TTL=3600) — dedup
  2. Fetch wine from master_wine_library (name, producer, vintage)
  3. For each of 6 Serper queries (WA, WS, Vivino, Decanter, JR, Wine-Searcher):
     a. check_and_reserve_search_budget() — abort per source if cap reached
     b. await serper_search(query, num_results=5)
     c. parse_serper_score_snippets() → score dict or None
     d. log Serper spend ($0.001/query)
  4. Merge new scores into existing critic_scores JSONB (never overwrite prior finds)
  5. compute_composite_score() — None if < 2 sources
  6. Write critic_scores + retail_price_avg + scores_last_updated_at to master_wine_library
  7. Recompute markup_ratio for all restaurant_inventory rows for this wine
  8. Flag anomaly rows in field_review_queue (markup_ratio > 5.0 or < 0.8)
  9. Release Redis lock (finally block)

dataset_enrich_task:
  1. Acquire Redis SET NX lock (wine:dataset:{wine_id}, TTL=3600) — dedup
  2. Call DatasetIngestionService.enrich_wine(wine_id)
  3. Release lock

rescore_stale_wines_task:
  1. Fetch all master_wine_library rows where critic_scores = '{}' OR
     scores_last_updated_at < NOW() - INTERVAL '30 days' (Python-side filter)
  2. Queue score_lookup_task.delay(wine_id) for each

Requirements: CRIT-01, CRIT-04, CRIT-05, CRIT-06
"""

import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

import redis as redis_lib
from supabase import create_client

from config.settings import get_settings
from jobs.celery_app import celery_app
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_supabase_client():
    return create_client(settings.supabase_url, settings.supabase_key)


# =============================================================================
# score_lookup_task  (CRIT-01)
# =============================================================================


@celery_app.task(
    name="score.lookup_wine",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def score_lookup_task(self, wine_id: str) -> Optional[Dict[str, Any]]:
    """
    CRIT-01: Background critic score aggregation for a single wine.

    Redis dedup: SET NX key wine:scores:{wine_id} TTL=3600.
    Released in finally block (same pattern as ontology_tasks.py).
    """
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:scores:{wine_id}"

    acquired = r.set(lock_key, "1", nx=True, ex=3600)
    if not acquired:
        logger.info("score_lookup_task: deduplicated for wine_id=%s", wine_id)
        return None

    try:
        return asyncio.run(_score_async(wine_id))
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2**retry_num)  # 60, 120, 240s
        logger.warning(
            "score_lookup_task failed for wine_id=%s (attempt %d/3): %s. Retrying in %ds.",
            wine_id,
            retry_num + 1,
            exc,
            countdown,
        )
        if retry_num >= self.max_retries - 1:
            logger.warning(
                "score_lookup_task exhausted retries for wine_id=%s", wine_id
            )
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)


async def _score_async(wine_id: str) -> Optional[Dict[str, Any]]:
    """
    Core async score aggregation. One asyncio.run() per task invocation.
    All 6 Serper calls are awaited inside this single coroutine (Pitfall 2 prevention).
    """
    from services.critic_score_service import (
        build_critic_score_queries,
        parse_serper_score_snippets,
        compute_composite_score,
    )
    from services.serper_client import serper_search
    from jobs.web_verify_tasks import check_and_reserve_search_budget

    supabase = _get_supabase_client()

    # Fetch wine record
    resp = (
        supabase.table("master_wine_library")
        .select("id, name, producer, vintage, critic_scores, retail_price_avg")
        .eq("id", wine_id)
        .maybe_single()
        .execute()
    )
    if not resp.data:
        logger.warning(
            "_score_async: wine_id=%s not found in master_wine_library", wine_id
        )
        return None

    wine = resp.data
    wine_name = wine.get("name") or ""
    producer = wine.get("producer") or None
    vintage = wine.get("vintage") or None

    if not wine_name:
        logger.warning("_score_async: wine_id=%s has no name — skipping", wine_id)
        return None

    # Fetch existing critic_scores and merge (Pitfall 4: never overwrite existing finds)
    existing_scores: Dict[str, Any] = wine.get("critic_scores") or {}
    if not isinstance(existing_scores, dict):
        existing_scores = {}

    queries = build_critic_score_queries(wine_name, producer, vintage)
    new_scores: Dict[str, Any] = {}
    sources_found = 0

    # Score sources in priority order (5 critic sources)
    for source_key in (
        "wine_advocate",
        "wine_spectator",
        "vivino",
        "decanter",
        "jancis_robinson",
    ):
        query = queries[source_key]

        # Check budget per source call (Pitfall 3: use INCRBYFLOAT atomic check)
        if not check_and_reserve_search_budget():
            logger.info(
                "_score_async: budget cap reached at source=%s wine_id=%s",
                source_key,
                wine_id,
            )
            break

        _t0 = time.perf_counter()
        snippets = await serper_search(query, num_results=5)

        # OD-59 / P3.0 `results_parsed_v1`: the parse is hoisted ABOVE the spend
        # log so the emit can grade on what the search actually YIELDED.
        #
        # A paid search that returns five irrelevant snippets used to record
        # identically to one that found the score. That is the number that
        # matters here — Serper is billed per query, and "the HTTP call
        # completed" is not a thing anyone is buying.
        parsed = (
            parse_serper_score_snippets(
                [
                    {"title": s["title"], "link": s["link"], "snippet": s["snippet"]}
                    for s in snippets
                ],
                source_key,
            )
            if snippets
            else None
        )

        # Log Serper spend.
        # P1 fix: wine_id is NOT a restaurant_id — it now rides in context.
        try:
            get_spend_logger().log(
                provider="serper",
                model="serper-search",
                input_tokens=0,
                output_tokens=0,
                cost_usd=settings.serper_cost_per_query,
                restaurant_id=None,
                agent="score_agent",
                task_type="score_search",
                choice=f"search:{len(snippets)}_results",
                # success  — snippets came back AND a score parsed out of them.
                # failure  — we paid for results and none of them were usable.
                # null     — the search found nothing at all. Whether this wine
                #            has no coverage or the query was wrong is NOT
                #            knowable here, and guessing would train people to
                #            ignore the number.
                outcome=("success" if parsed else "failure") if snippets else None,
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                context={
                    "outcome_basis": "results_parsed_v1",
                    "wine_id": wine_id,
                    "source": source_key,
                    "results_count": len(snippets),
                    "parsed": bool(parsed),
                    **(
                        {"untestable": "search_returned_no_results"}
                        if not snippets
                        else {}
                    ),
                },
            )
        except Exception:
            pass

        if not snippets:
            new_scores[source_key] = {"status": "not_found"}
            continue

        if parsed:
            new_scores[source_key] = {
                "raw_score": parsed["raw_score"],
                "normalized_score": parsed["normalized_score"],
                "source": parsed["source"],
                "review_date": parsed["review_date"],
                "reviewer": parsed["reviewer"],
                "link": parsed["link"],
            }
            sources_found += 1
        else:
            new_scores[source_key] = {"status": "not_found"}

    # Retail pricing (Wine-Searcher via Serper — 6th Serper target)
    retail_price_avg: Optional[float] = wine.get("retail_price_avg")
    if check_and_reserve_search_budget():
        price_query = queries["wine_searcher"]
        _t0 = time.perf_counter()
        price_snippets = await serper_search(price_query, num_results=5)
        # Parse hoisted above the emit for the same reason as score_search.
        price_parsed = (
            parse_serper_score_snippets(
                [
                    {"title": s["title"], "link": s["link"], "snippet": s["snippet"]}
                    for s in price_snippets
                ],
                "wine_searcher",
            )
            if price_snippets
            else None
        )
        # P1 fix: wine_id is NOT a restaurant_id — it now rides in context.
        try:
            get_spend_logger().log(
                provider="serper",
                model="serper-search",
                input_tokens=0,
                output_tokens=0,
                cost_usd=settings.serper_cost_per_query,
                restaurant_id=None,
                agent="score_agent",
                task_type="price_search",
                choice=f"search:{len(price_snippets)}_results",
                # Same `results_parsed_v1` reading as score_search above.
                outcome=(
                    ("success" if price_parsed else "failure")
                    if price_snippets
                    else None
                ),
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                context={
                    "outcome_basis": "results_parsed_v1",
                    "wine_id": wine_id,
                    "results_count": len(price_snippets),
                    "parsed": bool(price_parsed),
                    **(
                        {"untestable": "search_returned_no_results"}
                        if not price_snippets
                        else {}
                    ),
                },
            )
        except Exception:
            pass
        if price_parsed:
            retail_price_avg = price_parsed["raw_score"]

    # Merge new scores into existing (Pitfall 4: preserve prior finds)
    merged_scores = {**existing_scores}
    for source, data in new_scores.items():
        existing_entry = merged_scores.get(source, {})
        if (
            isinstance(existing_entry, dict)
            and existing_entry.get("normalized_score") is not None
        ):
            pass  # Keep existing score — already verified
        else:
            merged_scores[source] = data

    # Composite score (CRIT-03)
    composite = compute_composite_score(merged_scores)
    if composite is not None:
        merged_scores["composite"] = composite

    # Write to master_wine_library
    update_payload: Dict[str, Any] = {
        "critic_scores": merged_scores,
        "scores_last_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if retail_price_avg is not None:
        update_payload["retail_price_avg"] = retail_price_avg

    supabase.table("master_wine_library").update(update_payload).eq(
        "id", wine_id
    ).execute()

    # CRIT-05: Recompute markup for all restaurant_inventory rows (cascade update)
    if retail_price_avg is not None:
        _update_inventory_markup(supabase, wine_id, retail_price_avg)

    logger.info(
        "_score_async: wine_id=%s complete — sources_found=%d composite=%s retail=%s",
        wine_id,
        sources_found,
        composite,
        retail_price_avg,
    )
    return {
        "wine_id": wine_id,
        "sources_found": sources_found,
        "composite": composite,
        "retail_price_avg": retail_price_avg,
    }


def _update_inventory_markup(supabase, wine_id: str, retail_price_avg: float) -> None:
    """
    CRIT-05 / CRIT-06: Recompute markup_ratio + markup_classification for all
    restaurant_inventory rows that reference this wine. Insert field_review_queue
    anomaly rows for markup_ratio > 5.0 or < 0.8.
    """
    from services.critic_score_service import compute_markup_info

    inv_resp = (
        supabase.table("restaurant_inventory")
        .select("id, menu_price_current")
        .eq("master_wine_id", wine_id)
        .execute()
    )
    rows = inv_resp.data or []

    for row in rows:
        menu_price = row.get("menu_price_current")
        markup_info = compute_markup_info(menu_price, retail_price_avg)
        if markup_info is None:
            continue

        supabase.table("restaurant_inventory").update(
            {
                "markup_ratio": markup_info["markup_ratio"],
                "markup_classification": markup_info["markup_classification"],
            }
        ).eq("id", row["id"]).execute()

        # CRIT-06: Anomaly detection — flag for review
        if markup_info["is_anomaly"]:
            try:
                supabase.table("field_review_queue").insert(
                    {
                        "submission_id": wine_id,
                        "field_name": "markup_ratio",
                        "current_value": str(markup_info["markup_ratio"]),
                        "confidence": 0.5,
                        "source": "pricing_anomaly",
                        "status": "pending",
                    }
                ).execute()
                logger.info(
                    "_update_inventory_markup: anomaly flagged wine_id=%s markup_ratio=%s",
                    wine_id,
                    markup_info["markup_ratio"],
                )
            except Exception as exc:
                logger.warning(
                    "_update_inventory_markup: failed to insert anomaly for wine_id=%s: %s",
                    wine_id,
                    exc,
                )


# =============================================================================
# dataset_enrich_task  (D-02, CRIT-01 pipeline)
# =============================================================================


@celery_app.task(
    name="score.dataset_enrich_wine",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def dataset_enrich_task(self, wine_id: str) -> Optional[Dict[str, Any]]:
    """
    D-02: Dataset metadata enrichment for a single wine.
    Calls DatasetIngestionService.enrich_wine(wine_id).
    Redis dedup: SET NX key wine:dataset:{wine_id} TTL=3600.
    """
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:dataset:{wine_id}"

    acquired = r.set(lock_key, "1", nx=True, ex=3600)
    if not acquired:
        logger.info("dataset_enrich_task: deduplicated for wine_id=%s", wine_id)
        return None

    try:
        from services.dataset_ingestion_service import DatasetIngestionService

        service = DatasetIngestionService()
        result = service.enrich_wine(wine_id)
        logger.info(
            "dataset_enrich_task: wine_id=%s result=%s", wine_id, result.get("status")
        )
        return result
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2**retry_num)
        logger.warning(
            "dataset_enrich_task failed for wine_id=%s (attempt %d/3): %s. Retrying in %ds.",
            wine_id,
            retry_num + 1,
            exc,
            countdown,
        )
        if retry_num >= self.max_retries - 1:
            logger.warning(
                "dataset_enrich_task exhausted retries for wine_id=%s", wine_id
            )
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)


# =============================================================================
# rescore_stale_wines_task  (D-03b — nightly beat)
# =============================================================================


@celery_app.task(name="score.rescore_stale_wines")
def rescore_stale_wines_task() -> Dict[str, Any]:
    """
    D-03b: Nightly beat task. Queues score_lookup_task for stale wines.
    Stale = critic_scores is '{}' OR scores_last_updated_at older than 30 days.
    Uses Python-side filtering (supabase-py .or_() cannot use NOW()-INTERVAL natively).
    """
    supabase = _get_supabase_client()
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    # Fetch all wines with scores metadata — filter stale in Python (A4 workaround)
    resp = (
        supabase.table("master_wine_library")
        .select("id, critic_scores, scores_last_updated_at")
        .execute()
    )
    wines = resp.data or []
    queued = 0

    for wine in wines:
        scores = wine.get("critic_scores") or {}
        last_updated = wine.get("scores_last_updated_at")

        is_empty = not scores or scores == {} or scores == "{}"
        is_stale = last_updated is None or last_updated < stale_cutoff

        if is_empty or is_stale:
            score_lookup_task.delay(wine["id"])
            queued += 1

    logger.info("rescore_stale_wines_task: queued %d wines for rescoring", queued)
    return {"queued": queued, "stale_cutoff": stale_cutoff}
