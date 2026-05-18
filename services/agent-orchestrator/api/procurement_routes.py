"""
Procurement API Routes — HTTP trigger for AI draft generation (D-32 fallback)
=============================================================================
Provides a server-to-server endpoint so the NestJS api-gateway can trigger
draft generation directly over HTTP when RabbitMQ is unavailable.

Routes:
  POST /api/v1/procurement/trigger-draft — trigger ProviderCommunicationAgent
                                           for a single order without RabbitMQ
"""

import asyncio
import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException

from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/procurement", tags=["Procurement"])


def verify_admin_key(x_admin_key: Optional[str] = Header(None)) -> str:
    """Require X-Admin-Key header — same pattern as health_routes.py."""
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key:
        raise HTTPException(status_code=401, detail="X-Admin-Key header required")
    if expected and x_admin_key != expected:
        raise HTTPException(status_code=403, detail="Invalid admin key")
    return x_admin_key


async def _run_draft_generation(payload: Dict[str, Any]) -> None:
    """
    Instantiate ProviderCommunicationAgent in HTTP-only mode (no RabbitMQ subscription)
    and call _handle_order_created directly.

    Falls back gracefully if the orchestrator is already running — in that case the
    running agent will have consumed the message via RabbitMQ already, but calling
    this endpoint is idempotent thanks to the agent's own idempotency guard.
    """
    try:
        # Try to reuse the running orchestrator's agent instance first
        from main import get_orchestrator  # noqa: PLC0415
        orch = get_orchestrator()
        if orch is not None:
            agent = orch.agents.get("provider_communication_agent")
            if agent is not None:
                await agent._handle_order_created(payload)
                logger.info("Draft triggered via running orchestrator agent for order %s", payload.get("order_id"))
                return

        # Orchestrator not running (RabbitMQ was unavailable at startup) —
        # create an ephemeral agent with a direct Supabase connection.
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_key:
            logger.error("Supabase not configured — cannot generate draft without RabbitMQ")
            return

        from core.database import DatabaseClient  # noqa: PLC0415
        from agents.provider_communication_agent import ProviderCommunicationAgent  # noqa: PLC0415

        db = DatabaseClient(settings.supabase_url, settings.supabase_key)
        await db.connect()
        try:
            agent = ProviderCommunicationAgent(message_bus=None, database=db)
            await agent.initialize()
            await agent._handle_order_created(payload)
            logger.info("Draft triggered via ephemeral agent (HTTP-only mode) for order %s", payload.get("order_id"))
        finally:
            await db.disconnect()

    except Exception as exc:
        logger.error("Draft generation via HTTP fallback failed for order %s: %s",
                     payload.get("order_id"), exc)


@router.post("/trigger-draft")
async def trigger_draft(
    payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
    _key: str = Depends(verify_admin_key),
):
    """
    POST /api/v1/procurement/trigger-draft

    Triggers AI email draft generation for a procurement order.
    Called by the NestJS api-gateway as an HTTP fallback when RabbitMQ is
    unavailable.  Processing is async (background task) so the response
    returns immediately — the NestJS caller should not wait for the draft.

    Required payload fields (same as procurement.order.created RabbitMQ event):
      order_id, restaurant_id, provider_id, wine_name, quantity, urgency
    """
    order_id = payload.get("order_id", "")
    if not order_id:
        raise HTTPException(status_code=422, detail="order_id is required")

    background_tasks.add_task(_run_draft_generation, dict(payload))
    return {"status": "accepted", "order_id": order_id}
