"""
Calendar Agent
Tracks important dates and sends reminders

Tracks:
- Provider birthdays
- Important events (surgeries, holidays, etc.)
- Delivery schedules
- Inventory count reminders
- Contract renewal dates
- Dates extracted from AI vendor conversations
"""

import json
import re
import time
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta

from core.base_agent import BaseAgent


# Prompt for Gemini to extract dates from conversation text
DATE_EXTRACTION_PROMPT = """Analyze the following vendor conversation and extract any important dates or events mentioned.

Conversation:
---
{conversation}
---

Provider Name: {provider_name}

Extract ALL dates and events. For each, return JSON with these fields:
- "date": ISO date string (YYYY-MM-DD). If only a relative reference like "next Tuesday" or "in 2 weeks", calculate from today ({today}).
- "event_type": one of "delivery_expected", "meeting", "deadline", "holiday", "birthday", "promotion", "contract_renewal", "tasting", "other"
- "description": short description of the event
- "confidence": 0.0 to 1.0 how confident you are

Return a JSON array. If no dates found, return [].

Example output:
[
  {{"date": "2026-02-15", "event_type": "delivery_expected", "description": "Expected delivery of Barolo x12", "confidence": 0.9}},
  {{"date": "2026-03-01", "event_type": "promotion", "description": "Spring wine sale begins", "confidence": 0.7}}
]
"""


class CalendarAgent(BaseAgent):
    """
    Calendar Agent - Important date tracking and reminders

    Features:
    - LLM-powered date extraction from vendor conversations
    - Periodic reminders (daily check, self-scheduling)
    - Proactive notifications (3 days before event)
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._daily_check_task = None

    async def initialize(self) -> None:
        self.logger.info("Initializing Calendar Agent")

        # Start self-scheduling daily check (no external trigger needed)
        import asyncio

        self._daily_check_task = asyncio.create_task(
            self._daily_check_loop(), name="calendar-daily-check"
        )

        self.logger.info("Calendar Agent initialized with daily self-scheduling")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("procurement.events", "procurement.conversation.completed"),
            ("system.control", "system.schedule.daily_check"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "procurement.conversation.completed":
            await self._extract_important_dates(message)
        elif routing_key == "system.schedule.daily_check":
            await self._check_upcoming_events()

    # =========================================================================
    # LLM DATE EXTRACTION
    # =========================================================================

    async def _extract_important_dates(self, message: Dict[str, Any]) -> None:
        """Extract important dates from vendor conversation using Gemini Pro"""
        payload = message.get("payload", {})
        conversation = payload.get("conversation", "")
        provider_id = payload.get("provider_id")
        provider_name = payload.get("provider_name", "Unknown Provider")
        restaurant_id = payload.get("restaurant_id")

        if not conversation or not provider_id:
            self.logger.debug(
                "No conversation text or provider_id, skipping date extraction"
            )
            return

        self.logger.info(
            f"Extracting dates from conversation with {provider_name} (provider={provider_id})"
        )

        try:
            # The prompt is built INSIDE _call_llm_for_dates, not here, so the
            # formatted template never enters this scope. See OD-63: the regex
            # fallback used to be handed `prompt` from exactly this call site.
            extracted_dates = await self._call_llm_for_dates(
                conversation[:3000],  # Truncate very long conversations
                provider_name=provider_name,
                restaurant_id=restaurant_id,
            )

            if not extracted_dates:
                self.logger.debug(
                    f"No dates extracted from conversation with {provider_name}"
                )
                return

            # Persist each extracted date
            saved_count = 0
            for date_entry in extracted_dates:
                if date_entry.get("confidence", 0) < 0.4:
                    continue  # Skip low-confidence extractions

                try:
                    event_date = date_entry.get("date", "")
                    if not event_date:
                        continue

                    # Upsert into provider_important_dates
                    self.database.supabase.table("provider_important_dates").upsert(
                        {
                            "provider_id": provider_id,
                            "date": event_date,
                            "event_type": date_entry.get("event_type", "other"),
                            "description": date_entry.get("description", ""),
                            "confidence": date_entry.get("confidence", 0.5),
                            "source": "llm_extraction",
                            "restaurant_id": restaurant_id,
                        },
                        on_conflict="provider_id,date",
                    ).execute()
                    saved_count += 1

                except Exception as e:
                    self.logger.warning(f"Failed to save extracted date: {e}")

            if saved_count > 0:
                self.logger.info(
                    f"Saved {saved_count} extracted dates for {provider_name}"
                )

                # Also create calendar_events for high-confidence extractions
                for date_entry in extracted_dates:
                    if date_entry.get("confidence", 0) >= 0.7 and restaurant_id:
                        try:
                            self.database.supabase.table("calendar_events").insert(
                                {
                                    "restaurant_id": restaurant_id,
                                    "title": date_entry.get(
                                        "description", "Vendor Event"
                                    ),
                                    "event_type": date_entry.get("event_type", "other"),
                                    "start_date": date_entry.get("date"),
                                    "all_day": True,
                                    "provider_id": provider_id,
                                    "source": "ai_extraction",
                                    "status": "pending",
                                }
                            ).execute()
                        except Exception:
                            pass  # Calendar event creation is best-effort

        except Exception as e:
            self.logger.error(
                f"Error extracting dates from conversation: {e}", exc_info=True
            )

    async def _call_llm_for_dates(
        self,
        conversation: str,
        provider_name: str = "Unknown Provider",
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Call Gemini to extract dates from `conversation`, with a regex fallback.

        Takes the RAW conversation text, never the formatted prompt. OD-63: the
        caller used to build the prompt and pass that here, and the fallback at
        the bottom then regexed the template itself — which embeds today's date
        and the two literal example dates 2026-02-15 / 2026-03-01. Every fallback
        therefore invented at least three dates at confidence 0.6, stamped
        source="llm_extraction" so they read as genuine extraction.

        Building the prompt in here rather than at the call site is the actual
        fix: it removes the formatted template from the caller's scope entirely,
        so there is no longer a wrong string available to pass. Restoring the bug
        would take a deliberate refactor, not a slip.
        """
        prompt = DATE_EXTRACTION_PROMPT.format(
            conversation=conversation,
            provider_name=provider_name,
            today=datetime.utcnow().strftime("%Y-%m-%d"),
        )
        try:
            # Was the legacy google.generativeai SDK pinned to "gemini-pro" — a
            # model that is retired (404) — and it never called genai.configure(),
            # so it had no API key either. Both failures landed in the broad
            # `except Exception` below, meaning this path had silently been regex
            # only. Now on the shared new-SDK client like every other call site.
            from config.settings import get_settings
            from services.model_clients import get_gemini_client

            model_id = get_settings().gemini_model
            client = get_gemini_client()
            _t0 = time.perf_counter()
            response = await client.aio.models.generate_content(
                model=model_id,
                contents=prompt,
            )

            _elapsed_ms = int((time.perf_counter() - _t0) * 1000)

            # OD-75: parse BEFORE logging spend. A model that answers in prose
            # produces no dates at all, and grading that `success` made the
            # regex-fallback path — the one that used to invent dates (OD-63) —
            # indistinguishable from a real extraction in NF.
            _dates: Optional[List[Dict[str, Any]]] = None
            _parse_failed = False
            try:
                text = (response.text or "").strip() if response else ""
                # Extract JSON array from response (LLM may wrap in markdown)
                json_match = re.search(r"\[.*\]", text, re.DOTALL)
                if json_match:
                    _dates = json.loads(json_match.group())
                else:
                    _parse_failed = True
            except (json.JSONDecodeError, ValueError, AttributeError) as exc:
                _parse_failed = True
                self.logger.warning(f"LLM date extraction parse failed: {exc}")

            # P1: previously an unlogged model call (dark site).
            # Emitted on BOTH paths — the tokens were spent before the parse ran.
            try:
                from services.spend_logger import (
                    estimate_llm_cost,
                    get_spend_logger,
                    usage_tokens,
                )

                _in, _out = usage_tokens(response)  # _out includes thinking tokens
                get_spend_logger().log(
                    provider="google",
                    model=model_id,
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost(model_id, _in, _out),
                    restaurant_id=restaurant_id or None,
                    agent=self.agent_name,
                    task_type="date_extraction",
                    choice=("dates:parse_failed" if _parse_failed else "dates:parsed"),
                    outcome="partial" if _parse_failed else "success",
                    duration_ms=_elapsed_ms,
                    correlation_id=getattr(self, "_current_correlation_id", None),
                    context={
                        "outcome_basis": "parse_v1",
                        "parse_failed": _parse_failed,
                    },
                )
            except Exception:
                pass

            if _dates is not None:
                return _dates

        except ImportError:
            self.logger.debug("google-genai not installed, using regex fallback")
        except Exception as e:
            self.logger.warning(
                f"LLM date extraction failed, using regex fallback: {e}"
            )

        # Regex fallback: extract obvious date patterns from the CONVERSATION.
        # Passing `prompt` here was OD-63.
        return self._regex_date_extraction(conversation)

    def _regex_date_extraction(self, text: str) -> List[Dict[str, Any]]:
        """
        Fallback: extract dates using regex patterns.

        `text` must be conversation text a vendor actually wrote. Anything we
        generated ourselves — a prompt, a system message, a rendered template —
        will match here and be persisted as though a vendor had stated it.
        """
        results = []
        # ISO dates: 2026-02-15
        for match in re.finditer(r"(\d{4}-\d{2}-\d{2})", text):
            results.append(
                {
                    "date": match.group(1),
                    "event_type": "other",
                    "description": "Date mentioned in conversation",
                    "confidence": 0.6,
                }
            )
        # US dates: 02/15/2026 or 2/15/26
        for match in re.finditer(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text):
            month, day, year = match.groups()
            if len(year) == 2:
                year = "20" + year
            try:
                date_obj = datetime(int(year), int(month), int(day))
                results.append(
                    {
                        "date": date_obj.strftime("%Y-%m-%d"),
                        "event_type": "other",
                        "description": "Date mentioned in conversation",
                        "confidence": 0.5,
                    }
                )
            except ValueError:
                pass
        return results

    # =========================================================================
    # DAILY CHECK (Self-Scheduling)
    # =========================================================================

    async def _daily_check_loop(self) -> None:
        """Self-scheduling loop: runs daily check at midnight + 5 min"""
        import asyncio

        while not self._shutdown_event.is_set():
            try:
                # Calculate seconds until next midnight + 5 min
                now = datetime.utcnow()
                tomorrow = now.replace(
                    hour=0, minute=5, second=0, microsecond=0
                ) + timedelta(days=1)
                sleep_seconds = (tomorrow - now).total_seconds()

                self.logger.debug(
                    f"Next daily check in {sleep_seconds / 3600:.1f} hours"
                )

                # Sleep until next check (interruptible by shutdown event)
                try:
                    await asyncio.wait_for(
                        self._shutdown_event.wait(),
                        timeout=sleep_seconds,
                    )
                    break  # Shutdown requested
                except asyncio.TimeoutError:
                    pass  # Time to run the check

                await self._check_upcoming_events()

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Daily check loop error: {e}")
                await asyncio.sleep(3600)  # Retry in 1 hour

    async def _check_upcoming_events(self) -> None:
        """Check for upcoming events and send reminders"""
        try:
            # Get events in next 3 days
            now = datetime.utcnow()
            three_days = now + timedelta(days=3)

            response = (
                self.database.supabase.table("provider_important_dates")
                .select("*")
                .gte("date", now.isoformat())
                .lte("date", three_days.isoformat())
                .execute()
            )

            events = response.data if response.data else []

            for event in events:
                # Send reminder notification
                await self.publish(
                    exchange_name="notification.events",
                    routing_key="reminder.important_date",
                    message_body={
                        "event_type": "ImportantDateReminder",
                        "payload": event,
                    },
                    priority=5,
                )

            if events:
                self.logger.info(f"Sent {len(events)} date reminders")

        except Exception as e:
            self.logger.error(f"Error checking events: {e}")
