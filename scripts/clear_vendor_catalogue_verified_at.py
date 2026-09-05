#!/usr/bin/env python3
"""
Clear `vendor_catalogue.verified_at` on the rows two geocoding migrations stamped.

ADR 0117 Q26 (2026-09-05) found three vendors carrying `verified_at =
2026-08-10T17:21:2x` while their `website` pointed at a casino, a wine school
and a clothes shop, `source` still `curated` and `source_ref` NULL. The founder
said: "Clear it and find the stamper."

THE STAMPER, FOUND
------------------
It was not a job. Every `verified_at` in production (17 rows, measured
2026-09-05 by a read of `/rest/v1/vendor_catalogue`) carries one of two values,
17:21:22.275152 and 17:21:23.426939 on 2026-08-10 -- the seconds in which two
migrations applied to production:

    supabase/migrations/20260807001352_distributor_vendor_backfill.sql:32
        verified_at = now()   -- for 15 rows, inside a VALUES list of
                                 latitude/longitude from the Census geocoder
    supabase/migrations/20260807001552_distributor_data_quality.sql:36,52
        verified_at = now()   -- Southern Glazer's and Banfi, address fixes

So "verified" meant "we set coordinates for this address". Nothing ever
checked the website, the name, or the identity of the business the row
describes, and the column reads as if something had. A migration cannot run
twice, so the stamper will not run again by itself; the migration that ships
beside this script (20260906040000) refuses any future `verified_at` that has
no `source_ref`, which is what stops the next migration from doing the same.

WHAT THIS SCRIPT DOES
---------------------
Dry run by default: prints every row it WOULD touch, fingerprinted by the whole
tuple (`verified_at` inside the two-second window, `source = 'curated'`,
`source_ref IS NULL`), never by name. `--apply --i-have-the-founders-word` sets
`verified_at = NULL` on exactly those rows and appends a dated sentence to
`notes`. It touches no other column and deletes nothing. The writers are
migrations that already ran; a re-run of a migration is impossible, so nothing
refills the stamp.

Exit codes: 0 done (or dry run printed); 1 no rows matched, said as "no rows";
2 an apply was refused or a write failed; 3 the environment is missing.

Environment (nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

WINDOW_FROM = "2026-08-10T17:21:22+00:00"
WINDOW_TO = "2026-08-10T17:21:24+00:00"
NOTE = (
    "verified_at cleared 2026-09-05 on the founder's word (ADR 0117 Q26): the stamp "
    "came from the 2026-08-07 geocoding migrations (address coordinates set), not from "
    "any check of the website or the business; source_ref was never set."
)


def load_env() -> tuple[str, str]:
    here = Path(__file__).resolve()
    candidates = [p / ".env" for p in [here.parent.parent / "apps" / "api-gateway", *here.parents]]
    for c in candidates:
        if c.is_file():
            for line in c.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("environment missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(3)
    return url.rstrip("/"), key


def rest(url: str, key: str, method: str, path: str, body: dict | None = None, prefer: str = "") -> tuple[int, list | dict]:
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            **({"Prefer": prefer} if prefer else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else [])
    except urllib.error.HTTPError as e:
        print(f"{method} {path} -> HTTP {e.code}: {e.read()[:300]!r}", file=sys.stderr)
        sys.exit(2)


FILTER = (
    f"verified_at=gte.{urllib.parse.quote(WINDOW_FROM)}"
    f"&verified_at=lt.{urllib.parse.quote(WINDOW_TO)}"
    "&source=eq.curated&source_ref=is.null"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--i-have-the-founders-word", action="store_true")
    args = ap.parse_args()
    url, key = load_env()

    _, rows = rest(url, key, "GET", f"vendor_catalogue?select=id,name,website,verified_at,source,source_ref,notes&{FILTER}&order=name")
    if not rows:
        print("no rows: nothing in vendor_catalogue matches the fingerprint (window, curated, no source_ref)")
        return 1
    print(f"{len(rows)} row(s) match the fingerprint:")
    for r in rows:
        print(f"  {r['id']}  {r['name']!r}  verified_at={r['verified_at']}  website={r['website']!r}")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply --i-have-the-founders-word to clear these.")
        return 0
    if not args.i_have_the_founders_word:
        print("\nREFUSED: --apply needs --i-have-the-founders-word.", file=sys.stderr)
        return 2

    done = 0
    for r in rows:
        notes = (r.get("notes") or "").strip()
        new_notes = f"{notes} | {NOTE}" if notes else NOTE
        # The PATCH re-states the fingerprint on the row so a row that changed
        # under us (a stamp that moved, a source_ref that appeared) is skipped.
        status, out = rest(
            url, key, "PATCH",
            f"vendor_catalogue?id=eq.{r['id']}&{FILTER}",
            {"verified_at": None, "notes": new_notes},
            prefer="return=representation",
        )
        if status in (200, 204) and isinstance(out, list) and len(out) == 1 and out[0].get("verified_at") is None:
            done += 1
            print(f"  cleared {r['id']} {r['name']!r}")
        else:
            print(f"  NOT cleared {r['id']} {r['name']!r}: status {status}, returned {json.dumps(out)[:160]}", file=sys.stderr)
    _, left = rest(url, key, "GET", "vendor_catalogue?select=id&verified_at=not.is.null&source_ref=is.null")
    print(f"\ncleared {done} of {len(rows)}; rows still carrying verified_at with no source_ref: {len(left)}")
    return 0 if done == len(rows) and not left else 2


if __name__ == "__main__":
    sys.exit(main())
