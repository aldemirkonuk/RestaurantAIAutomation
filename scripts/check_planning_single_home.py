#!/usr/bin/env python3
"""Every planning document has exactly one home.

CLAUDE.md §4 adopted retire-to-write on 2026-08-24: adding a document means
naming one to retire, merge, or supersede. For the phase and quick corpora the
rule was satisfied by *copying* — `gsd-complete-milestone` wrote each finished
phase into `.planning/archive/vN.0-phases/` and left the original in
`.planning/phases/`. By 2026-08-26 that had produced 469 of 522 archive files
(89.8%, 6.4 MB of 6.9 MB) as byte-identical twins of a live file. Nothing was
retired; the corpus had merely doubled, and every reader had two candidate
sources with no rule saying which one was current.

Three of those pairs had *drifted*: the live copy carried later edits the
archive copy never got — a 2026-07-31 `status:` backfill, and phase 30's
calendar-UAT discharge note recording a real `PRODID` defect. A cleanup that
deleted the live side wholesale would have destroyed them silently. That is why
this guard exists rather than a one-time sweep: the sweep is cheap to redo, but
nobody re-measures a corpus that looks tidy, and the next milestone close
re-creates the whole problem in one command.

The rule this enforces:

    .planning/archive/vN.0-{phases,quick}/   closed milestones — canonical
    .planning/{phases,quick}/                current milestone only

NEVER VACUOUS
-------------
`check_decision_claims.sh:149` reads any non-zero exit as "the claim correctly
does not hold", so a renamed file there is indistinguishable from a fixed bug.
This guard must not inherit that flaw. It asserts the shape it depends on
before it checks anything, and exits 2 — a failure, not a pass — when the
corpus no longer looks the way the check assumes. A guard that cannot tell
"clean" from "could not look" is not a guard.

Exit codes:  0 clean   1 violation found   2 cannot check
"""

import hashlib
import os
import sys
from collections import defaultdict

PLANNING = ".planning"
ARCHIVE = os.path.join(PLANNING, "archive")
LIVE_DIRS = [os.path.join(PLANNING, "phases"), os.path.join(PLANNING, "quick")]
ARCHIVE_SUFFIXES = ("-phases", "-quick")

# A placeholder is the one legitimate way a live phase directory outlives its
# content: it reserves a slot for work not yet started.
PLACEHOLDERS = {".gitkeep"}


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(base):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            yield os.path.join(dirpath, name)


def fail_cannot_check(reason):
    print(f"CANNOT CHECK: {reason}", file=sys.stderr)
    print(
        "This is a failure, not a skip. The guard's assumptions about the "
        "corpus no longer hold, so a clean result would be meaningless.",
        file=sys.stderr,
    )
    sys.exit(2)


def main():
    if not os.path.isdir(PLANNING):
        fail_cannot_check(f"{PLANNING}/ does not exist — run from the repo root")
    if not os.path.isdir(ARCHIVE):
        fail_cannot_check(f"{ARCHIVE}/ does not exist")

    archive_roots = sorted(
        d
        for d in os.listdir(ARCHIVE)
        if os.path.isdir(os.path.join(ARCHIVE, d)) and d.endswith(ARCHIVE_SUFFIXES)
    )
    if not archive_roots:
        fail_cannot_check(
            f"no vN.0-phases / vN.0-quick roots under {ARCHIVE}/ — either the "
            "archive layout changed or the archive was emptied"
        )

    # Index the archive by content and by path-within-root.
    by_hash = defaultdict(list)
    by_rel = defaultdict(list)
    archive_files = 0
    for root in archive_roots:
        base = os.path.join(ARCHIVE, root)
        for path in walk(base):
            archive_files += 1
            rel = os.path.relpath(path, base)
            by_hash[digest(path)].append(path)
            by_rel[(root.rsplit("-", 1)[1], rel)].append(path)

    if archive_files == 0:
        fail_cannot_check(f"{ARCHIVE}/ has roots but no files in them")

    violations = []

    # 1. A closed-milestone document still sitting in the live tree.
    for live_base in LIVE_DIRS:
        if not os.path.isdir(live_base):
            continue  # a milestone with no quick tasks is legitimate
        kind = os.path.basename(live_base)
        for path in walk(live_base):
            if os.path.basename(path) in PLACEHOLDERS:
                continue
            rel = os.path.relpath(path, live_base)
            twins = by_hash.get(digest(path), [])
            if twins:
                violations.append(
                    f"{path}\n      is byte-identical to {twins[0]}\n"
                    f"      -> the archive copy is canonical; delete the live one"
                )
                continue
            # Same slot, different bytes: the live copy is a later revision of an
            # archived document. Silent divergence, and the dangerous case — a
            # naive cleanup picks the wrong side.
            same_slot = by_rel.get((kind, rel), [])
            if same_slot:
                violations.append(
                    f"{path}\n      has DRIFTED from {same_slot[0]}\n"
                    f"      -> promote the newer content into the archive, then "
                    f"delete the live copy"
                )

    # 2. One document copied under two archive roots.
    for (kind, rel), paths in sorted(by_rel.items()):
        if len(paths) < 2:
            continue
        hashes = {digest(p) for p in paths}
        if len(hashes) == 1:
            violations.append(
                f"{paths[1]}\n      duplicates {paths[0]} under a second archive "
                f"root\n      -> keep the earliest milestone's copy, delete the rest"
            )

    if violations:
        print(f"{len(violations)} planning document(s) do not have a single home:\n")
        for v in violations:
            print(f"  - {v}\n")
        print(
            "Rule: .planning/archive/vN.0-{phases,quick}/ is canonical for closed\n"
            "milestones; .planning/{phases,quick}/ holds the current milestone only."
        )
        return 1

    live_count = sum(
        1 for d in LIVE_DIRS if os.path.isdir(d) for _ in walk(d)
    )
    print(
        f"single-home: OK — {archive_files} archived across {len(archive_roots)} "
        f"milestone root(s), {live_count} live, 0 duplicated."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
