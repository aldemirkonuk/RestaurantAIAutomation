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

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from config.settings import Settings
from core.base_agent import BaseAgent
from core.notifications import notify_restaurant
from services.constraint_engine import get_constraint_engine
from services.fuzzy_matcher import (
    get_fuzzy_matcher,
)  # noqa: F401 — available for invoice matching
from services.model_clients import get_haiku_client, get_haiku_semaphore
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Module-level constants
# ──────────────────────────────────────────────────────────────────────────────

# GAP-1 (C-08 / C-21): PII detection patterns — discrete mode on match
PII_PATTERNS = [
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),  # SSN
    re.compile(r"\b\d{9}\b"),  # 9-digit routing number
    re.compile(r"\b4[0-9]{12}(?:[0-9]{3})?\b"),  # Visa card
    re.compile(r"\b5[1-5][0-9]{14}\b"),  # Mastercard
    re.compile(r"\b3[47][0-9]{13}\b"),  # Amex
    re.compile(r"\brouting.{0,20}number\b", re.IGNORECASE),
    re.compile(r"\bssn\b|\bsocial.{0,10}security\b", re.IGNORECASE),
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
            (
                "provider.events",
                "provider.invoice.received",
            ),  # D-32-15: off-app invoice match
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        """Main entry point. Routes by routing_key after idempotency check."""
        payload = message
        order_id = payload.get("order_id", "")
        routing_key = payload.get("_routing_key", "")
        # Use a payload-specific identifier so invoice events (which carry no order_id)
        # don't all collapse to the same key and get silently deduplicated after the first.
        if "invoice.received" in routing_key:
            unique_part = (
                payload.get("email_id")
                or payload.get("gmail_message_id")
                or f"{payload.get('provider_id','')}:{payload.get('restaurant_id','')}:{payload.get('subject','')[:40]}"
            )
        else:
            unique_part = order_id
        idempotency_key = f"prov_comm:{unique_part}:{routing_key}"

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
            elif "invoice.received" in routing_key:
                await self._handle_invoice_received_event(payload)
            else:
                self.logger.warning(f"Unhandled routing key: {routing_key}")
                return
            await self._mark_processed(
                idempotency_key, {"status": "ok", "routing_key": routing_key}
            )
        except Exception as exc:
            self.logger.error(
                f"ProviderCommunicationAgent failed [{routing_key}]: {exc}"
            )
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

    # -------------------------------------------------------------------------
    # Cached system prompt — static across all email types.
    # Sent as a system message with cache_control so Anthropic caches it after
    # the first call; subsequent calls pay ~1/10 the input token cost.
    # Each type block is short enough to keep total under 300 tokens.
    # -------------------------------------------------------------------------
    _SYSTEM_PROMPT = (
        "You are a wine procurement email specialist writing on behalf of a restaurant manager. "
        "Your drafts are concise, warm but professional, and always scannable at a glance.\n\n"
        "EMAIL TYPE RULES\n"
        "PRICE_INQUIRY  — goal: get a quote. No price commitment. No budget disclosed. "
        "Ask: wine name + qty + format, then request current pricing and availability. "
        "Tone: direct. Max 100 words.\n"
        "DEMAND_OFFER   — goal: propose our target price. Cite volume or relationship as "
        "justification. Ask if they can meet or approach it. No competitor references. "
        "Tone: collegial, firm. Max 110 words.\n"
        "PROMO_INQUIRY  — goal: get full promo terms. Reference the promotion by name if known. "
        "Ask: price, minimum qty, end date. Tone: enthusiastic but businesslike. Max 100 words.\n"
        "WINE_INQUIRY   — goal: check if provider carries this wine and at what price. "
        "Describe wine precisely (name, vintage, style). Tone: curious, friendly. Max 100 words.\n\n"
        "STRUCTURE (all types)\n"
        "1. Greeting — address the recipient by their contact first name if provided; "
        "otherwise the company name. Never open with a bare 'Hello,' or 'Hi there,' when a name is available.\n"
        "2. Body — 2-3 focused sentences matching the type rules above.\n"
        "3. Close — one line. End with 'Best regards,' followed by the sender/restaurant name "
        "if provided in the context; otherwise just 'Best regards,'. "
        "NEVER write a literal placeholder such as [Manager Name] or [Your Name].\n\n"
        "HARD RULES (never violate)\n"
        '• Return ONLY valid JSON: {"subject": "...", "body": "..."} — no markdown, no preamble.\n'
        "• No bank details, routing numbers, or card numbers.\n"
        "• No competitor supplier names.\n"
        "• Never fabricate facts not present in the context."
    )

    async def _build_context_window(
        self,
        provider_id: str,
        restaurant_id: str,
        order_id: str,
        email_type: str,
        payload: Dict[str, Any],
    ) -> Tuple[str, int]:
        """
        D-32-03: Hybrid cached-system + compressed-user context window.
        Budget (approximate):
          system message (cached)   ~280 tokens  → billed at ~28 after first call
          user message              ~200 tokens  → always billed
          output                    ~150 tokens
        Total warm cost: ~378 tokens per draft (vs ~1,500+ before).
        """
        # ── Provider profile (lean: name, health score, personality notes only) ──
        provider_name = "the provider"
        provider_meta_lines: list[str] = []
        try:
            result = (
                self.database.supabase.table("providers")
                .select(
                    "name, close_relationship, relationship_health_score, ai_personality_notes"
                )
                .eq("id", provider_id)
                .eq("restaurant_id", restaurant_id)
                .single()
                .execute()
            )
            if result.data:
                pd = result.data
                provider_name = pd.get("name") or provider_name
                score = pd.get("relationship_health_score")
                close = pd.get("close_relationship")
                notes = (pd.get("ai_personality_notes") or "")[:120]
                if score is not None:
                    provider_meta_lines.append(f"rel={score}/10")
                if close:
                    provider_meta_lines.append("close=yes")
                if notes:
                    provider_meta_lines.append(f'notes="{notes}"')
        except Exception as exc:
            self.logger.warning(f"Failed to fetch provider profile: {exc}")

        # ── Rolling summary (hard cap 200 chars — enough for context, not bloat) ──
        history_line = ""
        try:
            conv_result = (
                self.database.supabase.table("procurement_conversations")
                .select("rolling_summary")
                .eq("order_id", order_id)
                .eq("restaurant_id", restaurant_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if conv_result.data:
                summary = conv_result.data[0].get("rolling_summary") or ""
                if summary:
                    history_line = f"history: {summary[:200]}"
        except Exception as exc:
            self.logger.warning(f"Failed to fetch rolling summary: {exc}")

        # ── Negotiation facts (committed agreements only, compact) ──
        facts_line = ""
        try:
            facts_result = (
                self.database.supabase.table("negotiation_facts")
                .select("fact_field, fact_value")
                .eq("provider_id", provider_id)
                .eq("restaurant_id", restaurant_id)
                .eq("commitment_type", "AGREEMENT")
                .limit(4)
                .execute()
            )
            if facts_result.data:
                facts_line = "agreed: " + "; ".join(
                    f"{r['fact_field']}={r['fact_value']}" for r in facts_result.data
                )
        except Exception as exc:
            self.logger.warning(f"Failed to fetch negotiation facts: {exc}")

        # ── Compressed user message ──
        wine = payload.get("wine_name") or "wine"
        qty = payload.get("quantity") or "TBD"
        target = payload.get("target_price_per_bottle")
        urgency = payload.get("urgency") or "normal"

        provider_line = f"provider: {provider_name}"
        if provider_meta_lines:
            provider_line += f" ({', '.join(provider_meta_lines)})"

        order_parts = [
            f"type: {email_type}",
            provider_line,
            f"wine: {wine}",
            f"qty: {qty}",
        ]
        if target is not None:
            order_parts.append(f"target: ${target}/bottle")
        if urgency != "normal":
            order_parts.append(f"urgency: {urgency}")
        if history_line:
            order_parts.append(history_line)
        if facts_line:
            order_parts.append(facts_line)

        user_message = "\n".join(order_parts) + "\n\nDraft the email. Return JSON only."

        # Rough token estimate: 1 token ≈ 4 chars (system already counted separately)
        estimated_tokens = (len(self._SYSTEM_PROMPT) + len(user_message)) // 4
        return user_message, estimated_tokens

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
            self.logger.warning(
                f"Missing required fields in order.created payload: {payload}"
            )
            return

        # Step 1: Daily rate limit (D-32-04)
        rate_key = f"negotiation_draft:{restaurant_id}:day"
        if await self._check_and_increment_rate_limit(
            rate_key, self.settings.negotiation_draft_daily_cap
        ):
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

        # Gate on pre-draft hard constraints (C-03 / C-05 and others).
        # pre_check runs against the order context before the Haiku call to avoid wasting tokens.
        if pre_check.blocked:
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="constraint_triggered",
                title=f"Draft blocked: {', '.join(pre_check.triggered_hard)}",
                message="Order context violates hard constraints. Manual drafting required.",
                priority="high",
                action_url="/orders",
                metadata={
                    "order_id": order_id,
                    "constraints": pre_check.triggered_hard,
                },
            )
            return

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
            self.logger.info(
                f"Draft lock held for order {order_id} — skipping duplicate"
            )
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
                    max_tokens=256,
                    system=[
                        {
                            "type": "text",
                            "text": self._SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        }
                    ],
                    messages=[{"role": "user", "content": prompt}],
                )
            raw = response.content[0].text if response.content else "{}"
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            draft_json = json.loads(raw.strip())
            usage = response.usage if hasattr(response, "usage") else None
            input_tokens = usage.input_tokens if usage else estimated_tokens
            output_tokens = usage.output_tokens if usage else 100
            cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
            cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
            if cache_read or cache_write:
                self.logger.info(
                    f"Haiku prompt cache — read={cache_read} write={cache_write} "
                    f"live_input={input_tokens} output={output_tokens} order={order_id}"
                )
        except (json.JSONDecodeError, Exception) as exc:
            self.logger.error(
                f"Haiku draft generation failed for order {order_id}: {exc}"
            )
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
                metadata={
                    "order_id": order_id,
                    "constraints": post_check.triggered_hard,
                },
            )
            return

        # Step 9b: Disclaimer append (D-32-08 — non-removable)
        restaurant_name = payload.get("restaurant_name", "the restaurant")
        disclaimer = self.settings.wineops_disclaimer.format(
            restaurant_name=restaurant_name
        )
        full_draft = f"{draft_body}\n\n{disclaimer}"

        # Step 10: Auto-send gate (D-32-07 — 3-gate check)
        auto_send = await self._check_auto_send_gate(restaurant_id, provider_id)
        final_status = "AUTO_SENT" if auto_send else "PENDING_APPROVAL"

        # Step 11: INSERT procurement_conversations
        conversation_id = None
        try:
            conv_result = (
                self.database.supabase.table("procurement_conversations")
                .insert(
                    {
                        "order_id": order_id,
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "direction": "outbound",
                        "channel": "email",
                        # message_text is NOT NULL — must always be present
                        "message_text": full_draft,
                        # content is the nullable alias read by NestJS getPendingDraft
                        "content": full_draft,
                        "ai_generated": True,
                        "status": final_status,
                        "outbound_email_type": email_type,
                        "round_count": 0,
                        "disclaimer_appended": True,
                        "constraint_flags": constraint_flags,
                        "rolling_summary": None,
                    }
                )
                .execute()
            )
            if conv_result.data:
                conversation_id = conv_result.data[0].get("id")
        except Exception as exc:
            self.logger.error(
                f"Failed to insert procurement_conversation for order {order_id}: {exc}"
            )
            raise

        # Step 12: Post-insert action
        provider_name = payload.get("provider_name") or "Provider"
        order_number = payload.get("order_number") or f"#{order_id[:8]}"
        order_display = (
            order_number if order_number.startswith("#") else f"#{order_number}"
        )

        if auto_send:
            # D-32-07: Auto-send path — publish event for downstream Gmail send
            try:
                await self.message_bus.publish(
                    exchange_name="provider.events",
                    routing_key="provider.draft.auto_approved",
                    message_body={
                        "conversation_id": conversation_id,
                        "order_id": order_id,
                        "restaurant_id": restaurant_id,
                        "auto_sent": True,
                    },
                )
            except Exception as exc:
                self.logger.warning(
                    f"Failed to publish auto_approved event (non-critical): {exc}"
                )
        else:
            # Manual approval path: notify manager
            # Title is kept short for the bell icon (one line, no wrapping).
            # action_url → /notifications so the bell click lands on the full
            # notification detail where the manager can then review the draft.
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="draft_ready",
                title=f"Order {order_display} is created from {provider_name}",
                message=(
                    f"AI draft ready · {email_type.replace('_', ' ').title()} · "
                    f"{payload.get('wine_name', 'Wine')}"
                ),
                priority="high",
                action_url="/notifications",
                metadata={
                    "conversation_id": conversation_id,
                    "order_id": order_id,
                    "order_number": order_number,
                    "email_type": email_type,
                    "wine_name": payload.get("wine_name", ""),
                    "provider_name": provider_name,
                },
            )

        # Decision log (T-32-03-01 repudiation mitigation)
        await self.log_decision(
            decision_type="outbound_draft_generated",
            inputs={
                "order_id": order_id,
                "email_type": email_type,
                "provider_id": provider_id,
            },
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
            reasoning="Manager approved outbound draft"
            + (" with edits" if modified else ""),
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

    def _get_manager_user_id(self, restaurant_id: str) -> Optional[str]:
        """
        Look up the active owner/manager user_id for a restaurant.
        Notifications require user_id to appear in the bell icon — the API
        queries notifications WHERE user_id = ?.
        Cached per restaurant per agent lifetime (hot path: called on every order).
        """
        if not hasattr(self, "_manager_user_cache"):
            self._manager_user_cache: Dict[str, Optional[str]] = {}
        if restaurant_id in self._manager_user_cache:
            return self._manager_user_cache[restaurant_id]
        try:
            result = (
                self.database.supabase.table("user_restaurant_access")
                .select("user_id")
                .eq("restaurant_id", restaurant_id)
                .in_("role", ["owner", "manager"])
                .eq("is_active", True)
                .order("created_at", desc=False)
                .limit(1)
                .execute()
            )
            uid = result.data[0]["user_id"] if result.data else None
            self._manager_user_cache[restaurant_id] = uid
            return uid
        except Exception as exc:
            self.logger.warning(f"_get_manager_user_id failed: {exc}")
            self._manager_user_cache[restaurant_id] = None
            return None

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
        user_id is resolved from user_restaurant_access so the bell icon picks it up.
        """
        if not restaurant_id:
            return

        # Routed through core.notifications so both runtimes write the same shape.
        # This insert previously omitted recipient_id, notification_type and
        # channels — all NOT NULL with no default on the live table — so EVERY
        # notification died on a 23502 violation inside the except below. The
        # warning said "non-critical"; it was in fact total.
        inserted = await notify_restaurant(
            self.database,
            self.logger,
            restaurant_id,
            notification_type,
            title,
            message,
            priority=priority,
            action_url=action_url,
            metadata=metadata,
        )
        if not inserted:
            self.logger.warning(
                "provider notification not delivered",
                extra={"restaurant_id": restaurant_id, "type": notification_type},
            )

    # =========================================================================
    # DYNAMIC PROFILE EXTRACTION (D-32-10 / PROVINT-03)
    # =========================================================================

    async def _extract_dynamic_profile(
        self,
        conversation_text: str,
        provider_id: str,
        restaurant_id: str,
    ) -> None:
        """
        D-32-10: Auto-extract dynamic provider intelligence from conversation text.
        Extracts: response_speed, negotiation_style, preferred_contact_days,
        typical_delivery_day, relationship_tier, payment_pattern.
        UPDATEs providers.profile_dynamic via JSONB merge (|| operator).
        Haiku call (~$0.001). Non-fatal on failure.
        """
        prompt = (
            "Extract dynamic provider intelligence from this conversation snippet. "
            "Return ONLY valid JSON with these exact keys (omit any you cannot confidently determine):\n"
            '{"response_speed": "fast|slow|moderate", '
            '"negotiation_style": "flexible|fixed|aggressive", '
            '"preferred_contact_days": "e.g. Mon-Wed", '
            '"typical_delivery_day": "e.g. Thursday", '
            '"relationship_tier": "close|standard|new", '
            '"payment_pattern": "e.g. net-30"}\n\n'
            f"Conversation:\n{conversation_text[:3000]}"
        )

        try:
            haiku = get_haiku_client()
            async with self.haiku_semaphore:
                response = await haiku.messages.create(
                    model=self.settings.haiku_model,
                    max_tokens=256,
                    messages=[{"role": "user", "content": prompt}],
                )
            raw = response.content[0].text if response.content else "{}"
            raw = raw.strip()
            if raw.startswith("```"):
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else "{}"
                if raw.startswith("json"):
                    raw = raw[4:]
            new_fields = json.loads(raw.strip())

            if not isinstance(new_fields, dict) or not new_fields:
                return

            # JSONB merge: profile_dynamic = profile_dynamic || new_fields (Python-level)
            # T-32-06-01: restaurant_id scoping enforced; no eval; values stored as strings
            try:
                existing = (
                    self.database.supabase.table("providers")
                    .select("profile_dynamic")
                    .eq("id", provider_id)
                    .eq("restaurant_id", restaurant_id)
                    .single()
                    .execute()
                )
                if existing.data:
                    current_dynamic = existing.data.get("profile_dynamic") or {}
                    merged = {**current_dynamic, **new_fields}
                    self.database.supabase.table("providers").update(
                        {"profile_dynamic": merged}
                    ).eq("id", provider_id).eq("restaurant_id", restaurant_id).execute()
            except Exception as exc:
                self.logger.warning(
                    f"profile_dynamic update failed (non-critical): {exc}"
                )

            # SpendLogger (TOKENBDGT-03)
            try:
                input_tokens = (
                    response.usage.input_tokens
                    if hasattr(response, "usage")
                    else len(prompt) // 4
                )
                output_tokens = (
                    response.usage.output_tokens if hasattr(response, "usage") else 60
                )
                cost_usd = (input_tokens * 0.00000025) + (output_tokens * 0.00000125)
                get_spend_logger().log(
                    provider="anthropic",
                    model=self.settings.haiku_model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost_usd=cost_usd,
                    restaurant_id=restaurant_id,
                )
            except Exception:
                pass

            await self.log_decision(
                decision_type="dynamic_profile_extracted",
                inputs={
                    "provider_id": provider_id,
                    "fields_extracted": list(new_fields.keys()),
                },
                output={"merged_fields": list(new_fields.keys())},
                reasoning=f"Extracted {len(new_fields)} dynamic fields from conversation",
                confidence=0.80,
                restaurant_id=restaurant_id,
            )
        except Exception as exc:
            self.logger.warning(
                f"_extract_dynamic_profile failed (non-critical): {exc}"
            )

    # =========================================================================
    # PROGRESSIVE SUMMARIZATION (OUTBOUND-04 / TOKENBDGT-04)
    # =========================================================================

    async def _maybe_summarize(
        self,
        conversation_id: str,
        provider_id: str,
        restaurant_id: str,
        round_count: int,
        full_conversation: str,
    ) -> None:
        """
        D-32-03 TOKENBDGT-04: Progressive summarization after every 2 rounds.
        Triggered when round_count > 0 and round_count % 2 == 0.
        1. Haiku summarizes the last 2 rounds
        2. UPDATEs procurement_conversations.rolling_summary
        3. INSERTs extracted facts into negotiation_facts table
        """
        if round_count <= 0 or round_count % 2 != 0:
            return  # Not a summarization round

        prompt = (
            "Summarize this procurement negotiation conversation in ≤100 words. "
            "Then extract any factual agreements or offers. "
            "Return ONLY valid JSON:\n"
            '{"summary": "...", "facts": [{"field": "price_per_bottle", "value": "$45.00", '
            '"type": "price", "commitment_type": "OFFER", "confidence": 0.9}]}\n\n'
            f"Conversation:\n{full_conversation[:4000]}"
        )

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
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else "{}"
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw.strip())
        except (json.JSONDecodeError, Exception) as exc:
            self.logger.warning(f"_maybe_summarize Haiku call failed: {exc}")
            return

        summary = result.get("summary", "")
        facts: list = result.get("facts", [])

        # UPDATE rolling_summary
        try:
            self.database.supabase.table("procurement_conversations").update(
                {"rolling_summary": summary}
            ).eq("id", conversation_id).eq("restaurant_id", restaurant_id).execute()
        except Exception as exc:
            self.logger.warning(f"rolling_summary update failed: {exc}")

        # INSERT negotiation_facts (T-32-06-02: commitment_type validated against whitelist)
        valid_commitment_types = {"INDICATIVE", "OFFER", "COUNTER", "AGREEMENT"}
        for fact in facts:
            if not fact.get("field") or not fact.get("value"):
                continue
            commitment_type = fact.get("commitment_type", "INDICATIVE")
            if commitment_type not in valid_commitment_types:
                commitment_type = "INDICATIVE"
            try:
                self.database.supabase.table("negotiation_facts").insert(
                    {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "conversation_id": conversation_id,
                        "fact_field": fact["field"],
                        "fact_value": fact["value"],
                        "fact_type": fact.get("type", "general"),
                        "commitment_type": commitment_type,
                        "confidence": fact.get("confidence", 0.7),
                        "source_message": full_conversation[-500:],
                    }
                ).execute()
            except Exception as exc:
                self.logger.warning(
                    f"negotiation_facts INSERT failed (non-critical): {exc}"
                )

        # SpendLogger (TOKENBDGT-03)
        try:
            input_tokens = (
                response.usage.input_tokens
                if hasattr(response, "usage")
                else len(prompt) // 4
            )
            output_tokens = (
                response.usage.output_tokens if hasattr(response, "usage") else 100
            )
            cost_usd = (input_tokens * 0.00000025) + (output_tokens * 0.00000125)
            get_spend_logger().log(
                provider="anthropic",
                model=self.settings.haiku_model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                restaurant_id=restaurant_id,
            )
        except Exception:
            pass

        await self.log_decision(
            decision_type="progressive_summarization",
            inputs={"conversation_id": conversation_id, "round_count": round_count},
            output={"facts_extracted": len(facts), "summary_length": len(summary)},
            reasoning=f"Round {round_count} summarization: {len(facts)} facts extracted",
            confidence=0.85,
            restaurant_id=restaurant_id,
        )
        self.logger.info(
            f"Summarized conversation {conversation_id} at round {round_count}: {len(facts)} facts"
        )

    # =========================================================================
    # INVOICE EVENT BRIDGE (D-32-15 — triggered by provider.invoice.received)
    # =========================================================================

    async def _handle_invoice_received_event(self, payload: Dict[str, Any]) -> None:
        """
        Bridge handler for provider.invoice.received events published by EmailIntelAgent.
        Extracts invoice from email body via VisualVerificationAgent and runs fuzzy matching.
        """
        restaurant_id = payload.get("restaurant_id", "")
        provider_id = payload.get("provider_id", "")
        provider_name = payload.get("provider_name", "")
        email_body = payload.get("email_body", "")

        if not (restaurant_id and provider_id and email_body):
            self.logger.debug(
                "_handle_invoice_received_event: missing required fields, skipping"
            )
            return

        try:
            from agents.visual_verification_agent import VisualVerificationAgent

            vva = VisualVerificationAgent.__new__(VisualVerificationAgent)
            vva.logger = self.logger
            extracted = await vva._extract_invoice_from_email_text(email_body)
        except Exception as exc:
            self.logger.warning(f"Invoice text extraction failed: {exc}")
            return

        if not extracted:
            return

        await self._handle_invoice_match(
            restaurant_id=restaurant_id,
            provider_id=provider_id,
            provider_name=provider_name,
            extracted_invoice=extracted,
        )

    # =========================================================================
    # INVOICE MATCH HANDLER (D-32-15 Scenario B/C)
    # =========================================================================

    async def _handle_invoice_match(
        self,
        restaurant_id: str,
        provider_id: str,
        provider_name: str,
        extracted_invoice: dict,
    ) -> None:
        """
        D-32-15 Scenario B/C: Fuzzy-match extracted invoice against open procurement_orders.
        Notifies manager with match result and confidence level.
        Does NOT auto-create retroactive orders — T-32-06-03: manager must confirm.
        """
        try:
            # Fetch open orders for this restaurant/provider
            orders_result = (
                self.database.supabase.table("procurement_orders")
                .select("id, wine_name, quantity, created_at, status")
                .eq("restaurant_id", restaurant_id)
                .eq("provider_id", provider_id)
                .in_("status", ["PENDING", "CONFIRMED", "DRAFT"])
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )

            if not orders_result.data:
                # No open orders → C-25 orphan scenario
                await self._notify(
                    restaurant_id=restaurant_id,
                    notification_type="off_app_invoice",
                    title=f"Unrecorded invoice from {provider_name}",
                    message=(
                        f"Invoice for {extracted_invoice.get('line_items', [{}])[0].get('wine_name', 'wine')}"
                        " has no matching order — create a retroactive order?"
                    ),
                    priority="medium",
                    action_url=f"/providers/{provider_id}",
                    metadata={
                        "provider_id": provider_id,
                        "invoice": extracted_invoice,
                        "match_class": "no_match",
                    },
                )
                return

            fm = get_fuzzy_matcher()
            line_items = extracted_invoice.get("line_items", [{}])
            extracted_wine = line_items[0].get("wine_name", "") if line_items else ""
            extracted_qty = (
                float(line_items[0].get("quantity", 0)) if line_items else None
            )
            extracted_date = extracted_invoice.get("invoice_date")

            orders_with_names = [
                {**o, "provider_name": provider_name} for o in orders_result.data
            ]

            best = fm.best_order_match(
                extracted_provider=provider_name,
                extracted_wine=extracted_wine,
                extracted_quantity=extracted_qty,
                extracted_date=extracted_date,
                orders=orders_with_names,
            )

            if not best:
                match_class = "no_match"
                score = 0.0
                order_display = ""
            else:
                match_class = best.get("_match_class", "no_match")
                score = best.get("_match_score", 0.0)
                order_display = str(best.get("id", ""))[:8]

            if match_class == "auto_suggest":
                message = f"Invoice looks like order #{order_display} — confirm match?"
                title = f"Invoice match: order #{order_display}"
                priority = "high"
            elif match_class == "possible_match":
                message = f"Possible match: order #{order_display} ({extracted_wine})? Yes / No / Different order"
                title = f"Possible invoice match: order #{order_display}"
                priority = "medium"
            else:
                message = f"Invoice for {extracted_wine} from {provider_name} has no matching order — create retroactive order?"
                title = f"Unrecorded invoice from {provider_name}"
                priority = "low"

            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="off_app_invoice",
                title=title,
                message=message,
                priority=priority,
                action_url=f"/orders?invoice_match={provider_id}",
                metadata={
                    "provider_id": provider_id,
                    "invoice": extracted_invoice,
                    "match_class": match_class,
                    "match_score": round(score, 3),
                    "order_id": best.get("id") if best else None,
                },
            )
        except Exception as exc:
            self.logger.warning(f"_handle_invoice_match failed (non-critical): {exc}")
