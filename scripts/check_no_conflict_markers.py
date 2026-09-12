#!/usr/bin/env python3
"""
Guard: no tracked file in this repository carries an unresolved merge-conflict marker.

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

WHY IT WAS WIDENED (2026-09-05)
-------------------------------
The first version of this guard walked `.planning/` and nothing else, while its
name -- and its CI step -- promised the repository. Measured twice on 2026-09-05:
a builder pushed `apps/web/src/pages/inventory/useInventoryPage.ts` carrying two
unresolved hunks, and this guard printed

    == Conflict markers: 1369 files scanned, none corrupt
    PASS -- every planning document still parses as a document.

and exited 0. Reproduced with a staged probe file. That is this repo's standing
cross-cutting fault in its purest form: a checker reporting the ABSENCE of a scan
as the HEALTH of the thing it never scanned. The scanned count was true and the
verdict it implied was false, because the denominator was the wrong corpus.

So section 1 now scans **every tracked text file** (`git ls-files`), and section 2
keeps the original planning-corpus parse check as a narrower, separately-reported
pass. A conflict marker in TypeScript is exactly as much a broken file as one in
Markdown, and it reaches production faster.

EXIT CODES
----------
    0   every scanned file is clean
    1   at least one marker found; every one is printed with file:line
    2   cannot check -- cannot enumerate tracked files, corpus missing or
        unreadable, or a section scanned to zero files
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / ".planning"

# Section 2 (the planning corpus) keeps its original explicit allowlist: the
# corpus is documents, and an unknown suffix there is a reason to look, not to
# widen silently.
SUFFIXES = {".md", ".json", ".jsonl", ".txt", ".canvas", ".yml", ".yaml"}

# Section 1 (the repository) is the other way round: scan everything tracked and
# name what is skipped, because the whole defect above was an unstated exclusion.
BINARY_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".icns",
    ".svgz",
    ".pdf",
    ".zip",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".7z",
    ".rar",
    ".jar",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".webm",
    ".mov",
    ".avi",
    ".so",
    ".dylib",
    ".dll",
    ".exe",
    ".bin",
    ".wasm",
    ".class",
    ".pyc",
    ".sqlite",
    ".db",
    ".parquet",
    ".xlsx",
    ".xls",
    ".docx",
    ".pptx",
    ".keystore",
    ".jks",
    ".p12",
    ".der",
}
SKIP_DIR_PARTS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
}
SKIP_NAMES = {
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "npm-shrinkwrap.json",
    "poetry.lock",
    "Pipfile.lock",
    "Cargo.lock",
    "composer.lock",
    "bun.lockb",
    "go.sum",
}

# Vendored third-party bundles we do not author and cannot fix. Named as exact
# path prefixes rather than folded into SKIP_DIR_PARTS, because "we ship someone
# else's minified bundle here" is a much narrower claim than "skip any directory
# called plugins", and the narrow claim is the one that stays true.
#
# `.planning/.obsidian/plugins/obsidian-git/main.js:371` is the live example: the
# Obsidian Git plugin is a git client, and its bundle embeds a fenced ```diff
# block showing the user what a conflict looks like. Those marker lines are
# documentation inside a dependency, not a broken file in this repo.
VENDORED_PREFIXES = (".planning/.obsidian/plugins/",)

# Built at runtime so this file does not contain the literal markers at line
# start -- otherwise the guard flags its own source and can never pass.
OURS = "<" * 7
THEIRS = ">" * 7
BASE = "=" * 7
ANCESTOR = "|" * 7


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
            if open_at is not None:  # nested opener: the outer block is real
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

    found.extend(pending)  # unterminated opener(s)
    return sorted(found)


# ── Section 1: every tracked text file ────────────────────────────────────────


def list_tracked(root: Path) -> list[str]:
    """Tracked paths, relative to `root`. Raises RuntimeError if git cannot answer.

    `git ls-files` rather than a filesystem walk on purpose: the thing that must
    not carry a marker is the thing that gets committed, and a walk would also
    read untracked scratch files and miss nothing useful in exchange.
    """
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            capture_output=True,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"could not run git ls-files: {exc}") from exc
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git ls-files exited {proc.returncode}: {err}")
    return [p for p in proc.stdout.decode("utf-8", errors="replace").split("\0") if p]


def _is_skipped(rel: str) -> bool:
    path = Path(rel)
    if rel.startswith(VENDORED_PREFIXES):
        return True
    if path.name in SKIP_NAMES:
        return True
    if path.suffix.lower() in BINARY_SUFFIXES:
        return True
    return any(part in SKIP_DIR_PARTS for part in path.parts)


def _read_text(path: Path) -> str | None:
    """Decoded text, or None if the file is binary or unreadable.

    NUL sniff first: extensions are a hint, not a guarantee, and an extensionless
    binary would otherwise raise on decode and be silently dropped anyway.
    """
    try:
        head = path.open("rb").read(8192)
    except OSError:
        return None
    if b"\0" in head:
        return None
    try:
        return path.read_text(encoding="utf-8", errors="strict")
    except (UnicodeDecodeError, OSError):
        return None


def scan_tracked(root: Path) -> tuple[int, int, list[tuple[str, int, str]]]:
    """Return (scanned, skipped, hits) over every tracked text file under `root`."""
    hits: list[tuple[str, int, str]] = []
    scanned = 0
    skipped = 0
    for rel in list_tracked(root):
        if _is_skipped(rel):
            skipped += 1
            continue
        text = _read_text(root / rel)
        if text is None:
            skipped += 1
            continue
        scanned += 1
        for lineno, line in find_markers(text):
            hits.append((rel, lineno, line))
    return scanned, skipped, hits


def _report(hits: list[tuple[str, int, str]]) -> None:
    by_file: dict[str, list[tuple[int, str]]] = {}
    for rel, lineno, line in hits:
        by_file.setdefault(rel, []).append((lineno, line))
    for rel in sorted(by_file):
        entries = by_file[rel]
        print(f"\n   {rel} -- {len(entries)} marker line(s)")
        for lineno, line in entries:
            print(f"      {rel}:{lineno}  {line[:70]}")


def check_repo(root: Path) -> int:
    """Section 1. Exit code for the repository-wide scan."""
    try:
        scanned, skipped, hits = scan_tracked(root)
    except RuntimeError as exc:
        print(f"== Repository: CANNOT CHECK -- {exc}")
        print("   Not a git checkout, or git is unavailable. A guard that cannot")
        print("   enumerate its corpus has not passed; exiting 2.")
        return 2

    if scanned == 0:
        print(
            f"== Repository: CANNOT CHECK -- 0 readable tracked text files under {root}"
        )
        print("   Expected thousands. Either the checkout is empty or the skip")
        print("   lists have swallowed the repository.")
        return 2

    if not hits:
        print(
            f"== Repository: {scanned} tracked text files scanned "
            f"({skipped} skipped as binary/lockfile/generated), none corrupt"
        )
        return 0

    by_file = {rel for rel, _, _ in hits}
    print(
        f"== Repository: {scanned} tracked text files scanned, {len(by_file)} corrupt"
    )
    _report(hits)
    return 1


# ── Section 2: the planning corpus still parses as documents ──────────────────


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


def check_corpus(corpus: Path = CORPUS, root: Path = ROOT) -> int:
    """Section 2. Exit code for the planning-corpus scan."""
    if not corpus.is_dir():
        print(f"== Planning corpus: CANNOT CHECK -- {corpus} is not a directory")
        print("   A guard that passes because it found nothing to read is worse")
        print("   than no guard. Exiting 2 so CI treats this as unproven.")
        return 2

    try:
        scanned, hits = scan(corpus)
    except OSError as exc:
        print(f"== Planning corpus: CANNOT CHECK -- {exc}")
        return 2

    if scanned == 0:
        print(f"== Planning corpus: CANNOT CHECK -- 0 readable files under {corpus}")
        print("   Expected hundreds. Either the corpus moved or SUFFIXES is wrong.")
        return 2

    if not hits:
        print(f"== Planning corpus: {scanned} documents scanned, none corrupt")
        return 0

    rel_hits = [
        (str(p.relative_to(root)) if p.is_relative_to(root) else str(p), n, line)
        for p, n, line in hits
    ]
    by_file = {rel for rel, _, _ in rel_hits}
    print(f"== Planning corpus: {scanned} documents scanned, {len(by_file)} corrupt")
    _report(rel_hits)
    return 1


def main(root: Path = ROOT, corpus: Path = CORPUS) -> int:
    """Both sections always run, so one failure never hides the other's result."""
    codes = [check_repo(root), check_corpus(corpus, root)]
    worst = 2 if 2 in codes else (1 if 1 in codes else 0)

    if worst == 0:
        print("\nPASS -- no tracked file carries an unresolved merge-conflict marker.")
        return 0
    if worst == 2:
        print("\nCANNOT CHECK -- see the reason above. This is a failure, not a skip:")
        print(
            "   a guard reporting its own absence as health is the fault it exists to stop."
        )
        return 2

    print("\nFAIL -- an unresolved merge conflict is committed to this repository.")
    print("   Resolve it by hand; do NOT delete the markers and keep both sides")
    print("   reflexively. 'Keep both' is right for ADDITIONS and wrong for")
    print("   CORRECTIONS and SUPERSESSIONS -- keeping both sides of a correction")
    print("   re-introduces the error the correction removed. Classify each block")
    print("   first, using the file's own history.")
    return 1


# ── Self-test ─────────────────────────────────────────────────────────────────


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        env={
            **os.environ,
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_SYSTEM": "/dev/null",
        },
    )


def self_test() -> int:
    """Prove the invariants against synthetic files, so a green run means something."""
    failures: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)

        # -- Section 1: a real git repo, clean then corrupt -------------------
        repo = base / "repo"
        (repo / "src").mkdir(parents=True)
        _git(repo.parent, "init", "-q", str(repo))
        (repo / "src" / "ok.ts").write_text("export const a = 1;\n", encoding="utf-8")
        _git(repo, "add", "src/ok.ts")

        scanned, _, hits = scan_tracked(repo)
        if scanned != 1 or hits:
            failures.append(
                f"a clean git repo scanned {scanned} file(s) with {len(hits)} hit(s)"
            )
        if check_repo(repo) != 0:
            failures.append("a clean git repo did not exit 0")

        probe = repo / "src" / "conflicted.ts"
        probe.write_text(
            f"export const a = 1;\n{OURS} HEAD\nexport const b = 2;\n"
            f"{BASE}\nexport const b = 3;\n{THEIRS} origin/main\n",
            encoding="utf-8",
        )
        _git(repo, "add", "src/conflicted.ts")

        _, _, hits = scan_tracked(repo)
        if len(hits) != 3:
            failures.append(
                f"a tracked .ts probe yielded {len(hits)} marker lines, not 3"
            )
        if not any(rel == "src/conflicted.ts" for rel, _, _ in hits):
            failures.append(
                "the .ts probe was not named in the hits -- the very miss of 2026-09-05"
            )
        if check_repo(repo) != 1:
            failures.append("a git repo with a conflicted .ts file did not exit 1")

        # A lockfile and a binary are skipped, and skipping them is not a pass.
        (repo / "pnpm-lock.yaml").write_text(
            f"{OURS} HEAD\na\n{THEIRS} b\n", encoding="utf-8"
        )
        (repo / "img.png").write_bytes(b"\x89PNG\x00\x00conflict")
        _git(repo, "add", "pnpm-lock.yaml", "img.png")
        _, skipped, _ = scan_tracked(repo)
        if skipped < 2:
            failures.append(f"lockfile + binary were not skipped (skipped={skipped})")

        # An extensionless binary is caught by the NUL sniff, not by its name.
        blob = repo / "src" / "blob"
        blob.write_bytes(b"\x00\x01\x02" + f"{OURS} HEAD\n".encode())
        _git(repo, "add", "src/blob")
        _, _, hits = scan_tracked(repo)
        if any(rel == "src/blob" for rel, _, _ in hits):
            failures.append(
                "an extensionless binary was decoded instead of NUL-sniffed"
            )

        # A vendored bundle that documents conflict markers is skipped, and the
        # skip is by exact prefix -- an identically-named path elsewhere is not.
        if not _is_skipped(".planning/.obsidian/plugins/obsidian-git/main.js"):
            failures.append("the vendored obsidian-git bundle was not skipped")
        if _is_skipped("apps/web/src/plugins/obsidian-git/main.js"):
            failures.append("the vendored skip leaked outside its exact prefix")

        # Cannot enumerate -> exit 2, never 0.
        notrepo = base / "notrepo"
        notrepo.mkdir()
        if check_repo(notrepo) != 2:
            failures.append("a non-git directory did not exit 2")

        # -- Section 2: the planning corpus check, unchanged ------------------
        clean = base / "clean"
        clean.mkdir()
        (clean / "a.md").write_text(
            "# Title\n\n| col | col |\n|---|---|\n| a | b |\n\nSetext\n=======\n",
            encoding="utf-8",
        )
        if check_corpus(clean, clean) != 0:
            failures.append("a clean corpus did not exit 0")

        dirty = base / "dirty"
        dirty.mkdir()
        (dirty / "b.md").write_text(
            f"intro\n{OURS} HEAD\nmine\n{BASE}\ntheirs\n{THEIRS} origin/main\n",
            encoding="utf-8",
        )
        if check_corpus(dirty, dirty) != 1:
            failures.append("a corrupt corpus did not exit 1")

        diff3 = base / "diff3"
        diff3.mkdir()
        (diff3 / "c.md").write_text(
            f"{OURS} HEAD\na\n{ANCESTOR} base\nb\n{BASE}\nc\n{THEIRS} other\n",
            encoding="utf-8",
        )
        _, d3 = scan(diff3)
        if len(d3) != 4:
            failures.append(f"diff3 style found {len(d3)} markers, not 4")

        empty = base / "empty"
        empty.mkdir()
        if check_corpus(empty, empty) != 2:
            failures.append("a corpus with 0 readable files did not exit 2")
        if check_corpus(base / "nope", base) != 2:
            failures.append("a missing corpus did not exit 2")

        # The ambiguity that broke the first draft of this guard: a bare
        # `=======` is BOTH a git separator and a markdown setext H1 underline.
        # It counts only inside an open block.
        if find_markers(f"Setext title\n{BASE}\nbody\n"):
            failures.append(
                "a setext H1 underline outside a block was read as a marker"
            )
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
            failures.append(
                f"the guard's own scripts/ dir reports {len(own)} marker(s)"
            )

    print("\n== --self-test: 18 invariants")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   [repo] a clean git repo scans its tracked file and exits 0")
    print(
        "   [repo] a tracked .ts file with a conflict exits 1 and is named -- the 2026-09-05 miss"
    )
    print("   [repo] all 3 marker lines of the .ts probe are reported with file:line")
    print(
        "   [repo] lockfiles and binaries are skipped and counted as skipped, not as scanned"
    )
    print(
        "   [repo] an extensionless binary is caught by the NUL sniff, not by its name"
    )
    print(
        "   [repo] a vendored third-party bundle that DOCUMENTS markers is skipped by exact prefix"
    )
    print("   [repo] that vendored skip does not leak to a same-named path elsewhere")
    print("   [repo] a directory git cannot enumerate exits 2, never 0")
    print(
        "   [corpus] a clean corpus exits 0, and a setext `=======` underline is NOT a conflict"
    )
    print("   [corpus] a corrupt corpus exits 1")
    print(
        "   [corpus] diff3-style conflicts (with an ||||||| ancestor) are caught, all 4 lines"
    )
    print("   [corpus] a corpus with 0 readable files exits 2, never 0")
    print("   [corpus] a missing corpus exits 2, never 0")
    print(
        "   a setext H1 underline outside a block is NOT a marker (the first draft got this wrong)"
    )
    print("   a separator INSIDE a block IS counted; an 11-char markdown rule is not")
    print("   an unterminated opener is still reported")
    print("   this guard's own source scans clean")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="No tracked file carries an unresolved merge-conflict marker."
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the exit-code invariants against synthetic repos and corpora, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
