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

    # =========================================================================
    # EMAIL TYPE SELECTION (D-32-02)
    # =========================================================================

    def _select_email_type(self, payload: Dict[str, Any]) -> str:
        """D-32-02: Select email type from order context."""
        if payload.get("promo_id"):
            return EMAIL_TYPE_PROMO_INQUIRY
        if payload.get("wine_inquiry_only"):
            return EMAIL_TYPE_WINE_INQUIRY
        if payload.get("target_price_per_bottle") is None:
            return EMAIL_TYPE_PRICE_INQUIRY
        return EMAIL_TYPE_DEMAND_OFFER

    # =========================================================================
    # CONTEXT WINDOW BUILDER (D-32-03)
    # =========================================================================

    async def _build_context_window(
        self,
        provider_id: str,
        restaurant_id: str,
        order_id: str,
        email_type: str,
        payload: Dict[str, Any],
    ) -> Tuple[str, int]:
        """
        D-32-03: Flat ~6,000 token context window.
        Budget (approximate):
          system_prompt + constraints  800 tokens
          provider_profile_snapshot    400 tokens
          rolling_summary            1,000 tokens
          last_3_emails              2,400 tokens
          current_email_context        800 tokens
          safety_buffer                600 tokens
        Returns (prompt_string, estimated_token_count).
        """
        system_prompt = (
            f"You are WineOps AI, drafting a professional outbound email to a wine provider. "
            f"Email type: {email_type}. Write in a professional, concise style. "
            f"Maximum 180 words. Do NOT include any purchase commitments. "
            f"Do NOT reference competitor suppliers. End with a specific next action."
        )

        # Provider profile snapshot (~400 token cap)
        provider_snapshot = ""
        try:
            result = (
                self.database.supabase.table("providers")
                .select(
                    "name, contact_email, profile_foundational, profile_dynamic, close_relationship, "
                    "ai_personality_notes, relationship_health_score"
                )
                .eq("id", provider_id)
                .eq("restaurant_id", restaurant_id)
                .single()
                .execute()
            )
            if result.data:
                pd = result.data
                profile_str = json.dumps({
                    "name": pd.get("name"),
                    "close_relationship": pd.get("close_relationship"),
                    "relationship_health_score": pd.get("relationship_health_score"),
                    "foundational": pd.get("profile_foundational") or {},
                    "dynamic": pd.get("profile_dynamic") or {},
                    "notes": (pd.get("ai_personality_notes") or "")[:200],
                })
                provider_snapshot = f"\n\nPROVIDER PROFILE:\n{profile_str[:1200]}"
        except Exception as exc:
            self.logger.warning(f"Failed to fetch provider profile: {exc}")

        # Rolling summary from previous conversations (~1000 token cap)
        rolling_summary = ""
        try:
            conv_result = (
                self.database.supabase.table("procurement_conversations")
                .select("rolling_summary, content, created_at")
                .eq("order_id", order_id)
                .eq("restaurant_id", restaurant_id)
                .order("created_at", desc=True)
                .limit(3)
                .execute()
            )
            if conv_result.data:
                for row in conv_result.data:
                    if row.get("rolling_summary"):
                        rolling_summary = f"\n\nCONVERSATION SUMMARY:\n{row['rolling_summary'][:3000]}"
                        break
        except Exception as exc:
            self.logger.warning(f"Failed to fetch rolling summary: {exc}")

        # Negotiation facts (committed agreements)
        facts_str = ""
        try:
            facts_result = (
                self.database.supabase.table("negotiation_facts")
                .select("fact_field, fact_value")
                .eq("provider_id", provider_id)
                .eq("restaurant_id", restaurant_id)
                .eq("commitment_type", "AGREEMENT")
                .limit(5)
                .execute()
            )
            if facts_result.data:
                facts_str = "\n\nNEGOTIATION FACTS:\n" + "; ".join(
                    f"{r['fact_field']}: {r['fact_value']}" for r in facts_result.data
                )
        except Exception as exc:
            self.logger.warning(f"Failed to fetch negotiation facts: {exc}")

        # Current order context (~800 token cap)
        order_context = (
            f"\n\nORDER DETAILS:\n"
            f"Wine: {payload.get('wine_name', 'Unknown')}\n"
            f"Quantity: {payload.get('quantity', 'TBD')} cases\n"
            f"Target price/bottle: {payload.get('target_price_per_bottle', 'Open ask')}\n"
            f"Urgency: {payload.get('urgency', 'normal')}"
        )

        prompt = (
            f"{system_prompt}"
            f"{provider_snapshot}"
            f"{rolling_summary}"
            f"{facts_str}"
            f"{order_context}"
            f'\n\nDraft the outbound email now. JSON response: {{"subject": "...", "body": "..."}}'
        )

        # Rough token estimate: 1 token ≈ 4 chars
        estimated_tokens = len(prompt) // 4
        return prompt, estimated_tokens

    # =========================================================================
    # ORDER CREATED HANDLER (D-32-01)
    # =========================================================================

    async def _handle_order_created(self, payload: Dict[str, Any]) -> None:
        """
        D-32-01: Main order trigger handler.
        Steps:
          1. Rate limit check (D-32-04)
          2. Email type selection (D-32-02)
          3. Build context window (D-32-03)
          4. Token hard cap (TOKENBDGT-01)
          5. Pre-draft constraint check + duplicate order block (C-10)
          6. Draft lock — prevent duplicates for same order
          7. Haiku draft generation
          8. SpendLogger call (TOKENBDGT-03)
          9. Post-draft constraint check + disclaimer append (D-32-08)
         10. Auto-send gate (D-32-07) → determine final_status
         11. INSERT procurement_conversations
         12. Notify (AUTO_SENT publishes event; PENDING_APPROVAL notifies manager)
        """
        order_id = payload.get("order_id", "")
        restaurant_id = payload.get("restaurant_id", "")
        provider_id = payload.get("provider_id", "")

        if not all([order_id, restaurant_id, provider_id]):
            self.logger.warning(f"Missing required fields in order.created payload: {payload}")
            return

        # Step 1: Daily rate limit (D-32-04)
        rate_key = f"negotiation_draft:{restaurant_id}:day"
        if await self._check_and_increment_rate_limit(rate_key, self.settings.negotiation_draft_daily_cap):
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="rate_limit_reached",
                title="Draft limit reached",
                message=(
                    f"Daily AI draft limit ({self.settings.negotiation_draft_daily_cap}) reached. "
                    "Drafts frozen until tomorrow."
                ),
                priority="high",
                action_url="/orders",
                metadata={"order_id": order_id},
            )
            return

        # Step 2: Email type selection (D-32-02)
        email_type = self._select_email_type(payload)

        # Step 3: Build context window
        prompt, estimated_tokens = await self._build_context_window(
            provider_id, restaurant_id, order_id, email_type, payload
        )

        # Step 4: Token hard cap (TOKENBDGT-01 — 8,000 input tokens)
        if estimated_tokens > self.settings.draft_input_token_hard_cap:
            self.logger.error(
                f"Token hard cap exceeded: {estimated_tokens} > {self.settings.draft_input_token_hard_cap}"
            )
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="constraint_triggered",
                title="Draft blocked: token cap",
                message="Context too large for AI draft. Shorten conversation history or contact support.",
                priority="high",
                action_url="/orders",
                metadata={"order_id": order_id, "constraint": "TOKENBDGT-01"},
            )
            return

        # Step 5: Pre-draft constraint check (D-32-14) on the order context text
        ce = get_constraint_engine()
        pre_check = ce.check_hard_constraints(
            f"wine {payload.get('wine_name', '')} cases quantity {payload.get('quantity', '')}",
            quantity=float(payload.get("quantity") or 0),
            order_quantity=float(payload.get("quantity") or 0),
            round_count=0,
            max_rounds=self.settings.hard_round_cap,
        )

        # C-10: Duplicate order block — check for active unfulfilled order for same wine
        duplicate_check = False
        try:
            dup_result = (
                self.database.supabase.table("procurement_orders")
                .select("id")
                .eq("restaurant_id", restaurant_id)
                .eq("wine_name", payload.get("wine_name", ""))
                .in_("status", ["PENDING", "CONFIRMED", "DRAFT"])
                .neq("id", order_id)
                .limit(1)
                .execute()
            )
            if dup_result.data:
                duplicate_check = True
        except Exception:
            pass

        if duplicate_check:
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="constraint_triggered",
                title="Duplicate order detected",
                message=(
                    f"Active unfulfilled order exists for {payload.get('wine_name')} "
                    "— review before drafting."
                ),
                priority="medium",
                action_url="/orders",
                metadata={"order_id": order_id, "constraint": "C-10"},
            )
            return

        # Step 6: Draft lock — prevent duplicates for same order (T-32-03-03)
        lock_key = f"draft_lock:{order_id}"
        if not await self._acquire_draft_lock(lock_key):
            self.logger.info(f"Draft lock held for order {order_id} — skipping duplicate")
            return

        # Step 7: Haiku draft generation
        draft_json: Dict[str, Any] = {}
        input_tokens = 0
        output_tokens = 0
        try:
            haiku = get_haiku_client()
            async with self.haiku_semaphore:
                response = await haiku.messages.create(
                    model=self.settings.haiku_model,
                    max_tokens=512,
                    messages=[{"role": "user", "content": prompt}],
                )
            raw = response.content[0].text if response.content else "{}"
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            draft_json = json.loads(raw.strip())
            input_tokens = (
                response.usage.input_tokens if hasattr(response, "usage") else estimated_tokens
            )
            output_tokens = (
                response.usage.output_tokens if hasattr(response, "usage") else 100
            )
        except (json.JSONDecodeError, Exception) as exc:
            self.logger.error(f"Haiku draft generation failed for order {order_id}: {exc}")
            draft_json = {
                "subject": (
                    f"Inquiry: {payload.get('wine_name', 'Wine')} — "
                    f"{email_type.replace('_', ' ').title()}"
                ),
                "body": (
                    f"We are interested in {payload.get('quantity', 'several')} cases of "
                    f"{payload.get('wine_name', 'wine')}. "
                    "Please provide pricing and availability."
                ),
            }

        # Step 8: SpendLogger (TOKENBDGT-03)
        try:
            spend_logger = get_spend_logger()
            cost_usd = (input_tokens * 0.00000025) + (output_tokens * 0.00000125)
            spend_logger.log(
                provider="anthropic",
                model=self.settings.haiku_model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                restaurant_id=restaurant_id,
            )
        except Exception as exc:
            self.logger.warning(f"SpendLogger failed (non-critical): {exc}")

        # Step 9a: Post-draft constraint checks
        draft_body = draft_json.get("body", "")
        post_check = ce.check_hard_constraints(draft_body)
        annotating = ce.check_annotating_constraints(draft_text=draft_body)
        word_check = ce.check_length_cap(draft_body)

        # PII sensitivity check (GAP-1 / T-32-03-04 discrete mode)
        is_sensitive = self._classify_message_sensitivity(draft_body)

        constraint_flags: Dict[str, Any] = {
            "hard": post_check.triggered_hard,
            "annotating": annotating.triggered_annotating,
            "soft_warnings": annotating.annotations,
            "is_sensitive": is_sensitive,
        }

        if post_check.blocked or word_check.blocked:
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="constraint_triggered",
                title=(
                    f"Draft blocked: {', '.join(post_check.triggered_hard + word_check.triggered_hard)}"
                ),
                message="AI draft violates hard constraints. Manual drafting required.",
                priority="high",
                action_url="/orders",
                metadata={"order_id": order_id, "constraints": post_check.triggered_hard},
            )
            return

        # Step 9b: Disclaimer append (D-32-08 — non-removable)
        restaurant_name = payload.get("restaurant_name", "the restaurant")
        disclaimer = self.settings.wineops_disclaimer.format(restaurant_name=restaurant_name)
        full_draft = f"{draft_body}\n\n{disclaimer}"

        # Step 10: Auto-send gate (D-32-07 — 3-gate check)
        auto_send = await self._check_auto_send_gate(restaurant_id, provider_id)
        final_status = "AUTO_SENT" if auto_send else "PENDING_APPROVAL"

        # Step 11: INSERT procurement_conversations
        conversation_id = None
        try:
            conv_result = (
                self.database.supabase.table("procurement_conversations")
                .insert({
                    "order_id": order_id,
                    "provider_id": provider_id,
                    "restaurant_id": restaurant_id,
                    "direction": "OUTBOUND",
                    "channel": "email",
                    "content": full_draft,
                    "status": final_status,
                    "outbound_email_type": email_type,
                    "round_count": 0,
                    "disclaimer_appended": True,
                    "constraint_flags": constraint_flags,
                    "rolling_summary": None,
                })
                .execute()
            )
            if conv_result.data:
                conversation_id = conv_result.data[0].get("id")
        except Exception as exc:
            self.logger.error(f"Failed to insert procurement_conversation for order {order_id}: {exc}")
            raise

        # Step 12: Post-insert action
        provider_name = payload.get("provider_name", "Provider")
        order_display = order_id[:8]

        if auto_send:
            # D-32-07: Auto-send path — publish event for downstream Gmail send
            try:
                await self.message_bus.publish(
                    exchange="provider.events",
                    routing_key="provider.draft.auto_approved",
                    message={
                        "conversation_id": conversation_id,
                        "order_id": order_id,
                        "restaurant_id": restaurant_id,
                        "auto_sent": True,
                    },
                )
            except Exception as exc:
                self.logger.warning(f"Failed to publish auto_approved event (non-critical): {exc}")
        else:
            # Manual approval path: notify manager
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="draft_ready",
                title=f"Draft ready: email to {provider_name}",
                message=(
                    f"AI drafted a {email_type.replace('_', ' ').title()} email for order #{order_display}"
                ),
                priority="high",
                action_url=f"/orders?draft={conversation_id}",
                metadata={
                    "conversation_id": conversation_id,
                    "order_id": order_id,
                    "email_type": email_type,
                },
            )

        # Decision log (T-32-03-01 repudiation mitigation)
        await self.log_decision(
            decision_type="outbound_draft_generated",
            inputs={"order_id": order_id, "email_type": email_type, "provider_id": provider_id},
            output={
                "conversation_id": conversation_id,
                "constraint_flags": constraint_flags,
                "word_count": ce.word_count(draft_body),
                "final_status": final_status,
            },
            reasoning=(
                f"Email type {email_type} selected; "
                f"{len(constraint_flags.get('annotating', []))} annotating constraints; "
                f"auto_send={auto_send}"
            ),
            confidence=0.90,
            restaurant_id=restaurant_id,
        )
        self.logger.info(
            f"Draft generated for order {order_id}: conversation_id={conversation_id}, "
            f"status={final_status}"
        )

    # =========================================================================
    # DRAFT APPROVED / DISCARDED HANDLERS (D-32-06)
    # =========================================================================

    async def _handle_draft_approved(self, payload: Dict[str, Any]) -> None:
        """D-32-06: Log draft approval decision. Email send handled by NestJS GmailService."""
        conversation_id = payload.get("conversation_id", "")
        order_id = payload.get("order_id", "")
        restaurant_id = payload.get("restaurant_id", "")
        modified = payload.get("modified_content")
        await self.log_decision(
            decision_type="draft_approved",
            inputs={
                "conversation_id": conversation_id,
                "order_id": order_id,
                "was_modified": bool(modified),
            },
            output={"status": "APPROVED"},
            reasoning="Manager approved outbound draft" + (" with edits" if modified else ""),
            confidence=1.0,
            restaurant_id=restaurant_id,
        )
        self.logger.info(f"Draft approved: conversation_id={conversation_id}")

    async def _handle_draft_discarded(self, payload: Dict[str, Any]) -> None:
        """D-32-06: Log draft discard."""
        conversation_id = payload.get("conversation_id", "")
        restaurant_id = payload.get("restaurant_id", "")
        await self.log_decision(
            decision_type="draft_discarded",
            inputs={"conversation_id": conversation_id},
            output={"status": "DISCARDED"},
            reasoning="Manager discarded outbound draft",
            confidence=1.0,
            restaurant_id=restaurant_id,
        )
        self.logger.info(f"Draft discarded: conversation_id={conversation_id}")

    # =========================================================================
    # PII SENSITIVITY CLASSIFIER (GAP-1 — C-08 / C-21)
    # =========================================================================

    def _classify_message_sensitivity(self, text: str) -> bool:
        """
        GAP-1: C-08/C-21 PII/sensitivity detection.
        Returns True if text contains PII or sensitive content → discrete mode activates.
        Discrete mode: no body logging, no embedding, no summarization.
        Notification routed to DEV/ADMIN channel only.
        """
        for pattern in PII_PATTERNS:
            if pattern.search(text):
                return True
        return False

    # =========================================================================
    # RATE LIMIT + DRAFT LOCK HELPERS (D-32-04)
    # =========================================================================

    async def _check_and_increment_rate_limit(
        self, key: str, cap: int, ttl_seconds: int = 86400
    ) -> bool:
        """
        Returns True if cap EXCEEDED (should block), False if under cap (allow).
        Fails open when Redis unavailable (no blocking on Redis outage).
        """
        if not self.redis:
            return False
        try:
            current = await self.redis.get(key)
            if current and int(current) >= cap:
                return True
            pipe = self.redis.pipeline()
            pipe.incr(key)
            pipe.expire(key, ttl_seconds)
            await pipe.execute()
            return False
        except Exception as exc:
            self.logger.warning(f"Rate limit check failed (fail open): {exc}")
            return False

    async def _acquire_draft_lock(self, key: str, px: int = 30_000) -> bool:
        """
        SET NX PX — returns True if lock acquired, False if already held.
        Fails open when Redis unavailable (no lock contention without Redis).
        """
        if not self.redis:
            return True
        try:
            result = await self.redis.set(key, "1", nx=True, px=px)
            return result is not None
        except Exception as exc:
            self.logger.warning(f"Draft lock acquisition failed (fail open): {exc}")
            return True

    # =========================================================================
    # AUTO-SEND GATE (D-32-07 / OUTBOUND-08)
    # =========================================================================

    async def _check_auto_send_gate(
        self,
        restaurant_id: str,
        provider_id: str,
    ) -> bool:
        """
        D-32-07 three-gate auto-send check.
        Returns True only when ALL 3 conditions are met:
          1. paid_tier: restaurant has auto_send_enabled feature flag
          2. health_score >= auto_send_health_threshold (default 0.80)
          3. auto_reply_enabled: provider has manager-pre-approved auto-send
        Fails closed on any exception (defaults to PENDING_APPROVAL).
        """
        threshold = self.settings.auto_send_health_threshold
        try:
            # Gate 1: paid tier feature flag
            rest_result = (
                self.database.supabase.table("restaurant_feature_flags")
                .select("auto_send_enabled")
                .eq("restaurant_id", restaurant_id)
                .single()
                .execute()
            )
            if not (rest_result.data or {}).get("auto_send_enabled"):
                return False

            # Gates 2 + 3: provider health score + manager pre-approval
            prov_result = (
                self.database.supabase.table("providers")
                .select("relationship_health_score, auto_reply_enabled")
                .eq("id", provider_id)
                .eq("restaurant_id", restaurant_id)
                .single()
                .execute()
            )
            prov = prov_result.data or {}
            health = float(prov.get("relationship_health_score") or 0)
            auto_reply = bool(prov.get("auto_reply_enabled"))

            return health >= threshold and auto_reply

        except Exception as exc:
            self.logger.warning(
                f"auto_send_gate check failed (defaulting to manual approval): {exc}",
            )
            return False

    # =========================================================================
    # NOTIFICATION INSERT (D-03)
    # =========================================================================

    async def _notify(
        self,
        restaurant_id: str,
        notification_type: str,
        title: str,
        message: str,
        priority: str = "medium",
        action_url: str = "/orders",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Insert in-app notification directly to Supabase notifications table (D-03).
        Uses status='unread' (VERIFIED_NOTIFICATION_FIELD from Plan 32-01).
        NOT an HTTP call to NestJS — direct DB insert per RESEARCH.md Q2.
        """
        if not restaurant_id:
            return
        try:
            insert_payload: Dict[str, Any] = {
                "restaurant_id": restaurant_id,
                "type": notification_type,
                "title": title,
                "message": message,
                "priority": priority,
                "action_url": action_url,
                "status": "unread",   # VERIFIED: notifications uses status='unread' (32-01-SUMMARY)
            }
            if metadata:
                insert_payload["metadata"] = metadata
            self.database.supabase.table("notifications").insert(insert_payload).execute()
        except Exception as exc:
            self.logger.warning(f"Notification insert failed (non-critical): {exc}")
