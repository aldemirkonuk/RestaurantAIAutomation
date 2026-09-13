#!/usr/bin/env python3
"""Guard: supabase/migrations/*.sql and the production ledger must agree, both ways.

WHY THIS EXISTS
---------------
ADR 0031 (.planning/decisions/0031-migration-ledger-reconciliation.md, Locked
2026-08-25) named this exact path -- scripts/check_migration_ledger.py -- as the
standing enforcement for a bidirectional reconciliation it did by hand: four
migrations had been applied to production but never registered in the ledger,
and one dashboard-applied migration was registered with no file anywhere in the
repo. Its own Consequences section says the script "exists and passes" and was
"proven by injecting drift in both directions at once".

It never existed. Verified 2026-09-12:

    git cat-file -e origin/main:scripts/check_migration_ledger.py
        -> fatal: path 'scripts/check_migration_ledger.py' does not exist in 'origin/main'

    grep -rl check_migration_ledger .github/workflows/
        -> no hits

So from 2026-08-25 to 2026-09-12 nothing in this repository would have noticed
either direction of ledger drift, and on 2026-09-12 it drifted again: production
had fallen behind far enough to block every open pull request (two of `main`'s
required contexts measure live production -- see the memory
main-wedges-when-production-falls-behind), and the fix was 19 migrations applied
by hand through the Supabase connector rather than the GitHub integration. Each
was stamped with its own file's version and its `md5(statements[1])` checked
against the file -- by hand, once, by a session. That one-time manual check is
exactly what a standing guard was supposed to make unnecessary.

WHAT THIS CHECKS
----------------
Two directions, both reported on every run, neither treated as merely
informational -- a report that only ever surfaces one direction is how ADR
0031's own dashboard-migration half would go unwatched again:

  FILES  = versions parsed from supabase/migrations/*.sql filenames
  LEDGER = versions in production's supabase_migrations.schema_migrations

  FILES - LEDGER   a migration file with no row in production -- either applied
                   out-of-band and never registered (ADR 0031's original
                   four-migration shape, and the 2026-09-12 incident), or never
                   applied to production at all.
  LEDGER - FILES   a ledger row with no file in the repo -- production ran SQL
                   this repository does not have a record of (ADR 0031's
                   dashboard-applied `clear_foreign_format_submission_signatures`
                   shape).

Filename parsing matches scripts/_migration_versions.py's convention exactly: a
14-digit version prefix before the first underscore, top-level files only (a
migration nested under supabase/migrations/seed/ is not a live migration).

USAGE
-----
  ./scripts/check_migration_ledger.py               # compare against production
  ./scripts/check_migration_ledger.py --self-test    # prove it fires both ways

ENVIRONMENT
-----------
  SUPABASE_DB_URL, SUPABASE_POOLER_URL, SUPABASE_POOLER_CONNECTION_STRING,
  SUPABASE_DIRECT_CONNECTION_STRING -- checked in that order, environment first
  then `.env`, the same fallback chain check_queried_tables_exist.py's
  --against-production arm uses. REQUIRED for anything but --self-test.

EXIT CODES
----------
  0   checked, and every version is on both sides
  1   checked, and at least one version is missing from one side -- both
      directions are always printed, even when only one is non-empty
  2   COULD NOT CHECK -- no migrations directory, no versioned migration files
      in it, no connection string, or the database is unreachable / the query
      failed. A comparison that scanned nothing is exit 2, never exit 0. See
      the memory absence-reported-as-health: a check that goes quiet when it
      cannot look is the fault class this repo keeps finding.

READ-ONLY against production: the session is opened readonly and the query is a
bare SELECT. The DSN is never printed, in either the normal path or an error
path -- a connection failure is reported by exception TYPE only, because
psycopg2's own error text can embed the DSN. Nothing here ever writes to
production, in the guard itself or in --self-test (which touches only a
throwaway temp directory, and its one connectivity probe points at localhost).

PROVEN AGAINST THE PRE-FIX TREE -- and what "proven" does not mean here:
this repository holds no record of what supabase_migrations.schema_migrations
looked like in production before today's hand-apply. That table's state was
never captured to a file anywhere in the repo, and unlike the migrations
directory it is not something `git` can check out at an earlier commit -- there
is no pre-fix tree to read it from. This session additionally has no database
credential at all (no SUPABASE_* environment variable, no .env), the same
posture a fork PR has in CI, so it could not have queried production even had
the row history survived somewhere. So the actual 2026-09-12 incident cannot be
replayed against this script, and this file does not claim it can.
--self-test instead proves the same SHAPE the incident had at the (files,
ledger) granularity this guard operates on -- files ahead of the ledger, a
ledger row with no file, and both at once -- against synthetic version numbers,
plus the exit-2 gates end to end. That is a structural proof that the guard
would have caught it, not a replay of the incident itself.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import re
import sys

MIGRATIONS_DIR = "supabase/migrations"

# Byte-for-byte the same pattern as scripts/_migration_versions.py, so the two
# guards can never disagree about what counts as a versioned migration file.
VERSIONED = re.compile(r"^(\d{14})_.+\.sql$")

DSN_ENV_VARS = (
    "SUPABASE_DB_URL",
    "SUPABASE_POOLER_URL",
    "SUPABASE_POOLER_CONNECTION_STRING",
    "SUPABASE_DIRECT_CONNECTION_STRING",
)


def cannot_check(msg: str) -> int:
    print(f"CANNOT CHECK -- {msg}")
    print("   Exiting 2. A run that scanned nothing must never read as PASS.")
    return 2


# ---------------------------------------------------------------------------
# FILES side
# ---------------------------------------------------------------------------
def file_versions(migrations_dir: pathlib.Path) -> dict[str, str]:
    """{version: filename} for every top-level, 14-digit-prefixed .sql file.

    Non-matching entries (a README, an unversioned .sql, the seed/ directory)
    are silently excluded, exactly as _migration_versions.py excludes them --
    this is a filter, not a parse failure.
    """
    out: dict[str, str] = {}
    for entry in sorted(os.listdir(migrations_dir)):
        if not (migrations_dir / entry).is_file():
            continue
        m = VERSIONED.match(entry)
        if m:
            out[m.group(1)] = entry
    return out


# ---------------------------------------------------------------------------
# LEDGER side
# ---------------------------------------------------------------------------
def resolve_dsn(repo: pathlib.Path) -> str | None:
    for key in DSN_ENV_VARS:
        val = os.environ.get(key)
        if val:
            return val
    env = repo / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            for key in DSN_ENV_VARS:
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"')
    return None


def ledger_versions(dsn: str) -> set[str] | None:
    """READ-ONLY: opens the session readonly, runs one SELECT.

    Returns None (having already printed CANNOT CHECK) on any failure. Never
    prints the DSN or raw exception text -- both can embed it -- only the
    exception's type name.
    """
    try:
        import psycopg2  # noqa: PLC0415  (optional: only this arm needs it)
    except ImportError:
        cannot_check("psycopg2 is not installed (pip install psycopg2-binary).")
        return None

    try:
        conn = psycopg2.connect(dsn, connect_timeout=15)
    except Exception as exc:  # noqa: BLE001 -- reported by type, never swallowed
        cannot_check(f"could not connect to the database ({type(exc).__name__}).")
        return None

    try:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute("SELECT version FROM supabase_migrations.schema_migrations")
            return {row[0] for row in cur.fetchall()}
    except Exception as exc:  # noqa: BLE001
        cannot_check(f"the ledger query failed ({type(exc).__name__}).")
        return None
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# The comparison itself -- pure, so --self-test can drive it with no database
# ---------------------------------------------------------------------------
def diff_versions(files: set[str], ledger: set[str]) -> tuple[list[str], list[str]]:
    """Both directions, sorted. This is the whole decision ADR 0031 asked for."""
    files_without_ledger_row = sorted(files - ledger)
    ledger_rows_without_file = sorted(ledger - files)
    return files_without_ledger_row, ledger_rows_without_file


def check(files: dict[str, str], ledger: set[str]) -> int:
    """Print the bidirectional report and return 0 (clean) or 1 (drift).

    Takes already-resolved data, not a DSN, so --self-test exercises this exact
    function -- not a hand-retyped mirror of it -- with no database at all.
    """
    print(f"files : {len(files)} versioned migration(s) in {MIGRATIONS_DIR}")
    print(f"ledger: {len(ledger)} row(s) in supabase_migrations.schema_migrations")

    files_without_ledger, ledger_without_file = diff_versions(set(files), ledger)
    fail = 0

    print()
    print(
        f"== FILES - LEDGER ({len(files_without_ledger)}) "
        "-- applied out-of-band and never registered, or never applied at all"
    )
    if files_without_ledger:
        fail = 1
        for v in files_without_ledger:
            print(f"   {v}  {files.get(v, '(filename unknown)')}")
        print(
            "   No row in production's schema_migrations for these. If it was applied\n"
            "   out-of-band, confirm that by hand first, then register it (ADR 0031's\n"
            "   connector recipe, or `supabase migration repair --status applied <version>`).\n"
            "   If it was never applied, production is running an older schema than this repo."
        )
    else:
        print("   none")

    print()
    print(
        f"== LEDGER - FILES ({len(ledger_without_file)}) "
        "-- a ledger row with no file in the repo"
    )
    if ledger_without_file:
        fail = 1
        for v in ledger_without_file:
            print(f"   {v}")
        print(
            "   Production ran SQL under this version that no branch of this repo has\n"
            "   a file for -- the repo is not a complete record of the schema. Recover the\n"
            "   text from supabase_migrations.schema_migrations.statements and commit it as\n"
            "   a migration file headed as a record of what already ran, the way ADR 0031\n"
            "   recovered 20260824071839_clear_foreign_format_submission_signatures."
        )
    else:
        print("   none")

    print()
    if fail:
        print("FAIL -- the migration ledger has drifted from the repo. See above.")
    else:
        print("PASS -- every migration file has a ledger row, and every ledger row has a file.")
    return fail


# ---------------------------------------------------------------------------
# Wiring -- parameterized on repo root so --self-test can point it at a
# throwaway directory instead of a subprocess
# ---------------------------------------------------------------------------
def run(repo: pathlib.Path) -> int:
    migrations = repo / MIGRATIONS_DIR
    if not migrations.is_dir():
        return cannot_check(f"'{MIGRATIONS_DIR}' does not exist under {repo}.")

    files = file_versions(migrations)
    if not files:
        return cannot_check(f"'{MIGRATIONS_DIR}' holds no versioned migration files.")

    dsn = resolve_dsn(repo)
    if not dsn:
        return cannot_check(
            "no database connection string "
            f"(checked {', '.join(DSN_ENV_VARS)}, and .env). "
            "See scripts/check_db_reachable.sh."
        )

    ledger = ledger_versions(dsn)
    if ledger is None:
        return 2  # ledger_versions() already printed CANNOT CHECK

    return check(files, ledger)


# ---------------------------------------------------------------------------
# --self-test
# ---------------------------------------------------------------------------
def self_test() -> int:  # noqa: PLR0915 -- a flat list of cases reads better here
    import shutil  # noqa: PLC0415
    import tempfile  # noqa: PLC0415

    failures: list[str] = []

    def ok(name: str, cond: bool, detail: str = "") -> None:
        if cond:
            print(f"   ok    {name}")
        else:
            failures.append(name)
            print(f"   FAIL  {name}{(' — ' + detail) if detail else ''}")

    # -- A. diff_versions -- pure, no database ---------------------------------
    print("== A. diff_versions() -- the bidirectional comparison itself")

    a, b = diff_versions(set(), set())
    ok("two empty sets: no drift either direction", (a, b) == ([], []))

    a, b = diff_versions({"20260101000000"}, {"20260101000000"})
    ok("identical single version: no drift", (a, b) == ([], []))

    # 1. FILES - LEDGER: the 2026-09-12 shape -- a file production has no row
    #    for, whether hand-applied-and-unregistered or never applied at all.
    a, b = diff_versions({"20260901000000", "20260902000000"}, {"20260901000000"})
    ok(
        "a file with no ledger row is caught, and ONLY in that direction",
        a == ["20260902000000"] and b == [],
        f"a={a} b={b}",
    )

    # 2. LEDGER - FILES: ADR 0031's dashboard-applied shape.
    a, b = diff_versions({"20260901000000"}, {"20260901000000", "20260824071839"})
    ok(
        "a ledger row with no file is caught, and ONLY in that direction",
        a == [] and b == ["20260824071839"],
        f"a={a} b={b}",
    )

    # 3. BOTH AT ONCE -- literally what ADR 0031 measured: four files missing
    #    their row and one row missing its file, simultaneously. A guard that
    #    only ever surfaces the direction it looks at first would silently drop
    #    the second -- the exact fault the absence-reported-as-health memory
    #    names -- so this is the case that matters most here.
    files5 = {"f1", "f2", "f3", "f4", "shared"}
    ledger5 = {"shared", "dashboard_only"}
    a, b = diff_versions(files5, ledger5)
    ok(
        "both directions are reported AT ONCE, neither masking the other",
        sorted(a) == ["f1", "f2", "f3", "f4"] and b == ["dashboard_only"],
        f"a={a} b={b}",
    )

    # -- B. check() -- report + exit code, still no database ------------------
    print("\n== B. check() -- the same two shapes, through the real reporting path")

    rc = check({"20260101000000": "20260101000000_a.sql"}, {"20260101000000"})
    ok("check() returns 0 when both sides agree", rc == 0)

    rc = check(
        {
            "20260101000000": "20260101000000_a.sql",
            "20260102000000": "20260102000000_b.sql",
        },
        {"20260101000000"},
    )
    ok("check() returns 1 when a file has no ledger row", rc == 1)

    rc = check(
        {"20260101000000": "20260101000000_a.sql"},
        {"20260101000000", "20260103000000"},
    )
    ok("check() returns 1 when a ledger row has no file", rc == 1)

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="cml-selftest-"))
    saved_env = {k: os.environ.get(k) for k in DSN_ENV_VARS}
    try:
        # -- C. file_versions() -- filename parsing against a real directory --
        print("\n== C. file_versions() -- filename parsing")

        mig = tmp / "clean-repo" / MIGRATIONS_DIR
        mig.mkdir(parents=True)
        (mig / "20260101000000_a.sql").write_text("select 1;\n", encoding="utf-8")
        (mig / "20260102000000_b.sql").write_text("select 1;\n", encoding="utf-8")
        (mig / "not_versioned.sql").write_text("select 1;\n", encoding="utf-8")
        (mig / "README.md").write_text("not sql\n", encoding="utf-8")
        (mig / "seed").mkdir()
        (mig / "seed" / "20260103000000_nested.sql").write_text("x\n", encoding="utf-8")

        found = file_versions(mig)
        ok(
            "exactly the two 14-digit-prefixed top-level .sql files are found",
            found
            == {
                "20260101000000": "20260101000000_a.sql",
                "20260102000000": "20260102000000_b.sql",
            },
            f"found={found}",
        )
        ok(
            "a non-versioned .sql filename is filtered out, not crashed on",
            "not_versioned.sql" not in found.values(),
        )
        ok(
            "a file nested under seed/ is not a top-level migration",
            "20260103000000" not in found,
        )

        # -- D. the exit-2 gates, end to end through run() ---------------------
        print("\n== D. run() -- the exit-2 gates fire, not just the comparison")

        # Clear every DSN var for the duration of this section: a real CI
        # secret in the ambient environment must not make these cases pass by
        # accident, and a real DSN must never be dereferenced by a self-test.
        for k in DSN_ENV_VARS:
            os.environ.pop(k, None)

        no_dir_root = tmp / "no-migrations-dir"
        no_dir_root.mkdir()
        rc = run(no_dir_root)
        ok("no supabase/migrations/ directory at all -> exit 2", rc == 2)

        empty_root = tmp / "empty-migrations-dir"
        (empty_root / MIGRATIONS_DIR).mkdir(parents=True)
        (empty_root / MIGRATIONS_DIR / "README.md").write_text("x\n", encoding="utf-8")
        rc = run(empty_root)
        ok("supabase/migrations/ with no versioned file -> exit 2", rc == 2)

        no_dsn_root = tmp / "no-dsn"
        (no_dsn_root / MIGRATIONS_DIR).mkdir(parents=True)
        (no_dsn_root / MIGRATIONS_DIR / "20260101000000_a.sql").write_text(
            "select 1;\n", encoding="utf-8"
        )
        rc = run(no_dsn_root)
        ok(
            "files present, but no connection string anywhere -> exit 2",
            rc == 2,
        )

        os.environ["SUPABASE_DB_URL"] = "postgresql://x:y@127.0.0.1:1/nonexistent"
        rc = run(no_dsn_root)
        ok(
            "a DSN that cannot connect (nothing listens on :1) -> exit 2, not a crash",
            rc == 2,
        )
        os.environ.pop("SUPABASE_DB_URL", None)

        env_file_root = tmp / "dsn-in-dotenv"
        (env_file_root / MIGRATIONS_DIR).mkdir(parents=True)
        (env_file_root / MIGRATIONS_DIR / "20260101000000_a.sql").write_text(
            "select 1;\n", encoding="utf-8"
        )
        (env_file_root / ".env").write_text(
            'SUPABASE_POOLER_URL="postgresql://x:y@127.0.0.1:1/nonexistent"\n',
            encoding="utf-8",
        )
        dsn = resolve_dsn(env_file_root)
        ok(
            ".env is read when no environment variable is set",
            dsn == "postgresql://x:y@127.0.0.1:1/nonexistent",
            f"dsn={dsn!r}",
        )

        os.environ["SUPABASE_DB_URL"] = "env-wins"
        dsn = resolve_dsn(env_file_root)
        ok(
            "an environment variable is preferred over .env",
            dsn == "env-wins",
            f"dsn={dsn!r}",
        )
        os.environ.pop("SUPABASE_DB_URL", None)
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} case(s): {', '.join(failures)}")
        return 1
    print("SELF-TEST PASSED -- both directions of drift are caught independently,")
    print("                    together, and every CANNOT-CHECK gate is exit 2.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the guard fires on both directions of drift, offline",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    repo = pathlib.Path(__file__).resolve().parent.parent
    return run(repo)


if __name__ == "__main__":
    sys.exit(main())
