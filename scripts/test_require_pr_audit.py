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
        author, a marker not at the comment's start, a trusted PASS
        marker naming another PR)                                       -> exit 2
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
import shlex
import shutil
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
REPO = "aldemirkonuk/RestaurantAIAutomation"  # matches the literal already inlined elsewhere in this file

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
        # SHIM_MARKER: pass (the default), none, stale, block, untrusted, late,
        # otherpr, shortsha (gate-r3: a valid 7-char PREFIX of the real head,
        # not the full sha -- models sha-prefix-collision), selfposted
        # (gate-r3: authored by "tester", this shim's own `gh api user`
        # identity -- models _current_gh_user() trust, not the CI bot), mixed
        # / mixedrev (gate-r3: two trusted comments for the identical sha, one
        # BLOCK one PASS, in each order -- models verdict-any-match-wins).
        kind = os.environ.get("SHIM_MARKER", "pass")
        sha = (("0" if head[0] != "0" else "1") + head[1:] if kind == "stale"
               else head[:7] if kind == "shortsha" else head)
        verdict = "BLOCK" if kind == "block" else "PASS"
        author = ("someone-else" if kind == "untrusted"
                  else "tester" if kind == "selfposted" else "github-actions")
        pr_field = ("9" + n) if kind == "otherpr" else n
        marker = f"<!-- pr-audit-gate: pr={pr_field} sha={sha} verdict={verdict} -->"
        body = f"## PR Audit Gate\n{marker}" if kind == "late" else f"{marker}\n## PR Audit Gate"
        if kind in ("mixed", "mixedrev"):
            block_c = {"author": {"login": "github-actions"},
                       "body": f"<!-- pr-audit-gate: pr={n} sha={head} verdict=BLOCK -->\n## PR Audit Gate"}
            pass_c = {"author": {"login": "github-actions"},
                      "body": f"<!-- pr-audit-gate: pr={n} sha={head} verdict=PASS -->\n## PR Audit Gate"}
            comments = [block_c, pass_c] if kind == "mixed" else [pass_c, block_c]
        else:
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


def test_h13b_a_trusted_pass_marker_naming_another_pr_is_blocked(two):
    """The marker's own `pr=` field must match the PR being merged, not merely
    its sha and verdict. This models the mutant that survived the confirm
    round: `m.group("pr") == pr_number` in `_passing_marker_exists` replaced by
    the constant `True`. Every other H13 case still uses THIS PR's own number
    in the marker, so a mutant that stops checking `pr` entirely would pass
    all of them; only a marker naming a different PR, at this PR's own exact
    head sha with a trusted PASS verdict, exercises the `pr` field at all."""
    clone, h, env = two
    out = run_hook(clone, {**env, "SHIM_MARKER": "otherpr"}, f"{M} 1 --squash --match-head-commit {h['1']}")
    assert out.returncode == 2, out.stderr
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
    reaches the reader and still passes.

    gate-r8: the push check now reads every command naming git or push with
    the same reader, so a crash there refuses such a command too (fail
    closed) -- `git status` is refused under the injected crash, and the
    control that still passes names none of gh, pr, git or push."""
    source = HOOK.read_text()
    head = "def _lex(s: str, i: int, closer: str | None, depth: int, report: dict | None = None):\n"
    assert source.count(head) == 1
    crashing = source.replace(head, head + "    raise RuntimeError('injected')\n", 1)
    clone, h, env = build(tmp_path, {"2": OWNED}, hook_source=crashing)
    for command in (f"{M} 2 --squash --match-head-commit {h['2']}", "gh pr view 2"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2 and "CANNOT CHECK" in out.stderr, (command, out.returncode, out.stderr)
    out = run_hook(clone, env, "git status")
    assert out.returncode == 2 and "cannot be read word by word" in out.stderr, out.stderr
    assert run_hook(clone, env, "ls -la").returncode == 0


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
# gate-r3 adversarial round (2026-09-19). Each test names the finding id it
# closes (or, where the round's own analysis found closing it impossible at
# this layer, "residual" -- pinning CURRENT behaviour so the gap is never
# silently claimed closed by a later change). tmp_path (not the shared `two`
# fixture) is used wherever a test adds a file to the shim directory, so no
# test pollutes another's PATH.
# --------------------------------------------------------------------------- #

def _shim_dir(env) -> pathlib.Path:
    return pathlib.Path(env["PATH"].split(os.pathsep)[0])


def test_r3_a_renamed_gh_symlink_merging_an_owned_pr_is_blocked(tmp_path):
    """shell-renamed-gh-direct-merge: a symlink to the real gh shim, invoked
    under a name holding neither "gh" nor "pr"/"merge" as a literal word,
    still runs gh -- CONFIRMED exit 0 before _is_program()'s identity
    fallback existed."""
    clone, h, env = build(tmp_path, {"2": OWNED})
    renamed = _shim_dir(env) / "octocli"
    renamed.symlink_to(_shim_dir(env) / "gh")
    for command in (f"octocli pr merge 2 --squash --match-head-commit {h['2']}",
                    f"{renamed} pr merge 2 --squash --match-head-commit {h['2']}",
                    f"nohup octocli pr merge 2 --squash --match-head-commit {h['2']}"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "changes what the audit gate owns" in out.stderr


def test_r3_a_renamed_gh_symlink_with_no_flags_at_all_is_still_checked(tmp_path):
    """The bypass report's own sharpest case: dropping --match-head-commit
    entirely (`octocli pr merge 2`) must still reach the pin check, not fall
    through as an uncounted invocation."""
    clone, h, env = build(tmp_path, {"1": CLEAN})
    renamed = _shim_dir(env) / "octocli"
    renamed.symlink_to(_shim_dir(env) / "gh")
    out = run_hook(clone, env, "octocli pr merge 1")
    assert out.returncode == 2 and "--match-head-commit" in out.stderr, out.stderr


def test_r3_an_independently_copied_gh_binary_is_still_not_recognized_residual(tmp_path):
    """Residual, stated plainly rather than claimed closed (ADR 0090): the
    identity fallback resolves a SYMLINK or PATH-relative rename to the same
    file gh would run as; it cannot do that for an INDEPENDENTLY BUILT OR
    COPIED binary with the same behaviour but a different inode. Pinned so
    this gap is never silently claimed closed by a later change here."""
    clone, h, env = build(tmp_path, {"2": OWNED})
    copy_path = _shim_dir(env) / "reviewtool"
    shutil.copy2(_shim_dir(env) / "gh", copy_path)
    copy_path.chmod(0o755)
    out = run_hook(clone, env, f"reviewtool pr merge 2 --squash --match-head-commit {h['2']}")
    assert out.returncode == 0, out.stderr  # residual: a copy is not caught


def test_r3_a_renamed_gh_alias_plant_is_blocked(tmp_path):
    """shell-renamed-gh-alias-plant: the same renamed binary defeats the
    literal-"gh" alias-set check (H18) too, planting a persistent alias a
    later plain `gh <alias>` would invoke unaudited."""
    clone, h, env = build(tmp_path, {"2": OWNED})
    renamed = _shim_dir(env) / "octocli"
    renamed.symlink_to(_shim_dir(env) / "gh")
    out = run_hook(clone, env, f"octocli alias set zz 'pr merge 2 --squash "
                               f"--match-head-commit {h['2']}'")
    assert out.returncode == 2 and "alias" in out.stderr, out.stderr


def test_r3_a_renamed_git_symlink_pushing_to_main_is_blocked(tmp_path):
    """shell-renamed-git-direct-push: DIRECT_PUSH_PATTERN requires the literal
    word "git"; a symlink to the real git binary was invisible to it."""
    clone, _h, env = build(tmp_path, {"1": CLEAN})
    real_git = shutil.which("git")
    assert real_git, "git must be on PATH to run this test at all"
    renamed = _shim_dir(env) / "vcstool"
    renamed.symlink_to(real_git)
    for command in ("vcstool push origin main", f"{renamed} -C ../x push origin main --force",
                    "vcstool push origin HEAD:main"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "direct pushes to main" in out.stderr
    assert run_hook(clone, env, "vcstool push origin feat/x").returncode == 0


def test_r3_an_independently_copied_git_binary_is_still_not_recognized_residual(tmp_path):
    """Residual, same shape as the gh one above: an independent COPY of the
    real git binary (different inode) is not caught by the identity
    fallback. Pinned so this gap is never silently claimed closed."""
    clone, _h, env = build(tmp_path, {"1": CLEAN})
    real_git = shutil.which("git")
    assert real_git
    copy_path = _shim_dir(env) / "srcctl"
    shutil.copy2(real_git, copy_path)
    copy_path.chmod(0o755)
    out = run_hook(clone, env, "srcctl push origin main")
    assert out.returncode == 0, out.stderr  # residual: a copy is not caught


@pytest.mark.parametrize("command", [
    "git push", "git push origin", "git push --mirror origin", "git push --all origin",
])
def test_r3_a_bare_or_broad_push_is_blocked(two, command):
    """path-push-bare-and-broad: the real destination of a push with no
    literal refspec (or --mirror/--all) depends on local config
    (push.default, branch tracking, remote.pushDefault) this hook never
    reads -- on a repo with ~90 worktrees, routinely main."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "direct pushes to main" in out.stderr


@pytest.mark.parametrize("command", [
    "git --no-pager push origin main", "git -c core.pager=cat push origin main",
    "git subtree push --prefix=apps/web origin main",
])
def test_r3_a_global_flag_other_than_the_one_hardcoded_c_is_still_caught(two, command):
    """path-push-token-between-git-and-push: DIRECT_PUSH_PATTERN tolerates
    exactly one hardcoded `-C <path>` between "git" and "push"; any other
    token there (or `subtree push`) was missed."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "direct pushes to main" in out.stderr


def test_r3_both_direct_push_checks_are_independently_load_bearing(tmp_path):
    """DIRECT_PUSH_PATTERN (pre-existing) and _direct_push_problem() (gate-r3)
    are two SEPARATE, ADDITIVE checks on "git push origin main" -- by design,
    to avoid touching DIRECT_PUSH_PATTERN's own finely-tuned, separately
    pinned history (scripts/pr_audit_gate.py's self-test). Removing either
    ALONE must not change the outcome (the other still catches it); removing
    BOTH must."""
    source = HOOK.read_text()
    old_pattern_check = "    if DIRECT_PUSH_PATTERN.search(command):\n"
    old_problem_check = "    push_problem = _direct_push_problem(command)\n"
    assert source.count(old_pattern_check) == 1 and source.count(old_problem_check) == 1

    counter = iter(range(10))

    def built(src):
        sub = tmp_path / str(next(counter))
        sub.mkdir()
        clone, _h, env = build(sub, {"1": CLEAN}, hook_source=src)
        return run_hook(clone, env, "git push origin main").returncode

    assert built(source) == 2, "control: the real hook blocks it"
    assert built(source.replace(old_pattern_check, "    if False:\n", 1)) == 2, \
        "removing DIRECT_PUSH_PATTERN's own check alone must not change the outcome"
    assert built(source.replace(old_problem_check, "    push_problem = None\n", 1)) == 2, \
        "removing _direct_push_problem() alone must not change the outcome"
    both = source.replace(old_pattern_check, "    if False:\n", 1) \
                 .replace(old_problem_check, "    push_problem = None\n", 1)
    assert built(both) == 0, "removing BOTH must actually change the outcome"


def test_r3_a_pushing_git_alias_is_blocked(tmp_path, monkeypatch):
    """path-git-level-alias: a `git config alias.<name>` collapses an entire
    push-to-main into one word carrying neither "push" nor "main"."""
    clone, _h, env = build(tmp_path, {"1": CLEAN})
    # LOCAL, not --global: env carries GIT_CONFIG_GLOBAL=os.devnull (test
    # isolation from the real global gitconfig), so a --global write here
    # would silently go nowhere. The hook's own `git config --get` runs with
    # cwd=ROOT, which resolves to this same clone, so a local alias here is
    # exactly what it will read.
    subprocess.run(["git", "config", "alias.shipit", "!git push origin HEAD:main"],
                   cwd=clone, check=True, env=env)
    out = run_hook(clone, env, "git shipit")
    assert out.returncode == 2, out.stderr
    assert "alias" in out.stderr and "push" in out.stderr
    # An unrecognized subcommand that is NOT an alias, and does not resolve to
    # one, is left alone (CANNOT-CHECKING every unknown git subcommand would
    # make ordinary git usage unusable).
    assert run_hook(clone, env, "git status").returncode == 0


def test_r3_curl_and_similar_hitting_the_pr_merge_endpoint_are_blocked(two):
    """path-http-api-clients: curl/wget/python/node hitting GitHub's REST
    merge endpoint directly, no `gh pr merge` text anywhere."""
    clone, _h, env = two
    url = "https://api.github.com/repos/aldemirkonuk/RestaurantAIAutomation/pulls/42/merge"
    for command in (
        f"curl -X PUT -H \"Authorization: token $GH_TOKEN\" {url} -d '{{\"merge_method\":\"squash\"}}'",
        f"wget --method=PUT --header=\"Authorization: token $GH_TOKEN\" {url} --body-data='{{}}'",
        f"python3 -c \"import requests; requests.put('{url}')\"",
        f"node -e \"fetch('{url}',{{method:'PUT'}})\"",
    ):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "REST merge endpoint" in out.stderr


def test_r3_gh_api_graphql_merge_mutations_are_blocked(two):
    """path-graphql-merge-mutations: no bounded `\\bpr\\b` word in the
    command ("pullRequestId"/"PullRequest" contain no isolated "pr"), even
    though `gh` itself is running it."""
    clone, _h, env = two
    for mutation in ("mergePullRequest", "enablePullRequestAutoMerge"):
        command = f"gh api graphql -f query='mutation {{ {mutation}(input: {{pullRequestId: \"x\"}}) {{ clientMutationId }} }}'"
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert "GraphQL mutation" in out.stderr


def test_r3_the_base_repo_merges_endpoint_is_blocked(two):
    """path-merges-endpoint-no-pr: GitHub's base-repo Merges API creates a
    merge commit with no pull request involved at all -- no PR number to pin
    a marker or an ownership check to, so this is an outright block."""
    clone, _h, env = two
    out = run_hook(clone, env, "gh api -X POST repos/aldemirkonuk/RestaurantAIAutomation/merges "
                               "-f base=main -f head=feature-branch")
    assert out.returncode == 2, out.stderr
    assert "Merges API" in out.stderr


def test_r3_settings_route_exec_capable_tool_names_to_the_hook():
    """path-exec-surface-outside-matcher, part 1: the matcher is widened
    beside the existing merge pattern so a same-ecosystem exec-capable tool
    (a terminal runner, a sandbox, a batched computer-use call) is at least
    seen, mirroring test_h10b's own method."""
    settings = json.loads((ROOT / ".claude" / "settings.json").read_text())
    entry = next(e for e in settings["hooks"]["PreToolUse"]
                 if any("require_pr_audit.py" in h["command"] for h in e["hooks"]))
    matcher = re.compile(f"^(?:{entry['matcher']})$")
    for tool in ("mcp__terminal__run_in_terminal", "mcp__terminal__open_terminal_tab",
                 "mcp__f2d8890f__sandbox_exec", "mcp__computer-use__computer_batch",
                 "mcp__Claude_Code_iOS_Simulator__control", "mcp__ccd_directory__change_directory"):
        assert matcher.match(tool), tool
    # Residual, stated plainly: a wholly novel, unlisted tool name is not
    # matched by any name pattern, closed or not.
    assert not matcher.match("mcp__some_future_tool__do_a_thing")


def test_r3_a_merge_command_inside_a_non_bash_tools_input_is_blocked(two):
    """path-exec-surface-outside-matcher, part 2: once such a tool IS routed
    to the hook, its own input is scanned the same way a Bash command's is,
    regardless of the tool's own name -- CONFIRMED exit 0 for six real tool
    names before this, each carrying a complete gh pr merge command."""
    clone, h, env = two
    command = f"{M} 2 --squash --match-head-commit {h['2']}"
    for tool in ("mcp__terminal__run_in_terminal", "mcp__f2d8890f__sandbox_exec"):
        payload = json.dumps({"tool_name": tool, "tool_input": {"command": command}})
        out = subprocess.run([sys.executable, "-I", str(clone / "scripts" / "hooks" / "require_pr_audit.py")],
                             input=payload, capture_output=True, text=True, env=env, timeout=300)
        assert out.returncode == 2, (tool, out.stderr)
    # A tool whose input carries nothing merge- or push-shaped is unaffected.
    payload = json.dumps({"tool_name": "mcp__terminal__run_in_terminal", "tool_input": {"command": "ls -la"}})
    out = subprocess.run([sys.executable, "-I", str(clone / "scripts" / "hooks" / "require_pr_audit.py")],
                         input=payload, capture_output=True, text=True, env=env, timeout=300)
    assert out.returncode == 0, out.stderr


@pytest.mark.parametrize("name", ["mcp__github__mergepr", "mcp__github__automergepr"])
def test_r3_lowercase_collapsed_mcp_merge_names_are_blocked(two, name):
    """path-mcp-lowercase-collapse: the word-splitter needs a case
    transition; an all-lowercase joined name was one token matching neither
    "merge" nor a companion word."""
    clone, _h, env = two
    out = run_hook(clone, env, "", tool=name)
    assert out.returncode == 2, (name, out.stderr)


def test_r3_a_bare_merge_word_mcp_tool_is_still_not_caught_residual(two):
    """path-mcp-bare-merge-word, an explicit residual (ADR 0090): "merge"
    alone, with no companion word, is not enough to flag a tool -- treating
    it as enough would also block mcp__c96b062f__merge_branch, a real,
    unrelated Supabase DB-branch-merge tool. Pinned so this gap is never
    silently claimed closed."""
    clone, _h, env = two
    out = run_hook(clone, env, "", tool="mcp__github__merge_now")
    assert out.returncode == 0, out.stderr  # residual: not caught


def test_r3_a_marker_carrying_only_a_sha_prefix_does_not_validate(two):
    """sha-prefix-collision: the marker's sha must equal the PR's full head,
    never merely be a prefix of it -- a 7-char marker (SKILL.md's own
    documented format until this round) validated ANY commit sharing that
    prefix, demonstrated with two genuine git commits mined 7 hex chars
    apart, one benign and one carrying a backdoor."""
    clone, h, env = two
    out = run_hook(clone, {**env, "SHIM_MARKER": "shortsha"}, f"{M} 1 --squash --match-head-commit {h['1']}")
    assert out.returncode == 2, out.stderr
    assert "no PASS verdict found" in out.stderr


@pytest.mark.parametrize("kind", ["mixed", "mixedrev"])
def test_r3_a_trusted_block_vetoes_a_coexisting_trusted_pass(two, kind):
    """verdict-any-match-wins: returning True on the first matching trusted
    PASS, without checking for a trusted BLOCK on the identical pr+sha, let a
    non-deterministic re-audit roll PASS once, ever, to permanently outvote
    an existing BLOCK for the same commit -- CONFIRMED in both orderings."""
    clone, h, env = two
    out = run_hook(clone, {**env, "SHIM_MARKER": kind}, f"{M} 1 --squash --match-head-commit {h['1']}")
    assert out.returncode == 2, (kind, out.stderr)
    assert "no PASS verdict found" in out.stderr


def test_r3_a_self_posted_marker_from_the_current_gh_user_still_merges_residual(two):
    """self-forged-pass-marker: an explicit OPEN DECISION, not a closed gap
    (see .planning/decisions/OPEN-DECISIONS.md and ADR 0090's residual list).
    _current_gh_user() is unconditionally trusted, so a PASS comment authored
    by "tester" (this shim's own `gh api user` identity, modelling whoever is
    running gh right now) still merges even though nothing produced that
    verdict but the comment itself. Pinned so this residual is never silently
    claimed closed by a later change to this file."""
    clone, h, env = two
    out = run_hook(clone, {**env, "SHIM_MARKER": "selfposted"}, f"{M} 1 --squash --match-head-commit {h['1']}")
    assert out.returncode == 0, out.stderr  # residual: still merges


# --------------------------------------------------------------------------- #
# gate-r4 last-call round (2026-09-19, r4-gate.json: the gate-r3 adversarial
# round's own last call against its FIXES). Finding 1 (BLOCKER): gate-r3's
# _github_api_merge_reason() blocked a literal-PR `gh api .../pulls/<n>/merge`
# outright -- the founder's own documented, previously-working owned-PR route
# (ADR 0090:173/242, this hook's own docstring point 7, SKILL.md step 4),
# silently reversed with no test and no ADR mention. Finding 6: the literal-PR
# requirement that made that block possible had its own hole -- a shell
# variable in the PR-number slot matched neither the block nor anything else
# and ran completely unchecked. Finding 5: three ways a push reaches main with
# no literal "main" in the command text.
# --------------------------------------------------------------------------- #

def test_r4_owned_pr_gh_api_with_a_literal_pr_number_stays_ungated(two):
    """r4-gate.json finding 1, BLOCKER: restored. This path is deliberately
    NOT matched at all (ADR 0090:242, "stays ungated on purpose"), so it must
    exit 0 with no gh/git interaction ever happening -- the `two` fixture's
    clone and shim are reused only because run_hook resolves the hook script
    from inside a checkout; neither PR's state is read on this path."""
    clone, _h, env = two
    out = run_hook(clone, env, f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}")
    assert out.returncode == 0, out.stderr


@pytest.mark.parametrize("command", [
    f"N=2; gh api -X PUT repos/{REPO}/pulls/$N/merge -f sha={'d' * 40}",
    f"N=2; curl -X PUT -H \"Authorization: token $GH_TOKEN\" "
    f"https://api.github.com/repos/{REPO}/pulls/$N/merge -d '{{}}'",
])
def test_r4_a_shell_variable_pr_number_on_the_api_path_is_refused(two, command):
    """r4-gate.json finding 6, HIGH: `_PR_MERGE_ENDPOINT_RE` required `\\d+`,
    so a shell-variable PR number matched neither the (then-unconditional)
    block nor anything else and ran completely unaudited -- CONFIRMED exit 0
    before this fix, for both `gh api` and a plain curl. `gh pr merge` itself
    refuses a non-literal PR (H6); this closes the same gap on the API path,
    for every client, not only `gh api`."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "non-literal PR number" in out.stderr, out.stderr


# --------------------------------------------------------------------------- #
# gate-r4 residual CLOSED (2026-09-19): `gh api` respelled. `_GH_API_RE` read
# only the literal substring "gh api", so a quoted, IFS-split, brace-split,
# expanded or symlinked/renamed gh running `api` was never recognised as gh --
# `talks_to_github` stayed False and every merge-surface check (non-literal PR
# number, GraphQL merge mutation, base /merges endpoint) was skipped. Each
# case below exited 0 before _gh_api_reading() existed. A LITERAL PR number
# through a recognised gh api stays ungated exactly as when plainly spelled
# (ADR 0090:242); only the surfaces that were always blocked are the ones
# a respelling used to escape.
# --------------------------------------------------------------------------- #

# (arguments after `api`, the reason the hook must give)
API_SURFACES = {
    "non_literal_pr": (f"-X PUT repos/{REPO}/pulls/$N/merge -f sha={'d' * 40}", "non-literal PR number"),
    "graphql": ("graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) "
                "{ clientMutationId } }'", "GraphQL mutation"),
    "base_merges": (f"-X POST repos/{REPO}/merges -f base=main -f head=feature-branch", "Merges API"),
}
# Spellings a reader of the literal text "gh api" cannot see. `{}` is where the
# arguments go. GH_WORD ones respell the `gh` word and read as gh api outright;
# API_WORD ones respell the `api` word (unplain_gh_word() already refuses any
# non-plain word right after a literal gh, so with a LITERAL PR these exit 2 for
# that older reason -- the surfaces below are what only this reading names);
# UNSURE ones are only "maybe" gh (a word the shell expands), so a merge surface
# is refused and the literal-PR exemption is not extended to them.
GH_WORD_SPELLINGS = {
    "ifs_braced": "gh${{IFS}}api {}",
    "ifs_bare_then_quoted": "gh$IFS'api' {}",
    "ifs_substring": "gh${{IFS%?}}api {}",
    "double_quoted_gh": '"gh" api {}',
    "single_quoted_gh": "'gh' api {}",
    "backslashed_gh": "g\\h api {}",
    "brace_split": "{{gh,api}} {}",
    "wrapped_in_env": "env X=1 \"gh\" api {}",
}
API_WORD_SPELLINGS = {
    "quoted_api": 'gh "api" {}',
    "quote_split_api": 'gh ap""i {}',
    "ansi_c_api": "gh $'api' {}",
}
UNSURE_SPELLINGS = {
    "gh_in_a_variable": "G=gh; $G api {}",
    "gh_from_a_substitution": "$(command -v gh) api {}",
    "api_in_a_variable": "S=api; gh $S {}",
    "api_built_by_a_substitution": "gh ap$()i {}",
}
ALL_SPELLINGS = {**GH_WORD_SPELLINGS, **API_WORD_SPELLINGS, **UNSURE_SPELLINGS}


def _api_command(spelling: str, surface: str) -> str:
    return spelling.format(API_SURFACES[surface][0])


@pytest.mark.parametrize("surface", list(API_SURFACES))
@pytest.mark.parametrize("spelling", list(ALL_SPELLINGS))
def test_r4_a_respelled_gh_api_reaches_the_same_merge_checks(two, spelling, surface):
    clone, _h, env = two
    command = _api_command(ALL_SPELLINGS[spelling], surface)
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert API_SURFACES[surface][1] in out.stderr, (command, out.stderr)


@pytest.mark.parametrize("spelling", list(GH_WORD_SPELLINGS))
def test_r4_a_recognised_respelling_with_a_literal_pr_is_ungated_like_the_plain_spelling(two, spelling):
    """The founder's literal-PR `gh api` route is ungated on purpose (ADR 0090:242).
    Recognising a respelling must not change that: it reads as the same command,
    so it gets the same answer the plain spelling gets (exit 0), not a stricter one."""
    clone, _h, env = two
    args = f"-X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}"
    plain = run_hook(clone, env, f"gh api {args}")
    assert plain.returncode == 0, plain.stderr
    command = GH_WORD_SPELLINGS[spelling].format(args)
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


@pytest.mark.parametrize("spelling", list(UNSURE_SPELLINGS))
def test_r4_an_unsure_respelling_with_a_literal_pr_is_refused_not_exempted(two, spelling):
    """A word the shell expands MAY be gh; the exemption is only for what is
    recognised as gh api, so a literal PR through one is refused, naming why."""
    clone, _h, env = two
    command = UNSURE_SPELLINGS[spelling].format(f"-X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}")
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "cannot confirm is gh" in out.stderr, out.stderr


@pytest.mark.parametrize("surface", list(API_SURFACES))
def test_r4_a_renamed_gh_symlink_running_api_reaches_the_same_merge_checks(tmp_path, surface):
    """The identity fallback (_is_program), as for `gh pr merge` in gate-r3: a
    symlink to the real gh, spelled by name, by full path, behind a wrapper, or
    inside a quoted string another shell runs. Each was exit 0 before."""
    clone, _h, env = build(tmp_path, {"2": OWNED})
    renamed = _shim_dir(env) / "octocli"
    renamed.symlink_to(_shim_dir(env) / "gh")
    args, reason = API_SURFACES[surface]
    for command in (f"octocli api {args}", f"{renamed} api {args}", f"nohup octocli api {args}",
                    f"bash -c 'octocli api {args.replace(chr(39), chr(34))}'"):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)
        assert reason in out.stderr, (command, out.stderr)
    # The same symlink with a literal PR is the ungated route, same as plain.
    literal = f"octocli api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}"
    assert run_hook(clone, env, literal).returncode == 0


def test_r4_the_identity_fallback_is_load_bearing_for_a_renamed_gh_on_the_api_path(tmp_path):
    """Mutation of the identity fallback in _gh_api_reading: with it reduced to
    the literal word `gh` / a path ending in /gh, the symlink is invisible."""
    source = HOOK.read_text()
    old = '                    literal_gh = _is_program(cooked, "gh")\n'
    assert source.count(old) == 1, source.count(old)
    mutant = source.replace(
        old, '                    literal_gh = cooked.lower() == "gh" or cooked.lower().endswith("/gh")\n', 1)
    args, _reason = API_SURFACES["non_literal_pr"]
    results = []
    for n, src in enumerate((source, mutant)):
        sub = tmp_path / str(n)
        sub.mkdir()
        clone, _h, env = build(sub, {"2": OWNED}, hook_source=src)
        (_shim_dir(env) / "octocli").symlink_to(_shim_dir(env) / "gh")
        results.append(run_hook(clone, env, f"octocli api {args}").returncode)
    assert results == [2, 0], results


@pytest.mark.parametrize("command", [
    f"gh api repos/{REPO}/pulls/2/comments",
    "gh${IFS}api user",
    "gh issue view 2",
    "octocli api user",
    f"echo repos/{REPO}/pulls/$N/merge",
    "git commit -m 'notes on gh api'",
    "ls -la",
])
def test_r4_ordinary_commands_are_untouched_by_the_wider_gh_api_reading(two, command):
    """Only a command that names a merge surface is read word by word at all, and
    a gh api call that names none is not a merge. (`octocli` here is not on PATH.)"""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


def test_r4_a_respelled_gh_api_inside_a_non_bash_tools_input_is_blocked(two):
    clone, _h, env = two
    command = _api_command(GH_WORD_SPELLINGS["ifs_braced"], "non_literal_pr")
    for tool in ("mcp__terminal__run_in_terminal", "mcp__f2d8890f__sandbox_exec"):
        out = run_hook(clone, env, command, tool=tool)
        assert out.returncode == 2 and "non-literal PR number" in out.stderr, (tool, out.stderr)


def test_r4_a_reader_that_cannot_read_the_command_refuses_rather_than_passes(tmp_path):
    """The word reader failing must not read as "not gh api": a crash injected
    into _lex, and a command nested past its limit, both refuse a merge surface
    (the command is built so no regex reading recognises it first). A command
    naming neither gh nor pr never reaches the reader and still passes (gate-r8:
    nor git nor push, which the push check now reads with the same reader)."""
    source = HOOK.read_text()
    head = "def _lex(s: str, i: int, closer: str | None, depth: int, report: dict | None = None):\n"
    assert source.count(head) == 1
    crashing = source.replace(head, head + "    raise RuntimeError('injected')\n", 1)
    clone, _h, env = build(tmp_path, {"2": OWNED}, hook_source=crashing)
    args, reason = API_SURFACES["graphql"]
    out = run_hook(clone, env, f"S=api; gh $S {args}")
    assert out.returncode == 2 and reason in out.stderr and "cannot confirm is gh" in out.stderr, out.stderr
    assert run_hook(clone, env, "ls -la").returncode == 0
    deep = "S=api; " + "$(" * 22 + f"$P $S {args}" + ")" * 22  # no gh/pr word: only this reader can refuse it
    sub = tmp_path / "real"
    sub.mkdir()
    clone2, _h2, env2 = build(sub, {"2": OWNED})
    out = run_hook(clone2, env2, deep)
    assert out.returncode == 2 and reason in out.stderr, out.stderr


@pytest.mark.parametrize("command", [
    # a gh and an api both built by expansion: the word after `$G` is `$A`, never `api`.
    f"G=gh; A=api; $G $A -X PUT repos/{REPO}/pulls/$N/merge -f sha={'d' * 40}",
])
def test_r4_the_named_gh_api_residuals_are_still_not_seen(two, command):
    """Pins the residuals the hook's comment above _gh_api_reading and ADR 0090's
    gate-r4 section name, so none is silently claimed closed by a later change.
    (`gh${IFS}pr${IFS}merge` is a different surface: it is in NOT_SEEN above.)"""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


def test_r4_an_independently_copied_gh_binary_running_api_is_still_not_recognized_residual(tmp_path):
    """Same residual as the pr-merge one (gate-r3): the identity fallback follows
    a symlink or a PATH rename to the file gh runs as, never a separately built
    or copied binary (a different inode). Pinned so it is never silently claimed closed."""
    clone, _h, env = build(tmp_path, {"2": OWNED})
    copy_path = _shim_dir(env) / "reviewtool"
    shutil.copy2(_shim_dir(env) / "gh", copy_path)
    copy_path.chmod(0o755)
    args, _reason = API_SURFACES["non_literal_pr"]
    out = run_hook(clone, env, f"reviewtool api {args}")
    assert out.returncode == 0, out.stderr  # residual: a copy is not caught


@pytest.mark.parametrize("command", [
    "git push origin HEAD", "git push origin @",
    # r5-gate.json must-fix 3 (2026-09-20): "+" is git's own force-push
    # marker on a refspec -- `_push_reason` compared `src` to ("HEAD", "@")
    # BEFORE stripping it, so "+HEAD"/"+@" matched neither that check nor
    # anything else in the function and fell through to allowed. CONFIRMED
    # exit 0 before this fix, and confirmed live against a local bare origin
    # that `git push origin +HEAD` from a checkout of `main` really does
    # move the remote's `main` (this round's own fresh bypass of the fix
    # right above it, not named when that fix shipped).
    "git push origin +HEAD", "git push origin +@",
])
def test_r4_push_head_or_at_with_no_explicit_destination_is_blocked(two, command):
    """path-push-refspec-ambiguous: a bare `HEAD`/`@` refspec names the
    remote branch after the CURRENT LOCAL BRANCH, which this hook has never
    read -- CONFIRMED exit 0 before this fix, and confirmed live against a
    local bare origin that a checkout of `main` running either command really
    does move the remote's `main`. The force-push ("+") variants are the same
    shape with the same real consequence; see the parametrize list above for
    why they needed their own, separate fix."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "current local branch" in out.stderr


def test_r4_push_wildcard_refspec_is_blocked(two):
    """path-push-refspec-ambiguous: `refs/heads/*:refs/heads/*` matches every
    local branch, main included if one exists -- CONFIRMED exit 0 before this
    fix, and confirmed live to really move the remote's `main`."""
    clone, _h, env = two
    out = run_hook(clone, env, "git push origin 'refs/heads/*:refs/heads/*'")
    assert out.returncode == 2, out.stderr
    assert "wildcard" in out.stderr


def test_r4_push_to_a_same_command_variable_resolving_to_main_is_blocked(two):
    """path-push-refspec-ambiguous: `B=main; git push origin HEAD:$B` is ONE
    command; this hook already reasons about one command at a time (point 21's
    own residual says so explicitly), so a plain assignment earlier in that
    same command is read the way the shell itself would -- CONFIRMED exit 0
    before this fix."""
    clone, _h, env = two
    out = run_hook(clone, env, "B=main; git push origin HEAD:$B")
    assert out.returncode == 2, out.stderr
    assert "directly to main" in out.stderr


def test_r4_a_same_command_variable_resolving_to_a_non_main_branch_stays_allowed(two):
    """Positive control for the same fix: `HEAD:$B` is not inherently
    suspicious -- when a same-command assignment resolves it to something
    that plainly is not main, the push is allowed, the same as any other
    named-branch push. Also the case that actually distinguishes "resolution
    ran" from "resolution was skipped, so treat as unresolved" -- both
    B=main and an unset $B end up blocked either way, but this does not."""
    clone, _h, env = two
    out = run_hook(clone, env, "B=develop; git push origin HEAD:$B")
    assert out.returncode == 0, out.stderr


def test_r4_an_unresolvable_variable_destination_from_a_non_head_source_is_not_blocked(two):
    """Negative control, so the fix above does not overreach: a variable
    destination is only suspicious when paired with a HEAD/@ source (the
    demonstrated bypass shape) or when it actually resolves to main.
    `git push origin feature:$UNRELATED`, with no assignment anywhere in the
    command, is an ordinary scripted push to a named branch that has nothing
    to do with main and must stay allowed."""
    clone, _h, env = two
    out = run_hook(clone, env, "git push origin feature:$UNRELATED")
    assert out.returncode == 0, out.stderr


def test_r4_a_command_substitution_disguised_as_a_simple_assignment_is_not_trusted(two):
    """SELF-ADVERSARIAL finding, fixed before this round ever shipped:
    `_SHELL_PUNCTUATION` includes "(" and a backtick, so the tokenizer
    itself splits `B=$(echo main)` into "B=$", "(", "echo", "main", ");" ...
    and `` B=`echo main`; `` into "B=", "`", "echo", "main", "`;" ... . A
    first version of _collect_assignments read `NAME=value` per already-split
    segment and trusted the fragment ("$", or "") as B's whole value,
    concluded it plainly was not main, and let `HEAD:$B` through even though
    the shell's real value of $B is main. Both forms must still be blocked."""
    clone, _h, env = two
    for command in (
        "B=$(echo main); git push origin HEAD:$B",
        "B=`echo main`; git push origin HEAD:$B",
    ):
        out = run_hook(clone, env, command)
        assert out.returncode == 2, (command, out.stderr)


def test_r4_monitor_is_routed_to_the_hook():
    """path-exec-surface-outside-matcher (gate-r3) widened the matcher for six
    tool families; the built-in Monitor tool runs a shell command in the same
    shell environment as Bash and was not among them -- CONFIRMED with
    `re.search`, the widened pattern did not match "Monitor". Same method as
    test_r3_settings_route_exec_capable_tool_names_to_the_hook."""
    settings = json.loads((ROOT / ".claude" / "settings.json").read_text())
    entry = next(e for e in settings["hooks"]["PreToolUse"]
                 if any("require_pr_audit.py" in h["command"] for h in e["hooks"]))
    matcher = re.compile(f"^(?:{entry['matcher']})$")
    assert matcher.match("Monitor")


# --------------------------------------------------------------------------- #
# gate-r6 (2026-09-21): the founder's own two review-trail answers, named as
# residuals (not yet code) in ADR 0090's gate-r5 section. Both are proven
# failing-then-passing below: run against a hook source with the fix's own
# line reverted (build()'s hook_source= override, the same mechanism
# HOOK_MUTATIONS uses), the scenario gives the PRE-FIX (wrong) exit; against
# the real, unmodified hook file it gives the FIXED exit. HOOK_MUTATIONS below
# pins the same pair permanently (r6_gh_api_segment_binding, r6_export_assignment).
# --------------------------------------------------------------------------- #

def test_r6_gh_api_exemption_is_bound_to_the_segment_that_calls_the_merge_endpoint(two, tmp_path):
    """Founder, verbatim: "Bind it to the segment." ADR 0090's gate-r5 section
    named this as a residual, not code: the gh-api reading that grants the
    literal-PR exemption was computed over the WHOLE command, so a `gh api`
    call anywhere exempted a merge call made by a DIFFERENT program elsewhere
    in the SAME command. CONFIRMED failing on a build with the binding check
    removed (the pre-fix exemption): the hook's own verdict on `gh api user
    >/dev/null; curl -X PUT https://api.github.com/repos/<repo>/pulls/2/merge`
    is exit 0. (Nothing in this harness reaches GitHub, so nothing is merged:
    the exit code IS the finding.) Fixed: the exemption is granted only when
    no command segment names the endpoint without itself being the
    recognised `gh api` call (_merge_call_outside_gh_api)."""
    clone, h, env = two
    command = (f"gh api user >/dev/null; curl -X PUT "
               f"https://api.github.com/repos/{REPO}/pulls/2/merge -d '{{}}'")
    reverted = HOOK.read_text().replace(
        '        if gh_api == "gh-api" and not _merge_call_outside_gh_api(text):\n',
        '        if gh_api == "gh-api":\n', 1)
    assert reverted != HOOK.read_text()  # the target line really is there once
    pre_fix_clone, _pre_fix_h, pre_fix_env = build(tmp_path, {"1": CLEAN, "2": OWNED}, hook_source=reverted)
    pre_fix_out = run_hook(pre_fix_clone, pre_fix_env, command)
    assert pre_fix_out.returncode == 0, (  # FAILING: the bug exempts this
        "reverted-line build unexpectedly still blocks -- the scenario no "
        "longer isolates this fix", pre_fix_out.stderr)
    out = run_hook(clone, env, command)  # PASSING: the real, fixed hook
    assert out.returncode == 2, out.stderr
    assert "calls GitHub's REST merge endpoint" in out.stderr, out.stderr
    # Order-independence: the unrelated gh api call after the real merge call
    # must not retroactively exempt it either.
    reordered = (f"curl -X PUT https://api.github.com/repos/{REPO}/pulls/2/merge -d '{{}}'; "
                 f"gh api user >/dev/null")
    out2 = run_hook(clone, env, reordered)
    assert out2.returncode == 2, out2.stderr
    # Control: the founder's own documented owned-PR route, alone in its own
    # segment with nothing else in the command, stays ungated exactly as before.
    solo = run_hook(clone, env, f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}")
    assert solo.returncode == 0, solo.stderr


def test_r6_export_prefixed_assignment_resolves_a_push_destination(two, tmp_path):
    """Founder, verbatim: "Teach it export." ADR 0090's gate-r5 section named
    this as a residual, not code: `export B=main; git push origin feat:$B`
    reached main with no literal "main" anywhere `_push_reason()` could see,
    because a leading `export` token matched neither `_SIMPLE_ASSIGNMENT_RE`
    (no `=`) nor a statement separator, so `_collect_assignments` took the
    "the command itself starts here" branch and the `B=main` token right
    after `export` was skipped outright. CONFIRMED failing on the reverted
    line, live against a local bare origin: the push landed on remote main."""
    clone, _h, env = two
    command = "export B=main; git push origin feat:$B"
    reverted = HOOK.read_text().replace(
        '        if at_start and tok == "export":\n', "        if False:\n", 1)
    assert reverted != HOOK.read_text()
    pre_fix_clone, _pre_fix_h, pre_fix_env = build(tmp_path, {"1": CLEAN, "2": OWNED}, hook_source=reverted)
    pre_fix_out = run_hook(pre_fix_clone, pre_fix_env, command)
    assert pre_fix_out.returncode == 0, (  # FAILING: the bug lets this through
        "reverted-line build unexpectedly still blocks -- the scenario no "
        "longer isolates this fix", pre_fix_out.stderr)
    # Not only a function-level claim: run the exact vulnerable command for
    # real (bypassing the hook entirely, the way a shell would once the hook
    # -- wrongly, pre-fix -- said ALLOW) against the same clone/origin the
    # pre-fix hook just approved it for, and confirm the LOCAL BARE ORIGIN's
    # own main ref really moves, not merely that some exit code was 0.
    before_main = git(pre_fix_clone, "ls-remote", "origin", "refs/heads/main")
    # build()'s clone has no local branch checked out (the bare origin's own
    # HEAD symref never pointed at "main", only refs/heads/main exists) --
    # every other test here only inspects the repo, never actually checks
    # anything out, so this is the first to need a real local main.
    git(pre_fix_clone, "checkout", "-q", "-B", "main", "origin/main")
    git(pre_fix_clone, "checkout", "-q", "-b", "feat")
    (pre_fix_clone / "proof.txt").write_text("export-prefixed push proof\n")
    git(pre_fix_clone, "add", "-A")
    git(pre_fix_clone, "commit", "-qm", "feat commit")
    feat_sha = git(pre_fix_clone, "rev-parse", "feat")
    push = subprocess.run(["bash", "-c", command], cwd=pre_fix_clone, env=pre_fix_env,
                          capture_output=True, text=True, timeout=60)
    assert push.returncode == 0, push.stderr  # the real push itself succeeded
    after_main = git(pre_fix_clone, "ls-remote", "origin", "refs/heads/main")
    assert after_main != before_main and feat_sha in after_main, (
        "the real push did not move the local bare origin's main ref -- the "
        "scenario no longer demonstrates a real exploit", before_main, after_main)
    out = run_hook(clone, env, command)  # PASSING: the real, fixed hook
    assert out.returncode == 2, out.stderr
    assert "main" in out.stderr, out.stderr
    # A non-main destination through the same export-prefixed shape stays
    # allowed, the same way the bare (non-exported) case already does
    # (r4_push_var_develop) -- exporting must not itself be treated as guilty.
    ok = run_hook(clone, env, "export B=develop; git push origin HEAD:$B")
    assert ok.returncode == 0, ok.stderr


# --------------------------------------------------------------------------- #
# gate-r6 LAST CALL (2026-09-21). Each case below was measured on three builds
# of the hook: HEAD before gate-r6, the first cut of the two fixes, and the
# fixed hook. The first cut read every merge surface per top-level segment
# rebuilt from _lex's words, and _lex skips a heredoc body -- so the four
# always-refused surfaces written in one exited 0 where HEAD refused them; and
# its `export` reading fed a last-value-wins collector, so two push shapes
# HEAD refused passed. Pinned here, with the founder's two answers carried one
# level down (a substitution, a quoted string another shell runs).
# --------------------------------------------------------------------------- #

_MERGE_URL = f"https://api.github.com/repos/{REPO}/pulls/2/merge"
_SHA = "d" * 40


def _nested(command: str, levels: int) -> str:
    for _ in range(levels):
        command = "bash -c " + shlex.quote(command)
    return command


@pytest.mark.parametrize("command", [
    # HEAD refused each; the first cut of "Bind it to the segment" let each through.
    f"bash <<'EOF'\ncurl -X PUT {_MERGE_URL}\nEOF",
    f"bash <<'EOF'\ngh api -X POST repos/{REPO}/merges -f base=main -f head=feat\nEOF",
    "bash <<'EOF'\ngh api graphql -f query='mutation { enablePullRequestAutoMerge(input: "
    "{pullRequestId: \"x\"}) { clientMutationId } }'\nEOF",
    f"bash <<'EOF'\ngh api -X PUT repos/{REPO}/pulls/$N/merge\nEOF",
    f"python3 - <<'EOF'\nimport urllib.request as u\nu.urlopen(u.Request('{_MERGE_URL}', method='PUT'))\nEOF",
    # HEAD and the first cut both returned early at a literal-PR gh api merge,
    # before the base Merges check and before any later merge-endpoint reference.
    f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}; "
    f"gh api -X POST repos/{REPO}/merges -f base=main -f head=x",
    f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}; gh api -X PUT repos/{REPO}/pulls/$N/merge",
])
def test_r6_a_merge_surface_in_a_heredoc_or_after_an_exempt_call_is_still_refused(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)


def test_r6_a_non_bash_tools_input_holding_a_heredoc_operator_still_refuses(two):
    """`_tool_input_text` hands the reader code, not a shell command: `1 << 2`
    read as a heredoc swallowed the rest of the input in the first cut."""
    clone, _h, env = two
    code = (f"x = 1 << 2\nrequests.post('https://api.github.com/repos/{REPO}/merges', "
            "json={'base': 'main', 'head': 'feat'})")
    out = run_hook(clone, env, code, tool="mcp__f2d8890f__sandbox_exec")
    assert out.returncode == 2 and "Merges API" in out.stderr, out.stderr


@pytest.mark.parametrize("command", [
    # "Bind it to the segment", one level down: the founder's own scenario inside
    # a string another shell runs, or a substitution. Exit 0 at HEAD and in the first cut.
    f"bash -c 'gh api user >/dev/null; curl -X PUT {_MERGE_URL}'",
    f"bash -c $'gh api user >/dev/null; curl -X PUT {_MERGE_URL}'",
    f"echo $(gh api user >/dev/null; curl -X PUT {_MERGE_URL})",
    f"echo `gh api user >/dev/null; curl -X PUT {_MERGE_URL}`",
    _nested(f"gh api user >/dev/null; curl -X PUT {_MERGE_URL}", 3),
    # `gh api` inside another program's quoted argument or a substitution is not
    # that program BEING gh api.
    f"curl -H 'X-Note: gh api' -X PUT {_MERGE_URL}",
    f"curl -X PUT {_MERGE_URL} -H \"$(echo gh api)\"",
    # An endpoint built around a substitution is still the calling segment's own.
    f"gh api user >/dev/null; curl -X PUT \"$(printf 'https://api.github.com')/repos/{REPO}/pulls/2/merge\"",
    f"gh api user >/dev/null; curl -X PUT \"{_MERGE_URL}?x=$(true)\"",
    # Past the depth bound nothing is bound, so nothing is exempted -- even the route itself.
    _nested(f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}", 4),
])
def test_r6_the_exemption_is_bound_inside_substitutions_and_nested_shells_too(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "REST merge endpoint" in out.stderr, out.stderr


@pytest.mark.parametrize("command", [
    # The founder's owned-PR route keeps its exemption wherever its own segment
    # makes the call.
    f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}",
    f"cd /tmp && gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}",
    f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha=$(git rev-parse HEAD)",
    f"R=$(gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA})",
    f"bash -c 'gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}'",
    _nested(f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA}", 2),
    f"gh api --input - -X PUT repos/{REPO}/pulls/2/merge <<'EOF'\n{{\"sha\": \"{_SHA}\"}}\nEOF",
    f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={_SHA} # merging 2",
    # Prose about the route, as HEAD read it.
    f"git commit -m 'merged via gh api -X PUT repos/{REPO}/pulls/297/merge'",
])
def test_r6_the_owned_pr_route_stays_ungated_where_its_own_segment_makes_the_call(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


@pytest.mark.parametrize("command", [
    # "Teach it export": the builtin's own flags assign exactly as the bare form.
    "export -n B=main; git push origin feat:$B",
    "export -- B=main; git push origin feat:$B",
    # HEAD refused these (an exported name was never collected, so HEAD:$B stayed
    # unresolved); the first cut resolved $B to a value the push never sees.
    "export B=main; git push origin HEAD:$B; export B=develop",
    "git push origin HEAD:$B; export B=develop",
    # Same reading, bare assignments: any main among a name's values is main.
    "export B=main; git push origin feat:$B; export B=develop",
    "B=main; false && B=develop; git push origin feat:$B",
    "git push origin HEAD:$B; B=develop",
])
def test_r6_an_assignment_the_push_may_see_is_read_in_the_safe_direction(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)


@pytest.mark.parametrize("command", [
    # Dropped text has no segment to bind to: the whole-command reading HEAD had.
    f"gh api user >/dev/null; bash <<'EOF'\ncurl -X PUT {_MERGE_URL}\nEOF",
    # gh and api as another program's plain arguments still read as gh api.
    f"curl -X PUT {_MERGE_URL} gh api",
    # A value set any way but a plain or exported NAME=value is not read --
    # and reading export like the bare form brings export to the same gaps.
    "declare -x B=main; git push origin feat:$B",
    "readonly B=main; git push origin feat:$B",
    "B=ma; B+=in; git push origin feat:$B",
    "export B=develop; eval B=main; git push origin HEAD:$B",
    # gate-r8 closed the fifth, an assignment after a punctuation run the
    # tokenizer fuses (`f() ( git push origin feat:$B ); B=main; f`): the word
    # reader splits `)` from `;`, collects B=main, and it is now refused --
    # see test_r8_closed_by_the_word_reading.
])
def test_r6_the_named_residuals_are_still_not_seen(two, command):
    """Pins what ADR 0090's gate-r6 section names as not closed, so none is
    silently claimed closed by a later change, or silently dropped.

    The env-prefix/wrapper push residual gate-r6 named here (`X=1 git push
    origin HEAD`, `nohup git push origin HEAD`) moved to gate-r7 below,
    CLOSED -- see test_r7_env_prefix_and_wrapper_pushes_are_now_blocked and
    the named residuals that replace it, test_r7_the_named_residuals_are_still_not_seen."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


# --------------------------------------------------------------------------- #
# gate-r7 (2026-09-21). Closes the residual gate-r6's own last call could only
# NAME: "a push behind an env prefix or a wrapper (`X=1 git push origin
# HEAD`, `nohup git push origin HEAD`), which `_direct_push_problem()` skips
# because the segment's first word is not git." Founder's answer, as relayed:
# a push behind leading assignments or a wrapper (nohup, env, command, time,
# exec, sudo, xargs, a shell -c with a literal string) run from a main
# checkout is read like a bare push; an unrecognised wrapper shape is refused.
# --------------------------------------------------------------------------- #

_WRAP = "git " + "push"  # spelled apart so this file's own text stays clean of a literal push


@pytest.mark.parametrize("command", [
    # The founder's own two examples, verbatim.
    "X=1 git push origin HEAD",
    "nohup git push origin HEAD",
    # Every other named wrapper, bare, each read exactly like a bare push.
    "env git push origin HEAD",
    "command git push origin HEAD",
    "time git push origin HEAD",
    "exec git push origin HEAD",
    "sudo git push origin HEAD",
    "xargs git push origin HEAD",
    # Chained: assignments and wrappers in any combination, still read through.
    "sudo nohup env X=1 git push origin HEAD",
    "X=1 Y=2 sudo git push origin HEAD",
    # A same-command assignment behind a wrapper resolves a $-destination
    # exactly as it already does unwrapped (r4/r6's own reading, now reached
    # from behind a wrapper too).
    "nohup git push origin HEAD:$B; B=main",
    # A wrapper does not exempt the other push shapes already closed:
    # wildcard refspecs, a force-push "+" marker, --mirror/--all.
    "sudo git push origin 'refs/heads/*:refs/heads/*'",
    "sudo git push origin +HEAD",
    "nohup git push origin --mirror",
    # "a shell -c with a literal string" -- read through recursively, one or
    # more levels, quoted either way.
    "bash -c 'git push origin HEAD'",
    'bash -c "git push origin HEAD"',
    "sh -c 'git push origin HEAD'",
    "bash -c 'nohup git push origin HEAD'",
    # A shell whose options carry `c` anywhere runs a command string too.
    "bash --norc -c 'git push origin HEAD'",
    "bash -lc 'git push origin HEAD'",
    "sh -ec 'git push origin HEAD'",
    "bash -o pipefail -c 'git push origin HEAD'",
    "fish -c 'git push origin HEAD'",
    # A command string this hook cannot read (built from a shell expansion)
    # fails CLOSED, not open.
    'bash -c "git push origin $B"',
    "bash -c 'git push origin $(echo main)'",
    # "an unrecognised wrapper shape is refused": a recognised wrapper's own
    # flags (the last call found the first cut let each of these through) ...
    "sudo -u root git push origin HEAD",
    "env -i git push origin HEAD",
    "env -C /tmp git push origin HEAD",
    "xargs -I{} git push origin HEAD",
    "time -p git push origin HEAD",
    "nohup -- git push origin HEAD",
    "env -S 'git push origin HEAD'",
    # ... a program not on the list, a shell keyword, eval ...
    "timeout 10 git push origin HEAD",
    "nice -n 5 git push origin HEAD",
    "sudo timeout 10 git push origin HEAD",
    "find . -exec git push origin HEAD ;",
    "if true; then git push origin HEAD; fi",
    "{ git push origin HEAD; }",
    "! git push origin HEAD",
    "eval git push origin HEAD",
    "eval 'git push origin HEAD'",
    # ... a program that runs a string it is handed ...
    "watch 'git push origin HEAD'",
    "ssh localhost 'git push origin HEAD'",
    'python3 -c \'import os; os.system("git push origin HEAD")\'',
    # ... and refused WHATEVER the destination: an unrecognised shape is not
    # read like a bare push, so a non-main push behind one is refused too.
    "timeout 60 git push -u origin feat/x",
    "sudo -E git push origin feature",
    "timeout 5 bash -c 'git push origin feature'",
])
def test_r7_env_prefix_and_wrapper_pushes_are_now_blocked(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "BLOCKED by ADR 0090" in out.stderr, out.stderr


@pytest.mark.parametrize("command", [
    # An ordinary command that shares a wrapper name with the list above but
    # has nothing to do with git must stay exactly as unblocked as ever.
    "sudo docker push myimage:latest",
    "sudo apt-get update",
    "env FOO=bar npm run build",
    # A wrapped push to a NON-main destination stays allowed, same as the
    # un-wrapped case (r4_push_var_develop).
    "sudo git push origin feature",
    "nohup git push origin HEAD:develop",
    "sudo bash -c 'git push origin feature'",
    "X=1 git push origin feature",
    # Behind an unrecognised shape, a git that does not push is not refused.
    "sudo -u root git status",
    "timeout 10 git fetch origin",
    "bash -lc 'git status'",
    # A script file (no `c` option) is not read -- a long-standing gap
    # (point 23), unchanged by this round.
    "bash deploy.sh",
    # Named residual: eval stays trusted (the founder's keep-trusting answer),
    # so a string built from an expansion is not refused ...
    'eval "$(ssh-agent -s)"',
    # ... and a quoted string handed to a program on neither list is not read:
    # this hook cannot tell it from a quoted argument such as a PR body.
    "gh pr create --title t --body 'nohup git push origin HEAD'",
    # The last call's two found-not-fixed residuals (a word shlex cannot
    # close, `git push origin HEAD; echo $'\''`, and a git named by an
    # expansion, `G=git; $G push origin HEAD`, `$(echo git) push origin
    # HEAD`) were closed by gate-r8, on the founder's round-6 answer, and
    # moved to test_r8_git_named_by_an_expansion_is_resolved_or_refused and
    # test_r8_an_unreadable_word_is_read_again_not_let_through.
])
def test_r7_the_named_residuals_are_still_not_seen(two, command):
    """Pins what gate-r7 names but does not close, so it is not silently
    claimed closed later, and pins that the fix does not over-block ordinary
    wrapper usage that has nothing to do with a git push."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


def test_r7_env_prefix_push_is_confirmed_live_against_a_local_bare_origin(two, tmp_path):
    """The residual gate-r6 named (ADR 0090's text): "a push behind an env
    prefix or a wrapper (`X=1 git push origin HEAD`, `nohup git push origin
    HEAD`), which `_direct_push_problem()` skips because the segment's first
    word is not git." CONFIRMED failing on the reverted line, live against a
    local bare origin: the push landed on remote main."""
    clone, _h, env = two
    command = "X=1 " + _WRAP + " origin HEAD"
    reverted = HOOK.read_text().replace(
        "        if not seg:\n            continue\n"
        "        reason = _wrapper_stripped_push_reason(seg, start, assigned, _depth)\n",
        "        if not seg or not _is_program(seg[0], \"git\"):\n            continue\n"
        "        reason = _push_reason(seg, _env_before(assigned, start))\n", 1)
    assert reverted != HOOK.read_text()
    pre_fix_clone, _pre_fix_h, pre_fix_env = build(tmp_path, {"1": CLEAN, "2": OWNED}, hook_source=reverted)
    pre_fix_out = run_hook(pre_fix_clone, pre_fix_env, command)
    assert pre_fix_out.returncode == 0, (  # FAILING: the bug lets this through
        "reverted-line build unexpectedly still blocks -- the scenario no "
        "longer isolates this fix", pre_fix_out.stderr)
    # Not only a function-level claim: run the exact vulnerable command for
    # real (bypassing the hook entirely, the way a shell would once the hook
    # -- wrongly, pre-fix -- said ALLOW) against the same clone/origin the
    # pre-fix hook just approved it for, and confirm the LOCAL BARE ORIGIN's
    # own main ref really moves, not merely that some exit code was 0. The
    # founder's own wording is "run from a main checkout" -- `git push origin
    # HEAD` with no explicit destination names the CURRENT LOCAL BRANCH on
    # the remote, so the checkout must actually BE main for this to move it.
    before_main = git(pre_fix_clone, "ls-remote", "origin", "refs/heads/main")
    git(pre_fix_clone, "checkout", "-q", "-B", "main", "origin/main")
    (pre_fix_clone / "proof.txt").write_text("env-prefix wrapper push proof\n")
    git(pre_fix_clone, "add", "-A")
    git(pre_fix_clone, "commit", "-qm", "main-checkout commit")
    push = subprocess.run(["bash", "-c", command], cwd=pre_fix_clone, env=pre_fix_env,
                          capture_output=True, text=True, timeout=60)
    assert push.returncode == 0, push.stderr  # the real push itself succeeded
    after_main = git(pre_fix_clone, "ls-remote", "origin", "refs/heads/main")
    assert after_main != before_main, (
        "the real push did not move the local bare origin's main ref -- the "
        "scenario no longer demonstrates a real exploit", before_main, after_main)
    out = run_hook(clone, env, command)  # PASSING: the real, fixed hook
    assert out.returncode == 2, out.stderr
    assert "BLOCKED by ADR 0090" in out.stderr, out.stderr
    # The nohup wrapper form, same claim, same proof of a real exploit, from
    # the same main checkout advanced one more commit.
    command2 = "nohup " + _WRAP + " origin HEAD"
    pre_fix_out2 = run_hook(pre_fix_clone, pre_fix_env, command2)
    assert pre_fix_out2.returncode == 0, (pre_fix_out2.stderr)
    before_main2 = git(pre_fix_clone, "ls-remote", "origin", "refs/heads/main")
    (pre_fix_clone / "proof2.txt").write_text("nohup wrapper push proof\n")
    git(pre_fix_clone, "add", "-A")
    git(pre_fix_clone, "commit", "-qm", "second main-checkout commit")
    push2 = subprocess.run(["bash", "-c", command2], cwd=pre_fix_clone, env=pre_fix_env,
                           capture_output=True, text=True, timeout=60)
    assert push2.returncode == 0, push2.stderr
    after_main2 = git(pre_fix_clone, "ls-remote", "origin", "refs/heads/main")
    assert after_main2 != before_main2, "the nohup-wrapped real push did not move main either"
    out2 = run_hook(clone, env, command2)
    assert out2.returncode == 2, out2.stderr


# The first cut of gate-r7 read only a BARE named wrapper and an exact
# `shell -c <arg>`: a recognised wrapper's own flag, a program not on the
# list, a shell keyword, and a shell whose `c` came in another option shape
# all ended the reading and were let through. These two replacements restore
# that first cut, so the test below can show each shape was a real push.
_R7_FIRST_CUT = (
    ("        return _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned, wrapped, _depth)\n",
     "        return None\n"),
    ("    if not any(_SHELL_C_OPTION_RE.match(t) for t in rest):\n",
     "    if rest[:1] != [\"-c\"]:\n"),
    # gate8c (round 6y, 2026-09-22) gave `eval` its own re-reading, added
    # ABOVE the `_unrecognised_wrapper_push_reason` fallback the first patch
    # above already neutralises for this reconstruction. Reconstructing the
    # r7-era hook (long before gate8c existed) has to strip this branch too,
    # or `eval '<push>'` still gets gate8c's protection here and the
    # "first cut" no longer reproduces the r7-era gap it exists to prove.
    ('        if name == "eval":\n', "        if False:\n"),
)


def _gated_push_moves_main(tmp_path: pathlib.Path, hook_source: str, command: str) -> tuple[int, bool]:
    """(the hook's exit, whether the local bare origin's main moved) when
    `command` is run from a checkout of main ONLY IF the hook allows it --
    the way the harness itself gates a Bash call."""
    tmp_path.mkdir()
    clone, _h, env = build(tmp_path, {"1": CLEAN}, hook_source=hook_source)
    git(clone, "checkout", "-q", "-B", "main", "origin/main")
    (clone / "proof.txt").write_text("unrecognised wrapper push proof\n")
    git(clone, "add", "-A")
    git(clone, "commit", "-qm", "main-checkout commit")
    before = git(clone, "ls-remote", "origin", "refs/heads/main")
    verdict = run_hook(clone, env, command)
    if verdict.returncode == 0:
        subprocess.run(["bash", "-c", command], cwd=clone, env=env,
                       capture_output=True, text=True, timeout=60)
    return verdict.returncode, git(clone, "ls-remote", "origin", "refs/heads/main") != before


@pytest.mark.parametrize("command", [
    "env -u R7_UNSET " + _WRAP + " origin HEAD",
    "nice -n 5 " + _WRAP + " origin HEAD",
    "if true; then " + _WRAP + " origin HEAD; fi",
    "eval '" + _WRAP + " origin HEAD'",
    "sh -ec '" + _WRAP + " origin HEAD'",
])
def test_r7_unrecognised_wrapper_shapes_are_refused_live_against_a_local_bare_origin(tmp_path, command):
    """Founder: "an unrecognised wrapper shape is refused". Each shape, gated
    by the hook the way a Bash call is, from a checkout of main: the first
    cut allowed it and the real push moved the bare origin's main; the fixed
    hook refuses it and main does not move."""
    first_cut = HOOK.read_text()
    for old, new in _R7_FIRST_CUT:
        assert first_cut.count(old) == 1, old
        first_cut = first_cut.replace(old, new, 1)
    exit_first, moved_first = _gated_push_moves_main(tmp_path / "first", first_cut, command)
    assert (exit_first, moved_first) == (0, True), (
        "the first cut no longer lets this shape reach remote main -- the "
        "scenario no longer shows a real push", command, exit_first, moved_first)
    exit_fixed, moved_fixed = _gated_push_moves_main(tmp_path / "fixed", HOOK.read_text(), command)
    assert (exit_fixed, moved_fixed) == (2, False), (command, exit_fixed, moved_fixed)


# --------------------------------------------------------------------------- #
# gate-r8, 2026-09-21, round 6 -- founder's answer to the gate-r7 last call,
# verbatim: "Take all four". (1) a word shlex cannot close: road (b), re-read
# with the heredoc-aware word reader, refuse only if that fails too; (2) git
# named by an expansion: road (a), resolve through the same-command
# assignments, refuse an unresolved $-built command word followed by push;
# (3) text naming a push after another word is refused and the refusal says
# to pass it with -F; (4) a quoted string handed to a program on neither list
# stays a named residual (pinned above, in test_r7_the_named_residuals_...).
# Every refused shape below was exit 0 on gate-r7's hook.
# --------------------------------------------------------------------------- #

_ODD = "Don't break it"  # one apostrophe: shlex cannot close it
_EVEN = "it's the founder's rule"  # two: shlex pairs them


@pytest.mark.parametrize("command", [
    # The founder's two examples, verbatim.
    "G=git; $G push origin HEAD",
    "$(echo git) push origin HEAD",
    "`echo git` push origin HEAD",
    # Unresolved: refused whatever the destination, as the answer says.
    '"$G" push origin feat/x',
    "${G} push origin feat/x",
    "G=$(which git); $G push origin feat/x",
    "sudo $G push origin feat/x",
    "X=1 $(echo git) push origin feat/x",
    # "followed by push" past git's own global flags, and `subtree push`.
    "$(echo git) -C . push origin HEAD",
    "$(echo git) subtree push --prefix=x origin HEAD",
    # Resolved, and split on blanks as the shell splits an unquoted expansion.
    'G="git push origin HEAD"; $G',
    # Unresolved, one whole substitution holding push: the shell splits it too.
    "$(printf 'git push') origin HEAD",
    # A same-command IFS is honoured when the word is split; an unknown one
    # leaves the word unresolved.
    "IFS=x; W=gitxpush; $W origin HEAD",
    "IFS=$X; G=git; $G push origin feat/x",
    # Behind an unrecognised shape, as a later literal git already is.
    "timeout 10 $G push origin feat/x",
    "G=git; timeout 10 $G push origin feat/x",
    # git's own subcommand built from an expansion (the sibling position).
    "P=push; git $P origin HEAD",
    "git $(echo push) origin HEAD",
    "git $P origin feat/x",
    "git ${P} origin feat/x",
])
def test_r8_git_named_by_an_expansion_is_resolved_or_refused(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "BLOCKED by ADR 0090" in out.stderr, out.stderr


@pytest.mark.parametrize("command", [
    # Resolved to git, read exactly like a bare push: a non-main push passes.
    "G=git; $G push origin feat/x",
    "P=push; git $P origin feat/x",
    "IFS=x; G=git; $G push origin feat/x",
    "G=git; $G status",
    "git push origin feat/x",
    # An unresolved command word NOT followed by push is not refused.
    "$(which python3) scripts/check.py; git status",
    'git -C "$DIR" status',
    # Resolved to something that is not git.
    "D=docker; $D push myimage",
    # r4's own controls, unchanged.
    "B=develop; git push origin HEAD:$B",
    "git push origin feature:$UNRELATED",
])
def test_r8_git_named_by_an_expansion_allowed_twins(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


@pytest.mark.parametrize("command", [
    # The founder's example, verbatim.
    "git push origin HEAD; echo $'\\''",
    # An odd apostrophe in a heredoc body, then a push: the body is skipped by
    # the word reader, and the push after it is read.
    f"git commit -F - <<'EOF'\n{_ODD}\nEOF\ngit push origin HEAD",
    # Heredoc bodies keep the current reading: their lines are read as commands.
    f"git commit -F - <<'EOF'\n{_ODD}\ngit push origin HEAD\nEOF",
    "echo $'\\''\ncat <<EOF\n$(git push origin HEAD)\nEOF",
    # Refused because the word reader cannot read the command either: it
    # leaves a quote, a substitution, a `${` or a parenthesis open ...
    'git status; echo "unclosed',
    "git status; echo 'unclosed",
    "git status; echo $(unclosed",
    "git status; echo ${X; echo $'\\''",
    "git status; x=(a; echo $'\\''",
    # ... or meets a construct it reads differently from the shell.
    "echo $'\\''; echo ${X:-\"}\"}\ngit push origin HEAD\necho \"",
    # Both readings misread at once.
    "echo $'\\''; x=(')')\ngit push origin HEAD\necho ')''",
    'echo "$(case a in a) git push origin HEAD;; esac)"',
    # The word reader cannot read it at all (nested past its limit), and the
    # push sits inside a double-quoted substitution shlex never reads.
    'echo "' + "$(" * 22 + "git push origin HEAD" + ")" * 22 + '"',
])
def test_r8_an_unreadable_word_is_read_again_not_let_through(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    assert "BLOCKED by ADR 0090" in out.stderr, out.stderr


@pytest.mark.parametrize("command", [
    # A plain commit heredoc that does not push passes, with an odd and with
    # an even apostrophe count (the founder's named twins).
    f"git commit -F - <<'EOF'\n{_ODD}\nEOF",
    f"git commit -F - <<'EOF'\n{_EVEN}\nEOF",
    f"git commit -m \"$(cat <<'EOF'\n{_ODD}\nEOF\n)\"",
    f"git commit -m \"$(cat <<'EOF'\n{_EVEN}\nEOF\n)\"",
    # A body line of code the word reader misreads is text, not a command.
    f"git commit -F - <<'EOF'\n{_ODD}\nlog.push(`${{x}}`)\nEOF",
    # A normal push, behaviour unchanged, with and without an unreadable word.
    "git push origin feat/x",
    "git push origin feat/x; echo $'\\''",
    "git push -u origin feat/x",
])
def test_r8_an_unreadable_word_allowed_twins(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


@pytest.mark.parametrize("command", [
    # A push inside a double-quoted substitution: one quoted word to shlex,
    # never read; the word reader reads the words inside it.
    'echo "$(git push origin HEAD)"',
    'OUT="$(git push origin HEAD 2>&1)"',
    'echo "`git push origin HEAD`"',
    # A value that is itself an expansion or an array is not a literal.
    "X=main; B=$X; git push origin HEAD:$B",
    "B=$UNKNOWN; git push origin HEAD:$B",
    "B=(main); git push origin HEAD:$B",
    # An r6 named residual the word reader closes: it splits `)` from `;`.
    "f() ( git push origin feat:$B ); B=main; f",
])
def test_r8_closed_by_the_word_reading(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)


@pytest.mark.parametrize("command", [
    'echo "$(git push origin feat/x)"',
    'echo "$(git status)"',
])
def test_r8_closed_by_the_word_reading_allowed_twins(two, command):
    clone, _h, env = two
    assert run_hook(clone, env, command).returncode == 0


_TEXT_SHAPES = [
    "echo git push origin HEAD",
    f"git commit -F - <<'EOF'\nWe checked that git push origin HEAD is refused, {_EVEN}\nEOF",
    "git commit -F - <<'EOF'\nWe don't run git push origin HEAD here\nEOF",
    'echo "git push origin main"',
]


@pytest.mark.parametrize("command", _TEXT_SHAPES)
def test_r8_text_naming_a_push_is_refused_and_told_to_use_a_file(two, command):
    """Founder, round 6: accept that a heredoc body line naming git push after
    another word, or `echo git push origin HEAD`, is refused -- text goes
    through a file with -F -- and make sure the refusal message says so."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 2, (command, out.stderr)
    for words in ("heredoc body line", "`echo git push origin HEAD`", "-F <file>"):
        assert words in out.stderr, (command, words, out.stderr)


def test_r8_the_text_hint_is_load_bearing(tmp_path):
    """The message mutation the exit-code harness below cannot see: with the
    hint emptied, every text shape above is still refused but no longer says
    what to do."""
    source = HOOK.read_text()
    old = "PUSH_TEXT_HINT = (\n"
    assert source.count(old) == 1
    clone, _h, env = build(tmp_path, {"1": CLEAN}, hook_source=source.replace(old, 'PUSH_TEXT_HINT = "" and (\n', 1))
    for command in _TEXT_SHAPES:
        out = run_hook(clone, env, command)
        assert out.returncode == 2 and "-F <file>" not in out.stderr, (command, out.stderr)


@pytest.mark.parametrize("command", [
    # A git and its subcommand both built by expansion: nothing literal follows
    # (the push-side twin of the merge side's `G=gh; $G p$()r merge 2`).
    "$G $P origin HEAD",
    # A command word built by brace or glob expansion (twin of `{gh,pr,merge} 2`).
    "{git,push,origin,HEAD}",
    # Behind an unrecognised shape, a substitution word holding blanks is read
    # as a string, not as a command word.
    "timeout 5 $(printf 'git push') origin HEAD",
    # A git alias the command defines for itself: gate-r3 reads only
    # `git config --get alias.<name>`. Left for the founder.
    "git -c alias.p=push p origin HEAD",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p origin HEAD",
    # An unresolvable destination from a named source stays allowed, as r4's
    # `feature:$UNRELATED` does, now also when the value is itself an expansion.
    "X=main; B=$X; git push origin feat:$B",
    # Older than gate-r8, found while testing it: the push-side twins of the
    # merge side's "Not seen" `echo merge 2 | xargs gh pr` and
    # `alias g=gh; g pr merge 2` (the first measured moving main).
    "echo push origin HEAD | xargs git",
    "shopt -s expand_aliases\nalias g=git\ng push origin HEAD",
])
def test_r8_the_named_residuals_are_still_not_seen(two, command):
    """Pins what ADR 0090's gate-r8 section names as not closed."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


def test_r8_the_named_cost_is_still_refused(two):
    """ADR 0090 gate-r8, a cost left for the founder: behind an unrecognised
    program, an unresolved single word followed by the word push is refused
    whatever the program is -- it may be git."""
    clone, _h, env = two
    out = run_hook(clone, env, "docker --config $DIR push myimage")
    assert out.returncode == 2, out.stderr


def _ungated_push_moves_main(tmp_path: pathlib.Path, command: str, shell: str = "bash") -> bool:
    """Whether `command`, run for real from a checkout of main with no hook in
    the way, moves the local bare origin's main -- proof the shape is a push."""
    tmp_path.mkdir()
    clone, _h, env = build(tmp_path, {"1": CLEAN})
    git(clone, "checkout", "-q", "-B", "main", "origin/main")
    (clone / "proof.txt").write_text("gate-r8 push proof\n")
    git(clone, "add", "-A")
    git(clone, "commit", "-qm", "main-checkout commit")
    before = git(clone, "ls-remote", "origin", "refs/heads/main")
    subprocess.run([shell, "-c", command], cwd=clone, env=env, capture_output=True, text=True, timeout=60)
    return git(clone, "ls-remote", "origin", "refs/heads/main") != before


@pytest.mark.parametrize("command", [
    "git push origin HEAD; echo $'\\''",
    "G=git; $G push origin HEAD",
    "$(echo git) push origin HEAD",
    "git $(echo push) origin HEAD",
    "X=main; B=$X; git push origin HEAD:$B",
    'echo "$(git push origin HEAD)"',
    "echo $'\\''; echo ${X:-\"}\"}\ngit push origin HEAD\necho \"",
    "echo $'\\''; x=(')')\ngit push origin HEAD\necho ')''",
    'echo "$(case a in a) git push origin HEAD;; esac)"',
])
def test_r8_each_closed_shape_is_a_real_push_the_hook_now_stops(tmp_path, command):
    """Each shape, run with no hook, moves the bare origin's main from a
    checkout of main; gated by the hook the way a Bash call is, it is refused
    and main does not move. (gate-r7's hook allowed every one: measured,
    exit 0, recorded in ADR 0090's gate-r8 section.)"""
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


# gate-r8 last call: five fail-opens in the two roads as first built, each a
# real push the staged gate-r8 hook allowed (exit 0, measured).
_R8_LAST_CALL_BASH = [
    # (2) A same-command prefix does not give the command's own words their
    # value: bash expands them first. `declare` stays a named residual; the
    # prefix was what hid the push.
    "declare G=git; G=true $G push origin HEAD",
    "declare P=push; P=status git $P origin HEAD",
    "declare B=main; B=feat git push origin HEAD:$B",
    # (2) The shell resets `$_` after every command: no `_=value` is trusted.
    "_=x; echo git; $_ push origin HEAD",
    "echo git; _=x $_ push origin HEAD",
    "_=feat; echo main; git push origin HEAD:$_",
    # (1) The word reader decodes `$'...'` escapes as the shell does.
    "git push origin $'\\x6dain'; echo $'\\''",
    "$'\\x67it' push origin HEAD; echo $'\\''",
    "git $'\\x70ush' origin HEAD; echo $'\\''",
    "g$'\\151't push origin HEAD; echo $'\\''",
    "$'\\u0067it' push origin HEAD; echo $'\\''",
    "$'git\\0x' push origin HEAD; echo $'\\''",
    # (1) A heredoc body a shell runs is read whole, as its script ...
    "bash <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    "bash <<'EOF'\nW=\"git push\"\n$W origin HEAD\nEOF\necho $'\\''",
    "cat <<'EOF' | bash\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    # ... also inside a double-quoted substitution, which shlex reads as one
    # word; and an unquoted-delimiter body's own substitutions are read.
    "x=\"$(bash <<'EOF'\ngit push origin HEAD\nEOF\n)\"",
    "echo \"$(cat <<EOF\n$(git push origin HEAD)\nEOF\n)\"",
    "echo \"$(cat <<EOF\n`git push origin HEAD`\nEOF\n)\"",
]
# zsh, the shell the Bash tool runs here: `=git` is git's path, and an escape
# zsh does not know loses its backslash (`$'\git'` is git).
_R8_LAST_CALL_ZSH = [
    "=git push origin HEAD",
    "nohup =git push origin HEAD",
    "$'\\git' push origin HEAD; echo $'\\''",
]


@pytest.mark.parametrize("command", _R8_LAST_CALL_BASH)
def test_r8_last_call_shapes_are_real_pushes_the_hook_now_stops(tmp_path, command):
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


@pytest.mark.parametrize("command", _R8_LAST_CALL_ZSH)
def test_r8_last_call_zsh_shapes_are_refused(tmp_path, command):
    """The hook's verdict always; the real push under zsh where zsh is
    installed (the hook harness in CI may not have it)."""
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command
    if shutil.which("zsh"):
        assert _ungated_push_moves_main(tmp_path / "ungated", command, shell="zsh"), command


@pytest.mark.parametrize("command", [
    # A prefix gives its own command's words nothing either way: `$G` is the
    # caller's (unset here), so this runs no push and is allowed.
    "G='git push' $G origin HEAD",
    # A spliced word reads the assignments made before its command, exactly:
    # this pushes HEAD to feat.
    'W="nohup nohup nohup git push origin"; B=feat; $W HEAD:$B',
    # Escapes that spell no main, and a script body that does not push.
    "git push origin $'feat\\x2fx'; echo $'\\''",
    "$'\\cgit' push origin HEAD; echo $'\\''",
    "bash <<'EOF'\n# it's a script\ngit status\nEOF\necho $'\\''",
    # Text: a body no shell runs, and a text body under a quoted delimiter in a
    # double-quoted substitution (the common PR/commit shape) are not scripts.
    "cat > notes.md <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    "bash -c true && cat > msg.txt <<'EOF'\nIt's a git thing\nEOF",
    "gh pr create --title t --body \"$(cat <<'EOF'\nIt's done; we don't git push origin HEAD here.\nEOF\n)\"",
    "git commit -m \"$(cat <<EOF\nIt's $(date)\nEOF\n)\"",
    "echo \"$(cat <<EOF\n\\$(git push origin HEAD)\nEOF\n)\"",
    "=git status",
])
def test_r8_last_call_allowed_twins(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


# gate-r8 last call, finished: pushes the unstaged fix still allowed (exit 0,
# measured in-process), each moving a local bare origin's main when run.
_R8_FINISH_BASH = [
    # Heredoc bodies a shell runs, reached past the heredoc's own line: a pipe
    # that ends the line, with or without a blank line after the body ...
    "cat <<'EOF' |\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\nbash\necho $'\\''",
    "cat <<'EOF' |\n\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n\nbash\necho $'\\''",
    "x=\"$(cat <<'EOF' |\ngit push origin HEAD\nEOF\nbash\n)\"",
    # ... `.` (the unstaged fix stripped `.` to an empty name) ...
    ". /dev/stdin <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    # ... a group piped to a shell: a subshell, braces, a keyword compound ...
    "x=\"$( (cat <<'EOF'\ngit push origin HEAD\nEOF\n) | bash)\"",
    "x=\"$({ cat <<'EOF'\ngit push origin HEAD\nEOF\n} | bash)\"",
    "(cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n) | bash\necho $'\\''",
    "{ cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n} | bash\necho $'\\''",
    "if true; then cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\nfi | bash\necho $'\\''",
    "for i in 1; do cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\ndone | bash\necho $'\\''",
    "while true; do cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\nbreak; done | bash\necho $'\\''",
    "case a in a) cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n;; esac | bash\necho $'\\''",
    "case b in a) true;; b) cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n;; esac | bash\necho $'\\''",
    # ... a substitution whose word a shell runs or reads ...
    "echo \"$(bash <(cat <<'EOF'\ngit push origin HEAD\nEOF\n))\"",
    "source <(cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n)\necho $'\\''",
    "echo \"$(cat <<'EOF'\ngit push origin HEAD\nEOF\n)\" | bash",
    # ... a shell named by an expansion ...
    "echo bash; $_ <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    "echo bash; nohup $_ <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    # ... and a heredoc inside an unquoted body's own substitution.
    "echo \"$(cat <<EOF\n$(bash <<'X'\ngit push origin HEAD\nX\n)\nEOF\n)\"",
    "echo $'\\''\ncat <<EOF\n$(bash <<'X'\nIFS=x\nW=gitxpush; $W origin HEAD\nX\n)\nEOF",
    # A crash of the push check (22 nested `$(` in an unquoted body) exited 1,
    # which the harness lets run, before the file-route push after it was read.
    "echo $'\\''\ncat <<EOF\n" + "$(" * 22 + "true" + ")" * 22
    + "\nEOF\ncat > p.sh <<'X'\ngit push origin HEAD\nX\nbash p.sh",
    # Quoting inside both words hid the command from the prefilter, so it was
    # never read at all (gate-r7's hook let these through the same way).
    "\"g\"it \"p\"ush origin HEAD",
    "g\\it p\\ush origin HEAD",
    "g''it p''ush origin HEAD",
    "$'\\x67it' $'\\x70ush' origin HEAD",
]
# zsh's `=name` on the shell and string-runner lists, not only for git.
_R8_FINISH_ZSH = [
    "=bash -c 'git push origin HEAD'",
    "=sh -c 'git push origin HEAD'",
    "=python3 -c 'import os; os.system(\"git push origin HEAD\")'",
    "=bash <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''",
    # zsh's split flags: `$=G`/`${=G}` resolve through G's assignment; a flag
    # this hook does not evaluate is refused when G's value holds push.
    'G="git push"; ${=G} origin HEAD',
    'G="git push"; $=G origin HEAD',
    'G="git push"; nice $=G origin HEAD',
    'G="git push origin HEAD"; ${(z)G}',
    'G="git push origin HEAD"; ${(s: :)G}',
    'G="git push origin HEAD"; nice ${(z)G}',
    "G=gitxpushxoriginxHEAD; ${(s:x:)G}",
]


@pytest.mark.parametrize("command", _R8_FINISH_BASH)
def test_r8_finishing_pass_shapes_are_real_pushes_the_hook_now_stops(tmp_path, command):
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


@pytest.mark.parametrize("command", _R8_FINISH_ZSH)
def test_r8_finishing_pass_zsh_shapes_are_refused(tmp_path, command):
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command
    if shutil.which("zsh"):
        assert _ungated_push_moves_main(tmp_path / "ungated", command, shell="zsh"), command


def test_r8_only_the_line_reading_stops_a_push_through_a_file(tmp_path):
    """The re-pinned `r8_fallback_body` scenario is a real push: a quoted body
    no shell runs where it stands, written to a file a shell runs later, seen
    only by the unreadable-word fallback's line reading."""
    command = SCENARIOS["r8_fallback_body"]({})[0]
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


@pytest.mark.parametrize("command", [
    # A `.` that is an argument, not the command, runs nothing.
    "git -C . commit -F - <<'EOF'\nIt's a git thing\nEOF",
    # A quoted delimiter's `$(...)` is text; an unquoted body's substitution
    # that does not push is read and allowed.
    "gh pr create --title t --body \"$(cat <<'EOF'\nrun $(git push origin HEAD) later\nEOF\n)\"",
    "echo \"$(cat <<EOF\n$(git log -1 --format=%s)\nEOF\n)\"",
    # A group no shell reads, and a shell past a separator.
    "( cat <<'EOF'\nIt's a git thing\nEOF\n) > notes.md; bash -c true",
    "cat <<'EOF' | tee notes.md\nIt's a git thing\nEOF",
    # zsh's `=bash` running a string that does not push.
    "=bash -c 'git status'",
    # zsh's `${=G}` resolved: a push to a named branch that is not main.
    'G="git push"; ${=G} origin feat/x',
    # Quoting that splits the words opens the reading; what it reads decides.
    '"g"it status',
    'echo "p"ush it',
])
def test_r8_finishing_pass_allowed_twins(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


@pytest.mark.parametrize("command", [
    # A body carried through a variable, then piped to a shell.
    "x=\"$(cat <<'EOF'\ngit push origin HEAD\nEOF\n)\"; echo \"$x\" | bash",
    # A script file (point 23), when shlex cannot close a word: the body's
    # lines are read one at a time, so a script's earlier lines are lost.
    "cat > p.sh <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\nbash p.sh; echo $'\\''",
    # stdin that is not a heredoc (point 23).
    "bash <<< 'git push origin HEAD'",
    "echo 'git push origin HEAD' | bash",
    # A heredoc body a program that is not a shell runs: its quoted string is
    # one word (the heredoc twin of gate-r7's string-running reading).
    "python3 - <<'EOF'\nimport os; os.system('git push origin HEAD')\nEOF",
    "x=\"$(perl <<'EOF'\nsystem(\"git push origin HEAD\");\nEOF\n)\"",
    # Both words split by an expansion (gate-r8's named residual "a git and
    # its subcommand both built by expansion").
    "g$()it p$()ush origin HEAD",
])
def test_r8_finishing_pass_named_residuals_are_still_not_seen(two, command):
    """Pins what ADR 0090's gate-r8 section names as still not seen after the
    last call's fix; each is a real push (measured moving a bare origin's main)."""
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


# --------------------------------------------------------------------------- #
# gate8c (round 6y, 2026-09-22). Founder's word, verbatim, as relayed: "Close
# them here (Recommended)" -- close the five real pushes the gate-r8 last
# call found and left NOT READY, each measured moving a bare origin's main
# under bash, unfixed:
#   (1) a whole `${...}` command word whose default/alternate-value text
#       holds push, including the IFS-split variant (_whole_word_holds_push);
#   (2) eval's joined arguments, re-read as a command string the way a
#       `bash -c` string already is (_eval_string_push_reason).
# --------------------------------------------------------------------------- #

_GATE8C_BASH = [
    # (1) A whole `${...}` command word's default/alternate-value text holds
    # push, plain and with the `-` (no colon) operator.
    "${G:-git push} origin HEAD",
    "${G-git push} origin HEAD",
    # (1) The same, with a same-command IFS splitting the default text itself
    # -- the IFS-split variant named alongside it.
    "IFS=x; ${W:-gitxpush} origin HEAD",
    # (2) eval's argument is a plain quoted string, itself a multi-statement
    # shell fragment: an IFS assignment, a value assignment, then an
    # unquoted reference the same-command IFS splits into git and push.
    "eval 'IFS=x; W=gitxpush; $W origin HEAD'",
    # (2) The same, but eval's argument is a double-quoted substitution whose
    # heredoc body -- carried straight through, unread before this round --
    # is the string that actually holds the push.
    "eval \"$(cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n)\"",
]


@pytest.mark.parametrize("command", _GATE8C_BASH)
def test_gate8c_last_call_shapes_are_real_pushes_the_hook_now_stops(tmp_path, command):
    """Each shape, run with no hook, moves the bare origin's main from a
    checkout of main (gate-r8's staged hook allowed every one: measured, exit
    0, recorded in ADR 0090's gate-r8 section, "Last call, NOT READY"); gated
    by this hook the way a Bash call is, it is now refused and main does not
    move."""
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


def test_gate8c_eval_joins_its_arguments_before_re_reading_them(tmp_path):
    """eval's real semantics: every argument is concatenated into ONE string
    before it is re-read, unlike `bash -c`'s separate positional arguments.
    Neither argument alone holds a push -- the first is two assignments with
    nothing run after them, and the second has no literal "push" or "git" at
    all -- only the two joined together, exactly as the shell joins them, do.
    A real push (measured moving a bare origin's main), refused only because
    the arguments are joined before this hook re-reads them."""
    command = "eval 'IFS=x; W=gitxpush;' '$W origin HEAD'"
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


def test_gate8c_residual_four_boundary_still_refused(two):
    """Not the founder's round-6 residual (4), and not an allowed twin: a
    command word built by expansion holding ONLY "git", with a literal
    "push" as its own following word, was already read as git with push
    right after it (`_push_follows`) -- refused before this round and
    unchanged by it. Pinned here, separately from the allowed twins below,
    because it stays refused, not allowed."""
    clone, _h, env = two
    out = run_hook(clone, env, "${G:-git} push origin HEAD")
    assert out.returncode == 2, out.stderr


@pytest.mark.parametrize("command", [
    # The founder's named allowed twin: eval's argument is a substitution
    # this hook cannot resolve (it does not run ssh-agent), and the text has
    # no "push" or "git" anywhere -- eval re-reads it and finds no push,
    # exactly as it did before this round.
    'eval "$(ssh-agent -s)"',
    # A `${...}` default holding an ordinary git command, not a push.
    "${G:-git status} origin HEAD",
    "${G:-git fetch}",
    # A default/alternate-value expansion wholly unrelated to git.
    "X=1; ${Y:-echo done}",
    "${Z:=build}",
    # eval running an ordinary command is read exactly as a bare one already
    # is -- not over-blocked by the new recursive reading.
    "eval 'git status'",
    "eval echo hello",
    # Re-read after the command's own assignments (gate8c last call), the
    # twin stays a twin: an assignment beside it gives the unresolved
    # substitution nothing, a resolved git runs no push, and a value that
    # names push but is only echoed runs none either.
    'X=1; eval "$(ssh-agent -s)"',
    "G=git; eval '$G status'",
    "MSG='push notes'; eval 'echo $MSG'",
])
def test_gate8c_allowed_twins(two, command):
    clone, _h, env = two
    out = run_hook(clone, env, command)
    assert out.returncode == 0, (command, out.stderr)


# gate8c last call (2026-09-22): the eval re-read as first built opened what
# HEAD refused and left the same-command IFS unread. Each shape, run with no
# hook, moves the bare origin's main; the first build (reconstructed by the
# two replacements below) allowed it and main moved; this hook refuses it.
#   - Re-read ALONE, the string lost the command's own assignments, which
#     `eval` -- unlike a `bash -c` child -- runs under: `$C` and `$W` were
#     unset in the re-read (the first three were refused before gate8c).
#   - It replaced eval's older string-runner reading instead of adding to
#     it: the git alias shape was refused before gate8c by that reading.
_GATE8C_FIRST_BUILD = (
    ("    return _direct_push_problem(outer + joined, _depth + 1)\n",
     "    return _direct_push_problem(joined, _depth + 1)\n"),
    ("                    or _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned,\n"
     "                                                         wrapped, _depth))\n",
     "                    or None)\n"),
)


@pytest.mark.parametrize("command", [
    "C='git push origin HEAD'; eval \"$C\"",
    "C='git push origin HEAD'; eval '$C'",
    "C='git push origin HEAD'; eval eval '$C'",
    "C='git push origin HEAD'; eval 'eval \"$C\"'",
    "IFS=x; W=gitxpush; eval '$W origin HEAD'",
    # eval's own prefix is in force while it runs (a special builtin's).
    "W=gitxpush; IFS=x eval '$W origin HEAD'",
    "A=gitxpu; B=sh; IFS=x eval '$A$B origin HEAD'",
    "eval 'git -c alias.p=push p origin HEAD'",
])
def test_gate8c_last_call_eval_shapes_are_real_pushes_the_hook_now_stops(tmp_path, command):
    first_build = HOOK.read_text()
    for old, new in _GATE8C_FIRST_BUILD:
        assert first_build.count(old) == 1, old
        first_build = first_build.replace(old, new, 1)
    assert _ungated_push_moves_main(tmp_path / "ungated", command), command
    assert _gated_push_moves_main(tmp_path / "first", first_build, command) == (0, True), command
    assert _gated_push_moves_main(tmp_path / "gated", HOOK.read_text(), command) == (2, False), command


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
    # "direct-push block removed" (DIRECT_PUSH_PATTERN's own check) is
    # deliberately NOT a parametrized entry here any more, since gate-r3
    # (2026-09-19) added _direct_push_problem() as a SECOND, independent
    # check on the same line of code right after it: removing JUST
    # DIRECT_PUSH_PATTERN's check no longer changes the exit code for
    # "git push origin main" (the new check catches it too), which would make
    # this entry fail the shared `!= want` assertion below by construction,
    # not because coverage regressed. test_r3_both_direct_push_checks_are_
    # independently_load_bearing (further down) tests the real invariant
    # instead: each of the two checks alone still blocks it, and only
    # removing BOTH does not.
    ("push_problem check removed", "    push_problem = _direct_push_problem(command)\n",
     "    push_problem = None\n", "h20_bare_push"),
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
    # gate-r4 last-call round (2026-09-19, r4-gate.json)
    ("owned-PR gh-api exemption removed (re-introduces the BLOCKER)",
     '        if gh_api == "gh-api" and not _merge_call_outside_gh_api(text):\n', "        if False:\n",
     "r4_api_literal"),
    ("non-literal PR number on the API path no longer refused",
     "        if not pr_token.isdigit():\n", "        if False:\n", "r4_api_nonliteral"),
    ("push HEAD/@-with-no-destination check removed",
     '            if src in ("HEAD", "@"):\n', "            if False:\n", "r4_push_head"),
    ("push wildcard-refspec check removed",
     '        if "*" in src or (dst is not None and "*" in dst):\n', "        if False:\n", "r4_push_wildcard"),
    ("same-command variable resolution removed from push destinations",
     "        resolved = _resolve_simple_var(target, env)\n", "        resolved = target\n", "r4_push_var_develop"),
    # r5-gate.json must-fix 3 (2026-09-20): re-opens this round's own
    # fresh bypass of the fix right above it -- "+HEAD"/"+@" matched
    # neither the HEAD/@ check nor anything else, so this scenario alone
    # isolates it (r4_push_head above pins the un-prefixed form, still
    # caught the same way either version of this code handles it).
    ("force-push marker not stripped before the HEAD/@ comparison",
     '        if spec.startswith("+"):\n            spec = spec[1:]\n', "", "r5_push_plus_head"),
    # gate-r8 re-pinned this one: a value holding `$`/backtick/`(` is now
    # unresolved on its own, and the word reader keeps `$(...)` whole, so
    # r4_push_var_cmdsub is refused twice over; `B=<(...)` is the fragment
    # shlex splits off that only this check still reads as unresolved.
    ("command-substitution assignment fragment trusted as a literal (self-adversarial fix)",
     "        if nxt is not None and nxt not in _STATEMENT_SEP_TOKENS and _is_punctuation(nxt):\n",
     "        if False:\n", "r8_push_var_fragment"),
    # gate-r4 residual closed (2026-09-19): a respelled `gh api`. Each scenario is
    # one no OTHER check in the hook also refuses, so removing the reading under
    # test is what changes the exit (the symlink reading needs a symlink and has
    # its own test: test_r4_the_identity_fallback_is_load_bearing_...).
    ("respelled-gh-api regex reading removed (IFS / brace / quoted gh)",
     "    if _GH_API_RESPELLED_RE.search(stripped):\n", "    if False:\n", "r4_gh_ifs"),
    ("word-by-word gh api reading removed", "        api_words, api_subs, _tail = _lex(command, 0, None, 0)\n",
     "        api_words, api_subs = [], []\n", "r4_gh_expanded"),
    # gate-r6 last call: with the exemption also bound per segment, a
    # "maybe" in the command's own words is refused twice over, so this
    # whole-command reading is load-bearing only where no segment can be read
    # -- its scenario moved from r4_gh_expanded_literal to that shape, and the
    # per-segment reading got its own entry (r6_bound_maybe_segment, below).
    ("an expanded gh is exempted like a recognised one",
     '        if gh_api == "gh-api" and not _merge_call_outside_gh_api(text):\n',
     "        if gh_api and not _merge_call_outside_gh_api(text):\n", "r6_expanded_gh_dropped_text"),
    ("a quoted string another shell runs is not read",
     "                    if (_depth < _MAX_API_READ_DEPTH and raw[:1] in (\"'\", '\"')\n",
     "                    if (False and raw[:1] in (\"'\", '\"')\n", "r4_gh_bash_c"),
    ("an unreadable command read as not-gh-api", '        return "maybe"\n', "        return None\n", "r4_gh_unreadable"),
    ("merge-surface gate before the reading removed",
     "    if not (merge_calls or base_merges or graphql_merge):\n", "    if False:\n", "r4_gh_ordinary"),
    # --------------------------------------------------------------------- #
    # 2026-09-21, founder's two review-trail answers (ADR 0090's gate-r5
    # section named both as residuals, not yet code; verbatim quotes recorded
    # in that ADR's Review trail), and the gate-r6 last call's corrections to
    # their first cut. r4_gh_ordinary above was retired by that first cut
    # (its per-segment rewrite made the whole-text gate unkillable) and is
    # restored here: the refusals read the whole text again, so removing the
    # gate falls through to the GraphQL refusal for `gh api user` -- killed.
    # --------------------------------------------------------------------- #
    ("Bind it to the segment: the exemption granted on the whole command's "
     "gh-api reading alone (re-introduces the cross-segment exemption)",
     '        if gh_api == "gh-api" and not _merge_call_outside_gh_api(text):\n',
     '        if gh_api == "gh-api":\n', "r6_gh_api_segment_binding"),
    ("Bind it to the segment, one level down: a quoted string or substitution "
     "read as the segment's own words",
     "                    if any(c.isspace() for c in blanked):\n",
     "                    if False:\n", "r6_bound_nested"),
    ("Bind it to the segment: a word's substitutions not blanked, so an endpoint "
     "built around one is read as another command's text",
     "                    blanked = _blank_substitutions(raw)\n", "                    blanked = raw\n",
     "r6_bound_built_url"),
    ("Bind it to the segment: a segment that is only maybe gh api counted as gh api",
     '                if _PR_MERGE_ENDPOINT_RE.search(own_text) and _gh_api_reading(own_text) != "gh-api":\n',
     "                if _PR_MERGE_ENDPOINT_RE.search(own_text) and _gh_api_reading(own_text) is None:\n",
     "r6_bound_maybe_segment"),
    ("Bind it to the segment: a command the reader cannot read counted as bound",
     "    except Exception:  # noqa: BLE001 -- a reader that fails must not read as \"bound to gh api\"\n        return True\n",
     "    except Exception:  # noqa: BLE001\n        return False\n", "r6_bound_unreadable"),
    ("Bind it to the segment: the nesting bound no longer refuses to bind",
     "                            if _depth >= _MAX_API_READ_DEPTH or _merge_call_outside_gh_api(cooked, _depth + 1):\n",
     "                            if _merge_call_outside_gh_api(cooked, _depth + 1):\n", "r6_bound_depth"),
    ("Teach it export: a leading `export` no longer treated as a no-op "
     "continuation (re-introduces the unparsed export-prefixed assignment)",
     '        if at_start and tok == "export":\n', "        if False:\n", "r6_export_assignment"),
    ("Teach it export: `export -n`/`export --` flags read as the command starting",
     '            while i < n and toks[i].startswith("-"):\n', "            while False:\n", "r6_export_flags"),
    ("last call: a later non-main value outweighs an earlier main one",
     "        if main is not None:\n", "        if False:\n", "r6_env_any_main"),
    ("last call: a name first assigned after the push trusted as that value",
     "            values.append(_UNRESOLVED)  # read before this command first assigns it\n",
     "            pass\n", "r6_env_read_before_assigned"),
    # --------------------------------------------------------------------- #
    # gate-r7 (2026-09-21), founder's env-prefix/wrapper push answer.
    # --------------------------------------------------------------------- #
    ("the whole wrapper-stripping read replaced with the old git-only-at-seg[0] check "
     "(re-introduces the env-prefix/wrapper push hole)",
     "        if not seg:\n            continue\n"
     "        reason = _wrapper_stripped_push_reason(seg, start, assigned, _depth)\n",
     "        if not seg or not _is_program(seg[0], \"git\"):\n            continue\n"
     "        reason = _push_reason(seg, _env_before(assigned, start))\n", "r7_wrapper_stripping_removed"),
    ("a leading NAME=value assignment no longer peeled off the front of a segment",
     "        if _SIMPLE_ASSIGNMENT_RE.match(tok):\n", "        if False:\n", "r7_assignment_prefix"),
    ("a named transparent wrapper (nohup/env/command/time/exec/sudo/xargs) no "
     "longer peeled off the front of a segment",
     "        if name in _PUSH_WRAPPER_PROGRAMS:\n", "        if False:\n", "r7_bare_wrapper"),
    ("a shell -c with a literal string no longer read through",
     '        if name in _PUSH_SHELL_PROGRAMS:\n',
     "        if False:\n", "r7_shell_c_literal"),
    ("Founder: \"an unrecognised wrapper shape is refused\" -- a -c argument built "
     "from a shell expansion no longer fails closed (re-opens the opaque -c hole)",
     "        if re.search(r\"[$`]\", arg):\n", "        if False:\n", "r7_shell_c_unrecognised"),
    ("the -c recursion depth bound removed (re-opens unbounded nested -c reading)",
     "        if _depth >= _MAX_PUSH_WRAP_DEPTH:\n            return (f\"runs `{seg[i]}` on a command string nested past the depth \"\n",
     "        if False:\n            return (f\"runs `{seg[i]}` on a command string nested past the depth \"\n",
     "r7_bound_depth"),
    ("last call: an unrecognised wrapper shape read as not a push (the first cut)",
     "        return _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned, wrapped, _depth)\n",
     "        return None\n", "r7_unrecognised_shape"),
    ("last call: a push behind an unrecognised shape refused only when it may reach main",
     "            if _git_invokes_push(seg[k:], _env_before(assigned, seg_start + k)):\n",
     "            if _push_reason(seg[k:], _env_before(assigned, seg_start + k)):\n",
     "r7_unrecognised_any_destination"),
    ("last call: a git push subcommand no longer counted as a push unless it may reach main",
     '        if sub == "push" or (sub == "subtree" and j + 1 < len(seg) and seg[j + 1].lower() == "push"):\n',
     "        if False:\n", "r7_unrecognised_any_destination"),
    ("last call: a shell runs a command string only on an exact `-c` (the first cut)",
     "    if not any(_SHELL_C_OPTION_RE.match(t) for t in rest):\n",
     "    if rest[:1] != [\"-c\"]:\n", "r7_shell_option_cluster"),
    ("last call: a string after a recognised wrapper's own flag no longer read",
     "    reads_strings = wrapped or runner in _STRING_RUNNING_PROGRAMS\n",
     "    reads_strings = runner in _STRING_RUNNING_PROGRAMS\n", "r7_wrapped_string"),
    ("last call: a string handed to a string-running program no longer read",
     "    reads_strings = wrapped or runner in _STRING_RUNNING_PROGRAMS\n",
     "    reads_strings = wrapped\n", "r7_string_runner"),
    ("last call: a shell string behind an unrecognised shape read like a bare push, not refused",
     "            reads_strings = True\n", "            pass\n", "r7_shell_behind_unrecognised"),
    # --------------------------------------------------------------------- #
    # gate-r8 (2026-09-21, round 6), founder: "Take all four".
    # --------------------------------------------------------------------- #
    # (2) git named by an expansion, road (a).
    ("r8: a command word built from an expansion not resolved",
     '        if re.search(r"[$`]", tok):\n            # gate-r8 (2), road (a)',
     "        if False:\n            # gate-r8 (2), road (a)", "r8_word_resolved"),
    ("r8: an unresolved command word followed by push not refused",
     "                if _push_follows(seg, i) or _whole_word_holds_push(tok, env_here):\n",
     "                if False or _whole_word_holds_push(tok, env_here):\n", "r8_word_unresolved"),
    ("r8: an unresolved command word that is one substitution holding push not refused",
     "                if _push_follows(seg, i) or _whole_word_holds_push(tok, env_here):\n",
     "                if _push_follows(seg, i) or False:\n", "r8_word_substitution_push"),
    ("r8: an unresolved command word not followed by push no longer read as an unrecognised shape",
     "                return _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned,\n"
     "                                                         wrapped, _depth)\n",
     "                return None\n", "r8_word_unrecognised"),
    ("r8: a same-command IFS not honoured when a resolved word is split",
     "    if isinstance(ifs, str):\n", "    if False:\n", "r8_word_ifs"),
    ("r8: an unknown same-command IFS trusted as the default",
     "    if re.search(r\"[$`]\", resolved) or ifs is _UNRESOLVED:\n",
     "    if re.search(r\"[$`]\", resolved):\n", "r8_word_ifs_unknown"),
    ("r8: a command setting IFS not read when it names neither git nor push",
     '_PREFILTER_RE = re.compile(r"(?i)\\b(?:push|git)\\b|\\bIFS=|\\$\\{\\(")\n',
     '_PREFILTER_RE = re.compile(r"(?i)\\b(?:push|git)\\b|\\$\\{\\(")\n', "r8_word_ifs"),
    ("r8: a resolved expansion not split on blanks",
     "    return resolved.split()\n", "    return [resolved]\n", "r8_word_split"),
    ("r8: push not looked for past git's global flags",
     "    j = _skip_git_global_flags(seg, k + 1)\n", "    j = k + 1\n", "r8_push_follows_flags"),
    ("r8: `subtree push` not counted as push following",
     '    return sub == "push" or (sub == "subtree" and j + 1 < len(seg) and seg[j + 1].lower() == "push")\n',
     '    return sub == "push"\n', "r8_push_follows_subtree"),
    ("r8: a later expansion-built word behind an unrecognised shape not resolved",
     '        if re.search(r"[$`]", tok) and not re.search(r"\\s", tok):\n            # gate-r8 (2): any later single',
     "        if False:\n            # gate-r8 (2): any later single", "r8_scan_resolved"),
    ("r8: a later string holding blanks read as a command word, not as a string",
     '        if re.search(r"[$`]", tok) and not re.search(r"\\s", tok):\n',
     '        if re.search(r"[$`]", tok):\n', "r8_scan_string"),
    ("r8: an unresolved later word followed by push not refused",
     "                if _push_follows(seg, k):\n", "                if False:\n", "r8_scan_unresolved"),
    ("r8: git's own subcommand built from an expansion not resolved",
     '    while j < len(seg) and re.search(r"[$`]", seg[j]):\n', "    while False:\n", "r8_subcommand_resolved"),
    ("r8: an unresolved git subcommand not refused",
     '            return (f"runs git with a subcommand (`{seg[j]}`) built from a shell expansion "\n',
     '            return None and (f"runs git with a subcommand (`{seg[j]}`) built from a shell expansion "\n',
     "r8_subcommand_unresolved"),
    ("r8: a value that is itself an expansion trusted as a literal",
     '        elif re.search(r"[$`(]", m.group(2)):\n', "        elif False:\n", "r8_value_expansion"),
    ("r8: an array value trusted as a literal",
     '        elif re.search(r"[$`(]", m.group(2)):\n', '        elif re.search(r"[$`]", m.group(2)):\n',
     "r8_value_array"),
    # The word reading, which also closes a push inside a double-quoted substitution.
    ("r8: the word reading removed",
     "        lexed = _lex_push_reason(command, report, _depth)\n", "        lexed = None\n", "r8_lex_reading"),
    ("r8: a word reader that raised trusted when shlex read the command",
     '        if "failed" in report:\n', "        if False:\n", "r8_lex_failed"),
    ("r8: a command both readings may misread let through",
     "        if doubt and not _text and _SHLEX_MISREADS_RE.search(command):\n", "        if False:\n", "r8_both_misread"),
    ("r8: a heredoc body line held to the command's misread rule",
     "        if doubt and not _text and _SHLEX_MISREADS_RE.search(command):\n",
     "        if doubt and _SHLEX_MISREADS_RE.search(command):\n", "r8_text_not_doubted"),
    ("r8: a `case` inside a substitution not counted as a misread",
     '        if index and "case" in toks:\n', "        if False:\n", "r8_both_misread"),
    # (1) a word shlex cannot close, road (b).
    ("r8: the word reading's verdict ignored when shlex fails",
     "    if lexed:\n        return lexed\n", "", "r8_fallback_lexed"),
    ("r8: an unreadable heredoc body line read as nothing rather than without its quotes",
     "    if _text:\n        return _token_push_reason(_tokens(re.sub(r\"[\\\"'\\\\]\", \"\", command)), _depth)\n",
     "    if _text:\n        return None\n", "r8_fallback_text"),
    ("r8: a word reader that also fails not refused",
     '    if problem:\n        return (f"shlex cannot close a word',
     '    if False:\n        return (f"shlex cannot close a word', "r8_fallback_misread"),
    ("r8: an open quote or substitution not counted as the word reader failing",
     '    problem = report.get("failed") or report.get("open") or report.get("misread")\n',
     '    problem = report.get("failed") or report.get("misread")\n', "r8_open_dquote"),
    ("r8: heredoc bodies not read when shlex fails",
     "            reason = _direct_push_problem(line, _depth, _text=True)\n", "            reason = None\n",
     "r8_fallback_body"),
    ("r8: an unclosed single quote not reported",
     '            if j >= n:\n                note("open", "a quote runs to the end unclosed")\n',
     "            if j >= n:\n                pass\n", "r8_open_squote"),
    ("r8: an unclosed double quote not reported",
     '            if i >= n:\n                note("open", "a quote runs to the end unclosed")\n',
     "            if i >= n:\n                pass\n", "r8_open_dquote"),
    ("r8: an unclosed substitution not reported",
     '        if j >= n:\n            note("open", "a substitution runs to the end unclosed")\n',
     "        if j >= n:\n            pass\n", "r8_open_substitution"),
    ("r8: an unclosed `${` not reported",
     '                note("open", "a `${` runs to the end unclosed")\n', "                pass\n", "r8_open_param"),
    ("r8: quoting inside `${...}` not reported as a misread",
     '            elif re.search(r"[\\"\'`{]|\\$\\(", s[i + 2:j]):\n', "            elif False:\n",
     "r8_fallback_misread"),
    ("r8: an unclosed in-word parenthesis not reported",
     '                note("open", "a parenthesis inside a word runs to the end unclosed")\n',
     "                pass\n", "r8_open_paren"),
    ("r8: quoting inside an in-word parenthesis not reported as a misread",
     '            elif re.search(r"[\\"\'`\\\\]", s[i:j + 1]):\n', "            elif False:\n", "r8_both_misread_paren"),
    ("r8: skipped heredoc bodies not collected",
     '                    if report is not None:\n                        report.setdefault("bodies", []).append(s[body_start:i])\n',
     "", "r8_fallback_body"),
    ("r8: what a substitution's reading finds not reported back",
     "        inner, nested, j = nested_lex(body, close, report)\n",
     "        inner, nested, j = nested_lex(body, close, None)\n", "r8_fallback_body_in_substitution"),
    ("r8: what a double-quoted substitution's reading finds not reported back",
     '                    inner, nested, j = nested_lex(body, ")" if s[i] == "$" else "`", report)\n',
     '                    inner, nested, j = nested_lex(body, ")" if s[i] == "$" else "`", None)\n',
     "r8_fallback_body_in_quoted_substitution"),
    # gate-r8 last call: five fail-opens in the two roads as first built.
    ("r8 last call: a same-command prefix gives the command's own words their value",
     '    assigned = {name: [(k if k < seg_start else float("inf"), v) for k, v in entries]\n'
     "                for name, entries in assigned.items()}\n",
     "    assigned = assigned\n", "r8lc_prefix"),
    ("r8 last call: a `_=value` trusted as what a later `$_` holds",
     '        elif m.group(1) == "_":\n', "        elif False:\n", "r8lc_underscore"),
    ("r8 last call: `$'...'` escapes read as the escaped letter (the first cut)",
     "            cooked.append(body if ch == \"'\" else _ansi_c(body))\n",
     "            cooked.append(body if ch == \"'\" else re.sub(r\"\\\\(.)\", r\"\\1\", body, flags=re.S))\n",
     "r8lc_ansi_hex"),
    ("r8 last call: a `\\xHH` escape not decoded",
     "            return chr(int(hex2, 16))\n", "            return m.group(0)\n", "r8lc_ansi_hex"),
    ("r8 last call: an octal escape not decoded",
     "            return chr(int(octal, 8) & 0xFF)\n", "            return m.group(0)\n", "r8lc_ansi_octal"),
    ("r8 last call: a `\\u` escape not decoded",
     "            return chr(point) if point <= 0x10FFFF else m.group(0)\n",
     "            return m.group(0)\n", "r8lc_ansi_unicode"),
    ("r8 last call: a `\\c` escape read as its letter",
     "            return chr(ord(control) & 0x1F)\n", "            return control\n", "r8lc_ansi_control"),
    ("r8 last call: an escape neither shell knows keeps its backslash (bash's reading, not zsh's)",
     "        return _ANSI_C_NAMED.get(other, other)\n", "        return _ANSI_C_NAMED.get(other, m.group(0))\n",
     "r8lc_ansi_unknown"),
    ("r8 last call: a `$'...'` string not ended at a NUL",
     '    return _ANSI_C_ESCAPE_RE.sub(decode, body).split("\\0", 1)[0]',
     "    return _ANSI_C_ESCAPE_RE.sub(decode, body)", "r8lc_ansi_nul"),
    ("r8 last call: zsh's `=name` not read as the program",
     '    if len(word) > 1 and word.startswith("="):\n        word = word[1:]\n', "", "r8lc_equals"),
    ("r8 last call: a script body not read whole",
     '    for body in report.get("scripts", []):\n', "    for body in []:\n", "r8lc_script"),
    ("r8 last call: heredoc bodies not read when shlex reads the command",
     "        return _heredoc_push_reason(report, _depth)\n", "        return None\n", "r8lc_script_quoted"),
    ("r8 last call: heredoc bodies not read in the unreadable-word fallback",
     "    reason = _heredoc_push_reason(report, _depth)\n    if reason:\n        return reason\n", "",
     "r8lc_script"),
    ("r8 last call: no heredoc read as a shell's script",
     "            if _heredoc_runs_as_script(words, at):\n", "            if False:\n", "r8lc_script"),
    ("r8 last call: a shell later in the heredoc's pipeline not counted",
     "    hi, depth, j, after_pipe = last, 0, last + 1, False\n    while j < len(words):\n",
     "    hi, depth, j, after_pipe = last, 0, last + 1, False\n    while False:\n", "r8lc_script_piped"),
    ("r8 last call: a shell anywhere on the line counted, not only in the heredoc's pipeline",
     '            if not (set(raw) == {"\\n"} and j > 0 and _is_pipe_word(words[j - 1][1])):\n                break\n',
     "            pass\n", "r8lc_script_text"),
    ("r8 last call: an unquoted-delimiter body's substitutions not read",
     '    for body in report.get("expanding", []):\n', "    for body in []:\n", "r8lc_expanding"),
    ("r8 last call: a backtick in an unquoted-delimiter body not read",
     '            elif body[i] == "`":\n', "            elif False:\n", "r8lc_expanding_backtick"),
    ("r8 last call: an escaped `$(` in a body read as a substitution",
     '                i += 2 if body[i] == "\\\\" else 1  # an escaped', "                i += 1  # an escaped",
     "r8lc_expanding_escaped"),
    # gate-r8 last call, finished: what the unstaged fix still let through.
    ("r8 finish: no pending heredoc body weighed as a script",
     "                        pending.append((at, s[body_start:i]))\n", "                        pass\n", "r8lc_script"),
    ("r8 finish: a level's bodies not settled when the level ends at its closer",
     "            end_word()\n            settle()\n            return words, subs, i\n",
     "            end_word()\n            return words, subs, i\n", "r8lc_script_quoted"),
    ("r8 finish: the command's own bodies not settled at its end",
     "    end_word()\n    settle()\n    return words, subs, n\n",
     "    end_word()\n    return words, subs, n\n", "r8lc_script"),
    ("r8 finish: a body carried up from a substitution not weighed at the word holding it",
     '            pending.extend((len(words), carried) for carried in rep["carried"][mark:])\n',
     "            pass\n", "r8f_psub"),
    ("r8 finish: a pipe that ends its line read as ending the pipeline",
     '    return _is_operator_word(raw) and raw.rstrip("\\n") in ("|", "|&")\n',
     '    return raw in ("|", "|&")\n', "r8f_pipe_continued"),
    ("r8 finish: a blank line after a trailing pipe read as ending the pipeline",
     '            elif not (after_pipe and set(raw) == {"\\n"}):\n', "            elif True:\n", "r8f_pipe_blank_line"),
    ("r8 finish: the group holding a heredoc not widened to its own pipeline",
     "        opener = _group_opener(words, first)\n", "        opener = None\n", "r8f_subshell"),
    ("r8 finish: a keyword or brace does not open a group",
     '    return raw == "(" or (raw == cooked and cooked in _GROUP_OPENERS and _starts_command(words, k))\n',
     '    return raw == "("\n', "r8f_keyword_group"),
    ("r8 finish: a keyword or brace does not close a group",
     '    return raw == ")" or (raw == cooked and cooked in _GROUP_CLOSERS and _starts_command(words, k))\n',
     '    return raw == ")"\n', "r8f_keyword_group"),
    ("r8 finish: a keyword or brace opens a group wherever it stands, not only as a command",
     '    return raw == "(" or (raw == cooked and cooked in _GROUP_OPENERS and _starts_command(words, k))\n',
     '    return raw == "(" or (raw == cooked and cooked in _GROUP_OPENERS)\n', "r8f_opener_as_argument"),
    ("r8 finish: a keyword or brace closes a group wherever it stands, not only as a command",
     '    return raw == ")" or (raw == cooked and cooked in _GROUP_CLOSERS and _starts_command(words, k))\n',
     '    return raw == ")" or (raw == cooked and cooked in _GROUP_CLOSERS)\n', "r8f_closer_as_argument"),
    ("r8 finish: `.` and `source` not read as running a heredoc (the unstaged fix's `.`, stripped to nothing)",
     "    if name in _SCRIPT_RUNNERS:  # `.` or `source`", "    if False:  # `.` or `source`", "r8f_dot"),
    ("r8 finish: `.` read as running a heredoc wherever it stands, not only as the command",
     "`git -C . commit -F - <<'EOF'`\n        return _runs_as_command(words, k)\n",
     "`git -C . commit -F - <<'EOF'`\n        return True\n", "r8f_dot_as_argument"),
    ("r8 finish: a command word built from an expansion not read as a possible shell",
     '    if re.search(r"[$`]", cooked):\n        return _runs_as_command(words, k)\n',
     '    if False:\n        return _runs_as_command(words, k)\n', "r8f_expansion_runner"),
    ("r8 finish: a command word past a named wrapper not read as the command",
     "    j = k\n    while j > 0:\n", "    j = k\n    while False:\n", "r8f_expansion_runner_wrapped"),
    ("r8 finish: a quoted delimiter's body read as expanding",
     'delim_strip, bool(re.search(r"[\\"\'\\\\]", "".join(raw))),', "delim_strip, False,", "r8f_quoted_text"),
    ("r8 finish: zsh's `=name` not read as the program on the wrapper, shell and runner lists",
     '    return os.path.basename(word[1:] if len(word) > 1 and word.startswith("=") else word).lower()\n',
     "    return os.path.basename(word).lower()\n", "r8f_zsh_shell"),
    ("r8 finish: a crash in the push check fails open (exit 1: the harness runs the command)",
     "    except Exception as exc:  # noqa: BLE001 -- a crash here must not fail open\n        # gate-r8 last call, completed:",
     "    except ZeroDivisionError as exc:  # noqa: BLE001 -- a crash here must not fail open\n        # gate-r8 last call, completed:",
     "r8f_crash"),
    ("r8 finish: heredoc scripts read past the depth bound",
     "        if _depth >= _MAX_PUSH_WRAP_DEPTH:\n            return (\"runs a heredoc body as a shell's script",
     "        if False:\n            return (\"runs a heredoc body as a shell's script", "r8f_script_depth"),
    ("r8 finish: an unquoted body's substitutions read past the depth bound",
     "            if _depth >= _MAX_PUSH_WRAP_DEPTH:\n                return (\"runs a substitution in a heredoc body",
     "            if False:\n                return (\"runs a substitution in a heredoc body", "r8f_substitution_depth"),
    ("r8 finish: an unquoted body's substitution read word by word, its own heredocs skipped",
     "            reason = _direct_push_problem(body[start:i], _depth + 1)\n",
     "            reason = _token_push_reason(_group_tokens(_words), _depth)\n", "r8f_expanding_heredoc"),
    ("r8 finish: a `case` pattern's `)` read as closing a group",
     "    words = _without_case_patterns(words)\n", "    words = list(words)\n", "r8f_case"),
    ("r8 finish: a later `case` branch's pattern read as a group's `)`",
     '        elif states[-1] == "body" and _is_operator_word(raw) and re.search(r";;|;&", raw):\n',
     "        elif False:\n", "r8f_case_second_branch"),
    ("r8 finish: quoting inside git and push hides the command from the prefilter",
     "    if not (_PREFILTER_RE.search(command) or _PREFILTER_RE.search(_unquoted(command))):\n",
     "    if not _PREFILTER_RE.search(command):\n", "r8f_quoted_words"),
    ("r8 finish: the prefilter does not decode `$'...'`",
     "    decoded = re.sub(r\"\\$'((?:[^'\\\\]|\\\\.)*)'\", lambda m: _ansi_c(m.group(1)), command, flags=re.S)\n",
     "    decoded = command\n", "r8f_ansi_words"),
    ("r8 finish: a zsh parameter flag does not open the reading",
     '_PREFILTER_RE = re.compile(r"(?i)\\b(?:push|git)\\b|\\bIFS=|\\$\\{\\(")\n',
     '_PREFILTER_RE = re.compile(r"(?i)\\b(?:push|git)\\b|\\bIFS=")\n', "r8f_zsh_flag_separator"),
    ("r8 finish: zsh's `$=NAME`/`${=NAME}` not resolved as NAME",
     '_VAR_REF_RE = re.compile(r"\\$\\{[=~^]*(\\w+)\\}|\\$[=~^]*(\\w+)")\n',
     '_VAR_REF_RE = re.compile(r"\\$\\{(\\w+)\\}|\\$(\\w+)")\n', "r8f_zsh_split_resolved"),
    ("r8 finish: a command word whose same-command value holds push not refused",
     "                if _value_holds_push(tok, assigned, seg_start + i):\n                    return _unresolved_git_reason(tok)\n",
     "                if False:\n                    return _unresolved_git_reason(tok)\n", "r8f_zsh_flags"),
    ("r8 finish: a later word whose same-command value holds push not refused",
     "                if _value_holds_push(tok, assigned, seg_start + k):\n                    return _unresolved_git_reason(tok)\n",
     "                if False:\n                    return _unresolved_git_reason(tok)\n", "r8f_zsh_flags_wrapped"),
    ("r8 finish: a value holding push only as its own word",
     '        if any(index < start and isinstance(v, str) and re.search(r"(?i)push", v)\n',
     '        if any(index < start and isinstance(v, str) and re.search(r"(?i)\\bpush\\b", v)\n',
     "r8f_zsh_flag_separator"),
    ("r8 finish: a prefix or later value read as what an unresolved word holds",
     '        if any(index < start and isinstance(v, str) and re.search(r"(?i)push", v)\n',
     '        if any(isinstance(v, str) and re.search(r"(?i)push", v)\n', "r8f_prefix_value"),
    ("r8 finish: a name under a zsh flag in parentheses not found",
     '_PARAM_NAME_RE = re.compile(r"\\$\\{(?:\\([^)]*\\))?[=~^]*(\\w+)|\\$[=~^]*(\\w+)")\n',
     '_PARAM_NAME_RE = re.compile(r"\\$\\{[=~^]*(\\w+)|\\$[=~^]*(\\w+)")\n', "r8f_zsh_flags"),
    # --------------------------------------------------------------------- #
    # gate8c (round 6y, 2026-09-22). Founder's word: "Close them here
    # (Recommended)" -- the five real pushes gate-r8's last call found.
    # --------------------------------------------------------------------- #
    ("gate8c: a whole `${...}` default/alternate-value word not matched at all",
     "    m = _PARAM_DEFAULT_RE.match(tok)\n    if not m:\n        return False\n",
     "    m = None\n    if not m:\n        return False\n", "g8c_param_default"),
    ("gate8c: its resolved default-text words not checked for push",
     '    return any(w.lower() == "push" for w in words)\n', "    return False\n", "g8c_param_default_split"),
    ("gate8c: its unresolved default text not checked for push (the fallback the plain $(...) word-boundary check already has)",
     '        return bool(re.search(r"(?i)\\bpush\\b", m.group(1)))\n', "        return False\n",
     "g8c_param_default_unresolved"),
    ("gate8c: eval no longer re-reads its arguments as a command string",
     '        if name == "eval":\n', "        if False:\n", "g8c_eval"),
    ("gate8c: eval's joined string not recursively re-read",
     '    return _direct_push_problem(outer + joined, _depth + 1)\n', "    return None\n", "g8c_eval"),
    ("gate8c last call: eval's string re-read without the command's own assignments",
     '    return _direct_push_problem(outer + joined, _depth + 1)\n',
     '    return _direct_push_problem(joined, _depth + 1)\n', "g8c_eval_outer_ifs"),
    ("gate8c last call: eval's own prefix read as after it, the way an ordinary command's is",
     "                                             _eval_outer_statements(outer, seg_start + i))\n",
     "                                             _eval_outer_statements(assigned, seg_start + i))\n",
     "g8c_eval_own_prefix"),
    ("gate8c last call: a name eval may read before its first assignment trusted as that value",
     '            statements.append(f"{name}=$_")\n', "            pass\n", "g8c_eval_outer_later"),
    ("gate8c last call: eval's older string-runner reading dropped (the first build)",
     "                    or _unrecognised_wrapper_push_reason(seg, i, seg_start, assigned,\n"
     "                                                         wrapped, _depth))\n",
     "                    or None)\n", "g8c_eval_alias"),
    ("gate8c: eval's arguments not joined before re-reading them (the first alone holds no push)",
     '    joined = " ".join(rest)\n', "    joined = rest[0]\n", "g8c_eval_joined"),
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
    # DIRECT_PUSH_PATTERN never catches a bare push (no literal "main"); only
    # _direct_push_problem() (gate-r3 path-push-bare-and-broad) does, so this
    # scenario properly isolates it.
    "h20_bare_push": lambda h: ("git " + "push", 2, None, {}),
    "h15": lambda h: ("gh pr $'merge' 2 --squash", 2, None, {}),
    # Each below is caught by one reading only; the clean PR 1 merges without it.
    "h15q": lambda h: (f"gh pr 'merge' 1 --squash --match-head-commit {h['1']}", 2, None, {}),
    # gate-r3: was a $-based expansion ("G=gh; $G pr merge"), but
    # merge_invocations()'s OWN new identity check (shell-renamed-gh-direct-
    # merge) now ALSO independently rejects "$G" as not-provably-gh -- via
    # _MERGE_PROBE_RE's own `\$\S*` alternative counting it as a probe hit
    # that `found` then can't place, "CANNOT CHECK"s it regardless of this
    # mutation, so it no longer isolates THIS specific check. A glob-based
    # expansion ("g?") isolates it again: _MERGE_PROBE_RE's probe does not
    # recognize a bare glob at all (no $, no literal gh), so nothing but
    # THIS check in unplain_gh_word ever catches it.
    "h15pr": lambda h: (f"/usr/local/bin/g? pr merge 1 --squash --match-head-commit {h['1']}", 2, None, {}),
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
    "r4_api_literal": lambda h: (f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}", 0, None, {}),
    "r4_api_nonliteral": lambda h: (f"N=2; gh api -X PUT repos/{REPO}/pulls/$N/merge -f sha={'d' * 40}", 2, None, {}),
    "r4_push_head": lambda h: ("git push origin HEAD", 2, None, {}),
    "r5_push_plus_head": lambda h: ("git push origin +HEAD", 2, None, {}),
    "r4_push_wildcard": lambda h: ("git push origin 'refs/heads/*:refs/heads/*'", 2, None, {}),
    "r4_push_var_develop": lambda h: ("B=develop; git push origin HEAD:$B", 0, None, {}),
    "r4_push_var_cmdsub": lambda h: ("B=$(echo main); git push origin HEAD:$B", 2, None, {}),
    "r4_gh_ifs": lambda h: (_api_command(GH_WORD_SPELLINGS["ifs_braced"], "non_literal_pr"), 2, None, {}),
    "r4_gh_expanded": lambda h: (_api_command(UNSURE_SPELLINGS["gh_in_a_variable"], "non_literal_pr"), 2, None, {}),
    "r4_gh_expanded_literal": lambda h: (
        UNSURE_SPELLINGS["gh_in_a_variable"].format(f"-X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}"),
        2, None, {}),
    "r4_gh_bash_c": lambda h: ("bash -c '" + _api_command(UNSURE_SPELLINGS["gh_in_a_variable"], "non_literal_pr")
                               .replace("'", '"') + "'", 2, None, {}),
    # No gh or pr word anywhere, so unplain_gh_word() (which also fails closed on
    # an unreadable command, but only for one naming gh/pr) never runs: only
    # _gh_api_reading's own fail-closed `except` refuses this.
    "r4_gh_unreadable": lambda h: ("S=api; " + "$(" * 22 + f"$P $S {API_SURFACES['graphql'][0]}" + ")" * 22,
                                   2, None, {}),
    # A command that names no merge surface and is not gh api at all: the gate is
    # only a cost/behaviour guard, so this pins that the reading is skipped for it.
    "r4_gh_ordinary": lambda h: ("gh api user", 0, None, {}),
    # 2026-09-21 founder answer, "Bind it to the segment": an unrelated `gh api`
    # call earlier in the command must not exempt a DIFFERENT program's call to
    # the merge endpoint later in it.
    "r6_gh_api_segment_binding": lambda h: (
        f"gh api user >/dev/null; curl -X PUT https://api.github.com/repos/{REPO}/pulls/2/merge -d '{{}}'",
        2, None, {}),
    # 2026-09-21 founder answer, "Teach it export": `export NAME=value` reaches
    # main exactly as directly as the already-fixed bare `NAME=value` case does.
    "r6_export_assignment": lambda h: ("export B=main; git push origin feat:$B", 2, None, {}),
    # gate-r6 last call: the founder's scenario inside a string another shell runs.
    "r6_bound_nested": lambda h: (
        f"bash -c 'gh api user >/dev/null; curl -X PUT https://api.github.com/repos/{REPO}/pulls/2/merge'",
        2, None, {}),
    # The founder's scenario with the endpoint built around a substitution.
    "r6_bound_built_url": lambda h: (
        "gh api user >/dev/null; curl -X PUT "
        f"\"$(printf 'https://api.github.com')/repos/{REPO}/pulls/2/merge\"", 2, None, {}),
    # A literal-PR gh api merge beside a curl merge nested past _lex's limit:
    # the whole-text reading sees gh api, the binding reader raises. Through an
    # exec tool's input, so unplain_gh_word()'s own unreadable-command refusal
    # (Bash only) cannot mask this reader's.
    "r6_bound_unreadable": lambda h: (
        f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}; "
        + "$(" * 22 + f"curl -X PUT https://api.github.com/repos/{REPO}/pulls/3/merge" + ")" * 22,
        2, "mcp__terminal__run_in_terminal", {}),
    # The owned-PR route four shells deep: past the bound, refused rather than read.
    "r6_bound_depth": lambda h: (
        _nested(f"gh api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}", 4), 2, None, {}),
    # Only "maybe" gh in the segment that makes the call; plain gh api elsewhere.
    "r6_bound_maybe_segment": lambda h: (
        f"gh api user >/dev/null; G=gh; $G api -X PUT repos/{REPO}/pulls/2/merge -f sha={'d' * 40}",
        2, None, {}),
    # The call only in a heredoc body (no segment to bind), gh only "maybe" elsewhere.
    "r6_expanded_gh_dropped_text": lambda h: (
        f"G=gh; $G api user; bash <<'EOF'\ncurl -X PUT https://api.github.com/repos/{REPO}/pulls/2/merge\nEOF",
        2, None, {}),
    "r6_export_flags": lambda h: ("export -n B=main; git push origin feat:$B", 2, None, {}),
    "r6_env_any_main": lambda h: ("export B=main; git push origin feat:$B; export B=develop", 2, None, {}),
    "r6_env_read_before_assigned": lambda h: ("git push origin HEAD:$B; export B=develop", 2, None, {}),
    # gate-r7 (2026-09-21), founder's env-prefix/wrapper push answer.
    "r7_wrapper_stripping_removed": lambda h: ("X=1 git push origin HEAD", 2, None, {}),
    # The unrecognised-shape reading refuses a main push on its own, so the
    # recognised peels are pinned where they matter: a NON-main push behind
    # one is read like a bare push and allowed, where an unrecognised shape
    # would refuse it.
    "r7_assignment_prefix": lambda h: ("X=1 git push origin feature", 0, None, {}),
    "r7_bare_wrapper": lambda h: ("nohup git push origin feature", 0, None, {}),
    "r7_shell_c_literal": lambda h: ("bash -c 'git push origin HEAD'", 2, None, {}),
    # An unresolvable -c argument (a shell expansion) must fail CLOSED even
    # when the recursive read, if it ran, would itself find nothing wrong --
    # an explicit non-main destination means _push_reason()'s OWN unresolved-
    # variable check (which only ever looks at the DESTINATION half of a
    # refspec) never fires on the source-side "$SRC", so only THIS check
    # stands between the mutant and a silent allow.
    "r7_shell_c_unrecognised": lambda h: ('bash -c "git push origin $SRC:feature"', 2, None, {}),
    # Past the depth bound with a NON-main destination: the unmutated hook
    # fails closed (refuses) rather than recursing through to find it is
    # actually harmless; the mutant recurses fully and allows it.
    "r7_bound_depth": lambda h: (_nested("git push origin feature", 4), 2, None, {}),
    "r7_unrecognised_shape": lambda h: ("sudo -u root git push origin HEAD", 2, None, {}),
    "r7_unrecognised_any_destination": lambda h: ("timeout 60 git push -u origin feat/x", 2, None, {}),
    "r7_shell_option_cluster": lambda h: ("sh -ec 'git push origin HEAD'", 2, None, {}),
    "r7_wrapped_string": lambda h: ("env -S 'git push origin HEAD'", 2, None, {}),
    # gate8c gave `eval` its own dedicated re-reading (above), which now
    # intercepts it before this generic reads_strings check is ever reached,
    # so `eval` itself no longer distinguishes this mutation; `watch` is
    # still read only through _STRING_RUNNING_PROGRAMS here.
    "r7_string_runner": lambda h: ("watch 'git push origin HEAD'", 2, None, {}),
    "r7_shell_behind_unrecognised": lambda h: ("timeout 5 bash -c 'git push origin feature'", 2, None, {}),
    # gate-r8 (2026-09-21, round 6).
    "r8_push_var_fragment": lambda h: ("B=<(echo main); git push origin HEAD:$B", 2, None, {}),
    "r8_word_resolved": lambda h: ("G=git; $G push origin HEAD", 2, None, {}),
    "r8_word_unresolved": lambda h: ("$(echo git) push origin HEAD", 2, None, {}),
    # Refused before gate-r8 too (an unrecognised shape); the branch keeps it so.
    "r8_word_unrecognised": lambda h: ("$SUDO git push origin feat/x", 2, None, {}),
    "r8_word_substitution_push": lambda h: ("$(printf 'git push') origin HEAD", 2, None, {}),
    "r8_word_ifs": lambda h: ("IFS=x; W=gitxpush; $W origin HEAD", 2, None, {}),
    "r8_word_ifs_unknown": lambda h: ("IFS=$X; G=git; $G push origin feat/x", 2, None, {}),
    "r8_word_split": lambda h: ('G="git push origin HEAD"; $G', 2, None, {}),
    # Seven words spliced in for one: the push still reads B's later
    # assignment as made after it (the gate-r8 last call dropped the index
    # shift these once pinned: every word of a segment now reads only the
    # assignments made before the segment, so a splice cannot move it).
    "r8_word_index": lambda h: ('W="nohup nohup nohup nohup nohup nohup nohup"; '
                                "$W git push origin HEAD:$B; B=develop", 2, None, {}),
    "r8_push_follows_flags": lambda h: ("$(echo git) -C . push origin HEAD", 2, None, {}),
    "r8_push_follows_subtree": lambda h: ("$(echo git) subtree push --prefix=x origin HEAD", 2, None, {}),
    "r8_scan_resolved": lambda h: ("G=git; timeout 10 $G push origin feat/x", 2, None, {}),
    "r8_scan_unresolved": lambda h: ("timeout 10 $G push origin feat/x", 2, None, {}),
    # A string handed to a program known to run strings is read as a string
    # (gate-r7), even when it holds `$`: the replay found 14 such r7 refusals
    # (`node -e '...${x}...push...'`) that a first cut of gate-r8 let through.
    "r8_scan_string": lambda h: ("node -e 'const x = $y; git push origin HEAD'", 2, None, {}),
    # The same behind an unrecognised shape: `$G` does not read its later
    # `G=docker` as set before it, so the push is not read as `docker push`.
    "r8_scan_index": lambda h: ('W="a a a a a a a"; timeout 5 $W $G push origin HEAD; G=docker', 2, None, {}),
    "r8_subcommand_resolved": lambda h: ("P=push; git $P origin HEAD", 2, None, {}),
    "r8_subcommand_unresolved": lambda h: ("git $(echo push) origin HEAD", 2, None, {}),
    "r8_value_expansion": lambda h: ("X=main; B=$X; git push origin HEAD:$B", 2, None, {}),
    # Only the word reading can read it (shlex cannot close `$'\''`), and it
    # keeps `B=(main)` whole: only the `(` in the value makes it unresolved.
    "r8_value_array": lambda h: ("B=(main); git push origin HEAD:$B; echo $'\\''", 2, None, {}),
    "r8_lex_reading": lambda h: ('echo "$(git push origin HEAD)"', 2, None, {}),
    "r8_lex_failed": lambda h: ('echo "' + "$(" * 22 + "git push origin HEAD" + ")" * 22 + '"', 2, None, {}),
    "r8_both_misread": lambda h: ('echo "$(case a in a) git push origin HEAD;; esac)"', 2, None, {}),
    "r8_both_misread_paren": lambda h: ("echo $'\\''; x=(')')\ngit push origin HEAD\necho ')''", 2, None, {}),
    "r8_fallback_lexed": lambda h: ("git push origin HEAD; echo $'\\''", 2, None, {}),
    "r8_fallback_text": lambda h: ("git commit -F - <<'EOF'\nWe don't run git push origin HEAD here\nEOF", 2, None, {}),
    # A heredoc body line is text: the both-readings rule is the command's, not
    # the text's (the replay found 37 body lines of JS it refused otherwise).
    "r8_text_not_doubted": lambda h: ("git commit -F - <<'EOF'\nDon't break it\nlog.push(`${x}`)\nEOF", 0, None, {}),
    "r8_fallback_misread": lambda h: ("echo $'\\''; echo ${X:-\"}\"}\ngit push origin HEAD\necho \"", 2, None, {}),
    "r8_open_dquote": lambda h: ('git status; echo "unclosed', 2, None, {}),
    "r8_open_squote": lambda h: ("git status; echo 'unclosed", 2, None, {}),
    "r8_open_substitution": lambda h: ("git status; echo $(unclosed", 2, None, {}),
    "r8_open_param": lambda h: ("git status; echo ${X; echo $'\\''", 2, None, {}),
    "r8_open_paren": lambda h: ("git status; x=(a; echo $'\\''", 2, None, {}),
    # Re-pinned by the gate-r8 last call's finishing pass: an unquoted body's
    # `$(git push ...)` is now also read by the expanding reading, so it no
    # longer isolates the line reading. Only the line reading sees a push in a
    # quoted body that goes to a file a shell runs later (a real push, pinned
    # by test_r8_only_the_line_reading_stops_a_push_through_a_file).
    "r8_fallback_body": lambda h: ("echo $'\\''\ncat > p.sh <<'EOF'\ngit push origin HEAD\nEOF\nbash p.sh",
                                   2, None, {}),
    "r8_fallback_body_in_substitution": lambda h: (
        "echo $'\\''; x=$(cat <<EOF\n$(git push origin HEAD)\nEOF\n)", 2, None, {}),
    "r8_fallback_body_in_quoted_substitution": lambda h: (
        "echo $'\\''; x=\"$(cat <<EOF\n$(git push origin HEAD)\nEOF\n)\"", 2, None, {}),
    # gate-r8 last call.
    "r8lc_prefix": lambda h: ("declare G=git; G=true $G push origin HEAD", 2, None, {}),
    "r8lc_underscore": lambda h: ("_=x; echo git; $_ push origin HEAD", 2, None, {}),
    "r8lc_ansi_hex": lambda h: ("git push origin $'\\x6dain'; echo $'\\''", 2, None, {}),
    "r8lc_ansi_octal": lambda h: ("g$'\\151't push origin HEAD; echo $'\\''", 2, None, {}),
    "r8lc_ansi_unicode": lambda h: ("$'\\u0067it' push origin HEAD; echo $'\\''", 2, None, {}),
    # Read as its letter, `\c` would spell git: the control character does not.
    "r8lc_ansi_control": lambda h: ("$'\\cgit' push origin HEAD; echo $'\\''", 0, None, {}),
    "r8lc_ansi_unknown": lambda h: ("$'\\git' push origin HEAD; echo $'\\''", 2, None, {}),
    "r8lc_ansi_nul": lambda h: ("$'git\\0x' push origin HEAD; echo $'\\''", 2, None, {}),
    "r8lc_equals": lambda h: ("=git push origin HEAD", 2, None, {}),
    "r8lc_script": lambda h: ("bash <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''", 2, None, {}),
    "r8lc_script_quoted": lambda h: ("x=\"$(bash <<'EOF'\ngit push origin HEAD\nEOF\n)\"", 2, None, {}),
    "r8lc_script_piped": lambda h: (
        "cat <<'EOF' | bash\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''", 2, None, {}),
    # A shell earlier on the line, past `&&`, does not make a message a script.
    "r8lc_script_text": lambda h: ("bash -c true && cat > msg.txt <<'EOF'\nIt's a git thing\nEOF", 0, None, {}),
    "r8lc_expanding": lambda h: ("echo \"$(cat <<EOF\n$(git push origin HEAD)\nEOF\n)\"", 2, None, {}),
    "r8lc_expanding_backtick": lambda h: ("echo \"$(cat <<EOF\n`git push origin HEAD`\nEOF\n)\"", 2, None, {}),
    # An escaped `$(` in a body is text: nothing runs.
    "r8lc_expanding_escaped": lambda h: ("echo \"$(cat <<EOF\n\\$(git push origin HEAD)\nEOF\n)\"", 0, None, {}),
    # gate-r8 last call, finished.
    "r8f_psub": lambda h: ("echo \"$(bash <(cat <<'EOF'\ngit push origin HEAD\nEOF\n))\"", 2, None, {}),
    "r8f_pipe_continued": lambda h: (
        "cat <<'EOF' |\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\nbash\necho $'\\''", 2, None, {}),
    "r8f_pipe_blank_line": lambda h: (
        "cat <<'EOF' |\n\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n\nbash\necho $'\\''", 2, None, {}),
    "r8f_subshell": lambda h: ("x=\"$( (cat <<'EOF'\ngit push origin HEAD\nEOF\n) | bash)\"", 2, None, {}),
    "r8f_keyword_group": lambda h: (
        "if true; then cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\nfi | bash\necho $'\\''", 2, None, {}),
    # A brace or keyword that is an argument opens and closes nothing: the
    # heredoc goes to cat and no shell reads it.
    "r8f_opener_as_argument": lambda h: ("echo {; cat <<'EOF'\nIt's a git thing\nEOF\n} | bash", 0, None, {}),
    "r8f_closer_as_argument": lambda h: ("{ cat <<'EOF'\nIt's a git thing\nEOF\necho } | bash", 0, None, {}),
    "r8f_dot": lambda h: (". /dev/stdin <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''", 2, None, {}),
    "r8f_dot_as_argument": lambda h: ("git -C . commit -F - <<'EOF'\nIt's a git thing\nEOF", 0, None, {}),
    "r8f_expansion_runner": lambda h: (
        "echo bash; $_ <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''", 2, None, {}),
    "r8f_expansion_runner_wrapped": lambda h: (
        "echo bash; nohup $_ <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\necho $'\\''", 2, None, {}),
    # A quoted delimiter's `$(...)` is text inside a PR body: nothing runs.
    "r8f_quoted_text": lambda h: (
        "gh pr create --title t --body \"$(cat <<'EOF'\nrun $(git push origin HEAD) later\nEOF\n)\"", 0, None, {}),
    "r8f_zsh_shell": lambda h: ("=bash -c 'git push origin HEAD'", 2, None, {}),
    # 22 nested `$(` in an unquoted body: the word reader raises, and the hook
    # refuses rather than exit 1 (which the harness lets run).
    "r8f_crash": lambda h: ("cat <<EOF\n" + "$(" * 22 + "true" + ")" * 22 + "\nEOF\ngit push origin feat/x",
                            2, None, {}),
    # Four heredoc scripts deep: refused at the bound, as a fourth `bash -c` is.
    "r8f_script_depth": lambda h: ("bash <<'E1'\nbash <<'E2'\nbash <<'E3'\nbash <<'E4'\ngit status\nE4\nE3\nE2\nE1",
                                   2, None, {}),
    "r8f_substitution_depth": lambda h: (
        "cat <<A\n$(cat <<B\n$(cat <<C\n$(cat <<D\n$(git status)\nD\n)\nC\n)\nB\n)\nA", 2, None, {}),
    "r8f_expanding_heredoc": lambda h: (
        "echo \"$(cat <<EOF\n$(bash <<'X'\ngit push origin HEAD\nX\n)\nEOF\n)\"", 2, None, {}),
    "r8f_case": lambda h: (
        "case a in a) cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n;; esac | bash\necho $'\\''", 2, None, {}),
    "r8f_case_second_branch": lambda h: (
        "case b in a) true;; b) cat <<'EOF'\nIFS=x\nW=gitxpush; $W origin HEAD\nEOF\n;; esac | bash\necho $'\\''",
        2, None, {}),
    "r8f_quoted_words": lambda h: ('"g"it "p"ush origin HEAD', 2, None, {}),
    "r8f_ansi_words": lambda h: ("$'\\x67it' $'\\x70ush' origin HEAD", 2, None, {}),
    "r8f_zsh_flag_separator": lambda h: ("G=gitxpushxoriginxHEAD; ${(s:x:)G}", 2, None, {}),
    # Resolved, `${=G}` is a push to a named branch: allowed, not refused as
    # an unresolved word whose value holds push.
    "r8f_zsh_split_resolved": lambda h: ('G="git push"; ${=G} origin feat/x', 0, None, {}),
    "r8f_zsh_flags": lambda h: ('G="git push origin HEAD"; ${(z)G}', 2, None, {}),
    "r8f_zsh_flags_wrapped": lambda h: ('G="git push origin HEAD"; nice ${(z)G}', 2, None, {}),
    # A prefix gives the command's own words nothing: `${(z)G}` is the
    # caller's G (unset here), so this runs no push.
    "r8f_prefix_value": lambda h: ('G="git push origin HEAD" ${(z)G}', 0, None, {}),
    # gate8c (round 6y, 2026-09-22). Founder's word: "Close them here
    # (Recommended)" -- the five real pushes gate-r8's last call found.
    "g8c_param_default": lambda h: ("${G:-git push} origin HEAD", 2, None, {}),
    # The same-command IFS split reaching the default text itself.
    "g8c_param_default_split": lambda h: ("IFS=x; ${W:-gitxpush} origin HEAD", 2, None, {}),
    # The default text holds an unresolved `$X` alongside the literal
    # "push": `_expansion_words` cannot resolve it (None), so only the
    # unresolved-text fallback's word-boundary check sees the push.
    "g8c_param_default_unresolved": lambda h: ("${G:-$X push} origin HEAD", 2, None, {}),
    "g8c_eval": lambda h: ("eval 'IFS=x; W=gitxpush; $W origin HEAD'", 2, None, {}),
    # eval's two arguments joined with a blank before re-reading: neither
    # argument alone holds a push.
    "g8c_eval_joined": lambda h: ("eval 'IFS=x; W=gitxpush;' '$W origin HEAD'", 2, None, {}),
    # gate8c last call. eval re-reads its string in the same shell, under the
    # command's own assignments: the IFS set before it splits `$W`.
    "g8c_eval_outer_ifs": lambda h: ("IFS=x; W=gitxpush; eval '$W origin HEAD'", 2, None, {}),
    # ... and under its own prefix (neither value names push, so only the
    # split reading sees `$A$B` become git push).
    "g8c_eval_own_prefix": lambda h: ("A=gitxpu; B=sh; IFS=x eval '$A$B origin HEAD'", 2, None, {}),
    # B is assigned only after the eval, so the eval may see the caller's own
    # B (main): read as `feat`, the push would pass.
    "g8c_eval_outer_later": lambda h: ("IFS=x; W=gitxpush; eval '$W origin HEAD:$B'; B=feat", 2, None, {}),
    # The string-runner reading eval had before gate8c, still applied: the
    # re-read alone reads a git alias the command defines as not a push.
    "g8c_eval_alias": lambda h: ("eval 'git -c alias.p=push p origin HEAD'", 2, None, {}),
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
