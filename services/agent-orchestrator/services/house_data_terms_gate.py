"""
Whether a look-up built from a house's own list may leave for an outside host.

THE FOUNDER, 2026-09-25 (web-rebuild item 33), verbatim: "if they accept terms
and conditions then yes, we can access their menu and so on". So a search
whose words come from a house's list (a wine's producer, name and vintage sent
to Serper) is the house's data, and it may leave only once an owner of that
house has accepted data terms that NAME the host it goes to (ADR 0224, the
narrowed `public` rule; ADR 0207 round 4 for the acceptance itself).

How "accepted" is read: the house's latest row in
`house_data_terms_acceptances` (migration 20260926150200) carries the exact
terms the owner accepted in `terms_snapshot`, subprocessors included. The
look-up is allowed when that snapshot names the host -- itself or a parent
domain, the same rule `scripts/check_data_terms_name_every_host.py` uses. Reading
the snapshot, not a version number, means this runtime never has to be told
the gateway's `TERMS_VERSION`: what the owner saw is what is checked.

What it deliberately does NOT do:
  - It does not require the CURRENT terms version. An owner who accepted a
    version naming the host has agreed to that host; a later version that
    re-words other rows does not withdraw it. (The gateway's Jev switch, by
    contrast, pauses on every version bump -- ADR 0207 round 4.)
  - A row with no house (`restaurant_id` NULL: Mudavym's own library work) is
    not a house's data, so it is allowed with reason `no_house`.

Fails CLOSED: an unreadable store is "not allowed", never "allowed".
"""

from __future__ import annotations

import logging
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)

# The web-search host every product look-up goes to (services/serper_client.py:74).
SERPER_HOST = "google.serper.dev"

ACCEPTANCES_TABLE = "house_data_terms_acceptances"


def snapshot_names_host(snapshot: Any, host: str) -> bool:
    """True when an accepted terms snapshot has a subprocessor row whose
    comma-separated `host` names `host` (equal, or a parent domain of it)."""
    if not isinstance(snapshot, dict):
        return False
    rows = snapshot.get("subprocessors")
    if not isinstance(rows, list):
        return False
    want = host.strip().lower()
    for row in rows:
        if not isinstance(row, dict):
            continue
        field = row.get("host")
        if not isinstance(field, str):
            continue
        for named in (h.strip().lower() for h in field.split(",")):
            if named and (want == named or want.endswith("." + named)):
                return True
    return False


def outside_lookup_allowed(
    supabase: Any, restaurant_id: Optional[str], host: str
) -> Tuple[bool, str]:
    """(allowed, reason) for sending a look-up built from `restaurant_id`'s
    records to `host`.

    Reasons: `no_house`, `accepted`, `terms_not_accepted`,
    `terms_do_not_name_host`, `terms_unreadable`.
    """
    if not restaurant_id:
        return True, "no_house"
    try:
        resp = (
            supabase.table(ACCEPTANCES_TABLE)
            .select("terms_version, terms_snapshot")
            .eq("restaurant_id", str(restaurant_id))
            .order("terms_version", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:  # the store could not be read: fail closed
        logger.warning(
            "house_data_terms_gate: acceptance unreadable for a house (%s) -- "
            "look-up to %s withheld",
            type(exc).__name__,
            host,
        )
        return False, "terms_unreadable"
    if not rows:
        return False, "terms_not_accepted"
    if not snapshot_names_host(rows[0].get("terms_snapshot"), host):
        return False, "terms_do_not_name_host"
    return True, "accepted"
