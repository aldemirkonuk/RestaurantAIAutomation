#!/usr/bin/env python3
"""`vendor_catalogue.verified_at` is a provenance stamp, not a badge.

WHY THIS GUARD EXISTS
---------------------
ADR 0117 Q26 measured, on 2026-09-05, that every one of the SEVENTEEN
`vendor_catalogue.verified_at` values in production carried one of two
timestamps two seconds apart — the seconds in which two 2026-08-07 geocoding
migrations applied. "Verified" had meant "an address got coordinates". Nothing
had checked the website, the name or the business, and `source_ref` was NULL on
all seventeen: three of the rows so stamped had a casino, a wine school and a
clothes shop for a website.

The founder: *"Clear it and find the stamper."* All seventeen were cleared at
2026-09-05T20:35:56Z, and `20260906040000_a_verification_names_its_source.sql`
now refuses a `verified_at` that names no `source_ref`.

**That leaves the column NULL on every row, and it is the NULL that is
dangerous.** Two readings would be wrong, and both are the natural thing to
write:

  * `if (!row.verified_at) → unverified, therefore suspect`. False. NULL means
    nobody has checked this vendor, which is the honest state of every row in the
    table and says nothing bad about any particular one. Ranking on it, filtering
    it out, or greying it in a list would turn a repair into a demotion.
  * `if (row.verified_at) → verified`. False whenever `source_ref` is NULL, which
    was true of all seventeen. The database CHECK now blocks new ones, but a
    reader must not depend on a constraint added after the fact to make its own
    logic true.

Measured on this tree when the guard was written: **nothing tests this column at
all.** It is declared on the distributor row type, returned by
`search_distributors` and `vendor_catalogue_match`, and carried to the client
unread — the distributors page's "verified only" toggle filters on
`listing_tier`, not on this. So there is no reading to correct today. This guard
keeps it that way, because the wrong reading is one line and nothing else in the
repository would notice it.

WHAT IT FLAGS
-------------
A truthiness or null test on `verified_at` / `verifiedAt`, in a file that is
about the vendor catalogue or the distributor register. Other tables' columns of
the same name — `email_verifications.verified_at` in auth,
`procurement_orders.match_verified_at`, the canonical document's — are different
facts and are not in scope.

NEVER VACUOUS
-------------
If the column is not declared anywhere the guard can see, the pattern has rotted
and this exits **2**. A check that cannot check what it claims is a failure, not
a pass.

USAGE
    python3 scripts/check_verified_at_is_not_a_boolean.py
    python3 scripts/check_verified_at_is_not_a_boolean.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ROOTS = ("apps/api-gateway/src", "apps/web/src", "apps/mobile")
SUFFIXES = (".ts", ".tsx")

# Only files that are about THIS column's table.
IN_SCOPE = re.compile(r"vendor_catalogue|search_distributors|distributor|shop-reference|price-reference")

# A truthiness or null test on the column. `verified_at: null` in a fixture is
# an assignment, not a test, and is deliberately not matched.
TESTS = (
    re.compile(r"!\s*\w*\.?verified_?[Aa]t\b"),
    re.compile(r"\bverified_?[Aa]t\s*(===?|!==?)\s*null\b"),
    re.compile(r"\bverified_?[Aa]t\s*\?\s*[^:]"),
    re.compile(r"""\.is\(\s*['"]verified_at['"]"""),
    re.compile(r"""\.not\(\s*['"]verified_at['"]"""),
    re.compile(r"\bif\s*\(\s*\w*\.?verified_?[Aa]t\s*\)"),
)

# Files allowed to test it, each with the reason it is not this column.
ALLOWLIST: dict[str, str] = {}


def scan() -> tuple[list[str], int]:
    """(offending `file:line  text`, number of files that declare the column)."""
    hits: list[str] = []
    declares = 0
    for root in ROOTS:
        base = REPO_ROOT / root
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SUFFIXES or not path.is_file():
                continue
            rel = str(path.relative_to(REPO_ROOT))
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            if "verified_at" not in text and "verifiedAt" not in text:
                continue
            if not IN_SCOPE.search(text):
                continue
            declares += 1
            if rel in ALLOWLIST:
                continue
            for n, line in enumerate(text.splitlines(), 1):
                if line.lstrip().startswith(("*", "//")):
                    continue
                if any(p.search(line) for p in TESTS):
                    hits.append(f"{rel}:{n}  {line.strip()[:110]}")
    return hits, declares


def self_test() -> int:
    failures: list[str] = []
    probes = (
        ("if (!row.verified_at) return 'suspect';", True),
        ("const ok = vendor.verifiedAt !== null;", True),
        ("query.is('verified_at', null)", True),
        ("verified_at ? 'verified' : 'no'", True),
        ("verified_at: null,", False),
        ("verified_at: string | null;", False),
        ("const tier = row.listing_tier === 'curated';", False),
    )
    for source, want in probes:
        got = any(p.search(source) for p in TESTS)
        if got != want:
            failures.append(f"{source!r}: matched {got}, wanted {want}")
    if failures:
        print("SELF-TEST FAILED")
        for line in failures:
            print(f"  - {line}")
        return 1
    print(f"SELF-TEST PASSED ({len(probes)} probes, {len(TESTS)} patterns)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    hits, declares = scan()
    if declares == 0:
        print("== verified_at: the column is named in NO in-scope file.")
        print("   Either it was dropped or this guard's scope has rotted.")
        print("   Exit 2 — a check that cannot check what it claims is a")
        print("   failure, not a pass.")
        return 2

    print(f"== verified_at as a badge: {declares} in-scope file(s) name the column, "
          f"{len(hits)} test it")
    if hits:
        print()
        print("FAIL -- something decides on `vendor_catalogue.verified_at`:")
        for line in hits:
            print(f"     {line}")
        print()
        print("   It is NULL on every row in production (ADR 0117 Q26, cleared")
        print("   2026-09-05). NULL means nobody has checked this vendor — not")
        print("   that this vendor is suspect — and a stamp with no `source_ref`")
        print("   is not a verification. Read `source_ref` if you need to know")
        print("   whether something was actually checked, and say 'not checked'")
        print("   rather than ranking or hiding a row for it.")
        return 1
    print("PASS -- nothing reads it as a badge.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
