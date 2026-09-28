#!/usr/bin/env python3
"""Give the roster rows their names back, from the accounts they are linked to.

WHAT WENT WRONG, MEASURED
-------------------------
Every roster row in the demo tenant read "Team member" — 3 of 3 on 2026-09-04 —
while `GET /restaurants/:rid/members`, a different module reading the SAME three
user ids, returned "Demo User", "Sarah Johnson" and "David Chen".

`team.service.ts` asked `public.users` for an `avatar_url` that table has never
had (baseline `20260805000000_baseline_from_production.sql:5848-5861`).
PostgREST answered 42703; the destructure dropped `error`; `data` came back
`null`. That did two things. The read returned `linkedUser: null` for everyone —
fixed the same day. And `ensureRosterFromAccess` fell through its name
expression and WROTE the literal `"Team member"` into `display_name`, which is
NOT NULL (baseline `:5632`).

Fixing a read does not rename a row. This script renames the rows.

WHY A SCRIPT AND NOT A MIGRATION
--------------------------------
A migration runs automatically on merge. Renaming people in a live database is
not something to do as a side effect of a deploy: it should be read first, run
by hand, on the founder's word. It is also not deterministic across
environments — which rows carry the placeholder depends on when each tenant was
backfilled.

WHAT IT WILL AND WILL NOT DO
----------------------------
It proposes ONE name per row: the linked `public.users.name`. That is the name
the backfill was trying to copy and failed to read — a lookup of a fact that
already exists, not a guess about what someone is called.

It will NOT invent a name from an email local-part, a position, or anything
else. A row whose linked account has no usable name is REPORTED and left alone;
`/team` renders it as "no name on file", which is true, and a manager types the
real one into the Edit sheet.

It will not touch a row whose `display_name` is anything other than the exact
placeholder — including a row where somebody has since typed a real name.

USAGE
-----
    python3 scripts/repair_team_member_names.py                  # dry run
    python3 scripts/repair_team_member_names.py --restaurant ID  # one tenant
    python3 scripts/repair_team_member_names.py --apply          # write

Environment (read from the nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Exit codes: 0 nothing to do or done; 1 a required input is missing; 2 at least
one write failed (the report says which — a partial run is never reported as a
clean one).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

# The exact literal `ensureRosterFromAccess` writes when it cannot read the
# linked account. Matched exactly, and never as a prefix or case-insensitively:
# somebody's roster row could legitimately say "Team member (agency)".
PLACEHOLDER = "Team member"

# Written into `notes` beside the repaired name, so the change is legible on the
# row itself and not only in whatever log happened to catch this run.
PROVENANCE = "repaired from the linked account 2026-09-04"


def load_dotenv_upward(start: Path, keys: tuple[str, ...]) -> None:
    """Populate os.environ from the nearest .env that mentions any of `keys`.

    Existing process environment always wins — a script run with an explicit
    variable must not have it silently replaced by a checked-out file.
    """
    for directory in [start, *start.parents]:
        candidate = directory / ".env"
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        if not any(k in text for k in keys):
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            name = name.strip()
            value = value.strip().strip('"').strip("'")
            if name and name not in os.environ:
                os.environ[name] = value
        return


def usable(name: Any) -> str | None:
    """A name we would be willing to write, or None.

    The placeholder itself is excluded on purpose: `users.name` is NOT NULL, and
    a users row that also says "Team member" would otherwise let this script
    launder the literal from one table into another and call it a repair.
    """
    if not isinstance(name, str):
        return None
    trimmed = name.strip()
    if not trimmed or trimmed == PLACEHOLDER:
        return None
    return trimmed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replace the roster placeholder with the linked account's name."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the names. Without it nothing is written and the rows are only listed.",
    )
    parser.add_argument("--restaurant", help="limit to one restaurant id")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_upward(repo_root, ("SUPABASE_SERVICE_ROLE_KEY",))

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", supabase_key),
        )
        if not value
    ]
    if missing:
        print(f"MISSING: {', '.join(missing)} — cannot read the roster.")
        return 1

    try:
        from supabase import create_client
    except ImportError:
        print("MISSING: the `supabase` package. pip install supabase")
        return 1

    client = create_client(supabase_url, supabase_key)

    query = client.table("team_members").select(
        "id, restaurant_id, user_id, display_name, email, notes"
    ).eq("display_name", PLACEHOLDER)
    if args.restaurant:
        query = query.eq("restaurant_id", args.restaurant)
    rows = query.order("restaurant_id").execute().data or []

    if not rows:
        print(f'No roster row carries the placeholder "{PLACEHOLDER}". Nothing to repair.')
        return 0

    # `public.users`, never `auth.users`: the two tables are disjoint and the
    # roster's `user_id` is a `public.users.user_id`. And only the columns that
    # table actually has — asking for `avatar_url` here is the whole bug.
    user_ids = sorted({r["user_id"] for r in rows if r.get("user_id")})
    users: dict[str, dict[str, Any]] = {}
    if user_ids:
        fetched = (
            client.table("users")
            .select("user_id, name, email")
            .in_("user_id", user_ids)
            .execute()
            .data
            or []
        )
        users = {u["user_id"]: u for u in fetched}

    repairable: list[tuple[dict[str, Any], str]] = []
    unnameable: list[tuple[dict[str, Any], str]] = []
    for row in rows:
        uid = row.get("user_id")
        if not uid:
            unnameable.append((row, "the roster row is linked to no account"))
            continue
        account = users.get(uid)
        if account is None:
            unnameable.append((row, "no public.users row exists for the linked id"))
            continue
        name = usable(account.get("name"))
        if name is None:
            unnameable.append((row, "the linked account has no usable name"))
            continue
        repairable.append((row, name))

    print(f"{len(rows)} roster row(s) carry the placeholder.\n")
    print(f"  repairable                 {len(repairable)}")
    print(f"  staying 'no name on file'  {len(unnameable)}\n")

    if repairable:
        print("WOULD RENAME" if not args.apply else "RENAMING")
        for row, name in repairable:
            print(
                f'  {row["id"]}  {row["restaurant_id"]}  "{PLACEHOLDER}" -> "{name}"'
                f"   [{PROVENANCE}]"
            )
        print()

    if unnameable:
        # Named individually. Each of these is a person whose name nobody has
        # ever written down, and the page says exactly that; listing them as a
        # count would make them look pending rather than unknown.
        print("LEAVING ALONE — /team renders these as 'no name on file'")
        for row, why in unnameable:
            print(f'  {row["id"]}  {row["restaurant_id"]}  {why}')
        print()

    if not args.apply:
        print("Dry run. Nothing was written. Re-run with --apply to write.")
        return 0

    failures: list[tuple[str, str]] = []
    for row, name in repairable:
        note = row.get("notes")
        stamped = f"{note}\n{PROVENANCE}".strip() if note else PROVENANCE
        try:
            # Guarded by `display_name` as well as `id`: if somebody typed a
            # real name between the read above and this write, that name wins
            # and this update matches nothing.
            result = (
                client.table("team_members")
                .update({"display_name": name, "notes": stamped})
                .eq("id", row["id"])
                .eq("display_name", PLACEHOLDER)
                .execute()
            )
            if not (result.data or []):
                failures.append((row["id"], "no row matched — the name changed under us"))
        except Exception as exc:  # noqa: BLE001 - reported, never swallowed
            failures.append((row["id"], f"{type(exc).__name__}: {exc}"))

    written = len(repairable) - len(failures)
    print(f"{written} row(s) renamed.")
    if failures:
        print(f"\n{len(failures)} FAILED:")
        for member_id, why in failures:
            print(f"  {member_id}  {why}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
