"""
Provider Conversation Agent — Gateway Pattern
================================================
Single gateway for ALL provider/vendor communication.

Architecture:
- ProcurementAgent publishes intents (negotiate_price, check_availability, etc.)
- This agent owns the full conversation lifecycle: generate, approve, send, receive, extract
- Every message (in/out) passes through intelligence extraction → Digital Twin update
- Embedding-based conversational memory (pgvector RAG) for context retrieval
- Concurrent multi-provider sessions via Redis-backed state

Components:
1.  Communication Gateway       — Routes inbound/outbound messages
2.  Session Manager             — Concurrent per-provider sessions (Redis)
3.  Intelligence Extractor      — LLM-powered structured entity extraction
4.  Conversational Memory       — pgvector RAG for semantic context retrieval
5.  Profile Builder             — Digital Twin upsert with contradiction detection
6.  Promotion Engine            — Promo lifecycle, cross-vendor comparison, savings
7.  Response Generator          — Style-adapted, human-like message generation
8.  Thread Summarizer           — Executive summaries on session close
9.  Contradiction Detector      — Flags conflicting facts across conversations
10. Auto Follow-Up Scheduler    — Temporal commitment parsing + calendar integration
11. Sentiment Trend Tracker     — Rolling sentiment with relationship health alerts
12. Provider Onboarding Flow    — Structured discovery for new providers
13. Negotiation Leverage Detector — Cross-provider intelligence for leverage
14. Communication Audit Trail   — Logs context used for every generated message
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, field

from core.base_agent import BaseAgent
from utils.logger import setup_logger
from services.email_composer_service import EmailComposerService
from services.spend_logger import estimate_llm_cost, get_spend_logger
from config.settings import Settings, get_settings
from services.model_clients import get_haiku_client

logger = setup_logger("agent.provider_conversation")


# =============================================================================
# CONSTANTS & PROMPTS
# =============================================================================

EXTRACTION_SYSTEM_PROMPT = """You are an AI assistant that extracts structured intelligence
from wine provider/vendor messages. For every message, extract ALL of the following if present.
Be thorough — even subtle mentions matter (e.g., "we're running low on the 2019" = availability signal).

EXTRACT:
- promotions: [{name, type, discount_percentage, discount_fixed, conditions, applicable_wines, start_date, end_date, is_stackable, min_quantity, min_spend}]
- price_changes: [{wine_name, vintage, old_price, new_price, effective_date, reason, is_temporary}]
- availability: [{wine_name, vintage, status, quantity_available, eta, allocation_limited}]
- delivery_updates: [{order_reference, status, eta, tracking_number, notes}]
- contact_changes: [{person_name, role, phone, email, action, notes}]
- logistics_changes: [{field, old_value, new_value, effective_date}]
- financial_changes: [{field, old_value, new_value, conditions}]
- wine_portfolio: [{wine_name, action, vintage, details}]
- relationship_signals: [{type, detail, date}]
- temporal_commitments: [{description, expected_date, context}]
- action_items: [{description, deadline, priority, assigned_to}]
- sentiment: "positive" | "neutral" | "negative"
- sentiment_score: float between -1.0 and 1.0
- detected_emotions: []
- urgency: "low" | "medium" | "high" | "critical"
- language: ISO 639-1 code
- leverage_signals: []

Return ONLY valid JSON. Empty arrays for categories with no data."""

RESPONSE_SYSTEM_PROMPT = """You are composing a message from a restaurant wine buyer to a provider.

PROVIDER PROFILE:
{provider_digital_twin_summary}

COMMUNICATION STYLE:
{style_profile}

CONVERSATION HISTORY (recent):
{last_5_messages}

RELEVANT MEMORIES (semantic search):
{top_5_relevant_memories}

CURRENT INTENT:
{intent_description}

ACTIVE PROMOTIONS FROM THIS PROVIDER:
{active_promos}

TONE GUIDANCE:
{tone_instruction}

RECENT CONVERSATION HISTORY (from database, last 3 messages):
{last_3_db_interactions}

OPEN ORDERS FOR THIS PROVIDER:
{open_orders}

PROVIDER CREDIT TERMS:
{credit_terms}

RULES:
- Match the provider's communication style exactly (formality, length, emoji usage)
- Reference specific past conversations naturally ("Last time we spoke about the Barolo...")
- If a promotion is relevant, mention it naturally — don't sound like you're reading a database
- Never commit to orders without saying "let me confirm with my manager"
- If the provider speaks a different language, respond in their language
- Keep it human — this should read like a real person wrote it
- Include a clear next step or question to keep the conversation moving

Generate the message:"""

COMMITMENT_PATTERNS = [
    r"\bwill take\b",
    r"\bwould like to order\b",
    r"\bplease confirm our order\b",
    r"\bwe'?ll proceed with\b",
    r"\bwe accept\b",
    r"\bconfirm \d+ cases?\b",
    r"\blet'?s go ahead\b",
    r"\bsending payment\b",
]

SUMMARY_PROMPT = """Summarize this conversation session in exactly 3 lines:
Line 1: What was discussed
Line 2: What was agreed or decided
Line 3: What follow-ups are needed

CONVERSATION:
{conversation_transcript}

SUMMARY:"""

ONBOARDING_QUESTIONS = [
    "What wines do you currently carry? Any exclusive allocations?",
    "What are your standard pricing structures and volume discount tiers?",
    "What are your delivery schedules, lead times, and minimum order requirements?",
    "What payment terms do you offer? (Net 30, COD, early payment discounts?)",
    "Do you have any current promotions or seasonal offers?",
    "Who are the key contacts for orders, billing, and support?",
]

KNOWLEDGE_CATEGORIES = [
    "company",
    "people",
    "wine_portfolio",
    "promotion",
    "pricing",
    "logistics",
    "financial",
    "relationship",
    "compliance",
]


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ConversationSession:
    """In-memory representation of an active provider session"""

    session_id: str
    provider_id: str
    restaurant_id: str
    session_type: str
    status: str = "active"
    initiated_by: str = "system"
    intent: Dict[str, Any] = field(default_factory=dict)
    context: Dict[str, Any] = field(default_factory=dict)
    topic_stack: List[str] = field(default_factory=list)
    turn_count: int = 0
    messages: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ExtractionResult:
    """Structured output from intelligence extraction"""

    promotions: List[Dict] = field(default_factory=list)
    price_changes: List[Dict] = field(default_factory=list)
    availability: List[Dict] = field(default_factory=list)
    delivery_updates: List[Dict] = field(default_factory=list)
    contact_changes: List[Dict] = field(default_factory=list)
    logistics_changes: List[Dict] = field(default_factory=list)
    financial_changes: List[Dict] = field(default_factory=list)
    wine_portfolio: List[Dict] = field(default_factory=list)
    relationship_signals: List[Dict] = field(default_factory=list)
    temporal_commitments: List[Dict] = field(default_factory=list)
    action_items: List[Dict] = field(default_factory=list)
    sentiment: str = "neutral"
    sentiment_score: float = 0.0
    detected_emotions: List[str] = field(default_factory=list)
    urgency: str = "low"
    language: str = "en"
    leverage_signals: List[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExtractionResult":
        return cls(
            promotions=data.get("promotions", []),
            price_changes=data.get("price_changes", []),
            availability=data.get("availability", []),
            delivery_updates=data.get("delivery_updates", []),
            contact_changes=data.get("contact_changes", []),
            logistics_changes=data.get("logistics_changes", []),
            financial_changes=data.get("financial_changes", []),
            wine_portfolio=data.get("wine_portfolio", []),
            relationship_signals=data.get("relationship_signals", []),
            temporal_commitments=data.get("temporal_commitments", []),
            action_items=data.get("action_items", []),
            sentiment=data.get("sentiment", "neutral"),
            sentiment_score=data.get("sentiment_score", 0.0),
            detected_emotions=data.get("detected_emotions", []),
            urgency=data.get("urgency", "low"),
            language=data.get("language", "en"),
            leverage_signals=data.get("leverage_signals", []),
        )


@dataclass
class AuditEntry:
    """Tracks what context informed a generated message"""

    memories_retrieved: List[str] = field(default_factory=list)
    profile_data_used: List[str] = field(default_factory=list)
    style_adaptations: List[str] = field(default_factory=list)
    active_promos_referenced: List[str] = field(default_factory=list)
    intent_source: str = ""
    commitment_language_detected: bool = False


# =============================================================================
# PROVIDER CONVERSATION AGENT
# =============================================================================


class ProviderConversationAgent(BaseAgent):
    """
    Single gateway for ALL provider communication.

    Handles:
    - Inbound messages (email, SMS, WhatsApp, voice transcripts)
    - Outbound intents from ProcurementAgent and other agents
    - Conversation approval workflows
    - Intelligence extraction on every message
    - Provider Digital Twin maintenance
    - Concurrent multi-provider sessions
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # LLM configuration
        # gemini-2.0-flash was shut down 2026-06-01 (OD-57); fall back to the
        # configured Gemini default so one id changes at the next retirement.
        _gemini_default = get_settings().gemini_model
        self.extraction_model = config.get("extraction_model", _gemini_default)
        self.response_model = config.get("response_model", _gemini_default)
        self.embedding_model = config.get("embedding_model", "text-embedding-004")
        self.llm_temperature = config.get("llm_temperature", 0.7)
        self.google_api_key = config.get("google_api_key")
        self.mock_mode = config.get("mock_mode", True)

        # Session limits
        self.max_sessions = config.get("max_sessions", 20)
        self.memory_top_k = config.get("memory_top_k", 10)

        # Proactive thresholds
        self.follow_up_buffer_hours = config.get("follow_up_buffer_hours", 24)
        self.relationship_alert_days = config.get("relationship_alert_days", 30)
        self.promo_alert_days = config.get("promo_alert_days", 7)

        # LLM clients
        self.llm_client = None
        self.embedding_client = None

        # Email composer for formatting + sending via NestJS Gateway
        self.email_composer = EmailComposerService(
            database=None,  # set during initialize() when database is ready
            config={
                "api_gateway_url": config.get(
                    "api_gateway_url", "http://localhost:3001"
                ),
                "google_api_key": self.google_api_key,
                "llm_model": self.response_model,
                "mock_mode": self.mock_mode,
            },
        )

        # Active sessions (in-memory index, Redis is source of truth)
        self._active_sessions: Dict[str, ConversationSession] = {}
        self._session_semaphore = asyncio.Semaphore(self.max_sessions)

    # =========================================================================
    # LIFECYCLE
    # =========================================================================

    async def initialize(self) -> None:
        self.logger.info("Initializing Provider Conversation Agent (Gateway)")

        if self.mock_mode:
            self.logger.warning("Running in MOCK mode (no real LLM/embedding calls)")
        else:
            try:
                import google.generativeai as genai

                genai.configure(api_key=self.google_api_key)
                self.llm_client = genai.GenerativeModel(self.extraction_model)
                self.logger.info("Gemini client initialized for extraction/response")
            except Exception as e:
                self.logger.error(f"Failed to initialize LLM client: {e}")
                self.mock_mode = True

        # Wire email composer with live database reference
        self.email_composer.database = self.database

        # Start background tasks for proactive intelligence
        asyncio.create_task(self._proactive_monitor_loop())

        self.logger.info("Provider Conversation Agent initialized")

    def get_subscribed_routing_keys(self) -> List[Tuple[str, str]]:
        return [
            # Inbound provider messages (all channels)
            ("conversation.events", "conversation.inbound.email"),
            ("conversation.events", "conversation.inbound.sms"),
            ("conversation.events", "conversation.inbound.whatsapp"),
            ("conversation.events", "conversation.inbound.voice_transcript"),
            # Intent requests from other agents
            ("procurement.events", "procurement.conversation_request"),
            # NOT procurement.order.created. That key belongs to
            # ProviderCommunicationAgent — see the note on _handle_procurement_intent.
            ("provider.events", "provider.promo_check_requested"),
            ("provider.events", "provider.profile_refresh_requested"),
            ("provider.events", "provider.outreach_scheduled"),
            ("provider.events", "provider.created"),
            # Conversation lifecycle
            ("conversation.events", "conversation.approved"),
            ("conversation.events", "conversation.rejected"),
            ("conversation.events", "conversation.modified"),
            # Follow-up triggers
            ("calendar.events", "calendar.provider_followup_due"),
            # Scarcity auto-reply (bypass approval)
            ("conversation.events", "conversation.auto_reply.urgency"),
            # System control
            ("system.control", "system.provider_conversation.*"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key", "")
        payload = message.get("payload", {})

        # Level 4: idempotency guard (guarded by PROV_AGENT_LEVEL4_ENABLED)
        _l4_settings = Settings()
        _idem_key: Optional[str] = None
        if _l4_settings.prov_agent_level4_enabled:
            conv_id = payload.get("conversation_id") or payload.get("message_id", "")
            _idem_key = f"prov_conv:{conv_id}"
            if await self._check_idempotency(_idem_key):
                self.logger.debug(f"Skipping duplicate conversation message: {conv_id}")
                return

        try:
            # --- Inbound provider messages ---
            if routing_key.startswith("conversation.inbound."):
                channel = routing_key.split(".")[
                    -1
                ]  # email, sms, whatsapp, voice_transcript
                await self._handle_inbound_message(payload, channel)

            # --- Intent requests from other agents ---
            elif routing_key == "procurement.conversation_request":
                await self._handle_procurement_intent(payload)
            elif routing_key == "provider.promo_check_requested":
                await self._handle_promo_check(payload)
            elif routing_key == "provider.profile_refresh_requested":
                await self._handle_profile_refresh(payload)
            elif routing_key == "provider.outreach_scheduled":
                await self._handle_scheduled_outreach(payload)
            elif routing_key == "provider.created":
                await self._handle_provider_onboarding(payload)

            # --- Conversation lifecycle ---
            elif routing_key == "conversation.approved":
                await self._handle_conversation_approved(payload)
            elif routing_key == "conversation.rejected":
                await self._handle_conversation_rejected(payload)
            elif routing_key == "conversation.modified":
                await self._handle_conversation_modified(payload)

            # --- Follow-up triggers ---
            elif routing_key == "calendar.provider_followup_due":
                await self._handle_followup_due(payload)

            # --- Scarcity auto-reply (bypasses normal approval) ---
            elif routing_key == "conversation.auto_reply.urgency":
                await self._handle_scarcity_auto_reply(payload)

            else:
                self.logger.debug(f"Unhandled routing key: {routing_key}")

            if _l4_settings.prov_agent_level4_enabled and _idem_key:
                await self._mark_processed(_idem_key, {"status": "processed"})

        except Exception as e:
            if _l4_settings.prov_agent_level4_enabled:
                await self._send_to_dlq(payload, str(e), routing_key)
            raise

    async def cleanup(self) -> None:
        self._active_sessions.clear()
        self.llm_client = None
        self.embedding_client = None
        self.logger.info("Provider Conversation Agent cleaned up")

    # =========================================================================
    # 1. COMMUNICATION GATEWAY
    # =========================================================================

    async def _handle_inbound_message(
        self, payload: Dict[str, Any], channel: str
    ) -> None:
        """Process an inbound message from a provider via any channel."""
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")
        message_text = payload.get("message_text", "")
        payload.get("sender", "")
        payload.get("thread_id")

        if not provider_id or not message_text:
            self.logger.warning("Inbound message missing provider_id or message_text")
            return

        self.logger.info(
            f"Inbound [{channel}] from provider {provider_id}: "
            f"{message_text[:80]}..."
        )

        async with self._session_semaphore:
            # Get or create session for this provider
            session = await self._get_or_create_session(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_type="general_inquiry",
                initiated_by="inbound_message",
            )

            # Update session with inbound message
            session.turn_count += 1
            session.messages.append(
                {
                    "role": "provider",
                    "text": message_text,
                    "channel": channel,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

            # --- Intelligence Extraction Pipeline ---
            extraction = await self._extract_intelligence(
                message_text, provider_id, restaurant_id=restaurant_id
            )

            # --- Embed and store in conversational memory ---
            await self._store_conversation_embedding(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_id=session.session_id,
                message_text=message_text,
                role="provider",
                channel=channel,
                extraction=extraction,
            )

            # --- Update Digital Twin ---
            knowledge_ids = await self._update_digital_twin(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                extraction=extraction,
                source_message=message_text,
            )

            # --- Process promotions ---
            await self._process_extracted_promos(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                promos=extraction.promotions,
                source_message=message_text,
            )

            # --- Record sentiment ---
            await self._record_sentiment(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_id=session.session_id,
                extraction=extraction,
            )

            # --- Schedule follow-ups from temporal commitments ---
            await self._schedule_followups(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_id=session.session_id,
                commitments=extraction.temporal_commitments,
            )

            # --- Check if this is a response to a procurement intent ---
            if session.intent.get("intent_type") == "negotiate_price":
                await self._relay_procurement_response(
                    session, extraction, message_text
                )

            # --- Detect leverage signals ---
            if extraction.leverage_signals:
                await self._publish_leverage_signals(
                    provider_id, restaurant_id, extraction.leverage_signals
                )

            # --- Update session in DB ---
            await self._persist_session(session)

            # --- Publish intelligence extracted event ---
            await self.publish(
                exchange_name="provider.events",
                routing_key="provider.intelligence.extracted",
                message_body={
                    "event_type": "ProviderIntelligenceExtracted",
                    "payload": {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "session_id": session.session_id,
                        "channel": channel,
                        "knowledge_ids": knowledge_ids,
                        "promo_count": len(extraction.promotions),
                        "price_changes": len(extraction.price_changes),
                        "sentiment": extraction.sentiment,
                    },
                },
            )

    async def _handle_procurement_intent(self, payload: Dict[str, Any]) -> None:
        """Handle intent from ProcurementAgent to communicate with a provider.

        Reached via `procurement.conversation_request` only. This agent must NOT
        subscribe to `procurement.order.created`: Phase 32 D-32-01 splits the loop
        so that ProviderCommunicationAgent owns the order-created draft (step 1)
        and this agent owns the reply draft after a provider responds (step 3).
        Both handlers stage a PENDING_APPROVAL row in procurement_conversations and
        notify the manager, so a shared subscription is two drafts and two
        notifications for one order — identical output, no dedup between them.

        The overlap is easy to reintroduce because ProcurementAgent publishes
        `procurement.conversation_request` AND `procurement.order.created` for the
        same auto-reorder; subscribing to both would double this agent against
        itself as well. tests/test_event_topology.py pins the single owner.
        """
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")
        intent_type = payload.get("intent_type", "negotiate_price")
        order_id = payload.get("order_id")

        if not provider_id:
            self.logger.error("Procurement intent missing provider_id")
            return

        self.logger.info(
            f"Procurement intent: {intent_type} for provider {provider_id}, "
            f"order {order_id}"
        )

        async with self._session_semaphore:
            session = await self._get_or_create_session(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_type="negotiation",
                initiated_by="procurement_agent",
                intent=payload,
            )

            # Load provider context for response generation
            digital_twin = await self._load_digital_twin(provider_id, restaurant_id)
            style_profile = await self._load_style_profile(provider_id)
            relevant_memories = await self._search_conversation_memory(
                provider_id=provider_id,
                query=f"{intent_type} {payload.get('wine_name', '')}",
                top_k=self.memory_top_k,
            )
            active_promos = await self._get_active_promos(provider_id, restaurant_id)

            # Generate response
            message_text, audit = await self._generate_response(
                provider_id=provider_id,
                digital_twin=digital_twin,
                style_profile=style_profile,
                recent_messages=session.messages[-5:],
                memories=relevant_memories,
                intent=payload,
                active_promos=active_promos,
                restaurant_id=restaurant_id or "",
            )

            # Store outbound message in memory
            await self._store_conversation_embedding(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_id=session.session_id,
                message_text=message_text,
                role="restaurant",
                channel=style_profile.get("preferred_channel", "email"),
                extraction=None,
            )

            # Pause for manager approval
            conversation_id = await self._create_approval_request(
                session=session,
                message_text=message_text,
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                audit=audit,
                order_id=order_id,
            )

            session.status = "paused_for_approval"
            session.context["pending_conversation_id"] = conversation_id
            session.context["pending_message"] = message_text
            await self._persist_session(session)

    async def _handle_scheduled_outreach(self, payload: Dict[str, Any]) -> None:
        """Handle scheduled proactive outreach to a provider."""
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")
        outreach_type = payload.get("outreach_type", "relationship_building")
        topic = payload.get("topic", "general check-in")

        if not provider_id:
            return

        self.logger.info(f"Scheduled outreach to {provider_id}: {outreach_type}")

        async with self._session_semaphore:
            session = await self._get_or_create_session(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_type=outreach_type,
                initiated_by="scheduled_outreach",
                intent={"outreach_type": outreach_type, "topic": topic},
            )

            digital_twin = await self._load_digital_twin(provider_id, restaurant_id)
            style_profile = await self._load_style_profile(provider_id)
            memories = await self._search_conversation_memory(
                provider_id=provider_id,
                query=topic,
                top_k=5,
            )
            active_promos = await self._get_active_promos(provider_id, restaurant_id)

            message_text, audit = await self._generate_response(
                provider_id=provider_id,
                digital_twin=digital_twin,
                style_profile=style_profile,
                recent_messages=[],
                memories=memories,
                intent={"intent_type": outreach_type, "topic": topic},
                active_promos=active_promos,
                restaurant_id=restaurant_id or "",
            )

            conversation_id = await self._create_approval_request(
                session=session,
                message_text=message_text,
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                audit=audit,
            )

            session.status = "paused_for_approval"
            session.context["pending_conversation_id"] = conversation_id
            await self._persist_session(session)

    async def _handle_promo_check(self, payload: Dict[str, Any]) -> None:
        """Proactively ask a provider about current promotions."""
        provider_id = payload.get("provider_id")
        payload.get("restaurant_id")

        if not provider_id:
            return

        await self._handle_scheduled_outreach(
            {
                **payload,
                "outreach_type": "promo_discovery",
                "topic": "current promotions, seasonal offers, and volume discounts",
            }
        )

    async def _handle_profile_refresh(self, payload: Dict[str, Any]) -> None:
        """Request updated profile information from a provider."""
        provider_id = payload.get("provider_id")
        payload.get("restaurant_id")

        if not provider_id:
            return

        await self._handle_scheduled_outreach(
            {
                **payload,
                "outreach_type": "general_inquiry",
                "topic": "updated pricing, delivery schedules, new wines in portfolio",
            }
        )

    # =========================================================================
    # 2. SESSION MANAGER
    # =========================================================================

    async def _get_or_create_session(
        self,
        provider_id: str,
        restaurant_id: str,
        session_type: str,
        initiated_by: str,
        intent: Optional[Dict[str, Any]] = None,
    ) -> ConversationSession:
        """Get existing active session for provider or create a new one."""
        # Check in-memory cache first
        cache_key = f"session:{provider_id}"
        if cache_key in self._active_sessions:
            session = self._active_sessions[cache_key]
            if session.status in ("active", "waiting_response"):
                # Merge intent if new one arrives for existing session
                if intent:
                    session.intent.update(intent)
                    session.topic_stack.append(intent.get("intent_type", session_type))
                return session

        # Check DB for active sessions
        try:
            result = (
                self.database.supabase.table("provider_conversation_sessions")
                .select("*")
                .eq("provider_id", provider_id)
                .in_("status", ["active", "waiting_response", "paused_for_approval"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )

            if result.data:
                row = result.data[0]
                session = ConversationSession(
                    session_id=row["id"],
                    provider_id=provider_id,
                    restaurant_id=restaurant_id,
                    session_type=row.get("session_type", session_type),
                    status=row.get("status", "active"),
                    initiated_by=row.get("initiated_by", initiated_by),
                    intent=row.get("intent", {}),
                    context=row.get("context", {}),
                    topic_stack=row.get("topic_stack", []),
                    turn_count=row.get("turn_count", 0),
                )
                if intent:
                    session.intent.update(intent)
                self._active_sessions[cache_key] = session
                return session
        except Exception as e:
            self.logger.error(f"Error loading session from DB: {e}")

        # Create new session
        try:
            insert_data = {
                "provider_id": provider_id,
                "restaurant_id": restaurant_id,
                "session_type": session_type,
                "status": "active",
                "initiated_by": initiated_by,
                "intent": intent or {},
                "context": {},
                "topic_stack": (
                    [intent.get("intent_type", session_type)]
                    if intent
                    else [session_type]
                ),
                "turn_count": 0,
            }
            result = (
                self.database.supabase.table("provider_conversation_sessions")
                .insert(insert_data)
                .execute()
            )

            session_id = result.data[0]["id"] if result.data else None
            if not session_id:
                self.logger.error("Failed to create session in DB")
                session_id = f"local-{provider_id}-{datetime.utcnow().timestamp()}"

            session = ConversationSession(
                session_id=session_id,
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_type=session_type,
                initiated_by=initiated_by,
                intent=intent or {},
                topic_stack=(
                    [intent.get("intent_type", session_type)]
                    if intent
                    else [session_type]
                ),
            )
            self._active_sessions[cache_key] = session
            return session

        except Exception as e:
            self.logger.error(f"Error creating session: {e}")
            session = ConversationSession(
                session_id=f"fallback-{provider_id}",
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_type=session_type,
                initiated_by=initiated_by,
                intent=intent or {},
            )
            self._active_sessions[cache_key] = session
            return session

    async def _persist_session(self, session: ConversationSession) -> None:
        """Persist session state to database."""
        try:
            update_data = {
                "status": session.status,
                "intent": session.intent,
                "context": session.context,
                "topic_stack": session.topic_stack,
                "turn_count": session.turn_count,
                "last_provider_message": next(
                    (
                        m["text"]
                        for m in reversed(session.messages)
                        if m["role"] == "provider"
                    ),
                    None,
                ),
                "last_agent_message": next(
                    (
                        m["text"]
                        for m in reversed(session.messages)
                        if m["role"] == "restaurant"
                    ),
                    None,
                ),
            }
            if session.status == "completed":
                update_data["completed_at"] = datetime.utcnow().isoformat()

            self.database.supabase.table("provider_conversation_sessions").update(
                update_data
            ).eq("id", session.session_id).execute()
        except Exception as e:
            self.logger.error(f"Error persisting session {session.session_id}: {e}")

    async def _complete_session(self, session: ConversationSession) -> None:
        """Complete a session: summarize and persist."""
        session.status = "completed"

        # Generate summary
        summary = await self._generate_session_summary(session)
        session.context["summary"] = summary

        try:
            self.database.supabase.table("provider_conversation_sessions").update(
                {
                    "status": "completed",
                    "summary": summary,
                    "completed_at": datetime.utcnow().isoformat(),
                }
            ).eq("id", session.session_id).execute()
        except Exception as e:
            self.logger.error(f"Error completing session: {e}")

        # Remove from active cache
        cache_key = f"session:{session.provider_id}"
        self._active_sessions.pop(cache_key, None)

        # Publish session completed event
        await self.publish(
            exchange_name="conversation.events",
            routing_key="conversation.session_completed",
            message_body={
                "event_type": "ConversationSessionCompleted",
                "payload": {
                    "session_id": session.session_id,
                    "provider_id": session.provider_id,
                    "session_type": session.session_type,
                    "summary": summary,
                    "turn_count": session.turn_count,
                },
            },
        )

    # =========================================================================
    # 3. INTELLIGENCE EXTRACTOR
    # =========================================================================

    def _log_gemini_spend(
        self,
        response,
        task_type: str,
        duration_ms: Optional[int] = None,
        restaurant_id: Optional[str] = None,
    ) -> None:
        """P1: emit one spend/NF row for a legacy-SDK Gemini call (never raises).

        `duration_ms` is measured by the caller around its own model call —
        timing it here would only measure this helper.
        """
        try:
            _usage = getattr(response, "usage_metadata", None)
            _in = getattr(_usage, "prompt_token_count", 0) or 0
            # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
            _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                getattr(_usage, "thoughts_token_count", 0) or 0
            )
            get_spend_logger().log(
                provider="google",
                model=self.extraction_model,
                input_tokens=_in,
                output_tokens=_out,
                cost_usd=estimate_llm_cost(self.extraction_model, _in, _out),
                restaurant_id=restaurant_id or None,
                agent=self.agent_name,
                task_type=task_type,
                outcome="success",  # call-level: response returned
                duration_ms=duration_ms,
                correlation_id=getattr(self, "_current_correlation_id", None),
            )
        except Exception:
            pass

    async def _extract_intelligence(
        self,
        message_text: str,
        provider_id: str,
        restaurant_id: Optional[str] = None,
    ) -> ExtractionResult:
        """Extract structured intelligence from a message using LLM."""
        if self.mock_mode:
            return self._mock_extract(message_text)

        try:
            prompt = (
                f"{EXTRACTION_SYSTEM_PROMPT}\n\n"
                f"PROVIDER ID: {provider_id}\n"
                f'MESSAGE:\n"{message_text}"\n\n'
                f"EXTRACTED JSON:"
            )

            _t0 = time.perf_counter()
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.llm_client.generate_content(
                    prompt,
                    generation_config={"temperature": 0.1, "max_output_tokens": 2000},
                ),
            )
            self._log_gemini_spend(  # P1
                response,
                "intelligence_extraction",
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                restaurant_id=restaurant_id,
            )

            raw_text = response.text.strip()
            # Strip markdown code fences if present
            if raw_text.startswith("```"):
                raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                raw_text = re.sub(r"\s*```$", "", raw_text)

            parsed = json.loads(raw_text)
            return ExtractionResult.from_dict(parsed)

        except json.JSONDecodeError as e:
            self.logger.warning(f"Failed to parse extraction JSON: {e}")
            return self._fallback_extract(message_text)
        except Exception as e:
            self.logger.error(f"Intelligence extraction failed: {e}")
            return self._fallback_extract(message_text)

    def _mock_extract(self, message_text: str) -> ExtractionResult:
        """Mock extraction for development/testing."""
        sentiment = "neutral"
        score = 0.0
        lower = message_text.lower()

        if any(
            w in lower
            for w in ["happy", "great", "excellent", "pleased", "discount", "promo"]
        ):
            sentiment = "positive"
            score = 0.6
        elif any(
            w in lower
            for w in ["sorry", "unfortunately", "cannot", "unavailable", "increase"]
        ):
            sentiment = "negative"
            score = -0.5

        promos = []
        if any(w in lower for w in ["discount", "promo", "% off", "deal", "special"]):
            promos.append(
                {
                    "name": "Extracted promo",
                    "type": "volume_discount",
                    "discount_percentage": None,
                    "conditions": {},
                    "applicable_wines": [],
                }
            )

        price_changes = []
        price_match = re.search(r"\$\s*(\d+(?:\.\d{2})?)", message_text)
        if price_match:
            price_changes.append(
                {
                    "wine_name": "Unknown",
                    "new_price": float(price_match.group(1)),
                }
            )

        return ExtractionResult(
            promotions=promos,
            price_changes=price_changes,
            sentiment=sentiment,
            sentiment_score=score,
            language="en",
        )

    def _fallback_extract(self, message_text: str) -> ExtractionResult:
        """Keyword-based fallback when LLM extraction fails."""
        lower = message_text.lower()

        sentiment = "neutral"
        score = 0.0
        if any(w in lower for w in ["sorry", "unfortunately", "cannot", "unable"]):
            sentiment = "negative"
            score = -0.4
        elif any(w in lower for w in ["happy", "pleased", "great", "excellent"]):
            sentiment = "positive"
            score = 0.5

        promos = []
        if any(w in lower for w in ["discount", "promo", "promotion", "% off", "deal"]):
            promos.append(
                {"name": "Detected promotion (fallback)", "type": "volume_discount"}
            )

        availability = []
        if any(w in lower for w in ["out of stock", "unavailable", "sold out"]):
            availability.append({"wine_name": "Unknown", "status": "unavailable"})
        elif any(w in lower for w in ["limited", "last", "few remaining"]):
            availability.append({"wine_name": "Unknown", "status": "limited"})

        temporal = []
        day_patterns = re.findall(
            r"(?:by|on|before|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
            lower,
        )
        for day in day_patterns:
            temporal.append({"description": f"Expected by {day}", "expected_date": day})

        return ExtractionResult(
            promotions=promos,
            availability=availability,
            temporal_commitments=temporal,
            sentiment=sentiment,
            sentiment_score=score,
        )

    # =========================================================================
    # 4. CONVERSATIONAL MEMORY ENGINE (pgvector RAG)
    # =========================================================================

    async def _store_conversation_embedding(
        self,
        provider_id: str,
        restaurant_id: str,
        session_id: str,
        message_text: str,
        role: str,
        channel: str,
        extraction: Optional[ExtractionResult] = None,
    ) -> Optional[str]:
        """Embed a message and store in pgvector for semantic retrieval."""
        try:
            embedding = await self._generate_embedding(message_text)

            entities = {}
            intents = []
            importance = 0.5
            language = "en"

            if extraction:
                entities = {
                    "promo_count": len(extraction.promotions),
                    "price_changes": len(extraction.price_changes),
                    "availability": len(extraction.availability),
                }
                intents = [extraction.urgency, extraction.sentiment]
                language = extraction.language
                # Score importance: price commitments and promos rank higher
                if extraction.price_changes or extraction.promotions:
                    importance = 0.9
                elif extraction.availability or extraction.delivery_updates:
                    importance = 0.7
                elif extraction.relationship_signals:
                    importance = 0.4

            result = (
                self.database.supabase.table("conversation_embeddings")
                .insert(
                    {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "session_id": session_id,
                        "message_text": message_text,
                        "role": role,
                        "channel": channel,
                        "embedding": embedding,
                        "extracted_entities": entities,
                        "extracted_intents": intents,
                        "importance_score": importance,
                        "language": language,
                    }
                )
                .execute()
            )

            return result.data[0]["id"] if result.data else None

        except Exception as e:
            self.logger.error(f"Error storing embedding: {e}")
            return None

    async def _search_conversation_memory(
        self,
        provider_id: str,
        query: str,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Semantic search across conversation history for a provider."""
        try:
            query_embedding = await self._generate_embedding(query)

            # Use Supabase RPC for vector similarity search
            result = self.database.supabase.rpc(
                "match_conversation_embeddings",
                {
                    "query_embedding": query_embedding,
                    "match_provider_id": provider_id,
                    "match_threshold": 0.5,
                    "match_count": top_k,
                },
            ).execute()

            return result.data if result.data else []

        except Exception as e:
            self.logger.warning(f"Conversation memory search failed: {e}")
            # Fallback: return recent messages
            return await self._get_recent_messages(provider_id, limit=top_k)

    async def _get_recent_messages(
        self, provider_id: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Fallback: get recent messages when vector search is unavailable."""
        try:
            result = (
                self.database.supabase.table("conversation_embeddings")
                .select("message_text, role, channel, importance_score, created_at")
                .eq("provider_id", provider_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data if result.data else []
        except Exception:
            return []

    async def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding vector for text."""
        if self.mock_mode:
            # Return a deterministic mock embedding based on text hash
            import hashlib

            hash_bytes = hashlib.sha384(text.encode()).digest()
            return [float(b) / 255.0 for b in hash_bytes]

        try:
            import google.generativeai as genai

            _t0 = time.perf_counter()
            result = genai.embed_content(
                model=f"models/{self.embedding_model}",
                content=text,
                task_type="retrieval_document",
            )
            # P1: embedding calls are API spend too. No token usage is exposed
            # by the embed API and no per-call price is configured, so tokens
            # and cost are recorded as 0 with the call flagged unpriced.
            get_spend_logger().log(
                provider="google",
                model=self.embedding_model,
                input_tokens=0,
                output_tokens=0,
                cost_usd=0.0,
                agent=self.agent_name,
                task_type="embedding",
                outcome="success",  # call-level: embedding returned
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                correlation_id=getattr(self, "_current_correlation_id", None),
                context={"call_kind": "embedding", "pricing": "unpriced"},
            )
            return result["embedding"]
        except Exception as e:
            self.logger.error(f"Embedding generation failed: {e}")
            import hashlib

            hash_bytes = hashlib.sha384(text.encode()).digest()
            return [float(b) / 255.0 for b in hash_bytes]

    # =========================================================================
    # 5. PROFILE BUILDER (Digital Twin)
    # =========================================================================

    async def _update_digital_twin(
        self,
        provider_id: str,
        restaurant_id: str,
        extraction: ExtractionResult,
        source_message: str,
    ) -> List[str]:
        """Update provider Digital Twin from extracted intelligence."""
        knowledge_ids: List[str] = []

        # Price changes → pricing category
        for pc in extraction.price_changes:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="pricing",
                subcategory="price_point",
                label=f"Price for {pc.get('wine_name', 'Unknown')}",
                attributes=pc,
                confidence=0.9,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

                await self.publish(
                    exchange_name="provider.events",
                    routing_key="provider.price.changed",
                    message_body={
                        "event_type": "ProviderPriceChanged",
                        "payload": {
                            "provider_id": provider_id,
                            "restaurant_id": restaurant_id,
                            **pc,
                        },
                    },
                )

        # Availability → wine_portfolio category
        for av in extraction.availability:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="wine_portfolio",
                subcategory="availability",
                label=f"Availability: {av.get('wine_name', 'Unknown')}",
                attributes=av,
                confidence=0.85,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

                await self.publish(
                    exchange_name="provider.events",
                    routing_key="provider.availability.updated",
                    message_body={
                        "event_type": "ProviderAvailabilityUpdated",
                        "payload": {
                            "provider_id": provider_id,
                            "restaurant_id": restaurant_id,
                            **av,
                        },
                    },
                )

        # Contact changes → people category
        for cc in extraction.contact_changes:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="people",
                subcategory="contact_person",
                label=f"Contact: {cc.get('person_name', 'Unknown')}",
                attributes=cc,
                confidence=1.0,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

        # Logistics changes → logistics category
        for lc in extraction.logistics_changes:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="logistics",
                subcategory=lc.get("field", "general"),
                label=f"Logistics: {lc.get('field', 'update')}",
                attributes=lc,
                confidence=0.9,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

        # Financial changes → financial category
        for fc in extraction.financial_changes:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="financial",
                subcategory=fc.get("field", "general"),
                label=f"Financial: {fc.get('field', 'update')}",
                attributes=fc,
                confidence=0.9,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

        # Wine portfolio updates → wine_portfolio category
        for wp in extraction.wine_portfolio:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="wine_portfolio",
                subcategory=wp.get("action", "update"),
                label=f"Portfolio: {wp.get('wine_name', 'Unknown')}",
                attributes=wp,
                confidence=0.8,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

        # Relationship signals → relationship category
        for rs in extraction.relationship_signals:
            kid = await self._upsert_knowledge(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                category="relationship",
                subcategory=rs.get("type", "signal"),
                label=f"Relationship: {rs.get('type', 'signal')}",
                attributes=rs,
                confidence=0.7,
                source_message=source_message,
            )
            if kid:
                knowledge_ids.append(kid)

        if knowledge_ids:
            await self.publish(
                exchange_name="provider.events",
                routing_key="provider.profile.updated",
                message_body={
                    "event_type": "ProviderProfileUpdated",
                    "payload": {
                        "provider_id": provider_id,
                        "knowledge_ids": knowledge_ids,
                        "categories_updated": list(
                            set(k.split(":")[0] for k in knowledge_ids if ":" in k)
                        ),
                    },
                },
            )

        return knowledge_ids

    async def _upsert_knowledge(
        self,
        provider_id: str,
        restaurant_id: str,
        category: str,
        subcategory: str,
        label: str,
        attributes: Dict[str, Any],
        confidence: float,
        source_message: str,
    ) -> Optional[str]:
        """
        Insert or update a knowledge fact in the Digital Twin.
        Detects contradictions and handles version history.
        """
        try:
            # Check for existing fact with same category+subcategory+label
            existing = (
                self.database.supabase.table("provider_knowledge")
                .select("id, attributes, version, confidence")
                .eq("provider_id", provider_id)
                .eq("category", category)
                .eq("subcategory", subcategory)
                .eq("label", label)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )

            if existing.data:
                old = existing.data[0]
                old_attrs = old.get("attributes", {})

                # Contradiction detection
                contradiction = self._detect_contradiction(
                    old_attrs, attributes, category
                )

                if contradiction and contradiction["severity"] == "high":
                    # Flag for manager review
                    await self._flag_contradiction(
                        provider_id,
                        restaurant_id,
                        category,
                        subcategory,
                        label,
                        old_attrs,
                        attributes,
                        source_message,
                    )

                # Update with version history
                result = (
                    self.database.supabase.table("provider_knowledge")
                    .update(
                        {
                            "attributes": attributes,
                            "confidence": confidence,
                            "previous_value": old_attrs,
                            "source_message_text": source_message[:500],
                            "version": old.get("version", 1) + 1,
                        }
                    )
                    .eq("id", old["id"])
                    .execute()
                )

                return old["id"]
            else:
                # Insert new knowledge
                result = (
                    self.database.supabase.table("provider_knowledge")
                    .insert(
                        {
                            "provider_id": provider_id,
                            "restaurant_id": restaurant_id,
                            "category": category,
                            "subcategory": subcategory,
                            "label": label,
                            "attributes": attributes,
                            "confidence": confidence,
                            "source_message_text": source_message[:500],
                        }
                    )
                    .execute()
                )

                return result.data[0]["id"] if result.data else None

        except Exception as e:
            self.logger.error(f"Error upserting knowledge: {e}")
            return None

    def _detect_contradiction(
        self,
        old_attrs: Dict[str, Any],
        new_attrs: Dict[str, Any],
        category: str,
    ) -> Optional[Dict[str, Any]]:
        """Detect if new attributes contradict existing ones."""
        if not old_attrs or not new_attrs:
            return None

        # Price contradiction: >10% change
        old_price = old_attrs.get("new_price") or old_attrs.get("price")
        new_price = new_attrs.get("new_price") or new_attrs.get("price")
        if old_price and new_price:
            try:
                diff_pct = (
                    abs(float(new_price) - float(old_price)) / float(old_price) * 100
                )
                if diff_pct > 10:
                    return {
                        "field": "price",
                        "old": old_price,
                        "new": new_price,
                        "diff_pct": diff_pct,
                        "severity": "high",
                    }
            except (ValueError, TypeError, ZeroDivisionError):
                pass

        # Lead time contradiction: doubled
        old_lead = old_attrs.get("new_value") if category == "logistics" else None
        new_lead = new_attrs.get("new_value") if category == "logistics" else None
        if old_lead and new_lead:
            try:
                if float(new_lead) >= float(old_lead) * 2:
                    return {
                        "field": "logistics",
                        "old": old_lead,
                        "new": new_lead,
                        "severity": "high",
                    }
            except (ValueError, TypeError):
                pass

        return None

    async def _flag_contradiction(
        self,
        provider_id: str,
        restaurant_id: str,
        category: str,
        subcategory: str,
        label: str,
        old_attrs: Dict[str, Any],
        new_attrs: Dict[str, Any],
        source_message: str,
    ) -> None:
        """Flag a significant contradiction for manager review."""
        await self.publish(
            exchange_name="provider.events",
            routing_key="provider.contradiction.detected",
            message_body={
                "event_type": "ProviderContradictionDetected",
                "payload": {
                    "provider_id": provider_id,
                    "restaurant_id": restaurant_id,
                    "category": category,
                    "subcategory": subcategory,
                    "label": label,
                    "old_value": old_attrs,
                    "new_value": new_attrs,
                    "source_message": source_message[:200],
                },
            },
            priority=7,
        )

        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.provider_contradiction",
            message_body={
                "event_type": "ProviderContradictionAlert",
                "payload": {
                    "restaurant_id": restaurant_id,
                    "title": f"Provider info changed: {label}",
                    "message": f"Detected conflicting info in {category}/{subcategory}. Previous vs new value needs review.",
                    "urgency": "medium",
                    "provider_id": provider_id,
                },
            },
        )

    async def _load_digital_twin(
        self, provider_id: str, restaurant_id: str
    ) -> Dict[str, Any]:
        """Load the full Digital Twin for a provider."""
        try:
            result = (
                self.database.supabase.table("provider_knowledge")
                .select(
                    "category, subcategory, label, attributes, confidence, verified"
                )
                .eq("provider_id", provider_id)
                .eq("is_active", True)
                .order("category")
                .execute()
            )

            twin: Dict[str, List[Dict]] = {}
            for row in result.data or []:
                cat = row["category"]
                twin.setdefault(cat, []).append(
                    {
                        "label": row["label"],
                        "subcategory": row.get("subcategory"),
                        "attributes": row["attributes"],
                        "confidence": row["confidence"],
                        "verified": row["verified"],
                    }
                )

            return twin
        except Exception as e:
            self.logger.error(f"Error loading digital twin: {e}")
            return {}

    async def _load_style_profile(self, provider_id: str) -> Dict[str, Any]:
        """Load the communication style profile for a provider."""
        try:
            result = (
                self.database.supabase.table("provider_knowledge")
                .select("attributes")
                .eq("provider_id", provider_id)
                .eq("category", "relationship")
                .eq("subcategory", "communication_style")
                .eq("is_active", True)
                .limit(1)
                .execute()
            )

            if result.data:
                return result.data[0].get("attributes", {})

            # Default style
            return {
                "formality": "semi-formal",
                "greeting_preference": "first_name",
                "preferred_channel": "email",
                "typical_response_length": "medium",
                "uses_emojis": False,
                "humor_receptive": False,
                "language": "en",
            }
        except Exception:
            return {"formality": "semi-formal", "language": "en"}

    # =========================================================================
    # 6. PROMOTION ENGINE
    # =========================================================================

    async def _process_extracted_promos(
        self,
        provider_id: str,
        restaurant_id: str,
        promos: List[Dict[str, Any]],
        source_message: str,
    ) -> None:
        """Process promotions discovered from conversation."""
        for promo in promos:
            promo_name = promo.get("name", "Unnamed Promotion")
            promo_type = promo.get("type", "volume_discount")
            valid_types = [
                "volume_discount",
                "seasonal",
                "bundle",
                "loyalty",
                "closeout",
                "new_vintage",
                "free_shipping",
                "sample",
                "early_payment",
                "referral",
            ]
            if promo_type not in valid_types:
                promo_type = "volume_discount"

            try:
                # Check if promo already exists
                existing = (
                    self.database.supabase.table("provider_promotions")
                    .select("id, status")
                    .eq("provider_id", provider_id)
                    .eq("name", promo_name)
                    .eq("status", "active")
                    .limit(1)
                    .execute()
                )

                if existing.data:
                    # Update existing promo
                    self.database.supabase.table("provider_promotions").update(
                        {
                            "conditions": promo.get("conditions", {}),
                            "discount_value": {
                                "type": (
                                    "percentage"
                                    if promo.get("discount_percentage")
                                    else "fixed"
                                ),
                                "value": promo.get("discount_percentage")
                                or promo.get("discount_fixed"),
                            },
                            "source_message_text": source_message[:500],
                        }
                    ).eq("id", existing.data[0]["id"]).execute()
                else:
                    # Insert new promo
                    insert_data = {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "name": promo_name,
                        "promo_type": promo_type,
                        "description": promo.get("description"),
                        "conditions": promo.get("conditions", {}),
                        "discount_value": {
                            "type": (
                                "percentage"
                                if promo.get("discount_percentage")
                                else "fixed"
                            ),
                            "value": promo.get("discount_percentage")
                            or promo.get("discount_fixed"),
                        },
                        "applicable_wines": promo.get("applicable_wines", []),
                        "start_date": promo.get("start_date"),
                        "end_date": promo.get("end_date"),
                        "is_recurring": False,
                        "status": "active",
                        "source_message_text": source_message[:500],
                    }
                    self.database.supabase.table("provider_promotions").insert(
                        insert_data
                    ).execute()

                    # Publish promo discovered event
                    await self.publish(
                        exchange_name="provider.events",
                        routing_key="provider.promo.discovered",
                        message_body={
                            "event_type": "PromotionDiscovered",
                            "payload": {
                                "provider_id": provider_id,
                                "restaurant_id": restaurant_id,
                                "promo_name": promo_name,
                                "promo_type": promo_type,
                                "end_date": promo.get("end_date"),
                            },
                        },
                    )

                    # Notify manager
                    await self.publish(
                        exchange_name="notification.events",
                        routing_key="notification.promo_alert",
                        message_body={
                            "event_type": "NewPromoAlert",
                            "payload": {
                                "restaurant_id": restaurant_id,
                                "title": "New promotion from provider",
                                "message": f"Discovered: {promo_name} ({promo_type})",
                                "urgency": "medium",
                                "provider_id": provider_id,
                            },
                        },
                    )

            except Exception as e:
                self.logger.error(f"Error processing promo: {e}")

    async def _get_active_promos(
        self, provider_id: str, restaurant_id: str
    ) -> List[Dict[str, Any]]:
        """Get all active promotions for a provider."""
        try:
            result = (
                self.database.supabase.table("provider_promotions")
                .select("*")
                .eq("provider_id", provider_id)
                .eq("status", "active")
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    async def _check_expiring_promos(self) -> None:
        """Check for promotions expiring soon and alert manager."""
        try:
            cutoff = (
                (datetime.utcnow() + timedelta(days=self.promo_alert_days))
                .date()
                .isoformat()
            )
            result = (
                self.database.supabase.table("provider_promotions")
                .select("*, providers(name)")
                .eq("status", "active")
                .lte("end_date", cutoff)
                .is_("alerted_at", "null")
                .execute()
            )

            for promo in result.data or []:
                await self.publish(
                    exchange_name="provider.events",
                    routing_key="provider.promo.expiring_soon",
                    message_body={
                        "event_type": "PromoExpiringSoon",
                        "payload": {
                            "provider_id": promo["provider_id"],
                            "restaurant_id": promo["restaurant_id"],
                            "promo_id": promo["id"],
                            "promo_name": promo["name"],
                            "end_date": promo["end_date"],
                        },
                    },
                )

                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.promo_alert",
                    message_body={
                        "event_type": "PromoExpiringAlert",
                        "payload": {
                            "restaurant_id": promo["restaurant_id"],
                            "title": f"Promo expiring: {promo['name']}",
                            "message": f"Ends {promo['end_date']}. Use it or lose it!",
                            "urgency": "high",
                            "provider_id": promo["provider_id"],
                        },
                    },
                )

                # Mark as alerted
                self.database.supabase.table("provider_promotions").update(
                    {"alerted_at": datetime.utcnow().isoformat()}
                ).eq("id", promo["id"]).execute()

        except Exception as e:
            self.logger.error(f"Error checking expiring promos: {e}")

    # =========================================================================
    # 7. RESPONSE GENERATOR
    # =========================================================================

    async def _generate_response(
        self,
        provider_id: str,
        digital_twin: Dict[str, Any],
        style_profile: Dict[str, Any],
        recent_messages: List[Dict[str, Any]],
        memories: List[Dict[str, Any]],
        intent: Dict[str, Any],
        active_promos: List[Dict[str, Any]],
        restaurant_id: str = "",
    ) -> Tuple[str, AuditEntry]:
        """Generate a style-adapted, context-rich message for a provider."""
        audit = AuditEntry(
            memories_retrieved=[m.get("message_text", "")[:60] for m in memories[:5]],
            profile_data_used=list(digital_twin.keys()),
            style_adaptations=[
                f"formality={style_profile.get('formality', 'semi-formal')}",
                f"language={style_profile.get('language', 'en')}",
                f"emojis={'yes' if style_profile.get('uses_emojis') else 'no'}",
            ],
            active_promos_referenced=[p.get("name", "") for p in active_promos[:3]],
            intent_source=intent.get("intent_type", "unknown"),
        )

        if self.mock_mode:
            return self._mock_generate_response(intent, style_profile), audit

        try:
            settings = Settings()

            # D-19: Inject DB-persisted context (survives session restart)
            if settings.prov_agent_level4_enabled:
                db_ctx = await self._get_db_context_for_prompt(
                    provider_id=str(provider_id),
                    restaurant_id=str(restaurant_id),
                )
            else:
                db_ctx = {
                    "last_3_db_interactions": "",
                    "open_orders": "",
                    "credit_terms": "",
                    "close_relationship": False,
                }

            # Edit 5: Close-relationship mode — softer tone when providers.close_relationship=true
            close_relationship = db_ctx.get("close_relationship", False)
            if settings.prov_agent_level4_enabled and close_relationship:
                tone_instruction = (
                    "This vendor is a close relationship. Use a warm, personal, first-name tone. "
                    "Reference shared history naturally. Avoid formal boilerplate."
                )
            else:
                tone_instruction = "Use a professional but friendly tone appropriate for a business relationship."

            # Build prompt
            twin_summary = json.dumps(digital_twin, indent=2, default=str)[:2000]
            style_summary = json.dumps(style_profile, indent=2)
            msg_history = "\n".join(
                f"[{m.get('role', 'unknown')}]: {m.get('text', '')[:200]}"
                for m in recent_messages
            )
            mem_text = "\n".join(
                f"- {m.get('message_text', '')[:200]}" for m in memories[:5]
            )
            promo_text = (
                "\n".join(
                    f"- {p.get('name', 'Unknown')}: {p.get('description', '')}"
                    for p in active_promos[:5]
                )
                or "No active promotions"
            )

            prompt = RESPONSE_SYSTEM_PROMPT.format(
                provider_digital_twin_summary=twin_summary,
                style_profile=style_summary,
                last_5_messages=msg_history or "No prior messages in this session",
                top_5_relevant_memories=mem_text or "No relevant memories found",
                intent_description=json.dumps(intent, default=str),
                active_promos=promo_text,
                tone_instruction=tone_instruction,
                last_3_db_interactions=db_ctx["last_3_db_interactions"],
                open_orders=db_ctx["open_orders"],
                credit_terms=db_ctx["credit_terms"],
            )

            _t0 = time.perf_counter()
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.llm_client.generate_content(
                    prompt,
                    generation_config={
                        "temperature": self.llm_temperature,
                        "max_output_tokens": 300,
                    },
                ),
            )
            self._log_gemini_spend(  # P1
                response,
                "draft_response",
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                restaurant_id=restaurant_id,
            )

            draft_text = response.text.strip()

            # AI-SPEC §6: Check commitment language — log warning; caller must force pending_approval
            if self._check_commitment_language(draft_text):
                self.logger.warning(
                    f"Commitment language detected in draft for provider {provider_id} "
                    "— caller must force pending_approval (AI-SPEC §6)"
                )
                audit.commitment_language_detected = True

            # Level 4: log draft generation decision to decision_log
            if settings.prov_agent_level4_enabled:
                await self.log_decision(
                    decision_type="draft_generated",
                    inputs={
                        "provider_id": str(provider_id),
                        "intent": str(intent.get("intent_type", "unknown"))[:500],
                        "context_injected": list(db_ctx.keys()),
                        "close_relationship": close_relationship,
                    },
                    output={"draft_preview": str(draft_text)[:500]},
                    reasoning="Gemini-generated reply using provider context + DB history (D-19)",
                    confidence=0.8,
                )

            return draft_text, audit

        except Exception as e:
            self.logger.error(f"Response generation failed: {e}")
            return self._mock_generate_response(intent, style_profile), audit

    def _mock_generate_response(
        self, intent: Dict[str, Any], style: Dict[str, Any]
    ) -> str:
        """Generate a mock response for development."""
        intent_type = intent.get("intent_type", "general")
        wine = intent.get("wine_name", "your wines")
        quantity = intent.get("quantity", "")
        target_price = intent.get("target_price", "")
        topic = intent.get("topic", "")

        formality = style.get("formality", "semi-formal")

        if intent_type == "negotiate_price":
            if formality == "casual":
                return (
                    f"Hey! Quick question — could you do "
                    f"{quantity} bottles of {wine} "
                    f"at ${target_price:.2f}/bottle? "
                    f"Let me know what you think!"
                )
            return (
                f"I hope this message finds you well. "
                f"We're looking to order {quantity} bottles of {wine}. "
                f"Would ${target_price:.2f} per bottle work for you? "
                f"I'd appreciate your thoughts on this."
            )

        if intent_type == "promo_discovery":
            return (
                f"Hi! Wanted to check in — do you have any current promotions "
                f"or seasonal offers? We're always looking for good deals on {topic or 'wines'}."
            )

        if intent_type == "onboarding":
            return (
                "Hi, great to connect! We're excited to start working together. "
                "To get things rolling, could you share a bit about your wine portfolio "
                "and any current promotions? Also helpful: delivery schedules, "
                "minimum order requirements, and payment terms. Looking forward to it!"
            )

        return (
            f"Hi! Just wanted to reach out and check in. "
            f"{f'Specifically interested in {topic}.' if topic else ''} "
            f"Let me know if there's anything new on your end!"
        )

    def _check_commitment_language(self, draft_text: str) -> bool:
        """Returns True if draft contains commitment language requiring manager approval.

        AI-SPEC §6 guardrail: matches patterns that could constitute a purchase commitment
        (UCC contract formation risk). Drafts matching this must never auto-send.
        """
        text_lower = draft_text.lower()
        return any(re.search(p, text_lower) for p in COMMITMENT_PATTERNS)

    async def record_correction(
        self,
        original_draft: str,
        edited_draft: str,
        provider_id: str,
        restaurant_id: str,
    ) -> None:
        """D-12: Log manager edit diff to decision_log (learning loop).

        Called by the approval flow (Plan 24-07) when manager edits a draft before sending.
        Haiku extracts a short preference string and appends it to
        conversation_context.manager_instructions[] on the active session row.
        """
        if not original_draft or not edited_draft or original_draft == edited_draft:
            return

        await self.log_decision(
            decision_type="correction",
            inputs={"original": original_draft[:1000], "provider_id": provider_id},
            output={"edited": edited_draft[:1000]},
            reasoning="Manager edited AI draft — diff recorded for learning loop",
            confidence=1.0,
        )

        # Extract communication preference via Haiku and store on session
        try:
            haiku = get_haiku_client()
            settings = Settings()
            _t0 = time.perf_counter()
            response = await haiku.messages.create(
                model=settings.haiku_model,
                max_tokens=100,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Original draft:\n{original_draft[:500]}\n\n"
                            f"Manager edited to:\n{edited_draft[:500]}\n\n"
                            "In one sentence (max 20 words), what communication preference does "
                            "this edit reveal? Format: 'tone: ...' or 'style: ...' or 'avoid: ...'"
                        ),
                    }
                ],
            )
            # P1: previously an unlogged Haiku call (dark site)
            try:
                _in = response.usage.input_tokens if hasattr(response, "usage") else 0
                _out = response.usage.output_tokens if hasattr(response, "usage") else 0
                get_spend_logger().log(
                    provider="anthropic",
                    model=settings.haiku_model,
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost(settings.haiku_model, _in, _out),
                    restaurant_id=restaurant_id,
                    agent=self.agent_name,
                    task_type="correction_preference",
                    outcome="success",  # call-level: completion returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                    correlation_id=getattr(self, "_current_correlation_id", None),
                    context={"provider_id": str(provider_id)},
                )
            except Exception:
                pass

            preference = response.content[0].text.strip() if response.content else ""
            if preference:
                # Append to conversation_context.manager_instructions[] on active session
                self.database.supabase.rpc(
                    "jsonb_array_append",
                    {
                        "table_name": "provider_conversation_sessions",
                        "column_name": "conversation_context",
                        "key": "manager_instructions",
                        "value": preference,
                        "restaurant_id": restaurant_id,
                        "provider_id": provider_id,
                    },
                ).execute()
        except Exception as e:
            self.logger.warning(f"Learning loop preference extraction failed: {e}")

    # =========================================================================
    # 8. THREAD SUMMARIZER
    # =========================================================================

    async def _generate_session_summary(self, session: ConversationSession) -> str:
        """Generate a 3-line executive summary of a completed session."""
        if not session.messages:
            return "No messages in this session."

        if self.mock_mode:
            return (
                f"Discussed: {session.session_type} with provider {session.provider_id}\n"
                f"Agreed: {session.turn_count} exchanges completed\n"
                f"Follow-up: Review session context for next steps"
            )

        try:
            transcript = "\n".join(
                f"[{m.get('role', '?')}] {m.get('text', '')}" for m in session.messages
            )

            prompt = SUMMARY_PROMPT.format(conversation_transcript=transcript[:3000])

            _t0 = time.perf_counter()
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.llm_client.generate_content(
                    prompt,
                    generation_config={"temperature": 0.3, "max_output_tokens": 200},
                ),
            )
            self._log_gemini_spend(  # P1
                response,
                "session_summary",
                duration_ms=int((time.perf_counter() - _t0) * 1000),
                restaurant_id=getattr(session, "restaurant_id", None),
            )

            return response.text.strip()
        except Exception as e:
            self.logger.error(f"Summary generation failed: {e}")
            return f"Session {session.session_type}: {session.turn_count} turns"

    # =========================================================================
    # 9. SENTIMENT TREND TRACKER
    # =========================================================================

    async def _record_sentiment(
        self,
        provider_id: str,
        restaurant_id: str,
        session_id: str,
        extraction: ExtractionResult,
    ) -> None:
        """Record sentiment data point for trend tracking."""
        try:
            self.database.supabase.table("provider_sentiment_history").insert(
                {
                    "provider_id": provider_id,
                    "restaurant_id": restaurant_id,
                    "session_id": session_id,
                    "sentiment": extraction.sentiment,
                    "sentiment_score": extraction.sentiment_score,
                    "detected_emotions": extraction.detected_emotions,
                    "trigger_context": extraction.urgency,
                }
            ).execute()

        except Exception as e:
            self.logger.error(f"Error recording sentiment: {e}")

        # Check for declining trend
        await self._check_sentiment_trend(provider_id, restaurant_id)

    async def _check_sentiment_trend(
        self, provider_id: str, restaurant_id: str
    ) -> None:
        """Check if provider sentiment is declining and alert if needed."""
        try:
            result = (
                self.database.supabase.table("provider_sentiment_history")
                .select("sentiment_score")
                .eq("provider_id", provider_id)
                .order("created_at", desc=True)
                .limit(10)
                .execute()
            )

            scores = [
                r["sentiment_score"]
                for r in (result.data or [])
                if r.get("sentiment_score") is not None
            ]

            if len(scores) >= 5:
                recent_avg = sum(scores[:5]) / 5
                if recent_avg < -0.3:
                    await self.publish(
                        exchange_name="provider.events",
                        routing_key="provider.sentiment.declining",
                        message_body={
                            "event_type": "ProviderSentimentDeclining",
                            "payload": {
                                "provider_id": provider_id,
                                "restaurant_id": restaurant_id,
                                "recent_avg_score": recent_avg,
                            },
                        },
                    )

                    await self.publish(
                        exchange_name="notification.events",
                        routing_key="notification.relationship_health_alert",
                        message_body={
                            "event_type": "RelationshipHealthAlert",
                            "payload": {
                                "restaurant_id": restaurant_id,
                                "title": "Provider relationship declining",
                                "message": f"Sentiment trend is negative (avg: {recent_avg:.2f}). Consider reaching out.",
                                "urgency": "medium",
                                "provider_id": provider_id,
                            },
                        },
                    )

        except Exception as e:
            self.logger.error(f"Error checking sentiment trend: {e}")

    # =========================================================================
    # 10. AUTO FOLLOW-UP SCHEDULER
    # =========================================================================

    async def _schedule_followups(
        self,
        provider_id: str,
        restaurant_id: str,
        session_id: str,
        commitments: List[Dict[str, Any]],
    ) -> None:
        """Schedule follow-ups based on temporal commitments detected in messages."""
        for commitment in commitments:
            expected_date = commitment.get("expected_date")
            description = commitment.get("description", "Follow up")

            if not expected_date:
                continue

            try:
                await self.publish(
                    exchange_name="calendar.events",
                    routing_key="calendar.provider_followup_create",
                    message_body={
                        "event_type": "ProviderFollowUpCreate",
                        "payload": {
                            "provider_id": provider_id,
                            "restaurant_id": restaurant_id,
                            "session_id": session_id,
                            "expected_date": expected_date,
                            "description": description,
                            "buffer_hours": self.follow_up_buffer_hours,
                        },
                    },
                )

                # Update session with follow-up info
                self.database.supabase.table("provider_conversation_sessions").update(
                    {
                        "follow_up_scheduled_at": expected_date,
                        "follow_up_reason": description,
                    }
                ).eq("id", session_id).execute()

                await self.publish(
                    exchange_name="conversation.events",
                    routing_key="conversation.follow_up_scheduled",
                    message_body={
                        "event_type": "FollowUpScheduled",
                        "payload": {
                            "provider_id": provider_id,
                            "session_id": session_id,
                            "expected_date": expected_date,
                            "description": description,
                        },
                    },
                )

            except Exception as e:
                self.logger.error(f"Error scheduling follow-up: {e}")

    async def _handle_followup_due(self, payload: Dict[str, Any]) -> None:
        """Handle a follow-up that is now due."""
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")
        payload.get("session_id")
        reason = payload.get("description", "Scheduled follow-up")

        if not provider_id:
            return

        self.logger.info(f"Follow-up due for provider {provider_id}: {reason}")

        await self._handle_scheduled_outreach(
            {
                "provider_id": provider_id,
                "restaurant_id": restaurant_id,
                "outreach_type": "order_followup",
                "topic": reason,
            }
        )

    # =========================================================================
    # 11. PROVIDER ONBOARDING FLOW
    # =========================================================================

    async def _handle_provider_onboarding(self, payload: Dict[str, Any]) -> None:
        """Initiate structured onboarding conversation for a new provider."""
        provider_id = payload.get("provider_id") or payload.get("id")
        restaurant_id = payload.get("restaurant_id")

        if not provider_id:
            return

        self.logger.info(f"Onboarding new provider: {provider_id}")

        async with self._session_semaphore:
            session = await self._get_or_create_session(
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                session_type="onboarding",
                initiated_by="onboarding",
                intent={"intent_type": "onboarding"},
            )

            style_profile = {"formality": "semi-formal", "language": "en"}
            message_text, audit = await self._generate_response(
                provider_id=provider_id,
                digital_twin={},
                style_profile=style_profile,
                recent_messages=[],
                memories=[],
                intent={"intent_type": "onboarding"},
                active_promos=[],
                restaurant_id=restaurant_id or "",
            )

            await self._create_approval_request(
                session=session,
                message_text=message_text,
                provider_id=provider_id,
                restaurant_id=restaurant_id,
                audit=audit,
            )

            session.status = "paused_for_approval"
            await self._persist_session(session)

    # =========================================================================
    # 12. NEGOTIATION LEVERAGE DETECTOR
    # =========================================================================

    async def _publish_leverage_signals(
        self,
        provider_id: str,
        restaurant_id: str,
        signals: List[str],
    ) -> None:
        """Publish detected negotiation leverage signals."""
        await self.publish(
            exchange_name="provider.events",
            routing_key="provider.leverage.detected",
            message_body={
                "event_type": "NegotiationLeverageDetected",
                "payload": {
                    "provider_id": provider_id,
                    "restaurant_id": restaurant_id,
                    "signals": signals,
                },
            },
        )

    # =========================================================================
    # 13. CONVERSATION LIFECYCLE (Approval/Rejection/Send)
    # =========================================================================

    async def _create_approval_request(
        self,
        session: ConversationSession,
        message_text: str,
        provider_id: str,
        restaurant_id: str,
        audit: AuditEntry,
        order_id: Optional[str] = None,
    ) -> Optional[str]:
        """Create a conversation record pending manager approval."""
        try:
            convo_data = {
                "order_id": order_id,
                "restaurant_id": restaurant_id,
                "provider_id": provider_id,
                # direction and channel are NOT NULL with no default — must be supplied
                "direction": "outbound",
                "channel": "email",
                # message_text is the original NOT NULL column — must always be set
                "message_text": message_text,
                # content is the newer nullable alias read by NestJS getPendingDraft /
                # getActiveConversations; populate both so either SELECT works
                "content": message_text,
                # status drives the approval workflow; NestJS filters on PENDING_APPROVAL
                "status": "PENDING_APPROVAL",
                # conversation_summary exists (nullable text) — use instead of ai_summary
                # which is NOT a real column in the schema
                "conversation_summary": (
                    f"AI-generated {session.session_type} draft pending manager approval"
                ),
                "ai_generated": True,
                # fold LLM metadata into the existing JSONB constraint_flags column
                "constraint_flags": {
                    "llm_model": self.response_model,
                    "session_id": session.session_id,
                    "session_type": session.session_type,
                    "intent": session.intent,
                    "audit_trail": {
                        "memories_retrieved": audit.memories_retrieved,
                        "profile_data_used": audit.profile_data_used,
                        "style_adaptations": audit.style_adaptations,
                        "active_promos_referenced": audit.active_promos_referenced,
                        "intent_source": audit.intent_source,
                    },
                },
            }

            result = (
                self.database.supabase.table("procurement_conversations")
                .insert(convo_data)
                .execute()
            )

            conversation_id = result.data[0]["id"] if result.data else None

            if conversation_id:
                # Get provider name for notification
                provider = await self._get_provider_name(provider_id)

                await self.publish(
                    exchange_name="conversation.events",
                    routing_key="conversation.approval_needed",
                    message_body={
                        "event_type": "ConversationApprovalNeeded",
                        "payload": {
                            "type": "ai_conversation_approval",
                            "priority": "high",
                            "conversation_id": conversation_id,
                            "session_id": session.session_id,
                            "order_id": order_id,
                            "provider_name": provider,
                            "provider_id": provider_id,
                            "ai_message": message_text,
                            "session_type": session.session_type,
                            "notification_channels": {"push": True, "onetap": True},
                            "actions": [
                                {
                                    "id": "approve",
                                    "label": "Approve & Send",
                                    "style": "primary",
                                },
                                {
                                    "id": "edit",
                                    "label": "Edit Message",
                                    "style": "secondary",
                                },
                                {"id": "reject", "label": "Reject", "style": "danger"},
                            ],
                        },
                    },
                    priority=7,
                )

            return conversation_id

        except Exception as e:
            self.logger.error(f"Error creating approval request: {e}")
            return None

    async def _handle_conversation_approved(self, payload: Dict[str, Any]) -> None:
        """Handle manager approval of a generated message."""
        conversation_id = payload.get("conversation_id")
        if not conversation_id:
            return

        try:
            convo = (
                self.database.supabase.table("procurement_conversations")
                .select("*")
                .eq("id", conversation_id)
                .single()
                .execute()
            )

            if not convo.data:
                return

            convo_data = convo.data
            final_message = (
                convo_data.get("manager_approved_message") or convo_data["message_text"]
            )
            provider_id = convo_data["provider_id"]

            # Send the message
            provider = (
                self.database.supabase.table("providers")
                .select("name, primary_contact")
                .eq("id", provider_id)
                .single()
                .execute()
            )

            channel = convo_data.get("channel", "email")
            order_id = convo_data.get("order_id")
            order_data = {}
            if order_id:
                try:
                    order_result = (
                        self.database.supabase.table("procurement_orders")
                        .select("id, wine_name, quantity, target_price_per_bottle")
                        .eq("id", order_id)
                        .single()
                        .execute()
                    )
                    order_data = order_result.data or {}
                except Exception:
                    pass

            await self._send_message(
                provider_id=provider_id,
                message=final_message,
                channel=channel,
                provider_data=provider.data if provider.data else {},
                conversation_id=conversation_id,
                order_data=order_data,
            )

            # Update conversation record
            self.database.supabase.table("procurement_conversations").update(
                {
                    "manager_approval_status": "approved",
                    "resumed_at": datetime.utcnow().isoformat(),
                }
            ).eq("id", conversation_id).execute()

            # Update session status
            session_id = convo_data.get("conversation_context", {}).get("session_id")
            if session_id:
                self.database.supabase.table("provider_conversation_sessions").update(
                    {"status": "waiting_response"}
                ).eq("id", session_id).execute()

                cache_key = f"session:{provider_id}"
                if cache_key in self._active_sessions:
                    self._active_sessions[cache_key].status = "waiting_response"

            self.logger.info(f"Message sent to provider {provider_id} via {channel}")

        except Exception as e:
            self.logger.error(f"Error handling approved conversation: {e}")

    async def _handle_conversation_rejected(self, payload: Dict[str, Any]) -> None:
        """Handle manager rejection of a generated message."""
        conversation_id = payload.get("conversation_id")
        if not conversation_id:
            return

        try:
            self.database.supabase.table("procurement_conversations").update(
                {
                    "manager_approval_status": "rejected",
                    "resumed_at": datetime.utcnow().isoformat(),
                }
            ).eq("id", conversation_id).execute()

            self.logger.info(f"Conversation {conversation_id} rejected by manager")
        except Exception as e:
            self.logger.error(f"Error handling rejection: {e}")

    async def _handle_conversation_modified(self, payload: Dict[str, Any]) -> None:
        """Handle manager modification of a generated message (edit then send)."""
        conversation_id = payload.get("conversation_id")
        modified_message = payload.get("modified_message")
        if not conversation_id or not modified_message:
            return

        try:
            self.database.supabase.table("procurement_conversations").update(
                {
                    "manager_approved_message": modified_message,
                    "manager_approval_status": "modified",
                }
            ).eq("id", conversation_id).execute()

            # Treat as approved with modified text
            await self._handle_conversation_approved(
                {"conversation_id": conversation_id}
            )
        except Exception as e:
            self.logger.error(f"Error handling modified conversation: {e}")

    async def _send_message(
        self,
        provider_id: str,
        message: str,
        channel: str,
        provider_data: Dict[str, Any],
        conversation_id: Optional[str] = None,
        order_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Send a message to a provider via the specified channel.

        For email: uses EmailComposerService to wrap in HTML and send
        through the NestJS API Gateway (Gmail API) for threading support.
        """
        contact = provider_data.get("primary_contact", {}) or {}
        if isinstance(contact, str):
            try:
                contact = json.loads(contact)
            except Exception:
                contact = {}
        provider_name = provider_data.get("name", "Provider")

        if channel in ("sms", "whatsapp"):
            phone = contact.get("phone", "")
            self.logger.info(
                f"[{channel.upper()}] To {provider_name} ({phone}): {message[:80]}..."
            )
            return {"success": True, "channel": channel}

        # --- Email channel: compose HTML and send via gateway ---
        vendor_email = contact.get("email", "")
        if not vendor_email:
            self.logger.warning(f"No email for provider {provider_id} — cannot send")
            return {"success": False, "error": "no_email"}

        # Load conversation history for threading
        history = []
        try:
            result = (
                self.database.supabase.table("procurement_conversations")
                .select(
                    "message_id, email_headers, direction, message_text, sent_at, received_at, created_at"
                )
                .eq("provider_id", provider_id)
                .order("created_at", desc=True)
                .limit(10)
                .execute()
            )
            history = result.data or []
        except Exception as e:
            self.logger.debug(f"Could not load history for threading: {e}")

        from services.email_composer_service import EmailPayload

        # Build a minimal order dict if not provided
        if not order_data:
            order_data = {}

        payload = EmailPayload(
            to=[vendor_email],
            subject=f"Regarding {order_data.get('wine_name', 'your wines')} — {provider_name}",
            body_html=self.email_composer._wrap_html(
                message,
                {
                    "order_number": order_data.get("id", ""),
                    "order_id": order_data.get("id", ""),
                },
            ),
            body_text=message,
        )

        # Resolve threading from history
        thread_id, in_reply_to, references = self.email_composer._resolve_threading(
            history
        )
        payload.thread_id = thread_id
        payload.in_reply_to = in_reply_to
        payload.references = references

        # Send via NestJS API Gateway
        send_result = await self.email_composer.send_via_gateway(payload)

        # Store outbound message_id and email_headers for future thread matching
        if send_result.get("success") and conversation_id:
            outbound_message_id = (
                f"<wineops-{datetime.utcnow().timestamp()}@wineops.ai>"
            )
            try:
                self.database.supabase.table("procurement_conversations").update(
                    {
                        "message_id": outbound_message_id,
                        "email_headers": json.dumps(
                            {
                                "message_id": outbound_message_id,
                                "gmail_message_id": send_result.get("message_id"),
                                "gmail_thread_id": send_result.get("thread_id"),
                                "in_reply_to": in_reply_to or "",
                                "references": references or "",
                            }
                        ),
                        "delivery_status": "sent",
                        "sent_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", conversation_id).execute()
            except Exception as e:
                self.logger.error(f"Failed to update conversation headers: {e}")

        self.logger.info(
            f"[Email] To {provider_name} ({vendor_email}): "
            f"sent={send_result.get('success')}, "
            f"messageId={send_result.get('message_id')}"
        )
        return {
            "success": send_result.get("success", False),
            "channel": "email",
            **send_result,
        }

    # =========================================================================
    # 13b. SCARCITY AUTO-REPLY (bypasses manager approval)
    # =========================================================================

    async def _handle_scarcity_auto_reply(self, payload: Dict[str, Any]) -> None:
        """Immediately reply to a vendor who indicated limited stock.

        Skips the normal approval flow to avoid losing inventory.
        Still notifies the manager afterward.
        """
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")
        order_id = payload.get("order_id")
        wine_name = payload.get("wine_name", "the wine")
        original_body = payload.get("body", "")

        if not provider_id:
            return

        self.logger.info(
            f"Scarcity auto-reply for provider {provider_id}, wine={wine_name}"
        )

        try:
            provider_result = (
                self.database.supabase.table("providers")
                .select("name, primary_contact")
                .eq("id", provider_id)
                .single()
                .execute()
            )
            provider_data = provider_result.data or {}
        except Exception:
            provider_data = {}

        contact = provider_data.get("primary_contact", {}) or {}
        if isinstance(contact, str):
            try:
                contact = json.loads(contact)
            except Exception:
                contact = {}
        vendor_contact = contact.get("name", provider_data.get("name", ""))

        hold_message = (
            f"Hi {vendor_contact},\n\n"
            f"Thanks for the heads up. Could you please hold those for us? "
            f"I'll get back to you very soon with confirmation.\n\n"
            f"Thank you,\n{self.config.get('default_restaurant_name', 'Restaurant Manager')}"
        )

        # AI-SPEC §6: Commitment language must never auto-send — force pending_approval if detected
        auto_send = True
        has_commitment = self._check_commitment_language(hold_message)
        if has_commitment:
            self.logger.warning(
                f"Commitment language detected in scarcity auto-reply for provider {provider_id} "
                "— overriding auto-send to pending_approval (AI-SPEC §6)"
            )
            auto_send = False

        if not auto_send:
            # Route to approval flow instead of auto-sending
            self.logger.info(
                f"Scarcity auto-reply routed to approval for provider {provider_id}"
            )
            return

        send_result = await self._send_message(
            provider_id=provider_id,
            message=hold_message,
            channel="email",
            provider_data=provider_data,
            order_data={"wine_name": wine_name, "id": order_id or ""},
        )

        # Notify manager about the scarcity and the auto-hold
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.scarcity_auto_hold",
            message_body={
                "event_type": "ScarcityAutoHoldSent",
                "payload": {
                    "restaurant_id": restaurant_id,
                    "provider_id": provider_id,
                    "provider_name": provider_data.get("name", ""),
                    "wine_name": wine_name,
                    "order_id": order_id,
                    "type": "scarcity_auto_hold",
                    "title": f"Auto-hold sent: {wine_name}",
                    "message": (
                        f"Vendor indicated limited stock of {wine_name}. "
                        f"An automatic hold request was sent. Please confirm the order soon."
                    ),
                    "urgency": "critical",
                    "original_vendor_message": original_body[:500],
                    "auto_reply_sent": hold_message,
                },
            },
            priority=8,
        )

        self.logger.info(
            f"Scarcity auto-hold sent to {provider_data.get('name', provider_id)}: {send_result}"
        )

    # =========================================================================
    # 14. RELAY TO PROCUREMENT AGENT
    # =========================================================================

    async def _relay_procurement_response(
        self,
        session: ConversationSession,
        extraction: ExtractionResult,
        raw_message: str,
    ) -> None:
        """Relay parsed provider response back to ProcurementAgent."""
        order_id = session.intent.get("order_id")
        if not order_id:
            return

        # Determine response intent
        response_type = "unknown"
        parsed_price = None

        if extraction.price_changes:
            parsed_price = extraction.price_changes[0].get("new_price")
            session.intent.get("target_price", 0)
            max_acceptable = session.intent.get("max_acceptable_price", float("inf"))

            if parsed_price and parsed_price <= max_acceptable:
                response_type = "price_acceptance"
            elif parsed_price:
                response_type = "counter_offer"

        if extraction.sentiment == "negative" and not parsed_price:
            response_type = "rejection"

        if any(a.get("status") == "unavailable" for a in extraction.availability):
            response_type = "unavailable"

        await self.publish(
            exchange_name="procurement.events",
            routing_key="procurement.intent_response",
            message_body={
                "event_type": "ProcurementIntentResponse",
                "payload": {
                    "order_id": order_id,
                    "provider_id": session.provider_id,
                    "restaurant_id": session.restaurant_id,
                    "response_type": response_type,
                    "parsed_price": parsed_price,
                    "raw_message": raw_message[:500],
                    "sentiment": extraction.sentiment,
                    "availability": extraction.availability,
                    "delivery_updates": extraction.delivery_updates,
                    "session_id": session.session_id,
                },
            },
            priority=7,
        )

    # =========================================================================
    # 15. PROACTIVE MONITOR (Background Loop)
    # =========================================================================

    async def _proactive_monitor_loop(self) -> None:
        """Background loop for proactive intelligence checks."""
        await asyncio.sleep(30)  # Initial delay

        while not self._shutdown_event.is_set():
            try:
                # Check expiring promos
                await self._check_expiring_promos()

                # Check relationship health (providers with no recent contact)
                await self._check_relationship_health()

                # Expire old promotions
                await self._expire_old_promos()

            except Exception as e:
                self.logger.error(f"Proactive monitor error: {e}")

            # Run every 6 hours
            try:
                await asyncio.wait_for(self._shutdown_event.wait(), timeout=21600)
                break  # Shutdown requested
            except asyncio.TimeoutError:
                continue

    async def _check_relationship_health(self) -> None:
        """Alert when providers haven't been contacted recently."""
        try:
            cutoff = (
                datetime.utcnow() - timedelta(days=self.relationship_alert_days)
            ).isoformat()

            # Find providers with no recent sessions
            result = self.database.supabase.rpc(
                "get_inactive_providers",
                {"cutoff_date": cutoff},
            ).execute()

            # Fallback if RPC doesn't exist: query directly
            if not result.data:
                result = (
                    self.database.supabase.table("providers")
                    .select("id, name, restaurant_id")
                    .eq("is_active", True)
                    .execute()
                )

                for provider in (result.data or [])[:20]:
                    sessions = (
                        self.database.supabase.table("provider_conversation_sessions")
                        .select("id")
                        .eq("provider_id", provider["id"])
                        .gte("created_at", cutoff)
                        .limit(1)
                        .execute()
                    )

                    if not sessions.data:
                        await self.publish(
                            exchange_name="notification.events",
                            routing_key="notification.relationship_health_alert",
                            message_body={
                                "event_type": "RelationshipHealthAlert",
                                "payload": {
                                    "restaurant_id": provider.get("restaurant_id"),
                                    "title": f"No recent contact: {provider.get('name', 'Provider')}",
                                    "message": f"No conversations in {self.relationship_alert_days} days. Consider reaching out.",
                                    "urgency": "low",
                                    "provider_id": provider["id"],
                                },
                            },
                        )

        except Exception as e:
            self.logger.error(f"Error checking relationship health: {e}")

    async def _expire_old_promos(self) -> None:
        """Mark expired promotions."""
        try:
            today = datetime.utcnow().date().isoformat()
            self.database.supabase.table("provider_promotions").update(
                {"status": "expired"}
            ).eq("status", "active").lt("end_date", today).execute()
        except Exception as e:
            self.logger.error(f"Error expiring promos: {e}")

    # =========================================================================
    # LEVEL 4: DB CONTEXT INJECTION (D-19)
    # =========================================================================

    async def _get_db_context_for_prompt(
        self, provider_id: str, restaurant_id: str
    ) -> dict:
        """
        Fetch DB-persisted context for Haiku prompt injection (D-19).
        Survives session restart unlike in-memory context.
        All queries wrapped in try/except — DB failure returns safe empty defaults.
        """
        ctx: dict = {
            "last_3_db_interactions": "No previous interactions on record.",
            "open_orders": "No open orders.",
            "credit_terms": "No credit terms on record.",
            "close_relationship": False,
        }
        try:
            # Last 3 interactions from procurement_conversations (persisted)
            convs = (
                self.database.supabase.table("procurement_conversations")
                .select("direction, message_text, created_at")
                .eq("provider_id", provider_id)
                .eq("restaurant_id", restaurant_id)
                .order("created_at", desc=True)
                .limit(3)
                .execute()
            )
            if convs.data:
                parts = [
                    f"[{r['direction'].upper()}] {r['message_text'][:200]} "
                    f"({r['created_at'][:10]})"
                    for r in convs.data
                ]
                ctx["last_3_db_interactions"] = "\n".join(parts)
        except Exception as e:
            self.logger.warning(f"_get_db_context: conversations query failed: {e}")

        try:
            # Open orders
            orders = (
                self.database.supabase.table("procurement_orders")
                .select("wine_name, quantity, status, notes")
                .eq("provider_id", provider_id)
                .in_("status", ["pending", "approved", "ordered", "negotiating"])
                .execute()
            )
            if orders.data:
                parts = [
                    f"{r['wine_name']} ×{r['quantity']} [{r['status']}]"
                    for r in orders.data
                ]
                ctx["open_orders"] = "; ".join(parts)
        except Exception as e:
            self.logger.warning(f"_get_db_context: orders query failed: {e}")

        try:
            # Credit terms: negotiation_facts WHERE commitment_type='AGREEMENT' AND fact_field ILIKE '%payment%'
            facts = (
                self.database.supabase.table("negotiation_facts")
                .select("fact_field, fact_value")
                .eq("provider_id", provider_id)
                .eq("commitment_type", "AGREEMENT")
                .ilike("fact_field", "%payment%")
                .limit(1)
                .execute()
            )
            if facts.data:
                f = facts.data[0]
                ctx["credit_terms"] = f"{f['fact_field']}: {f['fact_value']}"
            else:
                # Fallback to providers.notes + close_relationship
                prov = (
                    self.database.supabase.table("providers")
                    .select("notes, close_relationship")
                    .eq("id", provider_id)
                    .maybe_single()
                    .execute()
                )
                if prov.data:
                    if prov.data.get("notes"):
                        ctx["credit_terms"] = f"Notes: {prov.data['notes'][:200]}"
                    ctx["close_relationship"] = bool(
                        prov.data.get("close_relationship", False)
                    )
        except Exception as e:
            self.logger.warning(f"_get_db_context: credit_terms query failed: {e}")

        # Fetch close_relationship if not already set above
        if not ctx["close_relationship"]:
            try:
                prov_cr = (
                    self.database.supabase.table("providers")
                    .select("close_relationship")
                    .eq("id", provider_id)
                    .maybe_single()
                    .execute()
                )
                if prov_cr.data:
                    ctx["close_relationship"] = bool(
                        prov_cr.data.get("close_relationship", False)
                    )
            except Exception as e:
                self.logger.warning(
                    f"_get_db_context: close_relationship query failed: {e}"
                )

        return ctx

    # =========================================================================
    # UTILITY
    # =========================================================================

    async def _get_provider_name(self, provider_id: str) -> str:
        """Get provider name by ID."""
        try:
            result = (
                self.database.supabase.table("providers")
                .select("name")
                .eq("id", provider_id)
                .single()
                .execute()
            )
            return result.data.get("name", "Unknown") if result.data else "Unknown"
        except Exception:
            return "Unknown"
