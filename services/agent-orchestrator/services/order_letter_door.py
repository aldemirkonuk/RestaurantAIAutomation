"""The one door for an order's vendor letter (ADR 0266, owner-quarter sim F-106).

Two agents used to stage a waiting letter for the same order: the create-time
letter (ProviderCommunicationAgent._handle_order_created) and the
approval-time ``order_inquiry`` letter (ProviderConversationAgent, from
approveOrder's ``procurement.conversation_request``). Nothing fenced them, so
an order could hold two waiting drafts, and every reader that assumes one
failed (approveDraft answered 404 "No pending draft found").

Both inserts now go through ``public.stage_order_letter`` (migration
``an_order_letter_is_staged_once``). Under a per-order advisory lock it writes
nothing when the order already has a live outbound letter and returns that
row's id; otherwise it inserts. Whichever agent writes first wins, and the
second write never happens. The database is the authority: a Python
check-then-insert cannot be, because the two agents run in different
processes and either can land first.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

# The statuses ``stage_order_letter`` treats as "this order already has its
# letter". Kept in step with the migration by
# tests/test_one_letter_per_order.py, which reads the SQL.
ORDER_LETTER_LIVE_STATUSES: Tuple[str, ...] = (
    "PENDING_APPROVAL",
    "AUTO_SEND_SCHEDULED",
    "AUTO_SENDING",
    "SENDING",
    "SENT",
    "AUTO_SENT",
    "SEND_UNCONFIRMED",
)


class OrderLetterDoorMissing(RuntimeError):
    """PostgREST does not know ``stage_order_letter`` (PGRST202).

    Only expected in the minutes between this code deploying and its
    migration applying. The caller decides what a letter does then.
    """


def _is_missing_function(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    if code == "PGRST202":
        return True
    return "PGRST202" in str(exc)


def stage_order_letter(
    supabase: Any, row: Dict[str, Any], kind: Optional[str] = None
) -> Tuple[str, bool]:
    """Stage ``row`` as the order's letter unless one is already live.

    Returns ``(conversation_id, staged)``. ``staged`` is False when the order
    already had a live outbound letter (of type ``kind`` when given); the id is
    then that letter's, and nothing was written.

    Raises ``OrderLetterDoorMissing`` when the function is not deployed yet,
    and lets every other error propagate: a letter that could not be staged
    must not be reported as staged.
    """
    try:
        result = supabase.rpc(
            "stage_order_letter", {"p_row": row, "p_kind": kind}
        ).execute()
    except Exception as exc:
        if _is_missing_function(exc):
            raise OrderLetterDoorMissing(str(exc)) from exc
        raise
    data = getattr(result, "data", None)
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict) or not data.get("id"):
        raise RuntimeError(f"stage_order_letter returned no id: {data!r}")
    return str(data["id"]), bool(data.get("staged"))


def live_order_letter_id(
    supabase: Any, restaurant_id: str, order_id: str
) -> Optional[str]:
    """Read-only: the id of the order's live outbound letter, if any.

    For an early skip before any model call. It is not a fence (another writer
    can land a moment later); ``stage_order_letter`` stays the authority.
    """
    result = (
        supabase.table("procurement_conversations")
        .select("id")
        .eq("restaurant_id", restaurant_id)
        .eq("order_id", order_id)
        .ilike("direction", "outbound")
        .in_("status", list(ORDER_LETTER_LIVE_STATUSES))
        .limit(1)
        .execute()
    )
    rows = getattr(result, "data", None) or []
    return str(rows[0]["id"]) if rows else None
