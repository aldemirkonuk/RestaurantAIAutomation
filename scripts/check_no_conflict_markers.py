#!/usr/bin/env python3
"""
Guard: no file in the planning corpus carries an unresolved merge-conflict marker.

WHY THIS EXISTS
---------------
Found 2026-08-31. `.planning/decisions/0032-vault-cleanup-cut-line.md` on `main`
carried **12 unresolved conflict blocks (36 marker lines)**, four of them nested --
inside the **Tombstone index**, the table whose entire purpose is making a deleted
file recoverable by naming its recovery commit. So the corruption sat precisely in
the structure that exists to prevent loss, and had been on `main` for days.

`.planning/07-reference/INDEX.md` carried the same corruption independently.

Nothing caught either one. Every existing register guard reads *rows* -- an id, a
line number, a claim -- and a conflict marker is none of those, so all three ran
green over a file that no longer parsed as the document it claimed to be.

    check_citation_pairing.py   an id + line that DISAGREE with each other
    check_od_ids_exist.py       an id that names NOTHING
    check_decision_claims.sh    a claim that no longer describes reality
    this guard                  a file that is not a document at all

WHY IT IS NOT VACUOUS
---------------------
A guard that passes because it found nothing to check is the failure mode this
repo has already hit (see `check_od_ids_exist.py`, "a register with no parseable
rows exited 2, not 0"). So this guard exits **2** -- not 0 -- when the corpus is
missing, unreadable, or scans to zero files. Green here always means "I read N
files and none was corrupt", never "I read nothing".

EXIT CODES
----------
    0   every scanned file is clean
    1   at least one marker found; every one is printed with file:line
    2   cannot check -- corpus missing, unreadable, or zero files matched
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / ".planning"
SUFFIXES = {".md", ".json", ".jsonl", ".txt", ".canvas", ".yml", ".yaml"}

# Built at runtime so this file does not contain the literal markers at line
# start -- otherwise the guard flags its own source and can never pass.
OURS = "<" * 7
THEIRS = ">" * 7
BASE = "=" * 7
ANCESTOR = "|" * 7
STARTS = (OURS, THEIRS, ANCESTOR)


def _opener(line: str) -> bool:
    """`<<<<<<<` alone or followed by a space and a label."""
    return line.startswith(OURS) and (len(line) == 7 or line[7] == " ")


def _closer(line: str) -> bool:
    return line.startswith(THEIRS) and (len(line) == 7 or line[7] == " ")


def _separator(line: str) -> bool:
    """`=======` exactly, or a diff3 `|||||||` ancestor line.

    A bare `=======` is ambiguous: git writes exactly seven, and markdown's setext
    H1 underline is also a run of `=`. So this is only ever consulted INSIDE an
    open block -- see `find_markers`. Outside one it is prose, and flagging it
    would train people to ignore this guard, which is worse than not having it.
    """
    if line == BASE:
        return True
    return line.startswith(ANCESTOR) and (len(line) == 7 or line[7] == " ")


def find_markers(text: str) -> list[tuple[int, str]]:
    """Conflict-marker lines in `text`, as (1-indexed lineno, line).

    Stateful on purpose. `<<<<<<<` and `>>>>>>>` are unambiguous anywhere, but a
    separator only *means* separator between them, so we track whether a block is
    open. An unterminated opener still reports -- a truncated conflict is a
    conflict.
    """
    found: list[tuple[int, str]] = []
    open_at: int | None = None
    pending: list[tuple[int, str]] = []

    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip("\r")
        if _opener(line):
            if open_at is not None:      # nested opener: the outer block is real
                found.extend(pending)
                pending = []
            else:
                open_at = lineno
            pending.append((lineno, line))
        elif open_at is not None and _separator(line):
            pending.append((lineno, line))
        elif open_at is not None and _closer(line):
            pending.append((lineno, line))
            found.extend(pending)
            pending = []
            open_at = None

    found.extend(pending)                # unterminated opener(s)
    return sorted(found)


def scan(corpus: Path) -> tuple[int, list[tuple[Path, int, str]]]:
    """Return (files_scanned, hits). Raises OSError if the corpus cannot be walked."""
    hits: list[tuple[Path, int, str]] = []
    scanned = 0
    for dirpath, dirnames, filenames in os.walk(corpus):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules"}]
        for name in sorted(filenames):
            path = Path(dirpath) / name
            if path.suffix.lower() not in SUFFIXES:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="strict")
            except (UnicodeDecodeError, OSError):
                continue  # binary or unreadable: not a document we can judge
            scanned += 1
            for lineno, line in find_markers(text):
                hits.append((path, lineno, line))
    return scanned, hits


def main(corpus: Path = CORPUS, root: Path = ROOT) -> int:
    if not corpus.is_dir():
        print(f"== Conflict markers: CANNOT CHECK -- {corpus} is not a directory")
        print("   A guard that passes because it found nothing to read is worse")
        print("   than no guard. Exiting 2 so CI treats this as unproven.")
        return 2

    try:
        scanned, hits = scan(corpus)
    except OSError as exc:
        print(f"== Conflict markers: CANNOT CHECK -- {exc}")
        return 2

    if scanned == 0:
        print(f"== Conflict markers: CANNOT CHECK -- 0 readable files under {corpus}")
        print("   Expected hundreds. Either the corpus moved or SUFFIXES is wrong.")
        return 2

    if not hits:
        print(f"== Conflict markers: {scanned} files scanned, none corrupt")
        print("PASS -- every planning document still parses as a document.")
        return 0

    by_file: dict[Path, list[tuple[int, str]]] = {}
    for path, lineno, line in hits:
        by_file.setdefault(path, []).append((lineno, line))

    print(f"== Conflict markers: {scanned} files scanned, {len(by_file)} corrupt")
    for path in sorted(by_file):
        rel = path.relative_to(root) if path.is_relative_to(root) else path
        entries = by_file[path]
        print(f"\n   {rel} -- {len(entries)} marker line(s)")
        for lineno, line in entries:
            print(f"      :{lineno}  {line[:70]}")

    print("\nFAIL -- an unresolved merge conflict is committed in the planning corpus.")
    print("   Resolve it by hand; do NOT delete the markers and keep both sides")
    print("   reflexively. 'Keep both' is right for ADDITIONS and wrong for")
    print("   CORRECTIONS and SUPERSESSIONS -- keeping both sides of a correction")
    print("   re-introduces the error the correction removed. Classify each block")
    print("   first, using the file's own history.")
    return 1


def self_test() -> int:
    """Prove the invariants against synthetic files, so a green run means something."""
    failures: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)

        clean = base / "clean"
        clean.mkdir()
        (clean / "a.md").write_text(
            "# Title\n\n| col | col |\n|---|---|\n| a | b |\n\nSetext\n=======\n",
            encoding="utf-8",
        )
        code = main(clean, clean)
        if code != 0:
            failures.append(f"a clean corpus exited {code}, not 0")

        dirty = base / "dirty"
        dirty.mkdir()
        (dirty / "b.md").write_text(
            f"intro\n{OURS} HEAD\nmine\n{BASE}\ntheirs\n{THEIRS} origin/main\n",
            encoding="utf-8",
        )
        code = main(dirty, dirty)
        if code != 1:
            failures.append(f"a corrupt corpus exited {code}, not 1")

        diff3 = base / "diff3"
        diff3.mkdir()
        (diff3 / "c.md").write_text(
            f"{OURS} HEAD\na\n{ANCESTOR} base\nb\n{BASE}\nc\n{THEIRS} other\n",
            encoding="utf-8",
        )
        _, hits = scan(diff3)
        if len(hits) != 4:
            failures.append(f"diff3 style found {len(hits)} markers, not 4")

        empty = base / "empty"
        empty.mkdir()
        code = main(empty, empty)
        if code != 2:
            failures.append(f"a corpus with 0 readable files exited {code}, not 2")

        code = main(base / "nope", base)
        if code != 2:
            failures.append(f"a missing corpus exited {code}, not 2")

        # The ambiguity that broke the first draft of this guard: a bare
        # `=======` is BOTH a git separator and a markdown setext H1 underline.
        # It counts only inside an open block.
        if find_markers(f"Setext title\n{BASE}\nbody\n"):
            failures.append("a setext H1 underline outside a block was read as a marker")
        if len(find_markers(f"{OURS} HEAD\na\n{BASE}\nb\n{THEIRS} x\n")) != 3:
            failures.append("a separator INSIDE a block was not counted")
        if find_markers("===========\n"):
            failures.append("an 11-char markdown rule was read as a marker")

        # A truncated conflict is still a conflict.
        if len(find_markers(f"{OURS} HEAD\norphan\n")) != 1:
            failures.append("an unterminated opener was not reported")

        # This guard's own source must pass, or it can never go green in CI.
        _, own = scan(ROOT / "scripts")
        if own:
            failures.append(f"the guard's own scripts/ dir reports {len(own)} marker(s)")

    print("== --self-test: 9 invariants")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a clean corpus exits 0, and a setext `=======` underline is NOT a conflict")
    print("   a corrupt corpus exits 1")
    print("   diff3-style conflicts (with an ||||||| ancestor) are caught, all 4 lines")
    print("   a corpus with 0 readable files exits 2, never 0")
    print("   a missing corpus exits 2, never 0")
    print("   a setext H1 underline outside a block is NOT a marker (the first draft got this wrong)")
    print("   a separator INSIDE a block IS counted; an 11-char markdown rule is not")
    print("   an unterminated opener is still reported")
    print("   this guard's own source scans clean")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="No planning document carries an unresolved merge-conflict marker."
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the exit-code invariants against synthetic corpora, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
