"""
POS Integration Routes
======================
Exposes the Toast webhook endpoint so incoming POS events can be routed
to the running POSIntegrationAgent instance.

Route: POST /api/v1/pos/webhook/toast
"""

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/pos", tags=["POS Integration"])


@router.post("/webhook/toast", status_code=200)
async def toast_webhook(
    request: Request,
    toast_signature: Optional[str] = Header(None, alias="Toast-Signature"),
):
    """
    Receive Toast POS webhook events.

    Toast sends an HMAC-SHA256 signature in the Toast-Signature header.
    The raw request body is passed to POSIntegrationAgent for verification
    so the signature check uses the original bytes (not a re-serialized dict).

    Returns:
        200 {"status": "accepted"}  — event queued for processing
        401 {"detail": "..."}       — HMAC verification failed
        503 {"detail": "..."}       — POSIntegrationAgent not running
    """
    # Import here to avoid circular import (main imports pos_routes,
    # pos_routes imports get_orchestrator from main).
    from main import get_orchestrator  # noqa: PLC0415

    raw_payload: bytes = await request.body()

    # Parse JSON — FastAPI has already read the body so we parse from bytes.
    import json as _json
    try:
        webhook_data = _json.loads(raw_payload)
    except _json.JSONDecodeError as exc:
        logger.warning("Malformed JSON in Toast webhook: %s", exc)
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {exc}")

    orchestrator = get_orchestrator()
    if orchestrator is None:
        logger.error("Webhook received but orchestrator is not running.")
        raise HTTPException(
            status_code=503, detail="Agent orchestrator not running."
        )

    agent = orchestrator.agents.get("pos_integration_agent")
    if agent is None:
        logger.error("pos_integration_agent not found in running agents.")
        raise HTTPException(
            status_code=503, detail="POS integration agent not running."
        )

    try:
        result = await agent.process_toast_webhook(
            webhook_data=webhook_data,
            signature=toast_signature,
            raw_payload=raw_payload,
        )
    except Exception as exc:
        logger.exception("Unexpected error processing Toast webhook: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    # If the agent returned an error status, surface it as HTTP 4xx/5xx
    if isinstance(result, dict) and result.get("status") == "error":
        reason = result.get("reason", "unknown error")
        # Signature failures → 401, other agent errors → 422
        if "signature" in reason.lower() or "hmac" in reason.lower():
            raise HTTPException(status_code=401, detail=reason)
        raise HTTPException(status_code=422, detail=reason)

    return result
