"""`scripts/hooks/require_pr_audit.py` -- the 2026-09-18 hard block (ADR 0090 amendment).

The hook is run for real, as Claude Code runs it (`python3 -I <hook>` with the
payload on stdin), inside a throwaway clone whose `origin` is a local bare
repository carrying `main` and one `refs/pull/<n>/head` per PR. `gh` is a shim
first on PATH. Nothing touches the network.

    H1  the head changes scripts/hooks/x      -> exit 2, "changes what the audit gate owns"
    H2  a clean head                           -> exit 0
    H3  no --match-head-commit                 -> exit 2
    H3b --match-head-commit of another commit  -> exit 2
    H4  origin/main's gate lacks --ownership   -> exit 2, CANNOT CHECK, not "owned"

The fixer round (2026-09-18) added, each exit 0 on the hook before it:

    H5  a clean merge chained to an owned one (&&, ;, newline)      -> exit 2
    H6  a PR number the hook cannot read literally ($n, $(...))     -> exit 2
    H7  "gh", g\\h and $G spellings of an owned merge               -> exit 2
    H8  the pin inside --body, or given twice                       -> exit 2
    H9  a merge inside bash -c "..."                                -> exit 2
    H10 an MCP tool that arms auto-merge                            -> exit 2

and the fail-closed paths, which no test pinned before (a mutant that let them
through left every suite green):

    H11 refs/pull/1/head lags headRefOid: origin/main's gate exits 4   -> exit 2, CANNOT CHECK
    H12 the head moves between the hook's read and the gate's           -> exit 2, CANNOT CHECK

The confirm round (2026-09-18) added H13-H19. Every H15-H19 command was exit 0
on the hook before it except two in H15b, blocked for other reasons: `gh $'pr'
merge` (CANNOT CHECK) and `$(which gh) pr merge 2` (no pin). H13 and H14 each
stayed green with the check they pin deleted:

    H13 no PASS marker at this head (none, stale, BLOCK, an untrusted
        author, a marker not at the comment's start)                    -> exit 2
    H14 a direct push to main, through the real entry point             -> exit 2
    H15 a `pr` subcommand spelled with quoting or expansion
        ($'merge', $"merge", mer$()ge, mer${ZZ}ge, {merge,}, mer[g]e)   -> exit 2, "plainly"
    H15d a crash inside the word reader (injected), which exited 1 and so
        failed open                                                     -> exit 2, CANNOT CHECK
    H16 --admin or --auto (the skill forbids both)                      -> exit 2
    H17 more than one merge in one command, even both clean            -> exit 2
    H18 `gh alias set` / `gh alias import` (an alias can stand for a
        merge; ADR 0090 said this was caught, and it was not)           -> exit 2
    H19 a line continuation inside a word (`mer\\<newline>ge`, a push to
        `mai\\<newline>n`), joined as the shell joins it              -> exit 2
    H6b `$n` or a branch name as the PR, refused by its own reason      -> exit 2

ADR 0090's "Not seen" list is pinned too, each example at exit 0, so the ADR
cannot go on naming a gap after it closes, or drop one that is still open.

Mutations of the hook itself, each of which must turn one of these red, are at
the bottom.

    python3 -m pytest scripts/test_require_pr_audit.py -q
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOOK = ROOT / "scripts" / "hooks" / "require_pr_audit.py"
GATE = ROOT / "scripts" / "pr_audit_gate.py"

GIT_ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}

M = "gh pr " + "merge"  # spelled apart so a session's own hook does not read this file's commands

# Answers exactly the gh calls the hook and origin/main's gate make. SHIM_HEADS
# maps each PR number to the head the hook reads (`--json headRefOid`);
# SHIM_GATE_HEADS, when set, overrides what origin/main's gate reads
# (`--json headRefOid,baseRefName`), to model a head that moves between the two.
GH_SHIM = r'''#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
heads = json.loads(os.environ["SHIM_HEADS"])
gate_heads = json.loads(os.environ.get("SHIM_GATE_HEADS") or "{}")
if a[:2] == ["api", "user"]:
    print("tester"); sys.exit(0)
if a[:2] == ["pr", "view"] and "--json" in a:
    fields = a[a.index("--json") + 1]
    pos = [x for i, x in enumerate(a[2:], 2) if not x.startswith("-") and a[i - 1] not in ("--json", "-R")]
    if not pos or pos[0] not in heads:
        sys.exit(1)
    n = pos[0]
    head = heads[n]
    if fields == "comments":
        # SHIM_MARKER: pass (the default), none, stale, block, untrusted, late.
        kind = os.environ.get("SHIM_MARKER", "pass")
        sha = ("0" if head[0] != "0" else "1") + head[1:] if kind == "stale" else head
        verdict = "BLOCK" if kind == "block" else "PASS"
        author = "someone-else" if kind == "untrusted" else "github-actions"
        marker = f"<!-- pr-audit-gate: pr={n} sha={sha} verdict={verdict} -->"
        body = f"## PR Audit Gate\n{marker}" if kind == "late" else f"{marker}\n## PR Audit Gate"
        comments = [] if kind == "none" else [{"author": {"login": author}, "body": body}]
        print(json.dumps({"comments": comments}))
    elif fields == "headRefOid":
        print(json.dumps({"headRefOid": head}))
    elif fields == "headRefOid,baseRefName":
        print(json.dumps({"headRefOid": gate_heads.get(n, head), "baseRefName": "main"}))
    else:
        sys.exit(1)
    sys.exit(0)
sys.exit(1)
'''

# What origin/main's gate did with `--ownership` before this change: print the
# usage and exit 2 (main() fell through to `print(__doc__); return 2`).
OLD_GATE = 'import sys\nprint("usage"); sys.exit(2)\n'


def git(cwd, *args) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                          text=True, env=GIT_ENV).stdout.strip()


def build(tmp: pathlib.Path, prs: dict[str, str], gate_source: str | None = None,
          hook_source: str | None = None):
    """(checkout dir, {pr: head sha}, env): one commit per PR on top of main,
    each changing the one path given for it."""
    work, bare, clone, shim = tmp / "work", tmp / "origin.git", tmp / "clone", tmp / "bin"
    work.mkdir()
    git(work, "init", "-q", "-b", "main")
    (work / "scripts").mkdir()
    (work / "scripts" / "pr_audit_gate.py").write_text(gate_source if gate_source is not None else GATE.read_text())
    (work / "apps").mkdir()
    (work / "apps" / "x.ts").write_text("export {};\n")
    git(work, "add", "-A")
    git(work, "commit", "-qm", "base")
    heads, refspecs = {}, ["main:refs/heads/main"]
    for n, path in prs.items():
        git(work, "checkout", "-q", "-B", f"pr{n}", "main")
        target = work / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"PR {n}\n")
        git(work, "add", "-A")
        git(work, "commit", "-qm", f"PR {n}")
        heads[n] = git(work, "rev-parse", "HEAD")
        refspecs.append(f"pr{n}:refs/pull/{n}/head")
    heads["base"] = git(work, "rev-parse", "main")
    git(tmp, "init", "-q", "--bare", str(bare))
    git(work, "push", "-q", str(bare), *refspecs)
    git(tmp, "clone", "-q", str(bare), str(clone))
    hooks = clone / "scripts" / "hooks"
    hooks.mkdir(parents=True)
    (hooks / "require_pr_audit.py").write_text(hook_source if hook_source is not None else HOOK.read_text())
    shim.mkdir()
    (shim / "gh").write_text(GH_SHIM)
    (shim / "gh").chmod(0o755)
    env = {**GIT_ENV, "PATH": f"{shim}{os.pathsep}{os.environ['PATH']}",
           "SHIM_HEADS": json.dumps({k: v for k, v in heads.items() if k != "base"})}
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("GH_REPO", None)
    return clone, heads, env


def run_hook(clone, env, command, tool="Bash") -> subprocess.CompletedProcess:
    payload = json.dumps({"tool_name": tool, "tool_input": {"command": command}})
    return subprocess.run([sys.executable, "-I", str(clone / "scripts" / "hooks" / "require_pr_audit.py")],
                          input=payload, capture_output=True, text=True, env=env, timeout=300)


CLEAN, OWNED = "apps/y.ts", "scripts/hooks/evil.py"


@pytest.fixture(scope="module")
def two(tmp_path_factory):
    """PR 1 is clean, PR 2 changes what the gate owns; both carry a PASS marker."""
    return build(tmp_path_factory.mktemp("two"), {"1": CLEAN, "2": OWNED})


def test_h1_an_owned_head_is_blocked_even_with_a_pass_marker(two):
    clone, h, env = two
    out = run_hook(clone, env, f"{M} 2 --squash --match-head-commit {h['2']}")
    assert out.returncode == 2, out.stderr
    assert "changes what the audit gate owns" in out.stderr
    assert "founder's word" in out.stderr


def test_h2_a_clean_head_with_a_pass_marker_is_allowed(two):
    clone, h, env = two
    for command in (f"{M} 1 --squash --match-head-commit {h['1']}",
                    f"{M} --squash --match-head-commit={h['1']} 1",
                    f"{M} https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/1 --squash "
                    f"--match-head-commit {h['1']} 2>&1",
                    f"{M} 1 --squash --match-head-commit {h['1']} >/dev/null && echo merged",
                    "git status", "gh pr view 1 --json state",
                    'git commit -m "fix the PR merge flow in the docs"'):
        out = run_hook(clone, env, command)
        assert out.returncode == 0, (command, out.stderr)


def test_h3_a_merge_without_match_head_commit_is_blocked(two):
    clone, h, env = two
    out = run_hook(clone, env, f"{M} 1 --squash")
    assert out.returncode == 2
    assert "--match-head-commit" in out.stderr and h["1"] in out.stderr


def test_h3b_a_match_head_commit_for_another_commit_is_blocked(two):
    clone, h, env = two
    other = ("0" if h["1"][0] != "0" else "1") + h["1"][1:]
    out = run_hook(clone, env, f"{M} 1 --squash --match-head-commit {other}")
    assert out.returncode == 2
    assert "--match-head-commit" in out.stderr


def test_h4_an_origin_main_gate_without_ownership_is_cannot_check(tmp_path):
    clone, h, env = build(tmp_path, {"1": CLEAN}, gate_source=OLD_GATE)
    out = run_hook(clone, env, f"{M} 1 --squash --match-head-commit {h['1']}")
    assert out.returncode == 2
    assert "CANNOT CHECK" in out.stderr
    assert "changes what the audit gate owns" not in out.stderr


def test_the_checkout_copy_of_the_gate_is_never_run(tmp_path):
    """A branch that ships a gate releasing everything must not release itself:
    the hook runs origin/main's copy, so a checkout copy is irrelevant."""
    clone, h, env = build(tmp_path, {"2": OWNED})
    (clone / "scripts" / "pr_audit_gate.py").write_text("import sys\nsys.exit(0)\n")
    out = run_hook(clone, env, f"{M} 2 --squash --match-head-commit {h['2']}")
    assert out.returncode == 2
    assert "changes what the audit gate owns" in out.stderr


@pytest.mark.parametrize("shape", ["&&", ";", "newline", "||", "subshell"])
def test_h5_a_clean_merge_chained_to_an_owned_one_is_blocked(two, shape):
    clone, h, env = two
    first = f"{M} 1 --squash --match-head-commit {h['1']}"
    second = f"{M} 2 --squash --match-head-commit {h['2']}"
    command = {"&&": f"{first} && {second}", ";": f"{first}; {M} 2 --squash",
               "newline": f"{first}\n{M} 2 --squash", "||": f"{first} || {second}",
               "subshell": f"{first} && ({second})"}[shape]
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (shape, out.stderr)


@pytest.mark.parametrize("command", [
    "for n in 1 2; do " + M + " $n --squash --match-head-commit {h1}; done",
    M + " $(echo 2) --squash --match-head-commit {h1}",
    M + " `echo 2` --squash --match-head-commit {h1}",
    M + " --squash --match-head-commit {h1}",
    M + " feat/some-branch --squash --match-head-commit {h1}",
    M + " 1 2 --squash --match-head-commit {h1}",
    M + " https://github.com/someone/else/pull/1 --squash --match-head-commit {h1}",
    M + " 1 -R someone/else --squash --match-head-commit {h1}",
    "GH_REPO=someone/else " + M + " 1 --squash --match-head-commit {h1}",
    M + " 1 --squash -x --match-head-commit {h1}",
    "gh -R someone/else pr merge 1 --squash --match-head-commit {h1}",
])
def test_h6_a_merge_the_hook_cannot_read_literally_is_blocked(two, command):
    clone, h, env = two
    out = run_hook(clone, env, command.format(h1=h["1"]))
    assert out.returncode == 2, (command, out.stderr)


def test_h6b_a_non_literal_pr_is_refused_by_name_not_by_a_later_lookup(two):
    """The confirm round's mutation run: reading `$n` or a branch name as the PR
    number left every exit at 2 (the lookup that follows fails), so only the
    reason pins the rule. A branch name is one real gh resolves to a PR."""
    clone, h, env = two
    for arg in ("$n", "feat/some-branch"):
        out = run_hook(clone, env, f"{M} {arg} --squash --match-head-commit {h['1']}")
        assert out.returncode == 2 and "not a literal PR number" in out.stderr, (arg, out.stderr)


@pytest.mark.parametrize("spelling", ['"gh" pr merge', "g\\h pr merge", "G=gh; $G pr merge",
                                      "gh pr -R aldemirkonuk/RestaurantAIAutomation merge"])
def test_h7_other_spellings_of_an_owned_merge_are_blocked(two, spelling):
    clone, h, env = two
    out = run_hook(clone, env, f"{spelling} 2 --squash --match-head-commit {h['2']}")
    assert out.returncode == 2, (spelling, out.stderr)
    assert any(w in out.stderr for w in ("changes what the audit gate owns", "CANNOT CHECK", "plainly"))


def test_h8_a_pin_that_is_not_its_own_single_argument_is_blocked(two):
    clone, h, env = two
    for command in (f'{M} 1 --squash --body "--match-head-commit {h["1"]}"',
                    f"{M} 1 --squash --match-head-commit {h['1']} --match-head-commit {'d' * 40}",
                    f"{M} 1 --squash --match-head-commit {h['1'].upper()}"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)


def test_h9_a_merge_the_tokenizer_cannot_place_is_blocked(two):
    clone, h, env = two
    for command in (f'bash -c "{M} 2 --squash --match-head-commit {h["2"]}"',
                    f"eval '{M} 2 --squash'",
                    f"{M} 1 --squash --match-head-commit {h['1']} # ; {M} 2",
                    f"{M} 1 'unclosed"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "CANNOT CHECK" in out.stderr


def test_h10_an_mcp_tool_that_arms_auto_merge_is_blocked(two):
    clone, _h, env = two
    for tool, want in (("mcp__ccd_pr__set_auto_merge", 2), ("mcp__github__merge_pull_request", 2),
                       ("mcp__gh__enableAutoMerge", 2), ("mcp__c96b062f__merge_branch", 0),
                       ("mcp__ccd_pr__get_status", 0), ("Read", 0)):
        out = run_hook(clone, env, "", tool=tool)
        assert out.returncode == want, (tool, out.stderr)


def test_h10b_settings_route_mcp_merge_tools_to_the_hook():
    """The hook only sees what .claude/settings.json's matcher sends it."""
    settings = json.loads((ROOT / ".claude" / "settings.json").read_text())
    entry = next(e for e in settings["hooks"]["PreToolUse"]
                 if any("require_pr_audit.py" in h["command"] for h in e["hooks"]))
    matcher = re.compile(f"^(?:{entry['matcher']})$")
    for tool in ("Bash", "mcp__ccd_pr__set_auto_merge", "mcp__github__merge_pull_request"):
        assert matcher.match(tool), tool


def test_h11_refs_pull_lagging_the_head_is_cannot_check(tmp_path):
    """origin/main's gate sees refs/pull/1/head at one commit and headRefOid at
    another, and exits 4. That is CANNOT CHECK, never a pass."""
    clone, h, env = build(tmp_path, {"1": CLEAN})
    lagging = {"1": h["base"]}  # a real commit, but not the one refs/pull/1/head holds
    env = {**env, "SHIM_HEADS": json.dumps(lagging)}
    out = run_hook(clone, env, f"{M} 1 --squash --match-head-commit {h['base']}")
    assert out.returncode == 2, out.stderr
    assert "CANNOT CHECK" in out.stderr and "exit 4" in out.stderr
    assert "changes what the audit gate owns" not in out.stderr


def test_h12_a_head_that_moves_between_the_reads_is_cannot_check(tmp_path):
    """The hook pins and checks one head; by the time origin/main's gate asks,
    the PR is at another (clean) head. The gate is told which head the hook
    checked (PR_EXPECTED_HEAD), so it refuses rather than judging the new one."""
    clone, h, env = build(tmp_path, {"1": CLEAN})
    env = {**env, "SHIM_HEADS": json.dumps({"1": h["base"]}), "SHIM_GATE_HEADS": json.dumps({"1": h["1"]})}
    out = run_hook(clone, env, f"{M} 1 --squash --match-head-commit {h['base']}")
    assert out.returncode == 2, out.stderr
    assert "CANNOT CHECK" in out.stderr and "head moved" in out.stderr


@pytest.mark.parametrize("marker", ["none", "stale", "block", "untrusted", "late"])
def test_h13_a_merge_with_no_pass_marker_at_this_head_is_blocked(two, marker):
    """PR 1 is clean and pinned, so only the marker check stands between it and
    the merge. Until the confirm round the shim always answered PASS, and a hook
    with this check deleted left every suite green."""
    clone, h, env = two
    out = run_hook(clone, {**env, "SHIM_MARKER": marker}, f"{M} 1 --squash --match-head-commit {h['1']}")
    assert out.returncode == 2, (marker, out.stderr)
    assert "no PASS verdict found" in out.stderr


def test_h14_a_direct_push_to_main_is_blocked_through_the_entry_point(two):
    """The gate's self-test pins DIRECT_PUSH_PATTERN; this pins that main() acts on it."""
    clone, _h, env = two
    push = "git " + "push"  # spelled apart, as M is
    for command in (f"{push} origin main", f"git -C ../x push origin HEAD:main --force"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "direct pushes to main" in out.stderr
    assert run_hook(clone, env, f"{push} origin feat/x").returncode == 0


# Each is `merge` once the shell expands it (the glob needs a file named `merge`
# in the working directory), and each was exit 0 against an owned PR before.
SPELLINGS = ["$'merge'", '$"merge"', "mer$()ge", "mer${ZZ}ge", "{merge,}", "mer[g]e"]


@pytest.mark.parametrize("word", SPELLINGS)
def test_h15_a_pr_subcommand_spelled_with_quoting_or_expansion_is_blocked(two, word, tmp_path):
    clone, _h, env = two
    (tmp_path / "merge").write_text("")
    shell = subprocess.run(["bash", "-c", f"printf '<%s>' {word}"], cwd=tmp_path,
                           capture_output=True, text=True, env={"PATH": os.environ["PATH"]})
    assert shell.stdout == "<merge>", (word, shell.stdout)  # the shell really runs `merge`
    out = run_hook(clone, env, f"gh pr {word} 2 --squash")
    assert out.returncode == 2, (word, out.stderr)
    assert "plainly" in out.stderr


@pytest.mark.parametrize("command", [
    "gh p$()r merge 2 --squash",  # the command-group word after a literal gh
    "gh $'pr' merge 2 --squash",
    "echo $(gh pr $'merge' 2 --squash)",  # inside a substitution
    'echo "`gh pr {merge,} 2 --squash`"',
    "cat <(gh pr $'merge' 2 --squash)",
    "G=gh; $G pr mer$()ge 2 --squash",  # gh given as a variable
    "/usr/local/bin/g? pr merge 2 --squash",  # a gh the shell expands: refused, not guessed
    "$(which gh) pr merge 2 --squash",
    "gh >/dev/null pr $'merge' 2 --squash",  # a redirection between gh and pr
    "gh 2>/dev/null pr $'merge' 2 --squash",
    "bash -c \"gh pr \\$'merge' 2 --squash\"",  # a string another shell runs
    "bash <<'EOF'\ngh pr mer$()ge 2 --squash\nEOF",
])
def test_h15b_the_same_after_gh_inside_substitutions_and_after_a_variable(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "plainly" in out.stderr


@pytest.mark.parametrize("command", [
    "gh pr view 1", "gh pr checks 1", "gh pr view 1 --json title -q '.title'",
    'gh pr list --search "is:open author:@me"', 'gh pr view "$N" --json state',
    # a heredoc body is not code: its quotes, parens and backticks are text
    "gh pr create --title \"x\" --body \"$(cat <<'EOF'\ngh pr 'view' 1\nIt's \"done\" (see `a`)\nEOF\n)\"",
    "git commit -m \"gh pr view: fix the $'x' case\"",
])
def test_h15c_ordinary_gh_pr_commands_still_pass(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


def test_h15d_a_crash_in_the_word_reader_blocks_rather_than_fails_open(tmp_path):
    """An uncaught exception exits 1, which Claude Code treats as a non-blocking
    error: the merge would run unchecked. No input is known to crash the reader,
    so the crash is injected. A command that names neither gh nor pr never
    reaches the reader and still passes."""
    source = HOOK.read_text()
    head = "def _lex(s: str, i: int, closer: str | None, depth: int):\n"
    assert source.count(head) == 1
    crashing = source.replace(head, head + "    raise RuntimeError('injected')\n", 1)
    clone, h, env = build(tmp_path, {"2": OWNED}, hook_source=crashing)
    for command in (f"{M} 2 --squash --match-head-commit {h['2']}", "gh pr view 2"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2 and "CANNOT CHECK" in out.stderr, (command, out.returncode, out.stderr)
    assert run_hook(clone, env, "git status").returncode == 0


# ADR 0090's "Not seen" list, each example exactly as the ADR gives it. These pin the
# ADR, not a wish: when one starts to block, move it to the ADR's "Refused" list
# and delete it here, so the record never claims a gap that is closed or hides
# one that is open.
NOT_SEEN = [
    "gh${IFS}pr${IFS}merge${IFS}2",
    "{gh,pr,merge} 2",
    "echo merge 2 | xargs gh pr",
    "alias g=gh; g pr merge 2",
    "G=gh; $G p$()r merge 2",
    "bash -c 'gh p$()r merge 2'",
    "bash -c 'gh pr merg? 2'",
    "bash -c 'gh pr `echo merge` 2'",
]


@pytest.mark.parametrize("command", NOT_SEEN)
def test_the_adrs_not_seen_list_is_still_not_seen(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


def test_h18_a_gh_alias_definition_is_blocked(two):
    """`gh alias set m 'pr merge' && gh m 2` merges PR 2 under a name no probe
    reads. ADR 0090 said an alias set in the same command was caught; it was not
    (exit 0 before the confirm round)."""
    clone, _h, env = two
    for command in ("gh alias set m 'pr " + "merge' && gh m 2 --squash", "gh alias import aliases.yml"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "alias" in out.stderr
    assert run_hook(clone, env, "gh alias list").returncode == 0


@pytest.mark.parametrize("flag", ["--admin", "--auto"])
def test_h16_admin_and_auto_are_blocked(two, flag):
    """The skill says never --admin (it bypasses branch protection) and no
    --auto (it arms a merge that a later, unaudited push can ride)."""
    clone, h, env = two
    out = run_hook(clone, env, f"{M} 1 {flag} --squash --match-head-commit {h['1']}")
    assert out.returncode == 2, (flag, out.stderr)
    assert flag in out.stderr


@pytest.mark.parametrize("shape", ["&&", ";", "newline"])
def test_h17_more_than_one_merge_in_one_command_is_blocked(two, shape):
    """Both merges are clean and pinned. One check can take 380 s by its own
    timeouts (three gh calls at 20 s, a fetch at 60 s, a show at 20 s, the
    classifier at 240 s) against the hook's 600 s, so a command holds one merge."""
    clone, h, env = two
    one = f"{M} 1 --squash --match-head-commit {h['1']}"
    out = run_hook(clone, env, one + {"&&": " && ", ";": "; ", "newline": "\n"}[shape] + one)
    assert out.returncode == 2, (shape, out.stderr)
    assert "one merge per command" in out.stderr


def test_h19_a_line_continuation_inside_a_word_is_joined_as_the_shell_joins_it(two):
    """The shell removes a backslash-newline outright. The hook put a space in
    its place, so `gh pr mer\\<newline>ge 2` read as `mer ge` and was allowed
    against the owned PR with no pin, and `git push origin mai\\<newline>n` was
    allowed too (each exit 0 before the confirm round)."""
    clone, h, env = two
    shell = subprocess.run(["bash", "-c", "printf '<%s>' mer\\\nge"], capture_output=True, text=True)
    assert shell.stdout == "<merge>"  # the shell really runs `merge`
    out = run_hook(clone, env, f"gh pr mer\\\nge 2 --squash --match-head-commit {h['2']}")
    assert out.returncode == 2 and "changes what the audit gate owns" in out.stderr, out.stderr
    out = run_hook(clone, env, "gh pr mer\\\nge 1 --squash")
    assert out.returncode == 2 and "--match-head-commit" in out.stderr, out.stderr
    out = run_hook(clone, env, "git " + "push origin mai\\\nn")
    assert out.returncode == 2 and "direct pushes to main" in out.stderr, out.stderr
    # An escaped backslash before a newline does not continue the line: the
    # merge on the next line is a command of its own, and is checked.
    out = run_hook(clone, env, f"echo a\\\\\n{M} 2 --squash --match-head-commit {h['2']}")
    assert out.returncode == 2 and "changes what the audit gate owns" in out.stderr, out.stderr
    # A continuation between words still joins them into one command.
    out = run_hook(clone, env, f"{M} 1 \\\n  --squash --match-head-commit {h['1']}")
    assert out.returncode == 0, out.stderr


def test_the_gates_mirror_of_the_continuation_rule_matches_the_hook():
    """scripts/pr_audit_gate.py keeps a copy for its self-test (it does not
    import across scripts/hooks/); the two must read every input alike."""
    import importlib.util

    def load(path, name):
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    hook, gate = load(HOOK, "hook_mirror"), load(GATE, "gate_mirror")
    for text in ("git push \\\n  origin main", "mer\\\nge", "a\\\\\nb", "a\\\\\\\nb", "a\\ \nb", "a\nb"):
        assert hook._normalize_command(text) == gate._normalize_command_for_test(text), text


# --------------------------------------------------------------------------- #
# Mutations of the hook: each must turn at least one scenario above red.
# (name, text that must occur exactly once, replacement, scenario)
# --------------------------------------------------------------------------- #

HOOK_MUTATIONS = [
    ("delete the ownership block",
     "    code, out = _ownership_from_main(pr_number, sha)\n    if code == 3:",
     "    code, out = 0, ''\n    if code == 3:", "h1"),
    ("always block", "    code, out = _ownership_from_main(pr_number, sha)\n",
     "    _block('always')\n", "h2"),
    ("CANNOT CHECK (exit 4) treated as clean", "    if code != 0:\n", "    if code not in (0, 4):\n", "h11"),
    ("no PR_EXPECTED_HEAD passed to the gate", '"PR_EXPECTED_HEAD": sha,', "", "h12"),
    ("current-branch fallback for a non-literal PR", '        return None, None, f"{arg!r} is not a literal PR number or pull-request URL"',
     '        number = "1"', "h6"),
    ("hidden-invocation count dropped", "    if len(found) < len(probe):", "    if False:", "h9"),
    ("a second pin allowed", '    if len(pins) > 1:', "    if False:", "h8"),
    ("MCP merge tools allowed", "        if _mcp_merge_tool(tool):", "        if False:", "h10"),
    # the confirm round (2026-09-18)
    ("PASS-marker check removed", "    if not _passing_marker_exists(pr_number, sha):\n", "    if False:\n", "h13"),
    ("direct-push block removed", "    if DIRECT_PUSH_PATTERN.search(command):\n", "    if False:\n", "h14"),
    ("plain-word block removed", "    if unplain:\n", "    if False:\n", "h15"),
    ("word after pr not read",
     "if seg[j][0].lower() == \"pr\" and m < len(seg) and not _PLAIN_WORD_RE.fullmatch(seg[m][1]):",
     "if False:", "h15q"),
    ("a pr after an expanded word allowed", "                    if seg[j][0] == \"pr\":  # gh",
     "                    if False:  # gh", "h15pr"),
    ("the word after a literal gh not read",
     "                if any(c in _QUOTES_OR_EXPANDS for c in seg[j][1]):\n",
     "                if False:\n", "h15gh"),
    ("substitutions not read", "    for group in (words, *subs):\n", "    for group in (words,):\n", "h15s"),
    ("the stripped-text reading removed", "    probe = _UNPLAIN_PROBE_RE.search(stripped)\n",
     "    probe = None\n", "h15str"),
    ("redirection targets not skipped", "                    target = True  # a redirection: the next word is its target\n",
     "                    segments.append([])\n", "h15redir"),
    ("heredoc bodies read as code", '            if run.endswith("\\n") and heredocs:\n', "            if False:\n", "h15c"),
    ("forbidden flags allowed", '        if any(a == flag or a.startswith(flag + "=") for a in args):\n',
     "        if False:\n", "h16"),
    ("gh alias definitions allowed", 'seg[j][0] == "alias" and m < len(seg)', 'False and m < len(seg)', "h18"),
    ("more than one merge allowed", "    if len(invocations) > 1:\n", "    if False:\n", "h17"),
    ("a line continuation read as a space",
     '    return re.sub(r"(?<!\\\\)((?:\\\\\\\\)*)\\\\\\n", r"\\1", command)\n',
     '    return re.sub(r"\\\\[ \\t]*\\n[ \\t]*", " ", command)\n', "h19"),
    ("an escaped backslash read as a continuation",
     '    return re.sub(r"(?<!\\\\)((?:\\\\\\\\)*)\\\\\\n", r"\\1", command)\n',
     '    return re.sub(r"\\\\\\n", "", command)\n', "h19e"),
]

# (command, exit the unmutated hook gives, tool, extra environment)
SCENARIOS = {
    "h1": lambda h: (f"{M} 2 --squash --match-head-commit {h['2']}", 2, None, {}),
    "h2": lambda h: (f"{M} 1 --squash --match-head-commit {h['1']}", 0, None, {}),
    "h6": lambda h: (f"for n in 2; do {M} $n --squash --match-head-commit {h['1']}; done", 2, None, {}),
    "h8": lambda h: (f"{M} 1 --squash --match-head-commit {h['1']} --match-head-commit {'d' * 40}", 2, None, {}),
    "h9": lambda h: (f'bash -c "{M} 2 --squash --match-head-commit {h["2"]}"', 2, None, {}),
    "h10": lambda h: ("", 2, "mcp__ccd_pr__set_auto_merge", {}),
    "h11": lambda h: (f"{M} 1 --squash --match-head-commit {h['base']}", 2, None,
                      {"SHIM_HEADS": json.dumps({"1": h["base"]})}),
    "h12": lambda h: (f"{M} 1 --squash --match-head-commit {h['base']}", 2, None,
                      {"SHIM_HEADS": json.dumps({"1": h["base"]}), "SHIM_GATE_HEADS": json.dumps({"1": h["1"]})}),
    "h13": lambda h: (f"{M} 1 --squash --match-head-commit {h['1']}", 2, None, {"SHIM_MARKER": "none"}),
    "h14": lambda h: ("git " + "push origin main", 2, None, {}),
    "h15": lambda h: ("gh pr $'merge' 2 --squash", 2, None, {}),
    # Each below is caught by one reading only; the clean PR 1 merges without it.
    "h15q": lambda h: (f"gh pr 'merge' 1 --squash --match-head-commit {h['1']}", 2, None, {}),
    "h15pr": lambda h: (f"G=gh; $G pr merge 1 --squash --match-head-commit {h['1']}", 2, None, {}),
    "h15gh": lambda h: ("gh p$()r merge 2 --squash", 2, None, {}),
    "h15s": lambda h: (f"echo $(gh pr 'merge' 1 --squash --match-head-commit {h['1']})", 2, None, {}),
    "h15str": lambda h: ("bash -c \"gh pr \\$'merge' 2 --squash\"", 2, None, {}),
    "h15redir": lambda h: ("gh >/dev/null pr $'merge' 2 --squash", 2, None, {}),
    "h15c": lambda h: ("gh pr create --title x --body \"$(cat <<'EOF'\ngh pr 'view' 1\nEOF\n)\"", 0, None, {}),
    "h16": lambda h: (f"{M} 1 --admin --squash --match-head-commit {h['1']}", 2, None, {}),
    "h18": lambda h: ("gh alias set m 'pr " + "merge' && gh m 2 --squash", 2, None, {}),
    "h17": lambda h: (f"{M} 1 --squash --match-head-commit {h['1']} && {M} 1 --squash "
                      f"--match-head-commit {h['1']}", 2, None, {}),
    "h19": lambda h: (f"gh pr mer\\\nge 2 --squash --match-head-commit {h['2']}", 2, None, {}),
    "h19e": lambda h: (f"echo a\\\\\n{M} 2 --squash --match-head-commit {h['2']}", 2, None, {}),
}


def test_every_scenario_gives_its_expected_exit_on_the_real_hook(two):
    """The control for the mutations below: a mutant is killed only if it moves
    the exit away from what the real hook gives."""
    clone, h, env = two
    wrong = []
    for key, scenario in SCENARIOS.items():
        command, want, tool, extra = scenario(h)
        out = run_hook(clone, {**env, **extra}, command, tool=tool or "Bash")
        if out.returncode != want:
            wrong.append((key, out.returncode, out.stderr[-200:]))
    assert wrong == []


@pytest.mark.parametrize("name,old,new,scenario", HOOK_MUTATIONS, ids=[m[0] for m in HOOK_MUTATIONS])
def test_hook_mutations_are_killed(tmp_path, name, old, new, scenario):
    source = HOOK.read_text()
    assert source.count(old) == 1, f"no-op mutation: target text occurs {source.count(old)} times"
    clone, h, env = build(tmp_path, {"1": CLEAN, "2": OWNED}, hook_source=source.replace(old, new, 1))
    command, want, tool, extra = SCENARIOS[scenario](h)
    out = run_hook(clone, {**env, **extra}, command, tool=tool or "Bash")
    assert out.returncode != want, f"hook mutation survived: {name}"
