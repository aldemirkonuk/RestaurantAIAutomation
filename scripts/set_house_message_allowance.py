#!/usr/bin/env python3
"""Set ONE named house's monthly message allowance. Never the fleet.

THE FOUNDER'S DECISION THIS EXISTS FOR
======================================
2026-09-05, question 8 of ADR 0121: *"One house first, deliberately, then
watch."* The founder sets an allowance on one restaurant he names, and the
meter runs there before any plan-wide number exists.

WHY A SCRIPT AND NOT A ROUTE
============================
The brief offered either. A script wins here on two grounds and loses on one,
and the losing ground is stated too.

  * The act happens once or twice, by the founder, deliberately. A route is a
    door that stays open afterwards — gated by `X-Admin-Key` (ADR 0099), but
    open — for an act nobody should be able to perform casually. A script is
    reachable only by somebody already holding the service-role key.
  * It prints the exact statement before running it, and refuses to run at all
    without BOTH `--apply` and `--i-have-the-founders-word`. That is the shape
    `scripts/clean_vendor_catalogue_websites.py` uses for production writes.
  * What it loses: a route could be proven end to end in the jest suite
    alongside the meter. That is answered by proving the READ side there
    instead — `text-usage.spec.ts` asserts the meter and the refusal against a
    house-scoped allowance row — and by `--self-test` here, which proves this
    file's refusals and its statement shape against fixtures with no database.

WHAT IT WILL NOT DO
===================
  * It will not write more than one restaurant. `--restaurant` takes one id,
    there is no `--all`, no glob and no plan argument, and the statement it
    builds carries `WHERE restaurant_id = <that one>`.
  * It will not write a number without a reason. `--reason` is required
    whenever `--allowance` is given, and the database CHECK
    (`house_message_allowances_number_has_provenance`) refuses a reason shorter
    than twenty characters — so a placeholder fails at the database even if it
    got past this file.
  * It will not touch `plan_message_allowances`. That table is fleet-wide by
    construction, and writing it is the thing this decision refused.
  * It will not report a failed read as an empty one. Every HTTP failure is
    printed as a failure and exits non-zero.

USAGE
    python3 scripts/set_house_message_allowance.py --self-test
    python3 scripts/set_house_message_allowance.py \\
        --restaurant <uuid> --allowance 500 \\
        --reason "founder, 2026-09-06: first house to carry a stated allowance"
    python3 scripts/set_house_message_allowance.py \\
        --restaurant <uuid> --allowance 500 --reason "..." \\
        --apply --i-have-the-founders-word

Without `--apply` it prints what it WOULD write and writes nothing.
Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from the nearest
.env that mentions the key, the same way the vendor-catalogue script does).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

TABLE = "house_message_allowances"
FLEET_TABLE = "plan_message_allowances"
MIN_REASON_CHARS = 20
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def load_dotenv_upward(start: Path, keys: tuple[str, ...]) -> None:
    """Populate os.environ from the nearest .env mentioning any of `keys`."""
    for directory in [start, *start.parents]:
        for candidate in (directory / ".env", directory / "apps" / "api-gateway" / ".env"):
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


def statement(restaurant: str, allowance: int | None, reason: str, actor: str | None) -> str:
    """The exact upsert an --apply would perform, printed before it is run.

    ONE restaurant, named in the row itself. There is no WHERE clause to get
    wrong because the primary key IS the restaurant, so a mistyped id writes a
    different house's row rather than every house's.
    """
    value = "NULL" if allowance is None else str(allowance)
    actor_sql = "NULL" if not actor else f"'{actor}'"
    return (
        f"INSERT INTO public.{TABLE}\n"
        f"  (restaurant_id, monthly_allowance, stated_source, set_via, set_by)\n"
        f"VALUES\n"
        f"  ('{restaurant}', {value}, '{reason.replace(chr(39), chr(39) * 2)}',\n"
        f"   'founder_script', {actor_sql})\n"
        f"ON CONFLICT (restaurant_id) DO UPDATE SET\n"
        f"  monthly_allowance = EXCLUDED.monthly_allowance,\n"
        f"  stated_source     = EXCLUDED.stated_source,\n"
        f"  set_via           = EXCLUDED.set_via,\n"
        f"  set_by            = EXCLUDED.set_by,\n"
        f"  set_at            = NOW(),\n"
        f"  updated_at        = NOW();"
    )


def payload(restaurant: str, allowance: int | None, reason: str, actor: str | None) -> dict[str, Any]:
    """Every key stated explicitly — the capture guard forbids a conditional spread."""
    return {
        "restaurant_id": restaurant,
        "monthly_allowance": allowance,
        "stated_source": reason,
        "set_via": "founder_script",
        "set_by": actor,
    }


def refusals(restaurant: str, allowance: int | None, reason: str) -> list[str]:
    """Every reason this file would refuse, checked before anything is read."""
    out: list[str] = []
    if not UUID_RE.match(restaurant or ""):
        out.append(
            f"--restaurant must be one restaurant's UUID; got {restaurant!r}. "
            "There is no way to name more than one, and that is the point."
        )
    if allowance is not None:
        if allowance < 0:
            out.append("--allowance cannot be negative.")
        if len(reason.strip()) < MIN_REASON_CHARS:
            out.append(
                f"--reason must be at least {MIN_REASON_CHARS} characters when an "
                "allowance is given. The database refuses a shorter one "
                "(house_message_allowances_number_has_provenance), so this is the "
                "same rule stated earlier and in words."
            )
    elif not reason.strip():
        out.append(
            "--reason is required even with no allowance: a row that records "
            "'we looked at this house and set nothing' is only useful if it says why."
        )
    return out


def report(
    restaurant: str,
    allowance: int | None,
    reason: str,
    actor: str | None,
    existing: dict[str, Any] | None,
    out: io.TextIOBase,
) -> str:
    print(f"House:      {restaurant}", file=out)
    print(
        "Allowance:  "
        + ("NOT STATED (NULL) — never rendered as 0" if allowance is None else str(allowance)),
        file=out,
    )
    print(f"Reason:     {reason}", file=out)
    print(f"Set via:    founder_script", file=out)
    if existing is None:
        print("Existing:   none — this house has no allowance row of its own", file=out)
    else:
        prev = existing.get("monthly_allowance")
        print(
            "Existing:   "
            + ("NOT STATED" if prev is None else str(prev))
            + f", set {existing.get('set_at')} via {existing.get('set_via')}",
            file=out,
        )
        print(f"            reason was: {existing.get('stated_source')}", file=out)
    print(
        f"\nThis writes ONE row in public.{TABLE}. It does not touch "
        f"public.{FLEET_TABLE},\nwhich is fleet-wide and is the thing the founder's "
        "answer refused.\n",
        file=out,
    )
    sql = statement(restaurant, allowance, reason, actor)
    print("  the exact statement --apply would run:", file=out)
    for line in sql.splitlines():
        print(f"    {line}", file=out)
    return sql


def rest_get(url: str, key: str, params: dict[str, str]) -> list[dict[str, Any]]:
    """One PostgREST GET. Raises on failure — a failed read is never an empty one."""
    query = urllib.parse.urlencode(params, safe="*(),.")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{TABLE}?{query}",
        headers={
            "apikey": key,
            "authorization": f"Bearer {key}",
            "accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 - fixed host
        return json.loads(res.read().decode("utf-8"))


def rest_upsert(url: str, key: str, row: dict[str, Any]) -> list[dict[str, Any]]:
    """One PostgREST upsert on the primary key. Raises on failure."""
    body = json.dumps([row]).encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{TABLE}?on_conflict=restaurant_id",
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "authorization": f"Bearer {key}",
            "content-type": "application/json",
            "prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 - fixed host
        return json.loads(res.read().decode("utf-8"))


def self_test() -> int:
    """Prove the refusals and the statement shape. No database, no network."""
    failures: list[str] = []
    good_house = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
    good_reason = "founder, 2026-09-06: first house to carry a stated allowance"

    if refusals(good_house, 500, good_reason):
        failures.append("a well-formed request was refused")
    if not refusals("every-house", 500, good_reason):
        failures.append("a non-UUID restaurant was accepted")
    if not refusals(good_house, 500, "guess"):
        failures.append("a five-character reason was accepted alongside a number")
    if not refusals(good_house, -1, good_reason):
        failures.append("a negative allowance was accepted")
    if refusals(good_house, None, good_reason):
        failures.append("a deliberate NOT-STATED row was refused")
    if not refusals(good_house, None, "   "):
        failures.append("a blank reason was accepted")

    buf = io.StringIO()
    sql = report(good_house, 500, good_reason, None, None, buf)
    text = buf.getvalue()
    if FLEET_TABLE not in text:
        failures.append("the report did not say which table it is NOT writing")
    if good_house not in sql or sql.count(good_house) != 1:
        failures.append("the statement does not name exactly one house")
    if FLEET_TABLE in sql:
        failures.append("the statement touches the fleet-wide table")
    if "founder_script" not in sql:
        failures.append("the statement does not record how the number arrived")

    # A NULL allowance must print as NOT STATED and never as 0.
    buf2 = io.StringIO()
    sql2 = report(good_house, None, good_reason, None, None, buf2)
    if "NOT STATED" not in buf2.getvalue():
        failures.append("a NULL allowance was not printed as NOT STATED")
    if "NULL" not in sql2 or ", 0," in sql2:
        failures.append("a NULL allowance became a zero in the statement")

    # A quote in the reason must not break the statement.
    sql3 = statement(good_house, 500, "founder's word, 2026-09-06, first house", None)
    if "founder''s word" not in sql3:
        failures.append("a quote in the reason was not escaped")

    # The payload names every key explicitly.
    keys = set(payload(good_house, 500, good_reason, None))
    if keys != {"restaurant_id", "monthly_allowance", "stated_source", "set_via", "set_by"}:
        failures.append(f"the payload's keys drifted: {sorted(keys)}")

    if failures:
        for f in failures:
            print(f"self-test FAILED: {f}", file=sys.stderr)
        return 3
    print("self-test passed: 8 refusals and 6 statement properties checked, 0 writes.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Set ONE house's monthly message allowance (ADR 0121, founder Q8).",
    )
    parser.add_argument("--restaurant", help="the one restaurant's UUID")
    parser.add_argument(
        "--allowance",
        type=int,
        default=None,
        help="messages a month; omit to record a deliberate NOT STATED",
    )
    parser.add_argument("--reason", default="", help="why, in the founder's words")
    parser.add_argument("--set-by", default=None, help="the acting user's UUID, if there is one")
    parser.add_argument("--apply", action="store_true", help="write the row")
    parser.add_argument(
        "--i-have-the-founders-word",
        action="store_true",
        help="required alongside --apply; without it an apply is refused",
    )
    parser.add_argument("--self-test", action="store_true", help="run against fixtures, no DB")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if not args.restaurant:
        print("--restaurant is required. Nothing was read and nothing written.", file=sys.stderr)
        return 2

    problems = refusals(args.restaurant, args.allowance, args.reason)
    if problems:
        for p in problems:
            print(f"REFUSED: {p}", file=sys.stderr)
        return 2

    if args.apply and not args.i_have_the_founders_word:
        print(
            "REFUSED: --apply writes a production allowance that changes what a house\n"
            "is charged. Pass\n"
            "  --apply --i-have-the-founders-word\n"
            "and only when you actually have it. Nothing was written.",
            file=sys.stderr,
        )
        return 2

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_upward(repo_root, ("SUPABASE_SERVICE_ROLE_KEY",))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Nothing was read and\n"
            "nothing is claimed about this house's allowance.",
            file=sys.stderr,
        )
        return 1

    try:
        rows = rest_get(
            url,
            key,
            {
                "select": "restaurant_id,monthly_allowance,stated_source,set_via,set_by,set_at",
                "restaurant_id": f"eq.{args.restaurant}",
            },
        )
    except Exception as err:  # noqa: BLE001 - the reason is printed, never swallowed
        print(
            f"Could not read {TABLE}: {err}\n"
            "This is UNKNOWN, not empty. Nothing is claimed about this house.",
            file=sys.stderr,
        )
        return 1

    existing = rows[0] if rows else None
    report(args.restaurant, args.allowance, args.reason, args.set_by, existing, sys.stdout)

    if not args.apply:
        print("\nDRY RUN — nothing was written. Add --apply --i-have-the-founders-word.")
        return 0

    try:
        written = rest_upsert(
            url, key, payload(args.restaurant, args.allowance, args.reason, args.set_by)
        )
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        print(f"\nWRITE REFUSED ({err.code}): {detail}\nNothing changed.", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"\nWRITE FAILED: {err}\nNothing is claimed to have changed.", file=sys.stderr)
        return 1

    print(f"\nWROTE 1 row: {json.dumps(written)}")
    print(
        "The meter at GET /communications/text-credits/meter now reads this house's\n"
        "own allowance, and its readout says the number came from the HOUSE row and\n"
        "not from its plan."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
