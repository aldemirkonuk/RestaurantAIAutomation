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

--fix
-----
`./scripts/check_citation_pairing.py --fix` repoints every DISAGREEING citation onto the
row its id actually occupies, then re-checks.

This is not a convenience, it is what makes the rule livable. A single row inserted into
the register shifts every anchor below it, so ANY commit that touches OPEN-DECISIONS.md
invalidates citations in documents it never opened -- and 22% of commits since Aug 1
touched it. Measured on this branch: rebasing onto a `main` five rows longer turned 0
failures into 27, none of them anyone's mistake.

So the maintenance rule is: **if your commit adds or removes a register row, run --fix and
commit the result with it.** One command, seconds, no judgement.

--fix cannot repair UNANCHORED citations. Only a person knows which decision a bare
locator meant, and guessing would be the fabrication ADR 0020 forbids. Those still fail.

--fix REFUSES on a tree that still holds merge-conflict markers (exit 2). It rewrites
anchors in place and cannot tell a conflict block from resolved text, so it would edit
one side of a merge nobody has chosen. Reported 2026-08-27 by the session it happened
to, whose `git merge --abort` then failed with its stderr swallowed -- so the tree only
LOOKED discarded. The refusal lives inside repoint(), not at the CLI, so no caller can
route around it.

--self-test proves both of the invariants that would otherwise fail silently: a
`cite-example` citation survives --fix (repairing one deletes the finding it
illustrates), and a conflicted tree is refused and left byte-identical. It runs against
a synthetic tree, so it cannot be made to pass by the corpus happening to be clean.

Stdlib only, no third-party imports: this runs in the decision-claims job, which installs
nothing.
"""

from __future__ import annotations

import argparse
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

TEXT_SUFFIXES = {".md", ".ts", ".tsx", ".js", ".py", ".sh", ".yml", ".yaml", ".jsonl", ".json", ".sql",
                 ".html", ".htm"}
# `.html` was MISSING here until 2026-09-01, and that omission was the exact failure mode
# this guard was written to end: seven register anchors across three
# `.planning/sketches/*/canvas.html` files were neither checked nor repaired, and the run
# said PASS anyway. A blind spot that reports success is worse than no guard.
#
# It is scanned AND repaired, not report-only. The rewrite in repoint() replaces
# `m.group(1)` -- a run of digits -- with another run of digits, so it cannot emit `<`,
# `>`, `"`, `&` or a newline and cannot change markup structure. Inspected before
# enabling: the live anchors sit in element text (`<code>`, `<li>`, `<span>`) and inside
# double-quoted `title="..."` attribute values, and none of the three files contains a
# `<script>` block at all. Report-only would have been the safe answer if the substitution
# could reshape the document; it cannot, and making HTML permanently hand-maintained would
# reintroduce the rot --fix exists to prevent (see the --fix note above: one inserted
# register row moves every anchor below it).
# `.obsidian` holds vendored plugin bundles, not corpus. Excluding it is not tidiness:
# `.obsidian/plugins/obsidian-git/main.js` is a bundled *git* client, so it contains
# literal conflict-marker strings — which made the --fix conflict check below refuse
# on every clean tree until this line existed.
SKIP_PARTS = {".git", ".obsidian", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "coverage"}

# This file is the guard, not the corpus. Its docstring shows the canonical form and its
# handoff notes necessarily name anchors that are wrong -- that is the subject matter, not
# a defect. Every OTHER file in the repository is checked.
SELF = "scripts/check_citation_pairing.py"

# The `\)*` is load-bearing, not tidiness. A markdown link puts the closing paren
# BETWEEN the filename and the line number --
#     [`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md):68
# -- and the original pattern required `.md:` adjacent, so this form was invisible
# to the scan AND to `--fix`. Measured 2026-09-02: three such citations existed and
# all three were wrong, two of them by 60+ lines, on a tree the guard called clean.
# A locator that silently skips a spelling reports its own blind spot as coverage.
LOCATOR = re.compile(r"OPEN-DECISIONS\.md\)*:(\d+(?:\s*[,-]\s*\d+)*)")
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
#
# CLEARING IT IS TWO STEPS: delete the entries, then run `--fix`. Nothing needs to be
# hand-edited, and no line number in these notes needs to be trusted -- --fix reads the
# register. That is deliberate: the anchors named here were already stale once between
# writing them and pushing them.
# ---------------------------------------------------------------------------
# PAIRING_DEBT was a two-PR handoff list, not a permanent ratchet: two of its two
# entries (privacy.md::OD-27, settings.md::OD-86) are now empty -- no open PR
# still owns the six page dossiers named in ADR 0025's handoff, so both were
# fixed by --fix directly rather than deferred. Left as an empty dict, not
# deleted, so the next genuine handoff has a place to land without re-deriving
# this shape.
PAIRING_DEBT: dict[str, str] = {}


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


# ---------------------------------------------------------------------------
# --fix REFUSES TO RUN ON A TREE THAT STILL HAS CONFLICT MARKERS.
#
# Reported 2026-08-27 by the session that hit it: `--fix` was run on a working tree
# where four files still held merge markers. It will happily rewrite an anchor INSIDE
# a conflict block -- on either side of it -- producing a "resolution" nobody chose.
# Worse, the `git merge --abort` reached for afterwards failed with its stderr
# suppressed, so the tree looked discarded and was not.
#
# The check is a marker scan rather than `git diff --diff-filter=U` precisely because of
# that second half: git's own view of the tree was the thing that lied. Markers are the
# ground truth, need no subprocess, and work in a tree that is not a git checkout at all.
# ---------------------------------------------------------------------------
CONFLICT_PREFIXES = ("<<<<<<< ", ">>>>>>> ")


class ConflictedTree(Exception):
    """Raised by repoint() when the tree still carries merge markers."""

    def __init__(self, files: list[str]) -> None:
        super().__init__("working tree has unresolved conflict markers")
        self.files = files


def conflicted_files() -> list[str]:
    """Files in scan range that still carry merge-conflict markers.

    Both an opening AND a closing marker are required. One alone is something a file
    can legitimately contain — documentation about merges, a bundled diff tool — and a
    check that refuses on a clean tree is a check people learn to pass with a flag.
    """
    hits = []
    for rel, text in scan_files():
        opened = closed = False
        for line in text.splitlines():
            if line.startswith("<<<<<<< "):
                opened = True
            elif line.startswith(">>>>>>> "):
                closed = True
        if opened and closed:
            hits.append(rel)
    return hits


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


def repoint(rows: dict[int, str]) -> int:
    """Rewrite every DISAGREEING citation onto the row its id occupies. Returns the count.

    Only the line NUMBER changes, and only where an id is already present and names a real
    register row. Unanchored locators, `cite-example` lines and PAIRING_DEBT entries are
    left exactly as they are -- see the module docstring for why guessing is not on offer.
    """
    blocked = conflicted_files()
    if blocked:
        # Inside repoint() rather than only at the CLI, so no future caller can route
        # around it. The self-test asserts on this function directly for that reason.
        raise ConflictedTree(blocked)

    homes: dict[str, list[int]] = {}
    for n, rid in sorted(rows.items()):
        homes.setdefault(rid, []).append(n)

    fixed = 0
    for rel, text in scan_files():
        lines = text.splitlines(keepends=True)
        touched = False
        for i, line in enumerate(lines):
            if CITE_EXAMPLE in line:
                continue
            hits = list(LOCATOR.finditer(line))
            if not hits:
                continue
            out, last = [], 0
            for m in hits:
                cited = pair_for(line, m)
                nums = [int(x) for x in re.split(r"\s*[,-]\s*", m.group(1))]
                if cited is None or cited in [rows.get(n) for n in nums]:
                    continue
                if f"{rel}::{cited}" in PAIRING_DEBT or cited not in homes:
                    continue
                out.append(line[last:m.start(1)])
                out.append(str(homes[cited][0]))
                last = m.end(1)
                fixed += 1
                touched = True
                print(f"   fixed {rel}:{i + 1}  {cited} -> OPEN-DECISIONS.md:{homes[cited][0]}")
            if out:
                out.append(line[last:])
                lines[i] = "".join(out)
        if touched:
            (ROOT / rel).write_text("".join(lines), encoding="utf-8")
    return fixed


# ---------------------------------------------------------------------------
# --self-test
#
# Both invariants below fail SILENTLY if they regress: --fix would either edit a
# conflict block, or repair a citation that is deliberately broken and thereby delete
# the finding it illustrates. Neither shows up as a crash or a red build, which is why
# they are asserted here rather than trusted.
#
# It runs against a synthetic tree, so it needs no repository state and cannot be made
# to pass by the corpus happening to be clean today.
# ---------------------------------------------------------------------------
def self_test() -> int:
    import tempfile

    global ROOT
    real_root = ROOT
    failures: list[str] = []

    def build(tmp: pathlib.Path) -> None:
        reg = tmp / REGISTER_REL
        reg.parent.mkdir(parents=True, exist_ok=True)
        # Header lines shift the rows, so OD-N does NOT sit on line N -- a register where
        # id and line number coincide would let a broken repoint look correct.
        rows = ["# Open decisions", "", "| ID | Question |", "|---|---|"]
        rows += [f"| OD-{i} | row {i} |" for i in range(1, 61)]
        reg.write_text("\n".join(rows) + "\n", encoding="utf-8")

    def line_of(tmp: pathlib.Path, oid: str) -> int:
        for n, line in enumerate(
            (tmp / REGISTER_REL).read_text(encoding="utf-8").splitlines(), 1
        ):
            if line.startswith(f"| {oid} "):
                return n
        raise AssertionError(f"{oid} not in synthetic register")

    # -- 1. --fix must not touch a cite-example line -------------------------------
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d)
        ROOT = tmp
        build(tmp)
        doc = tmp / "doc.md"
        frozen = "The defect read `OD-7 (OPEN-DECISIONS.md:999)`. <!-- cite-example -->\n"
        movable = "See OD-7 (OPEN-DECISIONS.md:999) for the rule.\n"
        doc.write_text(frozen + movable, encoding="utf-8")
        repoint(load_register())
        after = doc.read_text(encoding="utf-8").splitlines()
        want = line_of(tmp, "OD-7")
        if after[0] != frozen.rstrip("\n"):
            failures.append("cite-example line was rewritten by --fix")
        if f"OPEN-DECISIONS.md:{want}" not in after[1]:
            failures.append("ordinary citation was NOT repointed by --fix")

    # -- 2. --fix must refuse a tree carrying conflict markers ---------------------
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d)
        ROOT = tmp
        build(tmp)
        doc = tmp / "doc.md"
        before = (
            "<<<<<<< HEAD\n"
            "See OD-7 (OPEN-DECISIONS.md:999).\n"
            "=======\n"
            "See OD-7 (OPEN-DECISIONS.md:998).\n"
            ">>>>>>> other\n"
        )
        doc.write_text(before, encoding="utf-8")
        if not conflicted_files():
            failures.append("conflict markers were not detected")
        try:
            repoint(load_register())
            failures.append("repoint() ran on a conflicted tree instead of refusing")
        except ConflictedTree:
            pass
        if doc.read_text(encoding="utf-8") != before:
            failures.append("repoint() edited inside a conflict block")

    # -- 3. HTML is scanned and repaired like any other text file --------------------
    # Added 2026-09-01 after `.html` was found missing from TEXT_SUFFIXES: seven live
    # anchors were invisible and the run still said PASS. A blind spot in the SCAN is
    # not visible in any of the checks above, so it gets its own invariant -- and the
    # markup is asserted byte-for-byte apart from the digits, which is the whole basis
    # for allowing --fix to touch HTML at all.
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d)
        ROOT = tmp
        build(tmp)
        page = tmp / "page.html"
        page.write_text(
            '<div class="cl" title="STR-9 · OD-7 (OPEN-DECISIONS.md:999) & co">\n'
            "  <p><code>OD-7</code> is at <span>OPEN-DECISIONS.md:998</span></p>\n"
            "</div>\n",
            encoding="utf-8",
        )
        repoint(load_register())
        got = page.read_text(encoding="utf-8")
        want = line_of(tmp, "OD-7")
        if f"OPEN-DECISIONS.md:{want}" not in got.splitlines()[0]:
            failures.append("an anchor inside an HTML attribute was not checked/repointed")
        if f"OPEN-DECISIONS.md:{want}" not in got.splitlines()[1]:
            failures.append("an anchor inside HTML element text was not checked/repointed")
        expected = (
            f'<div class="cl" title="STR-9 · OD-7 (OPEN-DECISIONS.md:{want}) & co">\n'
            f"  <p><code>OD-7</code> is at <span>OPEN-DECISIONS.md:{want}</span></p>\n"
            "</div>\n"
        )
        if got != expected:
            failures.append(f"--fix altered HTML beyond the line number: {got!r}")

    # -- 4. the markdown-LINK spelling is scanned and repaired like the bare one ------
    # Added 2026-09-02. `[`OPEN-DECISIONS.md`](path/OPEN-DECISIONS.md):68` puts a `)`
    # where the pattern expected `:`, so three live citations were never scanned and
    # never repointed by --fix -- and #258's re-anchor cascade walked straight past
    # them while reporting PASS. The corpus cannot catch this: a spelling the scan
    # cannot see contributes nothing to the count it would have to be missing from.
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d)
        ROOT = tmp
        build(tmp)
        doc = tmp / "linked.md"
        doc.write_text(
            "Open fork: OD-7 ([`OPEN-DECISIONS.md`](decisions/OPEN-DECISIONS.md):999).\n",
            encoding="utf-8",
        )
        repoint(load_register())
        got = doc.read_text(encoding="utf-8")
        want = line_of(tmp, "OD-7")
        expected = (
            "Open fork: OD-7 "
            f"([`OPEN-DECISIONS.md`](decisions/OPEN-DECISIONS.md):{want}).\n"
        )
        if got != expected:
            failures.append(
                "a markdown-link-form citation was not scanned/repointed: "
                f"{got!r}"
            )

    # -- 5. the headline count is the number actually checked ------------------------
    # The header printed `total - len(examples)` while `total` already excluded the
    # examples, so it under-reported by one per escape. Nothing crashes when a guard
    # miscounts its own work, which is why it is asserted rather than trusted.
    with tempfile.TemporaryDirectory() as d:
        import contextlib
        import io

        tmp = pathlib.Path(d)
        ROOT = tmp
        build(tmp)
        want = line_of(tmp, "OD-7")
        body = [f"Row {i}: OD-7 (OPEN-DECISIONS.md:{want}) is fine." for i in range(25)]
        body.append("Quoted: `OD-7 (OPEN-DECISIONS.md:999)`. <!-- cite-example -->")
        (tmp / "doc.md").write_text("\n".join(body) + "\n", encoding="utf-8")
        buf, argv = io.StringIO(), sys.argv
        sys.argv = ["check_citation_pairing.py"]
        try:
            with contextlib.redirect_stdout(buf):
                rc = main()
        finally:
            sys.argv = argv
        out = buf.getvalue()
        if rc != 0:
            failures.append(f"the synthetic clean tree did not pass: {out!r}")
        if "25 register citations checked" not in out:
            failures.append(
                "the headline count is not the number of citations checked "
                f"(25 expected, 1 cite-example skipped): {out.splitlines()[0]!r}"
            )

    ROOT = real_root
    print("== --fix self-test: 5 invariants")
    if failures:
        for f in failures:
            print(f"   FAIL — {f}")
        return 1
    print("   cite-example citations survive --fix, ordinary ones are repointed")
    print("   conflict markers are detected and the tree is left alone")
    print("   HTML is scanned and repointed, and nothing but the digits changes")
    print("   the markdown-LINK spelling is scanned and repointed, not skipped")
    print("   the headline count equals the citations actually checked")
    print("PASS")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--fix",
        action="store_true",
        help="repoint disagreeing citations onto the row their id occupies, then re-check",
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the two --fix invariants against a synthetic tree, then exit",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    rows = load_register()

    if args.fix:
        print("== Repointing citations whose id and line disagree")
        try:
            n = repoint(rows)
        except ConflictedTree as exc:
            print("\n== CANNOT FIX — the working tree still has conflict markers")
            for rel in exc.files[:10]:
                print(f"   {rel}")
            if len(exc.files) > 10:
                print(f"   … and {len(exc.files) - 10} more")
            print(
                "\n   --fix rewrites anchors in place and cannot tell a conflict block\n"
                "   from resolved text — it would edit one side of a merge nobody has\n"
                "   chosen yet. Finish the resolution, then run it.\n"
                "   (And check the resolution landed: a `git merge --abort` that fails\n"
                "   with its stderr swallowed leaves a tree that only looks discarded.)"
            )
            return 2
        print(f"   {n} rewritten\n")

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

    # `total` is already the CHECKED count: the scan loop above `continue`s on a
    # cite-example line before it ever increments `total`. Subtracting the examples a
    # second time (as this did until 2026-09-01) under-reports the work by exactly the
    # number of escapes in the corpus -- printing 164 where 165 citations were compared.
    # A guard's own headline number has to be the number it actually stands behind.
    checked = total
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
