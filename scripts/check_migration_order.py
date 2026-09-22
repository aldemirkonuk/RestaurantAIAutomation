#!/usr/bin/env python3
"""
Guard: a migration this change adds sorts after every version its base already has.

WHY THIS EXISTS
---------------
`scripts/check_migration_versions_unique.py` proves that no two files in
supabase/migrations/ share a version. It was never asked -- and cannot answer --
whether a NEW file is the NEWEST one. A file dated behind a version the base
already holds is unique, so it passes and merges green. After that:

  * Production and every fresh database disagree on ORDER. Production, already
    past the ceiling, runs the late file after newer ones; `supabase db reset`
    (CI's comparison database, every local and preview database) runs it before
    them, by filename. Two migrations touching one object then end in two
    different states, and the one CI trusts is not the one serving traffic.
  * The Supabase CLI's `db push` refuses a local file dated before the remote's
    last applied version unless it is given `--include-all` ("Found local
    migration files to be inserted before the last migration on remote
    database." -- read from the installed CLI's help and binary, not run
    against a database), so the hand path breaks.
  * Whether the merge-time runner applies it at all is behaviour this repo does
    not pin. Measured once: #391 (11c501d26) landed four files dated
    20260913190100..20260917010400 behind main's 20260919120000, and the push
    run's ledger check (schema-parity run 35624595661, 16:21Z, ~4.5 min after
    the merge) found a production row for every file -- so that time they were
    registered. "Never runs" is therefore NOT what was observed; divergent order
    and a runner-dependent outcome are.

Measured 2026-09-21 against origin/main 9cfc4e96d (newest 20260919120000):
open PR #414 added 20260913190500..20260919050000, behind main, with its
uniqueness check green; #415, #422, #430 and #434 were ahead of main but behind
#429's 20260921113000, so whichever merged after #429 lands behind it. The same
day a lane renamed a migration "one step past the ceiling" and lost the race
twice. ADR 0212.

WHAT COUNTS
-----------
  * ADDED means added relative to the merge base, with rename detection OFF
    (`--no-renames`), so a renamed file is a delete plus an add and its new
    name is checked like any other new file.
  * A MODIFIED file that already exists on the base is not this guard's
    business -- editing an applied migration is schema drift, which the
    schema-parity job (`Fresh database equals remote`) owns.
  * An added file whose exact name is already on the base tip is not new to
    the base (a stacked PR whose parent merged first) and is not counted.
  * Only top-level supabase/migrations/*.sql files are migrations; seed/ and
    any other subdirectory is not. A top-level .sql whose name does not start
    with a 14-digit version FAILS: it cannot be ordered, and the Supabase CLI
    reads such a name differently or not at all.
  * STRICTLY greater. An equal version is a collision, not an order.

THE THREE EVENTS (CI)
---------------------
  pull_request       base = origin/<base_ref>. Added = merge-base(base, HEAD)
                     vs HEAD's tree (base...HEAD). A local run (no --event)
                     adds the INDEX's additions too, so a staged file counts;
                     HEAD is always read, so an empty or stale index cannot
                     hide a committed file. Ceiling = newest version on the
                     base TIP, not on the merge base -- if the base moved on
                     since the branch forked, the new tip is what the database
                     will be past when this merges.
  push               Added = `github.event.before` vs HEAD. Ceiling = newest
                     version in `before`'s tree. Loud after the fact: a file
                     that reached main without a PR run is named on main.
  workflow_dispatch  No `before` exists; HEAD vs its first parent. This is the
                     run scripts/pr_audit_gate.py triggers after a merge it
                     performs itself (a GITHUB_TOKEN push starts no run).

Strict branch protection (`strict: true` on main, measured 2026-09-21 with
`gh api .../branches/main/protection/required_status_checks`) is what makes the
pull_request arm sufficient on its own: a PR merges only when its head is up to
date with main, and updating it re-runs this check against the new tip.

EXCEPTIONS (ADR 0212, founder 2026-09-22: "Exceptions list, your word
(Recommended)")
------------------------------------------------------------------------------
`supabase/migration-order-exceptions.txt`, one `<14-digit version> <reason>`
per line, lists versions the founder has approved to land behind the ceiling --
a ledger-reconciliation rename onto production's already-applied version, or a
revert that restores a deleted migration. A listed version passes the order
check; an unlisted one fails exactly as before. The file is read from HEAD's
checkout (so the exception ships in the same commit as the migration it
covers), and it is gate-owned (`scripts/pr_audit_gate.py::_GATE_OWNED_PATHS`):
adding an entry is not the guard weakening itself unaudited. A line that is not
`<version> <reason>` is CANNOT CHECK, never a silent pass -- an unreadable
allowlist is not the same as an empty one. So is a line whose version no
migration file in the checkout carries: an exception lands with the file it
covers, never ahead of it as a standing pre-approval.

NEVER VACUOUS
-------------
Exit 2 -- not 0 -- whenever the guard cannot see what it claims to check: the
base ref does not resolve, a shallow clone holds no merge base, `before` is
missing or all zeros, the base holds zero migrations, the exceptions file has
a malformed line or one naming no migration, or git itself fails.

EXIT CODES
----------
  0  every added migration sorts after the base's newest version
  1  at least one added migration is not after it (each is named, with the fix)
  2  CANNOT CHECK -- fix the environment; this is not a skip
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

MIGRATIONS_DIR = "supabase/migrations"
# `supabase/migrations/<version>_<name>.sql`, top level only.
MIGRATION_RE = re.compile(r"^supabase/migrations/(\d{14})_([^/]+)\.sql$")
# Any top-level .sql -- a file here that MIGRATION_RE rejects cannot be ordered.
TOP_LEVEL_SQL_RE = re.compile(r"^supabase/migrations/[^/]+\.sql$")
ZERO_SHA_RE = re.compile(r"^0+$")
LOCAL_DEFAULT_BASE = "origin/main"

# ADR 0212, founder 2026-09-22: "Exceptions list, your word (Recommended)".
EXCEPTIONS_PATH = "supabase/migration-order-exceptions.txt"
EXCEPTION_LINE_RE = re.compile(r"^(\d{14})\s+(\S.*)$")


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
        raise CannotCheck(
            f"`git {' '.join(args)}` failed: {(out.stderr or out.stdout).strip()[:400]}"
        )
    return out.stdout


def is_shallow() -> bool:
    try:
        return git("rev-parse", "--is-shallow-repository").strip() == "true"
    except CannotCheck:
        return False


def resolve(ref: str, what: str) -> str:
    try:
        return git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}").strip()
    except CannotCheck as exc:
        hint = (
            " This clone is SHALLOW: fetch with full history (actions/checkout "
            "`fetch-depth: 0`) and fetch the base branch."
            if is_shallow()
            else " Fetch it first: git fetch origin '+refs/heads/*:refs/remotes/origin/*'."
        )
        raise CannotCheck(
            f"the {what} `{ref}` does not resolve to a commit.{hint}"
        ) from exc


def versions_at(commit: str) -> dict[str, str]:
    """version -> filename for the top-level migrations in a commit's tree."""
    found: dict[str, str] = {}
    raw = git("ls-tree", "-r", "-z", "--name-only", commit, "--", MIGRATIONS_DIR)
    for path in raw.split("\0"):
        m = MIGRATION_RE.match(path)
        if m:
            found[m.group(1)] = f"{m.group(1)}_{m.group(2)}.sql"
    return found


def ceiling_of(tree: dict[str, str], label: str) -> tuple[str, str]:
    if not tree:
        raise CannotCheck(
            f"{label} holds no file matching {MIGRATION_RE.pattern!r}. Either the "
            "migrations directory moved, the naming convention changed, or this is "
            "not the tree you meant -- a ceiling of nothing would pass every file."
        )
    top = max(tree)
    return top, tree[top]


def is_after(version: str, ceiling: str) -> bool:
    """The whole rule. Both are 14-digit strings, so text order is time order."""
    return version > ceiling


def load_exceptions() -> dict[str, str]:
    """version -> reason, from HEAD's checkout (never the base).

    A version listed here passes the order check even if it is EQUAL TO or
    BEHIND the ceiling (ADR 0212, founder 2026-09-22: "Exceptions list, your
    word (Recommended)"). No file at all means no exceptions -- that is a
    real empty set, not CANNOT CHECK. A file that exists but has a line that
    is not `<14-digit version> <reason>` IS CannotCheck: a malformed
    allowlist must never be read as an empty, permissive one.

    Every listed version must also name a migration file in the checkout's
    MIGRATIONS_DIR. A line naming no file is CannotCheck too: it would
    otherwise sit in the list as a standing pre-approval for whatever file
    later takes that version, approved before anyone saw the file. The
    exception and the file it covers land together or not at all.
    """
    if not os.path.exists(EXCEPTIONS_PATH):
        return {}
    reasons: dict[str, str] = {}
    with open(EXCEPTIONS_PATH, encoding="utf-8") as fh:
        for n, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            m = EXCEPTION_LINE_RE.match(line)
            if not m:
                raise CannotCheck(
                    f"{EXCEPTIONS_PATH}:{n} is not `<14-digit version> <reason>`: "
                    f"{line!r}. Fix or remove the line -- a malformed exceptions "
                    "file is a failure, never a silent empty one."
                )
            reasons[m.group(1)] = m.group(2)
    if reasons:
        names = os.listdir(MIGRATIONS_DIR) if os.path.isdir(MIGRATIONS_DIR) else []
        present = {
            m.group(1)
            for n in names
            if (m := MIGRATION_RE.match(f"{MIGRATIONS_DIR}/{n}"))
        }
        stale = sorted(set(reasons) - present)
        if stale:
            raise CannotCheck(
                f"{EXCEPTIONS_PATH} lists {', '.join(stale)}, but no "
                f"{MIGRATIONS_DIR}/<version>_*.sql in this checkout carries "
                f"{'that version' if len(stale) == 1 else 'those versions'}. "
                "An exception names a file that exists: remove the line, or fix "
                "its version to the file it was meant to cover."
            )
    return reasons


def added_paths(old: str, new: str | None) -> list[str]:
    """Files ADDED between two trees; `new=None` means the index.

    `--no-renames` makes a rename a delete plus an add, so the renamed-to name
    is checked; with git's default rename detection it would be an `R` and
    `--diff-filter=A` would never see it.
    """
    args = ["diff", "--no-renames", "--diff-filter=A", "--name-only", "-z"]
    if new is None:
        args += ["--cached", old]
    else:
        args += [old, new]
    args += ["--", MIGRATIONS_DIR]
    return [p for p in git(*args).split("\0") if p]


def evaluate(
    added: list[str],
    base_tree: dict[str, str],
    base_label: str,
    exceptions: dict[str, str] | None = None,
) -> tuple[list[str], list[str], tuple[str, str]]:
    """-> (failures, checked, ceiling). Pure: no git."""
    exceptions = exceptions or {}
    ceiling, ceiling_name = ceiling_of(base_tree, base_label)
    on_base = set(base_tree.values())
    failures: list[str] = []
    checked: list[str] = []
    for path in sorted(added):
        if not TOP_LEVEL_SQL_RE.match(path):
            continue  # seed/ and other subdirectories are not migrations
        name = path[len(MIGRATIONS_DIR) + 1 :]
        m = MIGRATION_RE.match(path)
        if not m:
            failures.append(
                f"UNORDERABLE: {path}\n"
                f"  its name does not start with a 14-digit version, so it has no\n"
                f"  place in the order at all. Name it <version>_<name>.sql with a\n"
                f"  version after {ceiling}."
            )
            continue
        if name in on_base:
            continue  # already on the base tip under this exact name: not new to it
        version = m.group(1)
        checked.append(name)
        if version in exceptions:
            continue  # ADR 0212 exceptions list: the founder already approved this one
        if not is_after(version, ceiling):
            relation = "EQUAL TO" if version == ceiling else "BEHIND"
            failures.append(
                f"OUT OF ORDER: {path}\n"
                f"  version {version} is {relation} the newest version already on "
                f"{base_label}:\n"
                f"  {ceiling} ({MIGRATIONS_DIR}/{ceiling_name})\n"
                f"  Or list it in {EXCEPTIONS_PATH} with a reason, if this is a "
                f"ledger reconciliation or a restore the founder has approved."
            )
    return failures, checked, (ceiling, ceiling_name)


def report(failures: list[str], ceiling: str) -> None:
    for f in failures:
        print(f)
        print()
    print(
        "Production is already past the newest version, so it would run these "
        "AFTER migrations that every fresh database (supabase db reset, CI's "
        "comparison copy, local) runs them BEFORE -- two histories for one set of "
        "files -- and `supabase db push` refuses them without --include-all. The "
        "uniqueness guard cannot see this: these versions are unique."
    )
    print(
        f"Fix, on THIS branch: rename to a version after {ceiling}: "
        "date -u +%Y%m%d%H%M%S (if the clock is past it; otherwise any unused "
        f"version after {ceiling}), and update every citation of the old name "
        "(git grep -n <old version>). Go well past the ceiling, not one step: "
        "sibling branches claim versions too, and the uniqueness guard re-checks them."
    )


def run_range(before: str, after: str, label: str) -> int:
    before_c = resolve(before, "`before` commit")
    after_c = resolve(after, "pushed commit")
    added = added_paths(before_c, after_c)
    failures, checked, (ceiling, name) = evaluate(
        added, versions_at(before_c), f"{label} ({before_c[:9]})", load_exceptions()
    )
    if failures:
        report(failures, ceiling)
        return 1
    print(
        f"OK -- {len(checked)} migration(s) added in {before_c[:9]}..{after_c[:9]}"
        + (f": {', '.join(checked)}" if checked else "")
        + f". Ceiling before them: {ceiling} ({name})."
    )
    return 0


def run_base(base: str, include_index: bool) -> int:
    base_c = resolve(base, "base ref")
    head_c = resolve("HEAD", "HEAD")
    try:
        mb = git("merge-base", base_c, head_c).strip()
    except CannotCheck as exc:
        hint = " This clone is SHALLOW, which hides it." if is_shallow() else ""
        raise CannotCheck(
            f"no merge base between {base} and HEAD, so what this branch ADDED is "
            f"unknowable.{hint} Check out with full history (fetch-depth: 0)."
        ) from exc
    # HEAD's committed tree is ALWAYS read. An index alone can be empty or stale
    # (a --no-checkout clone, `git read-tree --empty`), and reading only the
    # index then saw zero additions and passed a committed out-of-order file.
    added = set(added_paths(mb, head_c))
    if include_index:
        added |= set(added_paths(mb, None))  # local run: a staged file counts too
    failures, checked, (ceiling, name) = evaluate(
        sorted(added), versions_at(base_c), base, load_exceptions()
    )
    if failures:
        report(failures, ceiling)
        return 1
    print(
        f"OK -- {len(checked)} migration(s) added since the merge base {mb[:9]}"
        + (f": {', '.join(checked)}" if checked else "")
        + f". Newest on {base} ({base_c[:9]}): {ceiling} ({name})."
    )
    return 0


def run_event(event: str, base_ref: str, before: str) -> int:
    if event == "pull_request":
        if not base_ref:
            raise CannotCheck(
                f"event {event} but no base ref was passed (github.base_ref is empty)"
            )
        return run_base(f"origin/{base_ref}", include_index=False)
    if event == "push":
        if not before or ZERO_SHA_RE.match(before):
            raise CannotCheck(
                f"push event with `before`={before!r}: a new branch or a missing "
                "payload has no prior tree to take a ceiling from"
            )
        return run_range(before, "HEAD", "the tree before this push")
    if event == "workflow_dispatch":
        return run_range("HEAD^1", "HEAD", "HEAD's first parent")
    raise CannotCheck(
        f"event {event!r} is not one this guard knows how to scope "
        "(pull_request, push, workflow_dispatch)"
    )


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------

CEIL = "20260919120000_trust_counter_is_server_only.sql"
OLD = "20260910000000_an_old_one.sql"


class _Fixture:
    """A throwaway origin + clone. Nothing is read from the enclosing checkout,
    and git runs with no global or system config and no inherited GIT_* env, so
    neither a hook's GIT_DIR nor a user's `diff.renames` can change a verdict."""

    def __init__(self, td: str):
        self.td = td
        self.bare = os.path.join(td, "origin.git")
        self.repo = os.path.join(td, "repo")
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        self.env = env

    def sh(self, *args: str, cwd: str | None = None) -> str:
        r = subprocess.run(
            list(args),
            cwd=cwd or self.repo,
            env=self.env,
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            raise RuntimeError(f"`{' '.join(args)}`: {(r.stderr or r.stdout).strip()}")
        return r.stdout.strip()

    def write(self, rel: str, text: str = "-- fixture\n", append: bool = False) -> None:
        path = os.path.join(self.repo, MIGRATIONS_DIR, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a" if append else "w", encoding="utf-8") as fh:
            fh.write(text)

    def write_repo(self, rel: str, text: str, append: bool = False) -> None:
        """Like `write`, but `rel` is repo-root-relative -- for files outside
        MIGRATIONS_DIR, such as the exceptions list."""
        path = os.path.join(self.repo, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a" if append else "w", encoding="utf-8") as fh:
            fh.write(text)

    def commit(self, msg: str) -> str:
        self.sh("git", "add", "-A")
        self.sh("git", "commit", "--quiet", "--no-verify", "-m", msg)
        return self.sh("git", "rev-parse", "HEAD")

    def guard(self, *args: str, cwd: str | None = None) -> tuple[int, str]:
        r = subprocess.run(
            [sys.executable, os.path.abspath(__file__), *args],
            cwd=cwd or self.repo,
            env=self.env,
            capture_output=True,
            text=True,
        )
        return r.returncode, r.stdout + r.stderr

    def build(self) -> str:
        os.makedirs(self.repo)
        self.sh(
            "git", "init", "--quiet", "--bare", "-b", "main", self.bare, cwd=self.td
        )
        self.sh("git", "init", "--quiet", "-b", "main", self.repo, cwd=self.td)
        self.sh("git", "config", "user.email", "guard@invalid")
        self.sh("git", "config", "user.name", "guard")
        self.write(OLD)
        self.write(CEIL)
        self.write("seed/09_wine_regions_seed.sql")
        b0 = self.commit("base")
        self.sh("git", "remote", "add", "origin", self.bare)
        self.sh("git", "push", "--quiet", "origin", "main")
        self.sh("git", "fetch", "--quiet", "origin")
        return b0


def run_self_test() -> int:
    failures: list[str] = []

    # The rule itself, before any git: equal and older are both refused.
    for v, c, want in (
        ("20260919120001", "20260919120000", True),
        ("20260919120000", "20260919120000", False),
        ("20260913190500", "20260919120000", False),
    ):
        if is_after(v, c) is not want:
            failures.append(f"is_after({v}, {c}) is {not want}, want {want}")

    PR = ("--event", "pull_request", "--base-ref", "main")

    ran: list[str] = []

    def expect(label: str, got: tuple[int, str], code: int, *must: str) -> None:
        ran.append(label)
        rc, out = got
        if rc != code:
            failures.append(
                f"{label}: exited {rc}, want {code}. Output: {out.strip()[:300]}"
            )
            return
        for s in must:
            if s not in out:
                failures.append(
                    f"{label}: exited {rc} as expected but never named {s!r}"
                )

    try:
        with tempfile.TemporaryDirectory() as td:
            fx = _Fixture(td)
            b0 = fx.build()

            def case(name: str, from_ref: str = b0) -> None:
                fx.sh("git", "checkout", "--quiet", "--force", "-B", name, from_ref)

            case("newer")
            fx.write("20260921113000_relay_close.sql")
            fx.commit("newer")
            expect("newer file", fx.guard(*PR), 0, "20260919120000")

            case("older")
            fx.write("20260913190500_admin_desk.sql")
            fx.write("20260921114000_one_that_is_fine.sql")
            fx.commit("older")
            expect(
                "older file beside a newer one",
                fx.guard(*PR),
                1,
                "20260913190500_admin_desk.sql",
                "20260919120000",
                "date -u +%Y%m%d%H%M%S",
            )

            case("equal")
            fx.write("20260919120000_same_second.sql")
            fx.commit("equal")
            expect("equal version", fx.guard(*PR), 1, "EQUAL TO", "20260919120000")

            case("rename")
            fx.sh(
                "git",
                "mv",
                f"{MIGRATIONS_DIR}/{OLD}",
                f"{MIGRATIONS_DIR}/20260911000000_an_old_one.sql",
            )
            fx.commit("rename")
            expect(
                "rename to an older version",
                fx.guard(*PR),
                1,
                "20260911000000_an_old_one.sql",
            )

            case("modified")
            fx.write(OLD, "-- edited after merge\n", append=True)
            fx.commit("modified")
            expect("modified already-merged file", fx.guard(*PR), 0)

            case("seed")
            fx.write("seed/10_more_seed.sql")
            fx.commit("seed")
            expect("seed/ file", fx.guard(*PR), 0)

            case("unorderable")
            fx.write("2026092111_short_version.sql")
            fx.commit("unorderable")
            expect("non-14-digit top-level .sql", fx.guard(*PR), 1, "UNORDERABLE")

            case("staged")
            fx.write("20260913190600_staged_only.sql")
            fx.sh("git", "add", "-A")
            # Gone from the working tree, still in the index: the INDEX is what
            # the next commit holds, so the INDEX is what is checked.
            os.remove(
                os.path.join(fx.repo, MIGRATIONS_DIR, "20260913190600_staged_only.sql")
            )
            expect(
                "older file present only in the index (local run)",
                fx.guard("--base", "origin/main"),
                1,
                "20260913190600_staged_only.sql",
            )
            fx.sh("git", "reset", "--quiet", "--hard")

            # An EMPTY index (a --no-checkout clone, `git read-tree --empty`)
            # must not hide a COMMITTED older file: HEAD's tree is always read.
            fx.sh("git", "checkout", "--quiet", "--force", "older")
            fx.sh("git", "read-tree", "--empty")
            expect(
                "committed older file behind an empty index (CI arm)",
                fx.guard(*PR),
                1,
                "20260913190500_admin_desk.sql",
            )
            expect(
                "committed older file behind an empty index (local run)",
                fx.guard("--base", "origin/main"),
                1,
                "20260913190500_admin_desk.sql",
            )
            fx.sh("git", "read-tree", "HEAD")

            # push arm: the tree before the push is the ceiling.
            fx.sh("git", "checkout", "--quiet", "--force", "older")
            expect(
                "push adding an older file",
                fx.guard("--event", "push", "--before", b0),
                1,
                "20260913190500_admin_desk.sql",
            )
            fx.sh("git", "checkout", "--quiet", "--force", "newer")
            expect(
                "push adding a newer file",
                fx.guard("--event", "push", "--before", b0),
                0,
            )
            expect(
                "push with an all-zero before",
                fx.guard("--event", "push", "--before", "0" * 40),
                2,
                "prior tree",
            )
            expect(
                "push with no before", fx.guard("--event", "push", "--before", ""), 2
            )

            # workflow_dispatch arm: HEAD against its first parent.
            fx.sh("git", "checkout", "--quiet", "--force", "older")
            expect(
                "workflow_dispatch on a commit adding an older file",
                fx.guard("--event", "workflow_dispatch"),
                1,
                "20260913190500_admin_desk.sql",
            )

            # main moves on: the ceiling is the base TIP, not the merge base.
            fx.sh("git", "checkout", "--quiet", "--force", "main")
            fx.write("20260921113000_relay_close.sql")
            # ...and renumbers an old file away, so a branch that EDITS the old
            # name holds a path the new tip lacks: still a modification.
            fx.sh(
                "git",
                "mv",
                f"{MIGRATIONS_DIR}/{OLD}",
                f"{MIGRATIONS_DIR}/20260909000000_an_old_one.sql",
            )
            fx.commit("main advances")
            fx.sh("git", "push", "--quiet", "origin", "main")
            fx.sh("git", "fetch", "--quiet", "origin")

            case("behind_moved_tip")
            # A LOCAL `main` still at the fork point, as a developer's often is:
            # the pull_request arm must read origin/<base_ref>, never `main`.
            fx.sh("git", "branch", "--force", "main", b0)
            fx.write("20260920100000_promos_sizing.sql")
            fx.commit("forked before main moved")
            expect(
                "ahead of the merge base, behind the moved tip",
                fx.guard(*PR),
                1,
                "20260920100000_promos_sizing.sql",
                "20260921113000",
            )

            case("edited_then_renamed_on_base")
            fx.write(OLD, "-- edited on the branch\n", append=True)
            fx.commit("edits a file main has since renamed")
            expect("modified file the moved tip no longer has", fx.guard(*PR), 0)

            case("stacked")
            fx.write("20260921113000_relay_close.sql")
            fx.commit("parent PR's file, already merged on main")
            expect("file already on the base tip under the same name", fx.guard(*PR), 0)

            # ADR 0212 exceptions list (founder 2026-09-22): a listed version
            # passes even though it is behind the ceiling; an unlisted one
            # still fails; a malformed line is CANNOT CHECK, never a silent
            # pass.
            case("exception_listed")
            fx.write("20260910000100_backfill_from_the_old_system.sql")
            fx.write_repo(
                EXCEPTIONS_PATH,
                "20260910000100  ledger reconciliation onto production's already-"
                "applied version (ADR 0212)\n",
            )
            fx.commit("a behind-ceiling version the exceptions file allows")
            expect("version listed in the exceptions file", fx.guard(*PR), 0)
            # ...and on main after the merge: the push and workflow_dispatch
            # arms read the same list, or an approved exception turns main red.
            expect(
                "listed version, push arm",
                fx.guard("--event", "push", "--before", b0),
                0,
                "20260910000100_backfill_from_the_old_system.sql",
            )
            expect(
                "listed version, workflow_dispatch arm",
                fx.guard("--event", "workflow_dispatch"),
                0,
                "20260910000100_backfill_from_the_old_system.sql",
            )

            case("exception_unlisted")
            fx.write("20260910000200_a_second_behind_ceiling_file.sql")
            fx.write_repo(
                EXCEPTIONS_PATH,
                "20260910000000  unrelated entry (a file this branch holds), does "
                "not cover the new one\n",
            )
            fx.commit("a behind-ceiling version NOT in the exceptions file")
            expect(
                "version absent from the exceptions file still fails",
                fx.guard(*PR),
                1,
                "20260910000200_a_second_behind_ceiling_file.sql",
            )

            case("exception_malformed")
            fx.write("20260910000300_another_behind_ceiling_file.sql")
            fx.write_repo(EXCEPTIONS_PATH, "not a version at all\n")
            fx.commit("a malformed exceptions file")
            expect(
                "malformed exceptions file line is CANNOT CHECK, not a pass",
                fx.guard(*PR),
                2,
                EXCEPTIONS_PATH,
            )

            # Every exception carries its reason: a bare version is malformed.
            case("exception_without_reason")
            fx.write("20260910000400_listed_without_a_reason.sql")
            fx.write_repo(EXCEPTIONS_PATH, "20260910000400\n")
            fx.commit("an exceptions line with a version and no reason")
            expect(
                "exceptions line without a reason is CANNOT CHECK, not a pass",
                fx.guard(*PR),
                2,
                f"{EXCEPTIONS_PATH}:1",
            )

            # A listed version with no file behind it is a standing pre-approval
            # for whatever file later takes that version. CANNOT CHECK, even when
            # everything this branch adds is in order on its own.
            case("exception_names_no_file")
            fx.write("20260921130000_in_order_on_its_own.sql")
            fx.write_repo(
                EXCEPTIONS_PATH,
                "20260910000900  approved ahead of any file carrying it\n",
            )
            fx.commit("an exceptions line that names no migration")
            expect(
                "exceptions line naming no migration file is CANNOT CHECK",
                fx.guard(*PR),
                2,
                "20260910000900",
                "no supabase/migrations/<version>_*.sql",
            )

            # cannot-check arms: each must be exit 2, never 0, and for its OWN
            # reason. They run from `stacked`, a tree that passes cleanly: left
            # on the branch above, the exceptions line naming no file made every
            # run exit 2 before these arms were reached, so an unknown event or
            # a missing base that silently fell back to origin/main still "exited
            # 2" (last call, 2026-09-22: both mutants survived until this line).
            fx.sh("git", "checkout", "--quiet", "--force", "stacked")
            expect(
                "pull_request with no base ref",
                fx.guard("--event", "pull_request", "--base-ref", ""),
                2,
                "base_ref is empty",
            )
            expect(
                "base ref that does not exist",
                fx.guard("--event", "pull_request", "--base-ref", "nope"),
                2,
                "`origin/nope` does not resolve",
            )
            expect(
                "unknown event",
                fx.guard("--event", "schedule"),
                2,
                "not one this guard knows how to scope",
            )

            fx.sh("git", "checkout", "--quiet", "--orphan", "unrelated")
            fx.sh("git", "rm", "-r", "--quiet", "--cached", ".")
            fx.write("20260913190500_admin_desk.sql")
            fx.commit("unrelated history")
            expect("no merge base", fx.guard(*PR), 2, "merge base")

            fx.sh("git", "checkout", "--quiet", "--orphan", "bare_main")
            fx.sh("git", "rm", "-r", "--quiet", "--cached", ".")
            shutil.rmtree(os.path.join(fx.repo, "supabase"))
            with open(os.path.join(fx.repo, "README.md"), "w", encoding="utf-8") as fh:
                fh.write("no migrations here\n")
            fx.commit("a base with no migrations")
            fx.sh("git", "push", "--quiet", "origin", "bare_main")
            fx.sh("git", "fetch", "--quiet", "origin")
            fx.sh("git", "checkout", "--quiet", "-b", "on_bare_main")
            fx.write("20260921120000_x.sql")
            fx.commit("adds one")
            expect(
                "base with zero migrations",
                fx.guard("--event", "pull_request", "--base-ref", "bare_main"),
                2,
                "no file matching",
            )

            # A shallow clone -- every branch at depth 1 -- has origin/main and the
            # branch but no common ancestor: the merge base is simply not there.
            fx.sh("git", "push", "--quiet", "origin", "older")
            shallow = os.path.join(td, "shallow")
            fx.sh(
                "git",
                "clone",
                "--quiet",
                "--depth",
                "1",
                "--no-single-branch",
                "--branch",
                "older",
                f"file://{fx.bare}",
                shallow,
                cwd=td,
            )
            expect(
                "shallow clone without the merge base",
                fx.guard(*PR, cwd=shallow),
                2,
                "SHALLOW",
            )

            # The real post-merge topology: every push/workflow_dispatch case
            # above happens to run with origin/main still equal to
            # `before`/HEAD^1, because origin/main is only ever pushed once,
            # at b0, until here. A workflow_dispatch or
            # push arm that mistakenly read origin/main instead of the
            # explicit before/HEAD^1 arguments would pass every case above
            # by coincidence. Only a fixture where origin/main IS HEAD --
            # as it is the moment after a real merge lands -- tells the two
            # apart.
            fx.sh("git", "checkout", "--quiet", "--force", "-B", "main", "origin/main")
            premerge = fx.sh("git", "rev-parse", "HEAD")
            fx.write("20260913190700_post_merge_straggler.sql")
            fx.commit("an out-of-order file lands directly on main")
            fx.sh("git", "push", "--quiet", "origin", "main")
            fx.sh("git", "fetch", "--quiet", "origin")
            expect(
                "push, post-merge topology: origin/main IS HEAD",
                fx.guard("--event", "push", "--before", premerge),
                1,
                "20260913190700_post_merge_straggler.sql",
            )
            expect(
                "workflow_dispatch, post-merge topology: origin/main IS HEAD",
                fx.guard("--event", "workflow_dispatch"),
                1,
                "20260913190700_post_merge_straggler.sql",
            )
    except RuntimeError as exc:
        print(f"SELF-TEST CANNOT RUN: fixture step failed: {exc}", file=sys.stderr)
        return 2

    if failures:
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    if len(ran) < 33:
        print(f"SELF-TEST FAILED: only {len(ran)} of 33 fixture cases ran")
        return 1
    print(
        f"SELF-TEST OK -- {len(ran)} fixture cases + 3 rule checks: newer passes; older, equal, renamed-to-older, "
        "non-14-digit, staged-older and committed-older-behind-an-empty-index "
        "fail; a modified merged file and seed/ are "
        "ignored; the ceiling is the moved base tip; a stacked file already on the "
        "tip passes; an exceptions-listed version passes in every arm, an unlisted one still "
        "fails, an exceptions line that is malformed, has no reason or names no "
        "file is CANNOT CHECK; the push and "
        "workflow_dispatch arms fire, including in the real post-merge topology "
        "where origin/main IS HEAD; a missing, empty or "
        "unknown base, no merge base, a zero-migration base, a zero `before` and a "
        "shallow clone each exit 2."
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the guard fires on the shapes it exists to catch",
    )
    ap.add_argument("--event", help="github.event_name; selects the CI arm")
    ap.add_argument("--base-ref", default="", help="github.base_ref (pull_request)")
    ap.add_argument("--before", default="", help="github.event.before (push)")
    ap.add_argument(
        "--base",
        help=f"local run: compare against this ref (default {LOCAL_DEFAULT_BASE})",
    )
    args = ap.parse_args()

    if args.self_test:
        return run_self_test()
    try:
        if args.event is not None:
            return run_event(args.event, args.base_ref, args.before)
        return run_base(args.base or LOCAL_DEFAULT_BASE, include_index=True)
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
