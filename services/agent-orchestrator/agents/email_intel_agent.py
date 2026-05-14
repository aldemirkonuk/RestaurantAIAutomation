"""
Email Intelligence Agent — Phase 24
=====================================
Inbox triage brain that classifies every inbound Gmail as OPERATIONAL / PROMO / NOISE
using Gemini Flash, extracts deal details from PROMO emails using Claude Haiku,
computes urgency scores (D-16), links to calendar events (D-17), queries cross-vendor
prices (D-18), and accumulates items in Redis digest keys.

Architecture (D-01):
- Subscribes to email.events / email.inbound.raw  (receives ALL Gmail before EmailParsingAgent)
- OPERATIONAL → re-publishes to email.inbound.received with __intel_bypass: True
- PROMO       → Haiku extract + urgency + calendar + price + vendor_promotions INSERT + Redis digest
- NOISE       → silent discard
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from config.settings import Settings
from core.base_agent import BaseAgent
from models.email_intel import EmailClassification, PromoDetails
from services.model_clients import get_gemini_client, get_haiku_client, get_haiku_semaphore

logger = logging.getLogger(__name__)

WINE_EVENT_TYPES = ["tasting", "tasting_event", "high_volume_expected"]
STALE_EMAIL_HOURS = 18  # per premortem R-06: skip digest accumulation for emails older than this


class EmailIntelAgent(BaseAgent):
    """
    Email intelligence triage agent.

    Subscribes to email.inbound.raw and classifies every inbound Gmail message
    as OPERATIONAL, PROMO, or NOISE using Gemini Flash, then routes accordingly.
    """

    def __init__(self, message_bus, database, redis_client=None):
        super().__init__(
            agent_name="email_intel_agent",
            message_bus=message_bus,
            database=database,
            config={},
        )
        self.redis = redis_client
        # Created in initialize() — MUST be inside a running event loop
        self.haiku_semaphore: Optional[Any] = None
        self._settings: Optional[Settings] = None

    @property
    def settings(self) -> Settings:
        if self._settings is None:
            self._settings = Settings()
        return self._settings

    def get_subscribed_routing_keys(self) -> List[Tuple[str, str]]:
        """Subscribe to email.inbound.raw — receives ALL Gmail messages before EmailParsingAgent."""
        return [("email.events", "email.inbound.raw")]

    async def initialize(self) -> None:
        # Create haiku_semaphore inside running event loop (AI-SPEC §3 pitfall 4)
        self.haiku_semaphore = get_haiku_semaphore()
        self.logger.info("EmailIntelAgent initialized — listening on email.inbound.raw")

    # =========================================================================
    # MESSAGE ENTRY POINT
    # =========================================================================

    async def process_message(self, message: Dict[str, Any]) -> None:
        """Main entry point. Receives full message dict from BaseAgent queue."""
        payload = message
        message_id = payload.get("gmail_message_id") or payload.get("id", "")
        idempotency_key = f"email_intel:{message_id}"

        # Custom idempotency check keyed on gmail_message_id (not generic message_id)
        if await self._check_idempotency(idempotency_key):
            self.logger.debug(f"Skipping duplicate email: {message_id}")
            return

        # Outbound SENT emails: link only, no classification (D-01)
        if payload.get("direction") == "outbound":
            await self._link_sent_email(payload)
            await self._mark_processed(idempotency_key, {"status": "linked_outbound"})
            return

        try:
            await self._triage_inbound(payload)
            await self._mark_processed(idempotency_key, {"status": "ok"})
        except Exception as e:
            self.logger.error(f"EmailIntelAgent processing failed: {e}")
            await self._send_to_dlq(
                message=payload,
                error=str(e),
                retry_count=0,
                original_exchange="email.events",
                original_routing_key="email.inbound.raw",
            )
            raise

    # =========================================================================
    # TRIAGE: CLASSIFY → ROUTE
    # =========================================================================

    async def _triage_inbound(self, payload: Dict[str, Any]) -> None:
        email_body = (payload.get("body") or payload.get("snippet") or "")[:8192]
        email_subject = payload.get("subject", "")[:500]
        restaurant_id = payload.get("restaurant_id", "")
        received_at_str = payload.get("received_at") or payload.get("internalDate")

        classification = await self._classify_email(email_subject, email_body)

        await self.log_decision(
            decision_type="email_classification",
            inputs={"subject": email_subject, "body_preview": email_body[:200]},
            output={"category": classification.category, "confidence": classification.confidence},
            reasoning=classification.reasoning,
            confidence=classification.confidence,
            restaurant_id=restaurant_id or None,
        )

        if classification.category == "NOISE":
            # Silent discard per D-03
            self.logger.debug(f"NOISE email discarded: {email_subject[:80]}")
            return

        elif classification.category == "OPERATIONAL":
            # Re-publish to EmailParsingAgent's routing key (per D-01 architecture)
            await self.publish(
                "email.events",
                "email.inbound.received",
                {**payload, "__intel_bypass": True},
            )
            await self._notify(
                restaurant_id=restaurant_id,
                notification_type="email_classified_operational",
                title=f"📧 New message from {classification.provider_name or 'vendor'}",
                message=f"OPERATIONAL: {email_subject[:80]}",
                priority="high",
                action_url="/providers",
            )

        elif classification.category == "PROMO":
            # Check email age — skip digest accumulation for stale emails (premortem R-06)
            is_stale = self._is_stale(received_at_str)
            await self._handle_promo(payload, classification, restaurant_id, is_stale)

    # =========================================================================
    # GEMINI FLASH CLASSIFICATION
    # =========================================================================

    async def _classify_email(self, subject: str, body: str) -> EmailClassification:
        from google.genai import types as genai_types

        gemini = get_gemini_client()
        prompt = (
            "You are an email classifier for a fine-dining restaurant beverage procurement system.\n"
            "Classify this vendor email as OPERATIONAL, PROMO, or NOISE.\n"
            "OPERATIONAL = order confirmations, invoices, delivery updates, account notices, supply issues\n"
            "PROMO = discounts, deals, limited-time offers, allocation announcements, price specials\n"
            "NOISE = newsletters, surveys, automated receipts, marketing with no specific offer\n\n"
            f"Subject: {subject}\n\nBody:\n{body}\n\n"
            'Respond ONLY with valid JSON: {"category": "...", "confidence": 0.0-1.0, '
            '"reasoning": "...", "provider_name": "...", "urgency": "low|medium|high"}'
        )
        response = gemini.models.generate_content(
            model=self.settings.gemini_model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                safety_settings=[
                    genai_types.SafetySetting(
                        category="HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold="BLOCK_ONLY_HIGH",
                    ),
                    genai_types.SafetySetting(
                        category="HARM_CATEGORY_HARASSMENT",
                        threshold="BLOCK_ONLY_HIGH",
                    ),
                    genai_types.SafetySetting(
                        category="HARM_CATEGORY_HATE_SPEECH",
                        threshold="BLOCK_ONLY_HIGH",
                    ),
                    genai_types.SafetySetting(
                        category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold="BLOCK_ONLY_HIGH",
                    ),
                ],
            ),
        )
        raw = response.text or "{}"
        data = json.loads(raw)
        return EmailClassification(**data)

    # =========================================================================
    # PROMO HANDLING: EXTRACT + SCORE + INSERT + DIGEST
    # =========================================================================

    async def _handle_promo(
        self,
        payload: Dict[str, Any],
        classification: EmailClassification,
        restaurant_id: str,
        is_stale: bool,
    ) -> None:
        email_body = (payload.get("body") or payload.get("snippet") or "")[:8192]
        email_subject = payload.get("subject", "")
        provider_id = payload.get("provider_id")
        vendor_email = payload.get("from_email", "")

        # Haiku extraction gated by semaphore (AI-SPEC §3, T-24-04-03)
        async with self.haiku_semaphore:
            details = await self._extract_promo(email_subject, email_body)

        # Dedup check: SHA256(vendor_email + product_name + today)
        today_str = date.today().isoformat()
        raw_hash = f"{vendor_email}{details.product_name}{today_str}"
        dedup_hash = hashlib.sha256(raw_hash.encode()).hexdigest()

        try:
            existing = (
                self.database.supabase.table("vendor_promotions")
                .select("id")
                .eq("dedup_hash", dedup_hash)
                .execute()
            )
            if existing.data:
                self.logger.info(f"Suppressing duplicate promo: {dedup_hash[:16]}")
                return
        except Exception as e:
            self.logger.warning(f"Dedup check failed (proceeding): {e}")

        # Urgency score (D-16)
        urgency_score = await self._compute_urgency_score(
            restaurant_id, details.grape_variety, classification
        )

        # Calendar link (D-17)
        linked_event_ids = await self._find_linked_events(
            restaurant_id, details.grape_variety, details.region
        )

        # Cross-vendor price (D-18 — restaurant_inventory, NOT order_items.wine_id)
        last_price = await self._get_last_purchase_price(restaurant_id, details.grape_variety)

        # Insert to vendor_promotions
        insert_data: Dict[str, Any] = {
            "provider_id": provider_id,
            "restaurant_id": restaurant_id,
            "detected_from_email_subject": email_subject[:500],
            "product_name": details.product_name,
            "grape_variety": details.grape_variety,
            "region": details.region,
            "discount_pct": details.discount_pct,
            "discount_fixed": details.discount_fixed,
            "valid_until": details.valid_until,
            "promo_description": details.promo_description,
            "conditions": details.conditions,
            "min_quantity": details.min_quantity,
            "dedup_hash": dedup_hash,
            "urgency_score": float(urgency_score),
            "linked_event_ids": linked_event_ids,
            "last_comparison_price": last_price,
            "status": "active",
        }
        promo_id: Optional[str] = None
        try:
            result = (
                self.database.supabase.table("vendor_promotions")
                .insert(insert_data)
                .execute()
            )
            promo_id = result.data[0]["id"] if result.data else None
        except Exception as e:
            self.logger.error(f"vendor_promotions insert failed: {e}")
            raise

        # Redis digest accumulation — skip for stale emails per R-06 (STALE_EMAIL_HOURS check)
        if not is_stale and self.redis:
            try:
                digest_key = f"digest:{restaurant_id}:{today_str}"
                item = json.dumps(
                    {
                        "vendor": classification.provider_name or "",
                        "product": details.product_name,
                        "discount_pct": details.discount_pct,
                        "urgency_score": urgency_score,
                        "promo_id": str(promo_id) if promo_id else None,
                    }
                )
                pipe = self.redis.pipeline()
                pipe.lpush(digest_key, item)
                pipe.expire(digest_key, 36 * 3600)  # 36h TTL per D-09
                await pipe.execute()
            except Exception as e:
                self.logger.warning(f"Redis digest accumulation failed (non-critical): {e}")

        # In-app notification (D-03 — direct Supabase INSERT, NOT HTTP to NestJS)
        title = f"🏷️ Deal: {details.product_name}"
        if details.discount_pct:
            title += f" at {details.discount_pct}% off"
        if classification.provider_name:
            title += f" from {classification.provider_name}"

        await self._notify(
            restaurant_id=restaurant_id,
            notification_type="email_classified_promo",
            title=title,
            message=(details.promo_description or "")[:200],
            priority="medium",
            action_url="/providers",
            metadata={"promo_id": str(promo_id), "provider_id": provider_id},
        )

    # =========================================================================
    # HAIKU EXTRACTION
    # =========================================================================

    async def _extract_promo(self, subject: str, body: str) -> PromoDetails:
        haiku = get_haiku_client()
        prompt = (
            "Extract structured deal information from this promotional wine vendor email.\n"
            "Return ONLY values EXPLICITLY stated in the email — do NOT infer, estimate, or fabricate values.\n"
            "Return valid JSON with fields: product_name, grape_variety, region, discount_pct, "
            "discount_fixed, valid_until (ISO date or null), min_quantity, promo_description, "
            "conditions, confidence (0.0-1.0)\n\n"
            f"Subject: {subject}\n\nBody:\n{body}"
        )
        response = await haiku.messages.create(
            model=self.settings.haiku_model,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text if response.content else "{}"
        # Strip markdown code fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw.strip())
        return PromoDetails(**data)

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _is_stale(self, received_at_str: Optional[Any]) -> bool:
        """Returns True if email is older than STALE_EMAIL_HOURS (premortem R-06)."""
        if not received_at_str:
            return False
        try:
            # Handle epoch-millisecond timestamps from Gmail internalDate
            if isinstance(received_at_str, (int, float)) or (
                isinstance(received_at_str, str) and received_at_str.isdigit()
            ):
                epoch_ms = int(received_at_str)
                received_dt = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)
            else:
                received_dt = datetime.fromisoformat(
                    str(received_at_str).replace("Z", "+00:00")
                )
                if received_dt.tzinfo is None:
                    received_dt = received_dt.replace(tzinfo=timezone.utc)
            cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=STALE_EMAIL_HOURS)
            return received_dt < cutoff
        except Exception:
            return False

    async def _compute_urgency_score(
        self,
        restaurant_id: str,
        grape_variety: Optional[str],
        classification: EmailClassification,
    ) -> float:
        """
        Urgency score formula (D-16):
          fit_map: STRONG_FIT=1.0, PARTIAL_FIT=0.6, NO_FIT=0.0, PENDING=0.3
          urgency = round(min(10.0, fit_score * stock_factor * calendar_prox * 10), 1)
          stock_factor = max(0.0, 1.0 - stock_live / (threshold_min * 2))
          calendar_prox = 1.0 (≤3d), 0.8 (≤7d), 0.5 (≤14d), 0.2 (≤30d), 0.1 (no event)
        """
        # Default: PARTIAL_FIT for PROMO emails without explicit inventory fit
        fit_score = 0.6

        # stock_factor from restaurant_inventory
        stock_live = 0
        threshold_min = 1
        try:
            inv_result = (
                self.database.supabase.table("restaurant_inventory")
                .select("stock_live, threshold_min, master_wine_library!inner(grape_variety)")
                .eq("restaurant_id", restaurant_id)
                .not_.is_("stock_live", "null")
                .limit(1)
                .execute()
            )
            if inv_result.data and grape_variety:
                for row in inv_result.data:
                    mwl = row.get("master_wine_library") or {}
                    if isinstance(mwl, dict) and (
                        grape_variety.lower() in (mwl.get("grape_variety") or "").lower()
                    ):
                        stock_live = row.get("stock_live", 0) or 0
                        threshold_min = max(1, row.get("threshold_min", 1) or 1)
                        break
        except Exception as e:
            self.logger.debug(f"stock_factor query failed (using defaults): {e}")

        stock_factor = max(0.0, 1.0 - stock_live / (threshold_min * 2))

        # calendar_prox: how soon is the nearest upcoming wine event?
        calendar_prox = 0.1  # default: no upcoming event
        try:
            today = date.today()
            future_30 = (today + timedelta(days=30)).isoformat()
            cal_result = (
                self.database.supabase.table("calendar_events")
                .select("event_date")
                .in_("event_type", WINE_EVENT_TYPES)
                .eq("restaurant_id", restaurant_id)
                .eq("status", "approved")
                .gte("event_date", today.isoformat())
                .lte("event_date", future_30)
                .order("event_date", desc=False)
                .limit(1)
                .execute()
            )
            if cal_result.data:
                nearest_date = date.fromisoformat(cal_result.data[0]["event_date"][:10])
                days_away = (nearest_date - today).days
                if days_away <= 3:
                    calendar_prox = 1.0
                elif days_away <= 7:
                    calendar_prox = 0.8
                elif days_away <= 14:
                    calendar_prox = 0.5
                elif days_away <= 30:
                    calendar_prox = 0.2
        except Exception as e:
            self.logger.debug(f"calendar_prox query failed (using default 0.1): {e}")

        urgency = round(min(10.0, fit_score * stock_factor * calendar_prox * 10), 1)
        return urgency

    async def _find_linked_events(
        self,
        restaurant_id: str,
        grape_variety: Optional[str],
        region: Optional[str],
    ) -> List[str]:
        """
        Calendar link (D-17): calendar_events WHERE event_type IN WINE_EVENT_TYPES
        OR description ILIKE '%{grape_variety}%' AND event_date BETWEEN today AND today+30
        AND status='approved'. Returns list of event UUIDs.
        """
        event_ids: List[str] = []
        try:
            today = date.today()
            future_30 = (today + timedelta(days=30)).isoformat()

            # Primary: match by wine-related event_type
            type_result = (
                self.database.supabase.table("calendar_events")
                .select("id")
                .eq("restaurant_id", restaurant_id)
                .eq("status", "approved")
                .in_("event_type", WINE_EVENT_TYPES)
                .gte("event_date", today.isoformat())
                .lte("event_date", future_30)
                .limit(10)
                .execute()
            )
            for row in type_result.data or []:
                if row.get("id"):
                    event_ids.append(row["id"])

            # Secondary: description text match on grape_variety (D-17 — no wine_requirements column)
            if grape_variety and len(event_ids) < 10:
                text_result = (
                    self.database.supabase.table("calendar_events")
                    .select("id")
                    .eq("restaurant_id", restaurant_id)
                    .eq("status", "approved")
                    .ilike("description", f"%{grape_variety}%")
                    .gte("event_date", today.isoformat())
                    .lte("event_date", future_30)
                    .limit(10)
                    .execute()
                )
                for row in text_result.data or []:
                    eid = row.get("id")
                    if eid and eid not in event_ids:
                        event_ids.append(eid)
        except Exception as e:
            self.logger.debug(f"Calendar link query failed (returning empty): {e}")

        return event_ids

    async def _get_last_purchase_price(
        self,
        restaurant_id: str,
        grape_variety: Optional[str],
    ) -> Optional[float]:
        """
        Cross-vendor price query (D-18): uses restaurant_inventory JOIN master_wine_library.
        NOTE: order_items.wine_id is VARCHAR not UUID — use restaurant_inventory instead (D-18 correction).
        """
        if not grape_variety:
            return None
        try:
            result = (
                self.database.supabase.table("restaurant_inventory")
                .select("last_purchase_price, master_wine_library!inner(grape_variety)")
                .eq("restaurant_id", restaurant_id)
                .not_.is_("last_purchase_price", "null")
                .order("updated_at", desc=True)
                .limit(10)
                .execute()
            )
            for row in result.data or []:
                mwl = row.get("master_wine_library") or {}
                if isinstance(mwl, dict):
                    variety = (mwl.get("grape_variety") or "").lower()
                    if grape_variety.lower() in variety or variety in grape_variety.lower():
                        price = row.get("last_purchase_price")
                        if price is not None:
                            return float(price)
        except Exception as e:
            self.logger.debug(f"last_purchase_price query failed: {e}")
        return None

    async def _link_sent_email(self, payload: Dict[str, Any]) -> None:
        """Link a SENT (outbound) email to existing procurement_conversations by gmail_thread_id."""
        gmail_thread_id = payload.get("gmail_thread_id", "")
        if not gmail_thread_id:
            return
        try:
            self.database.supabase.table("procurement_conversations").update(
                {"gmail_thread_id": gmail_thread_id}
            ).eq("gmail_thread_id", gmail_thread_id).execute()
        except Exception as e:
            self.logger.debug(f"_link_sent_email failed (non-critical): {e}")

    async def _notify(
        self,
        restaurant_id: str,
        notification_type: str,
        title: str,
        message: str,
        priority: str = "medium",
        action_url: str = "/providers",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Insert in-app notification directly to Supabase notifications table (D-03).
        NOT an HTTP call to NestJS NotificationsService — direct DB insert per RESEARCH.md Q2.
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
                "is_read": False,
            }
            if metadata:
                insert_payload["metadata"] = metadata
            self.database.supabase.table("notifications").insert(insert_payload).execute()
        except Exception as e:
            self.logger.warning(f"Notification insert failed (non-critical): {e}")
