"""
Celery Beat entry for DriftAgent (SimPOS catalog ↔ WineOps drift).

Runs independently of the RabbitMQ message bus so the scheduled scan still
fires when the orchestrator is down — the agent class is instantiated with a
thin Supabase facade. When the orchestrator *is* up, the same agent also
listens for ``system.schedule.drift_check`` / ``pos.catalog.changed``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict

from supabase import create_client

from config.settings import Settings
from jobs.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = Settings()


def _get_supabase():
    key = settings.supabase_service_role_key or settings.supabase_key
    return create_client(settings.supabase_url, key)


class _DbFacade:
    def __init__(self, supabase: Any) -> None:
        self.supabase = supabase


async def _run_drift_scan_async(
    restaurant_id: str | None = None,
) -> Dict[str, Any]:
    from agents.drift_agent import DriftAgent

    agent = DriftAgent(
        agent_name="drift_agent",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(_get_supabase()),
        config={},
    )
    await agent.initialize()
    if restaurant_id:
        return await agent.check_restaurant(restaurant_id)
    return await agent.scan_all_sim_restaurants()


@celery_app.task(name="drift.scan_sim_catalogs", bind=True, max_retries=1)
def drift_scan_sim_catalogs_task(self, restaurant_id: str | None = None) -> Dict[str, Any]:
    """
    Periodic SimPOS drift scan (sim-* restaurants only).

    Schedule: Celery Beat ``drift-scan-sim-catalogs`` (hourly by default).
    Optional ``restaurant_id`` scopes the run to one tenant (still C31-guarded).
    """
    try:
        result = asyncio.run(_run_drift_scan_async(restaurant_id=restaurant_id))
        logger.info(
            "Drift scan complete: %s",
            {
                "restaurants_scanned": result.get("restaurants_scanned"),
                "restaurant_id": restaurant_id,
                "unchanged": result.get("unchanged"),
                "finding_count": len(result.get("findings") or []),
            },
        )
        return result
    except Exception as exc:
        logger.error("Drift scan failed: %s", exc, exc_info=True)
        raise self.retry(exc=exc, countdown=120)
