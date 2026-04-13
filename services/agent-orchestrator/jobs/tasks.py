import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import json

from supabase import create_client
from core.message_bus import MessageBus
from config.settings import Settings
from jobs.celery_app import celery_app
from utils.logger import setup_logger

settings = Settings()
logger = setup_logger(__name__)


async def _publish_event(exchange: str, routing_key: str, payload: Dict[str, Any]) -> None:
    message_bus = MessageBus(settings.rabbitmq_url)
    await message_bus.connect()
    try:
        await message_bus.publish(
            exchange_name=exchange,
            routing_key=routing_key,
            message_body={
                "event_type": routing_key,
                "payload": payload,
            },
            priority=7,
        )
    finally:
        await message_bus.disconnect()


def _get_supabase_client():
    """Get Supabase client for DLQ operations"""
    return create_client(settings.supabase_url, settings.supabase_key)


@celery_app.task(name="reports.generate")
def generate_report_task(restaurant_id: str, manager_id: str, report_type: str) -> None:
    asyncio.run(
        _publish_event(
            "report.events",
            "report.generate",
            {
                "restaurant_id": restaurant_id,
                "manager_id": manager_id,
                "report_type": report_type,
            },
        )
    )


@celery_app.task(name="menu.enrichment")
def menu_enrichment_task(restaurant_id: str, menu_id: str, image_url: str) -> None:
    asyncio.run(
        _publish_event(
            "menu.events",
            "menu.scan_request",
            {
                "restaurant_id": restaurant_id,
                "request_id": menu_id,
                "image_url": image_url,
            },
        )
    )


@celery_app.task(name="inventory.reconciliation")
def inventory_reconciliation_task(restaurant_id: str, inventory_id: str) -> None:
    asyncio.run(
        _publish_event(
            "stock.events",
            "stock.reconciliation.requested",
            {
                "restaurant_id": restaurant_id,
                "inventory_id": inventory_id,
            },
        )
    )


# =============================================================================
# DEAD LETTER QUEUE (DLQ) RETRY TASKS
# =============================================================================

# Exponential backoff configuration
DLQ_BASE_DELAY_SECONDS = 60  # 1 minute
DLQ_MAX_DELAY_SECONDS = 3600  # 1 hour
DLQ_MAX_RETRIES = 5
DLQ_BACKOFF_MULTIPLIER = 2


def calculate_next_retry_at(retry_count: int) -> datetime:
    """Calculate next retry time with exponential backoff"""
    delay = min(
        DLQ_BASE_DELAY_SECONDS * (DLQ_BACKOFF_MULTIPLIER ** retry_count),
        DLQ_MAX_DELAY_SECONDS
    )
    return datetime.utcnow() + timedelta(seconds=delay)


@celery_app.task(name="dlq.process_pending", bind=True, max_retries=3)
def process_dlq_pending(self) -> Dict[str, Any]:
    """
    Process pending items in the Dead Letter Queue.
    
    This task:
    1. Fetches events with status='pending' or 'retrying' where next_retry_at <= NOW
    2. Attempts to re-process each event
    3. Updates status based on success/failure
    4. Schedules next retry with exponential backoff
    
    Should be scheduled via Celery Beat to run every minute.
    """
    return asyncio.run(_process_dlq_pending_async())


async def _process_dlq_pending_async() -> Dict[str, Any]:
    """Async implementation of DLQ processing"""
    supabase = _get_supabase_client()
    
    stats = {
        "processed": 0,
        "succeeded": 0,
        "failed": 0,
        "exhausted": 0,
        "errors": [],
    }
    
    try:
        # Fetch items ready for retry
        response = supabase.table("event_dead_letters") \
            .select("*") \
            .in_("status", ["pending", "retrying"]) \
            .lte("next_retry_at", datetime.utcnow().isoformat()) \
            .order("next_retry_at", desc=False) \
            .limit(50) \
            .execute()
        
        if not response.data:
            logger.info("No DLQ items ready for retry")
            return stats
        
        logger.info(f"Processing {len(response.data)} DLQ items")
        
        for dlq_item in response.data:
            stats["processed"] += 1
            
            try:
                success = await _retry_dlq_event(supabase, dlq_item)
                
                if success:
                    stats["succeeded"] += 1
                    # Mark as resolved
                    await _update_dlq_status(
                        supabase,
                        dlq_item["id"],
                        "resolved",
                        resolved_at=datetime.utcnow().isoformat()
                    )
                    logger.info(f"DLQ item {dlq_item['id']} resolved successfully")
                else:
                    # Increment retry count
                    retry_count = dlq_item.get("retry_count", 0) + 1
                    max_retries = dlq_item.get("max_retries", DLQ_MAX_RETRIES)
                    
                    if retry_count >= max_retries:
                        stats["exhausted"] += 1
                        await _update_dlq_status(
                            supabase,
                            dlq_item["id"],
                            "exhausted"
                        )
                        logger.warning(f"DLQ item {dlq_item['id']} exhausted after {retry_count} retries")
                    else:
                        stats["failed"] += 1
                        next_retry = calculate_next_retry_at(retry_count)
                        await _update_dlq_status(
                            supabase,
                            dlq_item["id"],
                            "retrying",
                            retry_count=retry_count,
                            next_retry_at=next_retry.isoformat(),
                            last_retry_at=datetime.utcnow().isoformat()
                        )
                        logger.info(
                            f"DLQ item {dlq_item['id']} scheduled for retry "
                            f"#{retry_count} at {next_retry.isoformat()}"
                        )
            
            except Exception as e:
                stats["errors"].append({
                    "dlq_id": dlq_item["id"],
                    "error": str(e)
                })
                logger.error(f"Error processing DLQ item {dlq_item['id']}: {e}")
        
        logger.info(f"DLQ processing complete: {stats}")
        return stats
        
    except Exception as e:
        logger.error(f"DLQ processing failed: {e}")
        stats["errors"].append({"error": str(e)})
        return stats


async def _retry_dlq_event(supabase, dlq_item: Dict[str, Any]) -> bool:
    """
    Attempt to re-process a dead letter event.
    
    Returns True if successful, False otherwise.
    """
    try:
        # Reconstruct the original event payload
        event_payload = {
            "restaurant_id": dlq_item["restaurant_id"],
            "user_id": dlq_item.get("user_id"),
            "event_type": dlq_item["event_type"],
            "source_page": dlq_item["source_page"],
            "payload": dlq_item["payload"],
            "schema_version": dlq_item.get("schema_version", 1),
            "idempotency_key": dlq_item.get("idempotency_key"),
            "trace_id": dlq_item.get("trace_id"),
            "correlation_id": f"dlq_retry_{dlq_item['id']}",
        }
        
        # Try to insert into events table
        response = supabase.table("events") \
            .insert(event_payload) \
            .execute()
        
        if response.data:
            # Update DLQ with resolved event ID
            supabase.table("event_dead_letters") \
                .update({"resolved_event_id": response.data[0]["id"]}) \
                .eq("id", dlq_item["id"]) \
                .execute()
            return True
        
        return False
        
    except Exception as e:
        error_code = getattr(e, 'code', 'UNKNOWN')
        
        # Check if it's a duplicate (idempotency key exists)
        if '23505' in str(e) or 'duplicate' in str(e).lower():
            logger.info(f"DLQ item {dlq_item['id']} is a duplicate - marking as resolved")
            return True
        
        # Update error details
        supabase.table("event_dead_letters") \
            .update({
                "error_details": json.dumps({
                    "retry_error": str(e),
                    "retry_error_code": error_code,
                    "retry_timestamp": datetime.utcnow().isoformat()
                })
            }) \
            .eq("id", dlq_item["id"]) \
            .execute()
        
        return False


async def _update_dlq_status(
    supabase,
    dlq_id: str,
    status: str,
    **kwargs
) -> None:
    """Update DLQ item status and related fields"""
    update_data = {"status": status, **kwargs}
    
    supabase.table("event_dead_letters") \
        .update(update_data) \
        .eq("id", dlq_id) \
        .execute()


@celery_app.task(name="dlq.cleanup_old", bind=True)
def cleanup_old_dlq_items(self, days_old: int = 30) -> Dict[str, Any]:
    """
    Clean up old resolved/exhausted DLQ items.
    
    This task removes DLQ items older than specified days
    that are in terminal states (resolved, exhausted, ignored).
    
    Should be scheduled via Celery Beat to run daily.
    """
    return asyncio.run(_cleanup_old_dlq_items_async(days_old))


async def _cleanup_old_dlq_items_async(days_old: int) -> Dict[str, Any]:
    """Async implementation of DLQ cleanup"""
    supabase = _get_supabase_client()
    
    cutoff_date = (datetime.utcnow() - timedelta(days=days_old)).isoformat()
    
    try:
        # Delete old resolved/exhausted items
        response = supabase.table("event_dead_letters") \
            .delete() \
            .in_("status", ["resolved", "exhausted", "ignored"]) \
            .lt("failed_at", cutoff_date) \
            .execute()
        
        deleted_count = len(response.data) if response.data else 0
        
        logger.info(f"Cleaned up {deleted_count} old DLQ items (older than {days_old} days)")
        
        return {
            "deleted": deleted_count,
            "cutoff_date": cutoff_date,
        }
        
    except Exception as e:
        logger.error(f"DLQ cleanup failed: {e}")
        return {"error": str(e)}


@celery_app.task(name="dlq.get_stats")
def get_dlq_stats() -> Dict[str, Any]:
    """Get DLQ statistics for monitoring"""
    return asyncio.run(_get_dlq_stats_async())


async def _get_dlq_stats_async() -> Dict[str, Any]:
    """Async implementation of DLQ stats"""
    supabase = _get_supabase_client()
    
    try:
        # Get counts by status
        statuses = ["pending", "retrying", "exhausted", "resolved", "ignored"]
        stats = {"by_status": {}, "by_error_code": {}, "total": 0}
        
        for status in statuses:
            response = supabase.table("event_dead_letters") \
                .select("id", count="exact") \
                .eq("status", status) \
                .execute()
            
            count = response.count if hasattr(response, 'count') else len(response.data or [])
            stats["by_status"][status] = count
            stats["total"] += count
        
        # Get items ready for retry
        ready_response = supabase.table("event_dead_letters") \
            .select("id", count="exact") \
            .in_("status", ["pending", "retrying"]) \
            .lte("next_retry_at", datetime.utcnow().isoformat()) \
            .execute()
        
        stats["ready_for_retry"] = ready_response.count if hasattr(ready_response, 'count') else len(ready_response.data or [])
        
        # Get error code breakdown
        error_response = supabase.table("event_dead_letters") \
            .select("error_code") \
            .in_("status", ["pending", "retrying", "exhausted"]) \
            .execute()
        
        if error_response.data:
            for item in error_response.data:
                code = item.get("error_code", "UNKNOWN")
                stats["by_error_code"][code] = stats["by_error_code"].get(code, 0) + 1
        
        return stats
        
    except Exception as e:
        logger.error(f"Failed to get DLQ stats: {e}")
        return {"error": str(e)}


# =============================================================================
# WINE MENU SCRAPING TASKS
# =============================================================================

@celery_app.task(name="scraping.daily_crawl", bind=True, max_retries=1)
def daily_crawl_task(self) -> Dict[str, Any]:
    """
    Daily automated wine menu crawling.

    1. Gets pending restaurants from discovery queue
    2. Crawls up to CRAWL_RATE_LIMIT websites
    3. Extracts wine menus (HTML/PDF)
    4. Runs through classifier + parser
    5. Saves to restaurant dataset

    Scheduled via Celery Beat to run once per day.
    """
    return asyncio.run(_daily_crawl_async())


async def _daily_crawl_async() -> Dict[str, Any]:
    """Async implementation of daily crawl."""
    from services.web_crawler import get_crawler_service, ContentType
    from services.wine_menu_classifier import get_classifier
    from services.html_menu_parser import get_menu_parser
    from services.pdf_extraction_service import get_pdf_service
    from services.quality_scorer import get_quality_scorer
    from services.restaurant_dataset_service import get_restaurant_dataset_service
    from services.opentable_discovery import CITY_CONFIGS

    crawler = get_crawler_service()
    classifier = get_classifier()
    parser = get_menu_parser()
    pdf_service = get_pdf_service()
    scorer = get_quality_scorer()
    dataset_svc = get_restaurant_dataset_service()

    stats = {
        "cities_processed": 0,
        "restaurants_crawled": 0,
        "menus_extracted": 0,
        "wines_found": 0,
        "pdfs_downloaded": 0,
        "quality_accepted": 0,
        "quality_review": 0,
        "errors": [],
    }

    crawler.reset_daily_count()

    for city_config in CITY_CONFIGS:
        city = city_config["name"]
        state = city_config["state"]

        if crawler.remaining_today <= 0:
            break

        try:
            from services.opentable_discovery import get_discovery_service
            discovery = get_discovery_service()
            pending = discovery.get_pending_restaurants(city)

            if not pending:
                continue

            stats["cities_processed"] += 1

            for rest in pending:
                if crawler.remaining_today <= 0:
                    break

                url = rest.get("website_url")
                name = rest.get("restaurant_name", "Unknown")
                if not url:
                    continue

                try:
                    # Crawl the restaurant website
                    result = await crawler.crawl_restaurant(url, name)
                    stats["restaurants_crawled"] += 1

                    text_to_parse = ""

                    if result.content_type == ContentType.HTML_MENU:
                        # Classify first
                        classification = classifier.classify(result.extracted_text)
                        if not classification.is_wine_menu:
                            continue
                        text_to_parse = result.extracted_text

                    elif result.content_type == ContentType.PDF_LINK and result.pdf_bytes:
                        stats["pdfs_downloaded"] += 1
                        pdf_result = await pdf_service.extract_from_bytes(
                            result.pdf_bytes, "menu", name
                        )
                        if pdf_result.total_wines > 0:
                            # Use merged text from PDF extraction
                            text_to_parse = "\n".join(
                                p.raw_text for p in pdf_result.pages if p.raw_text
                            )
                    else:
                        continue

                    if not text_to_parse:
                        continue

                    # Parse the menu
                    parse_result = parser.parse_menu(text_to_parse, "html", name)

                    if parse_result.total_wines == 0:
                        continue

                    stats["menus_extracted"] += 1
                    stats["wines_found"] += parse_result.total_wines

                    # Quality scoring
                    quality = scorer.score_extraction(
                        wines=parse_result.wines,
                        parser_confidence=parse_result.parser_confidence,
                        restaurant_name=name,
                        source_url=url,
                    )

                    if quality.decision == "accept":
                        stats["quality_accepted"] += 1
                    else:
                        stats["quality_review"] += 1

                    # Save to restaurant dataset
                    snapshot = dataset_svc.build_snapshot(
                        parse_result=parse_result.model_dump(),
                        restaurant_name=name,
                        city=city,
                        state=state,
                        source_type="scraped",
                        source_url=url,
                        metadata=rest,
                    )
                    await dataset_svc.save_snapshot(snapshot)

                except Exception as e:
                    stats["errors"].append(f"{name}: {str(e)}")
                    logger.error(f"Error processing {name}: {e}")

        except Exception as e:
            stats["errors"].append(f"City {city}: {str(e)}")

    logger.info(f"Daily crawl complete: {stats}")
    return stats


@celery_app.task(name="scraping.discovery", bind=True, max_retries=1)
def discovery_task(self, city_slug: Optional[str] = None, max_pages: int = 5) -> Dict[str, Any]:
    """
    Discover new restaurants via Google Maps + OpenTable (unified).

    Args:
        city_slug: Optional specific city to discover. If None, does all cities.
        max_pages: Max OpenTable search pages per city.
    """
    return asyncio.run(_discovery_async(city_slug, max_pages))


async def _discovery_async(city_slug: Optional[str], max_pages: int) -> Dict[str, Any]:
    """Async implementation of unified discovery."""
    from services.unified_discovery import get_unified_discovery_service
    from services.opentable_discovery import CITY_CONFIGS

    unified = get_unified_discovery_service()
    stats = {"cities": [], "total_new": 0, "total_deduped": 0}

    cities = CITY_CONFIGS
    if city_slug:
        cities = [c for c in CITY_CONFIGS if c["slug"] == city_slug]

    for city_config in cities:
        try:
            result = await unified.discover_city(
                city_name=city_config["name"],
                state=city_config["state"],
            )
            stats["cities"].append({
                "city": result.city,
                "google_maps": result.google_maps_found,
                "opentable": result.opentable_found,
                "after_dedup": result.total_after_dedup,
                "duplicates_removed": result.duplicates_removed,
                "saved_to_db": result.saved_to_db,
                "auto_chained": result.auto_chained,
            })
            stats["total_new"] += result.total_after_dedup
            stats["total_deduped"] += result.duplicates_removed
        except Exception as e:
            stats["cities"].append({
                "city": city_config["name"],
                "error": str(e),
            })

    return stats


@celery_app.task(name="scraping.research_unknowns", bind=True, max_retries=1)
def research_unknowns_task(self, max_wines: int = 10) -> Dict[str, Any]:
    """
    Research wines not found in master library.
    Searches Wine-Searcher and CellarTracker.
    """
    return asyncio.run(_research_unknowns_async(max_wines))


async def _research_unknowns_async(max_wines: int) -> Dict[str, Any]:
    """Async implementation of unknown wine research."""
    from services.wine_research_service import get_research_service

    research = get_research_service()
    stats = {"researched": 0, "auto_added": 0, "needs_review": 0}

    # In production, query Supabase for unmatched wines
    # For now, this is called with specific wines via the API
    logger.info(f"Research unknowns task: max_wines={max_wines}")

    return stats


# =============================================================================
# CELERY BEAT SCHEDULE (Add to celery_app.py or separate config)
# =============================================================================
#
# from celery.schedules import crontab
#
# celery_app.conf.beat_schedule = {
#     'dlq-process-pending': {
#         'task': 'dlq.process_pending',
#         'schedule': 60.0,  # Every minute
#     },
#     'dlq-cleanup-old': {
#         'task': 'dlq.cleanup_old',
#         'schedule': crontab(hour=3, minute=0),  # Daily at 3 AM
#         'args': (30,),  # 30 days old
#     },
#     'daily-menu-crawl': {
#         'task': 'scraping.daily_crawl',
#         'schedule': crontab(hour=2, minute=0),  # Daily at 2 AM
#     },
#     'weekly-discovery': {
#         'task': 'scraping.discovery',
#         'schedule': crontab(hour=1, minute=0, day_of_week='monday'),  # Weekly Monday 1 AM
#         'kwargs': {'max_pages': 10},
#     },
#     'daily-research-unknowns': {
#         'task': 'scraping.research_unknowns',
#         'schedule': crontab(hour=4, minute=0),  # Daily at 4 AM
#         'kwargs': {'max_wines': 20},
#     },
# }
