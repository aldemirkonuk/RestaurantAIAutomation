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


# Per-1M-token USD rates for models this codebase actually calls.
# These are ESTIMATES for spend visibility, not billing truth — rows carry real
# token counts so cost can always be recomputed.
#
# Gemini rates VERIFIED 2026-08-24 against ai.google.dev/gemini-api/docs/pricing
# (paid tier, Standard — not Batch/Flex). Output rates are the "Output price
# (including thinking tokens)" figure, because Google bills reasoning tokens at
# the output rate; see usage_tokens() below for why that matters.
#
# CAUTION — gemini-3.7-flash and gemini-3.6-flash ONLY are promotional through
# 2026-12-31 and DOUBLE on 2027-01-01 (0.75/3.75 → 1.50/7.50). Revisit those two
# rows before that date or their spend reads 2x low. Every other row here is flat
# with no published end date, including the gemini-3.5-flash-lite default.
#
# These are text rates. The table is flat per model and does NOT encode Google's
# modality and context tiers: audio input costs more (2.5-flash 1.00 vs 0.30;
# 3.1-flash-lite 0.50 vs 0.25) and gemini-2.5-pro doubles above a 200k-token
# prompt (2.50/15.00 vs 1.25/10.00). No current call site hits those tiers — all
# are text well under 200k — so the flat rate is exact today. Add the tiering if
# audio or long-context calls ever ship.
#
# Anthropic rates VERIFIED 2026-08-24 against
# platform.claude.com/docs/en/about-claude/pricing.md, matched to the model ids
# this repo actually passes: claude-haiku-4-5-20251001 and claude-sonnet-4-20250514.
#
# NOT VERIFIED: gpt-4-turbo. Only one live call site and no source was checked
# for it in this pass; treat it as suspect (OD-59).
_RATES_PER_M: Dict[str, tuple] = {
    # claude-haiku was (0.80, 4.00) — Claude Haiku *3.5*'s retired rate, applied
    # to the 4.5 model this repo actually calls. Same failure as the Gemini
    # retirement: a superseded model's price frozen in and inherited by its
    # successor. Under-recorded Haiku spend 20% at 11 call sites.
    "claude-haiku": (1.00, 5.00),
    # Sonnet 5 carries an introductory 2.00/10.00 that ends 2026-08-31, a week
    # after this table was written. The standard 3.00/15.00 is encoded instead:
    # it slightly over-records for that week and is exact from 1 September, which
    # is the safer direction and needs no diarised follow-up.
    "claude-sonnet-5": (3.00, 15.00),
    "claude-sonnet": (3.00, 15.00),
    "gpt-4-turbo": (10.00, 30.00),  # UNVERIFIED
    # --- Gemini, verified 2026-08-24 ---
    "gemini-3.7-flash": (0.75, 3.75),  # 1.50/7.50 from 2027-01-01
    "gemini-3.6-flash": (0.75, 3.75),  # 1.50/7.50 from 2027-01-01
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-pro": (1.25, 10.00),
}


# Providers whose spend is derived from _RATES_PER_M by token count. Anything
# else (Serper's flat per-query fee) prices itself and must not be judged against
# this table — see the cost_basis guard in SpendLogger.log().
_TOKEN_PRICED_PROVIDERS = frozenset({"google", "anthropic", "openai"})


def _rate_for(model: str) -> Optional[tuple]:
    """
    Longest-match-wins rate lookup.

    Matching is by substring, so shorter ids are prefixes of longer ones
    ("gemini-2.5-flash" is inside "gemini-2.5-flash-lite"), and insertion-order
    iteration resolved a lite id to the full-flash row.

    This is a GUARD, not a historical fix: under the old table both rows read
    (0.075, 0.30), so the collision cost ~25% under-pricing on the one lite id
    and no live call site even passed it. It matters now because the corrected
    table separates them sharply — 2.5-flash-lite is (0.10, 0.40) against
    2.5-flash's (0.30, 2.50), so without this the correction would itself have
    introduced a 6.25x over-charge on lite output. Sorting keys by length
    descending makes the most specific id win regardless of table order.
    """
    m = (model or "").lower()
    for prefix in sorted(_RATES_PER_M, key=len, reverse=True):
        if prefix in m:
            return _RATES_PER_M[prefix]
    return None


def is_priced_model(model: str) -> bool:
    """
    True when _RATES_PER_M can price this model.

    Callers use this to distinguish "this call genuinely cost $0" from "we have
    no rate for this model", so an unpriced model books NULL rather than a
    false zero that would quietly deflate every spend aggregate.
    """
    return _rate_for(model) is not None


def estimate_llm_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """
    Best-effort USD cost estimate from token counts. 0.0 when model unknown.

    A 0.0 return is ambiguous by design (the api_spend.cost_usd column is NOT
    NULL, so it has no way to say "unknown"). Pair it with is_priced_model()
    whenever the distinction matters — SpendLogger.log() does.
    """
    rate = _rate_for(model)
    if rate is None:
        return 0.0
    rate_in, rate_out = rate
    return (input_tokens * rate_in / 1_000_000) + (output_tokens * rate_out / 1_000_000)


def usage_tokens(response: Any) -> tuple:
    """
    Extract (input_tokens, output_tokens) from a Gemini response, counting
    reasoning tokens as output.

    Google bills `thoughts_token_count` at the OUTPUT rate but reports it in a
    field separate from `candidates_token_count`. Reading only the latter — as
    every call site here previously did — undercounts billable output badly on
    any thinking-enabled model: measured 2026-08-24 on the EmailIntelAgent
    prompt, gemini-2.5-flash billed 598 output tokens while logging 113 (5.3x),
    and gemini-3.6-flash billed 680 while logging 73 (9.3x).

    Returns (0, 0) for responses without usage metadata rather than raising —
    spend logging must never break a pipeline.
    """
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return (0, 0)
    prompt = getattr(usage, "prompt_token_count", 0) or 0
    candidates = getattr(usage, "candidates_token_count", 0) or 0
    thoughts = getattr(usage, "thoughts_token_count", 0) or 0
    return (prompt, candidates + thoughts)


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
                logger.debug("SpendLogger: Supabase not configured — skipping spend log")
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

                # An unpriced model has no rate in _RATES_PER_M, so estimate_llm_cost
                # returned 0.0 meaning "unknown" — not "free". NF's cost_usd is
                # nullable, so record the honest NULL and say why. (api_spend.cost_usd
                # is NOT NULL and still takes the 0.0; correcting that needs a
                # migration and is filed as tech debt, not silently fixed here.)
                #
                # Gated on provider: only token-priced providers get their cost FROM
                # this table. Serper bills a flat configured per-query rate
                # (Settings.serper_cost_per_query) that is exactly known and has no
                # business being in a per-token table — nulling it would delete real
                # spend and mislabel it unknown, which is the very defect this guard
                # exists to prevent.
                nf_cost = cost_usd
                if provider in _TOKEN_PRICED_PROVIDERS and not is_priced_model(model):
                    nf_cost = None
                    nf_context["cost_basis"] = "unpriced_model"

                row = build_agent_event(
                    subject_id=subject_id,
                    stimulus=stimulus or task_type or f"{provider}:{model}",
                    choice=choice or "completion",
                    outcome=outcome,
                    cost_usd=nf_cost,
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
                    "SpendLogger: NF row build failed (non-fatal, drop #%d " "this process): %s",
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
