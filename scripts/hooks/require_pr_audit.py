#!/usr/bin/env python3
"""PreToolUse hook — ADR 0090. Blocks any Bash call shaped like `gh pr merge` or a
direct push to `main` unless the pr-audit-gate skill (or the CI workflow) has
already posted a PASS verdict comment for the PR's *current* head SHA. This is
the "you call it, make it a constraint" half of ADR 0090.

v2 (2026-09-03) — rewritten after the gate's own first real audit (PR #261,
run 33695630472) found 3 correctness bugs in v1, all fixed here:

1. v1 resolved the PR via `gh pr view` on the *current checkout's branch*,
   ignoring the PR number in the command actually being gated. In a repo with
   ~90 concurrent worktrees, a session on branch A (with its own PASS report)
   running `gh pr merge <B>` would have that validated against A's report and
   merge B unaudited. Now parses the number out of the command itself; only
   falls back to the current-branch resolver for a bare `gh pr merge` (no
   PR argument), which really does target the current branch's PR.
2. v1 checked for a *committed local file*. The skill's own instructions had
   it commit that file, on the PR branch, immediately before the gated merge
   call — which changes the head SHA the file is keyed to, so the file the
   hook looks for (at the NEW sha) never exists. A structural livelock. Now
   checks PR **comments** instead (`gh pr view --json comments`), which the
   report-posting step already writes and which carry no such SHA-changing
   side effect.
3. v1's verdict check was `"PASS" in line and "BLOCK" not in line` over the
   first 20 lines of the file — a bare substring scan a BLOCK report's own
   prose (e.g. "Upstream required contexts: all PASS") could satisfy. Now
   requires an exact machine-readable marker line (see MARKER_RE) that both
   the CI script and this skill's own instructions are required to emit
   verbatim; anything else does not count as a verdict.

Contract (Claude Code PreToolUse hooks): JSON on stdin with at least
`tool_name`/`tool_input`; exit 0 = allow, exit 2 = block (stderr is fed back to
Claude as the reason), any other non-zero = non-blocking error shown to the user.
A guard that cannot check must never exit 0 — see the NEVER VACUOUS convention
this repo's other guards (scripts/check_*.sh, scripts/check_adr_numbers_unique.py)
already follow: absence of evidence is a FAILURE (exit 2), not a pass.

Usage: invoked by Claude Code itself, not by hand. To exercise it manually:
    echo '{"tool_name": "Bash", "tool_input": {"command": "gh pr merge 42"}}' \
        | python3 scripts/hooks/require_pr_audit.py
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

# Loose on purpose: this is a speed bump for THIS session, not the hard
# enforcement (that's the CI required check in ADR 0090, once the founder wires
# it). A determined bypass via a differently-worded command can still slip past
# a regex — documented as a known limitation, not silently assumed complete.
# Captures an explicit PR number when the command names one (`gh pr merge 42`,
# `gh pr merge #42`) — a bare `gh pr merge` with no number is also matched,
# group(1) is then None and callers resolve via the current branch instead.
MERGE_PATTERN = re.compile(r"\bgh\s+pr\s+merge\b(?:\s+#?(\d+))?")
# Anchored to an actual git ref target, not "the word main anywhere in the
# command" — v1 false-positived on `feat/maintenance-x` or a comment body
# that happened to mention "main". Still a speed bump, not the hard gate.
DIRECT_PUSH_PATTERN = re.compile(
    r"\bgit\s+push\b[^|;&]*\b(?:origin\s+)?(?:HEAD:)?(?:refs/heads/)?main\b\s*$"
)

# Both this hook and scripts/pr_audit_gate.py (CI) must emit exactly this shape
# in the PR comment they post: an HTML comment, invisible when rendered, that
# names the PR, the exact head SHA it was computed against, and the verdict.
# Never parse prose for "PASS"/"BLOCK" — see bug 3 in the module docstring.
MARKER_RE = re.compile(
    r"<!--\s*pr-audit-gate:\s*pr=(?P<pr>\d+)\s+sha=(?P<sha>[0-9a-f]{7,40})\s+"
    r"verdict=(?P<verdict>PASS|BLOCK)\s*-->"
)


def _allow(note: str = "") -> None:
    if note:
        print(note)
    sys.exit(0)


def _block(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(2)


def _run(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def _current_branch_pr() -> str | None:
    """Fallback ONLY for a bare `gh pr merge` with no explicit number, which
    really does target whatever PR belongs to the current branch."""
    raw = _run(["gh", "pr", "view", "--json", "number"])
    if not raw:
        return None
    try:
        return str(json.loads(raw)["number"])
    except (json.JSONDecodeError, KeyError):
        return None


def _head_sha(pr_number: str) -> str | None:
    raw = _run(["gh", "pr", "view", pr_number, "--json", "headRefOid"])
    if not raw:
        return None
    try:
        return str(json.loads(raw)["headRefOid"])
    except (json.JSONDecodeError, KeyError):
        return None


def _passing_marker_exists(pr_number: str, sha: str) -> bool:
    """True iff some PR comment carries the marker for this exact PR + sha
    with verdict=PASS. Checks ALL comments (not just the latest) since the
    CI path and this skill can both post one, in either order."""
    raw = _run(["gh", "pr", "view", pr_number, "--json", "comments"])
    if raw is None:
        return False  # caller must treat None-vs-False distinctly if needed
    try:
        comments = json.loads(raw).get("comments", [])
    except json.JSONDecodeError:
        return False
    for c in comments:
        for m in MARKER_RE.finditer(c.get("body", "")):
            if m.group("pr") == pr_number and sha.startswith(m.group("sha")) \
                    and m.group("verdict") == "PASS":
                return True
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Cannot parse the hook payload at all. Fail open here specifically —
        # this hook only ever *adds* a constraint on top of everything else; a
        # malformed payload from the harness itself is not evidence this PR was
        # audited, but blocking every single Bash call on a parse failure would
        # make the hook itself the outage. Log loudly instead.
        print("require_pr_audit: could not parse hook payload, allowing "
              "(this hook only restricts merge commands, nothing else)",
              file=sys.stderr)
        return 0

    if payload.get("tool_name") != "Bash":
        return 0

    command = str(payload.get("tool_input", {}).get("command", ""))
    merge_match = MERGE_PATTERN.search(command)
    is_direct_push = bool(DIRECT_PUSH_PATTERN.search(command))
    if not (merge_match or is_direct_push):
        return 0

    if is_direct_push:
        _block(
            "BLOCKED by ADR 0090: direct pushes to main are not audited. Open a "
            "PR and let the pr-audit-gate skill (and its own gh pr merge --auto) "
            "carry it, so main's branch protection and the audit both actually "
            "run against it."
        )

    pr_number = merge_match.group(1) or _current_branch_pr()
    if pr_number is None:
        _block(
            "CANNOT CHECK (ADR 0090): `gh pr merge` was called with no PR number "
            "and no PR could be resolved for the current branch. A guard that "
            "cannot verify must not allow the merge it exists to gate."
        )

    sha = _head_sha(pr_number)
    if sha is None:
        _block(
            f"CANNOT CHECK (ADR 0090): could not read PR #{pr_number}'s head SHA "
            "via `gh pr view`. A guard that cannot verify must not allow the "
            "merge it exists to gate."
        )

    if not _passing_marker_exists(pr_number, sha):
        _block(
            f"BLOCKED by ADR 0090: no PASS verdict found for PR #{pr_number} at "
            f"{sha[:7]}. Looked for a `<!-- pr-audit-gate: pr={pr_number} "
            f"sha={sha[:7]}... verdict=PASS -->` marker across this PR's "
            "comments — none matched (missing, stale for an older commit, or "
            "BLOCK). Run the pr-audit-gate skill for PR "
            f"#{pr_number} first; do not call gh pr merge directly."
        )

    _allow(f"require_pr_audit: PASS verdict found for PR #{pr_number} at {sha[:7]}, allowing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
