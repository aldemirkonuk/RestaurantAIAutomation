#!/usr/bin/env python3
"""Plan §1 parity check for master_wine_library.display_name.

Requires a live DB connection (SUPABASE_DB_URL in .env), so unlike
eval_merge_policies.py this is NOT wired into GitHub Actions CI -- the
runner has no database credentials. Run manually after any migration that
touches wine_display_name(), master_wine_library_set_search_vector(), or
any column display_name is derived from (name, producer, vintage, region,
country).

Checks, in order of how badly a failure would read to a user:
  1. Every live row has a non-empty display_name.
  2. No row's display_name contains its own full producer PHRASE twice
     (the actual "looks obviously wrong" bug -- e.g. "E.H. Taylor EH Taylor").
  3. No single-word producer appears back-to-back ("Petrus Petrus 2016").

Deliberately does NOT check for any shared token appearing twice --
natural wine names legitimately reuse short words ("Casanova di Neri
Brunello di Montalcino", "Domaine Mont Bessay En Bessay Beaujolais") and a
token-level check flags those as false positives. See the migration
20260817040000's header comment for why this bar was chosen.
"""
from __future__ import annotations

import pathlib
import re
import sys
import unicodedata

import psycopg2


def norm(value) -> str:
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    dsn = next(
        line.split("=", 1)[1].strip()
        for line in (root / ".env").read_text().splitlines()
        if line.startswith("SUPABASE_DB_URL=")
    )
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute(
        """SELECT id, producer, display_name FROM master_wine_library
           WHERE deleted_at IS NULL"""
    )
    rows = cur.fetchall()
    print(f"checked {len(rows):,} live rows")

    failures: list[str] = []

    empty = [r for r in rows if not (r[2] or "").strip()]
    if empty:
        failures.append(f"{len(empty)} rows have an empty display_name")
        for wid, producer, dn in empty[:5]:
            failures.append(f"    {wid} producer={producer!r}")

    phrase_repeat = []
    adjacent_repeat = []
    for wid, producer, dn in rows:
        ptoks = norm(producer).split()
        if not ptoks:
            continue
        dn_norm = norm(dn)
        if len(ptoks) >= 2:
            phrase = " ".join(ptoks)
            first = dn_norm.find(phrase)
            if first != -1 and dn_norm.find(phrase, first + len(phrase)) != -1:
                phrase_repeat.append((wid, producer, dn))
        else:
            dntoks = dn_norm.split()
            for i in range(len(dntoks) - 1):
                if dntoks[i] == ptoks[0] and dntoks[i + 1] == ptoks[0]:
                    adjacent_repeat.append((wid, producer, dn))
                    break

    if phrase_repeat:
        failures.append(f"{len(phrase_repeat)} rows repeat the full producer phrase")
        for wid, producer, dn in phrase_repeat[:5]:
            failures.append(f"    {producer!r} -> {dn!r}")
    if adjacent_repeat:
        failures.append(f"{len(adjacent_repeat)} rows repeat a single-word producer back-to-back")
        for wid, producer, dn in adjacent_repeat[:5]:
            failures.append(f"    {producer!r} -> {dn!r}")

    if failures:
        print("\nFAILED:")
        for line in failures:
            print(f"  {line}")
        return 1

    print("PASSED: display_name is non-empty and repeats no producer for every live row.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
