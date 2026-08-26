#!/usr/bin/env python3
"""ADR 0025 §6.2 — a citation's id and its line must agree, or CI fails.

WHY THIS EXISTS
---------------
A citation into the decision register carries two independent anchors: the id
(`OD-27`) and the line (`OPEN-DECISIONS.md:125`). Either one alone rots in
silence.

  * An id alone is unfalsifiable. `OD-83` renumbered to `OD-88` and kept
    resolving — to a different, closed decision. That is ADR 0025 defect #1,
    and it hid for a day.
  * A line alone is worse. `OPEN-DECISIONS.md` took 57 commits in August; one
    6-line insert into a row above moves every anchor below it, and nothing
    complains. When ADR 0025 measured it, line anchors into the register were
    100% wrong (0 of 23 id-paired citations agreed).

Neither anchor is reliable. The pair is, because a machine can diff them: read
the cited line, take the id of the register row on it, compare. Renumber →
caught. Row moves → caught. Both at once → caught.

WHAT THIS CATCHES, AND WHAT IT DOES NOT
---------------------------------------
Catches: a paired citation whose line no longer carries the cited id, whether
the id moved, the row moved, or the anchor was never right (ADR 0025 defect #3,
`privacy.md:59`, which was never correct and which nothing re-read for months).

Does NOT catch:

  * A citation with only one anchor. ADR 0025 §6.1 says neither alone is
    admissible, but enforcing that is a separate, larger sweep — 43 citations
    in `.planning/` name a line and no id. They are reported as ADVISORY here,
    with a count, so the number is visible and cannot grow unnoticed. Promoting
    the advisory to blocking is the founder's call (ADR 0025 §8).
  * Prose. ADR 0025 defect #2 — a dossier describing shipped work as
    outstanding — passes every anchor mechanism there is; every locator in it
    resolved. That class belongs to CLAIMS.jsonl and to not filing defect state
    in prose nothing re-reads.

KNOWN EDGE, NOT HANDLED ON PURPOSE
----------------------------------
`.planning/archive/` is scanned like anything else. Today that is free —
it holds 521 documents and **zero** register anchors — but a document archived
*after* this guard lands would carry anchors correct at freeze time, and CI
would later demand editing a frozen copy. No exclusion is written for it,
because an untested carve-out for a case with no instances is how guards grow
holes. If it ever bites, the fix is one `if` here, and ADR 0025 §7 argues most
of that directory should not exist at all.

NEVER VACUOUS: same contract as `check_decision_claims.sh`. Exit 2 is reserved
for "this guard could not check what it says it checks" — a missing or
unparseable register, a file it cannot read, or a corpus in which it found zero
citations. A guard that quietly checks nothing is worse than no guard, because
it is reported as green.

PUNCTUATION: BOTH FORMS ACCEPTED, DELIBERATELY
----------------------------------------------
The corpus writes the pair three ways today, and all three are admissible:

    OD-27, `.planning/decisions/OPEN-DECISIONS.md:125`
    (OD-86, `OPEN-DECISIONS.md:82`)
    OD-88 (OPEN-DECISIONS.md:56)          <- ADR 0025 §6.1's own example

Normalising 78 citations onto one of them is churn that buys nothing: the thing
being checked is whether the two anchors agree, not how they are punctuated. A
format gate would reject correct prose, and a gate that rejects correct prose
gets routed around. So the pairing is found by proximity, not by punctuation.

PROXIMITY WINDOW: 120 characters, measured not guessed
------------------------------------------------------
A citation is "paired" when an `OD-`/`ADR-` id appears earlier on the SAME line
within `WINDOW` characters; the nearest such id is the cited one. The window was
swept over the live corpus before being fixed:

    window   40 ->  30 pairs      window  120 ->  35 pairs
    window   80 ->  33 pairs      window  400 ->  36 pairs

Ten-fold widening buys six pairs, so nothing hinges on the exact value. 120
covers a full clause without reaching back across a sentence into an unrelated
id — which would manufacture a failure a human then has to disprove.

USAGE
-----
    scripts/check_decision_citations.py                    # scan .planning/
    scripts/check_decision_citations.py FILE [FILE ...]    # scan just these
    scripts/check_decision_citations.py --register PATH ...

EXEMPTING A LINE
----------------
A document that *quotes a broken citation as evidence* must not be forced to
repair it — ADR 0025 §2 exhibits `privacy.md:59`'s wrong anchor on purpose. Put
`<!-- cite-exempt: why -->` on that line. The reason is mandatory and the count
is printed on every run, so exemptions cannot accumulate quietly.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

DEFAULT_ROOT = ".planning"
DEFAULT_REGISTER = ".planning/decisions/OPEN-DECISIONS.md"

WINDOW = 120

# `OPEN-DECISIONS.md:125`, `OPEN-DECISIONS.md:27,74`, `OPEN-DECISIONS.md:24-27`,
# with or without a leading path. En/em dashes appear in this corpus as range
# separators, so accept them alongside the hyphen.
CITE = re.compile(
    r"(?:[\w./-]*/)?OPEN-DECISIONS\.md:(\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*)"
)
ID = re.compile(r"\b(?:OD|ADR)-\d+[a-z]?\b")

# A register row. `| OD-11a |` and `| OD-30/42 |` are both real; `| — |` rows
# carry no id and must resolve to "no id on that line", not to a crash.
ROW = re.compile(r"^\|\s*((?:OD|ADR)-\d+[a-z]?(?:/\d+)?)\s*\|")

EXEMPT = re.compile(r"<!--\s*cite-exempt:\s*(\S.*?)\s*-->")


class CannotCheck(Exception):
    """The guard could not check what it claims to. Always exit 2."""


def load_register(path: pathlib.Path) -> dict[int, str]:
    """line number -> the OD id of the register row on it."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise CannotCheck(f"cannot read the register {path}: {e}") from e

    rows: dict[int, str] = {}
    for n, line in enumerate(text.splitlines(), 1):
        m = ROW.match(line)
        if m:
            rows[n] = m.group(1)
    if not rows:
        raise CannotCheck(
            f"{path} parsed to zero decision rows. Either the register moved or its "
            f"table format changed; either way this guard is checking nothing."
        )
    return rows


def expand(spec: str) -> list[tuple[str, int, int]] | None:
    """`125` -> [(point,125,125)]; `27,74` -> two points; `24-27` -> one range."""
    out: list[tuple[str, int, int]] = []
    for part in spec.split(","):
        part = part.strip()
        m = re.fullmatch(r"(\d+)\s*[-–—]\s*(\d+)", part)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            if hi < lo or hi - lo > 200:
                return None
            out.append(("range", lo, hi))
        elif part.isdigit():
            out.append(("point", int(part), int(part)))
        else:
            return None
    return out


def scan_file(path: pathlib.Path, rows: dict[int, str], reg_lines: int):
    """Yield (kind, line_no, message) for one file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise CannotCheck(f"cannot read {path}: {e}") from e

    for n, line in enumerate(text.splitlines(), 1):
        exempt = EXEMPT.search(line)
        for m in CITE.finditer(line):
            spec = m.group(1)
            before = line[max(0, m.start() - WINDOW): m.start()]
            ids = ID.findall(before)
            if not ids:
                yield ("unpaired", n, f"`OPEN-DECISIONS.md:{spec}` names a line and no id")
                continue
            if exempt:
                yield ("exempt", n, exempt.group(1))
                continue

            cited = ids[-1]
            parts = expand(spec)
            if parts is None:
                yield ("bad", n, f"{cited} cites `OPEN-DECISIONS.md:{spec}` — unparseable line spec")
                continue

            missing = []
            for kind, lo, hi in parts:
                if hi > reg_lines:
                    missing.append(f"line {hi} is past the end of the register ({reg_lines} lines)")
                    continue
                found = {rows.get(i) for i in range(lo, hi + 1)} - {None}
                if cited in found:
                    continue
                where = f"{lo}" if kind == "point" else f"{lo}-{hi}"
                names = ", ".join(sorted(x for x in found if x)) or "no decision row at all"
                missing.append(f"line {where} carries {names}")
            if missing:
                yield ("mismatch", n, f"{cited} cited at `OPEN-DECISIONS.md:{spec}`, but " + "; ".join(missing))
            else:
                yield ("ok", n, f"{cited} @ {spec}")


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True, description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*", help="files to scan (default: every .md under --root)")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--register", default=DEFAULT_REGISTER)
    ap.add_argument(
        "--strict-pairing",
        action="store_true",
        help="ADR 0025 §6.1: fail on a citation that names a line but no id (advisory by default)",
    )
    args = ap.parse_args()

    register = pathlib.Path(args.register)
    if not register.is_file():
        print(f"FAIL — the register {register} is missing; this guard has nothing to check")
        return 2

    try:
        rows = load_register(register)
        reg_lines = len(register.read_text(encoding="utf-8").splitlines())

        if args.paths:
            targets = [pathlib.Path(p) for p in args.paths]
            for t in targets:
                if not t.is_file():
                    print(f"FAIL — {t} does not exist; refusing to report a pass over a file that is not there")
                    return 2
        else:
            root = pathlib.Path(args.root)
            if not root.is_dir():
                print(f"FAIL — {root} is not a directory; nothing to scan")
                return 2
            targets = sorted(root.glob("**/*.md"))
            if not targets:
                print(f"FAIL — no .md files under {root}")
                return 2

        mismatches: list[str] = []
        unpaired: list[str] = []
        exempted: list[str] = []
        total_pairs = 0

        for path in targets:
            for kind, n, msg in scan_file(path, rows, reg_lines):
                if kind == "unpaired":
                    unpaired.append(f"{path}:{n} — {msg}")
                elif kind == "exempt":
                    exempted.append(f"{path}:{n} — {msg}")
                else:
                    total_pairs += 1
                    if kind != "ok":
                        mismatches.append(f"{path}:{n} — {msg}")
    except CannotCheck as e:
        print(f"FAIL — {e}")
        return 2

    if total_pairs == 0 and not unpaired:
        print(
            "FAIL — zero citations into the register were found anywhere in the scan set. "
            "Either the citation format changed or this guard is pointed at the wrong tree; "
            "either way it is not checking what it says it checks."
        )
        return 2

    print(
        f"== Decision citations: {total_pairs} id+line pairs checked against "
        f"{register} ({len(rows)} decision rows)"
    )

    if exempted:
        print(f"\n== EXEMPT ({len(exempted)}) — lines that quote a broken citation on purpose")
        for e in exempted:
            print(f"   {e}")

    if unpaired:
        label = "UNPAIRED" if args.strict_pairing else "ADVISORY"
        print(f"\n== {label} ({len(unpaired)}) — a line anchor with no id beside it (ADR 0025 §6.1)")
        shown = unpaired if args.strict_pairing else unpaired[:10]
        for u in shown:
            print(f"   {u}")
        if len(shown) < len(unpaired):
            print(f"   … and {len(unpaired) - len(shown)} more (run with --strict-pairing to list and fail on all)")
        print("   A line anchor alone cannot be diffed against anything, so it rots in silence.")
        print("   Add the id it means: `OD-NN (OPEN-DECISIONS.md:LINE)`.")

    if mismatches:
        print(f"\n== MISMATCH ({len(mismatches)}) — the id and the line name different decisions")
        for m in mismatches:
            print(f"   {m}")
        print("   Fix the LINE, not the id: grep the register for the id and re-anchor.")
        print("   Both anchors are cheap to write and neither is checkable alone —")
        print("   that is the whole point of carrying two (ADR 0025 §6).")
        print("\nFAIL — a citation's two anchors disagree about which decision it means.")
        return 1

    if args.strict_pairing and unpaired:
        print("\nFAIL — --strict-pairing: a citation must carry both an id and a line (ADR 0025 §6.1).")
        return 1

    print("\nPASS — every id+line pair resolves to the decision it names.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
