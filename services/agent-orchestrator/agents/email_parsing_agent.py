"""
Email Parsing Agent
====================
Processes inbound emails from vendors:
1. Thread matching via In-Reply-To / References headers
2. Context matching via LLM for new (non-reply) emails
3. Stores messages in procurement_conversations with threading
4. Generates and updates conversation summaries via Gemini Pro
5. Routes matched messages to ProcurementAgent
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple

from core.base_agent import BaseAgent
from core.message_bus import BaseEvent, EventPriority
from core.database import DatabaseClient
from utils.logger import setup_logger

logger = setup_logger("email_parsing_agent")

# Try to import Gemini for summarization
try:
    import google.generativeai as genai

    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("google-generativeai not installed — LLM summarization disabled")


class EmailParsingAgent(BaseAgent):
    """
    Subscribes to email.events / email.inbound.received
    Processes inbound vendor emails with header-based and LLM-based matching.
    """

    def __init__(self, message_bus, db: DatabaseClient, config: dict = None):
        super().__init__(
            agent_name="email_parsing_agent",
            message_bus=message_bus,
            db=db,
            config=config or {},
        )
        self.gemini_model = None

    async def initialize(self) -> None:
        """Set up Gemini model for context matching and summarization"""
        if GEMINI_AVAILABLE:
            api_key = self.config.get("google_api_key") or ""
            if api_key:
                genai.configure(api_key=api_key)
                self.gemini_model = genai.GenerativeModel("gemini-pro")
                self.logger.info("Gemini Pro initialized for email parsing")
            else:
                self.logger.warning("GOOGLE_API_KEY not set — LLM features disabled")

    def get_subscribed_routing_keys(self) -> List[Tuple[str, str]]:
        return [
            ("email.events", "email.inbound.received"),
        ]

    async def process_message(self, routing_key: str, payload: Dict[str, Any]) -> None:
        """Main message handler"""
        if routing_key == "email.inbound.received":
            await self._process_inbound_email(payload)
        else:
            self.logger.warning(f"Unknown routing key: {routing_key}")

    # ── Core Processing ──────────────────────────────────────────────

    async def _process_inbound_email(self, payload: Dict[str, Any]) -> None:
        """Process a single inbound email"""
        sender = payload.get("from", "")
        subject = payload.get("subject", "")
        body = payload.get("body", "")
        message_id_header = payload.get("message_id_header", "")
        in_reply_to = payload.get("in_reply_to", "")
        references = payload.get("references", "")
        gmail_message_id = payload.get("gmail_message_id", "")
        gmail_thread_id = payload.get("gmail_thread_id", "")
        received_at = payload.get("received_at", datetime.utcnow().isoformat())
        headers = payload.get("headers", {})

        self.logger.info(f"Processing inbound email: from={sender}, subject={subject}")

        # Extract sender email address from "Name <email>" format
        sender_email = self._extract_email(sender)
        if not sender_email:
            self.logger.warning(f"Could not extract email from sender: {sender}")
            return

        # Step 1: Try thread matching (gmail_thread_id first, then headers)
        matched_order_id = None
        matched_thread_id = None
        parent_db_id = None
        confidence = 1.0
        match_method = "none"

        # Step 1a: Match by Gmail thread ID — most reliable since we store it on send
        if gmail_thread_id:
            match_result = await self._match_by_gmail_thread_id(gmail_thread_id)
            if match_result:
                matched_order_id = match_result["order_id"]
                matched_thread_id = match_result["thread_id"]
                parent_db_id = match_result["parent_id"]
                confidence = 1.0
                match_method = "gmail_thread"
                self.logger.info(
                    f"Gmail thread match: order={matched_order_id}, thread={matched_thread_id}"
                )

        # Step 1b: Fall back to In-Reply-To / References header matching
        if not matched_order_id and (in_reply_to or references):
            match_result = await self._match_by_headers(in_reply_to, references)
            if match_result:
                matched_order_id = match_result["order_id"]
                matched_thread_id = match_result["thread_id"]
                parent_db_id = match_result["parent_id"]
                confidence = 1.0
                match_method = "header"
                self.logger.info(
                    f"Header match: order={matched_order_id}, thread={matched_thread_id}"
                )

        # Step 2: If no header match, try LLM context matching
        if not matched_order_id:
            match_result = await self._match_by_context(sender_email, subject, body)
            if match_result:
                matched_order_id = match_result["order_id"]
                confidence = match_result["confidence"]
                match_method = "llm_context"
                self.logger.info(
                    f"LLM context match: order={matched_order_id}, confidence={confidence}"
                )

        # Step 3: Determine provider
        provider_id = await self._find_provider_by_email(sender_email)

        # Step 4: Assign thread_id
        if not matched_thread_id:
            if matched_order_id:
                # Check if there's an existing thread for this order
                existing = await self._find_thread_for_order(matched_order_id)
                if existing:
                    matched_thread_id = existing
                else:
                    matched_thread_id = str(uuid.uuid4())
            else:
                matched_thread_id = str(uuid.uuid4())

        # Step 5: Determine restaurant_id from provider or order
        restaurant_id = await self._get_restaurant_id(matched_order_id, provider_id)

        # Step 6: Detect intent
        detected_intent = await self._detect_intent(subject, body)

        # Step 6b: Store in procurement_conversations
        conversation_data = {
            "order_id": matched_order_id,
            "restaurant_id": restaurant_id,
            "provider_id": provider_id,
            "direction": "inbound",
            "channel": "email",
            "message_text": f"Subject: {subject}\n\n{body}",
            "ai_generated": False,
            "detected_intent": detected_intent,
            "detected_sentiment": "neutral",
            "received_at": received_at,
            "delivery_status": "delivered",
            "thread_id": matched_thread_id,
            "message_id": message_id_header,
            "parent_message_id": parent_db_id,
            "email_headers": json.dumps({
                "from": sender,
                "subject": subject,
                "message_id": message_id_header,
                "in_reply_to": in_reply_to,
                "references": references,
                "gmail_message_id": gmail_message_id,
                "gmail_thread_id": gmail_thread_id,
            }),
            "confidence_score": confidence,
        }

        try:
            result = await self.db.supabase.table("procurement_conversations").insert(
                conversation_data
            ).execute()
            self.logger.info(f"Stored inbound email as conversation (match={match_method})")
        except Exception as e:
            self.logger.error(f"Failed to store conversation: {e}")
            return

        # Step 7: Generate/update thread summary
        if matched_thread_id:
            await self._generate_thread_summary(matched_thread_id, restaurant_id)

        # Step 8: Route to ProcurementAgent if matched with high confidence
        if matched_order_id and confidence >= 0.7:
            await self._route_to_procurement(
                matched_order_id, provider_id, restaurant_id, subject, body
            )

        # Step 9: Notify frontend
        if restaurant_id:
            await self._notify_frontend(
                restaurant_id, matched_order_id, provider_id, subject, confidence
            )

        # Step 10: Scarcity auto-reply — vendor says stock is limited
        if detected_intent == "scarcity_urgency" and provider_id:
            self.logger.info(f"Scarcity detected from {sender_email} — triggering auto-hold")
            try:
                # Look up wine_name from the matched order
                wine_name = ""
                if matched_order_id:
                    try:
                        order_row = await self.db.supabase.table("procurement_orders") \
                            .select("wine_name").eq("id", matched_order_id).single().execute()
                        wine_name = (order_row.data or {}).get("wine_name", "")
                    except Exception:
                        pass

                await self.message_bus.publish(
                    "conversation.events",
                    "conversation.auto_reply.urgency",
                    {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "order_id": matched_order_id,
                        "wine_name": wine_name,
                        "subject": subject,
                        "body": body[:500],
                        "sender": sender_email,
                    },
                    priority=EventPriority.CRITICAL,
                )
            except Exception as e:
                self.logger.error(f"Failed to publish scarcity auto-reply: {e}")

        # Low confidence — flag for manager review
        if matched_order_id and confidence < 0.7:
            self.logger.info(
                f"Low confidence match ({confidence}) — flagging for manager review"
            )
            await self._flag_for_review(
                restaurant_id, matched_order_id, provider_id, subject, confidence
            )

    # ── Header-Based Thread Matching ──────────────────────────────────

    async def _match_by_gmail_thread_id(
        self, gmail_thread_id: str
    ) -> Optional[Dict[str, Any]]:
        """Match by Gmail thread ID stored on the outbound conversation row"""
        try:
            result = await self.db.supabase.table("procurement_conversations").select(
                "id, order_id, thread_id"
            ).eq("gmail_thread_id", gmail_thread_id).limit(1).execute()
            if result.data:
                row = result.data[0]
                return {
                    "order_id": row.get("order_id"),
                    "thread_id": row.get("thread_id"),
                    "parent_id": row.get("id"),
                }
        except Exception as e:
            self.logger.error(f"Gmail thread ID match lookup failed: {e}")
        return None

    async def _match_by_headers(
        self, in_reply_to: str, references: str
    ) -> Optional[Dict[str, Any]]:
        """Match by In-Reply-To or References headers"""
        # Parse reference IDs
        ref_ids = []
        if in_reply_to:
            ref_ids.append(in_reply_to.strip())
        if references:
            ref_ids.extend(references.strip().split())

        if not ref_ids:
            return None

        # Look up each reference in our stored message_ids
        for ref_id in ref_ids:
            try:
                result = await self.db.supabase.table("procurement_conversations").select(
                    "id, order_id, thread_id"
                ).eq("message_id", ref_id).limit(1).execute()

                if result.data:
                    row = result.data[0]
                    return {
                        "order_id": row.get("order_id"),
                        "thread_id": row.get("thread_id"),
                        "parent_id": row.get("id"),
                    }
            except Exception as e:
                self.logger.error(f"Header match lookup failed: {e}")

        return None

    # ── LLM Context Matching ─────────────────────────────────────────

    async def _match_by_context(
        self, sender_email: str, subject: str, body: str
    ) -> Optional[Dict[str, Any]]:
        """Use LLM to match a new email to an existing order by context"""
        if not self.gemini_model:
            # Fallback: try simple keyword matching
            return await self._simple_keyword_match(sender_email, subject, body)

        # Load active orders for this sender's provider
        provider_id = await self._find_provider_by_email(sender_email)
        if not provider_id:
            return None

        try:
            orders_result = await self.db.supabase.table("procurement_orders").select(
                "id, wine_name, quantity, status, notes, created_at"
            ).eq("provider_id", provider_id).in_(
                "status", ["pending", "approved", "ordered", "negotiating"]
            ).order("created_at", desc=True).limit(10).execute()

            if not orders_result.data:
                return None

            # Build context for LLM
            orders_context = "\n".join(
                f"- Order {o['id'][:8]}: {o['wine_name']} x{o['quantity']} ({o['status']})"
                for o in orders_result.data
            )

            prompt = f"""You are an email classification system for a restaurant wine ordering platform.

A vendor ({sender_email}) sent this email:
Subject: {subject}
Body: {body[:1000]}

Active orders with this vendor:
{orders_context}

Which order is this email most likely about? Respond with ONLY valid JSON:
{{
  "order_id": "the matching order ID or null if none match",
  "confidence": 0.0 to 1.0,
  "intent": "confirmation|price_update|delivery_update|question|rejection|general",
  "reasoning": "brief explanation"
}}"""

            response = await self.gemini_model.generate_content_async(prompt)
            text = response.text.strip()

            # Extract JSON from response
            json_match = re.search(r"\{[^}]+\}", text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group())
                order_id = parsed.get("order_id")
                conf = float(parsed.get("confidence", 0.0))

                if order_id and order_id != "null" and conf > 0.3:
                    # Verify the order_id exists
                    for o in orders_result.data:
                        if o["id"].startswith(order_id) or order_id in o["id"]:
                            return {
                                "order_id": o["id"],
                                "confidence": conf,
                                "intent": parsed.get("intent", "general"),
                            }

            return None

        except Exception as e:
            self.logger.error(f"LLM context matching failed: {e}")
            return await self._simple_keyword_match(sender_email, subject, body)

    async def _simple_keyword_match(
        self, sender_email: str, subject: str, body: str
    ) -> Optional[Dict[str, Any]]:
        """Fallback: match by wine name keywords in subject/body"""
        provider_id = await self._find_provider_by_email(sender_email)
        if not provider_id:
            return None

        try:
            orders = await self.db.supabase.table("procurement_orders").select(
                "id, wine_name"
            ).eq("provider_id", provider_id).in_(
                "status", ["pending", "approved", "ordered", "negotiating"]
            ).execute()

            text = f"{subject} {body}".lower()
            for order in orders.data or []:
                wine_name = (order.get("wine_name") or "").lower()
                if wine_name and any(
                    word in text for word in wine_name.split() if len(word) > 3
                ):
                    return {"order_id": order["id"], "confidence": 0.6}

            return None
        except Exception:
            return None

    # ── Thread Summarization ─────────────────────────────────────────

    async def _generate_thread_summary(self, thread_id: str, restaurant_id: Optional[str] = None) -> None:
        """Generate an AI summary of the entire conversation thread"""
        try:
            # Load all messages in the thread
            result = await self.db.supabase.table("procurement_conversations").select(
                "id, direction, channel, message_text, sent_at, received_at, created_at"
            ).eq("thread_id", thread_id).order("created_at", asc=True).execute()

            messages = result.data or []
            if len(messages) < 2:
                return  # Not enough messages for a summary

            # Build transcript
            transcript_lines = []
            for msg in messages:
                direction = "Restaurant -> Vendor" if msg["direction"] == "outbound" else "Vendor -> Restaurant"
                timestamp = msg.get("sent_at") or msg.get("received_at") or msg.get("created_at", "")
                if timestamp:
                    timestamp = timestamp[:19]  # trim to YYYY-MM-DDTHH:MM:SS
                text = (msg.get("message_text") or "").strip()
                if len(text) > 500:
                    text = text[:500] + "..."
                transcript_lines.append(
                    f"[{timestamp}] {direction} ({msg.get('channel', 'email')}):\n{text}"
                )

            transcript = "\n\n".join(transcript_lines)

            if not self.gemini_model:
                # Simple fallback summary
                summary = f"Conversation thread with {len(messages)} messages. Latest: {messages[-1].get('message_text', '')[:200]}"
            else:
                prompt = f"""Summarize this vendor-restaurant conversation thread. Extract key information:

{transcript}

Respond with ONLY valid JSON:
{{
  "summary": "2-3 sentence natural language summary",
  "outcome": "ongoing|agreed|rejected|pending",
  "agreed_price": null or number,
  "agreed_quantity": null or number,
  "expected_delivery": null or "YYYY-MM-DD",
  "negotiation_rounds": {len(messages)},
  "sentiment": "positive|neutral|negative"
}}"""

                try:
                    response = await self.gemini_model.generate_content_async(prompt)
                    text = response.text.strip()
                    json_match = re.search(r"\{[^}]+\}", text, re.DOTALL)
                    if json_match:
                        parsed = json.loads(json_match.group())
                        summary = parsed.get("summary", "Summary generation failed")
                        # Include structured data in summary
                        outcome = parsed.get("outcome", "ongoing")
                        price = parsed.get("agreed_price")
                        qty = parsed.get("agreed_quantity")
                        delivery = parsed.get("expected_delivery")
                        sentiment = parsed.get("sentiment", "neutral")

                        parts = [summary]
                        if outcome:
                            parts.append(f"Outcome: {outcome}")
                        if price:
                            parts.append(f"Price: ${price}/bottle")
                        if qty:
                            parts.append(f"Quantity: {qty}")
                        if delivery:
                            parts.append(f"Delivery: {delivery}")
                        parts.append(f"Sentiment: {sentiment}")
                        summary = " | ".join(parts)
                    else:
                        summary = f"Thread with {len(messages)} messages. Unable to generate structured summary."
                except Exception as e:
                    self.logger.error(f"LLM summary generation failed: {e}")
                    summary = f"Thread with {len(messages)} messages."

            # Update all messages in the thread with the summary
            now = datetime.utcnow().isoformat()
            await self.db.supabase.table("procurement_conversations").update({
                "conversation_summary": summary,
                "summary_updated_at": now,
            }).eq("thread_id", thread_id).execute()

            self.logger.info(f"Thread summary updated for {thread_id} ({len(messages)} messages)")

            # Publish summary update event
            try:
                await self.message_bus.publish(
                    "conversation.events",
                    "conversation.summary.updated",
                    {
                        "thread_id": thread_id,
                        "restaurant_id": restaurant_id,
                        "message_count": len(messages),
                        "summary": summary[:500],
                        "updated_at": now,
                    },
                    priority=EventPriority.NORMAL,
                )
            except Exception:
                pass  # Non-critical

        except Exception as e:
            self.logger.error(f"Thread summary generation failed: {e}")

    # ── Helper Methods ───────────────────────────────────────────────

    def _extract_email(self, from_header: str) -> Optional[str]:
        """Extract email address from 'Name <email>' format"""
        match = re.search(r"<([^>]+)>", from_header)
        if match:
            return match.group(1).lower()
        if "@" in from_header:
            return from_header.strip().lower()
        return None

    async def _find_provider_by_email(self, email: str) -> Optional[str]:
        """Find provider ID by contact email"""
        try:
            # Search in primary_contact JSONB
            result = await self.db.supabase.rpc(
                "find_provider_by_email", {"search_email": email}
            ).execute()
            if result.data:
                return result.data[0].get("id")

            # Fallback: search contact_email column directly
            result = await self.db.supabase.table("providers").select(
                "id, contact_email"
            ).ilike("contact_email", email).limit(1).execute()
            if result.data:
                return result.data[0].get("id")
            return None
        except Exception:
            return None

    async def _find_thread_for_order(self, order_id: str) -> Optional[str]:
        """Find existing thread_id for an order"""
        try:
            result = await self.db.supabase.table("procurement_conversations").select(
                "thread_id"
            ).eq("order_id", order_id).not_.is_("thread_id", "null").limit(1).execute()
            if result.data:
                return result.data[0].get("thread_id")
            return None
        except Exception:
            return None

    async def _get_restaurant_id(
        self, order_id: Optional[str], provider_id: Optional[str]
    ) -> Optional[str]:
        """Get restaurant_id from order or provider"""
        if order_id:
            try:
                result = await self.db.supabase.table("procurement_orders").select(
                    "restaurant_id"
                ).eq("id", order_id).limit(1).execute()
                if result.data:
                    return result.data[0].get("restaurant_id")
            except Exception:
                pass
        # Fallback to config
        return self.config.get("default_restaurant_id")

    async def _detect_intent(self, subject: str, body: str) -> str:
        """Intent detection with scarcity/urgency awareness"""
        text = f"{subject} {body}".lower()

        # Scarcity / urgency signals (checked first — time-sensitive)
        scarcity_patterns = [
            r"only \d+ left",
            r"limited stock",
            r"selling out",
            r"last batch",
            r"running low",
            r"almost gone",
            r"few remaining",
            r"won'?t last",
            r"about to sell out",
            r"limited availability",
            r"last \d+ (bottles|cases)",
            r"going fast",
        ]
        if any(re.search(p, text) for p in scarcity_patterns):
            return "scarcity_urgency"

        if any(w in text for w in ["confirm", "approved", "agreed", "accept", "deal"]):
            return "confirmation"
        if any(w in text for w in ["price", "cost", "quote", "offer", "$"]):
            return "price_update"
        if any(w in text for w in ["deliver", "ship", "tracking", "arriving", "eta"]):
            return "delivery_update"
        if any(w in text for w in ["question", "?", "clarif", "wondering"]):
            return "question"
        if any(w in text for w in ["cancel", "reject", "unable", "sorry", "cannot"]):
            return "rejection"
        return "general"

    async def _route_to_procurement(
        self,
        order_id: str,
        provider_id: Optional[str],
        restaurant_id: Optional[str],
        subject: str,
        body: str,
    ) -> None:
        """Route matched email to ProcurementAgent"""
        try:
            await self.message_bus.publish(
                "procurement.events",
                "procurement.vendor_response",
                {
                    "order_id": order_id,
                    "provider_id": provider_id,
                    "restaurant_id": restaurant_id,
                    "channel": "email",
                    "subject": subject,
                    "body": body[:2000],
                    "source": "email_parsing_agent",
                },
                priority=EventPriority.HIGH,
            )
        except Exception as e:
            self.logger.error(f"Failed to route to procurement: {e}")

    async def _notify_frontend(
        self,
        restaurant_id: str,
        order_id: Optional[str],
        provider_id: Optional[str],
        subject: str,
        confidence: float,
    ) -> None:
        """Notify frontend of new inbound email"""
        try:
            await self.message_bus.publish(
                "notification.events",
                "notification.email_received",
                {
                    "restaurant_id": restaurant_id,
                    "order_id": order_id,
                    "provider_id": provider_id,
                    "subject": subject,
                    "confidence": confidence,
                    "type": "vendor_email",
                    "title": f"New vendor email: {subject[:80]}",
                    "message": f"Received email from vendor (matched with {confidence:.0%} confidence)",
                },
                priority=EventPriority.NORMAL,
            )
        except Exception as e:
            self.logger.error(f"Failed to notify frontend: {e}")

    async def _flag_for_review(
        self,
        restaurant_id: Optional[str],
        order_id: str,
        provider_id: Optional[str],
        subject: str,
        confidence: float,
    ) -> None:
        """Flag low-confidence matches for manager review"""
        try:
            await self.message_bus.publish(
                "notification.events",
                "notification.review_required",
                {
                    "restaurant_id": restaurant_id,
                    "order_id": order_id,
                    "provider_id": provider_id,
                    "type": "email_match_review",
                    "title": f"Review needed: {subject[:60]}",
                    "message": f"Inbound email matched with low confidence ({confidence:.0%}). Please verify the match.",
                    "priority": "high",
                },
                priority=EventPriority.HIGH,
            )
        except Exception as e:
            self.logger.error(f"Failed to flag for review: {e}")
