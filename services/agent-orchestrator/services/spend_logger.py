"""
SpendLogger — Central API Spend Tracking Service (+ Neural Footprint dual-write)
================================================================================
All API-calling services (Claude Vision, Haiku, Gemini, Serper, OpenAI) invoke
SpendLogger.log() after each API call. Since P1 (ADR 0008) this is the SOLE
dual-write entry point on the Python side: one call inserts

  1. `api_spend`               — the primary cost ledger (unchanged shape), then
  2. `neural_footprint_event`  — the NF production store (subject_type='agent'),
                                 row built by services/neural_footprint.py.

A second logger would recreate the D2 split (decision_log and api_spend
unjoinable), so do NOT add one — extend this.

IMPORTANT: SpendLogger.log() must NEVER raise. A spend logging failure must
not interrupt the extraction pipeline. All exceptions are caught and logged,
and dropped rows are COUNTED (services.neural_footprint.get_drop_counts) so
silent gaps stay visible.

Attribution (P1 Q2/Q3):
- `agent`          explicit actor; wins. BaseAgent methods pass self.agent_name,
                   Celery tasks pass a stable worker literal.
- ambient context  utils.logger contextvars (set by BaseAgent._process_with_retry
                   and the Celery task_prerun hook) supplies agent + correlation
                   when the caller passes none.
- `agent_fallback` shared-library sites (vlm/vision/enrichment services) pass
                   their own module name here; it is used only when neither an
                   explicit agent nor ambient context exists, because a library
                   cannot honestly know its caller.

Usage:
    from services.spend_logger import get_spend_logger
    get_spend_logger().log(
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        input_tokens=1024,
        output_tokens=256,
        cost_usd=0.00042,
        restaurant_id="uuid-or-none",
        agent="provider_communication_agent",
        task_type="email_draft",
        outcome="success",                # call-level_v0; None = unknown
        context={"order_id": "..."},
    )
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from config.settings import get_settings
from services.neural_footprint import (
    build_agent_event,
    insert_event,
    record_drop,
)
from utils.logger import get_log_context

logger = logging.getLogger(__name__)


# Estimated per-1M-token USD rates for models this codebase actually calls.
# Mirrors the inline formulas already used at lit call sites. These are
# ESTIMATES for spend visibility, not billing truth — rows carry real token
# counts so cost can always be recomputed.
_RATES_PER_M: Dict[str, tuple] = {
    "claude-haiku": (0.80, 4.00),
    "claude-sonnet": (3.00, 15.00),
    "gemini-2.5-flash": (0.075, 0.30),
    "gemini-2.0-flash": (0.075, 0.30),
    "gemini-pro": (0.50, 1.50),
    "gpt-4-turbo": (10.00, 30.00),
}


def estimate_llm_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Best-effort USD cost estimate from token counts. 0.0 when model unknown."""
    m = (model or "").lower()
    for prefix, (rate_in, rate_out) in _RATES_PER_M.items():
        if m.startswith(prefix) or prefix in m:
            return (input_tokens * rate_in / 1_000_000) + (
                output_tokens * rate_out / 1_000_000
            )
    return 0.0


class SpendLogger:
    """
    Synchronous spend logger. Safe to call from both async FastAPI handlers
    and synchronous Celery tasks.

    Uses the shared Settings.supabase_client singleton (config/settings.py) —
    NOT a client per call — so inserts reuse one connection instead of paying
    a TCP+TLS handshake per row (P1 Q5).
    """

    def log(
        self,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        restaurant_id: Optional[str] = None,
        *,
        agent: Optional[str] = None,
        agent_fallback: Optional[str] = None,
        task_type: Optional[str] = None,
        stimulus: Optional[str] = None,
        choice: Optional[str] = None,
        outcome: Optional[str] = None,
        duration_ms: Optional[int] = None,
        correlation_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Insert one row into api_spend AND one into neural_footprint_event.

        Positional args (unchanged since COST-01 — existing call sites intact):
            provider: "anthropic" | "google" | "serper" | "openai"
            model: full model ID string
            input_tokens / output_tokens: token counts (0 for search APIs)
            cost_usd: computed USD cost for this call
            restaurant_id: restaurant UUID or None. NEVER a wine id — non-UUID
                values are diverted to NF context and nulled.

        Keyword-only args (P1, all default None — no call-site churn required):
            agent: explicit actor name (wins over ambient context)
            agent_fallback: library-name fallback when nothing else is known
            task_type: compact local literal, e.g. "email_draft", "score_search"
            stimulus: what triggered the call (defaults to task_type)
            choice: compact artifact descriptor, e.g. "draft:parsed",
                "search:5_results" (defaults to "completion"). Never a payload.
            outcome: "success" | "failure" | "partial" | None (= unknown,
                NEVER success). Graded call-level on day one; every graded row
                is stamped context.outcome_basis = "call_level_v0".
            duration_ms: wall-clock call duration when the caller measured it
            correlation_id: joins decision_log; defaults to ambient context
            context: extra jsonb payload (wine_id, results_count, parse flags…)
        """
        try:
            settings = get_settings()
            supabase = settings.supabase_client
            if supabase is None:
                logger.debug(
                    "SpendLogger: Supabase not configured — skipping spend log"
                )
                return

            ambient_agent, ambient_correlation = get_log_context()
            subject_id = agent or ambient_agent or agent_fallback or "unknown"
            corr = correlation_id or ambient_correlation or None

            # 1) api_spend — primary ledger, written first, own try/except.
            try:
                supabase.table("api_spend").insert(
                    {
                        "provider": provider,
                        "model": model,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cost_usd": cost_usd,
                        "restaurant_id": restaurant_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                ).execute()
            except Exception as exc:
                total = record_drop("api_spend")
                logger.warning(
                    "SpendLogger: api_spend insert failed (non-fatal, drop #%d "
                    "this process): %s",
                    total,
                    exc,
                )

            # 2) neural_footprint_event — NF store, own try/except so an NF
            #    failure never costs the api_spend row (and vice versa).
            try:
                nf_context: Dict[str, Any] = {
                    "provider": provider,
                    "model": model,
                }
                if task_type:
                    nf_context["task_type"] = task_type
                if context:
                    nf_context.update(context)

                row = build_agent_event(
                    subject_id=subject_id,
                    stimulus=stimulus or task_type or f"{provider}:{model}",
                    choice=choice or "completion",
                    outcome=outcome,
                    cost_usd=cost_usd,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    duration_ms=duration_ms,
                    correlation_id=corr,
                    restaurant_id=restaurant_id,
                    context=nf_context,
                )
                insert_event(supabase, row)  # never raises; counts drops
            except Exception as exc:
                total = record_drop("neural_footprint_event")
                logger.warning(
                    "SpendLogger: NF row build failed (non-fatal, drop #%d "
                    "this process): %s",
                    total,
                    exc,
                )
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
