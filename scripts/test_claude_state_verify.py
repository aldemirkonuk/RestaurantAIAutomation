#!/usr/bin/env python3
"""`claude_state_migrate.sh verify` asks whether a session's cwd is inside the repo.

WHY THIS EXISTS
---------------
Measured 2026-09-16 on the founder's Mac: `verify --repo <repo>` exited 1 and called six
sessions stale, because `_claude_state.py` compared each recorded cwd to the repo root by
exact string. All six were inside the repo (apps/web, apps/api-gateway, .planning, a
worktree), the message said their paths did not exist when every one did, and it named
only five.

A transcript keeps the cwd a session ENDED in, so a session opened at the root and left in
apps/web records apps/web. The rule is "inside this repo", on path boundaries. Each case
builds a throwaway store and runs the real entry point with CLAUDE_CONFIG_DIR pointed at
it, so the real ~/.claude is never read:

  root, subdir and worktree cwds                     exit 0
  a different absolute path: a sibling clone that    exit 1, named, "path exists"
    shares the repo's name as a prefix
  a missing path: another machine's clone            exit 1, named, "path does not exist"
  a removed worktree inside the repo                 exit 0, named in a warning
  six sessions outside the repo                      exit 1, all six named

Run directly (exit 0 pass, 1 fail, 2 cannot check) or under pytest. CI runs it through
CLAIMS.jsonl row ADR-0148-VERIFY-CWD-INSIDE-REPO.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "claude_state_migrate.sh"
OUTSIDE = "record a cwd outside this repo:"
GONE = "record a cwd inside this repo that no longer exists:"


class Fixture:
    def __init__(self, base: Path):
        self.base = base
        self.repo = base / "restaurant-ai-automation"
        for sub in ("apps/web", ".claude/worktrees/wt-live"):
            (self.repo / sub).mkdir(parents=True)
        self.home = base / "claude-home"
        # Mirrors key_for_path() in the shell script.
        self.store = self.home / "projects" / re.sub(r"[^A-Za-z0-9-]", "-", str(self.repo))
        self.store.mkdir(parents=True)

    def session(self, sid: str, *cwds: Path) -> None:
        """One transcript whose records move through `cwds` in order, as a real one does."""
        lines = []
        for i, cwd in enumerate(cwds):
            kind = "user" if i % 2 == 0 else "assistant"
            lines.append(json.dumps({
                "type": kind,
                "cwd": str(cwd),
                "gitBranch": "main",
                "version": "fixture",
                "timestamp": f"2026-09-16T00:00:{i:02d}Z",
                "message": {"role": kind, "content": f"step {i}"},
            }))
        (self.store / f"{sid}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def verify(self) -> tuple[int, str]:
        proc = subprocess.run(
            ["bash", str(SCRIPT), "verify", "--repo", str(self.repo)],
            env={**os.environ, "CLAUDE_CONFIG_DIR": str(self.home)},
            capture_output=True,
            text=True,
            timeout=60,
        )
        return proc.returncode, proc.stdout + proc.stderr


@contextmanager
def fixture():
    with tempfile.TemporaryDirectory() as tmp:
        # resolve(): macOS hands out /var/folders/..., which `pwd -P` reports as /private/var/...
        yield Fixture(Path(tmp).resolve())


def listed(out: str, header: str) -> dict[str, str]:
    """`id -> rest of line` for the sessions printed under `header`."""
    lines = out.splitlines()
    for i, line in enumerate(lines):
        if header in line:
            entries = {}
            for item in lines[i + 1:]:
                m = re.match(r"^ {6}(\S+)  cwd=(.*)$", item)
                if not m:
                    break
                entries[m.group(1)] = m.group(2)
            return entries
    return {}


def expect(ok: bool, why: str, out: str) -> None:
    if not ok:
        raise AssertionError(f"{why}\n--- verify output ---\n{out}")


def test_root_subdir_and_worktree_cwds_pass():
    with fixture() as fx:
        fx.session("s-root", fx.repo)
        fx.session("s-subdir", fx.repo, fx.repo / "apps/web")
        fx.session("s-worktree", fx.repo, fx.repo / ".claude/worktrees/wt-live")
        rc, out = fx.verify()
        expect(rc == 0, f"exit {rc}, want 0", out)
        expect(f"every recorded cwd is inside {fx.repo}" in out, "no all-inside line", out)
        expect(not listed(out, GONE), "warned about a directory that exists", out)


def test_a_different_absolute_path_fails_and_is_named():
    # restaurant-ai-automation-other starts with the repo's path as a string, so a bare
    # startswith would pass it; `..` is the other way a string prefix lies about a path.
    with fixture() as fx:
        sibling = fx.base / "restaurant-ai-automation-other"
        (sibling / "apps/web").mkdir(parents=True)
        fx.session("s-inside", fx.repo, fx.repo / "apps/web")
        fx.session("s-sibling", sibling, sibling / "apps/web")
        fx.session("s-dotdot", fx.repo, fx.repo / ".." / "restaurant-ai-automation-other")
        rc, out = fx.verify()
        flagged = listed(out, OUTSIDE)
        expect(rc == 1, f"exit {rc}, want 1", out)
        expect(set(flagged) == {"s-sibling", "s-dotdot"}, f"flagged {sorted(flagged)}", out)
        expect(all(v.endswith("(path exists)") for v in flagged.values()), "wrong existence tag", out)


def test_a_missing_path_fails_and_says_so():
    # The cross-machine shape: transcripts still name the old clone, absent on this machine.
    with fixture() as fx:
        old = fx.base / "home" / "olduser" / "RestaurantAIAutomation"  # never created
        fx.session("s-old-root", old)
        fx.session("s-old-subdir", old, old / "apps/api-gateway")
        rc, out = fx.verify()
        flagged = listed(out, OUTSIDE)
        expect(rc == 1, f"exit {rc}, want 1", out)
        expect(set(flagged) == {"s-old-root", "s-old-subdir"}, f"flagged {sorted(flagged)}", out)
        expect(all(v.endswith("(path does not exist)") for v in flagged.values()), "wrong existence tag", out)


def test_a_removed_worktree_inside_the_repo_warns_but_passes():
    # Founder's call, 2026-09-16: the path points into this clone; only the directory is gone.
    with fixture() as fx:
        gone = fx.repo / ".claude/worktrees/wt-removed"  # never created
        fx.session("s-live", fx.repo)
        fx.session("s-gone", fx.repo, gone)
        rc, out = fx.verify()
        expect(rc == 0, f"exit {rc}, want 0", out)
        expect(listed(out, GONE) == {"s-gone": str(gone)}, "removed worktree not named in the warning", out)
        expect(not listed(out, OUTSIDE), "flagged a path inside the repo", out)


def test_every_flagged_session_is_listed():
    # The first version printed stale[:5]; the store it was measured on had six.
    with fixture() as fx:
        ids = {f"s-stale-{n}" for n in range(6)}
        for sid in ids:
            fx.session(sid, fx.base / "elsewhere")
        rc, out = fx.verify()
        expect(rc == 1, f"exit {rc}, want 1", out)
        expect(set(listed(out, OUTSIDE)) == ids, f"listed {sorted(listed(out, OUTSIDE))}", out)


def main() -> int:
    if not SCRIPT.is_file():
        print(f"{SCRIPT}: No such file or directory", file=sys.stderr)
        return 2
    tests = [fn for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS  {fn.__name__}")
        except AssertionError as err:
            failed += 1
            print(f"FAIL  {fn.__name__}: {err}")
    print(f"\n{len(tests) - failed} of {len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
