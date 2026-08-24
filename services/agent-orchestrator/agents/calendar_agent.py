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
from typing import Dict, List, Any
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
            # Build the LLM prompt
            today = datetime.utcnow().strftime("%Y-%m-%d")
            prompt = DATE_EXTRACTION_PROMPT.format(
                conversation=conversation[:3000],  # Truncate very long conversations
                provider_name=provider_name,
                today=today,
            )

            # Call Gemini Pro via the database's LLM helper (or direct API)
            extracted_dates = await self._call_llm_for_dates(prompt)

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

    async def _call_llm_for_dates(self, prompt: str) -> List[Dict[str, Any]]:
        """Call Gemini to extract dates, with regex fallback"""
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
            response = await client.aio.models.generate_content(
                model=model_id,
                contents=prompt,
            )

            # P1: previously an unlogged model call (dark site)
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
                    agent=self.agent_name,
                    task_type="date_extraction",
                    outcome="success",  # call-level: response returned
                    correlation_id=getattr(self, "_current_correlation_id", None),
                )
            except Exception:
                pass

            if response and response.text:
                # Parse JSON from LLM response
                text = response.text.strip()
                # Extract JSON array from response (LLM may wrap in markdown)
                json_match = re.search(r"\[.*\]", text, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())

        except ImportError:
            self.logger.debug("google-genai not installed, using regex fallback")
        except Exception as e:
            self.logger.warning(
                f"LLM date extraction failed, using regex fallback: {e}"
            )

        # Regex fallback: extract obvious date patterns from the prompt
        return self._regex_date_extraction(prompt)

    def _regex_date_extraction(self, text: str) -> List[Dict[str, Any]]:
        """Fallback: extract dates using regex patterns"""
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
