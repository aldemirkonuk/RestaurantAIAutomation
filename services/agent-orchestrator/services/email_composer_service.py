"""
EmailComposerService — AI-Powered Email Composition for Vendor Communication

Responsibilities:
- Template tag resolution ({{vendor_name}}, {{wine_name}}, etc.)
- Style evolution: adapts tone/formality to match each vendor's communication patterns
- LLM-powered email body generation via Gemini
- HTML wrapping for outbound vendor emails
- Sends via NestJS API Gateway (Gmail API) for threading support
"""

from __future__ import annotations

import json
import re
import statistics
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field

import aiohttp

from utils.logger import setup_logger
from config.settings import get_settings

logger = setup_logger("email_composer_service")


def _format_wine_name_with_volume(wine_name: str, bottle_size_ml: Optional[Any]) -> str:
    """Append bottle format to wine name: 'Barolo 2019' -> 'Barolo 2019 (750ml)', 1500 -> '... (1.5L)'."""
    if not wine_name:
        return wine_name
    if bottle_size_ml is None or bottle_size_ml <= 0:
        return wine_name
    try:
        ml = int(float(bottle_size_ml))
        if ml >= 1000 and ml % 100 == 0:
            vol = f"{ml // 1000}L"
        else:
            vol = f"{ml}ml"
        return f"{wine_name} ({vol})"
    except (ValueError, TypeError):
        return wine_name


try:
    import google.generativeai as genai

    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("google-generativeai not installed — LLM composition disabled")


@dataclass
class EmailPayload:
    """Structured email ready for sending"""

    to: List[str]
    subject: str
    body_html: str
    body_text: str
    reply_to: Optional[str] = None
    thread_id: Optional[str] = None
    in_reply_to: Optional[str] = None
    references: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class StyleProfile:
    """Learned communication style for a vendor"""

    formality: str = "professional"  # casual, professional, formal
    avg_sentence_length: float = 15.0
    greeting_style: str = "Hi {name},"
    signoff_style: str = "Best regards"
    uses_emoji: bool = False
    avg_paragraph_count: int = 3
    language: str = "en"
    tone_keywords: List[str] = field(
        default_factory=lambda: ["professional", "friendly"]
    )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StyleProfile":
        return cls(
            formality=data.get("formality", "professional"),
            avg_sentence_length=data.get("avg_sentence_length", 15.0),
            greeting_style=data.get("greeting_style", "Hi {name},"),
            signoff_style=data.get("signoff_style", "Best regards"),
            uses_emoji=data.get("uses_emoji", False),
            avg_paragraph_count=data.get("avg_paragraph_count", 3),
            language=data.get("language", "en"),
            tone_keywords=data.get("tone_keywords", ["professional", "friendly"]),
        )


TEMPLATE_TAGS = {
    "vendor_name",
    "vendor_contact_name",
    "restaurant_name",
    "wine_name",
    "quantity",
    "price_per_bottle",
    "total_amount",
    "order_id",
    "order_number",
    "delivery_date",
    "urgency",
    "manager_name",
    "manager_email",
    "manager_phone",
}

COMPOSE_SYSTEM_PROMPT = """You are composing an email from a restaurant wine buyer to a wine vendor/distributor.

PROVIDER INFO:
- Name: {vendor_name}
- Contact Person: {vendor_contact_name}

STYLE DIRECTIVES:
{style_directives}

CONVERSATION HISTORY (most recent first):
{conversation_history}

ORDER DETAILS:
- Wine: {wine_name}
- Quantity: {quantity}
- Target Price: {price_per_bottle}/bottle
{extra_context}

INTENT: {intent}

RULES:
- Start with the greeting: {greeting}
- Match the vendor's communication style (formality, length, tone)
- Reference specific past conversations naturally if relevant
- Be human and natural — not robotic or templated
- Include a clear next step or question
- Sign off with: {signoff}
- Keep it concise: {paragraph_target} paragraphs max
- Do NOT include a subject line — just the email body

Generate the email body:"""

STYLE_ANALYSIS_PROMPT = """Analyze this vendor's communication style from their emails.

VENDOR EMAILS:
{emails}

Return ONLY valid JSON:
{{
  "formality": "casual" | "professional" | "formal",
  "avg_sentence_length": number,
  "greeting_style": "their typical greeting pattern",
  "signoff_style": "their typical sign-off",
  "uses_emoji": true | false,
  "avg_paragraph_count": number,
  "language": "ISO 639-1 code",
  "tone_keywords": ["list", "of", "tone", "descriptors"]
}}"""


class EmailComposerService:
    """
    Composes AI-powered, style-adapted emails for vendor communication.

    Uses Gemini for body generation and style analysis.
    Sends via NestJS API Gateway for Gmail API threading.
    """

    def __init__(
        self,
        database,
        config: Dict[str, Any],
    ):
        self.database = database
        self.api_gateway_url = config.get("api_gateway_url", "http://localhost:3001")
        self.google_api_key = config.get("google_api_key")
        # gemini-2.0-flash was shut down 2026-06-01 (OD-57).
        self.llm_model_name = config.get("llm_model", get_settings().gemini_model)
        self.mock_mode = config.get("mock_mode", True)
        self.default_restaurant_name = config.get(
            "default_restaurant_name", "WineOps Restaurant"
        )

        self.llm_client = None
        if GEMINI_AVAILABLE and self.google_api_key and not self.mock_mode:
            try:
                genai.configure(api_key=self.google_api_key)
                self.llm_client = genai.GenerativeModel(self.llm_model_name)
                logger.info("EmailComposerService: Gemini initialized")
            except Exception as e:
                logger.error(f"EmailComposerService: Failed to init Gemini: {e}")

    # =========================================================================
    # PUBLIC API
    # =========================================================================

    async def compose_vendor_email(
        self,
        order: Dict[str, Any],
        provider: Dict[str, Any],
        conversation_history: List[Dict[str, Any]],
        intent: str = "order_inquiry",
        extra_context: str = "",
    ) -> EmailPayload:
        """
        Compose a full vendor email using LLM + style evolution.

        Args:
            order: Order data (wine_name, quantity, target_price, etc.)
            provider: Provider data (name, primary_contact, id)
            conversation_history: Recent messages from procurement_conversations
            intent: What we're trying to achieve (order_inquiry, price_negotiation, order_confirmation, invoice_request)
            extra_context: Additional context for the LLM
        """
        provider_id = provider.get("id", "")
        contact = provider.get("primary_contact", {}) or {}
        if isinstance(contact, str):
            try:
                contact = json.loads(contact)
            except Exception:
                contact = {}

        vendor_name = provider.get("name", "Vendor")
        vendor_contact_name = contact.get("name", vendor_name)
        vendor_email = contact.get("email", "")

        style = await self._load_or_analyze_style(provider_id, conversation_history)

        wine_name_raw = order.get("wine_name", "")
        bottle_ml = order.get("bottle_size_ml") or order.get("bottleSizeMl")
        wine_name = _format_wine_name_with_volume(wine_name_raw, bottle_ml)

        tags = {
            "vendor_name": vendor_name,
            "vendor_contact_name": vendor_contact_name,
            "restaurant_name": self.default_restaurant_name,
            "wine_name": wine_name,
            "quantity": order.get("quantity", ""),
            "price_per_bottle": f"${order.get('target_price_per_bottle', order.get('price_per_bottle', 'TBD'))}",
            "total_amount": self._calc_total(order),
            "order_id": order.get("id", ""),
            "order_number": order.get("order_number", order.get("id", "")[:8]),
            "delivery_date": order.get("expected_delivery_date", "TBD"),
            "urgency": order.get("urgency", "normal"),
        }

        body_text = await self._generate_body(
            tags=tags,
            style=style,
            conversation_history=conversation_history,
            intent=intent,
            extra_context=extra_context,
        )

        body_html = self._wrap_html(body_text, tags)

        subject = self._build_subject(intent, tags)

        thread_id, in_reply_to, references = self._resolve_threading(
            conversation_history
        )

        return EmailPayload(
            to=[vendor_email] if vendor_email else [],
            subject=subject,
            body_html=body_html,
            body_text=body_text,
            thread_id=thread_id,
            in_reply_to=in_reply_to,
            references=references,
            metadata={
                "provider_id": provider_id,
                "order_id": order.get("id"),
                "intent": intent,
                "tags_used": tags,
                "style_profile": {
                    "formality": style.formality,
                    "greeting": style.greeting_style,
                    "signoff": style.signoff_style,
                },
            },
        )

    async def compose_manager_review_email(
        self,
        order: Dict[str, Any],
        provider: Dict[str, Any],
        ai_drafted_message: str,
        conversation_id: str,
        urgency: str = "normal",
    ) -> EmailPayload:
        """Compose the manager review email with approve/edit/reject/ask buttons."""
        contact = provider.get("primary_contact", {}) or {}
        if isinstance(contact, str):
            try:
                contact = json.loads(contact)
            except Exception:
                contact = {}

        wine_name_raw = order.get("wine_name", "")
        bottle_ml = order.get("bottle_size_ml") or order.get("bottleSizeMl")
        wine_name = _format_wine_name_with_volume(wine_name_raw, bottle_ml)

        tags = {
            "vendor_name": provider.get("name", "Vendor"),
            "vendor_contact_name": contact.get("name", provider.get("name", "")),
            "wine_name": wine_name,
            "quantity": order.get("quantity", ""),
            "order_id": order.get("id", ""),
            "conversation_id": conversation_id,
            "urgency": urgency,
            "ai_message": ai_drafted_message,
        }

        subject = f"Review AI Draft: {tags['wine_name']} x{tags['quantity']} — {tags['vendor_name']}"

        html = self._build_manager_review_html(tags)

        return EmailPayload(
            to=[],
            subject=subject,
            body_html=html,
            body_text=f"Review AI draft for {tags['vendor_name']}: {ai_drafted_message[:500]}",
            metadata={"type": "manager_review", **tags},
        )

    async def send_via_gateway(self, payload: EmailPayload) -> Dict[str, Any]:
        """Send email through NestJS API Gateway for Gmail API threading."""
        if not payload.to:
            logger.warning("No recipients — skipping send")
            return {"success": False, "error": "No recipients"}

        request_body = {
            "to": payload.to,
            "subject": payload.subject,
            "bodyHtml": payload.body_html,
            "bodyText": payload.body_text,
        }

        if payload.reply_to:
            request_body["replyTo"] = payload.reply_to
        if payload.thread_id:
            request_body["threadId"] = payload.thread_id
        if payload.in_reply_to:
            request_body["inReplyTo"] = payload.in_reply_to
        if payload.references:
            request_body["references"] = payload.references

        url = f"{self.api_gateway_url}/communications/email"
        logger.info(f"Sending email via gateway: {url} -> {payload.to}")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=request_body, timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    result = await resp.json()
                    if resp.status == 200 and result.get("success"):
                        logger.info(
                            f"Email sent: messageId={result.get('messageId')}, threadId={result.get('threadId')}"
                        )
                        return {
                            "success": True,
                            "message_id": result.get("messageId"),
                            "thread_id": result.get("threadId"),
                        }
                    else:
                        logger.error(f"Gateway send failed: {result}")
                        return {
                            "success": False,
                            "error": result.get("error", "Unknown error"),
                        }
        except Exception as e:
            logger.error(f"Failed to send via gateway: {e}")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # STYLE EVOLUTION
    # =========================================================================

    async def _load_or_analyze_style(
        self,
        provider_id: str,
        conversation_history: List[Dict[str, Any]],
    ) -> StyleProfile:
        """Load cached style profile or analyze from conversation history."""
        if not provider_id:
            return StyleProfile()

        try:
            result = (
                self.database.supabase.table("provider_digital_twins")
                .select("communication_style")
                .eq("provider_id", provider_id)
                .limit(1)
                .execute()
            )

            if result.data and result.data[0].get("communication_style"):
                cached = result.data[0]["communication_style"]
                if isinstance(cached, str):
                    cached = json.loads(cached)
                return StyleProfile.from_dict(cached)
        except Exception as e:
            logger.debug(f"No cached style for {provider_id}: {e}")

        if conversation_history:
            return await self._analyze_style(provider_id, conversation_history)

        return StyleProfile()

    async def _analyze_style(
        self,
        provider_id: str,
        conversation_history: List[Dict[str, Any]],
    ) -> StyleProfile:
        """Analyze vendor's communication style from their inbound messages."""
        inbound = [
            m
            for m in conversation_history
            if m.get("direction") == "inbound" and m.get("message_text")
        ]
        if not inbound:
            return StyleProfile()

        if self.llm_client and len(inbound) >= 2:
            return await self._analyze_style_llm(provider_id, inbound)

        return self._analyze_style_heuristic(inbound)

    def _log_llm_spend(self, response, task_type: str) -> None:
        """P1: emit one spend/NF row for a Gemini call (never raises)."""
        try:
            from services.spend_logger import estimate_llm_cost, get_spend_logger

            _usage = getattr(response, "usage_metadata", None)
            _in = getattr(_usage, "prompt_token_count", 0) or 0
            # thinking tokens bill at the output rate — see spend_logger.usage_tokens()
            _out = (getattr(_usage, "candidates_token_count", 0) or 0) + (
                getattr(_usage, "thoughts_token_count", 0) or 0
            )
            get_spend_logger().log(
                provider="google",
                model=self.llm_model_name,
                input_tokens=_in,
                output_tokens=_out,
                cost_usd=estimate_llm_cost(self.llm_model_name, _in, _out),
                agent_fallback="email_composer_service",
                task_type=task_type,
                outcome="success",  # call-level: response returned
            )
        except Exception:
            pass

    async def _analyze_style_llm(
        self,
        provider_id: str,
        inbound_messages: List[Dict[str, Any]],
    ) -> StyleProfile:
        """Use Gemini to analyze vendor communication style."""
        emails_text = "\n---\n".join(
            m.get("message_text", "")[:500] for m in inbound_messages[:5]
        )

        prompt = STYLE_ANALYSIS_PROMPT.replace("{emails}", emails_text)

        try:
            response = await self.llm_client.generate_content_async(prompt)
            self._log_llm_spend(response, "style_analysis")  # P1
            text = response.text.strip()
            json_match = re.search(r"\{[\s\S]*\}", text)
            if json_match:
                parsed = json.loads(json_match.group())
                style = StyleProfile.from_dict(parsed)
                await self._cache_style(provider_id, parsed)
                return style
        except Exception as e:
            logger.error(f"LLM style analysis failed: {e}")

        return self._analyze_style_heuristic(inbound_messages)

    def _analyze_style_heuristic(self, messages: List[Dict[str, Any]]) -> StyleProfile:
        """Fast heuristic style analysis without LLM."""
        texts = [m.get("message_text", "") for m in messages if m.get("message_text")]
        if not texts:
            return StyleProfile()

        sentence_lengths = []
        for t in texts:
            sentences = re.split(r"[.!?]+", t)
            for s in sentences:
                words = s.split()
                if words:
                    sentence_lengths.append(len(words))

        avg_sent = statistics.mean(sentence_lengths) if sentence_lengths else 15
        avg_para = statistics.mean(len(t.split("\n\n")) for t in texts) if texts else 3

        all_text = " ".join(texts).lower()
        has_emoji = bool(
            re.search(r"[\U0001f600-\U0001f64f\U0001f300-\U0001f5ff]", all_text)
        )
        is_formal = any(
            w in all_text for w in ["dear ", "sincerely", "regards", "respectfully"]
        )

        greeting = "Dear" if is_formal else "Hi"
        signoff = "Best regards" if is_formal else "Thanks"

        first_line = texts[0].split("\n")[0] if texts else ""
        if first_line.lower().startswith("hi "):
            greeting = first_line.split(",")[0] if "," in first_line else "Hi {name},"
        elif first_line.lower().startswith("dear "):
            greeting = first_line.split(",")[0] if "," in first_line else "Dear {name},"

        return StyleProfile(
            formality="formal" if is_formal else "professional",
            avg_sentence_length=round(avg_sent, 1),
            greeting_style=f"{greeting} {{name}},",
            signoff_style=signoff,
            uses_emoji=has_emoji,
            avg_paragraph_count=round(avg_para),
            language="en",
            tone_keywords=(
                ["formal", "business"] if is_formal else ["professional", "friendly"]
            ),
        )

    async def _cache_style(self, provider_id: str, style_data: Dict) -> None:
        """Cache analyzed style in provider_digital_twins."""
        try:
            self.database.supabase.table("provider_digital_twins").upsert(
                {
                    "provider_id": provider_id,
                    "communication_style": json.dumps(style_data),
                    "style_analyzed_at": datetime.utcnow().isoformat(),
                },
                on_conflict="provider_id",
            ).execute()
        except Exception as e:
            logger.debug(f"Failed to cache style: {e}")

    # =========================================================================
    # LLM BODY GENERATION
    # =========================================================================

    async def _generate_body(
        self,
        tags: Dict[str, Any],
        style: StyleProfile,
        conversation_history: List[Dict[str, Any]],
        intent: str,
        extra_context: str,
    ) -> str:
        """Generate email body via Gemini or fallback template."""
        if not self.llm_client:
            return self._fallback_body(tags, style, intent)

        history_text = self._format_history(conversation_history)
        greeting = style.greeting_style.replace(
            "{name}", str(tags.get("vendor_contact_name", ""))
        )
        signoff = style.signoff_style

        style_directives = (
            f"Formality: {style.formality}\n"
            f"Tone: {', '.join(style.tone_keywords)}\n"
            f"Average sentence length: ~{style.avg_sentence_length} words\n"
            f"{'Use emoji sparingly' if style.uses_emoji else 'Do NOT use emoji'}\n"
            f"Language: {style.language}"
        )

        prompt = COMPOSE_SYSTEM_PROMPT.format(
            vendor_name=tags.get("vendor_name", ""),
            vendor_contact_name=tags.get("vendor_contact_name", ""),
            style_directives=style_directives,
            conversation_history=history_text or "(first contact)",
            wine_name=tags.get("wine_name", ""),
            quantity=tags.get("quantity", ""),
            price_per_bottle=tags.get("price_per_bottle", ""),
            extra_context=extra_context,
            intent=intent,
            greeting=greeting,
            signoff=signoff,
            paragraph_target=style.avg_paragraph_count,
        )

        try:
            response = await self.llm_client.generate_content_async(prompt)
            self._log_llm_spend(response, "email_compose")  # P1
            body = response.text.strip()
            if body.startswith('"') and body.endswith('"'):
                body = body[1:-1]
            return body
        except Exception as e:
            logger.error(f"LLM body generation failed: {e}")
            return self._fallback_body(tags, style, intent)

    def _fallback_body(self, tags: Dict, style: StyleProfile, intent: str) -> str:
        """Template-based fallback when LLM is unavailable."""
        greeting = style.greeting_style.replace(
            "{name}", str(tags.get("vendor_contact_name", ""))
        )
        signoff = style.signoff_style

        intent_bodies = {
            "order_inquiry": (
                f"I'd like to place an order for {tags.get('wine_name', 'wine')} — "
                f"{tags.get('quantity', '')} bottles.\n\n"
                f"Could you let me know the current pricing and availability?\n\n"
                f"Looking forward to hearing from you."
            ),
            "price_negotiation": (
                f"Thank you for the quote on {tags.get('wine_name', 'the wine')}. "
                f"Based on our volume and relationship, we were hoping for a price "
                f"closer to {tags.get('price_per_bottle', '')} per bottle for "
                f"{tags.get('quantity', '')} bottles.\n\n"
                f"Would that work on your end?"
            ),
            "order_confirmation": (
                f"We'd like to confirm the order for {tags.get('wine_name', 'wine')} — "
                f"{tags.get('quantity', '')} bottles.\n\n"
                f"Could you please send the invoice and confirm the expected delivery date?"
            ),
            "invoice_request": (
                f"Could you send the invoice for order #{tags.get('order_number', tags.get('order_id', ''))}? "
                f"We're ready to process payment.\n\n"
                f"Thank you."
            ),
        }

        body = intent_bodies.get(intent, intent_bodies["order_inquiry"])

        return f"{greeting}\n\n{body}\n\n{signoff},\n{tags.get('restaurant_name', 'Restaurant Manager')}"

    # =========================================================================
    # HTML WRAPPING
    # =========================================================================

    def _wrap_html(self, body_text: str, tags: Dict[str, Any]) -> str:
        """Wrap plain-text body into minimal, professional HTML."""
        paragraphs = body_text.split("\n\n")
        html_paras = "".join(
            f'<p style="margin: 0 0 12px; line-height: 1.6;">{p.replace(chr(10), "<br/>")}</p>'
            for p in paragraphs
            if p.strip()
        )

        order_ref = tags.get("order_number") or tags.get("order_id", "")
        ref_line = (
            f'<p style="margin: 20px 0 0; color: #9ca3af; font-size: 11px;">Ref: {order_ref}</p>'
            if order_ref
            else ""
        )

        return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#ffffff;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td style="padding:30px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin:0 auto;">
<tr><td style="color:#1f2937;font-size:15px;">
{html_paras}
</td></tr>
</table>
{ref_line}
</td></tr>
</table>
</body>
</html>"""

    def _build_manager_review_html(self, tags: Dict[str, Any]) -> str:
        """Build manager review email HTML with action buttons."""
        base_url = "https://app.wineops.ai"
        oid = tags.get("order_id", "")
        cid = tags.get("conversation_id", "")

        return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;">
<tr><td style="padding:20px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
<tr><td style="padding:20px 30px;background:#7c2d12;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;">WineOps AI</h1>
</td></tr>
<tr><td style="padding:30px;">
<div style="display:inline-block;padding:6px 12px;background:{'#f59e0b' if tags.get('urgency')=='high' else '#3b82f6'};color:#fff;font-size:12px;font-weight:600;border-radius:4px;margin-bottom:15px;">
AI DRAFT — {tags.get('urgency','normal').upper()} PRIORITY
</div>
<h2 style="margin:0 0 5px;color:#111827;font-size:20px;">Review Vendor Email Draft</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:14px;">{tags.get('wine_name','')} x{tags.get('quantity','')} — {tags.get('vendor_name','')}</p>
<div style="margin:20px 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
<p style="margin:0 0 8px;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">AI-DRAFTED MESSAGE</p>
<div style="color:#1f2937;font-size:14px;line-height:1.6;white-space:pre-wrap;">{tags.get('ai_message','')}</div>
</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:25px 0;">
<tr>
<td width="25%" style="padding:5px;text-align:center;">
<a href="{base_url}/orders/{oid}?action=approve_send&cid={cid}" style="display:block;padding:12px 8px;background:#10b981;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px;">Approve &amp; Send</a>
</td>
<td width="25%" style="padding:5px;text-align:center;">
<a href="{base_url}/orders/{oid}?action=edit&cid={cid}" style="display:block;padding:12px 8px;background:#3b82f6;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px;">Edit Message</a>
</td>
<td width="25%" style="padding:5px;text-align:center;">
<a href="{base_url}/orders/{oid}?action=reject&cid={cid}" style="display:block;padding:12px 8px;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px;">Reject</a>
</td>
<td width="25%" style="padding:5px;text-align:center;">
<a href="{base_url}/orders/{oid}?action=ask_more&cid={cid}" style="display:block;padding:12px 8px;background:#4b5563;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px;">Ask for More</a>
</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:20px 30px;background:#f9fafb;border-top:1px solid #e5e7eb;">
<p style="margin:0;color:#6b7280;font-size:12px;text-align:center;">Automated by WineOps AI</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _build_subject(self, intent: str, tags: Dict) -> str:
        wine = tags.get("wine_name", "Wine")
        qty = tags.get("quantity", "")
        order_num = tags.get("order_number", "")

        subjects = {
            "order_inquiry": f"Wine Order Inquiry: {wine} x{qty}",
            "price_negotiation": f"Re: Pricing for {wine}",
            "order_confirmation": f"Order Confirmation — {wine} x{qty}",
            "invoice_request": f"Invoice Request — Order #{order_num}",
            "follow_up": f"Following Up — {wine}",
        }
        return subjects.get(
            intent, f"Regarding {wine} — {tags.get('restaurant_name', '')}"
        )

    def _format_history(self, history: List[Dict]) -> str:
        if not history:
            return ""
        lines = []
        for m in history[-5:]:
            direction = "Us" if m.get("direction") == "outbound" else "Vendor"
            text = (m.get("message_text") or "")[:300]
            ts = m.get("sent_at") or m.get("received_at") or m.get("created_at", "")
            lines.append(f"[{ts[:16]}] {direction}: {text}")
        return "\n".join(lines)

    def _resolve_threading(
        self, history: List[Dict]
    ) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Extract threading info from conversation history."""
        if not history:
            return None, None, None

        thread_id = None
        in_reply_to = None
        references_chain = []

        for m in reversed(history):
            headers = m.get("email_headers")
            if headers:
                if isinstance(headers, str):
                    try:
                        headers = json.loads(headers)
                    except Exception:
                        headers = {}

                if not thread_id and headers.get("gmail_thread_id"):
                    thread_id = headers["gmail_thread_id"]
                if headers.get("message_id"):
                    in_reply_to = headers["message_id"]
                    references_chain.append(headers["message_id"])
                    if headers.get("references"):
                        references_chain.extend(headers["references"].split())
                    break

        references = (
            " ".join(dict.fromkeys(references_chain)) if references_chain else None
        )
        return thread_id, in_reply_to, references

    @staticmethod
    def _calc_total(order: Dict) -> str:
        price = (
            order.get("target_price_per_bottle") or order.get("price_per_bottle") or 0
        )
        qty = order.get("quantity", 0)
        try:
            total = float(price) * int(qty)
            return f"${total:,.2f}"
        except (ValueError, TypeError):
            return "TBD"

    def resolve_tags(self, template: str, tags: Dict[str, Any]) -> str:
        """Resolve {{tag}} placeholders in a template string."""
        result = template
        for key, value in tags.items():
            result = result.replace(f"{{{{{key}}}}}", str(value))
        return result
