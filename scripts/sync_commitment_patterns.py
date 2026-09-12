#!/usr/bin/env python3
"""Generate the Python commitment-language guardrail from its canonical TS source.

OD-44. The UCC contract-formation guardrail exists in two runtimes:

  * apps/api-gateway/src/common/orchestrator/commitment-patterns.ts   (canonical)
  * services/agent-orchestrator/core/commitment_patterns.py           (generated)

They were maintained as two hand-written lists under a comment claiming they were
"ported verbatim". They were not: TS carried 19 patterns, Python carried 8, and
Python is the runtime that actually auto-sends (``_scarcity_auto_reply``). The
runtime that could bind the restaurant to a purchase had the weaker guardrail.

Why generate rather than have both runtimes read one shared data file:
the two services ship as separate containers. ``apps/api-gateway/Dockerfile``
copies only ``apps/api-gateway/dist`` into the runtime image, and the
orchestrator's Railway root directory is ``services/agent-orchestrator`` so its
build context cannot reach the repo root. No repo-root file is present in either
image at runtime. A JSON file inside the gateway tree does not survive either:
``nest build`` uses the swc builder, which emits ``require("./x.json")`` but does
not copy ``.json`` into ``dist``. Generation is the only arrangement that ships.

Usage::

    python3 scripts/sync_commitment_patterns.py            # write the Python module
    python3 scripts/sync_commitment_patterns.py --check     # exit 1 if it is stale

Stdlib only, so the ``--check`` mode runs in CI with no install step (same idiom
as scripts/build_loop_index.py --check).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

TS_SOURCE = (
    REPO_ROOT
    / "apps"
    / "api-gateway"
    / "src"
    / "common"
    / "orchestrator"
    / "commitment-patterns.ts"
)
PY_TARGET = (
    REPO_ROOT / "services" / "agent-orchestrator" / "core" / "commitment_patterns.py"
)

_ARRAY_RE = re.compile(
    r"export const COMMITMENT_PATTERN_SOURCES:\s*readonly string\[\]\s*=\s*\[(.*?)\];",
    re.DOTALL,
)

GENERATED_HEADER = '''"""GENERATED FILE — DO NOT EDIT BY HAND.

UCC contract-formation guardrail patterns (AI-SPEC §6, OD-44).

Canonical source:
    apps/api-gateway/src/common/orchestrator/commitment-patterns.ts

Regenerate with:
    python3 scripts/sync_commitment_patterns.py

CI runs ``--check`` and fails if this file drifts from the TypeScript canon.
Editing the list here instead of at the canon is the exact failure OD-44 records:
the guardrail silently weakened on the runtime that can auto-send.
"""

from __future__ import annotations

import re
from typing import List

#: Pattern sources, mirrored verbatim from the TypeScript canon.
COMMITMENT_PATTERNS: List[str] = [
'''

GENERATED_FOOTER = ''']

#: Pre-compiled, case-insensitive — matches the JavaScript ``/i`` flag.
COMPILED_COMMITMENT_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in COMMITMENT_PATTERNS
]


def contains_commitment_language(text: str) -> bool:
    """True when *text* contains language that could form a binding purchase commitment.

    Callers must never auto-send a message for which this returns True.
    """
    return any(p.search(text) for p in COMPILED_COMMITMENT_PATTERNS)
'''


def parse_canonical_patterns(ts_text: str) -> list[str]:
    """Extract the pattern list from the canonical TypeScript module.

    The canon deliberately restricts itself to double-quoted string literals with
    JSON-compatible escaping, so the array body parses as JSON once the trailing
    comma is removed. That keeps this parser exact rather than heuristic.
    """
    match = _ARRAY_RE.search(ts_text)
    if not match:
        raise SystemExit(
            f"Could not find COMMITMENT_PATTERN_SOURCES in {TS_SOURCE}.\n"
            "The canonical array must stay a plain `export const "
            "COMMITMENT_PATTERN_SOURCES: readonly string[] = [ ... ];` literal."
        )

    body = match.group(1)
    # Drop `// ...` comments and the trailing comma so the body is valid JSON.
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r",\s*$", "", body.strip())

    try:
        patterns = json.loads(f"[{body}]")
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise SystemExit(
            f"Canonical pattern array in {TS_SOURCE} is not JSON-parsable: {exc}\n"
            "Every entry must be a double-quoted literal with `\\\\b`-style escaping."
        ) from exc

    if not patterns or not all(isinstance(p, str) for p in patterns):
        raise SystemExit("Canonical pattern array must be a non-empty list of strings.")

    for pattern in patterns:
        try:
            re.compile(pattern)
        except re.error as exc:
            raise SystemExit(
                f"Pattern {pattern!r} is not valid Python `re` syntax: {exc}\n"
                "Patterns must stay in the JS/Python portable intersection."
            ) from exc

    return patterns


def render_python_module(patterns: list[str]) -> str:
    body = "".join(f"    {json.dumps(p)},\n" for p in patterns)
    return GENERATED_HEADER + body + GENERATED_FOOTER


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Do not write; exit 1 if the generated module is stale.",
    )
    args = parser.parse_args()

    patterns = parse_canonical_patterns(TS_SOURCE.read_text(encoding="utf-8"))
    expected = render_python_module(patterns)

    if args.check:
        actual = PY_TARGET.read_text(encoding="utf-8") if PY_TARGET.exists() else ""
        if actual != expected:
            print(
                "Commitment-language guardrail has DRIFTED between runtimes.\n"
                f"  canonical : {TS_SOURCE.relative_to(REPO_ROOT)} "
                f"({len(patterns)} patterns)\n"
                f"  generated : {PY_TARGET.relative_to(REPO_ROOT)} (stale)\n\n"
                "Run: python3 scripts/sync_commitment_patterns.py\n"
                "Do NOT hand-edit the generated file — edit the canon and rerun.",
                file=sys.stderr,
            )
            return 1
        print(f"Commitment patterns in sync ({len(patterns)} patterns).")
        return 0

    PY_TARGET.write_text(expected, encoding="utf-8")
    print(
        f"Wrote {PY_TARGET.relative_to(REPO_ROOT)} "
        f"({len(patterns)} patterns from {TS_SOURCE.relative_to(REPO_ROOT)})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
