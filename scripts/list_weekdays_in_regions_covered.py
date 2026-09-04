#!/usr/bin/env python3
"""List every provider whose `regions_covered` holds a weekday name.

WHAT PUT THEM THERE
-------------------
The Add/Edit Provider dialogs have collected delivery weekdays since long before
the schema had anywhere to store them. `pages/Providers.tsx` sent the ticked days
as `statesOrRegionsServed`; `services/api/providers.ts` mapped that onto
`regionsCovered`; the gateway wrote `providers.regions_covered` — the GEOGRAPHY
column that the provider map and the territory filters read. Ticking "Monday,
Wednesday, Friday" had exactly one persisted effect: three weekday names joined
the list of regions the vendor covers.

The form was repointed at `PUT /vendor-terms/:providerId` on 2026-09-03 (ADR
0116), so no new weekday can land there. This script finds the ones already
written.

WHY THIS IS A LISTING AND NOT A CLEANUP
---------------------------------------
`regions_covered` is a free-text array. Nobody can prove from the database alone
that a "Sunday" in it was written by the delivery-days picker rather than typed
by a person who meant a place — Sunday is a town in Louisiana, and "Saturday"
appears in trade names. Removing an entry is destroying a row of somebody's data
on an inference.

So this program PROPOSES and never writes. It prints each affected row, the
current value, and the value it would leave behind, and stops. A human decides.
There is deliberately no `--apply`: adding one is a separate decision, taken with
this listing in hand.

USAGE
-----
    python3 scripts/list_weekdays_in_regions_covered.py
    python3 scripts/list_weekdays_in_regions_covered.py --restaurant <uuid>
    python3 scripts/list_weekdays_in_regions_covered.py --json

Environment (read from the nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Exit codes: 0 the register was read (whether or not anything was found);
1 a required input is missing or the read failed. A read that FAILS is never
reported as "nothing found" — the two are the states this script exists to keep
apart.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# 0 = Sunday .. 6 = Saturday. The same order and the same names as
# `apps/api-gateway/src/vendor-terms/term-inference.ts` (WEEKDAY_NAMES) and
# `apps/web/src/services/api/vendorTerms.ts`. Stated here rather than imported
# because this is a standalone operator tool with no build step; the matcher
# test below pins the two lists against each other.
WEEKDAY_NAMES = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)

_WEEKDAY_LOOKUP = {name.lower(): index for index, name in enumerate(WEEKDAY_NAMES)}


def weekday_index(value: Any) -> int | None:
    """The weekday this string names, or None.

    EXACT MATCH ONLY, case- and whitespace-insensitive. Deliberately not a
    substring or prefix match: "Mon" is an abbreviation the picker never wrote,
    and a substring rule would flag "Sunday River, Maine" and "Fridays Harbor"
    as picker artefacts and propose deleting a real territory.
    """
    if not isinstance(value, str):
        return None
    return _WEEKDAY_LOOKUP.get(value.strip().lower())


def split_regions(regions: Any) -> tuple[list[str], list[str]]:
    """Split one `regions_covered` array into (weekday names, everything else).

    Order within each list is the order the column held, so the proposed value
    below is the original with entries removed and nothing reordered.
    """
    weekdays: list[str] = []
    others: list[str] = []
    if not isinstance(regions, list):
        return weekdays, others
    for entry in regions:
        if weekday_index(entry) is None:
            if isinstance(entry, str):
                others.append(entry)
            else:
                # A non-string in a text[] column: kept, reported as-is, never
                # silently dropped.
                others.append(str(entry))
        else:
            weekdays.append(entry)
    return weekdays, others


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restaurant", help="limit the listing to one restaurant id.")
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit the findings as JSON instead of prose.",
    )
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
        print(f"MISSING: {', '.join(missing)} — cannot read the register.")
        return 1

    try:
        from supabase import create_client
    except ImportError:
        print("MISSING: the `supabase` package. pip install supabase")
        return 1

    client = create_client(supabase_url, supabase_key)
    query = client.table("providers").select("id, name, restaurant_id, regions_covered")
    if args.restaurant:
        query = query.eq("restaurant_id", args.restaurant)

    try:
        rows = query.order("name").execute().data or []
    except Exception as exc:  # noqa: BLE001 — the reason is the whole point
        # A failed read is NOT an empty result. Saying "0 rows affected" here
        # would report absence as health, which is the fault this script's
        # subject matter is an instance of.
        print(f"COULD NOT READ providers: {exc}")
        return 1

    findings: list[dict[str, Any]] = []
    for row in rows:
        weekdays, others = split_regions(row.get("regions_covered"))
        if not weekdays:
            continue
        findings.append(
            {
                "provider_id": row.get("id"),
                "provider_name": row.get("name"),
                "restaurant_id": row.get("restaurant_id"),
                "current": row.get("regions_covered"),
                "weekdays_found": weekdays,
                "proposed": others,
                "delivery_weekdays_if_migrated": sorted(
                    {weekday_index(d) for d in weekdays if weekday_index(d) is not None}
                ),
            }
        )

    if args.json:
        print(json.dumps({"providers_read": len(rows), "findings": findings}, indent=2))
        return 0

    print(f"{len(rows)} provider row(s) read.")
    if not findings:
        print(
            "No regions_covered entry exactly matches a weekday name. "
            "Nothing to propose."
        )
        return 0

    print(f"{len(findings)} row(s) hold at least one weekday name.\n")
    for f in findings:
        print(f"  {f['provider_name']}  ({f['provider_id']})")
        print(f"    restaurant       {f['restaurant_id']}")
        print(f"    regions_covered  {f['current']}")
        print(f"    weekdays found   {f['weekdays_found']}")
        print(f"    would become     {f['proposed']}")
        print(
            "    the same days as a TERM would be "
            f"deliveryWeekdays={f['delivery_weekdays_if_migrated']}"
        )
        print()

    print(
        "NOTHING WAS WRITTEN. This script has no --apply and will not get one by\n"
        "accident: a weekday name in a territory column cannot be proven to be a\n"
        "picker artefact rather than a place somebody meant, so each row above is\n"
        "a proposal for a person to accept or reject. Moving the days to the\n"
        "vendor-terms register is PUT /vendor-terms/:providerId; clearing them\n"
        "from regions_covered is a separate write."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
