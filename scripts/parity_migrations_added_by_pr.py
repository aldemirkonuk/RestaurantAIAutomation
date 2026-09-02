#!/usr/bin/env python3
"""List the migration files a pull request ADDS, so parity can hold them back.

WHY THIS EXISTS
---------------
`Fresh database equals remote` builds a database from `supabase/migrations/`
and diffs it against production. That answers one question very well — *has
someone changed production by hand?* — and it was made a required status check
on `main`.

On a pull request it also answers a question nobody asked. Migrations
auto-apply on MERGE, so a PR that adds one is comparing a local database that
HAS the new objects against a production that correctly does not. The new
table lands under `IN LOCAL, NOT IN REMOTE — unpushed migration`, the job exits
1, and because it is a required context the PR cannot merge — ever, by any
route that does not either bypass the check or hand-apply the migration to
production first. Hand-applying is worse than the disease: the Supabase git
integration stamps the version from the repo filename while a manual apply
stamps its own wall clock, so the two disagree afterwards and the migration
looks ownerless. That cost two sessions an hour on 2026-09-02.

Measured, on 2026-09-02: three of six open PRs (#243, #244, #256) added
migrations and were structurally unmergeable for this reason, while #242 had
been merged earlier the same day with this very check red.

THE FIX, AND WHAT IT DELIBERATELY DOES NOT RELAX
------------------------------------------------
For the COMPARISON, build the database from the migrations as they stand on the
PR's merge base — that is, hold back the files this PR ADDS. The comparison then
asks its real question, *has production drifted from what has been merged*, and
is insensitive to what the PR proposes. The PR's own migrations are still
applied, in a second reset, so "your migration applies cleanly" stays proven.

Three things stay exactly as strict as before:

  * A MODIFIED migration is NOT held back. Editing a migration that has already
    been applied is a real defect and must still show as drift. Only files with
    git status `A` are held back.
  * On `push` and `schedule` there is no base ref, nothing is held back, and the
    behaviour is byte-for-byte today's. Strictness on `main` is untouched.
  * Failure to work out the base is NOT "hold back nothing quietly" and NOT
    "hold back everything". It is exit 2 — cannot check — because a wrong answer
    here silently changes what a required check measures.

EXITS
  0  the list printed (possibly empty)
  2  CANNOT CHECK — no git, not a repo, base ref unresolvable, or the
     migrations directory is missing or empty
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MIGRATIONS = "supabase/migrations"
# This repo has had 88+ migrations since 2026-08. A tree showing fewer than
# this is not this repo, and a "nothing was added" answer computed over it
# would be an absence reported as health.
MIN_MIGRATIONS = 40


class CannotCheck(Exception):
    pass


def git(*args: str, cwd: Path | None = None) -> str:
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:  # pragma: no cover - depends on the host
        raise CannotCheck(f"git is not on PATH: {exc}") from exc
    if out.returncode != 0:
        raise CannotCheck(
            f"`git {' '.join(args)}` exited {out.returncode}: "
            f"{out.stderr.strip() or '(no stderr)'}"
        )
    return out.stdout


def added_migrations(base: str, head: str = "HEAD", cwd: Path | None = None) -> list[str]:
    """Paths under supabase/migrations/ that `head` adds relative to `base`.

    Uses the three-dot form so the answer is "what this branch added since it
    diverged", not "how this branch differs from the tip of main" — the latter
    would also list every migration main gained meanwhile, and holding THOSE
    back would hide real drift.
    """
    root = Path(git("rev-parse", "--show-toplevel", cwd=cwd).strip())

    migrations_dir = root / MIGRATIONS
    if not migrations_dir.is_dir():
        raise CannotCheck(f"{MIGRATIONS}/ does not exist under {root}")
    count = len(list(migrations_dir.glob("*.sql")))
    if count < MIN_MIGRATIONS:
        raise CannotCheck(
            f"{MIGRATIONS}/ holds {count} .sql files; expected at least "
            f"{MIN_MIGRATIONS}. This is not the tree this check is for."
        )

    # Resolve both ends explicitly so an unfetched base is a stated failure
    # rather than an empty diff that reads as "this PR added nothing".
    for ref in (base, head):
        try:
            git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", cwd=cwd)
        except CannotCheck as exc:
            raise CannotCheck(
                f"cannot resolve `{ref}` to a commit. Fetch it "
                f"(actions/checkout with fetch-depth: 0) — an unresolvable base "
                f"cannot be distinguished from a PR that added nothing."
            ) from exc

    out = git(
        "diff", "--name-only", "--diff-filter=A",
        f"{base}...{head}", "--", MIGRATIONS,
        cwd=cwd,
    )
    return sorted(p for p in out.splitlines() if p.strip())


# ---------------------------------------------------------------------------
# --self-test: a real git repository, not a mocked one.
# ---------------------------------------------------------------------------
def _run(cwd: Path, *args: str) -> None:
    subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)


def _seed_repo(root: Path, n_migrations: int = MIN_MIGRATIONS + 2) -> None:
    (root / MIGRATIONS).mkdir(parents=True)
    _run(root, "git", "init", "-q", "-b", "main")
    _run(root, "git", "config", "user.email", "selftest@example.invalid")
    _run(root, "git", "config", "user.name", "selftest")
    for i in range(n_migrations):
        (root / MIGRATIONS / f"2026010100{i:04d}_base.sql").write_text(
            f"-- base migration {i}\n", encoding="utf-8"
        )
    _run(root, "git", "add", "-A")
    _run(root, "git", "commit", "-qm", "base")


def self_test() -> int:
    failures: list[str] = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        if cond:
            print(f"   ok    {name}")
        else:
            failures.append(name)
            print(f"   FAIL  {name}{(' — ' + detail) if detail else ''}")

    tmp = Path(tempfile.mkdtemp(prefix="parity-added-selftest-"))
    try:
        # 1. A branch that adds one migration lists exactly that one.
        r1 = tmp / "adds-one"
        r1.mkdir()
        _seed_repo(r1)
        _run(r1, "git", "checkout", "-qb", "feature")
        (r1 / MIGRATIONS / "20260902190000_new_thing.sql").write_text(
            "create table t();\n", encoding="utf-8"
        )
        _run(r1, "git", "add", "-A")
        _run(r1, "git", "commit", "-qm", "add a migration")
        got = added_migrations("main", "HEAD", cwd=r1)
        check(
            "a branch that adds one migration lists exactly it",
            got == [f"{MIGRATIONS}/20260902190000_new_thing.sql"],
            f"got {got}",
        )

        # 2. A MODIFIED migration is NOT listed. This is the property that keeps
        #    "someone edited an already-applied migration" visible as drift, and
        #    it is the single most important line in this file.
        r2 = tmp / "modifies"
        r2.mkdir()
        _seed_repo(r2)
        _run(r2, "git", "checkout", "-qb", "feature")
        victim = next((r2 / MIGRATIONS).glob("*.sql"))
        victim.write_text("-- EDITED AFTER APPLYING\n", encoding="utf-8")
        _run(r2, "git", "add", "-A")
        _run(r2, "git", "commit", "-qm", "edit an applied migration")
        got = added_migrations("main", "HEAD", cwd=r2)
        check("a MODIFIED migration is not held back", got == [], f"got {got}")

        # 3. A branch that adds nothing lists nothing — the `push`-to-main shape,
        #    where holding nothing back must reproduce today's strictness.
        r3 = tmp / "adds-none"
        r3.mkdir()
        _seed_repo(r3)
        _run(r3, "git", "checkout", "-qb", "feature")
        (r3 / "README.md").write_text("docs only\n", encoding="utf-8")
        _run(r3, "git", "add", "-A")
        _run(r3, "git", "commit", "-qm", "docs")
        got = added_migrations("main", "HEAD", cwd=r3)
        check("a docs-only branch holds nothing back", got == [], f"got {got}")

        # 4. A migration main gained AFTER the branch point is NOT held back.
        #    Two-dot would list it and hide real drift; three-dot must not.
        r4 = tmp / "main-moved"
        r4.mkdir()
        _seed_repo(r4)
        _run(r4, "git", "checkout", "-qb", "feature")
        (r4 / MIGRATIONS / "20260902190000_mine.sql").write_text("x\n", encoding="utf-8")
        _run(r4, "git", "add", "-A")
        _run(r4, "git", "commit", "-qm", "mine")
        _run(r4, "git", "checkout", "-q", "main")
        (r4 / MIGRATIONS / "20260902200000_theirs.sql").write_text("y\n", encoding="utf-8")
        _run(r4, "git", "add", "-A")
        _run(r4, "git", "commit", "-qm", "theirs")
        _run(r4, "git", "checkout", "-q", "feature")
        got = added_migrations("main", "HEAD", cwd=r4)
        check(
            "a migration main gained after the branch point is NOT held back",
            got == [f"{MIGRATIONS}/20260902190000_mine.sql"],
            f"got {got}",
        )

        # 4b. THE CASE THAT ACTUALLY SEPARATES THREE-DOT FROM TWO-DOT.
        #
        # Case 4 above does NOT: with `--diff-filter=A`, a migration main gained
        # after the branch point shows as a DELETION from the two-dot diff's
        # point of view, so both forms already agree there. Measured — swapping
        # `...` for `..` left all eight other cases green, which is exactly the
        # shape this file exists to refuse: an assertion that cannot come out
        # differently.
        #
        # This is the case where they differ. Main DELETES a migration; the
        # branch does not touch it. Two-dot compares against main's TIP, where
        # the file is absent, so it reports the file as ADDED by this branch and
        # holds it back — hiding it from a comparison it belongs in. Three-dot
        # compares against the merge base, where the file is present, and
        # correctly reports that this branch added nothing.
        r4b = tmp / "main-deleted"
        r4b.mkdir()
        _seed_repo(r4b)
        kept = sorted((r4b / MIGRATIONS).glob("*.sql"))[0]
        _run(r4b, "git", "checkout", "-qb", "feature")
        (r4b / "unrelated.txt").write_text("branch does something else\n", encoding="utf-8")
        _run(r4b, "git", "add", "-A")
        _run(r4b, "git", "commit", "-qm", "unrelated work")
        _run(r4b, "git", "checkout", "-q", "main")
        _run(r4b, "git", "rm", "-q", str(kept.relative_to(r4b)))
        _run(r4b, "git", "commit", "-qm", "main deletes a migration")
        _run(r4b, "git", "checkout", "-q", "feature")
        got = added_migrations("main", "HEAD", cwd=r4b)
        two_dot = git(
            "diff", "--name-only", "--diff-filter=A",
            "main..HEAD", "--", MIGRATIONS, cwd=r4b,
        ).split()
        check(
            "a migration main DELETED is not reported as added by this branch",
            got == [],
            f"got {got}",
        )
        check(
            "and that case is discriminating (two-dot would wrongly list it)",
            two_dot == [f"{MIGRATIONS}/{kept.name}"],
            f"two-dot gave {two_dot}; if this is empty the case above proves nothing",
        )

        # 5. CANNOT CHECK, three ways. Each must raise, never return [].
        r5 = tmp / "cannot"
        r5.mkdir()
        _seed_repo(r5)

        raised = False
        try:
            added_migrations("no-such-base", "HEAD", cwd=r5)
        except CannotCheck:
            raised = True
        check("an unresolvable base raises rather than returning []", raised)

        r6 = tmp / "too-few"
        (r6 / MIGRATIONS).mkdir(parents=True)
        _run(r6, "git", "init", "-q", "-b", "main")
        _run(r6, "git", "config", "user.email", "s@e.invalid")
        _run(r6, "git", "config", "user.name", "s")
        (r6 / MIGRATIONS / "0001_only.sql").write_text("x\n", encoding="utf-8")
        _run(r6, "git", "add", "-A")
        _run(r6, "git", "commit", "-qm", "tiny")
        raised = False
        try:
            added_migrations("main", "HEAD", cwd=r6)
        except CannotCheck:
            raised = True
        check("a tree with too few migrations raises", raised)

        r7 = tmp / "no-dir"
        r7.mkdir()
        _run(r7, "git", "init", "-q", "-b", "main")
        _run(r7, "git", "config", "user.email", "s@e.invalid")
        _run(r7, "git", "config", "user.name", "s")
        (r7 / "f").write_text("x\n", encoding="utf-8")
        _run(r7, "git", "add", "-A")
        _run(r7, "git", "commit", "-qm", "no migrations dir")
        raised = False
        try:
            added_migrations("main", "HEAD", cwd=r7)
        except CannotCheck:
            raised = True
        check("a tree with no migrations directory raises", raised)

        # 6. NON-VACUITY OF THIS SELF-TEST ITSELF. Case 2 is the load-bearing
        #    one, so prove the suite would notice if the filter stopped
        #    distinguishing added from modified — otherwise `--diff-filter=AM`
        #    would slip through green.
        got_am = git(
            "diff", "--name-only", "--diff-filter=AM",
            "main...HEAD", "--", MIGRATIONS, cwd=r2,
        ).split()
        check(
            "the modified-migration case is not vacuous (AM would list it)",
            got_am == [f"{MIGRATIONS}/{victim.name}"],
            f"AM gave {got_am}; if this is empty, case 2 proves nothing",
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} case(s): {', '.join(failures)}")
        return 1
    print("SELF-TEST PASSED — added is separated from modified, and a partial")
    print("                   view raises instead of answering 'nothing added'.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", help="base ref the PR merges into, e.g. origin/main")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    if not args.base:
        # No base ref is the `push` / `schedule` shape, and it is legitimate:
        # nothing is held back and parity behaves exactly as it does today.
        # Said out loud rather than inferred from empty output.
        print("# no --base given: nothing held back (push/schedule shape)", file=sys.stderr)
        return 0

    try:
        for path in added_migrations(args.base, args.head):
            print(path)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        print(
            "Exit 2. Holding back nothing would silently make this a strict run; "
            "holding back everything would silently make it vacuous. Neither is "
            "an answer, so this refuses to give one.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
