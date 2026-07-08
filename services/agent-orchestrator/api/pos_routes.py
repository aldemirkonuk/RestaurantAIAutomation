"""
POS Integration Routes — Generic Provider Webhook
=================================================
Accepts webhooks from any registered POS provider.
Route: POST /api/v1/pos/webhook/{provider}

Registered providers: "toast" (ToastAdapter)
Add new providers by implementing POSProvider and registering in _get_providers().
"""

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from config.settings import get_settings
from core.pos_provider import POSProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/pos", tags=["POS Integration"])


def _get_providers() -> dict[str, POSProvider]:
    """Return provider registry. Instantiated lazily to avoid import-time settings load."""
    from adapters.toast_adapter import ToastAdapter

    settings = get_settings()
    return {
        "toast": ToastAdapter(webhook_secret=settings.toast_webhook_secret),
    }


@router.post("/webhook/{provider}", status_code=200)
async def pos_webhook(
    provider: str,
    request: Request,
    toast_signature: Optional[str] = Header(None, alias="Toast-Signature"),
):
    """
    Receive POS webhook events from any registered provider.

    Flow:
      1. Look up provider adapter in registry → 404 if unknown
      2. Verify webhook signature (adapter.verify_webhook) → 401 if invalid
      3. Normalize to POSEvent (adapter.normalize_event)
      4. Dispatch POSEvent to agent (agent.process_pos_event)

    Returns:
        200 {"status": "accepted"}  — event queued for processing
        401 {"detail": "..."}       — signature verification failed
        404 {"detail": "..."}       — unknown POS provider
        503 {"detail": "..."}       — agent not running
    """
    # Import here to avoid circular import (main imports pos_routes,
    # pos_routes imports get_orchestrator from main).
    from main import get_orchestrator  # noqa: PLC0415

    providers = _get_providers()
    if provider not in providers:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown POS provider: '{provider}'. Registered providers: {list(providers.keys())}",
        )

    adapter = providers[provider]
    raw_payload: bytes = await request.body()

    # Parse JSON from raw bytes (body already consumed above)
    import json as _json  # noqa: PLC0415

    try:
        webhook_data = _json.loads(raw_payload)
    except _json.JSONDecodeError as exc:
        logger.warning("Malformed JSON in %s webhook: %s", provider, exc)
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {exc}")

    # Verify webhook signature via adapter
    is_valid = await adapter.verify_webhook(raw_payload, toast_signature or "")
    if not is_valid:
        logger.warning(
            "Webhook signature verification failed for provider '%s'", provider
        )
        raise HTTPException(
            status_code=401, detail="Webhook signature verification failed"
        )

    # Normalize to POSEvent
    try:
        event = await adapter.normalize_event(webhook_data)
    except Exception as exc:
        logger.error("Failed to normalize %s webhook event: %s", provider, exc)
        raise HTTPException(
            status_code=422, detail=f"Event normalization failed: {exc}"
        )

    orchestrator = get_orchestrator()
    if orchestrator is None:
        logger.error("Webhook received but orchestrator is not running.")
        raise HTTPException(status_code=503, detail="Agent orchestrator not running.")

    agent = orchestrator.agents.get("pos_integration_agent")
    if agent is None:
        logger.error("pos_integration_agent not found in running agents.")
        raise HTTPException(
            status_code=503, detail="POS integration agent not running."
        )

    try:
        result = await agent.process_pos_event(event)
    except Exception as exc:
        logger.exception("Unexpected error processing %s webhook: %s", provider, exc)
        raise HTTPException(
            status_code=500, detail="Internal error processing POS event"
        )

    if isinstance(result, dict) and result.get("status") == "error":
        reason = result.get("reason") or result.get("message", "unknown error")
        raise HTTPException(status_code=422, detail=reason)

    return result
