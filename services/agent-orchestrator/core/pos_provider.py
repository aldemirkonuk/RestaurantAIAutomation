"""POS Provider abstraction — Protocol + POSEvent schema (POS-ABSTRACT)."""

from typing import Protocol, runtime_checkable
from pydantic import BaseModel
from datetime import datetime


class POSEvent(BaseModel):
    """Normalized POS event — all provider-specific formats reduced to this."""

    event_type: str
    restaurant_guid: str
    timestamp: datetime
    items: list[dict]
    raw_payload: dict


@runtime_checkable
class POSProvider(Protocol):
    """Protocol that all POS adapters must implement."""

    async def verify_webhook(self, raw: bytes, signature: str) -> bool:
        """Return True if the webhook signature is valid for the given raw body."""
        ...

    async def normalize_event(self, raw: dict) -> POSEvent:
        """Convert provider-specific raw dict to a normalized POSEvent."""
        ...
