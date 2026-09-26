"""
House item research: the enrich chain works the queue
=====================================================

The founder, 2026-09-22 (round 6u), verbatim pick: "Existing enrich chain
(Recommended)" (ADR 0192, third amendment).

A house item the wine library lacks waits in ``house_item_research``
(migrations 20260926141000, 20260926141200), keyed by the house item's id.
This sweep hands the queued rows to the EXISTING submission chain,
``haiku_enrich_task`` -> ``web_verify_task``, linked by id:

1. ``claim_house_item_research()`` (SQL, service_role only) takes the oldest
   queued rows not yet handed off, under a lease and FOR UPDATE SKIP LOCKED,
   files ONE ``master_wine_library_submissions`` row per item (a row that
   already has one keeps it) and returns the submission id and the name the
   gateway's classifier judged researchable (``classified_name``). A
   placeholder (``not_findable``: "wine 1", "house red", a blank) is never
   claimed, so it is never researched.
2. Each submission id goes to ``haiku_enrich_task`` (keyed by that id; it
   queues ``web_verify_task`` itself).
3. ``dispatched_at`` is stamped after a hand-off succeeded, or
   ``last_dispatch_error`` when it did not (the row is claimed again after the
   lease, at most five times).

The queue row flips to ``matched`` in the database when its submission is
settled with a ``matched_master_id`` (a trigger, by the submission's id).

OFF BY DEFAULT, like ``research.dispatch_batch``: the chain spends money on
model calls and web searches, and switching that on is the founder's
keystroke (``HOUSE_ITEM_RESEARCH_DISPATCH_ENABLED=true``).

A failed claim is an ERROR, never an empty success: the RPC's exception
propagates and the task fails visibly.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Callable, Dict

from supabase import create_client

from config.settings import get_settings
from jobs.celery_app import celery_app

logger = logging.getLogger(__name__)

DISPATCH_FLAG = "HOUSE_ITEM_RESEARCH_DISPATCH_ENABLED"
BATCH_LIMIT = 10
LEASE_MINUTES = 30
MAX_ATTEMPTS = 5
ERROR_MAX = 500


def dispatch_enabled() -> bool:
    """Whether the sweep may hand rows to the chain. Off unless set to true."""
    return os.getenv(DISPATCH_FLAG, "false").strip().lower() == "true"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def dispatch_claimed(
    supabase: Any,
    hand_off: Callable[[str, str], None],
    limit: int = BATCH_LIMIT,
) -> Dict[str, int]:
    """
    Claim queued rows and hand each one's submission to the chain.

    ``hand_off(submission_id, name)`` queues the chain's first task. Returns
    counts. The claim RPC raising is not caught: a queue that cannot be read
    is an error, not "nothing to do".
    """
    claimed = (
        supabase.rpc(
            "claim_house_item_research",
            {
                "p_limit": limit,
                "p_lease_minutes": LEASE_MINUTES,
                "p_max_attempts": MAX_ATTEMPTS,
            },
        )
        .execute()
        .data
    ) or []

    handed = 0
    failed = 0
    unstamped = 0
    for row in claimed:
        research_id = row.get("research_id")
        submission_id = row.get("library_submission_id")
        name = (row.get("name_to_research") or "").strip()
        if not research_id or not submission_id or not name:
            # Never researched without its classified name and its submission.
            failed += 1
            logger.error(
                "house_item_research: claimed row %s came back without a submission or a name; not handed off",
                research_id,
            )
            continue
        try:
            hand_off(submission_id, name)
        except Exception as exc:  # the broker refused the task
            failed += 1
            reason = f"the enrich chain could not be given this item ({exc})"[
                :ERROR_MAX
            ]
            logger.error(
                "house_item_research: row %s (submission %s) not handed off: %s",
                research_id,
                submission_id,
                exc,
            )
            try:
                (
                    supabase.table("house_item_research")
                    .update(
                        {"last_dispatch_error": reason, "dispatch_claimed_at": None}
                    )
                    .eq("id", research_id)
                    .is_("dispatched_at", "null")
                    .execute()
                )
            except Exception as write_exc:
                logger.error(
                    "house_item_research: row %s's failed hand-off could not be recorded: %s",
                    research_id,
                    write_exc,
                )
            continue
        handed += 1
        try:
            (
                supabase.table("house_item_research")
                .update({"dispatched_at": _now_iso(), "last_dispatch_error": None})
                .eq("id", research_id)
                .eq("submission_id", submission_id)
                .is_("dispatched_at", "null")
                .execute()
            )
        except Exception as write_exc:
            # The chain has the item; the stamp is missing, so the lease will
            # expire and the same submission (never a second one) is handed
            # out again. Logged, never read as stamped.
            unstamped += 1
            logger.error(
                "house_item_research: row %s was handed off, but dispatched_at could not be stamped: %s",
                research_id,
                write_exc,
            )

    return {
        "claimed": len(claimed),
        "handed": handed,
        "failed": failed,
        "unstamped": unstamped,
    }


@celery_app.task(name="house_item_research.dispatch", bind=True, max_retries=0)
def dispatch_house_item_research(self) -> Dict[str, Any]:
    """Celery beat entry: hand queued house items to the enrich chain."""
    if not dispatch_enabled():
        logger.info(
            "house_item_research.dispatch: off (%s is not true); nothing handed off",
            DISPATCH_FLAG,
        )
        return {"enabled": False}

    from jobs.haiku_tasks import haiku_enrich_task

    settings = get_settings()
    supabase = create_client(settings.supabase_url, settings.supabase_key)

    def hand_off(submission_id: str, name: str) -> None:
        haiku_enrich_task.delay(wine_id=submission_id, wine_name=name, vintage=None)

    counts = dispatch_claimed(supabase, hand_off)
    logger.info("house_item_research.dispatch: %s", counts)
    return {"enabled": True, **counts}
