#!/usr/bin/env python3
"""Resolve message-credit purchases that did not finish. Reads, then decides.

WHY THIS EXISTS
===============
ADR 0121 addendum, founder 2026-09-05: *"Close it now with the intent row."*
A purchase writes an intent row, marks it `charge_may_exist`, charges, then
settles. If the process dies in the middle, the row survives and this is what
finishes it.

WHICH DOOR, AND WHY: A SERVICE METHOD, A SERVICE-KEY ROUTE, AND THIS RUNNER
==========================================================================
The brief offered a script or a sealed admin route. It is all three, and the
split is the point:

  * The DECISIONS live in `PurchaseIntentReconciler` — one implementation of
    "did this charge happen", with its own jest suite covering settle, void,
    idempotency and the too-young refusal. A second implementation here would be
    one more than the number of answers there can be.
  * The DOOR is `POST /communications/text-credits/reconcile`, behind
    `ServiceKeyGuard` (ADR 0099) rather than a seal. A seal binds an act to a
    person who made a gesture; there is no person here, and what the route does
    is not a new decision — it asks the provider what already happened. It fails
    closed when `ADMIN_API_KEY` is unset, and it is allow-listed in
    `check_money_routes_are_sealed.py` with that reason written out.
  * This RUNNER is the founder's-word wrapper. It reads the open set directly so
    a dry run costs nothing and shows what a real one would face, and it refuses
    to `--apply` without `--i-have-the-founders-word`.

What that costs: the runner itself is not exercised by the jest suite. That is
answered by `--self-test` here, which proves the refusals and the summary shape
against fixtures with no database and no provider.

WHAT IT WILL NOT DO
===================
  * It will not void anything on its own judgement. Voiding happens only when
    the provider is asked and answers — either with a charge that did not
    succeed, or with nothing at all on an intent old enough that the provider's
    eventually-consistent search can be trusted. A young intent is left open and
    reported, never voided.
  * It will not charge. There is no code path here that creates a payment.
  * It will not report a failed read as an empty one. A run that could not read
    the open set says so and exits non-zero.

USAGE
    python3 scripts/reconcile_message_credit_purchases.py --self-test
    python3 scripts/reconcile_message_credit_purchases.py            # dry run
    python3 scripts/reconcile_message_credit_purchases.py --restaurant <uuid>
    python3 scripts/reconcile_message_credit_purchases.py --apply --i-have-the-founders-word

Without `--apply` it lists what is open and what it WOULD do, and writes
nothing. The decisions themselves are made by the gateway, which is why an
`--apply` run posts to it rather than reimplementing them here: two
implementations of "did this charge happen" is one more than the number of
answers there can be.

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY for the read;
GATEWAY_URL and ADMIN_API_KEY for the apply.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

TABLE = "house_message_purchase_intents"
OPEN_STATES = ("intended", "charge_may_exist")
#: Mirrors `SEARCH_LAG_FLOOR_MS` in purchase-intent.reconciler.ts. Stated twice
#: on purpose and checked by --self-test: the number is a decision about
#: evidence, and a reader of this file must not have to open a TypeScript file
#: to learn what "old enough" means.
SEARCH_LAG_FLOOR_MINUTES = 5


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


def would_do(row: dict[str, Any], age_minutes: float | None) -> str:
    """What the gateway's reconciler would decide, restated for a dry run.

    A RESTATEMENT, NOT A SECOND IMPLEMENTATION. It never writes and it is never
    consulted by the apply path; the gateway decides. It exists so a person can
    see the shape of a run before authorising one, and --self-test pins it to
    the same floor the service uses.
    """
    if row.get("state") == "intended":
        return "ask the provider; nothing was sent from here, so it will almost certainly void"
    if age_minutes is None:
        return "ask the provider; this row has no attempt time, which is itself worth looking at"
    if age_minutes < SEARCH_LAG_FLOOR_MINUTES:
        return (
            f"LEAVE OPEN — attempted {age_minutes:.1f} minutes ago, and the provider's "
            f"search index runs behind; nothing is judged under {SEARCH_LAG_FLOOR_MINUTES} minutes"
        )
    return "ask the provider, then settle it or void it on the answer"


def report(rows: list[dict[str, Any]], now_iso: str, out: io.TextIOBase) -> list[str]:
    """Print the open set and what a run would do. Returns the decision lines."""
    import datetime as _dt

    if not rows:
        print("No purchase is unresolved. Nothing to reconcile.", file=out)
        return []

    now = _dt.datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    lines: list[str] = []
    print(f"{len(rows)} unresolved purchase(s):\n", file=out)
    for r in rows:
        attempted = r.get("charge_attempted_at")
        age = None
        if attempted:
            try:
                then = _dt.datetime.fromisoformat(str(attempted).replace("Z", "+00:00"))
                age = (now - then).total_seconds() / 60
            except ValueError:
                age = None
        decision = would_do(r, age)
        lines.append(decision)
        print(f"  intent   {r.get('id')}", file=out)
        print(f"    house    {r.get('restaurant_id')}", file=out)
        print(f"    seal     {r.get('seal_id')}", file=out)
        print(
            f"    intended {r.get('amount_minor')} {r.get('currency')} minor units, "
            f"state {r.get('state')}",
            file=out,
        )
        print(
            "    asked    "
            + (f"{attempted} ({age:.1f} min ago)" if age is not None else str(attempted)),
            file=out,
        )
        print(f"    would    {decision}\n", file=out)
    return lines


def self_test() -> int:
    """Prove the decision restatement and the report shape. No DB, no provider."""
    failures: list[str] = []

    if SEARCH_LAG_FLOOR_MINUTES != 5:
        failures.append(
            "the floor here no longer matches SEARCH_LAG_FLOOR_MS in "
            "purchase-intent.reconciler.ts (5 minutes); one of the two moved"
        )

    young = would_do({"state": "charge_may_exist"}, 0.5)
    if "LEAVE OPEN" not in young:
        failures.append("a young intent was not left open")
    old = would_do({"state": "charge_may_exist"}, 60.0)
    if "LEAVE OPEN" in old:
        failures.append("an old intent was left open")
    if "void" not in old:
        failures.append("an old intent's decision does not mention voiding")
    untouched = would_do({"state": "intended"}, None)
    if "nothing was sent" not in untouched:
        failures.append("an untouched intent was not described as unsent")

    buf = io.StringIO()
    lines = report([], "2026-09-06T12:00:00Z", buf)
    if "Nothing to reconcile" not in buf.getvalue() or lines:
        failures.append("an empty open set was not reported as nothing to do")

    buf2 = io.StringIO()
    rows = [
        {
            "id": "i1",
            "restaurant_id": "r1",
            "seal_id": "s1",
            "amount_minor": 5000,
            "currency": "USD",
            "state": "charge_may_exist",
            "charge_attempted_at": "2026-09-06T11:59:30Z",
        },
        {
            "id": "i2",
            "restaurant_id": "r1",
            "seal_id": "s2",
            "amount_minor": 7000,
            "currency": "USD",
            "state": "charge_may_exist",
            "charge_attempted_at": "2026-09-06T10:00:00Z",
        },
    ]
    decisions = report(rows, "2026-09-06T12:00:00Z", buf2)
    if len(decisions) != 2:
        failures.append("the report did not decide once per row")
    if "LEAVE OPEN" not in decisions[0]:
        failures.append("the 30-second-old row was not left open")
    if "LEAVE OPEN" in decisions[1]:
        failures.append("the two-hour-old row was left open")
    text = buf2.getvalue()
    for needed in ("i1", "s1", "5000 USD", "house"):
        if needed not in text:
            failures.append(f"the report omitted {needed!r}")

    if failures:
        for f in failures:
            print(f"self-test FAILED: {f}", file=sys.stderr)
        return 3
    print("self-test passed: 4 decisions and 6 report properties checked, 0 writes.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Resolve message-credit purchases that did not finish.",
    )
    parser.add_argument("--restaurant", default=None, help="limit to one restaurant UUID")
    parser.add_argument("--apply", action="store_true", help="ask the gateway to reconcile")
    parser.add_argument(
        "--i-have-the-founders-word",
        action="store_true",
        help="required alongside --apply; without it an apply is refused",
    )
    parser.add_argument("--self-test", action="store_true", help="run against fixtures, no DB")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.apply and not args.i_have_the_founders_word:
        print(
            "REFUSED: --apply settles credits and voids the claim that a charge may\n"
            "exist. Pass\n"
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
            "nothing is claimed about any purchase.",
            file=sys.stderr,
        )
        return 1

    params = {
        "select": "id,restaurant_id,seal_id,amount_minor,currency,state,intended_at,charge_attempted_at",
        "state": f"in.({','.join(OPEN_STATES)})",
        "order": "intended_at.asc",
    }
    if args.restaurant:
        params["restaurant_id"] = f"eq.{args.restaurant}"

    try:
        rows = rest_get(url, key, params)
    except Exception as err:  # noqa: BLE001 - the reason is printed, never swallowed
        print(
            f"Could not read {TABLE}: {err}\n"
            "This is UNKNOWN, not empty. No purchase is claimed to be resolved.",
            file=sys.stderr,
        )
        return 1

    import datetime as _dt

    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    report(rows, now_iso, sys.stdout)

    if not args.apply:
        print("\nDRY RUN — nothing was written and the provider was not asked.")
        print("Add --apply --i-have-the-founders-word to let the gateway reconcile.")
        return 0

    gateway = os.environ.get("GATEWAY_URL")
    admin = os.environ.get("ADMIN_API_KEY")
    if not gateway or not admin:
        print(
            "\nMissing GATEWAY_URL / ADMIN_API_KEY, so the gateway could not be asked to\n"
            "reconcile. Nothing was written. The decisions live in the gateway on\n"
            "purpose: a second implementation of 'did this charge happen' is one more\n"
            "than the number of answers there can be.",
            file=sys.stderr,
        )
        return 1

    body = json.dumps(
        {"restaurantId": args.restaurant} if args.restaurant else {}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{gateway.rstrip('/')}/communications/text-credits/reconcile",
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-admin-key": admin,
            "accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:  # noqa: S310
            answer = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        print(f"\nRECONCILE REFUSED ({err.code}): {detail}\nNothing changed.", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(
            f"\nRECONCILE FAILED: {err}\n"
            "Nothing is claimed to have been resolved. Every intent is exactly as it was.",
            file=sys.stderr,
        )
        return 1

    considered = answer.get("considered")
    if considered is None:
        print(
            f"\nThe gateway could NOT READ the open set: {answer.get('reason')}\n"
            "That is not the same as there being nothing open.",
            file=sys.stderr,
        )
        return 1

    results = answer.get("results") or []
    print(f"\nReconciled {considered} intent(s):")
    for r in results:
        print(f"  {r.get('outcome'):20} {r.get('intentId')}  {r.get('words')}")
    if not results:
        print("  nothing was open")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
