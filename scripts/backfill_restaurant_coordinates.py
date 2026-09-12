#!/usr/bin/env python3
"""Give the houses that signed up before 2026-09-03 the coordinate they asserted.

WHY THIS IS A SCRIPT AND NOT A MIGRATION
----------------------------------------
A migration runs automatically on merge (see the schema-parity runbook) and must
be deterministic and offline. This one calls Google. A migration that reaches out
to a third party at deploy time is a deploy that fails when Google rate-limits
us, in a transaction that has already begun. So: a script, run by hand, on the
founder's word, with a dry run first.

WHAT IT WILL AND WILL NOT DO
----------------------------
It asks Google the SAME question the sign-up form asked, keyed on the
`google_place_id` the row already carries. That is a lookup of a fact the house
already chose, not a new guess about where the house is.

It will NOT geocode a free-text address. A geocode of "3130 Alpine Rd" is this
program's opinion about a legal entity's location, and the whole point of ADR
0111 is that our opinion and the house's assertion are different kinds of thing.
A row with no place id is REPORTED, never filled: the operator re-selects the
address in the form and the capture path (auth.service.ts `coordinateColumns`)
writes it.

USAGE
-----
    python3 scripts/backfill_restaurant_coordinates.py            # dry run
    python3 scripts/backfill_restaurant_coordinates.py --apply    # write

Environment (read from the nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — the database
    GOOGLE_MAPS_API_KEY                       — Places API (New) key with
                                                Places Details enabled

Exit codes: 0 nothing to do or done; 1 a required input is missing; 2 at least
one lookup failed (the report says which — a partial run is never reported as a
clean one).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
# Exactly the two fields we need. Places (New) bills by field mask, and asking
# for more than the point would be paying to receive data we then discard.
FIELD_MASK = "id,location,formattedAddress"


# ---------------------------------------------------------------------------
# environment
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Google
# ---------------------------------------------------------------------------


def fetch_place_location(place_id: str, api_key: str) -> tuple[
    float | None, float | None, str | None
]:
    """Ask Places Details for one place's point.

    Returns `(latitude, longitude, error)`. A place that resolves but carries no
    location returns `(None, None, None)` — a real "Google has no point for
    this", distinct from a failed call, and the report keeps them apart.
    """
    request = urllib.request.Request(
        PLACES_DETAILS_URL.format(place_id=urllib.parse.quote(place_id, safe="")),
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": FIELD_MASK,
            # Places (New) asks callers to identify themselves.
            "User-Agent": "Mudavym/coordinate-backfill (ops@mudavym.com)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        return None, None, f"HTTP {exc.code}: {detail}"
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return None, None, f"{type(exc).__name__}: {exc}"

    location = body.get("location") or {}
    lat = location.get("latitude")
    lng = location.get("longitude")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None, None, None
    return float(lat), float(lng), None


# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------


def classify(row: dict[str, Any]) -> str:
    """What this row's state is, before Google is called at all."""
    if row.get("latitude") is not None and row.get("longitude") is not None:
        return "already-has-a-point"
    if row.get("google_place_id"):
        return "askable"
    if row.get("address"):
        return "address-but-no-place-id"
    return "no-address-at-all"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the coordinates. Without it nothing is written.",
    )
    parser.add_argument(
        "--restaurant",
        help="limit the run to one restaurant id.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_upward(
        repo_root, ("SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_MAPS_API_KEY")
    )

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    google_key = os.environ.get("GOOGLE_MAPS_API_KEY")

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

    query = client.table("restaurants").select(
        "id, name, address, city, country, timezone, "
        "latitude, longitude, google_place_id"
    )
    if args.restaurant:
        query = query.eq("id", args.restaurant)
    rows = query.order("name").execute().data or []

    buckets: dict[str, list[dict[str, Any]]] = {
        "already-has-a-point": [],
        "askable": [],
        "address-but-no-place-id": [],
        "no-address-at-all": [],
    }
    for row in rows:
        buckets[classify(row)].append(row)

    print(f"{len(rows)} restaurants read.\n")
    for state, members in buckets.items():
        print(f"  {state:<26} {len(members)}")
    print()

    for row in buckets["address-but-no-place-id"]:
        # Named individually, because each of these is a person who has to
        # re-select their address — the script cannot do it for them and must
        # not pretend the row is merely "pending".
        print(
            f"  CANNOT ASK  {row['name']} ({row['id']}) — has an address, no "
            "google_place_id. Nothing here can produce a coordinate without "
            "guessing; the operator must re-select the address in the form."
        )
    for row in buckets["no-address-at-all"]:
        print(
            f"  CANNOT ASK  {row['name']} ({row['id']}) — no address recorded "
            "at all."
        )
    if buckets["address-but-no-place-id"] or buckets["no-address-at-all"]:
        print()

    if not buckets["askable"]:
        print("Nothing to ask Google. No coordinate can be filled by this run.")
        return 0

    if not google_key:
        print(
            "MISSING: GOOGLE_MAPS_API_KEY — "
            f"{len(buckets['askable'])} rows carry a place id and could be "
            "resolved, but no key is set."
        )
        return 1

    failures = 0
    writes = 0
    for row in buckets["askable"]:
        place_id = row["google_place_id"]
        lat, lng, error = fetch_place_location(place_id, google_key)

        if error is not None:
            failures += 1
            print(f"  FAILED      {row['name']} ({place_id}) — {error}")
            continue
        if lat is None or lng is None:
            print(
                f"  NO POINT    {row['name']} ({place_id}) — Google resolved "
                "the place and returned no location. Left NULL."
            )
            continue

        print(
            f"  {'WRITE  ' if args.apply else 'WOULD  '}     {row['name']} "
            f"({row['id']}) → {lat:.6f}, {lng:.6f}"
        )
        if not args.apply:
            continue

        result = (
            client.table("restaurants")
            .update({"latitude": lat, "longitude": lng})
            .eq("id", row["id"])
            # Do not overwrite a point that arrived between the read and the
            # write — a concurrent sign-up edit is the operator's assertion and
            # outranks this backfill.
            .is_("latitude", "null")
            .execute()
        )
        written = len(result.data or [])
        if written == 0:
            print(
                f"              (skipped {row['name']} — latitude was no "
                "longer NULL at write time)"
            )
        else:
            writes += written

    print()
    if args.apply:
        print(f"{writes} rows written, {failures} lookups failed.")
    else:
        print(
            f"DRY RUN — nothing was written. {failures} lookups failed. "
            "Re-run with --apply to write."
        )
    return 2 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
