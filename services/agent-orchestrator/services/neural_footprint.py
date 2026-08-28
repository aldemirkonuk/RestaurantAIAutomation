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
- skill_id is nullable forever (20260828103059_nf_skill_id.sql) and the key is
  omitted from the row entirely when unset — NULL there means "not a skill
  task", never "unknown" and never a failure.

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
    skill_id: Optional[str] = None,
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
    - `skill_id` names the registry skill that fired, when one did. It is
      OMITTED from the row entirely when unset — see below.
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

    row: Dict[str, Any] = {
        # Minted here rather than read back from the insert (OD-74). The table
        # defaults to gen_random_uuid(), so this changes nothing about the row —
        # but it means the id exists BEFORE the write, which is what lets a
        # caller hold onto it. Reading it back would work too and is what
        # BaseAgent.log_decision does; minting is chosen because it costs no
        # RETURNING round-trip on a path that runs on every model call.
        "id": str(_uuid.uuid4()),
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

    # ADDED ONLY WHEN SET, and that is a correctness requirement rather than
    # tidiness. `skill_id` is nullable forever (migration 20260828103059) because
    # most events are not a skill firing — but this insert goes through PostgREST,
    # which rejects the WHOLE row for an unknown column. Sending `skill_id: None`
    # unconditionally would therefore drop every NF row in any environment where
    # the migration has not landed yet, turning an optional passthrough into an
    # outage of the instrument. Omitting the key leaves the column at its NULL
    # default, which is the same stored row with none of that risk.
    if skill_id:
        row["skill_id"] = str(skill_id)[:100]

    return row


def insert_event(supabase, row: Dict[str, Any]) -> Optional[str]:
    """
    Insert one NF row. Never raises.

    Returns the row id on success and None on failure (OD-74). It previously
    returned a bare bool, which discarded the only handle a later grader could
    use — so a doneability verdict (ADR 0017) had nothing to attach to on the
    Python side, covering the gateway's 7 emit points and none of Python's 43.
    `correlation_id` is not a substitute: several agents emit two rows under one
    id (e.g. email_intel_agent.py:335 and :404).

    None on failure is the honest contract, and it matches the gateway's
    NfEventRef settling null on a dropped emit: an id whose row does not exist
    would produce a verdict grading nothing. The nf_verdict FK is the backstop.

    Truthiness is preserved for existing callers — a uuid string is truthy and
    None is falsy, so `if insert_event(...)` reads the same as it always did.
    """
    try:
        supabase.table("neural_footprint_event").insert(row).execute()
        return row.get("id")
    except Exception as exc:
        total = record_drop("neural_footprint_event")
        logger.warning(
            "neural_footprint_event insert failed (non-fatal, drop #%d this "
            "process): %s",
            total,
            exc,
        )
        return None


def record_verdict(
    supabase,
    event_id: str,
    basis: str,
    outcome: Optional[str],
    evidence: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Write one task-level doneability verdict over an existing NF row. Never raises.

    The Python mirror of the gateway's `NfVerdictService` (ADR 0017). Until this
    existed, Python could emit events and had no way to grade them, so a
    DEFERRED grader — one that only learns the answer minutes later, in another
    process — had nowhere to put it.

    `basis` names the grader IN THE ROW, and the table is keyed
    `(event_id, basis)`, so re-running the same grader is idempotent and a
    genuinely different grader lands as a SECOND row with its disagreement
    intact. That is the whole reason verdicts are a sidecar and not a column.

    Failure posture matches `insert_event`: a warn and a drop counter, never an
    exception. The instrument must not break the thing it measures — a verdict
    that cannot be written shows up honestly as uncovered, while a raised one
    would kill a Celery task doing real work.

    Returns True on success, False on any failure — including an event_id that
    is not a uuid, which the FK would reject anyway.
    """
    if not _is_uuid(event_id):
        return False
    try:
        supabase.table("nf_verdict").upsert(
            {
                "event_id": event_id,
                "basis": basis,
                "outcome": outcome,
                "evidence": evidence or {},
            },
            on_conflict="event_id,basis",
        ).execute()
        return True
    except Exception as exc:
        total = record_drop("nf_verdict")
        logger.warning(
            "nf_verdict upsert failed (non-fatal, drop #%d this process): %s",
            total,
            exc,
        )
        return False
