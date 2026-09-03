#!/usr/bin/env python3
"""ADR 0090 — the CI-side half of the pre-merge audit gate.

Two modes, run as separate workflow steps (.github/workflows/pr-audit-gate.yml):

    --wait-upstream   poll main's required contexts (read fresh from branch
                       protection, or every reported check if that read is
                       denied — see _required_contexts()) until they reach a
                       terminal state (bounded wait); writes
                       `status=upstream_green|upstream_red` to $GITHUB_OUTPUT.
                       This audit is a semantic layer ON TOP of green CI, never
                       a replacement for it — it does not run at all if upstream
                       CI hasn't already passed.

    --audit           fan out 3 Opus angles + 1 mandatory adversarial pass
                       (mirrors .claude/agents/pr-merge-{auditor,adversary}.md,
                       since this path can't use the Agent tool's subagent
                       framework — it's plain Anthropic API calls instead) over
                       the PR diff + check states, write the report, comment on
                       the PR, and on PASS run `gh pr merge --auto --squash`.

NEVER VACUOUS: any failure mode here (missing secret, API error, can't fetch the
diff, ambiguous verdict) must exit non-zero and say why in the PR comment. A
CI job that goes green because it couldn't check is the exact failure this repo's
own absence-reported-as-health finding is about — see check_adr_numbers_unique.py
and the other scripts/check_*.sh guards for the convention this follows.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPORT_DIR = ROOT / ".planning" / "07-reference" / "pr-audits"

# Deliberately NOT hardcoded: this list changed under this exact PR while it was
# in flight (5 contexts -> 3, "Fresh database equals remote" and "Code queries
# only relations production has" dropped per ADR 0092's schema-parity rework). A
# frozen list here would either wait forever on a context that no longer exists
# or silently stop covering a new one. Fetched fresh from branch protection on
# every --wait-upstream call instead — see _required_contexts().
REPO = "aldemirkonuk/RestaurantAIAutomation"

MAX_WAIT_SECONDS = 20 * 60  # bounded — see merge-races-need-sequencing: never poll forever
POLL_INTERVAL_SECONDS = 30

MODEL = "claude-opus-5"
# Corrected 2026-09-02: the original ask was "Sonnet max"; ADR 0050 (locked)
# overrides to Opus for production/ADR/outward-send consequence, all three of
# which this role hits, and says never substitute effort for the model tier
# that calls for.
#
# CONFIRMED live, run 33695630472, first real call with a working API key:
# claude-opus-5 rejects the old thinking.type="enabled"/budget_tokens shape --
# "Use thinking.type.adaptive and output_config.effort to control thinking
# behavior." So "reasoning_effort: high" from the ADR 0090 decision maps onto
# a REAL API parameter after all (output_config.effort), not just a
# best-effort frontmatter signal on the Claude-Code side. Uncaught at the
# time -- the whole call crashed with a raw traceback and posted no PR
# comment, which run_audit()'s try/except (added the same fix) now prevents
# for any future API-shape drift.
EFFORT = "high"
MAX_TOKENS = 12000

ANGLES = {
    "correctness": (
        "Correctness & regression risk. Trace at least one real call path through "
        "the changed code. Consider what a concrete input or a concurrent-session "
        "race (this repo runs dozens of parallel branches) would do to it. Flag "
        "anything green CI would not catch — see this repo's own gateway-boot "
        "incident: clean tsc + 780 passing Jest tests, still crash-looped "
        "production because nothing constructed the real Nest injector."
    ),
    "compliance": (
        "CLAUDE.md / ADR / decision compliance. Read the project's CLAUDE.md "
        "(pasted below). Does this PR assume a default on something that should "
        "be an open decision? Does it touch something a locked ADR already "
        "decided without saying so? Is .planning/ updated alongside the code it "
        "describes where that's called for?"
    ),
    "security": (
        "Security & production blast-radius. What does this reach the moment it "
        "merges — auth, a migration, an actor FK, a tenant boundary, a secret? "
        "This repo has been burned by auth.users/public.users being disjoint "
        "(an FK there 23503s on every write and CI cannot catch it on a fresh "
        "DB) and by OAuth self-provisioning minting managers of a real tenant. "
        "Look for a new instance of one of those shapes, not a generic pass."
    ),
}


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=kw.pop("timeout", 60), **kw)


def _gh_json(cmd: list[str]):
    out = _run(cmd)
    if out.returncode != 0:
        raise RuntimeError(f"gh command failed: {' '.join(cmd)}\n{out.stderr}")
    return json.loads(out.stdout)


def _write_github_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        print(f"{key}={value}")
        return
    with open(path, "a") as f:
        f.write(f"{key}={value}\n")


# --------------------------------------------------------------------------- #
# --wait-upstream
# --------------------------------------------------------------------------- #

def _required_contexts() -> list[str] | None:
    """Best-effort: read main's actual required status contexts, fresh, every
    call — never hardcoded (that list moved from 5 to 3 while this PR was
    open). Returns None, never an empty list, when the read fails; None means
    "fall back to waiting on every reported check", not "nothing required".

    CONFIRMED 2026-09-02, first live run of this workflow: the default Actions
    `GITHUB_TOKEN` gets `403 Resource not accessible by integration` reading
    branch protection. This is not a transient failure to retry — GITHUB_TOKEN
    is deliberately never grantable `administration` scope, protection-reading
    included, regardless of this workflow's own `permissions:` block. So the
    fallback below is the steady state in CI, not an edge case, and the first
    version of this function raising here (making wait_upstream swallow the
    exception into a false `status=upstream_red` and the JOB STILL EXIT 0 —
    absence reported as health, in the guard meant to catch exactly that) shipped
    silently for one full run before this comment existed. Fixed same day.
    """
    out = _run(["gh", "api", f"repos/{REPO}/branches/main/protection",
                "--jq", ".required_status_checks.contexts"])
    if out.returncode != 0:
        print(f"NOTE: could not read branch protection ({out.stderr.strip()}) "
              f"— falling back to waiting for every reported check.", file=sys.stderr)
        return None
    try:
        contexts = json.loads(out.stdout)
    except json.JSONDecodeError as exc:
        print(f"NOTE: branch protection response unparseable ({exc}) — "
              f"falling back to waiting for every reported check.", file=sys.stderr)
        return None
    return contexts or None


# Checks known to be cosmetic/external and never required — confirmed by hand
# against branch protection on 2026-09-02, used only in fallback mode (never
# to filter when the real required-contexts list was actually read).
_FALLBACK_IGNORE_PREFIXES = ("Vercel", "Supabase")

# This workflow's own check name (jobs.audit.name in pr-audit-gate.yml). MUST
# be excluded in fallback mode: confirmed live, run 33693914388 — "waiting for
# every reported check" without this exclusion waits on itself, which is
# IN_PROGRESS by definition until wait_upstream returns, so it can never
# converge and burns the full MAX_WAIT_SECONDS on a guaranteed deadlock every
# single run. Not a race, not a timing fluke — structural, every time.
_SELF_CHECK_NAME = "PR Audit Gate"


def wait_upstream(pr_number: str) -> int:
    required = _required_contexts()  # None => fallback mode, not "nothing required"
    deadline = time.monotonic() + MAX_WAIT_SECONDS
    prev_total = -1
    stable = False

    while True:
        checks = _gh_json(["gh", "pr", "checks", pr_number, "--json", "name,state"])
        by_name = {c["name"]: c["state"] for c in checks}

        if required is not None:
            names = [c for c in required if c != _SELF_CHECK_NAME]
        else:
            names = [n for n in by_name
                     if not n.startswith(_FALLBACK_IGNORE_PREFIXES) and n != _SELF_CHECK_NAME]

        missing = [c for c in names if c not in by_name]
        pending = [c for c in names if by_name.get(c) in ("PENDING", "IN_PROGRESS", "QUEUED")]
        failed = [c for c in names if by_name.get(c) in ("FAILURE", "ERROR", "CANCELLED")]

        if failed:
            print(f"Upstream red: {failed}")
            _write_github_output("status", "upstream_red")
            return 0

        if not missing and not pending and names:
            if required is not None:
                print(f"Upstream green: all {len(names)} required contexts succeeded ({names}).")
                _write_github_output("status", "upstream_green")
                return 0
            # Fallback mode: `gh pr checks` only lists checks GitHub has
            # already scheduled — one that hasn't started yet is invisible,
            # not "missing", so "nothing missing or pending" 20s after the
            # workflow starts is a false green, not a real one. Require the
            # reported check SET to be identical across two consecutive polls
            # before trusting it.
            if len(checks) == prev_total and stable:
                print(f"Upstream green (fallback mode, branch protection unreadable): "
                      f"{len(names)} checks succeeded, stable across 2 polls.")
                _write_github_output("status", "upstream_green")
                return 0
            stable = len(checks) == prev_total
            prev_total = len(checks)
        else:
            stable = False
            prev_total = len(checks)

        if time.monotonic() > deadline:
            print(f"Timed out after {MAX_WAIT_SECONDS}s waiting on: {missing + pending}")
            _write_github_output("status", "upstream_red")
            return 0

        time.sleep(POLL_INTERVAL_SECONDS)


# --------------------------------------------------------------------------- #
# --audit
# --------------------------------------------------------------------------- #

def _call_claude(client, system: str, user: str) -> str:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": EFFORT},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    # With extended thinking, content includes a thinking block before the text
    # block(s) — take the text blocks only.
    return "\n".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


def _verdict_of(report_text: str) -> str:
    """Every prompt instructs the model to END its response with a line
    exactly `VERDICT: <value>`. Anchored per-line and takes the LAST such
    line -- not the first, and not a bare substring search.

    CONFIRMED live by this gate's own audit of PR #261 (security angle,
    2026-09-03): the previous version (`re.search`, unanchored, first
    match) parsed "The three reviewers said VERDICT: APPROVE. I disagree.
    \n\nVERDICT: OVERTURNED" as APPROVE -- a real adversarial OVERTURNED,
    silently reversed into a merge, because a model arguing against a prior
    verdict very naturally quotes that verdict before stating its own. This
    is the identical defect class already fixed once in
    require_pr_audit.py's marker check (bare substring scan over a BLOCK
    report's own prose satisfying "PASS" in line) -- fixed there, missed
    here, because this function decides the merge itself (:overall) while
    that one only gated the hook. Same bug, two call sites; both now fixed.

    Anchoring alone doesn't save the alternation order either: matching
    `APPROVE` before trying `APPROVE WITH NOTES` recorded every "APPROVE
    WITH NOTES" verdict as plain "APPROVE" (regex alternation is first-match,
    not longest-match) -- also confirmed live, also fixed, by listing the
    longer alternative first.
    """
    matches = re.findall(
        r"(?im)^\s*VERDICT:\s*(APPROVE WITH NOTES|APPROVE|BLOCK|HOLDS|OVERTURNED)\s*$",
        report_text,
    )
    return matches[-1].upper() if matches else "UNPARSEABLE"


def run_audit(pr_number: str) -> int:
    """Thin wrapper: _run_audit_inner() does the real work and can raise
    anything (an SDK error, a malformed response, a network blip). CONFIRMED
    live, run 33695630472: an uncaught anthropic.BadRequestError crashed with
    a bare traceback, no PR comment posted -- the exact "never vacuous"
    failure this whole script exists to prevent, just one layer further in
    than the ANTHROPIC_API_KEY check already guarded. Every exception now
    reaches _fail_closed with the real message, so the PR always gets a
    comment explaining why, never silence plus a red X."""
    try:
        return _run_audit_inner(pr_number)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        sha7 = None
        try:
            pr = _gh_json(["gh", "pr", "view", pr_number, "--json", "headRefOid"])
            sha7 = pr["headRefOid"][:7]
        except Exception:
            pass
        return _fail_closed(pr_number, sha7, f"{type(exc).__name__}: {exc}")


def _run_audit_inner(pr_number: str) -> int:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return _fail_closed(pr_number, None,
            "ANTHROPIC_API_KEY is not set. Add it with `gh secret set "
            "ANTHROPIC_API_KEY` (or the GitHub UI) — see ADR 0090.")

    import anthropic  # required install step already ran; let ImportError surface to run_audit()'s catch-all

    client = anthropic.Anthropic(api_key=api_key)

    pr = _gh_json(["gh", "pr", "view", pr_number, "--json", "number,headRefOid,title,url"])
    sha7 = pr["headRefOid"][:7]

    diff = _run(["gh", "pr", "diff", pr_number], timeout=60).stdout
    if not diff.strip():
        return _fail_closed(pr_number, sha7, "gh pr diff returned nothing to review.")

    # SECURITY (confirmed live, run 33695630472, security angle BLOCK on this
    # very PR): this workflow now runs from a checkout PINNED to the base ref
    # (pull_request_target + explicit ref:, see pr-audit-gate.yml) specifically
    # so a PR cannot rewrite the code auditing it. That neutralizes "the PR
    # ships a version of this script that always returns PASS". It does NOT
    # neutralize "a PR that changes what FUTURE audits will do" needing a
    # second, human, pass — so any diff touching the gate's own files is
    # force-BLOCKed below regardless of what the angles/adversary say, however
    # convincing. This check only means anything because it runs from a
    # checkout the diff under review cannot alter.
    _GATE_OWNED_PATHS = (
        "scripts/pr_audit_gate.py",
        "scripts/hooks/require_pr_audit.py",
        ".github/workflows/pr-audit-gate.yml",
        ".claude/agents/pr-merge-auditor.md",
        ".claude/agents/pr-merge-adversary.md",
        ".claude/skills/pr-audit-gate/",
        ".claude/settings.json",
        "CLAUDE.md",  # pasted verbatim into the compliance angle's prompt (see `bundle` below) --
                       # a CLAUDE.md-only PR changes what every FUTURE audit is instructed by
                       # without touching any other owned path. Flagged, not exploited: this run
                       # reads main's copy either way, so the CURRENT audit isn't biased by it --
                       # confirmed by the gate's own second live audit, security angle.
    )
    changed_files_raw = _run(["gh", "pr", "diff", pr_number, "--name-only"], timeout=30).stdout
    changed_files = [f for f in changed_files_raw.splitlines() if f.strip()]
    touches_own_gate = any(
        f == owned or f.startswith(owned) for f in changed_files for owned in _GATE_OWNED_PATHS
    )

    checks = _gh_json(["gh", "pr", "checks", pr_number, "--json", "name,state,link"])
    claude_md = (ROOT / "CLAUDE.md").read_text(errors="replace")

    bundle = (
        f"PR #{pr['number']} — {pr['title']} ({pr['url']})\n"
        f"Head SHA: {pr['headRefOid']}\n\n"
        f"CI check states:\n{json.dumps(checks, indent=2)}\n\n"
        f"CLAUDE.md (for the compliance angle):\n{claude_md}\n\n"
        f"Diff:\n{diff[:60000]}"  # bounded — an oversized diff is itself a finding, not something to truncate silently past
    )
    if len(diff) > 60000:
        bundle += "\n\n[diff truncated at 60000 chars — note this in your report as a limitation, do not silently review a partial diff as if it were complete]"

    angle_reports: dict[str, str] = {}
    angle_verdicts: dict[str, str] = {}
    for angle, focus in ANGLES.items():
        system = (
            "You are one of three independent reviewers of a PR that, if all three "
            "of you and a following adversarial pass approve, merges to production "
            "with no human looking at it in the moment (ADR 0090). Review ONLY your "
            "focus angle. End your response with a line exactly "
            "`VERDICT: APPROVE` or `VERDICT: APPROVE WITH NOTES` or `VERDICT: BLOCK`, "
            "and if BLOCK, a `file:line` citation plus a one-sentence failure "
            "scenario — a concrete input/state and what goes wrong."
        )
        text = _call_claude(client, system, f"FOCUS ANGLE: {focus}\n\n{bundle}")
        angle_reports[angle] = text
        angle_verdicts[angle] = _verdict_of(text)

    blocked = [a for a, v in angle_verdicts.items() if v == "BLOCK" or v == "UNPARSEABLE"]
    adversary_report = None
    if blocked:
        overall = "BLOCK"
    else:
        system = (
            "Three reviewers leaned APPROVE on this PR. Your only job is to try to "
            "overturn that — construct the strongest case it should NOT merge, "
            "then say honestly whether that case holds up (ADR 0090). End with "
            "`VERDICT: HOLDS` or `VERDICT: OVERTURNED` plus, if OVERTURNED, a "
            "`file:line` citation and a concrete failure scenario the three "
            "reviewers missed."
        )
        joined = "\n\n---\n\n".join(f"[{a}]\n{t}" for a, t in angle_reports.items())
        adversary_report = _call_claude(client, system, f"{joined}\n\n---\n\nOriginal bundle:\n{bundle}")
        adv_verdict = _verdict_of(adversary_report)
        overall = "BLOCK" if adv_verdict in ("OVERTURNED", "UNPARSEABLE") else "PASS"

    escalation_note = ""
    if touches_own_gate and overall == "PASS":
        overall = "BLOCK"
        escalation_note = (
            "\n\n**⚠️ ESCALATED, not a normal BLOCK:** this diff touches the "
            "audit gate's own files (" + ", ".join(sorted({
                f for f in changed_files
                for owned in _GATE_OWNED_PATHS if f == owned or f.startswith(owned)
            })) + "). All three angles and the adversarial pass leaned APPROVE, "
            "but a PR that changes what future audits do needs a human, not a "
            "self-consistent verdict from the current rules — [[merge-races-need-sequencing]]'s "
            "escalate-never-force precedent, applied here. Founder review required "
            "regardless of the angle verdicts above."
        )
    elif touches_own_gate:
        escalation_note = (
            "\n\n**Note:** this diff also touches the audit gate's own files — "
            "already BLOCK on the angles above, escalation is moot but stated "
            "for the record."
        )

    lines = [
        f"# PR #{pr_number} audit — {sha7}",
        "",
        f"**VERDICT: {overall}**",
        "",
        "## Angles",
    ]
    for angle, text in angle_reports.items():
        lines += [f"### {angle} — {angle_verdicts[angle]}", "", text, ""]
    if adversary_report is not None:
        lines += ["## Adversarial pass", "", adversary_report, ""]
    full_report = "\n".join(lines)

    # The CI runner's filesystem is thrown away when the job ends -- a path
    # under REPORT_DIR here would never exist for anyone reading the comment
    # later (confirmed: the first live run wrote it, then it vanished with the
    # runner). Nothing here commits it back to the branch, so the PR comment
    # IS the durable record; the full report goes in the comment body, not a
    # path pointer to a file nobody can ever fetch again. The Claude-Code-side
    # skill is the one path that can commit REPORT_DIR for real, since a
    # session's own worktree survives past the tool call that wrote it.
    # Machine-readable marker required by scripts/hooks/require_pr_audit.py's
    # v2 verdict check (bug 3, run 33695630472): a bare substring scan over
    # prose let a BLOCK report's own words ("...all PASS") satisfy "PASS" in
    # line. This is the ONLY thing either enforcement path is allowed to
    # parse for a verdict — never re-grep the prose below it.
    marker = f"<!-- pr-audit-gate: pr={pr_number} sha={sha7} verdict={overall} -->"
    comment_body = (
        f"{marker}\n"
        f"## PR Audit Gate — {overall}\n\n"
        + "\n".join(f"- **{a}**: {v}" for a, v in angle_verdicts.items())
        + (f"\n- **adversarial pass**: {_verdict_of(adversary_report)}" if adversary_report else "")
        + escalation_note
        + "\n\n<details><summary>Full report</summary>\n\n"
        + full_report[:60000]
        + ("\n\n[truncated at 60000 chars]" if len(full_report) > 60000 else "")
        + "\n\n</details>\n"
    )
    _run(["gh", "pr", "comment", pr_number, "--body", comment_body])

    if overall != "PASS":
        print(f"Verdict: {overall} — not merging.")
        return 1

    merge = _run(["gh", "pr", "merge", pr_number, "--auto", "--squash"], timeout=30)
    if merge.returncode != 0:
        print(f"gh pr merge --auto failed:\n{merge.stderr}", file=sys.stderr)
        return 1
    print("PASS — auto-merge queued (waits on the pre-existing required contexts).")
    return 0


def _fail_closed(pr_number: str, sha7: str | None, reason: str) -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{pr_number}-{sha7 or 'unknown'}.md"
    (REPORT_DIR / name).write_text(
        f"# PR #{pr_number} audit\n\n**VERDICT: COULD NOT RUN**\n\n{reason}\n"
    )
    body = f"## PR Audit Gate — COULD NOT RUN\n\n{reason}\n\nNot merging — see ADR 0090."
    _run(["gh", "pr", "comment", pr_number, "--body", body])
    print(f"CANNOT CHECK: {reason}", file=sys.stderr)
    return 1


def main() -> int:
    pr_number = os.environ.get("PR_NUMBER")
    if not pr_number:
        print("PR_NUMBER env var required", file=sys.stderr)
        return 2
    if "--wait-upstream" in sys.argv:
        return wait_upstream(pr_number)
    if "--audit" in sys.argv:
        return run_audit(pr_number)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
