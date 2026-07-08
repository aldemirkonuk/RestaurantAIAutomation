"""
Health & Metrics API Routes (OBS-02, OBS-03, OBS-04)
=====================================================
All endpoints require X-Admin-Key header — server-to-server only.
The api-gateway NestJS proxy adds this header before forwarding frontend requests.

Routes:
  GET /api/v1/health/agents        — list all agent health summaries
  GET /api/v1/health/agents/{name} — detailed metrics for one agent
  GET /api/v1/metrics              — system metrics: DLQ size, active sagas, per-agent counts

NOTE: GET /health (public, no auth) is defined in main.py:143 — NOT here.
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Health & Metrics"])


def get_orchestrator():
    """Lazy proxy to main.get_orchestrator — module-level reference for testability.

    Imported lazily to avoid circular import at module load time
    (main.py imports this module at the very bottom, after get_orchestrator is defined).
    """
    from main import get_orchestrator as _real  # noqa: PLC0415

    return _real()


def verify_admin_key(x_admin_key: Optional[str] = Header(None)) -> str:
    """Require X-Admin-Key header matching ADMIN_API_KEY env var.

    Same auth pattern as api/research_routes.py:34-41 (VERIFIED).
    Used by api-gateway NestJS proxy for server-to-server calls.
    """
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    if not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    return x_admin_key


@router.get("/api/v1/health/agents")
async def get_all_agents_health(_key: str = Depends(verify_admin_key)):
    """Return health summary for all running agents.

    Uses agent.get_health() which is already implemented in BaseAgent.
    """
    orchestrator = get_orchestrator()
    if orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator not running")

    agents_health = [agent.get_health() for agent in orchestrator.agents.values()]
    return {
        "agents": agents_health,
        "count": len(agents_health),
    }


@router.get("/api/v1/health/agents/{name}")
async def get_agent_health(name: str, _key: str = Depends(verify_admin_key)):
    """Return detailed metrics for a single agent by name.

    Uses agent.get_detailed_health() which returns messages, timing, circuit breaker state.
    """
    orchestrator = get_orchestrator()
    if orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator not running")

    agent = orchestrator.agents.get(name)
    if agent is None:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{name}' not found. Running agents: {list(orchestrator.agents.keys())}",
        )
    return agent.get_detailed_health()


@router.get("/api/v1/metrics")
async def get_system_metrics(_key: str = Depends(verify_admin_key)):
    """Return system-level metrics: DLQ size, active sagas, per-agent message counts.

    Uses orchestrator.get_metrics() (already implemented) augmented with
    direct DB queries for DLQ count and active saga count.
    """
    orchestrator = get_orchestrator()
    if orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator not running")

    metrics = orchestrator.get_metrics()
    settings = get_settings()

    # Augment with DLQ count from dead_letter_queue table (Phase 18 migration)
    dlq_size = -1
    if settings.supabase_client is not None:
        try:
            dlq_result = (
                settings.supabase_client.table("dead_letter_queue")
                .select("id", count="exact")
                .execute()
            )
            dlq_size = dlq_result.count or 0
        except Exception as exc:
            logger.warning("Failed to query DLQ size: %s", exc)

    # Augment with active saga count from saga_state table
    active_sagas = -1
    if settings.supabase_client is not None:
        try:
            saga_result = (
                settings.supabase_client.table("saga_state")
                .select("id", count="exact")
                .eq("status", "running")
                .execute()
            )
            active_sagas = saga_result.count or 0
        except Exception as exc:
            logger.warning("Failed to query active sagas: %s", exc)

    return {
        **metrics,
        "dlq_size": dlq_size,
        "active_sagas": active_sagas,
    }
