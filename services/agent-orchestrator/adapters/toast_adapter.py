"""Toast POS Adapter — implements POSProvider for Toast webhook events."""

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Optional

from core.pos_provider import POSEvent

logger = logging.getLogger(__name__)


class ToastAdapter:
    """Adapts Toast POS webhooks to the POSProvider protocol.

    Handles Toast HMAC-SHA256 signature verification and event normalization.
    Future POS providers (Square, Clover) follow this same pattern.
    """

    def __init__(self, webhook_secret: Optional[str]) -> None:
        self._secret = webhook_secret or ""

    async def verify_webhook(self, raw: bytes, signature: str) -> bool:
        """Return True if HMAC-SHA256 signature matches the raw payload."""
        if not self._secret:
            # SimPOS testbed plan (decision B16): fail closed rather than
            # open. A missing TOAST_WEBHOOK_SECRET must reject every webhook,
            # not accept everything unsigned.
            logger.error(
                "ToastAdapter: TOAST_WEBHOOK_SECRET not set — rejecting webhook (fail closed)"
            )
            return False
        if not signature:
            return False
        try:
            expected = hmac.new(
                self._secret.encode("utf-8"),
                raw,
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(expected, signature.lower())
        except Exception as exc:
            logger.error("ToastAdapter: HMAC verification error: %s", exc)
            return False

    async def normalize_event(self, raw: dict) -> POSEvent:
        """Convert Toast raw webhook dict to a normalized POSEvent."""
        # Toast event structure: eventType, restaurantGuid, createdDate, order.checks[].selections
        event_type = raw.get("eventType") or raw.get("event_type") or "UNKNOWN"
        restaurant_guid = raw.get("restaurantGuid") or raw.get("restaurant_guid") or ""

        # Parse timestamp — Toast sends ISO 8601 strings
        raw_ts = raw.get("createdDate") or raw.get("created_date")
        try:
            timestamp = (
                datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
                if raw_ts
                else datetime.now(tz=timezone.utc)
            )
        except (AttributeError, ValueError):
            timestamp = datetime.now(tz=timezone.utc)

        # Extract line items from Toast order structure
        items: list[dict] = []
        order = raw.get("order") or {}
        for check in order.get("checks") or []:
            for selection in check.get("selections") or []:
                items.append(
                    {
                        "name": selection.get("displayName")
                        or selection.get("itemName")
                        or "",
                        "quantity": selection.get("quantity") or 1,
                        "guid": selection.get("itemGuid")
                        or selection.get("guid")
                        or "",
                        "price": selection.get("price") or 0,
                        "modifiers": selection.get("modifiers") or [],
                    }
                )

        return POSEvent(
            event_type=event_type,
            restaurant_guid=restaurant_guid,
            timestamp=timestamp,
            items=items,
            raw_payload=raw,
        )
