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


def _mcp_merge_tool(name: str) -> bool:
    """True for an MCP tool whose name says it merges a PR or arms auto-merge."""
    if not name.startswith("mcp__"):
        return False
    words = {w.lower() for w in re.findall(r"[A-Z]?[a-z]+|[0-9]+", name)}
    if "automerge" in words:
        return True
    return "merge" in words and bool(words & _MCP_MERGE_WORDS)


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


def merge_invocations(command: str) -> tuple[list[list[str]], str | None]:
    """(the argument list of every `pr [flags] merge` in the command, a problem).

    The arguments are every token after `pr`, minus `merge` itself, up to the
    end of that simple command. The problem is set when the command holds a
    `pr merge` that could not be placed as its own invocation: an unclosed
    quote, or one inside `bash -c "..."`, `eval '...'`, a comment, or anything
    else a tokenizer cannot see through. Either way the caller blocks."""
    probe = _MERGE_PROBE_RE.findall(re.sub(r"[\"'\\]", "", command))
    if not probe:
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


def _lex(s: str, i: int, closer: str | None, depth: int):
    """(words, substitutions, end) for the command text in `s` from `i` up to
    `closer` (an unmatched `)` or a backtick; None reads to the end).

    Each word is (its text once quotes and backslashes are removed, its text as
    written). A run of ; & | < > or newline, and each ( and ), is a word of its
    own. $(...), `...`, <(...) and >(...) stay inside their word; the words
    inside each come back in `substitutions`, nested ones flattened. A comment
    and a heredoc body are skipped, and a file descriptor before a redirection
    (the 2 of 2>&1) is dropped. Lenient: an unclosed quote runs to the end (the
    shell refuses such a command outright). Raises ValueError only past
    _MAX_NESTING levels of substitution."""
    if depth > _MAX_NESTING:
        raise ValueError(f"substitutions nested more than {_MAX_NESTING} deep")
    n = len(s)
    words: list[tuple[str, str]] = []
    subs: list[list[tuple[str, str]]] = []
    heredocs: list[tuple[str, bool]] = []
    delim_strip: bool | None = None  # set after << : the next word is a heredoc delimiter
    cooked: list[str] = []
    raw: list[str] = []
    parens = 0

    def end_word() -> None:
        nonlocal delim_strip
        if raw:
            words.append(("".join(cooked), "".join(raw)))
            if delim_strip is not None:
                heredocs.append(("".join(cooked), delim_strip))
                delim_strip = None
        cooked.clear()
        raw.clear()

    def substitution(start: int, body: int, close: str) -> int:
        """Read $(...), `...` or <(...) starting at `start` (its body at `body`)
        into the current word; return the index after it."""
        inner, nested, j = _lex(s, body, close, depth + 1)
        subs.append(inner)
        subs.extend(nested)
        cooked.append(s[start:j + 1])
        raw.append(s[start:j + 1])
        return j + 1

    while i < n:
        ch = s[i]
        if ch == closer and (closer == "`" or parens == 0):
            end_word()
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
            body = s[(i + 1 if ch == "'" else i + 2):j]
            cooked.append(body if ch == "'" else re.sub(r"\\(.)", r"\1", body, flags=re.S))
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
                    inner, nested, j = _lex(s, body, ")" if s[i] == "$" else "`", depth + 1)
                    subs.append(inner)
                    subs.extend(nested)
                    text.append(s[i:j + 1])
                    i = j + 1
                else:
                    text.append(s[i])
                    i += 1
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
                for delim, strip in heredocs:  # skip each body, up to its delimiter line
                    while i < n:
                        j = s.find("\n", i)
                        line = s[i:] if j < 0 else s[i:j]
                        i = n if j < 0 else j + 1
                        if (line.lstrip("\t") if strip else line) == delim:
                            break
                heredocs.clear()
        else:
            cooked.append(ch)
            raw.append(ch)
            i += 1
    end_word()
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
                literal_gh = cooked.lower() == "gh" or cooked.lower().endswith("/gh")
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
        return 0

    command = _normalize_command(str(payload.get("tool_input", {}).get("command", "")))
    if DIRECT_PUSH_PATTERN.search(command):
        _block(
            "BLOCKED by ADR 0090: direct pushes to main are not audited. Open a "
            "PR and let the pr-audit-gate skill carry it, so main's branch "
            "protection and the audit both actually run against it."
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
