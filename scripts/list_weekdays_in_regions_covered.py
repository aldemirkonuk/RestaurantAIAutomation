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

WHY IT PROPOSES BEFORE IT MOVES
-------------------------------
`regions_covered` is a free-text array. Nobody can prove from the database alone
that a "Sunday" in it was written by the delivery-days picker rather than typed
by a person who meant a place — Sunday is a town in Louisiana, and "Saturday"
appears in trade names. Removing an entry is destroying a row of somebody's data
on an inference.

So the default is still a listing: it prints each affected row, the current
value, and the value it would leave behind, and stops. **The founder read that
listing on 2026-09-04 and decided the move**, so `--apply-move` now exists. It
is opt-in, it is never the default, and it does BOTH halves — the days become a
vendor TERM and the regions column loses them — because doing only the first
would leave the weekday names in the geography column that the map and the
territory filters read, and doing only the second would destroy them.

WHAT THE MOVE WRITES, AND HOW IT SAYS WHERE IT CAME FROM
--------------------------------------------------------
`restaurant_vendor_terms` is keyed `(restaurant_id, provider_id)`. The move
upserts `delivery_weekdays` there and leaves every other term untouched — a
cutoff or a minimum somebody recorded on the settings register is never
overwritten by this script.

`stated_by` is written as NULL **on purpose**. That column is "who said so", it
carries a foreign key to `public.users(user_id)`, and nobody said this: it was
mined out of a column the form was wrongly writing into. Attributing it to an
operator would be inventing a witness. Instead the provenance goes in `notes`,
in words the register already renders:

    recovered from the regions column

so a person reading the vendor-terms register sees a term whose origin is stated
rather than a term that appears to have been told to somebody.

ATOMICITY — WHAT THIS ACTUALLY GUARANTEES, WHICH IS NOT A TRANSACTION
----------------------------------------------------------------------
Each provider is moved in TWO writes, not one, because this script talks to
PostgREST through the Supabase client and PostgREST exposes no multi-statement
transaction. A genuine single-statement move is possible — a data-modifying CTE
(`WITH upsert AS (INSERT … RETURNING …) UPDATE providers …`) is one statement and
therefore atomic — but reaching it from here needs a database FUNCTION and
therefore a migration, which is a bigger decision than this chore.

So the ordering is the guarantee, and it is chosen so that the failure is the
recoverable one:

  1. write the vendor term FIRST. It is additive. If it fails, nothing is lost:
     the weekdays are still in `regions_covered` and re-running retries.
  2. strip `regions_covered` only after step 1 is confirmed written back.

If step 2 fails, the days exist in BOTH places for that provider. That is
visible, harmless — the register reads the term, the map reads a stale weekday —
and fixed by re-running, because both halves are idempotent. The reverse order
would have a failure mode that destroys data, which is why it is not used.
Every per-provider outcome is printed and the run's tallies are printed at the
end; a partial run is never reported as a clean one.

USAGE
-----
    python3 scripts/list_weekdays_in_regions_covered.py               # dry run
    python3 scripts/list_weekdays_in_regions_covered.py --restaurant <uuid>
    python3 scripts/list_weekdays_in_regions_covered.py --json
    python3 scripts/list_weekdays_in_regions_covered.py --apply-move  # WRITES

Environment (read from the nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Exit codes: 0 the register was read (and, with --apply-move, every move
succeeded); 1 a required input is missing or the read failed; 2 the run was
applied and at least one provider did not complete both halves. A read that
FAILS is never reported as "nothing found", and a partial apply is never
reported as a clean one — those are the states this script exists to keep
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


# The words the vendor-terms register renders as this term's origin. A constant
# so the writer and the test cannot disagree about it, and so a person grepping
# for it finds both.
MOVE_PROVENANCE = "recovered from the regions column"


def term_payload(restaurant_id: str, provider_id: str, weekdays: list[str]) -> dict[str, Any]:
    """The `restaurant_vendor_terms` row this move upserts.

    ONLY the delivery days and the provenance note. Every other term is absent
    from the payload, so an upsert cannot clear a cutoff, a minimum, a lead time
    or payment terms that somebody recorded on the settings register.

    `stated_by` is deliberately NOT in the payload. See the module header: that
    column means "who said so", and nobody said this. Leaving the key out leaves
    the column NULL on an insert and untouched on an update — which is the right
    answer in both cases, and better than writing an explicit NULL that would
    erase a real author if one ever existed on the row.
    """
    return {
        "restaurant_id": restaurant_id,
        "provider_id": provider_id,
        "delivery_weekdays": sorted(
            {i for i in (weekday_index(d) for d in weekdays) if i is not None}
        ),
        "notes": MOVE_PROVENANCE,
    }


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
    parser.add_argument(
        "--apply-move",
        action="store_true",
        help=(
            "WRITES. Move the weekday names into restaurant_vendor_terms as "
            "delivery days (provenance: 'recovered from the regions column') and "
            "remove them from providers.regions_covered. Two writes per provider, "
            "term first — see the module header on what that does and does not "
            "guarantee. Without this flag nothing is written."
        ),
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

    if not args.apply_move:
        print(
            "NOTHING WAS WRITTEN. Each row above is a proposal: a weekday name in a\n"
            "territory column cannot be proven to be a picker artefact rather than a\n"
            "place somebody meant. Re-run with --apply-move to move the days into\n"
            "restaurant_vendor_terms and clear them from regions_covered."
        )
        return 0

    return _apply_moves(client, findings)


def _apply_moves(client: Any, findings: list[dict[str, Any]]) -> int:
    """Move each provider's weekdays into its vendor terms, then clear the column.

    Term first, regions second, per provider — see the module header. Each half
    is idempotent, so a provider that half-completed is fixed by re-running.
    """
    print("APPLYING. Term first, then the regions column, one provider at a time.\n")
    moved = 0
    term_only = 0
    failed = 0

    for f in findings:
        pid = f["provider_id"]
        name = f["provider_name"]
        rid = f["restaurant_id"]

        if not rid:
            # `restaurant_vendor_terms.restaurant_id` is NOT NULL and the terms
            # hang off the (restaurant, provider) pair — the same vendor gives
            # two houses two different answers. A provider with no restaurant has
            # nowhere for its terms to live, and guessing a house would file one
            # restaurant's days under another's.
            print(f"  SKIPPED     {name} ({pid}) — the provider row carries no restaurant_id, "
                  "so there is no (restaurant, provider) pair to file a term against.")
            failed += 1
            continue

        payload = term_payload(rid, pid, f["weekdays_found"])
        try:
            client.table("restaurant_vendor_terms").upsert(
                payload, on_conflict="restaurant_id,provider_id"
            ).execute()
        except Exception as exc:  # noqa: BLE001 — the reason is the whole point
            print(f"  NOT MOVED   {name} ({pid}) — the vendor term did not write: {exc}. "
                  "regions_covered is UNCHANGED; nothing was lost; re-run to retry.")
            failed += 1
            continue

        try:
            client.table("providers").update(
                {"regions_covered": f["proposed"]}
            ).eq("id", pid).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"  HALF MOVED  {name} ({pid}) — the term IS written, but "
                  f"regions_covered was not cleared: {exc}. The days now exist in BOTH "
                  "places for this provider. Harmless and idempotent; re-run to finish.")
            term_only += 1
            continue

        print(f"  MOVED       {name} ({pid}) — {f['weekdays_found']} -> "
              f"deliveryWeekdays={payload['delivery_weekdays']}; "
              f"regions_covered now {f['proposed']}")
        moved += 1

    print()
    print(f"{moved} moved · {term_only} half moved (term written, column not cleared) · "
          f"{failed} not moved (nothing written for these)")
    if term_only or failed:
        print(
            "This run did NOT complete. Every incomplete provider is named above and "
            "every half is idempotent, so re-running finishes the job. Exit 2."
        )
        return 2
    print("Every provider listed completed both halves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
