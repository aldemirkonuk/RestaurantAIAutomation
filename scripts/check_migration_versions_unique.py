#!/usr/bin/env python3
"""
Guard: a migration version introduced by this branch is not already taken.

WHY THIS EXISTS
---------------
On 2026-09-05 two open PRs each added a migration named
`supabase/migrations/20260905120000_*.sql`:

  * #309 `feat/canonical-document-slice-3-corrections` ->
    20260905120000_document_correction_reason_and_kind.sql
  * #310 `fix/simpos-real-pos` -> 20260905120000_simpos_behaves_like_a_pos.sql

Both were green. Neither branch could see the other, because every check in
this repository runs against one branch at a time, and each branch's migration
set is internally consistent. Supabase's migration history keys on the VERSION
(the leading timestamp), not on the filename or the file's contents, so on
auto-apply the second merge either fails or -- worse -- is recorded as already
applied and silently skipped, leaving main's schema missing a migration that
the repository says is applied. That is the `absence reported as health` shape:
the migration table says "done" about SQL that never ran.

This is the same shape as the ADR-number race that
`scripts/check_adr_numbers_unique.py` (ADR 0085) exists to catch, and it has
the same non-fix: a convention. "Use the current timestamp" already IS the
convention, and it collides precisely because two sessions working the same
afternoon round to the same minute. A guard does not have to remember.

WHAT COUNTS AS A COLLISION
--------------------------
Same version, DIFFERENT filename, on this branch and somewhere else.

The same migration in flight on several refs is not a collision -- a branch, a
stacked child of it, and a rebase all legitimately carry the identical
`20260905120000_foo.sql`, and failing on that would fire on ordinary work. It
is the filename disagreeing that means two different migrations wear one
version, which is exactly what Supabase cannot represent.

WHERE "ELSEWHERE" IS
--------------------
  * `origin/main` -- the versions already applied or about to be.
  * every OTHER open pull request -- the versions in flight.

The open-PR half is the whole point: no single-branch guard can see it. It is
enumerated with `gh pr list` + the pull-request FILES api (not `gh pr diff`,
which 406s above 300 changed files -- see `pr_migrations`), which sees fork PRs
that have no ref on origin. If `gh` cannot answer, the guard exits 2.

NEVER VACUOUS
-------------
An unauthenticated `gh`, a rate-limited API, or a shallow checkout would each
let a weaker guard enumerate nothing, find no collision, and certify a live
one as clean. So: **exit 2 -- not 0 -- whenever the guard cannot see what it
claims to check.** Not a git repo, no `origin/main`, no `gh`, `gh` not logged
in, any `gh` call failing, or zero migration files found anywhere.

EXIT CODES
----------
  0  the versions this branch introduces are unclaimed
  1  collision -- two migrations wearing one version
  2  CANNOT CHECK -- fix the environment; this is not a skip
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict

MIGRATIONS_DIR = "supabase/migrations"
MAIN_REF = "origin/main"
# `supabase/migrations/<version>_<name>.sql`, top level only. `seed/` and any
# other subdirectory are not versioned migrations and must not be parsed as one.
MIGRATION_RE = re.compile(r"^supabase/migrations/(\d{14})_([^/]+)\.sql$")


class CannotCheck(Exception):
    """The guard cannot see what it claims to check. Always exit 2."""


def git(*args: str) -> str:
    try:
        out = subprocess.run(
            ["git", *args], capture_output=True, text=True, check=False
        )
    except FileNotFoundError as exc:  # pragma: no cover - no git binary
        raise CannotCheck("git is not on PATH") from exc
    if out.returncode != 0:
        raise CannotCheck(f"`git {' '.join(args)}` failed: {out.stderr.strip()}")
    return out.stdout


def gh(*args: str) -> str:
    if shutil.which("gh") is None:
        raise CannotCheck(
            "the GitHub CLI (`gh`) is not on PATH. The versions in flight live "
            "in other people's open PRs, and nothing local can enumerate them, "
            "so without `gh` any verdict here is a guess. In CI: set GH_TOKEN. "
            "Locally: install `gh` and run `gh auth login`."
        )
    out = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise CannotCheck(
            f"`gh {' '.join(args)}` failed: {(out.stderr or out.stdout).strip()[:400]}"
        )
    return out.stdout


def parse(paths) -> dict[str, str]:
    """version -> filename, for a list of repository paths."""
    found: dict[str, str] = {}
    for line in paths:
        m = MIGRATION_RE.match(line.strip())
        if m:
            found[m.group(1)] = f"{m.group(1)}_{m.group(2)}.sql"
    return found


def migrations_at(ref: str) -> dict[str, str]:
    return parse(git("ls-tree", "-r", "--name-only", ref, MIGRATIONS_DIR).splitlines())


def migrations_here() -> dict[str, str]:
    """What THIS checkout has, tracked -- staged or committed, either counts."""
    return parse(git("ls-files", MIGRATIONS_DIR).splitlines())


def open_prs() -> list[dict]:
    raw = gh(
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number,headRefName,title",
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CannotCheck(
            f"`gh pr list` did not return JSON: {raw.strip()[:200]}"
        ) from exc


def this_branch() -> str:
    return git("rev-parse", "--abbrev-ref", "HEAD").strip()


def pr_migrations(number: int, head_ref: str) -> dict[str, str]:
    """The migration files a PR touches.

    `gh pr diff --name-only` is the obvious call and it is NOT usable here: it
    is served by the diff endpoint, which returns HTTP 406 above 300 changed
    files. PR #289 (`feat/mudavym-design-p4`) is over that, so a guard built on
    it would exit 2 on every run for as long as one large PR stays open -- and
    a guard that is always red gets disabled. The files API paginates instead.

    Above its own 3000-file ceiling the listing is truncated, and a truncated
    listing could omit the colliding migration, so that case falls back to the
    PR head's tree if it is fetched and otherwise refuses to answer.
    """
    raw = gh(
        "api",
        "--paginate",
        f"repos/{{owner}}/{{repo}}/pulls/{number}/files",
        "--jq",
        ".[].filename",
    )
    names = [line for line in raw.splitlines() if line.strip()]
    if len(names) >= 3000:
        ref = f"origin/{head_ref}"
        try:
            return migrations_at(ref)
        except CannotCheck as exc:
            raise CannotCheck(
                f"PR #{number} changes {len(names)}+ files, past the files API's "
                f"3000 ceiling, and {ref} is not fetched locally either, so its "
                "migrations cannot be enumerated in full. Fetch every branch "
                "(`git fetch origin '+refs/heads/*:refs/remotes/origin/*'`)."
            ) from exc
    return parse(names)


def elsewhere() -> tuple[dict[str, set[str]], dict[tuple[str, str], list[str]], int]:
    """version -> {filenames}, and (version, filename) -> [where], plus PR count."""
    by_version: dict[str, set[str]] = defaultdict(set)
    where: dict[tuple[str, str], list[str]] = defaultdict(list)

    for version, name in migrations_at(MAIN_REF).items():
        by_version[version].add(name)
        where[(version, name)].append(MAIN_REF)

    mine_branch = this_branch()
    prs = open_prs()
    counted = 0
    for pr in prs:
        # Skip this branch's own PR: its files are what we are checking, not
        # what they are checked against.
        if pr.get("headRefName") == mine_branch:
            continue
        counted += 1
        label = f"PR #{pr['number']} ({pr.get('headRefName', '?')})"
        for version, name in pr_migrations(
            int(pr["number"]), pr.get("headRefName", "")
        ).items():
            by_version[version].add(name)
            where[(version, name)].append(label)

    if not by_version:
        raise CannotCheck(
            f"no migration files matched {MIGRATION_RE.pattern!r} on {MAIN_REF} "
            f"or in any of the {len(prs)} open PR(s). Either the migrations "
            "directory moved or the filename convention changed -- repoint this "
            "guard rather than trusting a clean verdict from an empty sweep."
        )
    return by_version, where, counted


def report(version, mine, theirs, where) -> None:
    print(f"COLLISION: migration version {version} names more than one migration.\n")
    print(f"  this branch: {MIGRATIONS_DIR}/{mine}")
    for name in sorted(theirs):
        print(f"  elsewhere:   {MIGRATIONS_DIR}/{name}")
        print(f"               on {', '.join(where[(version, name)])}")
    print(
        "\n  Supabase keys migration history on the version, so whichever of "
        "these merges second is failed or silently skipped on auto-apply -- and "
        "a skip leaves main's schema missing SQL the history says was applied."
    )
    print(
        "  Fix it on THIS branch: rename the file to an unused timestamp "
        "(`date -u +%Y%m%d%H%M%S`), and update anything that cites it."
    )


def run_default() -> int:
    if migrations_at(MAIN_REF) is None:  # pragma: no cover - defensive
        raise CannotCheck(f"{MAIN_REF} is unreadable")
    on_main = migrations_at(MAIN_REF)
    mine = migrations_here()
    introduced = {v: n for v, n in mine.items() if on_main.get(v) != n}

    by_version, where, pr_count = elsewhere()

    if not introduced:
        print("No migration versions introduced by this branch. Nothing to check.")
        print(f"Checked against {MAIN_REF} + {pr_count} other open PR(s).")
        return 0

    failed = False
    for version, name in sorted(introduced.items()):
        others = {n for n in by_version.get(version, set()) if n != name}
        if others:
            report(version, name, others, where)
            failed = True
    if failed:
        return 1

    listed = ", ".join(sorted(introduced.values()))
    print(f"OK -- introduced by this branch: {listed}")
    print(
        f"Checked against {MAIN_REF} + {pr_count} other open PR(s). "
        "No version wears two filenames."
    )
    return 0


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def _fixture(collide: bool) -> str | None:
    """Build a repo where another 'PR' does or does not take our version.

    Nothing is read from the enclosing checkout: a self-test that can see the
    real repository can be made to pass by the real repository. `gh` is stubbed
    with a script on PATH so the fixture runs with no network and no token, and
    so the collision it proves is the REAL one from 2026-09-05 -- same version,
    same two filenames.
    """
    ours = "20260905120000_document_correction_reason_and_kind.sql"
    theirs = "20260905120000_simpos_behaves_like_a_pos.sql"
    base = "20260904121000_mudavym_design_document_flag.sql"

    def run(*args, cwd=None, env=None):
        return subprocess.run(
            list(args), cwd=cwd, env=env, capture_output=True, text=True
        )

    with tempfile.TemporaryDirectory() as td:
        repo = os.path.join(td, "repo")
        bare = os.path.join(td, "origin.git")
        binn = os.path.join(td, "bin")
        os.makedirs(os.path.join(repo, MIGRATIONS_DIR))
        os.makedirs(binn)

        # A `gh` that answers exactly the two calls the guard makes.
        other = theirs if collide else "20260905174500_simpos_behaves_like_a_pos.sql"
        stub = (
            "#!/bin/sh\n"
            'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then\n'
            '  echo \'[{"number":310,"headRefName":"fix/simpos-real-pos",'
            '"title":"simpos"}]\'\n'
            "  exit 0\n"
            "fi\n"
            'if [ "$1" = "api" ]; then\n'
            f'  echo "{MIGRATIONS_DIR}/{other}"\n'
            "  exit 0\n"
            "fi\n"
            "exit 3\n"
        )
        stub_path = os.path.join(binn, "gh")
        with open(stub_path, "w", encoding="utf-8") as fh:
            fh.write(stub)
        os.chmod(stub_path, 0o755)

        def write(name):
            with open(
                os.path.join(repo, MIGRATIONS_DIR, name), "w", encoding="utf-8"
            ) as fh:
                fh.write("-- synthetic fixture migration\n")

        write(base)
        steps = [
            (["git", "init", "--quiet", "-b", "main", repo], None),
            (["git", "config", "user.email", "guard@invalid"], repo),
            (["git", "config", "user.name", "guard"], repo),
            (["git", "add", "-A"], repo),
            (["git", "commit", "--quiet", "-m", "base"], repo),
            (["git", "init", "--bare", "--quiet", bare], None),
            (["git", "remote", "add", "origin", bare], repo),
            (["git", "push", "--quiet", "origin", "main"], repo),
            (["git", "checkout", "--quiet", "-b", "feat/ours"], repo),
        ]
        for args, cwd in steps:
            r = run(*args, cwd=cwd)
            if r.returncode != 0:
                return f"fixture step `{' '.join(args)}` failed: {(r.stderr or r.stdout).strip()}"
        write(ours)
        for args in (["git", "add", "-A"], ["git", "commit", "--quiet", "-m", "ours"]):
            r = run(*args, cwd=repo)
            if r.returncode != 0:
                return f"fixture step `{' '.join(args)}` failed: {(r.stderr or r.stdout).strip()}"

        env = dict(os.environ, PATH=binn + os.pathsep + os.environ["PATH"])
        proc = subprocess.run(
            [sys.executable, os.path.abspath(__file__)],
            cwd=repo,
            env=env,
            capture_output=True,
            text=True,
        )
        want = 1 if collide else 0
        if proc.returncode != want:
            return (
                f"{'collision' if collide else 'no-collision'} fixture exited "
                f"{proc.returncode}, want {want}. Output: "
                f"{(proc.stdout + proc.stderr).strip()[:400]}"
            )
        if collide and "20260905120000" not in proc.stdout:
            return "the collision fired but did not name the colliding version"
        if collide and theirs not in proc.stdout:
            return "the collision fired but did not name the other PR's file"
    return None


def _no_gh_must_exit_2() -> str | None:
    """Absence of `gh` must be a failure, never a clean sweep.

    This is the condition that turns the guard vacuous: no token in CI, or a
    developer without `gh`, would enumerate zero open PRs -- and zero open PRs
    is indistinguishable from "no collision" unless the guard refuses to answer.
    """

    def run(*args, cwd=None):
        return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)

    with tempfile.TemporaryDirectory() as td:
        repo = os.path.join(td, "repo")
        bare = os.path.join(td, "origin.git")
        empty = os.path.join(td, "emptybin")
        os.makedirs(os.path.join(repo, MIGRATIONS_DIR))
        os.makedirs(empty)
        with open(
            os.path.join(repo, MIGRATIONS_DIR, "20260101000000_x.sql"), "w"
        ) as fh:
            fh.write("-- x\n")
        steps = [
            (["git", "init", "--quiet", "-b", "main", repo], None),
            (["git", "config", "user.email", "guard@invalid"], repo),
            (["git", "config", "user.name", "guard"], repo),
            (["git", "add", "-A"], repo),
            (["git", "commit", "--quiet", "-m", "base"], repo),
            (["git", "init", "--bare", "--quiet", bare], None),
            (["git", "remote", "add", "origin", bare], repo),
            (["git", "push", "--quiet", "origin", "main"], repo),
            (["git", "checkout", "--quiet", "-b", "feat/ours"], repo),
        ]
        for args, cwd in steps:
            r = run(*args, cwd=cwd)
            if r.returncode != 0:
                return f"fixture step `{' '.join(args)}` failed: {(r.stderr or r.stdout).strip()}"
        with open(
            os.path.join(repo, MIGRATIONS_DIR, "20260905120000_ours.sql"), "w"
        ) as fh:
            fh.write("-- ours\n")
        for args in (["git", "add", "-A"], ["git", "commit", "--quiet", "-m", "ours"]):
            run(*args, cwd=repo)

        # `git` still present, `gh` deliberately absent -- so the guard reaches
        # the open-PR enumeration and fails THERE, not earlier on a missing git.
        git_bin = shutil.which("git")
        if git_bin is None:
            return "git is not on PATH, so this fixture cannot be built"
        os.symlink(git_bin, os.path.join(empty, "git"))
        env = dict(os.environ, PATH=empty)
        proc = subprocess.run(
            [sys.executable, os.path.abspath(__file__)],
            cwd=repo,
            env=env,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 2:
            return (
                f"with no `gh` on PATH the guard exited {proc.returncode}, want 2. "
                "It would then certify an unenumerated set of open PRs as clean."
            )
        if "gh" not in (proc.stdout + proc.stderr):
            return "exited 2, but not for the missing-`gh` reason this test covers"
    return None


def run_self_test() -> int:
    failures = []

    if not MIGRATION_RE.match(f"{MIGRATIONS_DIR}/20260905120000_a_b.sql"):
        failures.append("a real migration filename did not parse")
    if MIGRATION_RE.match(f"{MIGRATIONS_DIR}/seed/09_wine_regions_seed.sql"):
        failures.append("a seed file under migrations/seed/ was parsed as a migration")
    if MIGRATION_RE.match(f"{MIGRATIONS_DIR}/README.md"):
        failures.append("README.md was parsed as a migration")

    for label, fn in (
        ("collision fixture", lambda: _fixture(collide=True)),
        ("no-collision fixture", lambda: _fixture(collide=False)),
        ("cannot-check fixture", _no_gh_must_exit_2),
    ):
        err = fn()
        if err:
            failures.append(f"{label}: {err}")

    if failures:
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    print(
        "SELF-TEST OK -- the real 2026-09-05 collision fires (exit 1, both files "
        "named), the renamed version does not (exit 0), a missing `gh` exits 2 "
        "rather than passing, and seed/ files are not parsed as migrations."
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the guard fires on the shape it exists to catch",
    )
    args = ap.parse_args()

    if args.self_test:
        return run_self_test()

    try:
        return run_default()
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        print(
            "This is a FAILURE, not a skip. A guard that certifies itself on no "
            "evidence is worse than no guard.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
