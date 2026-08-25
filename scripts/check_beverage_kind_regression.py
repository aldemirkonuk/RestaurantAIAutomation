#!/usr/bin/env python3
"""Plan §2.0 / arch §6 regression check for beverage_kind.

The bug this guards: `is_wine = bool(primary_type)` conflated "not a wine"
with "the model could not classify it" -- every is_wine=false row carried
primary_type='unknown', with no exception, at every measurement taken during
this build. beverage_kind replaces it as the migration predicate. This
script is the check that a future migration should run before selecting on
beverage_kind='wine' vs not, same spirit as check_display_name_parity.py:
requires a live DB connection, not wired into GitHub Actions CI.

The one check that matters: no row whose OWN menu section header says it is
wine (red/white/rose/sparkling/etc.) may have beverage_kind other than
'wine'. That is the literal shape of the bug this fix closed -- 8 real wines
mistagged is_wine=false, all recoverable from their own menu_category.
"""
from __future__ import annotations

import pathlib
import re
import sys

import psycopg2

# Mirrors the SQL classifier's precedence, not just its wine keyword list --
# an earlier version of this check used the wine keywords alone and flagged
# 'brandy & dessert' (Hennessy VSOP, Ramazzotti Sambuca -- real spirits,
# correctly classified 'spirit') as a false failure, because 'dessert' and
# 'port' are ambiguous words on their own. The classifier resolves that
# ambiguity by checking spirit/beer/sake/cocktail/cider keywords FIRST; this
# check must do the same or it re-introduces exactly the kind of imprecise
# keyword matching the real classifier was built to avoid.
NON_WINE_SECTION = re.compile(
    r"\b(sake|junmai|ginjo|daiginjo|honjozo|beer|birra|lager|pilsner|ipa|"
    r"ale|stout|porter|hefeweizen|cider|cocktail|cocktails|zero.?proof|"
    r"spirit.?free|non.?alcoholic|nonalcoholic|whisk(e)?y|whiskies|scotch|"
    r"bourbon|rye|tequila|mezcal|agave|vodka|gin|rum|brandy|cognac|"
    r"armagnac|grappa|calvados|arak|cane|amari|amaro|cordials?|liqueurs?|"
    r"digestifs?|digestivi|apertivi|aperitifs?|vermouth|spirits?)\b",
    re.IGNORECASE,
)
WINE_SECTION = re.compile(
    r"\b(red|white|ros[eé]|sparkling|champagne|orange|dessert|fortified|"
    r"port|blend|pinot|cabernet|chardonnay|sauvignon|zinfandel|merlot|"
    r"shiraz|syrah|sherry)\b",
    re.IGNORECASE,
)


def is_wine_section(menu_category: str) -> bool:
    """True only when a wine keyword matches AND no non-wine keyword also
    does -- same precedence the SQL classifier applies."""
    if NON_WINE_SECTION.search(menu_category):
        return False
    return bool(WINE_SECTION.search(menu_category))


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
        """SELECT id, name, producer, beverage_kind, classification_status,
                  data_enrichment->>'menu_category' AS menu_category,
                  data_enrichment->>'is_wine' AS is_wine
           FROM master_wine_library WHERE deleted_at IS NULL"""
    )
    rows = cur.fetchall()
    print(f"checked {len(rows):,} live rows")

    failures: list[str] = []

    unclassified = [r for r in rows if r[4] == "unclassified"]
    if unclassified:
        failures.append(
            f"{len(unclassified)} rows are classification_status='unclassified' "
            f"(should be near-zero; every corpus row carries a menu_category)"
        )

    mistagged = [
        r for r in rows
        if r[3] != "wine" and r[5] and is_wine_section(r[5])
    ]
    if mistagged:
        failures.append(
            f"{len(mistagged)} rows have a wine-section menu_category but "
            f"beverage_kind != 'wine' -- the exact bug this migration fixed"
        )
        for wid, name, producer, kind, *_rest in mistagged[:10]:
            failures.append(f"    {producer!r} / {name!r} -> beverage_kind={kind!r}")

    # Informational, not a failure: how many rows would a naive is_wine=false
    # predicate still wrongly exclude from the wine population today. Kept
    # visible so nobody has to re-derive it by hand if is_wine drifts again.
    naive_wrong = [r for r in rows if r[6] == "false" and r[3] == "wine"]
    print(f"rows where is_wine=false but beverage_kind=wine (would still be "
          f"excluded by the old predicate): {len(naive_wrong)}")

    if failures:
        print("\nFAILED:")
        for line in failures:
            print(f"  {line}")
        return 1

    print("PASSED: no wine-section row is misclassified; beverage_kind is the safe predicate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
