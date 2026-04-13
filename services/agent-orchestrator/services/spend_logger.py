"""
SpendLogger — Central API Spend Tracking Service
=================================================
All API-calling services (Claude Vision, Haiku, Gemini) invoke SpendLogger.log()
after each API call. Single insertion point for the api_spend Supabase table.

IMPORTANT: SpendLogger.log() must NEVER raise. A spend logging failure must
not interrupt the extraction pipeline. All exceptions are caught and logged.

Usage:
    from services.spend_logger import get_spend_logger
    spend_logger = get_spend_logger()
    spend_logger.log(
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        input_tokens=1024,
        output_tokens=256,
        cost_usd=0.00042,
        restaurant_id="uuid-or-none",
    )
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)


class SpendLogger:
    """
    Synchronous spend logger. Safe to call from both async FastAPI handlers
    and synchronous Celery tasks.

    The supabase-py client is synchronous. Calling .log() from an async
    context blocks for < 50ms (acceptable for MVP per RESEARCH.md).
    """

    def log(
        self,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        restaurant_id: Optional[str] = None,
    ) -> None:
        """
        Insert one row into the api_spend table.

        Args:
            provider: "anthropic" for Claude Vision + Haiku; "google" for Gemini Flash
            model: full model ID string, e.g. "claude-haiku-4-5-20251001" or "gemini-2.5-flash"
            input_tokens: number of input tokens consumed
            output_tokens: number of output tokens generated
            cost_usd: computed USD cost for this call
            restaurant_id: UUID string of the restaurant, or None (e.g. for enrichment tasks)
        """
        try:
            settings = get_settings()
            if not settings.supabase_url or not settings.supabase_key:
                logger.debug("SpendLogger: Supabase not configured — skipping spend log")
                return
            from supabase import create_client
            supabase = create_client(settings.supabase_url, settings.supabase_key)
            supabase.table("api_spend").insert({
                "provider": provider,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": cost_usd,
                "restaurant_id": restaurant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }).execute()
        except Exception as exc:
            # NEVER re-raise — a spend logging failure must not crash the pipeline
            logger.warning(f"SpendLogger.log() failed (non-fatal): {exc}")


_spend_logger: Optional[SpendLogger] = None


def get_spend_logger() -> SpendLogger:
    """Return the shared SpendLogger singleton."""
    global _spend_logger
    if _spend_logger is None:
        _spend_logger = SpendLogger()
    return _spend_logger
