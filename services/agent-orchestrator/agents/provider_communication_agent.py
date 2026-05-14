"""
Provider Communication Agent — Phase 32
=========================================
Outbound draft engine that subscribes to procurement.order.created, generates
AI email drafts via Haiku, enforces 20 constraints (D-32-14), inserts the pending
draft to procurement_conversations, and fires manager notification.

Architecture (D-32-01 through D-32-08):
- Subscribes to: procurement.order.created, provider.draft.approved, provider.draft.discarded
- Generates outbound email drafts using Claude Haiku
- Enforces 20 constraints via ConstraintEngine (Plan 32-02)
- Inserts PENDING_APPROVAL (or AUTO_SENT) draft to procurement_conversations
- Notifies manager via notifications table insert
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from config.settings import Settings
from core.base_agent import BaseAgent
from services.constraint_engine import get_constraint_engine
from services.fuzzy_matcher import get_fuzzy_matcher  # noqa: F401 — available for invoice matching
from services.model_clients import get_haiku_client, get_haiku_semaphore
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Module-level constants
# ──────────────────────────────────────────────────────────────────────────────

# GAP-1 (C-08 / C-21): PII detection patterns — discrete mode on match
PII_PATTERNS = [
    re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),              # SSN
    re.compile(r'\b\d{9}\b'),                            # 9-digit routing number
    re.compile(r'\b4[0-9]{12}(?:[0-9]{3})?\b'),          # Visa card
    re.compile(r'\b5[1-5][0-9]{14}\b'),                  # Mastercard
    re.compile(r'\b3[47][0-9]{13}\b'),                   # Amex
    re.compile(r'\brouting.{0,20}number\b', re.IGNORECASE),
    re.compile(r'\bssn\b|\bsocial.{0,10}security\b', re.IGNORECASE),
]

# D-32-02: Email type constants
EMAIL_TYPE_PRICE_INQUIRY = "PRICE_INQUIRY"
EMAIL_TYPE_DEMAND_OFFER = "DEMAND_OFFER"
EMAIL_TYPE_PROMO_INQUIRY = "PROMO_INQUIRY"
EMAIL_TYPE_WINE_INQUIRY = "WINE_INQUIRY"


# ──────────────────────────────────────────────────────────────────────────────
# Agent
# ──────────────────────────────────────────────────────────────────────────────

class ProviderCommunicationAgent(BaseAgent):
    """
    Outbound draft engine — Phase 32 (D-32-01 through D-32-08).

    Subscribes to: procurement.order.created, provider.draft.approved, provider.draft.discarded.
    Generates AI email drafts via Haiku, enforces 20 constraints, notifies manager.
    """

    def __init__(self, message_bus, database, redis_client=None):
        super().__init__(
            agent_name="provider_communication_agent",
            message_bus=message_bus,
            database=database,
            config={},
        )
        self.redis = redis_client
        self.haiku_semaphore: Optional[Any] = None
        self._settings: Optional[Settings] = None

    @property
    def settings(self) -> Settings:
        if self._settings is None:
            self._settings = Settings()
        return self._settings

    async def initialize(self) -> None:
        """Create haiku_semaphore inside running event loop (AI-SPEC §3 pitfall 4)."""
        self.haiku_semaphore = get_haiku_semaphore()
        self.logger.info("ProviderCommunicationAgent initialized")

    def get_subscribed_routing_keys(self) -> List[Tuple[str, str]]:
        return [
            ("procurement.events", "procurement.order.created"),
            ("provider.events", "provider.draft.approved"),
            ("provider.events", "provider.draft.discarded"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        """Main entry point. Routes by routing_key after idempotency check."""
        payload = message
        order_id = payload.get("order_id", "")
        routing_key = payload.get("_routing_key", "")
        idempotency_key = f"prov_comm:{order_id}:{routing_key}"

        if await self._check_idempotency(idempotency_key):
            self.logger.debug(f"Skipping duplicate: {idempotency_key}")
            return

        try:
            if "order.created" in routing_key:
                await self._handle_order_created(payload)
            elif "draft.approved" in routing_key:
                await self._handle_draft_approved(payload)
            elif "draft.discarded" in routing_key:
                await self._handle_draft_discarded(payload)
            else:
                self.logger.warning(f"Unhandled routing key: {routing_key}")
                return
            await self._mark_processed(idempotency_key, {"status": "ok", "routing_key": routing_key})
        except Exception as exc:
            self.logger.error(f"ProviderCommunicationAgent failed [{routing_key}]: {exc}")
            await self._send_to_dlq(
                message=payload,
                error=str(exc),
                retry_count=0,
                original_exchange="procurement.events",
                original_routing_key=routing_key or "procurement.order.created",
            )
            raise
