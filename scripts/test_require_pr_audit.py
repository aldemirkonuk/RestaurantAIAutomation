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
    naming neither gh nor pr never reaches the reader and still passes."""
    source = HOOK.read_text()
    head = "def _lex(s: str, i: int, closer: str | None, depth: int):\n"
    assert source.count(head) == 1
    crashing = source.replace(head, head + "    raise RuntimeError('injected')\n", 1)
    clone, _h, env = build(tmp_path, {"2": OWNED}, hook_source=crashing)
    args, reason = API_SURFACES["graphql"]
    out = run_hook(clone, env, f"S=api; gh $S {args}")
    assert out.returncode == 2 and reason in out.stderr and "cannot confirm is gh" in out.stderr, out.stderr
    assert run_hook(clone, env, "git status").returncode == 0
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


@pytest.mark.parametrize("command", ["git push origin HEAD", "git push origin @"])
def test_r4_push_head_or_at_with_no_explicit_destination_is_blocked(two, command):
    """path-push-refspec-ambiguous: a bare `HEAD`/`@` refspec names the
    remote branch after the CURRENT LOCAL BRANCH, which this hook has never
    read -- CONFIRMED exit 0 before this fix, and confirmed live against a
    local bare origin that a checkout of `main` running either command really
    does move the remote's `main`."""
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
     '        if gh_api == "gh-api":\n', "        if False:\n", "r4_api_literal"),
    ("non-literal PR number on the API path no longer refused",
     "        if not pr_token.isdigit():\n", "        if False:\n", "r4_api_nonliteral"),
    ("push HEAD/@-with-no-destination check removed",
     '            if src in ("HEAD", "@"):\n', "            if False:\n", "r4_push_head"),
    ("push wildcard-refspec check removed",
     '        if "*" in src or (dst is not None and "*" in dst):\n', "        if False:\n", "r4_push_wildcard"),
    ("same-command variable resolution removed from push destinations",
     "        resolved = _resolve_simple_var(target, env)\n", "        resolved = target\n", "r4_push_var_develop"),
    ("command-substitution assignment fragment trusted as a literal (self-adversarial fix)",
     "        if nxt is not None and nxt not in _STATEMENT_SEP_TOKENS and _is_punctuation(nxt):\n",
     "        if False:\n", "r4_push_var_cmdsub"),
    # gate-r4 residual closed (2026-09-19): a respelled `gh api`. Each scenario is
    # one no OTHER check in the hook also refuses, so removing the reading under
    # test is what changes the exit (the symlink reading needs a symlink and has
    # its own test: test_r4_the_identity_fallback_is_load_bearing_...).
    ("respelled-gh-api regex reading removed (IFS / brace / quoted gh)",
     "    if _GH_API_RESPELLED_RE.search(stripped):\n", "    if False:\n", "r4_gh_ifs"),
    ("word-by-word gh api reading removed", "        api_words, api_subs, _tail = _lex(command, 0, None, 0)\n",
     "        api_words, api_subs = [], []\n", "r4_gh_expanded"),
    ("an expanded gh is exempted like a recognised one", '        if gh_api == "gh-api":\n',
     "        if gh_api:\n", "r4_gh_expanded_literal"),
    ("a quoted string another shell runs is not read",
     "                    if (_depth < _MAX_API_READ_DEPTH and raw[:1] in (\"'\", '\"')\n",
     "                    if (False and raw[:1] in (\"'\", '\"')\n", "r4_gh_bash_c"),
    ("an unreadable command read as not-gh-api", '        return "maybe"\n', "        return None\n", "r4_gh_unreadable"),
    ("merge-surface gate before the reading removed",
     "    if not (m or base_merges or graphql_merge):\n", "    if False:\n", "r4_gh_ordinary"),
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
