#!/usr/bin/env python3
"""Every citation in the day-one brief still points at something real.

WHY THIS EXISTS
---------------
ADR 0148 added `.planning/handoff/ONBOARDING.md` as the cold-start entry point, which
makes it the document most likely to be read by someone with no way to tell that it has
gone stale. That is exactly the failure CLAUDE.md section 5b was written about: prose
rots because nothing re-reads it, and a claim written as a sentence is checked once, the
day it is written.

So the brief cites `file:line` and markdown links rather than asserting, and this checks
that each one resolves:

  * the file exists, and
  * it has at least as many lines as the citation claims.

What this does NOT catch: a citation that resolves but now points at the wrong content
(a line that moved). Nothing mechanical catches that. Citing precisely enough that
someone could try to check is most of the defence.

Exit 0 when every citation resolves, 1 otherwise. Wired into CI through
CLAIMS.jsonl row ADR-0148-ONBOARDING-CITATIONS.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOC = REPO / ".planning" / "handoff" / "ONBOARDING.md"

# `PROJECT.md:8` or `v3.0-TECH-DEBT.md:65` inside backticks.
CITATION = re.compile(r"`([A-Za-z0-9_./-]+\.(?:md|py|sh|ts|tsx|sql|json)):(\d+)`")
# [text](relative/path.md) — skip URLs and pure anchors.
MDLINK = re.compile(r"\]\((?!https?://|#)([^)#\s]+)")

# Where a bare filename in a citation may live, in resolution order.
SEARCH_ROOTS = [DOC.parent, REPO / ".planning", REPO]


def resolve(ref: str) -> Path | None:
    for root in SEARCH_ROOTS:
        candidate = (root / ref).resolve()
        if candidate.is_file():
            return candidate
    return None


def main() -> int:
    if not DOC.is_file():
        print(f"❌ {DOC.relative_to(REPO)} is missing — ADR 0148 says it is the entry point")
        return 1

    text = DOC.read_text(encoding="utf-8")
    failures: list[str] = []
    checked = 0

    for ref, lineno in CITATION.findall(text):
        checked += 1
        target = resolve(ref)
        if target is None:
            failures.append(f"{ref}:{lineno} — no such file under {', '.join(str(r.relative_to(REPO)) or '.' for r in SEARCH_ROOTS)}")
            continue
        count = sum(1 for _ in target.open("r", encoding="utf-8", errors="replace"))
        if int(lineno) > count:
            failures.append(
                f"{ref}:{lineno} — {target.relative_to(REPO)} has only {count} lines"
            )

    for ref in MDLINK.findall(text):
        checked += 1
        if not (DOC.parent / ref).resolve().exists():
            failures.append(f"link {ref} — does not resolve from {DOC.parent.relative_to(REPO)}/")

    if failures:
        print(f"❌ {len(failures)} of {checked} citation(s) in ONBOARDING.md no longer resolve:")
        for f in failures:
            print(f"   {f}")
        print("\n   Fix the citation or the brief — a cold reader cannot tell it drifted.")
        return 1

    print(f"✅ all {checked} citations in ONBOARDING.md resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
