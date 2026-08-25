"""
Notification writes for agents.

WHY THIS EXISTS

The `notifications` table carries two generations of columns. The app reads
`user_id` / `type` / `status`, but the original NOT NULL columns are still on the
live table with no defaults:

    recipient_id        uuid          NOT NULL
    notification_type   varchar       NOT NULL
    channels            text[]        NOT NULL

Both Python agents that notify a manager omitted all three, so every insert died
on a not-null violation inside a try/except that only logged. Verified against the
live database:

    INSERT INTO notifications (restaurant_id, type, title, message, status, metadata) ...
    ERROR: 23502: null value in column "recipient_id" violates not-null constraint

The consequence was invisible by construction: unknown-sender alerts (PROVINT-04)
and provider-communication notices were written nowhere, and the only trace was an
error line in the orchestrator log. A caught exception around a write that always
fails is indistinguishable from a feature nobody triggers.

The api-gateway had already solved this in NotificationsService.persistForRestaurant
— resolve the restaurant's members, then write one row per member with the legacy
columns populated. This mirrors that so the two runtimes cannot drift into writing
different shapes to the same table, which is how the original mismatch arose.
"""

from typing import Any, Dict, List, Optional


# The app reads user_id/type/status; these three are legacy NOT NULL columns that
# must still be filled or the insert is rejected outright.
_IN_APP_CHANNELS = ["in_app"]


async def resolve_restaurant_member_ids(database: Any, restaurant_id: str) -> List[str]:
    """
    User ids belonging to a restaurant, for use as notification recipients.

    Tries user_restaurant_access first (the multi-tenant membership table) and
    falls back to the restaurant's owner. Returns [] when neither resolves — the
    caller must treat that as "cannot notify", not as success.
    """
    try:
        access = (
            database.supabase.table("user_restaurant_access")
            .select("user_id")
            .eq("restaurant_id", restaurant_id)
            .execute()
        )
        ids = [r["user_id"] for r in (access.data or []) if r.get("user_id")]
        if ids:
            return ids
    except Exception:
        # Fall through to the owner lookup rather than failing the notification;
        # a missing membership table is not a reason to lose the alert.
        pass

    try:
        owner = (
            database.supabase.table("restaurants")
            .select("owner_id")
            .eq("id", restaurant_id)
            .limit(1)
            .execute()
        )
        rows = owner.data or []
        if rows and rows[0].get("owner_id"):
            return [rows[0]["owner_id"]]
    except Exception:
        pass

    return []


async def notify_restaurant(
    database: Any,
    logger: Any,
    restaurant_id: str,
    notification_type: str,
    title: str,
    message: str,
    *,
    priority: str = "medium",
    action_url: Optional[str] = None,
    action_label: Optional[str] = None,
    group_key: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> int:
    """
    Write one notification per restaurant member. Returns the number inserted.

    Returns 0 rather than raising, but LOGS AT WARNING with the reason — the
    previous behaviour swallowed a permanent failure at debug-ish level, so a
    write that could never succeed looked like a quiet feature. A zero return with
    no members is a real condition the caller may want to act on.
    """
    user_ids = await resolve_restaurant_member_ids(database, restaurant_id)
    if not user_ids:
        logger.warning(
            "notification not written: no members resolved for restaurant",
            extra={"restaurant_id": restaurant_id, "type": notification_type},
        )
        return 0

    rows = [
        {
            "user_id": user_id,
            # Legacy NOT NULL columns. Omitting any one of these rejects the row.
            "recipient_id": user_id,
            "notification_type": notification_type,
            "channels": _IN_APP_CHANNELS,
            "restaurant_id": restaurant_id,
            "type": notification_type,
            "title": title[:500],
            "message": message,
            "priority": priority,
            "status": "unread",
            "action_url": action_url,
            "action_label": action_label,
            "group_key": group_key,
            "metadata": metadata or {},
        }
        for user_id in user_ids
    ]

    try:
        database.supabase.table("notifications").insert(rows).execute()
        return len(rows)
    except Exception as exc:
        logger.error(
            "notification insert failed",
            extra={
                "restaurant_id": restaurant_id,
                "type": notification_type,
                "error": str(exc),
            },
        )
        return 0
