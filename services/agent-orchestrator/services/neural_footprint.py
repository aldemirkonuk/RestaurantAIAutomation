"""
Neural Footprint emitter — NF row construction + insert (ADR 0008, P1).
========================================================================
`SpendLogger.log()` is the SOLE dual-write entry point on the Python side
(P1-PYTHON-EMITTER Q1, option C): it writes `api_spend` first, then delegates
here for the `neural_footprint_event` row. This module owns NF row vocabulary
so the future NF-B guest writer shares row-building without importing spend
semantics.

Contract (migration 20260824141116_neural_footprint_event.sql):
- subject_type / subject_id / stimulus / choice are NOT NULL.
- outcome is one of success | failure | partial | NULL. NULL means UNKNOWN,
  never success (ADR 0008 accepted-risk 1).
- Day-one outcome grading is call-level, stamped
  context["outcome_basis"] = "call_level_v0" (founder decision, 2026-08-24).
- Raw prompts/outputs never go in stimulus/choice — compact descriptors only;
  details go in the `context` jsonb.

Never raises. Failed inserts are COUNTED (`get_drop_counts()`) and logged with
a running total, so silent gaps are visible instead of invisible.
"""

import logging
import threading
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

VALID_OUTCOMES = ("success", "failure", "partial")
OUTCOME_BASIS = "call_level_v0"

# Drop counters — process-wide, so gaps in the ledger are countable.
# Keyed by ledger: "api_spend" | "neural_footprint_event".
_drop_lock = threading.Lock()
_drop_counts: Dict[str, int] = {"api_spend": 0, "neural_footprint_event": 0}


def record_drop(ledger: str) -> int:
    """Count one lost row for `ledger`; returns the running total."""
    with _drop_lock:
        _drop_counts[ledger] = _drop_counts.get(ledger, 0) + 1
        return _drop_counts[ledger]


def get_drop_counts() -> Dict[str, int]:
    """Rows this process failed to write, per ledger. For health checks/tests."""
    with _drop_lock:
        return dict(_drop_counts)


def _is_uuid(value: Any) -> bool:
    try:
        _uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def build_agent_event(
    *,
    subject_id: str,
    stimulus: str,
    choice: str,
    outcome: Optional[str] = None,
    cost_usd: Optional[float] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    duration_ms: Optional[int] = None,
    correlation_id: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
    internal_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Build one `subject_type='agent'` neural_footprint_event row.

    - Invalid `outcome` values degrade to NULL (unknown) with the raw value
      preserved in context — NULL never means success, and a bad grade must
      not masquerade as one.
    - `restaurant_id` that is not a UUID is moved to context["restaurant_ref"]
      and the column is nulled. NOTE: this guards against garbage only — wine
      ids ARE valid UUIDs, so the restaurant_id=wine_id misuse is fixed at the
      call sites (they now pass restaurant_id=None with wine_id in context),
      not here.
    """
    ctx: Dict[str, Any] = dict(context or {})

    if outcome is not None and outcome not in VALID_OUTCOMES:
        ctx["outcome_invalid"] = str(outcome)[:100]
        outcome = None
    if outcome is not None:
        ctx.setdefault("outcome_basis", OUTCOME_BASIS)

    if restaurant_id is not None and not _is_uuid(restaurant_id):
        ctx["restaurant_ref"] = str(restaurant_id)[:100]
        restaurant_id = None

    return {
        "subject_type": "agent",
        "subject_id": str(subject_id) if subject_id else "unknown",
        "stimulus": str(stimulus)[:500] if stimulus else "unknown",
        "context": ctx,
        "internal_state": dict(internal_state or {}),
        "choice": str(choice)[:500] if choice else "unknown",
        "outcome": outcome,
        "cost_usd": cost_usd,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "duration_ms": duration_ms,
        "correlation_id": correlation_id,
        "restaurant_id": restaurant_id,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


def insert_event(supabase, row: Dict[str, Any]) -> bool:
    """
    Insert one NF row. Never raises; returns False (and counts the drop) on
    failure so the caller's pipeline is never interrupted by telemetry.
    """
    try:
        supabase.table("neural_footprint_event").insert(row).execute()
        return True
    except Exception as exc:
        total = record_drop("neural_footprint_event")
        logger.warning(
            "neural_footprint_event insert failed (non-fatal, drop #%d this "
            "process): %s",
            total,
            exc,
        )
        return False
