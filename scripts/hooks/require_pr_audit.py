#!/usr/bin/env python3
"""PreToolUse hook — ADR 0090. Blocks any Bash call shaped like `gh pr merge` or a
direct push to `main` unless the pr-audit-gate skill has already written a PASS
report for the PR's *current* head SHA. This is the "you call it, make it a
constraint" half of ADR 0090: inside a Claude Code session, this tool cannot merge
without the audit having run for the exact commit being merged.

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
REPORT_DIR = ROOT / ".planning" / "07-reference" / "pr-audits"

# Loose on purpose: this is a speed bump for THIS session, not the hard
# enforcement (that's the CI required check in ADR 0090, once the founder wires
# it). A determined bypass via a differently-worded command can still slip past
# a regex — documented as a known limitation, not silently assumed complete.
MERGE_PATTERN = re.compile(r"\bgh\s+pr\s+merge\b")
DIRECT_PUSH_PATTERN = re.compile(r"\bgit\s+push\b.*\bmain\b")


def _allow(note: str = "") -> None:
    if note:
        print(note)
    sys.exit(0)


def _block(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(2)


def _run(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def _current_pr_and_sha() -> tuple[str, str] | None:
    """Best-effort: resolve the PR number and head SHA for the current branch."""
    raw = _run(["gh", "pr", "view", "--json", "number,headRefOid"])
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return str(data["number"]), str(data["headRefOid"])[:7]
    except (json.JSONDecodeError, KeyError):
        return None


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
    is_merge = bool(MERGE_PATTERN.search(command))
    is_direct_push = bool(DIRECT_PUSH_PATTERN.search(command))
    if not (is_merge or is_direct_push):
        return 0

    if is_direct_push:
        _block(
            "BLOCKED by ADR 0090: direct pushes to main are not audited. Open a "
            "PR and let the pr-audit-gate skill (and its own gh pr merge --auto) "
            "carry it, so main's branch protection and the audit both actually "
            "run against it."
        )

    resolved = _current_pr_and_sha()
    if resolved is None:
        _block(
            "CANNOT CHECK (ADR 0090): could not resolve a PR + head SHA for the "
            "current branch via `gh pr view`. A guard that cannot verify must not "
            "allow the merge it exists to gate — run `gh pr view` yourself, "
            "confirm a PR exists, and run the pr-audit-gate skill before retrying."
        )
    pr_number, sha7 = resolved

    report = REPORT_DIR / f"{pr_number}-{sha7}.md"
    if not report.exists():
        _block(
            f"BLOCKED by ADR 0090: no audit report at {report.relative_to(ROOT)} "
            f"for PR #{pr_number} at {sha7}. Run the pr-audit-gate skill for this "
            "PR first — it writes this report and then merges itself on PASS. "
            "Do not call gh pr merge directly."
        )

    verdict_line = report.read_text(errors="replace").splitlines()[:20]
    if not any("PASS" in line and "BLOCK" not in line for line in verdict_line):
        _block(
            f"BLOCKED by ADR 0090: {report.relative_to(ROOT)} exists for "
            f"PR #{pr_number} at {sha7} but does not read as PASS in its first 20 "
            "lines. Re-run the pr-audit-gate skill rather than merging a "
            "BLOCK-verdict PR by hand."
        )

    _allow(f"require_pr_audit: PASS report found for PR #{pr_number} at {sha7}, allowing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
