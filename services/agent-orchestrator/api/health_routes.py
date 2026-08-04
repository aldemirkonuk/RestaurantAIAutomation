"""
Health & Metrics API Routes (OBS-02, OBS-03, OBS-04)
=====================================================
All endpoints require X-Admin-Key header — server-to-server only.
The api-gateway NestJS proxy adds this header before forwarding frontend requests.

Routes:
  GET /api/v1/health/agents        — list all agent health summaries
  GET /api/v1/health/agents/{name} — detailed metrics for one agent
  GET /api/v1/metrics              — system metrics: DLQ size, active sagas, per-agent
                                     counts, plus an OBS-04 `business` block

NOTE: GET /health (public, no auth) is defined in main.py:143 — NOT here.

This docstring claimed OBS-04 from the day it was written, while the endpoint only
ever returned OBS-03 infrastructure counters. The business metrics below were added
2026-08-04; before that the claim was aspirational.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Health & Metrics"])

# Default observation window for the OBS-04 business metrics, in seconds.
# Five minutes is short enough that a stall shows up while someone could still
# act on it, and long enough that a quiet minute at 3pm does not read as an outage.
BUSINESS_WINDOW_SECONDS = 300

# Cap on rows pulled back for percentile maths. Latency percentiles are computed
# in Python because the Supabase client speaks PostgREST, not raw SQL; without a
# ceiling a busy service would drag its whole sales table through this endpoint.
BUSINESS_SAMPLE_LIMIT = 1000

# notification_deliveries.status values that mean the message actually landed.
# Anything else (queued, failed, bounced, …) counts as attempted-but-not-delivered.
DELIVERED_STATUSES = ("delivered", "sent")


def _percentile(sorted_values: list[float], fraction: float) -> Optional[float]:
    """Nearest-rank percentile. Returns None for an empty sample.

    Nearest-rank rather than interpolated: with the small samples this endpoint
    sees, an interpolated p95 invents a latency no request actually had.
    """
    if not sorted_values:
        return None
    rank = max(1, int(round(fraction * len(sorted_values))))
    return float(sorted_values[min(rank, len(sorted_values)) - 1])


def _summarize(values: list[float]) -> dict[str, Any]:
    """count/avg/p50/p95 over a sample, with None rather than 0 when empty.

    The None matters: 0 ms average latency and "nothing happened" are different
    facts, and OBS-04 exists to tell them apart.
    """
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "avg": round(sum(ordered) / len(ordered), 2) if ordered else None,
        "p50": _percentile(ordered, 0.50),
        "p95": _percentile(ordered, 0.95),
    }


def collect_business_metrics(
    supabase_client: Any,
    window_seconds: int = BUSINESS_WINDOW_SECONDS,
) -> dict[str, Any]:
    """OBS-04 business metrics: is the *business* still moving?

    OBS-01..03 answer "are the processes up?". Every one of them can be green
    while no wine is poured, no notification is delivered and no report is
    produced — the failure mode where the platform is healthy and useless.

    Four metrics, all from tables that already exist:
      stock updates/sec        inventory_events.created_at
      notification delivery    notification_deliveries.status
      report generation time   generated_reports.generation_time_ms
      webhook latency          sales_events.created_at -> processed_at

    Every metric is best-effort and independently degradable: one unavailable
    table must not blank the other three. A metric that could not be read is
    reported as null and named in `degraded`, so a null is never silently
    mistaken for a zero.
    """
    window_seconds = max(1, int(window_seconds))
    since = (
        datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    ).isoformat()

    out: dict[str, Any] = {
        "window_seconds": window_seconds,
        "since": since,
        "stock_updates": None,
        "notification_delivery": None,
        "report_generation_ms": None,
        "webhook_processing_latency_ms": None,
        "degraded": [],
    }

    if supabase_client is None:
        out["degraded"] = [
            "stock_updates",
            "notification_delivery",
            "report_generation_ms",
            "webhook_processing_latency_ms",
        ]
        out["degraded_reason"] = "no supabase client configured"
        return out

    def _degrade(name: str, exc: Exception) -> None:
        logger.warning("OBS-04: %s unavailable: %s", name, exc)
        out["degraded"].append(name)

    # 1. Stock updates per second — the pour/receive/adjust heartbeat.
    try:
        result = (
            supabase_client.table("inventory_events")
            .select("id", count="exact")
            .gte("created_at", since)
            .execute()
        )
        count = result.count or 0
        out["stock_updates"] = {
            "count": count,
            "per_second": round(count / window_seconds, 4),
        }
    except Exception as exc:
        _degrade("stock_updates", exc)

    # 2. Notification delivery rate — attempted vs actually delivered.
    try:
        attempted = (
            supabase_client.table("notification_deliveries")
            .select("status", count="exact")
            .gte("created_at", since)
            .execute()
        )
        total = attempted.count or 0
        delivered = sum(
            1
            for row in (attempted.data or [])
            if (row.get("status") or "").lower() in DELIVERED_STATUSES
        )
        out["notification_delivery"] = {
            "attempted": total,
            "delivered": delivered,
            # None, not 1.0: nothing attempted is not a 100% success rate.
            "rate": round(delivered / total, 4) if total else None,
        }
    except Exception as exc:
        _degrade("notification_delivery", exc)

    # 3. Report generation time — the column already exists and was never read.
    try:
        reports = (
            supabase_client.table("generated_reports")
            .select("generation_time_ms")
            .gte("created_at", since)
            .not_.is_("generation_time_ms", "null")
            .limit(BUSINESS_SAMPLE_LIMIT)
            .execute()
        )
        out["report_generation_ms"] = _summarize(
            [
                float(row["generation_time_ms"])
                for row in (reports.data or [])
                if row.get("generation_time_ms") is not None
            ]
        )
    except Exception as exc:
        _degrade("report_generation_ms", exc)

    # 4. Webhook processing latency — POS ingest, created_at -> processed_at.
    #
    # Deliberately NOT pos_event_timestamp -> processed_at. That interval is
    # measured across two clocks (the POS vendor's and ours) and so folds vendor
    # clock skew into a number people would read as our processing speed. Both
    # endpoints here are our own clock.
    try:
        sales = (
            supabase_client.table("sales_events")
            .select("created_at,processed_at")
            .gte("created_at", since)
            .not_.is_("processed_at", "null")
            .limit(BUSINESS_SAMPLE_LIMIT)
            .execute()
        )
        latencies: list[float] = []
        for row in sales.data or []:
            try:
                started = datetime.fromisoformat(row["created_at"])
                finished = datetime.fromisoformat(row["processed_at"])
            except (TypeError, ValueError):
                continue
            delta_ms = (finished - started).total_seconds() * 1000.0
            # Negative deltas mean the two timestamps were written by different
            # clocks; drop them rather than let them pull the average down.
            if delta_ms >= 0:
                latencies.append(delta_ms)
        summary = _summarize(latencies)
        summary["sampled"] = len(sales.data or [])
        summary["sample_capped"] = len(sales.data or []) >= BUSINESS_SAMPLE_LIMIT
        out["webhook_processing_latency_ms"] = summary
    except Exception as exc:
        _degrade("webhook_processing_latency_ms", exc)

    return out


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

    # OBS-04 business metrics. Kept in its own key so the infrastructure numbers
    # above and the business numbers below are never read as one flat blob —
    # they answer different questions and fail independently.
    business = collect_business_metrics(settings.supabase_client)

    return {
        **metrics,
        "dlq_size": dlq_size,
        "active_sagas": active_sagas,
        "business": business,
    }
