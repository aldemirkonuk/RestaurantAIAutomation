#!/usr/bin/env python3
"""PreToolUse hook — ADR 0090. Blocks any Bash call shaped like `gh pr merge` or a
direct push to `main` unless the pr-audit-gate skill (or the CI workflow) has
already posted a PASS verdict comment for the PR's *current* head SHA. This is
the "you call it, make it a constraint" half of ADR 0090.

Three real audits, same day (2026-09-03), each closing what it targeted and
missing a sibling — v2 fixed v1's three bugs, v3 (this version) fixes two
more v2 introduced/missed, found by the third audit's correctness AND
security angles independently:

v1 → v2:
1. v1 resolved the PR via `gh pr view` on the *current checkout's branch*,
   ignoring the PR number in the command actually being gated. In a repo with
   ~90 concurrent worktrees, a session on branch A (with its own PASS report)
   running `gh pr merge <B>` would have that validated against A's report and
   merge B unaudited. v2 parses the number out of the command instead.
2. v1 checked for a *committed local file*. The skill's own instructions had
   it commit that file, on the PR branch, immediately before the gated merge
   call — which changes the head SHA the file is keyed to, so the file the
   hook looks for (at the NEW sha) never exists. A structural livelock. v2
   checks PR **comments** instead (`gh pr view --json comments`), which the
   report-posting step already writes and which carry no such side effect.
3. v1's verdict check was `"PASS" in line and "BLOCK" not in line` over the
   first 20 lines of the file — a bare substring scan a BLOCK report's own
   prose (e.g. "Upstream required contexts: all PASS") could satisfy. v2
   introduced a machine-readable marker line (MARKER_RE) instead.

v2 → v3:
4. **CONFIRMED by actual execution** (security angle, shimmed `gh` returning
   a comment authored by an unrelated GitHub account): v2's marker check
   trusted ANY comment's body, on a PUBLIC repo. An outsider reads the head
   SHA off the PR page and posts `<!-- pr-audit-gate: pr=N sha=X
   verdict=PASS -->` as a plain comment — exit 0, merge allowed. Now checks
   `author.login` against a small trusted set (the CI bot, and whichever
   account is running `gh` right now) before trusting anything in the body.
5. Even restricted to trusted authors, v2's `MARKER_RE.finditer(body)`
   scanned the *whole* comment — including the full report embedded in the
   SAME comment by design, which (especially for a PR *about this gate*)
   can legitimately discuss or quote marker syntax with real-looking values
   in its own prose. Now `MARKER_RE.match()` on the body's own leading edge
   only — a marker anywhere but position zero doesn't count, however
   trusted the author.

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
# Captures the whole argument tail after "merge" so _extract_pr_number() can
# find the number regardless of flag order (`gh pr merge --squash 42`,
# `gh pr merge 42 --squash`, a /pull/42 URL) — v2 only captured a number
# immediately after "merge" and missed all of those, confirmed live
# (correctness angle, third audit).
MERGE_PATTERN = re.compile(r"\bgh\s+pr\s+merge\b(?P<tail>[^|;&\n]*)")
# Anchored to an actual git ref target, not "the word main anywhere in the
# command" (v1 false-positived on `feat/maintenance-x`), and NOT anchored to
# end-of-command either (v2's `\s*$` meant `git push origin main --force` —
# the single most consequential form — evaded it entirely; confirmed live,
# correctness angle, third audit). `(?:\s|$)` requires a real word boundary
# after "main" without requiring nothing else follows.
# v3 -> v4, two more real bugs, both CONFIRMED BY EXECUTION (fourth audit,
# security angle): (a) `[^|;&]*` does not exclude newlines, so it spanned
# across separate statements in a multi-line command -- `git push origin
# feat/x\ngh pr create --base main --fill` (a normal branch push followed
# by opening the PR) matched and was wrongly BLOCKED, because "main" showed
# up on the SECOND line. Added `\n` to the exclusion set. (b) `\bgit\s+push\b`
# requires "push" immediately after "git", so `git -C <dir> push origin
# main` -- the natural form in a multi-worktree repo -- was NOT matched at
# all: a real push straight to main slipped through. Added an optional
# `-C <path>` between "git" and "push"; other global git flags before a
# subcommand are a known residual gap (documented, not silently assumed
# complete, per the note above).
# v4 -> v5, CONFIRMED BY EXECUTION (fifth audit, correctness angle): adding
# `\n` to the exclusion set fixed the multi-STATEMENT case but broke the
# multi-LINE-same-statement case -- `git push \` + newline + `  origin main`
# (an ordinary backslash line continuation) stopped matching entirely, since
# the continuation's own newline now terminates the scan. Fixed by
# normalizing backslash-newline continuations to a single space BEFORE
# matching (see _normalize_command) rather than trying to encode "this
# newline doesn't end the statement" into the pattern itself. Also widened
# the trailing boundary from `(?:\s|$)` to also accept `;` and a closing
# quote -- `git push origin main;` and `git push origin 'main'` previously
# fell through since neither whitespace nor end-of-string followed "main".
DIRECT_PUSH_PATTERN = re.compile(
    r"\bgit\s+(?:-C\s+\S+\s+)?push\b[^|;&\n]*\b(?:origin\s+)?(?:HEAD:)?"
    r"(?:refs/heads/)?['\"]?main['\"]?(?:[\s;]|$)"
)


def _normalize_command(command: str) -> str:
    """Collapse a backslash-newline shell line continuation into a single
    space, so a command split across lines for readability is still scanned
    as one logical command. Deliberately leaves bare newlines (no preceding
    backslash) alone -- those really do separate independent statements,
    which DIRECT_PUSH_PATTERN's `\\n` exclusion still correctly treats as a
    boundary."""
    return re.sub(r"\\[ \t]*\n[ \t]*", " ", command)

# Both this hook and scripts/pr_audit_gate.py (CI) must emit exactly this shape
# in the PR comment they post: an HTML comment, invisible when rendered, that
# names the PR, the exact head SHA it was computed against, and the verdict.
# Never parse prose for "PASS"/"BLOCK" — see bug 3 in the module docstring.
# Matched with .match() at a comment's own start, never .search()/.finditer()
# over the whole body — see bug 5.
MARKER_RE = re.compile(
    r"<!--\s*pr-audit-gate:\s*pr=(?P<pr>\d+)\s+sha=(?P<sha>[0-9a-f]{7,40})\s+"
    r"verdict=(?P<verdict>PASS|BLOCK)\s*-->"
)

# See bug 4. The CI bot's comments are always trusted; whoever is running
# `gh` right now (fetched lazily, once) is trusted too, since if THIS
# session posted the marker, it's legitimately theirs regardless of who else
# has access. Nobody else's comment body is ever inspected for a marker.
#
# Both spellings, CONFIRMED BY EXECUTION (fourth audit, security angle) to
# matter: `gh pr view --json comments` (GraphQL-backed, what this hook
# calls) returns the bot's login as "github-actions" -- no "[bot]" suffix --
# while the REST API returns "github-actions[bot]". This hook only had the
# REST spelling, so it silently trusted NO comment the CI bot ever posted;
# fail-closed (safe), but functionally broke the CI half of the whole gate.
# The bare name isn't registered as a real account today (`gh api
# users/github-actions` -> 404) but that isn't a permanent guarantee from
# GitHub, so this is stated as a residual, not treated as closed -- position
# anchoring (marker must be the comment's own first thing) and the PR+SHA
# match both still apply on top of this, which is the actual containment.
_TRUSTED_MARKER_AUTHORS = {"github-actions[bot]", "github-actions"}


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


def _extract_pr_number(tail: str) -> str | None:
    """Find the PR number in a `gh pr merge <tail>` command's argument tail.
    Handles a plain number, a `#`-prefixed number, either in any position
    relative to flags, and a /pull/<n> URL. Deliberately does NOT try to
    resolve a branch-name argument (`gh pr merge my-branch`, a real gh form)
    to a number — that needs an actual `gh pr view <branch>` call, which
    the current-branch fallback doesn't attempt either; returns None and lets
    the caller fall through to CANNOT CHECK rather than guessing."""
    m = re.search(r"/pull/(\d+)", tail)
    if m:
        return m.group(1)
    for tok in tail.split():
        if tok.startswith("-"):
            continue  # a flag (--squash, --auto, ...), not a positional argument
        t = tok.lstrip("#")
        if t.isdigit():
            return t
    return None


def _current_branch_pr() -> str | None:
    """Fallback for a bare `gh pr merge` (no argument) or one whose argument
    _extract_pr_number couldn't resolve to a number (a branch name) — both
    really do target whatever PR belongs to the current branch, which is the
    correct resolution for the first case and the best available one for
    the second."""
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


def _current_gh_user() -> str | None:
    return _run(["gh", "api", "user", "-q", ".login"])


def _passing_marker_exists(pr_number: str, sha: str) -> bool:
    """True iff some TRUSTED-author PR comment STARTS WITH the marker for
    this exact PR + sha with verdict=PASS. Checks ALL comments (not just the
    latest) since the CI path and this skill can both post one, in either
    order. Author-trust and position-anchoring are both load-bearing — see
    bugs 4 and 5 in the module docstring; either alone was confirmed
    bypassable."""
    raw = _run(["gh", "pr", "view", pr_number, "--json", "comments"])
    if raw is None:
        return False  # caller must treat None-vs-False distinctly if needed
    try:
        comments = json.loads(raw).get("comments", [])
    except json.JSONDecodeError:
        return False

    trusted = set(_TRUSTED_MARKER_AUTHORS)
    me = _current_gh_user()
    if me:
        trusted.add(me)

    for c in comments:
        author = (c.get("author") or {}).get("login", "")
        if author not in trusted:
            continue
        m = MARKER_RE.match(c.get("body", "").strip())
        if m and m.group("pr") == pr_number and sha.startswith(m.group("sha")) \
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

    command = _normalize_command(str(payload.get("tool_input", {}).get("command", "")))
    merge_match = MERGE_PATTERN.search(command)
    is_direct_push = bool(DIRECT_PUSH_PATTERN.search(command))
    if not (merge_match or is_direct_push):
        return 0

    if is_direct_push:
        _block(
            "BLOCKED by ADR 0090: direct pushes to main are not audited. Open a "
            "PR and let the pr-audit-gate skill carry it, so main's branch "
            "protection and the audit both actually run against it."
        )

    pr_number = _extract_pr_number(merge_match.group("tail")) or _current_branch_pr()
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
