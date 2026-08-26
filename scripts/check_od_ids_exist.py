#!/usr/bin/env python3
"""
Guard: every OD id named in the planning corpus exists as a row in the register.

WHY THIS EXISTS
---------------
On 2026-08-26 the design-foundation fork circulated as **OD-79** through 58
references across 52 files -- 47 page-note frontmatter comments, PAGES-MAP,
DESIGN-FOUNDATION, and a memory file. OD-79 is the *resolved* email-verification
decision (ADR 0023). Every one of those references pointed at a different,
closed decision, and the fork itself had no register row at all. It is filed as
OD-106 now.

`check_citation_pairing.py` did not catch it and could not: ADR 0025 Section 6 governs
citations that carry an id AND a `file:line`, and a bare `(OD-79)` in frontmatter
carries no locator, so it is not a citation under that rule. The two guards cover
different halves of the same failure:

    check_citation_pairing.py   an id + line that DISAGREE with each other
    this guard                  an id that names NOTHING

WHAT THIS GUARD DOES NOT CATCH, said plainly
--------------------------------------------
An id that exists but means something else. OD-79 *existed*; it simply meant
email verification rather than design direction. Nothing mechanical here would
have flagged that, and pretending otherwise would be the exact
"machinery that structurally cannot report failure" shape this repo keeps
finding. What narrows that hole is the register row itself: a fork with a row
cannot silently borrow another fork's number, because filing the row is when the
collision surfaces. File the row first.

EXEMPTIONS
----------
None, and that is the point: the exemption set ships EMPTY. Two documents that
discuss fork-id namespaces (GLOSSARY, METRICS) looked like they would need one,
and did not -- their `OD-30 / OD-42` citations resolve to a real combined row.
Add a path here only when a document genuinely cites an id outside this register,
never to silence a real miss. Path-listed rather than pattern-matched, so adding
one shows up in a diff.

Exit codes:  0 pass  |  1 an id names nothing  |  2 cannot check
"""
import os
import re
import sys
from collections import defaultdict

REGISTER = ".planning/decisions/OPEN-DECISIONS.md"
ROOT = ".planning"

# Files that discuss fork-id NAMESPACES and cite ids outside the register on purpose.
# Path-listed rather than pattern-matched: adding one should show up in a diff.
NAMESPACE_DOCS: set[str] = set()

SKIP_DIR_PARTS = (".obsidian", "/archive")


def main() -> int:
    if not os.path.exists(REGISTER):
        print(f"CANNOT CHECK — {REGISTER} not found (run from the repo root)")
        return 2

    reg = open(REGISTER, encoding="utf-8").read()
    known = set()
    for row in re.finditer(r"^\|([^|]*)\|", reg, re.M):
        cell = row.group(1)
        if "OD-" not in cell:
            continue
        # One row can carry several ids. `| OD-30/42 |` is a real row: the two
        # forks were reconciled together and share one entry, so a parser that
        # only reads the first id reports OD-42 as naming nothing -- which is
        # exactly the false positive that would train people to ignore this guard.
        known.update("OD-" + n for n in re.findall(r"OD-(\d+)", cell))
        known.update("OD-" + n for n in re.findall(r"(?<=/)(\d+)", cell))
    if not known:
        print(f"CANNOT CHECK — no `| OD-NNN |` rows parsed out of {REGISTER}")
        return 2

    missing = defaultdict(list)
    scanned = 0
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        if any(part in dirpath for part in SKIP_DIR_PARTS):
            continue
        for name in filenames:
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            if os.path.abspath(path) == os.path.abspath(REGISTER):
                continue
            if path in NAMESPACE_DOCS:
                continue
            scanned += 1
            with open(path, encoding="utf-8", errors="ignore") as fh:
                for lineno, line in enumerate(fh, 1):
                    for m in re.finditer(r"\bOD-(\d+)\b", line):
                        oid = "OD-" + m.group(1)
                        if oid not in known:
                            missing[oid].append(f"{path}:{lineno}")

    print(f"== OD ids: {scanned} documents scanned against {len(known)} register rows")
    if not missing:
        print("PASS — every OD id named in the corpus has a row.")
        return 0

    total = sum(len(v) for v in missing.values())
    print(f"\n== NAMES NOTHING ({len(missing)} id(s), {total} reference(s))")
    for oid in sorted(missing, key=lambda s: int(s.split("-")[1])):
        print(f"   {oid} — no row in {REGISTER}")
        for ref in missing[oid][:6]:
            print(f"      {ref}")
        if len(missing[oid]) > 6:
            print(f"      … and {len(missing[oid]) - 6} more")
    print(
        "\nFAIL — an OD id in the corpus names no register row.\n"
        "   Either the fork was never filed (file it, then cite the number you were\n"
        "   given), or the id was renumbered and the reference was left behind.\n"
        "   Do NOT borrow a number that is already taken: that is how the\n"
        "   design-foundation fork spent a day pointing at email verification."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
