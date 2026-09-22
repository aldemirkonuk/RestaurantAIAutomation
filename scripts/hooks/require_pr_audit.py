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

2026-09-18 (ADR 0090 amendment, founder answer 3, "Yes, hard block"):
6. `gh pr merge` must carry `--match-head-commit <full 40-hex sha>` equal to
   the PR's current head, so the merge binds to the commit that was audited
   and checked, not whatever head appears before GitHub acts.
7. A PR that changes what the gate owns is BLOCKED even with a PASS marker.
   Ownership is decided by ORIGIN/MAIN's copy of scripts/pr_audit_gate.py,
   run as `python3 -I <tmp copy> --ownership` -- never the checkout's copy,
   which on a PR branch is the code under review. The founder's route for an
   owned PR is his word in chat, then the SHA-pinned
   `gh api .../pulls/<n>/merge` recorded in ADR 0090's review trail (#261,
   #297, #299); this hook does not match that call on purpose.
   Anything the check cannot run (fetch failure, an origin/main copy that
   predates `--ownership`, a timeout) is CANNOT CHECK and blocks.

2026-09-18, fixer round (each measured against the hook above, exit 0 before):
8. EVERY `pr merge` in the command is checked, not only the first:
   `<clean merge> && <owned merge>` ran the second unchecked. The command is
   tokenized as the shell quotes it, so `"gh" pr merge`, `g\\h pr merge` and
   `$G pr merge` are seen; a `pr merge` that cannot be placed as a command of
   its own (inside `bash -c "..."`, `eval`, a comment) blocks.
9. The PR must be a literal number or a pull-request URL of this repository.
   `$n`, `$(...)`, a branch name and a bare `gh pr merge` block; there is no
   current-branch fallback any more.
10. `--match-head-commit` must appear exactly once, as its own argument: a pin
   inside `--body "..."` or a second pin (gh keeps the last) blocks.
11. MCP tools that merge a PR or arm auto-merge (mcp__ccd_pr__set_auto_merge)
   are blocked outright: they carry no pin and no ownership check.
   .claude/settings.json matches them (`Bash|mcp__.*[Mm]erge.*`).

2026-09-18, confirm round (12-16 each exit 0 on the hook above; 17 is
fail-closed hardening, tested with an injected crash):
12. A `pr` subcommand written with quoting or expansion ($'merge', $"merge",
   mer$()ge, mer${ZZ}ge, {merge,}, mer[g]e) is `merge` to the shell and no
   probe counted it. It now blocks, as do a quoted or expanded word after a
   literal gh (`gh p$()r merge`) and a `pr` after a word the shell expands
   (`$G pr merge`, a glob such as `/usr/local/bin/g? pr merge`, which no probe
   counted either); see unplain_gh_word().
13. --admin and --auto block: the skill forbids both.
14. A command holding more than one `gh pr merge` blocks. One check can take
   380 s by its own timeouts and the hook is given 600 s.
15. `gh alias set` and `gh alias import` block: an alias runs a merge under a
   name no probe reads (`gh alias set m 'pr merge' && gh m 2`).
16. A line continuation is removed as the shell removes it, with no space put
   in its place: `gh pr mer\\<newline>ge 2` is `gh pr merge 2` and is checked,
   and `git push origin mai\\<newline>n` is a push to main (see
   _normalize_command).
17. An exception inside unplain_gh_word() blocks as CANNOT CHECK. Uncaught,
   it would exit 1, which Claude Code treats as a non-blocking error, so the
   command would run unchecked (no input is known to raise; 200,000 fuzzed
   commands raised none).
2026-09-19, gate-r3 adversarial round (each CONFIRMED by execution against a
throwaway harness, never against this repo's real gh/GitHub; a name in
parentheses is the finding's own id for cross-reference):
18. A symlink or PATH-relative rename of `gh`/`git` (`octocli -> $(which
    gh)`), invoked as the new name, by its full path, or wrapped in `nohup`,
    was invisible to every check here -- each recognised the program only by
    the literal word or a path ending in `/gh`/`/git`. `_is_program()` adds an
    identity fallback (PATH lookup + realpath, same as the shell's own
    resolution) that unplain_gh_word(), merge_invocations() and the new push
    check below all use (shell-renamed-gh-direct-merge,
    shell-renamed-gh-alias-plant, shell-renamed-git-direct-push). Residual,
    not closed: an INDEPENDENTLY BUILT OR COPIED binary, different inode, same
    behaviour -- a lexical hook cannot execute a candidate to compare
    behaviour against the real one; ADR 0090 names this rather than claiming
    it closed.
19. `merge_invocations()`'s own probe required the literal word "gh" (or
    `$.../)/`` ) before "pr ... merge", so it returned before the tokenizer --
    which does not care what the program is named -- ever ran; a renamed `gh`
    doing `octocli pr merge N` was `([], None)` every time. Now also
    tokenizes on a bare "pr ... merge" adjacency and lets the tokenizer's own
    per-segment `_is_program` check (18) decide, rather than deciding from
    the raw text alone.
20. `DIRECT_PUSH_PATTERN` requires the literal substring "main"; `git push`,
    `git push origin` (no refspec) and `--mirror`/`--all` carry none, and the
    real destination then depends on local config (push.default, branch
    tracking, remote.pushDefault) this hook never reads -- on a repo with ~90
    worktrees, routinely main (path-push-bare-and-broad). It also tolerates
    exactly one hardcoded `-C <path>` between "git" and "push";
    `--no-pager`, `-c x=y` or `git subtree push` are not "push" immediately
    after "git" (path-push-token-between-git-and-push). `_direct_push_problem()`
    is a second, additive check (DIRECT_PUSH_PATTERN itself, and its own
    pinned history in scripts/pr_audit_gate.py's self-test, are untouched):
    it tokenizes, walks past any number of recognized git global flags, and
    treats a push with fewer than two literal positional arguments (no
    remote, or a remote with no refspec) as needing to block, same as
    `--mirror`/`--all` or an explicit `main` target.
21. A `git config alias.<name>` collapses an entire push into one word
    carrying neither "push" nor "main" (path-git-level-alias). `_push_reason()`
    resolves an unrecognized git subcommand word via `git config --get
    alias.<name>` (skipped for a short allowlist of common subcommands, so an
    ordinary `git status`/`git commit`/etc. never pays for the extra call)
    and treats a definition containing "push" as one, CANNOT-CHECKED rather
    than parsed further. Not attempted: an alias whose *value* is itself
    built from a separately-set variable or file across two commands, neither
    of which contains "push" and "main" together in its own text -- this
    hook reasons about one command at a time, by design.
22. A REST PUT/PATCH to `.../pulls/<n>/merge`, a `gh api graphql` mutation
    naming `mergePullRequest` or `enablePullRequestAutoMerge` (no bounded
    `\bpr\b` word for the merge probe -- "pullRequestId" has none, even
    though `gh` itself is running it), or a POST to the base repo's own
    `/merges` endpoint (no PR number exists at all) each merge through
    GitHub's API directly, in any client (curl, wget, a Python/Node script,
    or `gh api`) -- none of it shaped like `gh pr merge` (path-http-api-clients,
    path-graphql-merge-mutations, path-merges-endpoint-no-pr).
    `_github_api_merge_reason()` blocks all three outright, like an MCP tool
    that arms auto-merge: none carries a pin, a marker or an ownership check
    to bind to.
23. A generic exec-capable tool (a terminal runner, a sandbox, a batched
    computer-use call) is not named "merge" and so was never checked at all
    for anything BUT its own name -- CONFIRMED exit 0 for six real tool names,
    each carrying a complete `gh pr merge` command in its input untouched
    (path-exec-surface-outside-matcher). `.claude/settings.json`'s matcher is
    widened (terminal/sandbox/exec/shell/computer/simulator/directory, beside
    the existing merge pattern) and main()'s non-Bash branch now scans
    tool_input's own text the same way a Bash command's is scanned. Residual,
    stated plainly: a wholly novel, unlisted tool name is still not routed
    here at all; a name-pattern matcher can never be complete against a tool
    that does not exist yet, which is why ADR 0090 also names the GitHub-side
    backstop (a required check tied to the real merge event) as the durable
    fix, not another string pattern.
24. `_mcp_merge_tool()`'s word-splitter needed a case TRANSITION to separate
    words, so an all-lowercase joined name ("mergepr", "automergepr") was one
    token matching neither "merge" nor a companion word
    (path-mcp-lowercase-collapse). Now also checked as a lowercased
    substring. Not closed, and recorded as a residual rather than attempted:
    a bare "merge" with no companion word at all ("merge_now") -- treating
    "merge" alone as enough would also block a real, unrelated tool this
    session can call (path-mcp-bare-merge-word).
25. `_passing_marker_exists()` accepted the marker's sha as a PREFIX match,
    so a 7-character marker (SKILL.md's own documented format) validated ANY
    commit sharing that prefix, not only the one it was minted for --
    demonstrated with two genuine git commits, mined 7 hex chars apart, one
    benign and one carrying a backdoor (sha-prefix-collision). It also
    returned True on the first matching trusted PASS without checking for a
    trusted BLOCK on the identical pr+sha, so a non-deterministic re-audit
    only had to roll PASS once, ever, ahead of or behind an existing BLOCK
    for the same commit (verdict-any-match-wins). Now requires the FULL
    40-hex sha by `==`, and a trusted BLOCK vetoes a coexisting trusted PASS
    outright, order-independent. Not closed, and left as an explicit open
    decision rather than papered over: `_current_gh_user()` is unconditionally
    trusted, so a session authenticated as the founder's own `gh` identity can
    post its own PASS comment and merge with the audit itself never invoked
    (self-forged-pass-marker) -- see OPEN-DECISIONS.md ([OD-128](../../.planning/decisions/OPEN-DECISIONS.md))
    and ADR 0090's residual list; this is a trust-model question the hook
    cannot resolve by itself.

2026-09-19, gate-r4 (r4-gate.json, the round-3 adversarial pass's own
last call against gate-r3's fixes -- CONFIRMED by execution unless stated
otherwise):
26. Point 22 above OVER-corrected: `_github_api_merge_reason()` blocked a
    literal-PR `gh api .../pulls/<n>/merge` outright, which is the founder's
    own documented, previously-working owned-PR route (see point 7, ADR
    0090:173/242, SKILL.md step 4) -- a locked decision silently reversed
    (BLOCKER, CLAUDE.md 0.1), with the owned-PR block message below still
    telling a session to run the exact call now blocked. Restored: `gh api`
    with a literal PR number on this one endpoint stays ungated, exactly as
    before gate-r3; curl/wget/a script/graphql/the base Merges endpoint do
    not, unchanged. Separately, and not a re-opening of the same gap: the
    literal-PR-number requirement itself had a hole point 22 introduced --
    `_PR_MERGE_ENDPOINT_RE` required `\\d+`, so `pulls/$N/merge` matched
    NEITHER the block nor the exemption and ran completely unchecked, in
    `gh api` or any other client (`N=2; curl -X PUT .../pulls/$N/merge`,
    confirmed exit 0). Now detected and refused for every client, literal
    number or not decided before the gh-api exemption is even considered.
27. `_direct_push_problem()`'s refspec reading only ever compared the WHOLE
    joined positional-argument text against `_MAIN_TARGET_RE`, so three
    shapes reached main with no literal "main" anywhere: a bare `HEAD`/`@`
    with no `:dest` (the real destination is the CURRENT LOCAL BRANCH, which
    this hook has never read -- `git push origin HEAD`, `git push origin @`,
    confirmed exit 0, confirmed live against a local bare origin to really
    move its `main`); a wildcard refspec (`git push origin
    'refs/heads/*:refs/heads/*'`, confirmed exit 0 and confirmed live);
    and a destination built from a shell variable ASSIGNED EARLIER IN THE
    SAME COMMAND (`B=main; git push origin HEAD:$B`, confirmed exit 0) --
    this hook already reasons about one command at a time (point 21's own
    residual says so explicitly), and a plain `NAME=value` before the push,
    in that same command, is exactly the case that principle covers, so it
    is now resolved the way the shell itself would resolve it. `_push_reason()`
    now reads each refspec's own destination: bare `HEAD`/`@` blocks outright
    (unknowable without reading local state); a wildcard on either side of a
    refspec blocks; a same-command `NAME=value` substitutes into a `$NAME`/
    `${NAME}` destination before the main-target and wildcard checks run; a
    `HEAD`/`@`-sourced destination that is still a shell expansion after that
    substitution (no matching assignment was found) blocks as unresolvable,
    the same conservative direction as the pre-existing
    fewer-than-two-positionals case. A non-`HEAD`/`@` source with an
    unresolvable variable destination (`git push origin
    feature:$UNRELATED_VAR`, no assignment anywhere in the command) is left
    alone -- not the demonstrated shape, and blocking every unresolved
    variable regardless of source would refuse ordinary scripted pushes to
    named branches that have nothing to do with main.
28. path-exec-surface-outside-matcher (point 23) named six tool families the
    matcher was widened for; the built-in `Monitor` tool runs a shell command
    in the same shell environment as Bash and was not among them --
    CONFIRMED with `re.search`, the widened pattern did not match its name.
    `.claude/settings.json`'s matcher now includes it explicitly.

This is still a lexical check, not a shell: a command computed at run time (a
`gh` alias, a shell alias for gh, `eval` of a built string, a script file,
arguments xargs appends) is not seen, nor are words the shell splits apart (`gh${IFS}pr${IFS}merge`,
`{gh,pr,merge}`), nor a gh and a pr both built by expansion
(`$G p$()r merge`), nor, inside a string another shell runs, a gh or pr built
by expansion (`bash -c 'gh p$()r merge'`) or a subcommand built by backticks
or ending in a glob character. ADR 0090's residual list names these.

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
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

# History: until 2026-09-18 a single regex, `\bgh\s+pr\s+merge\b(?P<tail>...)`,
# captured the argument tail after "merge" so the PR number could be found
# regardless of flag order (`gh pr merge --squash 42`, a /pull/42 URL) -- v2 only
# captured a number immediately after "merge" and missed those, confirmed live
# (correctness angle, third audit).
#
# 2026-09-18, fixer round (ADR 0090 amendment): the regex above checked only the
# FIRST `gh pr merge` in a command, so `<clean merge> && <owned merge>` ran the
# second unchecked (measured: exit 0), and `"gh" pr merge`, `g\h pr merge` and
# `$G pr merge` were not matched at all. Replaced by merge_invocations(): the
# command is tokenized the way the shell quotes it (shlex, POSIX), EVERY
# `pr [flags] merge` invocation is checked, and a `pr merge` the tokenizer cannot
# place as its own command (inside `bash -c "..."`, `eval`, a comment) blocks.
REPO = "aldemirkonuk/RestaurantAIAutomation"
# `gh` (or a `$VAR`, or the end of a `$(...)`/backtick) then `pr` [flags] `merge`,
# anywhere in the command once quotes and backslashes are stripped: the count
# every parsed invocation is checked against. Prose such as a commit message
# saying "the PR merge flow" does not match; "gh pr merge" in prose still does.
_FLAGS = r"(?:\s+-{1,2}\S+(?:\s+[^\s-]\S*)?)*"
_MERGE_PROBE_RE = re.compile(rf"(?i)(?:\bgh\b|\$\S*|[)`]){_FLAGS}\s*\bpr{_FLAGS}\s+merge\b")
# CONFIRMED BY EXECUTION (gate-r3 adversarial round, 2026-09-19,
# shell-renamed-gh-direct-merge): the probe above requires the literal word
# "gh" (or a $.../)/` lead-in) before "pr ... merge"; a symlink or PATH-relative
# rename of `gh` (`octocli -> $(which gh)`, invoked as `octocli`, by absolute
# path, or wrapped in `nohup`) has none of those, so `probe` was always empty
# and merge_invocations() returned before the tokenizer -- which does not care
# what the program is named -- ever ran. This is the SAME tail shape with the
# "gh" requirement dropped, used ONLY to decide whether tokenizing is worth it
# at all: a command mentioning neither "gh" nor a bare "pr ... merge" pair
# still short-circuits instantly. A hit here is not itself a verdict --
# merge_invocations()'s own tokenizer + _is_program() below still have to
# confirm the segment's head is actually gh (literally or by identity) before
# anything is added to `found`.
_PLAIN_PR_MERGE_RE = re.compile(rf"(?i)\bpr{_FLAGS}\s+merge\b")
_SHELL_PUNCTUATION = "();<>|&\n`"
# gh pr merge's own flags (gh 2.x). Anything else is not something this hook
# can reason about, so it blocks.
_VALUE_FLAGS = frozenset({"-A", "--author-email", "-b", "--body", "-F", "--body-file",
                          "-t", "--subject", "-R", "--repo", "--match-head-commit"})
_BOOL_FLAGS = frozenset({"--admin", "--auto", "-d", "--delete-branch", "--disable-auto",
                         "-m", "--merge", "-r", "--rebase", "-s", "--squash"})
# Flags gh accepts that the pr-audit-gate skill forbids (SKILL.md step 10).
_FORBIDDEN_FLAGS = {
    "--admin": "--admin forces a merge past main's branch protection; the pr-audit-gate "
               "skill never uses it (a required check that is not green is GitHub "
               "correctly refusing).",
    "--auto": "--auto arms GitHub's auto-merge against the PR, not the audited commit; "
              "the pr-audit-gate skill merges immediately instead.",
}
_PIN_RE = re.compile(r"[0-9a-f]{40}")
_PR_URL_RE = re.compile(r"https://github\.com/([^/\s]+/[^/\s]+)/pull/(\d+)/?", re.I)
# MCP tools that can merge a PR or arm auto-merge (for example
# mcp__ccd_pr__set_auto_merge): no pin and no ownership check, so blocked. Matched
# on the tool name's own words, so mcp__<supabase>__merge_branch is not caught.
_MCP_MERGE_WORDS = frozenset({"pr", "pull", "pulls", "auto"})
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
    """Remove each backslash-newline line continuation the way the shell does,
    so a command split across lines for readability is still scanned as one
    logical command. Deliberately leaves bare newlines (no preceding
    backslash) alone -- those really do separate independent statements,
    which DIRECT_PUSH_PATTERN's `\\n` exclusion still correctly treats as a
    boundary.

    The shell removes the two characters outright; it does not put a space
    in their place. Until the confirm round (2026-09-18) this function did,
    so `gh pr mer\\<newline>ge 2`, which the shell runs as `gh pr merge 2`, was
    read as `mer ge` and allowed with no pin and no ownership check, and
    `git push origin mai\\<newline>n` was allowed the same way (each measured:
    exit 0). A backslash that is itself escaped (`\\\\` then a newline) does
    not continue the line, and a backslash then blanks then a newline is not
    a continuation to the shell either."""
    return re.sub(r"(?<!\\)((?:\\\\)*)\\\n", r"\1", command)


# gate-r3 adversarial round (2026-09-19), three CONFIRMED gaps in
# DIRECT_PUSH_PATTERN, additive so the regex above (and its own pinned history
# in scripts/pr_audit_gate.py's self-test) is untouched:
#   shell-renamed-git-direct-push: the regex requires the literal word "git".
#   path-push-token-between-git-and-push: it tolerates exactly one hardcoded
#     `-C <path>` between "git" and "push"; `--no-pager`, `-c x=y`, or `git
#     subtree push` are not "push" immediately after "git" and are missed.
#   path-push-bare-and-broad: it requires the literal substring "main"; `git
#     push`, `git push origin`, `--mirror` and `--all` carry none, and the
#     real destination then depends on local config (push.default, branch
#     tracking, remote.pushDefault) this hook never reads -- on a repo with
#     ~90 worktrees, routinely main.
#   path-git-level-alias: a `git config alias.<name>` collapses an entire push
#     into one word carrying neither "push" nor "main"; resolved here (bounded
#     to names outside a short common-subcommand list, so an ordinary `git
#     status`/`git commit`/etc. never pays for the extra `git config` call).
# _direct_push_problem() tokenizes the same way merge_invocations() does (any
# number of global flags, `git` by literal spelling or by the _is_program
# identity fallback) and is checked IN ADDITION to DIRECT_PUSH_PATTERN, never
# instead of it -- either one blocking is enough.
_GIT_GLOBAL_VALUE_FLAGS = frozenset({"-C", "-c", "--git-dir", "--work-tree",
                                     "--namespace", "--super-prefix", "--config-env"})
_COMMON_GIT_SUBCOMMANDS = frozenset({
    "status", "diff", "add", "commit", "log", "fetch", "pull", "checkout",
    "branch", "merge", "rebase", "stash", "tag", "remote", "clone", "init",
    "reset", "show", "config", "restore", "switch", "cherry-pick", "revert",
    "mv", "rm", "blame", "describe", "worktree", "submodule", "grep", "apply",
    "cat-file", "rev-parse", "ls-tree", "ls-files", "update-index", "hash-object",
})
# The same ref shapes DIRECT_PUSH_PATTERN's own tail recognizes (a leading `+`,
# an optional `<something>:` source half of a refspec, `refs/heads/`, optional
# quotes), applied only to a push's own destination arguments once they are
# known, not the whole command.
_MAIN_TARGET_RE = re.compile(r"(?:^|\s)\+?(?:[^\s:]+:)?(?:refs/heads/)?['\"]?main['\"]?(?:\s|$)")


def _skip_git_global_flags(seg: list[str], j: int) -> int:
    while j < len(seg) and seg[j].startswith("-") and seg[j] != "-":
        name, eq, _val = seg[j].partition("=")
        j += 2 if (name in _GIT_GLOBAL_VALUE_FLAGS and not eq) else 1
    return j


def _git_alias_definition(name: str) -> str | None:
    return _run(["git", "config", "--get", f"alias.{name}"])


# gate-r4 path-push-refspec-ambiguous (2026-09-19, r4-gate.json): a same-command
# `NAME=value` read the way the shell itself would resolve it -- this hook
# already reasons about one command at a time (point 21's own residual says
# so explicitly), and `B=main; git push origin HEAD:$B` is one command.
# Deliberately simple: only a leading run of statements shaped exactly like
# `NAME=value` counts, the same restraint this file applies everywhere else
# it declines to build a general shell evaluator.
_SIMPLE_ASSIGNMENT_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)
# gate-r8 last call, finished: zsh's `$=NAME`, `${=NAME}` (split), `$~NAME`
# (glob) and `$^NAME` are NAME's value too; the Bash tool runs zsh here.
_VAR_REF_RE = re.compile(r"\$\{[=~^]*(\w+)\}|\$[=~^]*(\w+)")
# Any reference to a name, including a zsh parameter flag this hook does not
# evaluate (`${(z)G}`, `${(s: :)G}`, which split G's value into words).
_PARAM_NAME_RE = re.compile(r"\$\{(?:\([^)]*\))?[=~^]*(\w+)|\$[=~^]*(\w+)")
_STATEMENT_SEP_TOKENS = frozenset({";", "&&", "||", "\n"})
# A value this hook must never trust as literal, however it was produced --
# distinct from "not set at all" (also left unresolved, by the .get default
# below, but for a different reason).
_UNRESOLVED = object()


def _collect_assignments(toks: list[str]) -> dict[str, list[tuple[int, object]]]:
    """NAME -> [(token index, value or _UNRESOLVED), ...] for every plain
    `NAME=value` token leading a statement (`B=main; ...`, or an env-prefix `B=main C=x git
    ...`), read from the FULL flat token stream `_tokens()` produced for the
    whole command -- not the already-segmented list -- so this can see what
    comes immediately after each assignment.

    SELF-ADVERSARIAL FINDING, fixed before ever shipping (2026-09-19): a
    first version of this read `NAME=value` per already-split segment and
    trusted `value` outright. `_SHELL_PUNCTUATION` includes `(` and `` ` ``,
    so the tokenizer itself splits `B=$(echo main)` into `"B=$"`, `"("`,
    `"echo"`, `"main"`, `");"`, ... and `` B=`echo main`; `` into `"B="`,
    `` "`" ``, `"echo"`, `"main"`, `` "`;" ``, ... -- CONFIRMED the naive
    version read the truncated fragment (`"$"`, or `""`) as B's whole value,
    concluded it plainly was not main, and let `HEAD:$B` through even though
    the shell's real value of `$B` is `main`. Now: whenever the token right
    after a `NAME=value` assignment is itself punctuation and is NOT a
    statement separator (so it is a `(`/backtick/similar opening a
    construct this hook does not evaluate, not the `;`/`&&`/newline that
    would end an ordinary standalone assignment), NAME maps to `_UNRESOLVED`
    -- never to the fragment left behind -- so a downstream lookup treats it
    exactly like an unresolved expansion, the safe direction, rather than
    like a literal value that happens not to be main.

    Founder decision, verbatim, 2026-09-21 review-trail round: "Teach it
    export." Named as a residual, not yet code, in ADR 0090's gate-r5
    section ("the push-residual bullet's `$UNRELATED` example ... undersells
    a same-command `export NAME=main` assignment, which `_collect_assignments()`
    does not parse"): `export B=main; git push origin feat:$B` reaches main
    with no literal "main" anywhere `_push_reason()` can see, because a
    leading `export` token matches neither `_SIMPLE_ASSIGNMENT_RE` (it has no
    `=`) nor a statement separator, so the ORIGINAL code took the branch that
    treats it as "the command itself starts here", set `at_start = False`,
    and the `B=main` token right after it was then skipped outright (`if not
    at_start: i += 1; continue`) -- CONFIRMED exit 0 before this fix, live
    against a local bare origin. A leading `export` (literal, lowercase, the
    real bash builtin's own spelling -- this hook does not attempt `\\export`
    or other obfuscated spellings of the builtin itself, the same restraint
    it applies to git aliases and gh respellings elsewhere) is now consumed
    as a no-op that leaves `at_start` True, so every `NAME=value` after it is
    read exactly as an unprefixed env-prefix assignment already is.
    `export -n NAME=value` and `export -- NAME=value` assign exactly as the
    bare form does (`-n` only drops the export attribute), so a flag right
    after `export` is skipped the same way, still at the statement's start.

    gate-r6 LAST-CALL CORRECTION (2026-09-21): parsing `export` fed it into a
    reader that kept only the LAST value of each name, taken from anywhere in
    the command -- and before this, an exported name was never collected at
    all, so `HEAD:$B` stayed unresolved and was refused. Two shapes that were
    refused therefore passed: `export B=main; git push origin HEAD:$B;
    export B=develop` (resolved to the later `develop`; the push itself sees
    `main`) and `git push origin HEAD:$B; export B=develop` (resolved to a
    value assigned only AFTER the push, which sees the caller's own `$B`).
    This now returns every assignment of each name with its token index, and
    _env_before() decides what a push starting at a given token may trust."""
    assigned: dict[str, list[tuple[int, object]]] = {}
    at_start = True
    i, n = 0, len(toks)
    while i < n:
        tok = toks[i]
        if tok in _STATEMENT_SEP_TOKENS:
            at_start = True
            i += 1
            continue
        if at_start and tok == "export":
            # `export` on its own is not an assignment (`_SIMPLE_ASSIGNMENT_RE`
            # requires a `=`) and must not be read as one -- it is a no-op
            # continuation of "still at the start of this statement", so the
            # `NAME=value` token(s) that follow it are read the same way a
            # bare env-prefix already is, rather than being skipped as the
            # export builtin's own (nonexistent) command arguments.
            i += 1
            while i < n and toks[i].startswith("-"):
                i += 1  # `export -n` / `export --`: still the builtin, still assigning
            continue
        if not at_start:
            i += 1
            continue
        m = _SIMPLE_ASSIGNMENT_RE.match(tok)
        if not m:
            at_start = False  # the command itself starts here
            i += 1
            continue
        nxt = toks[i + 1] if i + 1 < n else None
        if nxt is not None and nxt not in _STATEMENT_SEP_TOKENS and _is_punctuation(nxt):
            value: object = _UNRESOLVED
        elif re.search(r"[$`(]", m.group(2)):
            # gate-r8: a value that is itself an expansion (`B=$X`, and every
            # `B=$(...)` the word reader keeps whole) or an array (`B=(main)`,
            # whose `$B` is main) is not a literal. Read as one, `X=main; B=$X;
            # git push origin HEAD:$B` resolved to `$X`, "plainly not main",
            # and was allowed; measured moving a bare origin's main.
            value = _UNRESOLVED
        elif m.group(1) == "_":
            # gate-r8 last call: the shell itself resets `$_` after every
            # command (to its last argument), so no `_=value` is ever what a
            # later `$_` holds. Trusted, `_=x; echo git; $_ push origin HEAD`
            # resolved `$_` to `x` and was allowed; measured moving a bare
            # origin's main.
            value = _UNRESOLVED
        else:
            value = m.group(2)
        assigned.setdefault(m.group(1), []).append((i, value))
        i += 1
    return assigned


def _env_before(assigned: dict[str, list[tuple[int, object]]], start: int) -> dict[str, object]:
    """NAME -> the value a command starting at token `start` may be trusted to
    see, from every same-command assignment `_collect_assignments` found,
    read in the safe direction because this hook follows no control flow
    (`&&`, a loop, a later reassignment): main if ANY assignment of the name
    is main; otherwise _UNRESOLVED if the name is assigned more than one
    value, holds a value this hook does not evaluate, or is first assigned
    at or after `start` (so the command may see the caller's own, unknown
    value); otherwise the one value it is ever given. Residual, named rather
    than claimed closed (ADR 0090, gate-r6): a value set any way but a plain
    or exported `NAME=value` the collector sees -- `declare`, `typeset`,
    `readonly`, `local`, `read`, `eval`, `NAME+=`, or an assignment after a
    punctuation run the tokenizer fuses (`); B=main`) -- cannot be weighed
    here at all. [gate-r8: the fused-punctuation case is now read -- the
    word reading splits `)` from `;` and collects `B=main`.] Reading
    `export` as the bare form reads it brings export to the same gaps:
    `export B=develop; eval B=main; git push origin HEAD:$B`
    was refused before gate-r6 only because an exported name was never read."""
    env: dict[str, object] = {}
    for name, entries in assigned.items():
        values = [value for _index, value in entries]
        if entries[0][0] >= start:
            values.append(_UNRESOLVED)  # read before this command first assigns it
        main = next((v for v in values if isinstance(v, str) and _MAIN_TARGET_RE.search(f" {v} ")), None)
        if main is not None:
            env[name] = main
        elif any(v is _UNRESOLVED for v in values) or len(set(values)) > 1:
            env[name] = _UNRESOLVED
        else:
            env[name] = values[0]
    return env


def _resolve_simple_var(value: str, env: dict[str, object]) -> str:
    """Substitute a bare $NAME/${NAME} using `env` (_env_before() over the
    same-command assignments collected above); anything else ($(...), backticks, an unset name, or a
    name collected but marked _UNRESOLVED above) is left exactly as written
    -- the caller treats "still looks like an expansion after this" as
    unresolved, never as proof it is safe."""
    def sub(m: "re.Match[str]") -> str:
        name = m.group(1) or m.group(2)
        val = env.get(name, m.group(0))
        return m.group(0) if val is _UNRESOLVED else val
    return _VAR_REF_RE.sub(sub, value)


def _push_reason(seg: list[str], env: dict[str, str] | None = None) -> str | None:
    """Why this segment (its head already confirmed to be git) is a push this
    hook must block or treat as CANNOT CHECK, or None if it plainly is not.
    `env`: what same-command NAME=value assignments give (see _env_before)."""
    env = env or {}
    j = _skip_git_global_flags(seg, 1)
    while j < len(seg) and re.search(r"[$`]", seg[j]):
        # gate-r8: a subcommand built from an expansion is resolved through the
        # same-command assignments, as a command word is (_expansion_words);
        # one this hook cannot resolve may be push. Before, `P=push; git $P
        # origin HEAD` and `git $(echo push) origin HEAD` were read as an
        # unknown, not alias-shaped subcommand and allowed; each measured
        # moving a bare origin's main.
        words = _expansion_words(seg[j], env)
        if words is None:
            return (f"runs git with a subcommand (`{seg[j]}`) built from a shell expansion "
                    "this hook cannot resolve through the command's own assignments, "
                    "which may be push")
        seg = seg[:j] + words + seg[j + 1:]
        j = _skip_git_global_flags(seg, j)
    if j >= len(seg):
        return None
    sub = seg[j].lower()
    rest = seg[j + 1:]
    if sub == "subtree" and j + 1 < len(seg) and seg[j + 1].lower() == "push":
        rest = seg[j + 2:]
    elif sub != "push":
        if sub in _COMMON_GIT_SUBCOMMANDS or not re.fullmatch(r"[a-z][a-z0-9-]*", sub):
            return None  # a known, or clearly not alias-shaped, subcommand
        alias = _git_alias_definition(seg[j])
        if not alias or not re.search(r"(?i)\bpush\b", alias):
            return None
        return (f"`git {seg[j]}` is a git alias (`{alias.strip()[:120]}`) this hook cannot "
                "expand and re-check, and it may push")
    if any(t in ("--mirror", "--all") for t in rest):
        return "pushes every ref (--mirror/--all), which includes main if main exists on the remote"
    positional = [a for a in rest if not a.startswith("-")]
    if len(positional) < 2:
        where = "no remote or refspec" if not positional else f"{positional[0]!r} but no refspec"
        return (f"a push with {where} -- the real destination depends on local config "
                "(push.default, branch tracking, remote.pushDefault) this hook does not read")
    # gate-r4 path-push-refspec-ambiguous: a refspec's DESTINATION is what
    # actually lands on the remote, and three shapes let it be main (or any
    # ref) with no literal "main" anywhere in the command text -- a bare
    # `HEAD`/`@` (git names the remote branch after the CURRENT LOCAL BRANCH,
    # which this hook has never read, the same gap the fewer-than-two-
    # positionals case above already declines to guess at); a wildcard
    # (`refs/heads/*:refs/heads/*`, matching every local branch, main
    # included, if one exists); and a shell variable on the destination side
    # (`HEAD:$B`), resolved against a same-command assignment when one
    # exists and treated as unresolved, not safe, when it does not.
    for spec in positional[1:]:
        # r5-gate.json must-fix 3 (2026-09-20): a leading "+" is git's own
        # force-push marker on the refspec ("+HEAD", "+@", "+src:dst") -- it
        # was never stripped before comparing `src` to ("HEAD", "@") below,
        # so "+HEAD"/"+@" matched NEITHER that equality check NOR anything
        # else in this loop and fell through to `return None` (not blocked).
        # CONFIRMED with real git against a local bare origin: `git push
        # origin +HEAD` from a main checkout moved remote main. The marker
        # only ever prefixes the SRC side of a refspec, never the dst, so
        # stripping it here (before the ":" split) fixes both places that
        # compare `src` -- this one and the shell-expansion check below.
        if spec.startswith("+"):
            spec = spec[1:]
        if ":" in spec:
            src, dst = spec.split(":", 1)
        else:
            src, dst = spec, None
        if dst is None:
            if src in ("HEAD", "@"):
                return ("pushes HEAD/@ with no explicit destination branch name -- the real "
                        "destination is resolved from the current local branch, which this "
                        "hook does not read")
            target = src
        else:
            target = dst
        if "*" in src or (dst is not None and "*" in dst):
            return "pushes a wildcard refspec, which includes main if a local main matches"
        resolved = _resolve_simple_var(target, env)
        if _MAIN_TARGET_RE.search(" " + resolved + " "):
            return "pushes directly to main"
        if resolved == target and re.search(r"[$`]", target) and (dst is None or src in ("HEAD", "@")):
            return (f"pushes to a destination ({target!r}) built from a shell expansion this "
                    "hook cannot resolve, which may be main")
    return None


# gate-r7, 2026-09-21. The residual gate-r6 could only NAME (its bracket on
# the gate-r5 "Named, not code-changed" bullet, above): "a push behind an env
# prefix or a wrapper (`X=1 git push origin HEAD`, `nohup git push origin
# HEAD`), which `_direct_push_problem()` skips because the segment's first
# word is not git." CONFIRMED exit 0 before this fix, live against a local
# bare origin: both example commands really do move the remote's main --
# `_direct_push_problem()`'s segment loop required `seg[0]` itself to BE git
# (`_is_program(seg[0], "git")`), so a segment opening with an assignment
# token (`X=1`) or a wrapper program's own name (`nohup`) was skipped
# WHOLESALE, the real `git push` sitting right after it never reached
# `_push_reason()` at all.
#
# Founder's answer, as relayed by the orchestrating session (ADR 0090 Review
# trail, gate-r7): close it, fail closed -- a push behind leading assignments
# or a wrapper (nohup, env, command, time, exec, sudo, xargs, a shell -c with
# a literal string) run from a main checkout is read like a bare push; an
# unrecognised wrapper shape is refused.
#
# Built as three readings, one per part of that answer:
#   RECOGNISED -- `_wrapper_stripped_push_reason()` peels any run of
#     `NAME=value` assignments and any chain of the seven named wrappers
#     (matched by basename, so `/usr/bin/env` counts) off the front of a
#     segment; a `git` reached that way is read EXACTLY LIKE A BARE PUSH
#     (`_push_reason()`, over the same `_env_before()` an un-wrapped push gets).
#   SHELL STRING -- `_shell_string_push_reason()`: a shell whose options carry
#     `c` anywhere (`-c`, `-lc`, `-ec`, `--norc -c`, `-o pipefail -c`) runs a
#     command string; every later non-option word is re-checked by this same
#     function, recursively, bounded by `_MAX_PUSH_WRAP_DEPTH` the way
#     `_gh_api_reading()` bounds its own nested-quote reading. A word built
#     from `$`/backtick, or nesting past the bound, is REFUSED -- this hook
#     cannot resolve either without running a shell. A shell with no `c`
#     option runs a script file or stdin: point 23's residual, unchanged.
#   UNRECOGNISED -- `_unrecognised_wrapper_push_reason()`: once the chain
#     stops at anything else (a recognised wrapper's own flag, `sudo -u root`,
#     `env -i`, `xargs -I{}`; a program not on the list, `timeout`, `nice`,
#     `find -exec`; a shell keyword, `then`, `do`, `{`, `!`; `eval`), a later
#     `git` running `push` -- to ANY destination -- is REFUSED, not read. So
#     is a shell string holding the word push behind such a shape, and any
#     later multi-word argument holding it when what ran it is a recognised
#     wrapper's own flag (`env -S '...'`) or a program known to run a string
#     it is handed (`_STRING_RUNNING_PROGRAMS`: `eval '...'`, `watch '...'`,
#     `ssh host '...'`, `python3 -c '...'`). Nothing here refuses a command
#     with no git running push in it: `sudo docker push img`, `sudo apt-get update`,
#     `env FOO=bar npm run build` stay exactly as unblocked as before.
#
# Named residuals (ADR 0090, gate-r7): a value set any way
# `_collect_assignments()` does not read (`declare`, `typeset`, `readonly`,
# `local`, `read`, `eval`, `NAME+=`) -- the founder's answer is to KEEP
# TRUSTING them; heredoc and comment text keep the CURRENT reading (this push
# check reads a heredoc body's lines as commands, as it did before, and shlex
# drops comment text, as it did before); a program outside both lists that
# runs a QUOTED string itself is not read, since this hook cannot tell it from
# a quoted argument such as `gh pr create --body '...'`.
_PUSH_WRAPPER_PROGRAMS = frozenset({"nohup", "env", "command", "time", "exec", "sudo", "xargs"})
_PUSH_SHELL_PROGRAMS = frozenset({"sh", "bash", "zsh", "dash", "ksh", "fish"})
# What runs a heredoc body as a script (gate-r8 last call, _heredoc_runs_as_script()).
_SCRIPT_RUNNERS = _PUSH_SHELL_PROGRAMS | {"source", "."}
_MAX_PUSH_WRAP_DEPTH = 3
# A shell option cluster that makes the shell run a command string: `-c`
# itself, or `c` among other single-letter options (`-lc`, `-ec`, `-xc`).
_SHELL_C_OPTION_RE = re.compile(r"^-[A-Za-z]*c[A-Za-z]*$")
# Programs that run a string they are handed, matched by basename with any
# trailing version stripped (`python3.11` -> `python`).
_STRING_RUNNING_PROGRAMS = frozenset({"eval", "watch", "su", "flock", "script", "ssh",
                                      "parallel", "python", "node", "perl", "ruby", "osascript"})


def _git_invokes_push(seg: list[str], env: dict[str, object]) -> bool:
    """True if `seg` (its head already confirmed to be git) runs `push`,
    `subtree push`, or an alias `_push_reason()` says may push -- to ANY
    destination, main or not."""
    j = _skip_git_global_flags(seg, 1)
    if j < len(seg):
        sub = seg[j].lower()
        if sub == "push" or (sub == "subtree" and j + 1 < len(seg) and seg[j + 1].lower() == "push"):
            return True
    return _push_reason(seg, env) is not None


# gate-r8, 2026-09-21, round 6. The founder's answer to the gate-r7 last call,
# verbatim: "Take all four" of its recommendations. Two of them are code here:
#   GIT NAMED BY AN EXPANSION (road (a)): `G=git; $G push origin HEAD` and
#     `$(echo git) push origin HEAD` were not seen -- a command word built from
#     `$` or a backtick matched neither git nor a wrapper, and nothing after it
#     was git. Now a command word built that way is resolved through the
#     same-command assignments `_collect_assignments()` already collects
#     (`_expansion_words()`), split on blanks the way the shell splits an
#     unquoted expansion, and read as what it resolves to; one this hook cannot
#     resolve is REFUSED when push follows it (`_push_follows()`), past git's
#     own global flags, or when it is one whole substitution holding push.
#     The same applies to a later single word behind an unrecognised wrapper
#     shape, and to git's own subcommand (`git $P`, `_push_reason()`).
#   AN UNREADABLE WORD (road (b), in `_direct_push_problem()`): when shlex
#     cannot close a word (bash `$'...'` quoting, an odd apostrophe in a
#     heredoc body), the command is re-read with the heredoc-aware `_lex()`
#     reader; it is refused only if that reading also fails.
# Named residuals (ADR 0090, gate-r8): a git and its subcommand BOTH built by
# expansion (`$G $P origin HEAD`, nothing literal to follow), a command word
# built by brace or glob expansion (`{git,push,origin,HEAD}`), behind an
# unrecognised shape a substitution word holding blanks (read as a string),
# a git alias the command defines for itself (`git -c alias.p=push p`), and a
# command both readings misread through a construct the word reader does
# not flag.
# Last call (ADR 0090, gate-r8), five fail-opens in the two roads, each
# measured moving a bare origin's main and closed where it lived: a
# same-command prefix read as giving the command's own words their value
# (_wrapper_stripped_push_reason), a `_=value` trusted (_collect_assignments),
# `$'...'` escapes read as the escaped letter (_ansi_c), zsh's `=git`
# (_is_program), and heredoc bodies a shell runs or expands
# (_heredoc_push_reason).
# The same last call, finished (the fix above, as first written, still let
# pushes through, each measured moving a bare origin's main): a body a shell
# reaches past the heredoc's own line -- after a trailing pipe, through a
# group, keyword compound or `case` branch piped to a shell, through a
# substitution whose word a shell runs, by `.`/`source` (the fix stripped `.`
# to an empty name), or by a shell named by an expansion
# (_heredoc_runs_as_script); a heredoc inside an unquoted body's
# substitution (read now as the command it is); zsh's `=bash`, `=sh` and
# `=python3` (_program_name); zsh's `$=G`, `${=G}`, `${(z)G}` and
# `${(s:x:)G}` (_VAR_REF_RE, _value_holds_push); quoting inside both git and
# push, which hid the command from the prefilter (_unquoted); and a push
# check that raised, which exited 1 and so let the command run (caught in
# main(), refused). A heredoc script or an unquoted body's substitution
# nested past _MAX_PUSH_WRAP_DEPTH is refused, as a shell's command string is.

# A word that is one whole `$(...)` or backtick substitution (the word reader
# keeps one whole; shlex never does).
_WHOLE_SUBSTITUTION_RE = re.compile(r"(?s)\$\(.*\)|`.*`")


def _expansion_words(tok: str, env: dict[str, object]) -> list[str] | None:
    """The words `tok`, built from `$` or a backtick, becomes once resolved
    through the same-command assignments (`env`, from _env_before()), split
    on blanks the way the shell splits an unquoted expansion; None when any
    part of it is still an expansion this hook cannot resolve. A same-command
    IFS is honoured: `IFS=x; W=gitxpush; $W origin HEAD` is `git push`,
    measured moving a bare origin's main."""
    resolved = _resolve_simple_var(tok, env)
    ifs = env.get("IFS")
    if re.search(r"[$`]", resolved) or ifs is _UNRESOLVED:
        return None
    if isinstance(ifs, str):
        return [w for w in re.split(f"[{re.escape(ifs)}]+", resolved) if w] if ifs else [resolved]
    return resolved.split()


def _value_holds_push(tok: str, assigned: dict[str, list[tuple[int, object]]], start: int) -> bool:
    """True when `tok` names a variable an assignment before token `start`
    gives a value holding `push`. gate-r8 last call, finished: under zsh,
    `${(z)G}` and `${(s: :)G}` split G's value into words, so with `G="git
    push origin HEAD"` each runs a push nothing after it names; measured
    moving a bare origin's main. The flags are not evaluated here: an
    unresolved word whose value holds push is refused, as one whole
    substitution holding push is. A prefix or a later assignment gives the
    word nothing (`G='git push' $G origin HEAD` runs no push)."""
    for m in _PARAM_NAME_RE.finditer(tok):
        name = m.group(1) or m.group(2)
        if any(index < start and isinstance(v, str) and re.search(r"(?i)push", v)
               for index, v in assigned.get(name, [])):
            return True
    return False


def _push_follows(seg: list[str], k: int) -> bool:
    """True if what follows `seg[k]`, past git's own global flags, is `push`
    or `subtree push`."""
    j = _skip_git_global_flags(seg, k + 1)
    if j >= len(seg):
        return False
    sub = seg[j].lower()
    return sub == "push" or (sub == "subtree" and j + 1 < len(seg) and seg[j + 1].lower() == "push")


def _unresolved_git_reason(tok: str) -> str:
    return (f"runs `{tok}` as a command, a word built from a shell expansion this "
            "hook cannot resolve through the command's own assignments, and push "
            "follows it -- it may be git, so it is refused rather than read")


def _shell_string_push_reason(seg: list[str], i: int, _depth: int) -> str | None:
    """`seg[i]` is a shell. Why the command string it runs is a push this
    hook must refuse, or None -- including None when it runs no string at
    all (no option carrying `c`: a script file or stdin, point 23)."""
    rest = seg[i + 1:]
    if not any(_SHELL_C_OPTION_RE.match(t) for t in rest):
        return None
    for arg in rest:
        if arg.startswith(("-", "+")):
            continue
        if re.search(r"[$`]", arg):
            return (f"runs `{seg[i]}` on a command string built from a shell "
                    "expansion this hook cannot resolve, which may push "
                    "directly to main -- an unrecognised wrapper shape, "
                    "refused rather than silently let through")
        if _depth >= _MAX_PUSH_WRAP_DEPTH:
            return (f"runs `{seg[i]}` on a command string nested past the depth "
                    "this hook re-reads, which may push directly to main")
        reason = _direct_push_problem(arg, _depth + 1)
        if reason:
            return reason
    return None


def _unrecognised_wrapper_push_reason(seg: list[str], i: int, seg_start: int,
                                      assigned: dict[str, list[tuple[int, object]]],
                                      wrapped: bool, _depth: int) -> str | None:
    """`seg[i]` ended the recognised chain: it is none of an assignment, git,
    a named wrapper or a shell. Fail closed on what follows it -- refuse a
    later git that pushes at all, and a string holding the word push that a
    shell, a string-running program, or a recognised wrapper's own flags
    (`wrapped`) may run."""
    refusal = (f"runs a git push behind `{seg[i]}`, a wrapper shape this hook "
               "does not recognise -- refused rather than read, whatever its "
               "destination")
    runner = re.sub(r"[0-9.]+$", "", _program_name(seg[i]))
    reads_strings = wrapped or runner in _STRING_RUNNING_PROGRAMS
    k = i + 1
    while k < len(seg):
        tok = seg[k]
        if re.search(r"[$`]", tok) and not re.search(r"\s", tok):
            # gate-r8 (2): any later single word may be the command this shape
            # runs, as a later git already is: resolve it, and refuse one that
            # cannot be resolved when push follows it. A word holding blanks
            # is a string, and goes on to the string reading below.
            words = _expansion_words(tok, _env_before(assigned, seg_start + k))
            if words is None:
                if _push_follows(seg, k):
                    return _unresolved_git_reason(tok)
                if _value_holds_push(tok, assigned, seg_start + k):
                    return _unresolved_git_reason(tok)
                k += 1
                continue
            seg = seg[:k] + words + seg[k + 1:]
            continue
        if _is_program(tok, "git"):
            if _git_invokes_push(seg[k:], _env_before(assigned, seg_start + k)):
                return refusal
            k += 1
            continue
        if _program_name(tok) in _PUSH_SHELL_PROGRAMS:
            reason = _shell_string_push_reason(seg, k, _depth)
            if reason:
                return reason
            reads_strings = True
            k += 1
            continue
        if reads_strings and re.search(r"\s", tok) and re.search(r"(?i)\bpush\b", tok):
            return refusal
        k += 1
    return None


def _wrapper_stripped_push_reason(seg: list[str], seg_start: int,
                                   assigned: dict[str, list[tuple[int, object]]],
                                   _depth: int = 0) -> str | None:
    """Why `seg` -- a simple command that may open with a same-command
    `NAME=value` assignment or one of the founder's named transparent
    wrappers, not yet confirmed to invoke `git` at all -- is a push this hook
    must block, or None. `seg_start` is `seg[0]`'s own index in the WHOLE
    command's token stream (not just this segment's), so `_env_before()`
    sees exactly the same same-command assignments an un-wrapped push at
    that position would. `assigned` is `_direct_push_problem()`'s own
    `_collect_assignments()` map, built once for the whole command."""
    # gate-r8 last call: the shell expands every word of a simple command
    # before that command's own NAME=value prefix takes effect, so a prefix
    # never gives this command's words their value; it counts as assigned
    # after them, as a later statement's assignment already does. Read as
    # given, `declare G=git; G=true $G push origin HEAD` resolved `$G` to
    # `true` and was allowed where `declare G=git; $G push origin HEAD` is
    # refused (so was `declare P=push; P=status git $P origin HEAD`, and,
    # older than this round, `declare B=main; B=feat git push origin HEAD:$B`);
    # each measured moving a bare origin's main. Every word of this segment
    # therefore reads the same assignments -- those made before the segment
    # -- so a word spliced in by an expansion needs no index of its own.
    assigned = {name: [(k if k < seg_start else float("inf"), v) for k, v in entries]
                for name, entries in assigned.items()}
    i, n = 0, len(seg)
    wrapped = False
    while i < n:
        tok = seg[i]
        if _SIMPLE_ASSIGNMENT_RE.match(tok):
            i += 1
            continue
        if re.search(r"[$`]", tok):
            # gate-r8 (2), road (a): a command word built from an expansion is
            # resolved through the same-command assignments and read as what
            # it resolves to; one this hook cannot resolve is refused when
            # push follows it, and read as an unrecognised shape otherwise.
            words = _expansion_words(tok, _env_before(assigned, seg_start + i))
            if words is None:
                # Push after it, or inside a word that is one whole substitution:
                # `$(printf 'git push') origin HEAD` is split into `git push`.
                if _push_follows(seg, i) or (_WHOLE_SUBSTITUTION_RE.fullmatch(tok)
                                             and re.search(r"(?i)\bpush\b", tok)):
                    return _unresolved_git_reason(tok)
                if _value_holds_push(tok, assigned, seg_start + i):
                    return _unresolved_git_reason(tok)
                return _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned,
                                                         wrapped, _depth)
            seg = seg[:i] + words + seg[i + 1:]
            n = len(seg)
            continue
        if _is_program(tok, "git"):
            return _push_reason(seg[i:], _env_before(assigned, seg_start + i))
        name = _program_name(tok)
        if name in _PUSH_WRAPPER_PROGRAMS:
            wrapped = True
            i += 1
            continue
        if name in _PUSH_SHELL_PROGRAMS:
            return _shell_string_push_reason(seg, i, _depth)
        return _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned, wrapped, _depth)
    return None  # ran out of tokens (only assignments/wrappers, nothing after): not a push


# gate-r8 last call, finished: what opens the push reading. A zsh parameter
# flag (`${(s:x:)G}`) splits a value on any separator, as a same-command IFS
# does, so it opens the reading too.
_PREFILTER_RE = re.compile(r"(?i)\b(?:push|git)\b|\bIFS=|\$\{\(")


def _unquoted(command: str) -> str:
    """The command's text with `$'...'` decoded and every quote and backslash
    dropped, for the prefilter only. gate-r8 last call, finished: quoting
    inside both words hid the whole command from the reading -- `"g"it "p"ush
    origin HEAD`, `g\\it p\\ush origin HEAD`, `g''it p''ush origin HEAD` and
    `$'\\x67it' $'\\x70ush' origin HEAD` were never read, and each moved a
    bare origin's main (measured; gate-r7's hook let them through the same
    way). A word split by an expansion (`g$()it p$()ush`) stays the named
    residual "a git and its subcommand both built by expansion"."""
    decoded = re.sub(r"\$'((?:[^'\\]|\\.)*)'", lambda m: _ansi_c(m.group(1)), command, flags=re.S)
    return re.sub(r"[\"'\\]", "", decoded)


def _direct_push_problem(command: str, _depth: int = 0, _text: bool = False) -> str | None:
    """Why `command` is a push this hook must refuse, or None. `_text` marks one
    line of a heredoc body read in the unreadable-word fallback below: text
    that may never run, so a line no reader can close is read with quotes and
    backslashes removed rather than refused."""
    # Cheap pre-filter: "push" covers a literal invocation (including a
    # renamed/symlinked git, which still can't rename its own SUBCOMMAND
    # away) and "git" covers the alias case, where "push" is hidden inside an
    # alias definition this hook has not read yet and the word never appears
    # in the command text at all (`git shipit`). A renamed git invoking an
    # alias, with neither word present, is a compounding of two separate
    # evasions this hook does not attempt -- tokenizing every single Bash
    # command regardless of content is the cost of closing it, which is not
    # taken here. gate-r8: a same-command IFS can split one word into git and
    # push (`IFS=x; W=gitxpush; $W origin HEAD`), so it opens the reading too.
    if not (_PREFILTER_RE.search(command) or _PREFILTER_RE.search(_unquoted(command))):
        return None
    # gate-r8: two readings. `_lex()` keeps `$(...)` and backticks whole, so a
    # command word built by substitution (`$(echo git) push`) stays one word,
    # and it reads the words inside every substitution, double-quoted ones
    # too: `echo "$(git push origin HEAD)"` was one quoted shlex word, not
    # seen, and moved a bare origin's main. shlex stays the first reading.
    report: dict = {}
    try:
        lexed = _lex_push_reason(command, report, _depth)
    except Exception as exc:  # noqa: BLE001 -- a reader that fails must not read as "not a push"
        lexed = None
        report["failed"] = type(exc).__name__
    try:
        toks = _tokens(command)
    except ValueError:
        toks = None
    if toks is not None:
        reason = _token_push_reason(toks, _depth) or lexed
        if reason:
            return reason
        if "failed" in report:
            return (f"the command cannot be read word by word ({report['failed']}), so a "
                    "push inside a substitution cannot be ruled out")
        # Each reading covers the other's misreads, so a push stays hidden
        # only where both misread at once. Measured, each moving a bare
        # origin's main: `echo $'\''; x=(')')` then a push on the next line,
        # and `echo "$(case a in a) git push origin HEAD;; esac)"`.
        doubt = report.get("open") or report.get("misread")
        if doubt and not _text and _SHLEX_MISREADS_RE.search(command):
            return (f"both readings may misread this command: the word reader meets {doubt}, "
                    "and shlex does not read `$'...'` quoting, a heredoc, a `#` inside a "
                    "word or a double-quoted substitution the way the shell does")
        return _heredoc_push_reason(report, _depth)
    # gate-r8 (1), road (b): shlex cannot close a word -- bash `$'...'`
    # quoting, an odd apostrophe in a heredoc body. Until now the whole push
    # check returned "not a push" here, so `git push origin HEAD; echo $'\''`
    # was allowed and moved a bare origin's main. The `_lex()` reading above
    # stands in for shlex, and the command is refused only if it fails too:
    # it raised, left a quote or substitution open, or met a construct it is
    # known to read differently from the shell. Heredoc bodies, which `_lex()`
    # skips, keep the current reading -- their lines are read as commands.
    if lexed:
        return lexed
    if _text:
        return _token_push_reason(_tokens(re.sub(r"[\"'\\]", "", command)), _depth)
    problem = report.get("failed") or report.get("open") or report.get("misread")
    if problem:
        return (f"shlex cannot close a word, and the heredoc-aware word reader cannot "
                f"read the command either ({problem}) -- refused rather than read as "
                "not a push")
    reason = _heredoc_push_reason(report, _depth)
    if reason:
        return reason
    for body in report.get("bodies", []):
        for line in body.split("\n"):
            reason = _direct_push_problem(line, _depth, _text=True)
            if reason:
                return reason
    return None


def _heredoc_push_reason(report: dict, _depth: int) -> str | None:
    """gate-r8 last call: what runs out of a heredoc body. A body on a line
    that names a shell (`bash <<'EOF'`, `cat <<'EOF' | sh`) is that shell's
    script, read whole as a command; a body under an unquoted delimiter has
    its substitutions run by the shell, and each is read as a command. Read
    one line at a time as text, the shlex fallback lost a script's earlier
    lines: `bash <<'EOF'` with `IFS=x` then `W=gitxpush; $W origin HEAD`, or
    `W="git push"` then `$W origin HEAD`, followed by `echo $'\\''`, was
    allowed. Inside a double-quoted substitution, which shlex reads as one
    word, no body was read at all: `x="$(bash <<'EOF'` + `git push origin
    HEAD` + `EOF` + `)"`, and `echo "$(cat <<EOF` + `$(git push origin HEAD)`
    + `EOF` + `)"`, were allowed. Each measured moving a bare origin's main.
    Which bodies a shell runs is `_heredoc_runs_as_script()`'s reading, made
    in `_lex()`. A body that is only text under a quoted delimiter (`gh pr
    create --body "$(cat <<'EOF' ...)"`) is not read here."""
    for body in report.get("scripts", []):
        if _depth >= _MAX_PUSH_WRAP_DEPTH:
            return ("runs a heredoc body as a shell's script nested past the depth this "
                    "hook re-reads, which may push directly to main")
        reason = _direct_push_problem(body, _depth + 1)
        if reason:
            return reason
    for body in report.get("expanding", []):
        i = 0
        while i < len(body):
            if body.startswith("$(", i):
                start, close = i + 2, ")"
            elif body[i] == "`":
                start, close = i + 1, "`"
            else:
                i += 2 if body[i] == "\\" else 1  # an escaped `$` or backtick substitutes nothing
                continue
            _words, _subs, i = _lex(body, start, close, 1)
            # The substitution is a command of its own, read the way the whole
            # command is, heredocs included: read only word by word, `$(bash
            # <<'X'` + `<push>` + `X` + `)` in an unquoted body was allowed
            # (its own body skipped), measured moving a bare origin's main.
            if _depth >= _MAX_PUSH_WRAP_DEPTH:
                return ("runs a substitution in a heredoc body nested past the depth this "
                        "hook re-reads, which may push directly to main")
            reason = _direct_push_problem(body[start:i], _depth + 1)
            i += 1
            if reason:
                return reason
    return None


# Where shlex's reading cannot stand in for the word reader's: bash's `$'...'`
# quoting (shlex ends it at an escaped `\'`), a heredoc (shlex reads its body
# as code, its apostrophes pairing with quotes outside it), a `#` inside a
# word (shlex drops the rest of the line as a comment; the shell keeps `a#b`
# one word), and a substitution (shlex never reads a double-quoted one).
_SHLEX_MISREADS_RE = re.compile(r"\$'|<<|\S#|\$\(|`")


def _lex_push_reason(command: str, report: dict, _depth: int) -> str | None:
    """The push reading over `_lex()`'s words: the command's own words, then
    the words inside each substitution, each group read as a command of its
    own. `report` collects what `_lex()` could not read and the heredoc
    bodies it skipped."""
    words, subs, _end = _lex(command, 0, None, 0, report)
    for index, group in enumerate((words, *subs)):
        toks = _group_tokens(group)
        if index and "case" in toks:
            # `_lex()` ends a substitution at a case pattern's `)`.
            report.setdefault("misread", "a `case` pattern inside a substitution")
        reason = _token_push_reason(toks, _depth)
        if reason:
            return reason
    return None


def _group_tokens(group: list[tuple[str, str]]) -> list[str]:
    """One `_lex()` word group as the flat token stream `_token_push_reason()`
    reads: an operator run as written, any other word as the shell makes it."""
    return [raw if raw and all(c in _OPERATOR_CHARS + "()" for c in raw) else cooked
            for cooked, raw in group]


def _token_push_reason(toks: list[str], _depth: int) -> str | None:
    """Why the command whose flat token stream is `toks` (shlex's, or one
    group of `_lex()`'s words) is a push this hook must refuse, or None."""
    segments: list[list[str]] = [[]]
    starts = [0]  # the token index each segment starts at, for _env_before()
    target = False
    for index, tok in enumerate(toks):
        if _is_punctuation(tok) and ("<" in tok or ">" in tok) and set(tok) <= set("<>&"):
            if segments[-1] and segments[-1][-1].isdigit():
                segments[-1].pop()
            target = True
        elif _is_punctuation(tok):
            segments.append([])
            starts.append(index + 1)
            target = False
        elif target:
            target = False
        else:
            segments[-1].append(tok)
    assigned = _collect_assignments(toks)
    for seg, start in zip(segments, starts):
        if not seg:
            continue
        reason = _wrapper_stripped_push_reason(seg, start, assigned, _depth)
        if reason:
            return reason
    return None


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

# CONFIRMED bypasses (gate-r3 adversarial round, 2026-09-19): a merge can go
# straight through GitHub's API with no `gh pr merge`-shaped text anywhere for
# _MERGE_PROBE_RE/unplain_gh_word to find, in ANY client:
#   path-http-api-clients: curl/wget/python `requests`/node `fetch` PUT/PATCH
#     to .../pulls/<n>/merge.
#   path-graphql-merge-mutations: `gh api graphql` naming mergePullRequest or
#     enablePullRequestAutoMerge -- no bounded `\bpr\b` word (`pullRequestId`
#     has none), so the probe never fires even though `gh` is the one running
#     it. enablePullRequestAutoMerge does exactly what an MCP auto-merge tool
#     is already blocked outright for (comment on _mcp_merge_tool).
#   path-merges-endpoint-no-pr: POST to the base repo's own /merges endpoint --
#     no PR number exists at all, so there is nothing to pin a marker or an
#     ownership check to; this is a straight block, not a pin-and-check.
# Blocked outright, like an MCP tool that arms auto-merge: none of these carry
# a --match-head-commit pin, a PASS marker or an ownership check to bind to.
_GITHUB_API_HOST_RE = re.compile(r"(?i)\bapi\.github\.com\b")
_GH_API_RE = re.compile(r"(?i)\bgh\s+api\b")
_PR_MERGE_ENDPOINT_RE = re.compile(r"(?i)/?(?:repos/[^\s'\"]+/)?pulls?/([^/\s'\"]+)/merges?\b")
_BASE_MERGES_ENDPOINT_RE = re.compile(r"(?i)/?repos/[^\s'\"]+/merges\b")
_GRAPHQL_MERGE_MUTATION_RE = re.compile(r"\b(?:mergePullRequest|enablePullRequestAutoMerge)\b")

# gate-r4 residual CLOSED (2026-09-19): `_GH_API_RE` alone reads only the
# literal substring "gh api", so `gh${IFS}api ...`, `"gh" api ...`, `{gh,api}`
# or a symlinked/renamed gh running `api ...` were never recognised as gh at
# all -- and with `talks_to_github` False every merge-surface check below
# (non-literal PR number, GraphQL merge mutation, base /merges endpoint) was
# skipped, CONFIRMED exit 0 for each. Tokenizing cannot fix this by itself
# (shlex/_lex do no ${...} or IFS expansion, so `gh${IFS}api` stays ONE word);
# the respelled reading therefore has three parts, most to least certain:
#   1. the plain regex above, on the command as written;
#   2. the same words on the quote-and-backslash-stripped text, with the
#      separator widened to what a shell turns into whitespace or brace-splits
#      (`${IFS}`, `$IFS`, any `${...}`/`$name`, `{gh,api}`) -- the stripping is
#      what unplain_gh_word() and _MERGE_PROBE_RE already do for `gh pr merge`;
#   3. the words as _lex reads them: a word that IS gh (_is_program(): spelled
#      plainly, a path, or the identity fallback for a renamed/symlinked gh)
#      followed by `api`, or one the shell expands (`$G api`, `$(command -v
#      gh) api`) -- which may be gh -- followed by `api`, or a real gh followed
#      by a subcommand word the shell expands (`gh $S ...`), or any of these
#      inside a quoted string another shell runs (`bash -c '...'`).
# 1-2 and a literal gh in 3 are "gh-api" (recognised, so the founder's literal-
# PR route stays ungated exactly as when plainly spelled); an expanded word in
# 3, or a command _lex cannot read at all, is only "maybe" (a merge surface is
# still checked, but the ungated exemption is not extended to what may not be
# gh api). Residual, named rather than claimed closed: `gh${IFS}pr${IFS}merge`
# is a DIFFERENT surface (ADR 0090's not-seen list; test NOT_SEEN pins it) and
# is not changed by this; and a gh AND an api that are both built by expansion
# (`G=gh; A=api; $G $A -X PUT ...`) are NOT recognised -- the same shape as the
# not-seen `$G p$()r merge` -- since the word after `$G` is `$A`, not `api`.
_GH_API_RESPELLED_RE = re.compile(
    r"(?i)\bgh(?:\s|\$\{[^}]*\}|\$\w+)+api\b|\{\s*gh\s*,\s*api\b")
_MAX_API_READ_DEPTH = 3


def _command_segments(group: list[tuple[str, str]]) -> list[list[tuple[str, str]]]:
    """The simple commands of one _lex word group: split at each operator
    run or parenthesis, a redirection's target word dropped (the same
    segmentation unplain_gh_word() applies to its own groups)."""
    segments: list[list[tuple[str, str]]] = [[]]
    target = False
    for cooked, raw in group:
        if raw and all(c in _OPERATOR_CHARS + "()" for c in raw):
            if set(raw) <= set("<>&") and ("<" in raw or ">" in raw):
                target = True
            else:
                segments.append([])
                target = False
        elif target:
            target = False
        else:
            segments[-1].append((cooked, raw))
    return segments


def _gh_api_reading(command: str, _depth: int = 0) -> str | None:
    """"gh-api" if `command` runs gh's `api` subcommand however it is spelled
    (see the block above), "maybe" if it may or cannot be told, else None."""
    if _GH_API_RE.search(command):
        return "gh-api"
    stripped = re.sub(r"[\"'\\]", "", command)
    if _GH_API_RESPELLED_RE.search(stripped):
        return "gh-api"
    try:
        api_words, api_subs, _tail = _lex(command, 0, None, 0)
        reading: str | None = None
        for group in [api_words, *api_subs]:
            for seg in _command_segments(group):
                for k, (cooked, raw) in enumerate(seg):
                    literal_gh = _is_program(cooked, "gh")
                    expands = not literal_gh and any(c in _EXPANDS for c in raw)
                    if literal_gh or expands:
                        j = _past_flags(seg, k + 1)
                        if j < len(seg):
                            if seg[j][0] == "api":
                                if literal_gh:
                                    return "gh-api"
                                reading = "maybe"
                            elif literal_gh and any(c in _QUOTES_OR_EXPANDS for c in seg[j][1]):
                                reading = "maybe"  # `gh ap$()i`, `gh $S`: a subcommand built by the shell
                    # A quoted string holding a command another shell runs.
                    if (_depth < _MAX_API_READ_DEPTH and raw[:1] in ("'", '"')
                            and any(c.isspace() for c in cooked)):
                        nested = _gh_api_reading(cooked, _depth + 1)
                        if nested == "gh-api":
                            return "gh-api"
                        reading = reading or nested
        return reading
    except Exception:  # noqa: BLE001 -- a reader that fails must not read as "not gh api"
        return "maybe"


def _blank_substitutions(word: str) -> str:
    """`word`, as written, with each `$(...)`, backtick, `<(...)` and `>(...)`
    span replaced by `$_` -- each span's end found by _lex's own reading, so
    quotes and parentheses inside it are read the way the shell reads them.
    What is left is the text that is the word's own, not the text of a
    command the shell runs to build it: `R=$(gh api ...)` leaves `R=$_`,
    while `"$(printf x)/pulls/2/merge"` keeps its `/pulls/2/merge`. Single-
    quoted and backslash-escaped text is literal and is kept as written."""
    out: list[str] = []
    i, n = 0, len(word)
    in_double = False
    while i < n:
        ch = word[i]
        if ch == "\\":
            out.append(word[i:i + 2])
            i += 2
        elif ch == "'" and not in_double:
            j = word.find("'", i + 1)
            j = n - 1 if j < 0 else j
            out.append(word[i:j + 1])
            i = j + 1
        elif ch == '"':
            in_double = not in_double
            out.append(ch)
            i += 1
        elif word.startswith("$(", i) or (not in_double and word.startswith(("<(", ">("), i)):
            _words, _subs, j = _lex(word, i + 2, ")", 1)
            out.append("$_")
            i = j + 1
        elif ch == "`":
            _words, _subs, j = _lex(word, i + 1, "`", 1)
            out.append("$_")
            i = j + 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _merge_call_outside_gh_api(text: str, _depth: int = 0) -> bool:
    """True if some command segment of `text` this reader can see names
    GitHub's REST merge endpoint (`.../pulls/<n>/merge`) without itself being
    the recognised `gh api` call -- the founder's 2026-09-21 answer, verbatim,
    "Bind it to the segment" (see _github_api_merge_reason below).

    Every simple command is read on its own: each top-level segment, each
    segment inside a `$(...)`, backtick or `<(...)` substitution (`_lex`'s
    substitutions), and -- one level per call, bounded by _MAX_API_READ_DEPTH
    -- each quoted string another shell may run (`bash -c '...'`, `$'...'`,
    `a\\ b`) that itself names the endpoint. A segment is read as its own
    words: each substitution span inside a word is replaced by an expanding
    placeholder (_blank_substitutions), and a word still holding whitespace
    after that -- whitespace only quoting could keep, a string another shell
    runs -- is replaced whole. So a `gh api` INSIDE another program's quoted
    argument (`curl -H 'X: gh api' ...`) or inside a substitution (`$(echo gh
    api)`) is not read as that segment BEING gh api, a placeholder in the
    program's own place reads as "maybe", never as gh, and an endpoint built
    around a substitution (`"$(printf ...)/pulls/2/merge"`) is still this
    segment's own. A reader that raises, or a string nested past the depth
    bound, is True: nothing can be bound there, so nothing is exempted.

    Named, not closed (ADR 0090, gate-r6): text the reader drops -- a heredoc
    body, a comment -- has no segment to bind to, so a merge-endpoint
    reference there keeps the whole-command reading it had before this
    (exempt only when a recognised `gh api` appears somewhere in the command,
    refused otherwise); and `gh` and `api` written as plain unquoted
    ARGUMENTS of another program in the same segment (`curl -X PUT <url> gh
    api`) still read as gh api -- this reader recognises gh api by its words,
    not by which word is the program."""
    try:
        words, subs, _tail = _lex(text, 0, None, 0)
        for word_group in (words, *subs):
            for seg in _command_segments(word_group):
                own: list[str] = []
                for cooked, raw in seg:
                    blanked = _blank_substitutions(raw)
                    if any(c.isspace() for c in blanked):
                        own.append("$_")  # a string another shell may run: its own segments decide
                        if cooked != text and _PR_MERGE_ENDPOINT_RE.search(cooked):
                            if _depth >= _MAX_API_READ_DEPTH or _merge_call_outside_gh_api(cooked, _depth + 1):
                                return True
                    else:
                        own.append(blanked)
                own_text = " ".join(own)
                if _PR_MERGE_ENDPOINT_RE.search(own_text) and _gh_api_reading(own_text) != "gh-api":
                    return True
        return False
    except Exception:  # noqa: BLE001 -- a reader that fails must not read as "bound to gh api"
        return True


def _github_api_merge_reason(text: str) -> str | None:
    """Why `text` (a Bash command, or any string an MCP tool's input carries)
    reaches GitHub's merge surface directly, bypassing every gh-pr-merge-
    shaped check in this file; None if it plainly does not.

    gate-r4 CORRECTION (2026-09-19, r4-gate.json round-3-last-call, BLOCKER):
    gate-r3 made this block a literal-PR-number `gh api .../pulls/<n>/merge`
    outright -- but that call, with a literal PR number, is the founder's own
    documented route for an owned PR (ADR 0090:173 founder answer 3; :242
    "stays ungated on purpose"; this module's own docstring above, point 7;
    SKILL.md step 4's Exit 3 branch; the owned-PR block message in
    _check_invocation below), used for real at PRs #261, #297 and #299. This
    hook not matching that ONE shape is not an oversight; it is the point --
    an owned PR's audit code could grade itself, so that path is deliberately
    left to the founder's word instead of anything this hook can check. Gate-r3
    blocked it anyway with no test pinning the exemption and no mention in its
    own ADR section, silently reversing a locked decision (CLAUDE.md 0.1).
    Restored below, narrowly: only `gh api` (not curl/wget/a script/graphql/
    the base Merges endpoint) with a LITERAL decimal PR number stays ungated.
    A non-literal PR number (`pulls/$N/merge`) previously escaped detection
    entirely -- the old regex required `\\d+`, so a shell variable there matched
    NEITHER the (then-unconditional) block NOR anything else, and ran
    completely unaudited (r4-gate.json finding 6, HIGH: `N=2; gh api -X PUT
    .../pulls/$N/merge` and the curl equivalent both exited 0). `gh pr merge`
    itself refuses a non-literal PR (bug 9 above); this now does too, for
    every client, literal-PR-or-not being decided BEFORE the gh-api exemption
    so a non-literal number is refused even when `gh api` is the caller.

    Founder decision, verbatim, 2026-09-21 review-trail round: "Bind it to
    the segment." Named as a residual, not yet code, in ADR 0090's gate-r5
    section ("a `gh api` invocation ANYWHERE in a command exempts a merge
    call made by a DIFFERENT program elsewhere in the same command"):
    `gh api user >/dev/null; curl -X PUT .../pulls/2/merge` exited 0 before
    this fix (the hook's own exit code on that command, measured through
    scripts/test_require_pr_audit.py's harness), because the gh-api reading
    that grants the literal-PR exemption was taken over the WHOLE command.
    The exemption is now granted only when _merge_call_outside_gh_api() finds
    no command segment -- top-level, inside a substitution, or inside a
    quoted string another shell runs -- that names the endpoint without
    itself being the recognised `gh api` call.

    gate-r6 LAST-CALL CORRECTION (2026-09-21): the first cut of this fix ran
    EVERY check per top-level segment, reconstructed from `_lex`'s words --
    and `_lex` skips a heredoc body and a comment, so every surface written
    there vanished: `bash <<'EOF'` around a base-repo Merges API POST, a
    GraphQL `enablePullRequestAutoMerge`, a non-literal-PR merge or a plain
    curl to the merge endpoint each exited 0, where the whole-command reading
    before it refused all four (and a non-Bash tool whose input held a `<<`
    lost everything after it the same way). The refusals are therefore read
    over the whole text again, exactly as before the fix and now over EVERY
    merge-endpoint reference rather than only the first; only the literal-PR
    exemption is narrowed, so this can refuse more than before, never less.
    A base Merges or GraphQL merge surface is refused before the exemption is
    considered at all, so a literal-PR `gh api` merge in the same command no
    longer returns early past it."""
    merge_calls = list(_PR_MERGE_ENDPOINT_RE.finditer(text))
    base_merges = _BASE_MERGES_ENDPOINT_RE.search(text)
    graphql_merge = re.search(r"(?i)\bgraphql\b", text) and _GRAPHQL_MERGE_MUTATION_RE.search(text)
    if not (merge_calls or base_merges or graphql_merge):
        return None  # names no merge surface at all: nothing below can matter
    # gate-r4 closure (2026-09-19): the gh reading is _gh_api_reading(), not the
    # bare literal-substring regex, so a respelled `gh api` reaches the checks
    # below exactly as a plain one does. Only a merge surface named above ever
    # pays for the word-by-word reading.
    gh_api = _gh_api_reading(text)
    if not (_GITHUB_API_HOST_RE.search(text) or gh_api):
        return None
    unsure = ("" if gh_api != "maybe" else
              " (through a `gh api` this hook cannot confirm is gh: an expanded or unreadable word)")
    for m in merge_calls:
        pr_token = m.group(1)
        if not pr_token.isdigit():
            return (f"calls GitHub's REST merge endpoint with a non-literal PR number "
                    f"({pr_token!r}) -- gh pr merge refuses a non-literal PR the same way{unsure}")
    if base_merges:
        return ("calls GitHub's base-repo Merges API directly -- no PR is involved, so there "
                f"is nothing to pin a marker or an ownership check to{unsure}")
    if merge_calls and not graphql_merge:
        if gh_api == "gh-api" and not _merge_call_outside_gh_api(text):
            return None  # ADR 0090: gh api with a literal PR number is the founder's
            # SHA-pinned owned-PR merge route, ungated on purpose -- bound, since
            # 2026-09-21, to the segment that makes the call ("Bind it to the segment").
        return f"calls GitHub's REST merge endpoint for a pull request directly{unsure}"
    return f"runs a GraphQL mutation that merges a PR or arms auto-merge{unsure}"


# gate-r8 (3), the founder's round-6 answer: a heredoc body line that names
# `git push` after another word, and `echo git push origin HEAD`, are refused
# -- accepted as the cost of refusing an unrecognised shape -- and such text
# goes through a file with -F. Every push refusal says so.
PUSH_TEXT_HINT = (
    " If this command only carries text that names a push, it is refused too: a "
    "heredoc body line naming `git push` after another word, or `echo git push "
    "origin HEAD`, reads as a push here. Write that text to a file and pass it "
    "with -F <file> (`git commit -F`, `gh pr create -F`)."
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


def _mcp_merge_tool(name: str) -> bool:
    """True for an MCP tool whose name says it merges a PR or arms
    auto-merge. gate-r3 path-mcp-lowercase-collapse (2026-09-19): the
    word-splitter needs a case TRANSITION to separate words, so an
    all-lowercase joined name ("mergepr", "automergepr") was one token
    matching neither "merge" nor a companion word -- CONFIRMED:
    _mcp_merge_tool("mcp__github__mergepr") was False. Now also checked as a
    lowercased SUBSTRING, which catches that without an allowlist. Residual,
    NOT closed by this (ADR 0090's not-seen list, path-mcp-bare-merge-word): a
    bare "merge" with no companion word at all ("merge_now") still is not
    caught -- treating "merge" alone as enough would also block
    mcp__c96b062f__merge_branch, a real, unrelated Supabase DB-branch-merge
    tool this session can call, and no allowlist of "known safe" merge-shaped
    tool names can stay complete as new tools appear."""
    if not name.startswith("mcp__"):
        return False
    lname = name.lower()
    if "automerge" in lname:
        return True
    words = {w.lower() for w in re.findall(r"[A-Z]?[a-z]+|[0-9]+", name)}
    if "merge" in words and bool(words & _MCP_MERGE_WORDS):
        return True
    return "merge" in lname and any(w in lname for w in _MCP_MERGE_WORDS)


def _tool_input_text(value, _depth: int = 0) -> str:
    """Every string value inside a tool_input payload, concatenated, so a
    command-shaped string is found regardless of which key holds it
    (`command`, `script`, `code`, ...) or which tool carries it. Bounded
    depth: a tool input is a small JSON object, not attacker-supplied
    recursion fuel."""
    if _depth > 10:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n".join(_tool_input_text(v, _depth + 1) for v in value.values())
    if isinstance(value, list):
        return "\n".join(_tool_input_text(v, _depth + 1) for v in value)
    return ""


def _tokens(command: str) -> list[str]:
    """The command as the shell would split it: quotes removed, backslashes
    applied, and each run of ( ) ; < > | & newline or backtick its own token.
    Raises ValueError on an unclosed quote."""
    lex = shlex.shlex(command, posix=True, punctuation_chars=_SHELL_PUNCTUATION)
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    return list(lex)


def _is_punctuation(tok: str) -> bool:
    return bool(tok) and all(c in _SHELL_PUNCTUATION for c in tok)


def _program_realpath(name: str) -> str | None:
    """The real, symlink-resolved file `name` would run as -- a PATH lookup
    for a bare name (the same lookup the shell itself performs), or the name
    directly if it holds a path separator. None if it cannot be found."""
    try:
        found = shutil.which(name)
        return os.path.realpath(found) if found else None
    except OSError:
        return None


# CONFIRMED BY EXECUTION (gate-r3 adversarial round, 2026-09-19,
# shell-renamed-gh-direct-merge / shell-renamed-git-direct-push): every check
# in this file recognised `gh`/`git` by the literal word only (or a path
# ending in `/gh`/`/git`). A symlink `octocli -> $(which gh)`, invoked as
# `octocli`, by its full path, or wrapped in `nohup`, was invisible to all of
# them -- merge_invocations() built zero invocations and DIRECT_PUSH_PATTERN
# never matched, so a `gh pr merge` or `git push origin main` run this way
# passed unchecked. _is_program() adds an identity fallback: a word that is
# not spelled `gh`/`git` at all is still treated as one when it resolves, via
# PATH, to the SAME file this hook would itself invoke as `gh`/`git`.
# Deliberately cached (not re-`which`'d per word): PATH does not change within
# one hook invocation, and a command can hold many candidate words.
#
# Residual, stated plainly rather than claimed closed: this catches a rename
# or symlink ON PATH, never an INDEPENDENTLY BUILT OR COPIED binary with the
# same behaviour but a different inode (demonstrated with a `shutil.copy2`
# clone named `reviewtool` -- different realpath, so `_is_program` correctly
# returns False for it). A lexical hook cannot execute a candidate to compare
# behaviour against the real `gh`/`git`; ADR 0090's residual list names this
# rather than claiming it closed. See scripts/test_require_pr_audit.py's
# gate-r3 cases for both the closed (symlink) and residual (copy) shapes.
_REALPATH_CACHE: dict[str, str | None] = {}


def _cached_realpath(name: str) -> str | None:
    if name not in _REALPATH_CACHE:
        _REALPATH_CACHE[name] = _program_realpath(name)
    return _REALPATH_CACHE[name]


def _is_program(word: str, canonical: str) -> bool:
    """True if `word` (quotes/backslashes already stripped by the caller) IS
    the program `canonical` ("gh" or "git"): spelled plainly, a path ending in
    /<canonical>, or -- the identity fallback above -- resolving on PATH to
    the exact file `canonical` itself would resolve to.

    gate-r8 last call, under the rule above: zsh, the shell the Bash tool runs
    here, expands a command word `=name` to the path `name` resolves to on
    PATH, so `=git` IS git. Unread, `=git push origin HEAD` was allowed;
    measured moving a bare origin's main under zsh."""
    if len(word) > 1 and word.startswith("="):
        word = word[1:]
    lw = word.lower()
    if lw == canonical or lw.endswith("/" + canonical):
        return True
    if not word or word.startswith("-"):
        return False
    real = _cached_realpath(canonical)
    return bool(real) and _cached_realpath(word) == real


def merge_invocations(command: str) -> tuple[list[list[str]], str | None]:
    """(the argument list of every `pr [flags] merge` in the command, a problem).

    The arguments are every token after `pr`, minus `merge` itself, up to the
    end of that simple command. The problem is set when the command holds a
    `pr merge` that could not be placed as its own invocation: an unclosed
    quote, or one inside `bash -c "..."`, `eval '...'`, a comment, or anything
    else a tokenizer cannot see through. Either way the caller blocks."""
    stripped = re.sub(r"[\"'\\]", "", command)
    probe = _MERGE_PROBE_RE.findall(stripped)
    if not probe and not _PLAIN_PR_MERGE_RE.search(stripped):
        return [], None
    try:
        toks = _tokens(command)
    except ValueError as exc:
        return [], f"the command cannot be tokenized ({exc})"
    segments: list[list[str]] = [[]]
    target = False
    for tok in toks:
        if _is_punctuation(tok) and ("<" in tok or ">" in tok) and set(tok) <= set("<>&"):
            # A redirection: its target is the next word, and the command goes on
            # after it (a flag after `>/dev/null` still reaches gh).
            if segments[-1] and segments[-1][-1].isdigit():
                segments[-1].pop()  # the file descriptor of `2>&1`
            target = True
        elif _is_punctuation(tok):
            segments.append([])
            target = False
        elif target:
            target = False
        else:
            segments[-1].append(tok)
    found: list[list[str]] = []
    for seg in segments:
        for i, tok in enumerate(seg):
            if tok.lower() != "pr":
                continue
            j = i + 1
            while j < len(seg) and seg[j].startswith("-"):
                j += 2 if seg[j] in ("-R", "--repo") else 1
            if j < len(seg) and seg[j].lower() == "merge":
                if any(t in ("-R", "--repo") or t.startswith("--repo=") for t in seg[:i]):
                    return found, "a repository flag before `pr` points gh somewhere this hook does not check"
                # gate-r3 shell-renamed-gh-direct-merge: `pr merge` is only a gh
                # invocation if SOME word running it actually IS gh -- literally,
                # or by the identity fallback (a renamed/symlinked binary
                # resolving to the same file). Without this, `curl` or prose
                # sharing a segment with a stray "pr merge" would count too.
                # ANY earlier word, not just the first: a wrapper (`sudo gh pr
                # merge`, `nohup octocli pr merge` -- the ADR's own "Checked"
                # list names sudo/env/time as supported wrappers) sits before
                # the real program.
                before = [t for t in seg[:i] if not t.startswith("-")]
                if before and not any(_is_program(t, "gh") for t in before):
                    continue
                found.append(seg[i + 1:j] + seg[j + 1:])
    if len(found) < len(probe):
        return found, (f"the command holds {len(probe)} `pr merge` but only {len(found)} "
                       "can be read as a command of its own (one sits inside quotes, "
                       "`bash -c`, `eval`, a comment or similar)")
    return found, None


def parse_merge_args(args: list[str]) -> tuple[str | None, str | None, str | None]:
    """(PR number, --match-head-commit value, problem) for one invocation's
    arguments, as gh's flag parser would read them. A problem means the
    invocation cannot be checked: no literal PR number (a variable, `$(...)`,
    a branch name, none at all), more than one, an unknown flag, the pin given
    other than once as its own argument, or another repository."""
    positional: list[str] = []
    pins: list[str] = []
    i = 0
    while i < len(args):
        tok = args[i]
        if tok == "--":
            positional += args[i + 1:]
            break
        if tok.startswith("-") and tok != "-":
            name, eq, value = tok.partition("=")
            if name in _VALUE_FLAGS:
                if not eq:
                    if i + 1 >= len(args):
                        return None, None, f"{name} has no value"
                    value = args[i + 1]
                    i += 1
                if name == "--match-head-commit":
                    pins.append(value)
                elif name in ("-R", "--repo") and value.lower() != REPO.lower():
                    return None, None, f"{name} {value!r} is not {REPO}"
            elif tok not in _BOOL_FLAGS:
                return None, None, f"unknown flag {tok!r}"
        else:
            positional.append(tok)
        i += 1
    if len(positional) != 1:
        return None, None, f"{len(positional)} positional arguments {positional[:3]!r}, not one PR number"
    arg = positional[0]
    m = _PR_URL_RE.fullmatch(arg)
    if m:
        if m.group(1).lower() != REPO.lower():
            return None, None, f"{arg!r} is not a pull request of {REPO}"
        number = m.group(2)
    elif re.fullmatch(r"#?[0-9]+", arg):
        number = arg.lstrip("#")
    else:
        return None, None, f"{arg!r} is not a literal PR number or pull-request URL"
    if len(pins) > 1:
        return number, None, "--match-head-commit is given more than once"
    return number, (pins[0] if pins else None), None


# 2026-09-18, confirm round: a `pr` subcommand spelled with shell quoting or
# expansion ($'merge', $"merge", mer$()ge, mer${ZZ}ge, {merge,}, mer[g]e) is
# `merge` to the shell, and _MERGE_PROBE_RE never counted it (measured: each
# exit 0 against an owned PR). The hook does not try to evaluate the shell.
# unplain_gh_word() refuses the spelling instead, in two readings:
#   - the command's words as written, quoting kept, including inside $(...),
#     backticks and <(...): the word after a literal gh must hold no quoting or
#     expansion character and must not be `alias set`/`alias import`, the word
#     after its `pr` must be plain (letters, digits, hyphens), and a `pr` after
#     a word the shell expands ($G, $(which gh), a glob) is refused outright;
#   - the text with quotes and backslashes stripped, as _MERGE_PROBE_RE reads
#     it, so a string another shell runs (`bash -c "..."`, `eval`, a heredoc
#     fed to a shell) is seen too: `pr` then a word holding an expansion
#     character.
_PLAIN_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
# Characters that make the shell rewrite a word: quoting and expansion
# (parameter, command, brace, tilde, glob, history, zsh's `=cmd`).
_QUOTES_OR_EXPANDS = frozenset("$`{}[]*?!'\"\\()~=")
# A word that could become `gh` once the shell expands it: a variable, a
# substitution, a glob, a brace or tilde expansion, zsh's `=cmd`.
_EXPANDS = frozenset("$`*?[{~=!")
# Only a command that names gh or pr (once quotes and backslashes are stripped)
# is read word by word; nothing else pays for it.
_GH_OR_PR_RE = re.compile(r"(?i)\b(?:gh|pr)\b")
# pr's own flags in the stripped text: -R/--repo takes a value, any other flag
# none (so `pr -R "$REPO" view` is not read as `pr` then `$REPO`).
_PR_FLAGS = r"(?:\s+(?:-R|--repo)(?:\s+|=)\S+|\s+(?!(?:-R|--repo)(?:[\s=]|$))-{1,2}\S+)*"
# The expansion character must lead into more of the word ($m, {m, [g, ${, $(),
# so prose punctuation after a word (`gh pr checks`, "**gh pr merge**", "merge?")
# is not read as one. Backticks and parentheses are left to the word reading:
# in prose they are markdown and brackets far more often than code.
_UNPLAIN_PROBE_RE = re.compile(
    rf"(?i)(?:\bgh\b|\$\S*|[)`]){_PR_FLAGS}\s+pr{_PR_FLAGS}\s+(?!-)"
    r"(\S*[$*?!\[\]{}](?=[A-Za-z0-9_${(\[])\S*)")
_OPERATOR_CHARS = ";&|<>\n"
_MAX_NESTING = 20

# ANSI-C quoting, `$'...'`: the escapes bash and zsh decode.
_ANSI_C_NAMED = {"a": "\a", "b": "\b", "e": "\x1b", "E": "\x1b", "f": "\f", "n": "\n",
                 "r": "\r", "t": "\t", "v": "\v", "\\": "\\", "'": "'", '"': '"', "?": "?"}
_ANSI_C_ESCAPE_RE = re.compile(
    r"\\(?:([0-7]{1,3})|x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8})|c(.)|(.))", re.S)


def _ansi_c(body: str) -> str:
    """The text the shell makes of a `$'...'` body. gate-r8 last call:
    `_lex()` dropped the backslash of every escape, so `$'\\x6dain'` read as
    `x6dain`; with shlex unable to close `$'\\''` later in the command, `git
    push origin $'\\x6dain'` was allowed as a push to `x6dain`, and `$'\\x67it'
    push origin HEAD` as a program `x67it`; each measured moving a bare
    origin's main. An escape neither shell knows keeps its backslash in bash
    (`$'\\git'` is `\\git`) and loses it in zsh, the Bash tool's shell here,
    where `$'\\git'` is git: it is read as zsh reads it, since a word that
    keeps a backslash never spells one this hook looks for."""
    def decode(m: "re.Match[str]") -> str:
        octal, hex2, hex4, hex8, control, other = m.groups()
        if octal is not None:
            return chr(int(octal, 8) & 0xFF)
        if hex2 is not None:
            return chr(int(hex2, 16))
        if hex4 is not None or hex8 is not None:
            point = int(hex4 or hex8, 16)
            return chr(point) if point <= 0x10FFFF else m.group(0)
        if control is not None:
            return chr(ord(control) & 0x1F)
        return _ANSI_C_NAMED.get(other, other)
    return _ANSI_C_ESCAPE_RE.sub(decode, body).split("\0", 1)[0]  # bash ends the string at a NUL


def _program_name(word: str) -> str:
    """The name a command word runs, as this hook compares it with its program
    lists: the basename, lowercased. gate-r8 last call, completed: zsh, the
    shell the Bash tool runs here, expands a command word `=name` to the path
    `name` resolves to, so `=bash` IS bash wherever the lists are read, as
    `_is_program()` already reads `=git` as git. Read as the word `=bash`,
    `=bash -c '<push>'`, `=sh -c '<push>'` and `=python3 -c '...<push>...'`
    ran their strings unread; each measured moving a bare origin's main under
    zsh."""
    return os.path.basename(word[1:] if len(word) > 1 and word.startswith("=") else word).lower()


# gate-r8 last call, completed: which heredoc bodies a shell runs. A body is
# that shell's script when a shell is named in the pipeline holding the
# heredoc, widened through every group -- `( ... )`, `{ ...; }`, `if`/`while`/
# `until`/`for`/`select`/`case` -- and every substitution that holds it.
_GROUP_OPENERS = frozenset({"{", "if", "while", "until", "for", "select", "case"})
_GROUP_CLOSERS = frozenset({"}", "fi", "done", "esac"})
# Words after which the next word starts a command.
_COMMAND_LEADERS = frozenset({"{", "then", "do", "else", "elif", "!", "if", "while", "until", "time"})


def _is_operator_word(raw: str) -> bool:
    return bool(raw) and all(c in _OPERATOR_CHARS + "()" for c in raw)


def _is_redirection_word(raw: str) -> bool:
    """A redirection operator (`<<`, `>`, `2>&1`'s `>&`): part of its command."""
    return _is_operator_word(raw) and set(raw) <= set("<>&") and ("<" in raw or ">" in raw)


def _is_pipe_word(raw: str) -> bool:
    """`|` or `|&`, also when the line ends right after it (`|` then a
    newline): bash reads the next command, past a heredoc body, as the
    pipeline's next stage."""
    return _is_operator_word(raw) and raw.rstrip("\n") in ("|", "|&")


def _starts_command(words: list[tuple[str, str]], k: int) -> bool:
    """True when `words[k]` stands where the shell reads a command word."""
    if k == 0:
        return True
    cooked, raw = words[k - 1]
    if _is_operator_word(raw):
        return not _is_redirection_word(raw)
    return raw == cooked and cooked in _COMMAND_LEADERS


def _opens_group(words: list[tuple[str, str]], k: int) -> bool:
    cooked, raw = words[k]
    return raw == "(" or (raw == cooked and cooked in _GROUP_OPENERS and _starts_command(words, k))


def _closes_group(words: list[tuple[str, str]], k: int) -> bool:
    cooked, raw = words[k]
    return raw == ")" or (raw == cooked and cooked in _GROUP_CLOSERS and _starts_command(words, k))


def _pipeline_around(words: list[tuple[str, str]], first: int, last: int) -> tuple[int, int]:
    """(lo, hi) for the pipeline holding `words[first..last]` (one element of
    it: the word a heredoc's delimiter is, or a whole group). It ends at any
    operator but a pipe or a redirection -- a newline right after a pipe does
    not end it -- or at the group that holds it."""
    lo, depth, j = first, 0, first - 1
    while j >= 0:
        raw = words[j][1]
        if _closes_group(words, j):
            depth += 1
        elif _opens_group(words, j):
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and _is_operator_word(raw) and not (_is_redirection_word(raw) or _is_pipe_word(raw)):
            if not (set(raw) == {"\n"} and j > 0 and _is_pipe_word(words[j - 1][1])):
                break
        lo = j
        j -= 1
    hi, depth, j, after_pipe = last, 0, last + 1, False
    while j < len(words):
        raw = words[j][1]
        if _opens_group(words, j):
            depth += 1
        elif _closes_group(words, j):
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and _is_operator_word(raw) and not _is_redirection_word(raw):
            if _is_pipe_word(raw):
                after_pipe = True
            elif not (after_pipe and set(raw) == {"\n"}):
                break
        elif depth == 0 and not _is_operator_word(raw):
            after_pipe = False
        hi = j
        j += 1
    return lo, hi


def _group_opener(words: list[tuple[str, str]], first: int) -> int | None:
    """The index of the word that opens the group holding `words[first]`,
    past any separator (`if true; then cat <<'EOF'`)."""
    depth = 0
    for j in range(first - 1, -1, -1):
        if _closes_group(words, j):
            depth += 1
        elif _opens_group(words, j):
            if depth == 0:
                return j
            depth -= 1
    return None


def _group_closer(words: list[tuple[str, str]], opener: int) -> int | None:
    """The index of the word that closes the group `words[opener]` opens."""
    depth = 0
    for j in range(opener + 1, len(words)):
        if _opens_group(words, j):
            depth += 1
        elif _closes_group(words, j):
            if depth == 0:
                return j
            depth -= 1
    return None


def _runs_as_command(words: list[tuple[str, str]], k: int) -> bool:
    """True when `words[k]` is a command word: at a command's start, or past
    only same-command assignments and named wrappers."""
    j = k
    while j > 0:
        cooked, raw = words[j - 1]
        if _is_operator_word(raw) or not (_SIMPLE_ASSIGNMENT_RE.match(cooked)
                                          or _program_name(cooked) in _PUSH_WRAPPER_PROGRAMS):
            break
        j -= 1
    return _starts_command(words, j)


def _names_script_runner(words: list[tuple[str, str]], k: int) -> bool:
    """True when `words[k]` may run a heredoc body as a script: a shell named
    anywhere in the pipeline (`sudo bash`, `/bin/sh`, `bash5.2`, zsh's
    `=bash`), `.` or `source` as the command, or a command word built from an
    expansion this reading does not resolve (`$_ <<'EOF'`, `"$SHELL" <<'EOF'`)."""
    cooked, raw = words[k]
    if _is_operator_word(raw):
        return False
    name = _program_name(cooked)
    if re.sub(r"[0-9.]+$", "", name) in _PUSH_SHELL_PROGRAMS:
        return True
    if name in _SCRIPT_RUNNERS:  # `.` or `source`, as the command only: not `git -C . commit -F - <<'EOF'`
        return _runs_as_command(words, k)
    if re.search(r"[$`]", cooked):
        return _runs_as_command(words, k)
    return False


def _without_case_patterns(words: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """`words` with each `case` pattern's closing parenthesis (`a)`) read as a
    plain word, so it closes no group: read as a group's, `case a
    in a) cat <<'EOF' ... ;; esac | bash` paired the pattern's `)` with
    nothing and its body was not a script (measured moving a bare origin's
    main)."""
    out = list(words)
    states: list[str] = []  # per open `case`: "head", "pattern" or "body"
    for k, (cooked, raw) in enumerate(words):
        if raw == cooked == "case" and _starts_command(words, k):
            states.append("head")
        elif not states:
            continue
        elif states[-1] == "head" and raw == cooked == "in":
            states[-1] = "pattern"
        elif states[-1] == "pattern" and raw == cooked == "esac":
            states.pop()
        elif states[-1] == "pattern" and raw == ")":
            out[k] = ("case-pattern)", "case-pattern)")
            states[-1] = "body"
        elif states[-1] == "body" and _is_operator_word(raw) and re.search(r";;|;&", raw):
            states[-1] = "pattern"
        elif states[-1] == "body" and raw == cooked == "esac" and _starts_command(words, k):
            states.pop()
    return out


def _heredoc_runs_as_script(words: list[tuple[str, str]], at: int) -> bool:
    """gate-r8 last call: True when the pipeline holding `words[at]` (a heredoc
    delimiter, or a word holding the substitution a heredoc is in) names a
    shell, so the body is that shell's script: `bash <<'EOF'`, `cat <<'EOF' |
    sh`, `cat <<'EOF' |` with `bash` after the body, `( cat <<'EOF' ... ) |
    bash`, `bash <(cat <<'EOF' ...)`. The pipeline ends at any operator but a
    pipe or a redirection, so `bash check.sh && cat > msg.txt <<'EOF'` keeps
    its body text (the transcript replay found one such commit message)."""
    words = _without_case_patterns(words)
    first = last = at
    while True:
        lo, hi = _pipeline_around(words, first, last)
        if any(_names_script_runner(words, k) for k in range(lo, hi + 1) if not first <= k <= last):
            return True
        opener = _group_opener(words, first)
        closer = None if opener is None else _group_closer(words, opener)
        if closer is None:
            return False
        first, last = opener, closer


def _lex(s: str, i: int, closer: str | None, depth: int, report: dict | None = None):
    """(words, substitutions, end) for the command text in `s` from `i` up to
    `closer` (an unmatched `)` or a backtick; None reads to the end).

    Each word is (its text once quotes and backslashes are removed, its text as
    written). A run of ; & | < > or newline, and each ( and ), is a word of its
    own. $(...), `...`, <(...) and >(...) stay inside their word; the words
    inside each come back in `substitutions`, nested ones flattened. A comment
    and a heredoc body are skipped, and a file descriptor before a redirection
    (the 2 of 2>&1) is dropped. Lenient: an unclosed quote runs to the end (the
    shell refuses such a command outright). Raises ValueError only past
    _MAX_NESTING levels of substitution.

    gate-r8: `report`, when given, is how the push check's unreadable-word
    fallback learns what this lenient reading glossed over: "open" when a
    quote, substitution, `${` or in-word parenthesis runs to the end
    unclosed; "misread" when a `${...}` or in-word parenthesis holds quoting
    this reader does not follow the way the shell does (the shell reads
    `echo ${X:-"}"}` as one word; this reader ends it at the first `}`, and a
    push on the next line was hidden from it, measured moving a bare origin's
    main); "bodies", every heredoc body it skipped, delimiter line included;
    [gate-r8 last call] "scripts", the bodies a shell runs
    (`_heredoc_runs_as_script()`, decided once every word of the level holding
    the heredoc is read, and again at each level holding that one, since a
    shell after the body or around a group or substitution runs it too), and
    "expanding", the bodies under an unquoted delimiter."""
    if depth > _MAX_NESTING:
        raise ValueError(f"substitutions nested more than {_MAX_NESTING} deep")

    def note(key: str, what: str) -> None:
        if report is not None:
            report.setdefault(key, what)
    n = len(s)
    words: list[tuple[str, str]] = []
    subs: list[list[tuple[str, str]]] = []
    heredocs: list[tuple[str, bool, bool, int]] = []  # (delimiter, strip tabs, quoted, its index in words)
    pending: list[tuple[int, str]] = []  # (the word a body belongs to, the body): script or not, decided in settle()
    delim_strip: bool | None = None  # set after << : the next word is a heredoc delimiter
    cooked: list[str] = []
    raw: list[str] = []
    parens = 0

    def settle() -> None:
        """Now that every word of this level is read: each pending body a shell
        in its pipeline runs is a script; the rest go up to the level holding
        this one, as bodies of the word this level is part of."""
        if report is None:
            return
        for at, body in pending:
            if _heredoc_runs_as_script(words, at):
                report.setdefault("scripts", []).append(body)
            else:
                report.setdefault("carried", []).append(body)
        pending.clear()

    def nested_lex(body: int, close: str, rep: dict | None):
        """`_lex()` one level down, from `body` up to `close`, reporting to
        `rep`; the bodies it carries up belong to the word being read now."""
        mark = len(rep.setdefault("carried", [])) if rep is not None else 0
        inner, nested, j = _lex(s, body, close, depth + 1, rep)
        if rep is not None:
            pending.extend((len(words), carried) for carried in rep["carried"][mark:])
            del rep["carried"][mark:]
        return inner, nested, j

    def end_word() -> None:
        nonlocal delim_strip
        if raw:
            words.append(("".join(cooked), "".join(raw)))
            if delim_strip is not None:
                heredocs.append(("".join(cooked), delim_strip, bool(re.search(r"[\"'\\]", "".join(raw))),
                                 len(words) - 1))
                delim_strip = None
        cooked.clear()
        raw.clear()

    def substitution(start: int, body: int, close: str) -> int:
        """Read $(...), `...` or <(...) starting at `start` (its body at `body`)
        into the current word; return the index after it."""
        inner, nested, j = nested_lex(body, close, report)
        if j >= n:
            note("open", "a substitution runs to the end unclosed")
        subs.append(inner)
        subs.extend(nested)
        cooked.append(s[start:j + 1])
        raw.append(s[start:j + 1])
        return j + 1

    while i < n:
        ch = s[i]
        if ch == closer and (closer == "`" or parens == 0):
            end_word()
            settle()
            return words, subs, i
        if ch in " \t\r":
            end_word()
            i += 1
        elif ch == "#" and not raw:
            j = s.find("\n", i)
            i = n if j < 0 else j
        elif ch == "\\":
            if s.startswith("\n", i + 1):
                i += 2
                continue
            cooked.append(s[i + 1:i + 2])
            raw.append(s[i:i + 2])
            i += 2
        elif ch == "'" or s.startswith("$'", i):
            # '...' is literal; $'...' is ANSI-C quoting, where a backslash escapes.
            j = i + 1 if ch == "'" else i + 2
            while j < n and s[j] != "'":
                j += 2 if ch == "$" and s[j] == "\\" else 1
            if j >= n:
                note("open", "a quote runs to the end unclosed")
            body = s[(i + 1 if ch == "'" else i + 2):j]
            cooked.append(body if ch == "'" else _ansi_c(body))
            raw.append(s[i:j + 1])
            i = j + 1
        elif ch == '"' or s.startswith('$"', i):
            start = i
            i += 1 if ch == '"' else 2
            text: list[str] = []
            while i < n and s[i] != '"':
                if s[i] == "\\" and i + 1 < n:
                    text.append(s[i + 1] if s[i + 1] in '$`"\\\n' else s[i:i + 2])
                    i += 2
                elif s.startswith("$(", i) or s[i] == "`":
                    body = i + 2 if s[i] == "$" else i + 1
                    inner, nested, j = nested_lex(body, ")" if s[i] == "$" else "`", report)
                    subs.append(inner)
                    subs.extend(nested)
                    text.append(s[i:j + 1])
                    i = j + 1
                else:
                    text.append(s[i])
                    i += 1
            if i >= n:
                note("open", "a quote runs to the end unclosed")
            cooked.append("".join(text))
            raw.append(s[start:i + 1])
            i += 1
        elif s.startswith("$(", i):
            i = substitution(i, i + 2, ")")
        elif ch == "`":
            i = substitution(i, i + 1, "`")
        elif ch in "<>" and s.startswith("(", i + 1):
            end_word()
            i = substitution(i, i + 2, ")")
        elif s.startswith("${", i):
            j = s.find("}", i)
            if j < 0:
                note("open", "a `${` runs to the end unclosed")
            elif re.search(r"[\"'`{]|\$\(", s[i + 2:j]):
                note("misread", "quoting, a brace or a substitution inside `${...}`")
            j = n if j < 0 else j
            cooked.append(s[i:j + 1])
            raw.append(s[i:j + 1])
            i = j + 1
        elif ch == "(" and raw:
            # Inside a word (zsh glob grouping, `f()`, `a=(...)`): part of the word.
            level, j = 0, i
            while j < n:
                level += {"(": 1, ")": -1}.get(s[j], 0)
                if level == 0:
                    break
                j += 1
            if j >= n:
                note("open", "a parenthesis inside a word runs to the end unclosed")
            elif re.search(r"[\"'`\\]", s[i:j + 1]):
                note("misread", "quoting inside a parenthesis within a word")
            cooked.append(s[i:j + 1])
            raw.append(s[i:j + 1])
            i = j + 1
        elif ch in "()":
            end_word()
            words.append((ch, ch))
            parens = parens + 1 if ch == "(" else max(0, parens - 1)
            i += 1
        elif ch in _OPERATOR_CHARS:
            if ch in "<>" and raw and "".join(raw).isdigit():
                cooked.clear()  # the file descriptor of 2>&1: not a word
                raw.clear()
            end_word()
            j = i
            while j < n and s[j] in _OPERATOR_CHARS:
                j += 1
                if s[j - 1] == "\n" and heredocs:
                    break
            run = s[i:j]
            words.append((run, run))
            i = j
            if run.endswith("<<") and not run.endswith("<<<"):
                delim_strip = s.startswith("-", i)
                i += delim_strip
            if run.endswith("\n") and heredocs:
                for delim, strip, quoted, at in heredocs:  # skip each body, up to its delimiter line
                    body_start = i
                    while i < n:
                        j = s.find("\n", i)
                        line = s[i:] if j < 0 else s[i:j]
                        i = n if j < 0 else j + 1
                        if (line.lstrip("\t") if strip else line) == delim:
                            break
                    if report is not None:
                        report.setdefault("bodies", []).append(s[body_start:i])
                    if report is not None:
                        pending.append((at, s[body_start:i]))
                    if report is not None and not quoted:
                        report.setdefault("expanding", []).append(s[body_start:i])
                heredocs.clear()
        else:
            cooked.append(ch)
            raw.append(ch)
            i += 1
    end_word()
    settle()
    return words, subs, n


def _past_flags(seg: list[tuple[str, str]], j: int) -> int:
    while j < len(seg) and seg[j][0].startswith("-") and seg[j][0] != "-":
        j += 2 if seg[j][0] in ("-R", "--repo") else 1
    return j


def _unplain(word: str, after: str) -> str:
    return (f"the word `{word}` after `{after}` is not written plainly: quoting or shell "
            "expansion there can make it `merge` without this hook seeing a merge")


def unplain_gh_word(command: str) -> str | None:
    """Why a `gh ... pr` in the command cannot be checked as written, or None.

    Words, in every simple command including inside substitutions: after a
    literal `gh` (quotes and backslashes removed; also a path ending in /gh),
    the next word that is not a flag must hold no quoting or expansion
    character and must not be `alias set` or `alias import` (an alias runs a
    merge under another name); when it is `pr`, the next word that is not a
    flag must be plain. A `pr` after a word the shell expands (a variable, a
    substitution, a glob, a brace) is refused outright: the hook cannot tell
    that word is gh. Then the stripped text, which also covers strings another
    shell runs and heredoc bodies: `gh`, a variable or a closing substitution,
    `pr`, and a word in which an expansion character leads into more of it.
    Not seen: a gh and a pr both built by expansion (`$G p$()r merge`), or a gh
    or pr built by expansion inside a string another shell runs. ADR 0090's
    residual list names both."""
    stripped = re.sub(r"[\"'\\]", "", command)
    if not _GH_OR_PR_RE.search(stripped):
        return None
    try:
        words, subs, _end = _lex(command, 0, None, 0)
    except ValueError as exc:
        return f"the command cannot be read word by word ({exc})"
    for group in (words, *subs):
        segments: list[list[tuple[str, str]]] = [[]]
        target = False
        for cooked, raw in group:
            if raw and all(c in _OPERATOR_CHARS + "()" for c in raw):
                if set(raw) <= set("<>&") and ("<" in raw or ">" in raw):
                    target = True  # a redirection: the next word is its target
                else:
                    segments.append([])
                    target = False
            elif target:
                target = False
            else:
                segments[-1].append((cooked, raw))
        for seg in segments:
            for k, (cooked, raw) in enumerate(seg):
                literal_gh = _is_program(cooked, "gh")
                expands = not literal_gh and any(c in _EXPANDS for c in raw)
                if not literal_gh and not expands:
                    continue
                j = _past_flags(seg, k + 1)
                if j >= len(seg):
                    continue
                if expands:
                    if seg[j][0] == "pr":  # gh's command names are case-sensitive (`gh PR`: unknown command)
                        return (f"`{raw}` before `pr` is expanded by the shell, so this hook "
                                "cannot tell whether it is gh")
                    continue
                if any(c in _QUOTES_OR_EXPANDS for c in seg[j][1]):
                    return _unplain(seg[j][1], raw)
                m = _past_flags(seg, j + 1)
                if seg[j][0] == "alias" and m < len(seg) and seg[m][0] in ("set", "import"):
                    return (f"`{raw} alias {seg[m][0]}` defines a gh command this hook never "
                            "sees run, since it can stand for a merge")
                if seg[j][0].lower() == "pr" and m < len(seg) and not _PLAIN_WORD_RE.fullmatch(seg[m][1]):
                    return _unplain(seg[m][1], f"{raw} {seg[j][1]}")
    probe = _UNPLAIN_PROBE_RE.search(stripped)
    if probe:
        return _unplain(probe.group(1), "pr") + " (read with quotes and backslashes removed)"
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
    this exact PR + FULL sha with verdict=PASS, and no trusted comment marks
    that identical PR + sha BLOCK. Checks ALL comments (not just the latest)
    since the CI path and this skill can both post one, in either order.
    Author-trust and position-anchoring are both load-bearing — see bugs 4
    and 5 in the module docstring; either alone was confirmed bypassable.

    gate-r3 adversarial round (2026-09-19), two more CONFIRMED bypasses:
      sha-prefix-collision: `sha.startswith(m.group("sha"))` accepted the
      marker's sha as a PREFIX match. SKILL.md documented (and CI posted) only
      a 7-character sha, and two genuine, independently mined git commits 7
      hex chars apart -- one benign, one carrying a backdoor -- showed a
      marker minted for one validates the OTHER outright. Now `==` against
      the FULL 40-hex sha, never a prefix; SKILL.md and pr_audit_gate.py's own
      marker-posting code are updated in this same round to always post the
      full sha (never `sha[:7]`) so a real PASS still matches.
      verdict-any-match-wins: returning True on the first matching trusted
      PASS, without checking for a trusted BLOCK on the identical pr+sha,
      meant a non-deterministic re-audit only had to roll PASS once, ever, to
      permanently outvote an existing BLOCK for the same commit -- CONFIRMED
      with two trusted comments for one sha, one of each verdict, both
      orderings, both exiting 0. A trusted BLOCK for the same pr+sha now
      vetoes a coexisting trusted PASS outright, order-independent.
    """
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

    saw_pass = False
    for c in comments:
        author = (c.get("author") or {}).get("login", "")
        if author not in trusted:
            continue
        m = MARKER_RE.match(c.get("body", "").strip())
        if not (m and m.group("pr") == pr_number and m.group("sha") == sha):
            continue
        if m.group("verdict") == "BLOCK":
            return False  # a trusted BLOCK for this exact pr+sha vetoes any PASS
        saw_pass = True
    return saw_pass


def _ownership_from_main(pr: str, sha: str) -> tuple[int, str]:
    """Run ORIGIN/MAIN's classifier (scripts/pr_audit_gate.py --ownership) on
    PR `pr` at exact head `sha`. Never imports or runs the checkout's copy: on
    a PR branch that copy is the code under review, and could release itself.
    Returns (exit code, output); (-1, message) when it could not run at all."""
    try:
        subprocess.run(["git", "-C", str(ROOT), "fetch", "--no-tags", "-q", "origin",
                        "+refs/heads/main:refs/remotes/origin/main"],
                       capture_output=True, check=True, timeout=60)
        source = subprocess.run(["git", "-C", str(ROOT), "show",
                                 "refs/remotes/origin/main:scripts/pr_audit_gate.py"],
                                capture_output=True, check=True, timeout=20).stdout
        with tempfile.TemporaryDirectory() as tmp:
            script = pathlib.Path(tmp) / "pr_audit_gate.py"
            script.write_bytes(source)
            out = subprocess.run(
                [sys.executable, "-I", str(script), "--ownership"], cwd=ROOT,
                env={**os.environ, "PR_NUMBER": pr, "PR_EXPECTED_HEAD": sha,
                     "PR_AUDIT_REPO_DIR": str(ROOT)},
                capture_output=True, text=True, timeout=240)
        return out.returncode, (out.stdout or "") + (out.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return -1, f"{type(exc).__name__}: {exc}"


def _check_invocation(pr_number: str, pin: str | None) -> None:
    """Return only when PR `pr_number` may merge pinned at `pin`; block otherwise."""
    sha = _head_sha(pr_number)
    if sha is None:
        _block(
            f"CANNOT CHECK (ADR 0090): could not read PR #{pr_number}'s head SHA "
            "via `gh pr view`. A guard that cannot verify must not allow the "
            "merge it exists to gate."
        )

    if pin is None or not _PIN_RE.fullmatch(pin) or pin != sha:
        _block(
            f"BLOCKED by ADR 0090: pass --match-head-commit <full head SHA> for PR #{pr_number} "
            f"(currently {sha}), once, as its own argument, so the merge binds to the "
            "commit that was audited and checked."
        )

    if not _passing_marker_exists(pr_number, sha):
        _block(
            f"BLOCKED by ADR 0090: no PASS verdict found for PR #{pr_number} at "
            f"{sha[:7]}. Looked for a `<!-- pr-audit-gate: pr={pr_number} "
            f"sha={sha[:7]}... verdict=PASS -->` marker across this PR's "
            "comments -- none matched (missing, stale for an older commit, or "
            "BLOCK). Run the pr-audit-gate skill for PR "
            f"#{pr_number} first; do not call gh pr merge directly."
        )

    code, out = _ownership_from_main(pr_number, sha)
    if code == 3:
        _block(
            f"BLOCKED by ADR 0090: PR #{pr_number} at {sha[:7]} changes what the audit "
            "gate owns; a PASS marker cannot clear it. The founder's word is required, "
            f"then the SHA-pinned gh api .../pulls/{pr_number}/merge (ADR 0090 review "
            f"trail, #261/#297/#299).\n{out[-3000:]}"
        )
    if code != 0:
        _block(
            f"CANNOT CHECK (ADR 0090): origin/main's ownership check did not run "
            f"(exit {code}).\n{out[-3000:]}"
        )


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

    tool = str(payload.get("tool_name", ""))
    if tool != "Bash":
        if _mcp_merge_tool(tool):
            _block(
                f"BLOCKED by ADR 0090: {tool} can merge a PR or arm auto-merge with no "
                "--match-head-commit and no ownership check. Merge through the "
                "pr-audit-gate skill (`gh pr merge <n> --squash --match-head-commit "
                "<audited sha>`); a PR that changes what the gate owns needs the "
                "founder's word."
            )
        # gate-r3 path-exec-surface-outside-matcher (2026-09-19): a generic
        # exec-capable tool (a terminal runner, a sandbox, a batched
        # computer-use call) is not named "merge" and so is not caught above,
        # but its OWN input can still carry a fully-formed `gh pr merge` or
        # `git push origin main` -- CONFIRMED exit 0 for six real tool names
        # in a session's own roster, carrying a complete merge command
        # untouched, since main() never inspected tool_input for anything but
        # tool_name here. Only a tool .claude/settings.json's matcher (widened
        # in this same round) actually routes to the hook is ever seen at
        # all -- a wholly novel, unlisted tool name still is not, and that
        # residual is named in ADR 0090, not claimed closed -- but any tool
        # that IS routed here now has its input scanned the same way a Bash
        # command's is, whatever the tool is named.
        text = _tool_input_text(payload.get("tool_input"))
        if text:
            api_reason = _github_api_merge_reason(text)
            if api_reason:
                _block(f"BLOCKED by ADR 0090: {tool}'s input {api_reason}. Merge through the "
                       "pr-audit-gate skill (`gh pr merge <n> --squash --match-head-commit "
                       "<audited sha>`); a PR that changes what the gate owns needs the "
                       "founder's word.")
            stripped_text = re.sub(r"[\"'\\]", "", text)
            if _MERGE_PROBE_RE.search(stripped_text) or _PLAIN_PR_MERGE_RE.search(stripped_text) \
                    or re.search(r"(?i)\bgit\s+(?:\S+\s+)*push\b", text):
                _block(f"BLOCKED by ADR 0090: {tool}'s input looks like it runs a `gh pr merge` "
                       "or a `git push`; this hook only fully checks a Bash command. Run it as "
                       "a plain Bash command instead, so the pin, marker and ownership checks "
                       "all run.")
        return 0

    command = _normalize_command(str(payload.get("tool_input", {}).get("command", "")))
    api_reason = _github_api_merge_reason(command)
    if api_reason:
        _block(f"BLOCKED by ADR 0090: this command {api_reason}. Merge through the "
               "pr-audit-gate skill (`gh pr merge <n> --squash --match-head-commit "
               "<audited sha>`); a PR that changes what the gate owns needs the "
               "founder's word.")

    if DIRECT_PUSH_PATTERN.search(command):
        _block(
            "BLOCKED by ADR 0090: direct pushes to main are not audited. Open a "
            "PR and let the pr-audit-gate skill carry it, so main's branch "
            "protection and the audit both actually run against it." + PUSH_TEXT_HINT
        )
    try:
        push_problem = _direct_push_problem(command)
    except Exception as exc:  # noqa: BLE001 -- a crash here must not fail open
        # gate-r8 last call, completed: an uncaught exception exits 1, which
        # Claude Code treats as a non-blocking error, so the command would run
        # unchecked. Measured: an unquoted heredoc body holding 22 nested
        # `$(` made `_heredoc_push_reason()` raise and the hook exit 1.
        push_problem = (f"the push check could not read the command ({type(exc).__name__}), "
                        "so a push inside it cannot be ruled out")
    if push_problem:
        _block(
            f"BLOCKED by ADR 0090: direct pushes to main are not audited ({push_problem}). "
            "Open a PR and let the pr-audit-gate skill carry it, so main's branch "
            "protection and the audit both actually run against it." + PUSH_TEXT_HINT
        )

    try:
        unplain = unplain_gh_word(command)
    except Exception as exc:  # noqa: BLE001 -- a crash here must not fail open
        # An uncaught exception exits 1, which Claude Code treats as a
        # non-blocking error: the command would run unchecked. The reader only
        # runs on a command naming gh or pr, so this refuses nothing else.
        _block(f"CANNOT CHECK (ADR 0090): the command could not be read word by word "
               f"({type(exc).__name__}). Write the merge plainly: "
               "`gh pr merge <n> --squash --match-head-commit <full sha>`.")
    if unplain:
        _block(f"BLOCKED by ADR 0090: {unplain}. Write the merge plainly: "
               "`gh pr merge <n> --squash --match-head-commit <full sha>`.")

    invocations, problem = merge_invocations(command)
    if problem:
        _block(f"CANNOT CHECK (ADR 0090): {problem}. Run each `gh pr merge <n> --squash "
               "--match-head-commit <sha>` as a plain command so every one is checked.")
    if not invocations:
        return 0
    if re.search(r"\bGH_(?:REPO|HOST)\b", command):
        _block("CANNOT CHECK (ADR 0090): GH_REPO or GH_HOST in a merge command points gh "
               "somewhere this hook does not check.")
    if len(invocations) > 1:
        # One check can take 380 s by its own timeouts (three gh calls at 20 s,
        # the fetch at 60 s, the show at 20 s, the classifier at 240 s), and
        # .claude/settings.json gives the hook 600 s.
        _block(f"BLOCKED by ADR 0090: this command holds {len(invocations)} `gh pr merge` "
               "calls. Run one merge per command, so each is checked within the hook's "
               "time limit.")

    args = invocations[0]
    for flag, why in _FORBIDDEN_FLAGS.items():
        if any(a == flag or a.startswith(flag + "=") for a in args):
            _block(f"BLOCKED by ADR 0090: {why}")
    number, pin, why = parse_merge_args(args)
    if why:
        _block(f"CANNOT CHECK (ADR 0090): `pr merge {' '.join(args)[:160]}`: {why}. "
               "Name the PR by its literal number.")
    _check_invocation(number, pin)

    _allow(f"require_pr_audit: #{number}: PASS verdict at the pinned head, and "
           "origin/main's classifier releases it; allowing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
