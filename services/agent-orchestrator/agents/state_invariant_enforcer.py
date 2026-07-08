"""
State Invariant Enforcer Agent
==============================
Validates critical distributed-state invariants:
- Sync loop detection (event storms)
- Double write detection (duplicate event IDs)
- Tenant leakage detection (mixed restaurant IDs)
- Opus output review signals (LLM outputs requiring verification)
"""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Dict, Any, List, Set, Tuple

from core.base_agent import BaseAgent


class StateInvariantEnforcerAgent(BaseAgent):
    """
    Monitors event streams and flags invariants that could corrupt state.

    Invariants:
    1) No sync loops (repeated identical events in a short window)
    2) No double writes (duplicate event IDs)
    3) No tenant leakage (multiple restaurant IDs in one event)
    4) Opus output review signals (LLM outputs must be reviewed)
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # Detection windows
        self.window_seconds = config.get("window_seconds", 120)
        self.max_repeats = config.get("max_repeats", 3)
        self.double_write_window_seconds = config.get(
            "double_write_window_seconds", 300
        )
        self.enable_opus_review = config.get("enable_opus_review", True)

        # In-memory tracking
        self._recent_events: Dict[str, datetime] = {}
        self._recent_event_types: Dict[Tuple[str, str], deque[datetime]] = defaultdict(
            deque
        )
        self._event_id_queue: deque[Tuple[str, datetime]] = deque()

        # Fields that could carry tenant IDs
        self._tenant_keys = {
            "restaurant_id",
            "restaurantId",
            "tenant_id",
            "tenantId",
            "source_restaurant_id",
            "target_restaurant_id",
        }

        self.logger.info("✅ State Invariant Enforcer initialized")

    async def initialize(self) -> None:
        """Initialize agent resources"""
        self.logger.info("Initializing State Invariant Enforcer")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("pos.events", "#"),
            ("stock.events", "#"),
            ("procurement.events", "#"),
            ("notification.events", "#"),
            ("report.events", "#"),
            ("menu.events", "#"),
            ("system.control", "#"),
            ("broadcast", "#"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        now = datetime.utcnow()

        event_id = message.get("event_id")
        event_type = message.get("event_type", "unknown.event")
        correlation_id = message.get("correlation_id") or message.get(
            "payload", {}
        ).get("correlation_id")
        source_agent = message.get("source_agent")
        payload = message.get("payload", {})

        self._prune_old_events(now)

        # Invariant 1: Double write detection (duplicate event_id)
        if event_id:
            if event_id in self._recent_events:
                await self._flag_violation(
                    violation_type="double_write",
                    severity="high",
                    message=message,
                    details={
                        "event_id": event_id,
                        "event_type": event_type,
                        "source_agent": source_agent,
                    },
                )
            else:
                self._recent_events[event_id] = now
                self._event_id_queue.append((event_id, now))

        # Invariant 2: Sync loop detection (repeated event types per correlation_id)
        if correlation_id:
            key = (correlation_id, event_type)
            events = self._recent_event_types[key]
            events.append(now)
            while events and (now - events[0]).total_seconds() > self.window_seconds:
                events.popleft()

            if len(events) > self.max_repeats:
                await self._flag_violation(
                    violation_type="sync_loop",
                    severity="critical",
                    message=message,
                    details={
                        "correlation_id": correlation_id,
                        "event_type": event_type,
                        "repeat_count": len(events),
                        "window_seconds": self.window_seconds,
                    },
                )

        # Invariant 3: Tenant leakage detection
        tenant_ids = self._extract_tenant_ids(payload)
        if len(tenant_ids) > 1:
            await self._flag_violation(
                violation_type="tenant_leakage",
                severity="critical",
                message=message,
                details={
                    "tenant_ids": list(tenant_ids),
                    "event_type": event_type,
                    "source_agent": source_agent,
                },
            )

        # Invariant 4: Opus output review signals
        if self.enable_opus_review and self._requires_opus_review(payload):
            await self._log_opus_review(message, payload)

    def _prune_old_events(self, now: datetime) -> None:
        # Prune recent event IDs
        cutoff = now - timedelta(seconds=self.double_write_window_seconds)
        while self._event_id_queue and self._event_id_queue[0][1] < cutoff:
            event_id, _ = self._event_id_queue.popleft()
            self._recent_events.pop(event_id, None)

        # Prune correlation event buckets
        for key, events in list(self._recent_event_types.items()):
            while events and (now - events[0]).total_seconds() > self.window_seconds:
                events.popleft()
            if not events:
                self._recent_event_types.pop(key, None)

    def _extract_tenant_ids(self, payload: Dict[str, Any]) -> Set[str]:
        tenant_ids: Set[str] = set()
        for key in self._tenant_keys:
            value = payload.get(key)
            if value:
                tenant_ids.add(str(value))
        return tenant_ids

    def _requires_opus_review(self, payload: Dict[str, Any]) -> bool:
        model = (payload.get("llm_model") or payload.get("model") or "").lower()
        provider = (payload.get("llm_provider") or "").lower()
        return "opus" in model or ("claude" in provider and "opus" in model)

    async def _log_opus_review(
        self, message: Dict[str, Any], payload: Dict[str, Any]
    ) -> None:
        await self._write_audit_log(
            action="opus_review_required",
            message=message,
            details={
                "llm_model": payload.get("llm_model") or payload.get("model"),
                "llm_provider": payload.get("llm_provider"),
                "event_type": message.get("event_type"),
            },
        )

    async def _flag_violation(
        self,
        violation_type: str,
        severity: str,
        message: Dict[str, Any],
        details: Dict[str, Any],
    ) -> None:
        event_type = message.get("event_type", "unknown.event")
        self.logger.warning(
            f"🚨 Invariant violation detected: {violation_type} ({severity}) [{event_type}]"
        )

        await self._write_audit_log(
            action="invariant_violation",
            message=message,
            details={"violation_type": violation_type, "severity": severity, **details},
        )

        # Notify human-in-the-loop
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.invariant_violation",
            message_body={
                "event_type": "InvariantViolation",
                "payload": {
                    "type": "invariant_violation",
                    "severity": severity,
                    "violation_type": violation_type,
                    "event_type": event_type,
                    "details": details,
                    "message": (
                        f"Invariant violation detected: {violation_type} "
                        f"(severity: {severity})"
                    ),
                    "actions": [
                        {"id": "review", "label": "Review", "style": "primary"},
                        {"id": "pause", "label": "Pause Writes", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=9,
        )

    async def _write_audit_log(
        self,
        action: str,
        message: Dict[str, Any],
        details: Dict[str, Any],
    ) -> None:
        try:
            if not self.database.supabase:
                return

            await self.database.supabase.table("system_audit_log").insert(
                {
                    "actor_type": "agent",
                    "actor_id": self.agent_name,
                    "action": action,
                    "entity_type": "event",
                    "entity_id": message.get("event_id"),
                    "changes": details,
                    "metadata": {
                        "event_type": message.get("event_type"),
                        "source_agent": message.get("source_agent"),
                        "correlation_id": message.get("correlation_id"),
                    },
                }
            ).execute()
        except Exception as e:
            self.logger.warning(f"Audit log failed: {e}")
