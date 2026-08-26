#!/usr/bin/env python3
"""
Guard: a citation into the decision register must carry TWO anchors that disagree loudly.

ADR 0025 (`.planning/decisions/0025-citations-must-disagree-loudly.md`), §6, locked by
the founder on 2026-08-26.

WHY THIS EXISTS
---------------
Three citation defects were found by hand on 2026-08-26 and each failed differently:

  1. `studio.md` cited an OD id that had been RENUMBERED on rebase. The citation still
     resolved -- to a different, closed decision. An id alone is unfalsifiable.
  2. `settings.md` described 22 dead toggles as live. Every `file:line` in the paragraph
     resolved; the PROSE was what lied. No locator mechanism catches that class; it stays
     the job of `.planning/decisions/CLAIMS.jsonl`.
  3. `privacy.md:59` anchored OD-27 at two register lines that named OD-05 and OD-81.
     The anchor was never correct and nothing ever re-read it.

Measured across the corpus the same day: of the register citations that named an id AND a
line, **zero** agreed. Not one. The register is ~130 lines, so this was never a locating
problem -- the anchors are simply never re-read, and 22% of all commits since Aug 1 touch
`OPEN-DECISIONS.md`, so any line anchor into it is doomed by construction.

The answer is not to pick the better anchor. It is to carry BOTH and diff them, which
converts a silent failure into a loud one:

    OD-88 (OPEN-DECISIONS.md:56)          <- id and line, machine-comparable

A renumber moves the id and not the line. An insert moves the line and not the id. Either
way the two stop agreeing and this guard says so.

WHAT THIS CHECKS
----------------
Both arms of ADR 0025 §6.1-2, because a pair-only check is routed around by dropping the
id -- which is exactly the "gate that exempts half the corpus" failure the ADR rejects in
§4 when it declines to enforce symbol anchors:

  * UNANCHORED -- an `OPEN-DECISIONS.md:N` locator with no `OD-nn` id beside it on the
    same line (within PAIR_WINDOW characters). §6.1: "Neither alone is admissible."
  * DISAGREEING -- the id and the line do not name the same row. §6.2.

A citation may name several lines (`OPEN-DECISIONS.md:24,27`); it passes if ANY of them is
a register row for the cited id, since a decision can legitimately appear once in Open and
once in Resolved.

WHAT THIS DOES NOT CHECK, STATED PLAINLY
----------------------------------------
It does not make prose true. Defect #2 above passes every mechanism in ADR 0025 and this
guard is no exception. That class is bounded only by CLAIMS.jsonl coverage. Source-code
citations (`file.ts:99`) are advisory per §6.3 and are not touched here -- the ADR tested
and rejected enforcing them.

NEVER VACUOUS
-------------
Every "found nothing" path is a FAILURE, not a pass:
  * the register is missing or unreadable      -> exit 2
  * the register parses to < MIN_ROWS rows     -> exit 2, the row pattern rotted
  * the scan finds < MIN_LOCATORS citations    -> exit 2, the locator pattern rotted
Exit 0 = clean. Exit 1 = broken citations (printed). Exit 2 = the guard could not check
what it claims to, which is a failure, not a skip.

Stdlib only, no third-party imports: this runs in the decision-claims job, which installs
nothing.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTER_REL = ".planning/decisions/OPEN-DECISIONS.md"

# The register has ~100 rows and the corpus ~78 citations. These floors exist to catch a
# rotted pattern, not to police the corpus size -- they sit far below today's numbers.
MIN_ROWS = 50
MIN_LOCATORS = 20

# How far from the locator an id may sit and still count as "carried with" it. A citation
# in canonical form puts them adjacent; a long markdown row can legitimately put the id at
# the start of the row. Beyond this the id is a coincidence, not a pair.
PAIR_WINDOW = 120

TEXT_SUFFIXES = {".md", ".ts", ".tsx", ".js", ".py", ".sh", ".yml", ".yaml", ".jsonl", ".json", ".sql"}
SKIP_PARTS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "coverage"}

# This file is the guard, not the corpus. Its docstring shows the canonical form and its
# handoff notes necessarily name anchors that are wrong -- that is the subject matter, not
# a defect. Every OTHER file in the repository is checked.
SELF = "scripts/check_citation_pairing.py"

LOCATOR = re.compile(r"OPEN-DECISIONS\.md:(\d+(?:\s*[,-]\s*\d+)*)")
OD_ID = re.compile(r"OD-\d+")
# `| OD-88 | ...`  and  `| **OD-88** | ...`
REGISTER_ROW = re.compile(r"^\|\s*\**\s*(OD-\d+)")

# ---------------------------------------------------------------------------
# CITE_EXAMPLE -- the escape for text that QUOTES a broken citation.
#
# ADR 0025 has to reproduce defect #3 verbatim to explain it, and a document that
# describes citation rot cannot be forbidden from showing one. A line containing the
# marker `cite-example` is skipped.
#
# This is an escape, so it is rationed like one: every use is printed by name, and the
# count may not exceed CITE_EXAMPLE_MAX. Raising that number is a decision someone has to
# make on purpose, in a diff, with a reason -- not a thing that drifts.
# ---------------------------------------------------------------------------
CITE_EXAMPLE = "cite-example"
CITE_EXAMPLE_MAX = 2

# ---------------------------------------------------------------------------
# PAIRING_DEBT -- a two-PR handoff list, NOT a permanent debt ratchet.
#
# These citations are wrong and known to be wrong. They are not fixed here because a
# concurrent branch owns those files (`.planning/06-pages/communications.md`,
# `notifications.md`, `privacy.md`, `receipts.md`, `recommendations-catalog.md`,
# `settings.md`) and two branches editing the same lines produces a conflict, not a fix.
# `.planning/04-specs/HANDOFF-adr-0025.md` carries the full list and the correct anchors.
#
# Keyed by "<path>::<OD id>" rather than by line, so the entry survives the file being
# edited around it.
#
# HOW THIS DIFFERS FROM KNOWN_MISSING in scripts/check_queried_tables_exist.py, and why:
# that list is enforced in BOTH directions -- an entry that starts passing fails the build
# until someone prunes it. That is right for a permanent ratchet and wrong here. The whole
# point of this list is that another PR is fixing these citations right now; a
# both-directions ratchet would turn their merge into a red main. So a stale entry here is
# a loud NOTICE and exit 0.
#
# That softness is a cost, and it is bounded by emptying the list: once both PRs are on
# main, delete every line below and this comment with them. An entry that outlives the
# handoff is debt nobody agreed to.
# ---------------------------------------------------------------------------
PAIRING_DEBT: dict[str, str] = {
    ".planning/06-pages/privacy.md::OD-27": (
        "privacy.md:59 and :129 both anchor OD-27 at OPEN-DECISIONS.md:123, which is "
        "OD-28. This is defect #3 in ADR 0025 §2 -- the anchor was never correct. "
        "Correct anchor as of 2026-08-26: OPEN-DECISIONS.md:125."
    ),
    ".planning/06-pages/settings.md::OD-86": (
        "settings.md:123 anchors OD-86 at OPEN-DECISIONS.md:78, which is OD-81. "
        "Correct anchor as of 2026-08-26: OPEN-DECISIONS.md:82."
    ),
}


def die(msg: str) -> None:
    print(f"FAIL — {msg}")
    print("   Exit 2 means this guard could not check what it claims to. That is a")
    print("   failure, not a skip: a green run would be a lie about work not done.")
    sys.exit(2)


def load_register() -> dict[int, str]:
    path = ROOT / REGISTER_REL
    if not path.is_file():
        die(f"{REGISTER_REL} is missing; this guard has nothing to check against")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        die(f"cannot read {REGISTER_REL}: {exc}")
    rows = {}
    for n, line in enumerate(lines, 1):
        m = REGISTER_ROW.match(line)
        if m:
            rows[n] = m.group(1)
    if len(rows) < MIN_ROWS:
        die(
            f"{REGISTER_REL} parsed to only {len(rows)} decision rows (floor {MIN_ROWS}). "
            "The row pattern rotted, or the register was reformatted -- either way this "
            "guard would pass everything for the wrong reason."
        )
    return rows


def scan_files():
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.suffix not in TEXT_SUFFIXES:
            continue
        rel = path.relative_to(ROOT)
        if SKIP_PARTS & set(rel.parts) or str(rel) == SELF:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        yield str(rel), text


def pair_for(line: str, m: re.Match) -> str | None:
    """The id carried with this locator: the nearest one on the line, ties to the left.

    Ties go left because the canonical form written by ADR 0025 §6.1 puts the id first:
    `OD-88 (OPEN-DECISIONS.md:56)`.
    """
    best = None
    for im in OD_ID.finditer(line):
        if im.end() <= m.start():
            dist, side = m.start() - im.end(), 0
        elif im.start() >= m.end():
            dist, side = im.start() - m.end(), 1
        else:
            dist, side = 0, 0
        if dist <= PAIR_WINDOW and (best is None or (dist, side) < best[0]):
            best = ((dist, side), im.group(0))
    return best[1] if best else None


def main() -> int:
    rows = load_register()

    unanchored: list[tuple[str, int, str, str]] = []
    disagreeing: list[tuple[str, int, str, str, list[int], list[str | None]]] = []
    debt_hit: set[str] = set()
    examples: list[str] = []
    total = 0

    for rel, text in scan_files():
        for ln, line in enumerate(text.splitlines(), 1):
            hits = list(LOCATOR.finditer(line))
            if not hits:
                continue
            if CITE_EXAMPLE in line:
                examples.append(f"{rel}:{ln}")
                continue
            for m in hits:
                total += 1
                cited = pair_for(line, m)
                nums = [int(x) for x in re.split(r"\s*[,-]\s*", m.group(1))]
                if cited is None:
                    unanchored.append((rel, ln, m.group(0), line.strip()[:140]))
                    continue
                got = [rows.get(n) for n in nums]
                if cited in got:
                    continue
                key = f"{rel}::{cited}"
                if key in PAIRING_DEBT:
                    debt_hit.add(key)
                    continue
                disagreeing.append((rel, ln, m.group(0), cited, nums, got))

    if total < MIN_LOCATORS:
        die(
            f"the scan found only {total} register citations (floor {MIN_LOCATORS}). "
            "The locator pattern rotted, or the scan roots moved. A guard that finds "
            "nothing must not report success."
        )

    if len(examples) > CITE_EXAMPLE_MAX:
        print(f"== TOO MANY '{CITE_EXAMPLE}' ESCAPES ({len(examples)}, max {CITE_EXAMPLE_MAX})")
        for e in examples:
            print(f"   {e}")
        print(f"   The escape exists so ADR 0025 can QUOTE a broken citation while explaining it.")
        print(f"   It is not a way to opt a real citation out of the check. Fix the citation,")
        print(f"   or raise CITE_EXAMPLE_MAX in this file on purpose, in a diff, with a reason.")
        print()
        print("FAIL — the citation-check escape is being used as an opt-out.")
        return 1

    checked = total - len(examples)
    print(f"== Citation pairing: {checked} register citations checked against {len(rows)} rows")

    if examples:
        print(f"   ({len(examples)} skipped as quoted examples: {', '.join(examples)})")

    if debt_hit:
        print()
        print(f"== HANDOFF DEBT ({len(debt_hit)}) — wrong, owned by a concurrent branch")
        for key in sorted(debt_hit):
            print(f"   {key}")
            print(f"      {PAIRING_DEBT[key]}")

    stale = sorted(set(PAIRING_DEBT) - debt_hit)
    if stale:
        print()
        print(f"== PRUNE ME ({len(stale)}) — on the handoff list but no longer failing")
        for key in stale:
            print(f"   {key}")
        print("   Someone fixed these. Delete the lines from PAIRING_DEBT in this file.")
        print("   That is the handshake, not a collision. Not failing the build on it is")
        print("   deliberate: this list exists to survive two PRs landing in either order.")

    if unanchored:
        print()
        print(f"== UNANCHORED ({len(unanchored)}) — a register line with no id beside it")
        for rel, ln, loc, snippet in unanchored:
            print(f"   {rel}:{ln}  {loc}")
            print(f"      {snippet}")

    if disagreeing:
        print()
        print(f"== DISAGREEING ({len(disagreeing)}) — the id and the line name different rows")
        for rel, ln, loc, cited, nums, got in disagreeing:
            names = ", ".join(f"{n}={g or 'not a decision row'}" for n, g in zip(nums, got))
            print(f"   {rel}:{ln}  cites {cited} at {loc}")
            print(f"      that line is: {names}")
            homes = [str(n) for n, rid in sorted(rows.items()) if rid == cited]
            if homes:
                print(f"      {cited} is at OPEN-DECISIONS.md:{','.join(homes)} — write "
                      f"`{cited} (OPEN-DECISIONS.md:{homes[0]})`")
            else:
                print(f"      {cited} is not in the register at all. It was renumbered or "
                      f"never existed — find what it became before repointing the line.")

    if unanchored or disagreeing:
        print()
        print("FAIL — a citation into the decision register does not agree with itself.")
        print("   ADR 0025 §6: a citation carries an id AND a line, and CI fails when they")
        print("   disagree. Neither anchor alone can rot loudly, and rot that is not loud")
        print("   is the whole problem.")
        return 1

    print("PASS — every register citation names the row it points at.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
