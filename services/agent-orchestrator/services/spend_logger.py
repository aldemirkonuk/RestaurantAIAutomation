"""
SpendLogger — Central API Spend Tracking Service (+ Neural Footprint dual-write)
================================================================================
All API-calling services (Claude Vision, Haiku, Gemini, Serper, OpenAI) invoke
SpendLogger.log() after each API call. Since P1 (ADR 0008) this is the SOLE
dual-write entry point on the Python side: one call inserts

  1. `api_spend`               — the primary cost ledger, then
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
from typing import Any, Dict, NamedTuple, Optional

from config.settings import get_settings
from services.neural_footprint import (
    build_agent_event,
    insert_event,
    record_drop,
)
from utils.logger import get_log_context

logger = logging.getLogger(__name__)


class Rate(NamedTuple):
    """
    One model's per-1M-token USD rates, carrying the dated source that proves them.

    `verified` and `source` have NO defaults on purpose (OD-62). Twice now a rate
    has been wrong the same way — a superseded model's published price frozen in
    and silently inherited by its successor (Gemini in ADR 0010, then Claude Haiku
    3.5's 0.80/4.00 applied to the 4.5 model this repo actually calls). Both were
    found by inspection, months apart, because nothing in the table recorded when
    or against what its numbers were last checked.

    Making the provenance a required field means a rate added without it fails at
    import, and test_rate_rows_all_carry_a_dated_verified_source() fails the build
    if the date is malformed, in the future, or a placeholder. The defect being
    fixed is the missing discipline, not the two individual numbers.
    """

    input_per_m: float
    output_per_m: float
    verified: str  # ISO YYYY-MM-DD the price was read off the published page
    source: str  # the published page it was read from
    note: str = ""  # scheduled change or caveat, if any


# Per-1M-token USD rates for models this codebase actually calls.
# These are ESTIMATES for spend visibility, not billing truth — rows carry real
# token counts so cost can always be recomputed.
#
# Gemini output rates are the "Output price (including thinking tokens)" figure,
# because Google bills reasoning tokens at the output rate; see usage_tokens()
# below for why that matters. Paid tier, Standard — not Batch/Flex.
#
# These are text rates. The table is flat per model and does NOT encode Google's
# modality and context tiers: audio input costs more (2.5-flash 1.00 vs 0.30;
# 3.1-flash-lite 0.50 vs 0.25) and gemini-2.5-pro doubles above a 200k-token
# prompt (2.50/15.00 vs 1.25/10.00). No current call site hits those tiers — all
# are text well under 200k — so the flat rate is exact today. Add the tiering if
# audio or long-context calls ever ship.
_GEMINI_PRICING = "ai.google.dev/gemini-api/docs/pricing"
_ANTHROPIC_PRICING = "platform.claude.com/docs/en/about-claude/pricing.md"
_OPENAI_PRICING = "developers.openai.com/api/docs/pricing"

_RATES_PER_M: Dict[str, Rate] = {
    # claude-haiku was (0.80, 4.00) — Claude Haiku *3.5*'s retired rate, applied
    # to the 4.5 model this repo actually calls. Same failure as the Gemini
    # retirement: a superseded model's price frozen in and inherited by its
    # successor. Under-recorded Haiku spend 20% at 11 call sites.
    "claude-haiku": Rate(1.00, 5.00, "2026-08-24", _ANTHROPIC_PRICING),
    # Sonnet 5 carries an introductory 2.00/10.00 that ends 2026-08-31, a week
    # after this table was written. The standard 3.00/15.00 is encoded instead:
    # it slightly over-records for that week and is exact from 1 September, which
    # is the safer direction and needs no diarised follow-up.
    "claude-sonnet-5": Rate(
        3.00,
        15.00,
        "2026-08-24",
        _ANTHROPIC_PRICING,
        "standard rate; intro 2.00/10.00 runs to 2026-08-31 and is not encoded",
    ),
    "claude-sonnet": Rate(3.00, 15.00, "2026-08-24", _ANTHROPIC_PRICING),
    # OD-62's last open row, and the suspicion did NOT hold: 10.00/30.00 is the
    # published rate for gpt-4-turbo-2024-04-09 ("Input: $10", "Output: $30"),
    # confirmed on both the pricing table and the model page. Two facts changed
    # around it, though. The "one live call site" OD-62 cites is gone — the only
    # OpenAI call site (auction_wine_service.py) now names gpt-4o, so this is a
    # historical row like the retired Gemini ones below, kept so old api_spend
    # rows stay re-costable. And the prefix still matches the gpt-4-turbo-preview
    # ids that call site used to pass, which carry the same 10.00/30.00.
    "gpt-4-turbo": Rate(
        10.00,
        30.00,
        "2026-08-25",
        _OPENAI_PRICING,
        "no live call site; kept to re-cost historical rows (OD-62)",
    ),
    # `gpt-4o` is deliberately ABSENT. auction_wine_service's OpenAI fallback now
    # names it, but OPENAI_API_KEY is empty, so the path cannot fire and its
    # pricing could not be checked against the API the way the Gemini names were.
    # Absent means is_priced_model() is False, so both ledgers book cost NULL with
    # cost_basis='unpriced_model' — an unknown cost, not an invented one. Add the
    # rate when a key exists and the number can be verified.
    "gemini-3.7-flash": Rate(
        0.75, 3.75, "2026-08-24", _GEMINI_PRICING, "DOUBLES to 1.50/7.50 2027-01-01"
    ),
    "gemini-3.6-flash": Rate(
        0.75, 3.75, "2026-08-24", _GEMINI_PRICING, "DOUBLES to 1.50/7.50 2027-01-01"
    ),
    "gemini-3.5-flash-lite": Rate(0.30, 2.50, "2026-08-24", _GEMINI_PRICING),
    "gemini-3.5-flash": Rate(1.50, 9.00, "2026-08-24", _GEMINI_PRICING),
    "gemini-3.1-flash-lite": Rate(0.25, 1.50, "2026-08-24", _GEMINI_PRICING),
    "gemini-2.5-flash-lite": Rate(0.10, 0.40, "2026-08-24", _GEMINI_PRICING),
    "gemini-2.5-flash": Rate(0.30, 2.50, "2026-08-24", _GEMINI_PRICING),
    "gemini-2.5-pro": Rate(1.25, 10.00, "2026-08-24", _GEMINI_PRICING),
    # RETIRED MODELS, KEPT ON PURPOSE. No call site names these any more
    # (2026-08-24), but historical api_spend rows do, and this table is how such
    # a row is ever re-costed. Deleting a rate does not delete the spend it
    # priced — it just makes the past unreadable. _rate_for()'s longest-match
    # ordering keeps them from shadowing any live id.
    "gemini-2.0-flash": Rate(
        0.075, 0.30, "2026-08-24", _GEMINI_PRICING, "retired by Google; historical"
    ),
    "gemini-pro": Rate(
        0.50, 1.50, "2026-08-24", _GEMINI_PRICING, "retired by Google; historical"
    ),
}


# Providers whose spend is derived from _RATES_PER_M by token count. Anything
# else (Serper's flat per-query fee) prices itself and must not be judged against
# this table — see the cost_basis guard in SpendLogger.log().
_TOKEN_PRICED_PROVIDERS = frozenset({"google", "anthropic", "openai"})


def _rate_for(model: str) -> Optional[Rate]:
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

    A 0.0 return is still ambiguous at THIS boundary — a float cannot say
    "unknown" — so callers must pair it with is_priced_model() whenever the
    distinction matters. SpendLogger.log() does, and since OD-61 it turns that
    pair into a real NULL in both ledgers rather than only in NF.
    """
    rate = _rate_for(model)
    if rate is None:
        return 0.0
    return (input_tokens * rate.input_per_m / 1_000_000) + (
        output_tokens * rate.output_per_m / 1_000_000
    )


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
        skill_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Insert one row into api_spend AND one into neural_footprint_event.

        Returns the neural_footprint_event row id, or None if the NF row was
        not written (OD-74). That id is the handle a later grader needs to
        attach a doneability verdict (ADR 0017) — without it the entire Python
        runtime, 43 of the instrument's 50 emit points, is unreachable by any
        verdict. Every existing call site ignores the return value and is
        unaffected; `log()` still never raises.

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
            skill_id: registry skill that fired, when one did (ADR 0039 A4).
                NF row only — api_spend has no such column. Left unset the key
                is omitted entirely, so the column stays NULL meaning "not a
                skill task", never "unknown".
            context: extra jsonb payload (wine_id, results_count, parse flags…)
        """
        # Bound BEFORE the outer try so every exit path can return it. There is
        # an early `return` when Supabase is unconfigured, and the outer except
        # swallows anything else — an unbound name here would turn the one
        # function that promises never to raise into an UnboundLocalError.
        nf_event_id: Optional[str] = None

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

            # An unpriced model has no rate in _RATES_PER_M, so estimate_llm_cost
            # returned 0.0 meaning "unknown" — not "free". Booking that 0.0 makes
            # every spend aggregate silently under-report, and worse, makes a
            # measurement gap indistinguishable from a genuinely free call.
            #
            # This used to be computed inside the NF block below and applied to NF
            # only, because api_spend.cost_usd was NOT NULL and had no way to say
            # "unknown" — so the PRIMARY ledger kept the defect that the secondary
            # one had already fixed (OD-61). The column is nullable as of
            # 20260825_api_spend_cost_usd_nullable.sql, so the determination is
            # hoisted here and both ledgers now record the same honest NULL.
            #
            # Three conditions, each closing a different way to be wrong:
            #
            #   provider gate  only token-priced providers get their cost FROM
            #                  this table. Serper bills a flat configured
            #                  per-query rate (Settings.serper_cost_per_query)
            #                  that is exactly known and has no business being
            #                  judged against a per-token table — nulling it
            #                  would delete real spend and mislabel it unknown,
            #                  which is the very defect this guard prevents.
            #   token gate     a call that consumed no tokens was never priced
            #                  from this table in the first place. Its 0.0 is
            #                  arithmetically true at any rate, so it stays 0.0.
            #   cost gate      a caller that supplied a real non-zero cost knows
            #                  something the table does not; that is a measured
            #                  figure, not an unknown, so it survives.
            unpriced = (
                provider in _TOKEN_PRICED_PROVIDERS
                and bool(input_tokens or output_tokens)
                and not cost_usd
                and not is_priced_model(model)
            )
            ledger_cost: Optional[float] = None if unpriced else cost_usd

            # 1) api_spend — primary ledger, written first, own try/except.
            try:
                supabase.table("api_spend").insert(
                    {
                        "provider": provider,
                        "model": model,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cost_usd": ledger_cost,
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

                # Same determination as api_spend above — one `unpriced` flag now
                # drives both ledgers, so they cannot disagree about whether a
                # call's cost is known. NF additionally records WHY, which
                # api_spend has no column for; that asymmetry is deliberate.
                if unpriced:
                    nf_context["cost_basis"] = "unpriced_model"

                row = build_agent_event(
                    subject_id=subject_id,
                    stimulus=stimulus or task_type or f"{provider}:{model}",
                    choice=choice or "completion",
                    outcome=outcome,
                    cost_usd=ledger_cost,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    duration_ms=duration_ms,
                    correlation_id=corr,
                    restaurant_id=restaurant_id,
                    skill_id=skill_id,
                    context=nf_context,
                )
                # never raises; returns the row id, or None on a counted drop
                nf_event_id = insert_event(supabase, row)
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

        # None whenever the NF row was not written, for any reason. A caller
        # holding an id for a row that does not exist would write a verdict
        # grading nothing.
        return nf_event_id


_spend_logger: Optional[SpendLogger] = None


def get_spend_logger() -> SpendLogger:
    """Return the shared SpendLogger singleton."""
    global _spend_logger
    if _spend_logger is None:
        _spend_logger = SpendLogger()
    return _spend_logger
