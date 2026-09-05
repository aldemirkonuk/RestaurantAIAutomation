#!/usr/bin/env python3
"""A rendered money figure names the currency it is in, or says it has none.

WHY THIS GUARD EXISTS
---------------------
`restaurants.currency` said `USD` on all fourteen production houses — measured
2026-09-05, two of them in Türkiye and one in London — because the column
carried `DEFAULT 'USD'` and nothing ever asked (ADR 0117 Q25). The founder's
answer to Q30 was to clear every unattributable value to NULL, so **"currency not
recorded" is now a state the product will actually be in**, on houses that are
using it today.

Every screen that renders `$` or pins `currency: 'USD'` is a screen that will lie
about those houses. This guard counts them, holds the count in a baseline, and
fails when the count GOES UP. It is not a demand to fix them all in one pass —
the surface is large and most of these components have no house currency in
scope — it is a demand that the number only ever shrink.

WHY A BASELINE AND NOT A BAN
----------------------------
A ban would have to be turned off on day one, and a check that is off is
indistinguishable from a check that passes. The baseline is the honest shape used
by `check_read_errors_not_swallowed.py`: the debt is written down, per file, and
lowering a row is the only way to change it.

NEVER VACUOUS
-------------
If the scan matches NOTHING, that is a rotted pattern rather than a clean tree,
and this exits **2** — a guard that cannot check what it claims is a failure, not
a pass (ADR 0051, [[absence-reported-as-health]]).

USAGE
    python3 scripts/check_money_states_its_currency.py
    python3 scripts/check_money_states_its_currency.py --self-test
    python3 scripts/check_money_states_its_currency.py --write-baseline
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE = REPO_ROOT / "scripts" / "money_currency_baseline.json"

ROOTS = ("apps/web/src", "apps/mobile/src", "apps/mobile/app")
SUFFIXES = (".ts", ".tsx")

# A currency pinned to a literal in a formatter, and a money string built from a
# bare dollar sign. Both assert a currency the house may not be in.
#
# Both are deliberately NARROW. An earlier draft also matched `>${` and
# `` `${ ``, which is every template literal in the repository: it reported 1,465
# "sites" across 381 files, most of them table cells and log lines. A guard whose
# number is mostly noise cannot be acted on, and a number nobody acts on is the
# same as no guard — so the patterns match only shapes that are money by
# construction.
PATTERNS = (
    # A currency pinned to a literal in a formatter.
    re.compile(r"""currency:\s*['"]USD['"]"""),
    # A dollar sign immediately in front of an interpolation: `$${total}`. In a
    # template literal that is a rendered money figure and nothing else.
    re.compile(r"""\$\$\{"""),
)

# Files that are ALLOWED to name a currency literal, with the reason. Each entry
# is a claim somebody has to be willing to write.
ALLOWLIST: dict[str, str] = {
    # A render test: the fixture STATES the distributor's own currency so the
    # panel can be asserted to print the stated one and never a default. The
    # literal is the test's premise, not a page's assumption (2026-09-05, p4bj).
    "apps/web/src/pages/connections/next/DistributorFeedPanel.test.tsx": "a fixture that states the vendor's own currency so the assertion can check the panel prints it",
    # The table itself: naming USD is what it is for.
    "apps/web/src/lib/currency.ts": "the ISO 4217 table and the formatter that refuses to assume one",
    "apps/web/src/lib/countries.ts": "the one country table: `currency: 'USD'` there is Ecuador, El Salvador and the United States, which is the fact the table exists to hold",
    "apps/web/src/lib/currency.test.ts": "asserts the refusal, so it must name the literals",
    # The symbol map is keyed BY currency and returns '' for an unknown one.
    "apps/web/src/components/documents/canonical-format.ts": "symbol lookup keyed by the document's own currency; unknown renders unsymboled",
}

TEST_HINTS = (".test.", ".spec.", "__tests__", "stories")


def scan() -> dict[str, int]:
    """Files with money that pins a currency, and how many sites each has."""
    found: dict[str, int] = {}
    for root in ROOTS:
        base = REPO_ROOT / root
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in SUFFIXES or not path.is_file():
                continue
            rel = str(path.relative_to(REPO_ROOT))
            if rel in ALLOWLIST:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            hits = sum(len(p.findall(text)) for p in PATTERNS)
            if hits:
                found[rel] = hits
    return found


def load_baseline() -> dict[str, int]:
    if not BASELINE.is_file():
        return {}
    return json.loads(BASELINE.read_text(encoding="utf-8"))["files"]


def self_test() -> int:
    failures: list[str] = []
    probes = (
        ("currency: 'USD'", 1),
        ('currency: "USD"', 1),
        ("`$${total.toFixed(2)}`", 1),
        ("return `$${n.toFixed(2)}`", 1),
        # NOT matched, on purpose: a plain interpolation is not money. Matching
        # it is what produced the 1,465-site number this guard was rewritten to
        # stop reporting.
        ("`<td>${row.name}</td>`", 0),
        ("currency: houseCurrency", 0),
        ("fmtMoney(n, currency)", 0),
        ("const cost = total * 2", 0),
    )
    for source, want in probes:
        got = sum(len(p.findall(source)) for p in PATTERNS)
        if (got > 0) != (want > 0):
            failures.append(f"{source!r}: matched {got}, wanted {'a hit' if want else 'none'}")
    if not (REPO_ROOT / "apps" / "web" / "src").is_dir():
        failures.append("apps/web/src is not there; this guard would scan nothing")
    if failures:
        print("SELF-TEST FAILED")
        for line in failures:
            print(f"  - {line}")
        return 1
    print(f"SELF-TEST PASSED ({len(probes)} probes, {len(PATTERNS)} patterns)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="record today's debt. Only ever run this to LOWER a row.",
    )
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    found = scan()
    if not found:
        print("== Money currency: the scan matched NOTHING.")
        print("   That is a rotted pattern, not a clean tree: this repository")
        print("   had 40+ sites when the guard was written. Exit 2 — a check")
        print("   that cannot check what it claims is a failure, not a pass.")
        return 2

    total = sum(found.values())
    app_files = {f: n for f, n in found.items()
                 if not any(h in f for h in TEST_HINTS)}
    if args.write_baseline:
        BASELINE.write_text(
            json.dumps({
                "_why": "Sites that render money with a pinned currency or a bare "
                        "dollar sign. ADR 0117 Q25/Q30. This number only ever goes "
                        "DOWN; raising a row is not an option, and a new file is a "
                        "new failure.",
                "_measured": "2026-09-05",
                "files": dict(sorted(found.items())),
            }, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Baseline written: {len(found)} files, {total} sites.")
        return 0

    baseline = load_baseline()
    regressions: list[str] = []
    improvements: list[str] = []
    for path, count in sorted(found.items()):
        allowed = baseline.get(path)
        if allowed is None:
            regressions.append(f"{path}  NEW file with {count} site(s)")
        elif count > allowed:
            regressions.append(f"{path}  {allowed} -> {count}")
    for path, allowed in sorted(baseline.items()):
        now = found.get(path, 0)
        if now < allowed:
            improvements.append(f"{path}  {allowed} -> {now}")

    print(f"== Money currency: {len(found)} file(s), {total} site(s) that pin a "
          f"currency or print a bare dollar sign")
    print(f"   ({len(app_files)} of those files are product code, the rest tests "
          f"and fixtures)")
    print(f"   Baseline holds {len(baseline)} file(s), "
          f"{sum(baseline.values())} site(s).")
    print()
    if improvements:
        print("   FIXED since the baseline — lower these rows:")
        for line in improvements:
            print(f"     {line}")
        print()
    if regressions:
        print("FAIL -- money gained a pinned currency:")
        for line in regressions:
            print(f"     {line}")
        print()
        print("   A house whose currency is NULL renders these as dollars, and")
        print("   three production houses are not in dollars. Use the house's own")
        print("   currency and let it be null, or say 'currency not recorded'.")
        return 1
    print("PASS -- no new money asserts a currency nobody stated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
