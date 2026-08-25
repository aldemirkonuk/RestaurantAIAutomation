#!/usr/bin/env python3
"""Bidirectional drift check: supabase/migrations/ vs production's ledger.

Why this exists
---------------
On 2026-08-25 the two had drifted in BOTH directions at once (ADR 0013):

  * 4 migration files had been applied by hand and never registered, so
    ``pnpm db:drift`` (``supabase migration list --linked``) reported four live
    migrations as pending;
  * 1 migration had been applied through the Supabase dashboard and had no file
    in the repo at all, so the repo was not a complete record of the schema.

``db:drift`` only ever surfaces the first direction, and only as "pending" — a
word that reads like "not yet applied" when it in fact meant "applied, but the
ledger never heard about it". Three of the four were ``if not exists``-guarded,
so a push would have replayed them silently and the drift would have compounded
instead of surfacing. This script names both directions and exits non-zero.

It never mutates anything, and it never prints the DSN — that string carries
credentials (same rule as scripts/check_db_reachable.sh).

Usage:  python3 scripts/check_migration_ledger.py [--quiet]
Exit:   0 = in sync, 1 = drift, 2 = could not check
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
ENV_FILE = REPO_ROOT / ".env"
DSN_KEYS = (
    "SUPABASE_DB_URL",
    "SUPABASE_POOLER_URL",
    "SUPABASE_POOLER_CONNECTION_STRING",
    "SUPABASE_DIRECT_CONNECTION_STRING",
)


def resolve_dsn() -> str | None:
    """Environment first (CI), then .env (local). Never logged."""
    for key in DSN_KEYS:
        if os.environ.get(key):
            return os.environ[key]
    if not ENV_FILE.exists():
        return None
    pattern = re.compile(rf"\s*(?:export\s+)?({'|'.join(DSN_KEYS)})\s*=\s*(.+)")
    for line in ENV_FILE.read_text().splitlines():
        m = pattern.match(line)
        if m:
            return m.group(2).strip().strip('"').strip("'")
    return None


def repo_migrations() -> dict[str, str]:
    """version -> name, parsed from `<version>_<name>.sql`."""
    out: dict[str, str] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        version, _, name = path.stem.partition("_")
        if version.isdigit():
            out[version] = name
    return out


def main() -> int:
    quiet = "--quiet" in sys.argv
    dsn = resolve_dsn()
    if not dsn:
        print("::error::No database connection string set — cannot check the ledger.")
        print(f"::error::Set one of: {', '.join(DSN_KEYS)}")
        return 2

    try:
        import psycopg2
    except ImportError:
        print("::error::psycopg2 is required for this check.")
        return 2

    try:
        conn = psycopg2.connect(dsn)
        conn.set_session(readonly=True)
        cur = conn.cursor()
        cur.execute(
            "select version, name from supabase_migrations.schema_migrations"
        )
        ledger = {row[0]: row[1] for row in cur.fetchall()}
        conn.rollback()
        conn.close()
    except Exception as exc:  # noqa: BLE001 — the message is the whole point
        print(f"::error::Could not read the migration ledger: {exc}")
        print("::error::If this says 'Network is unreachable', see check_db_reachable.sh")
        return 2

    files = repo_migrations()
    unregistered = sorted(set(files) - set(ledger))
    unrecorded = sorted(set(ledger) - set(files))

    if not quiet:
        print(f"repo migrations: {len(files)}   ledger rows: {len(ledger)}")

    if unregistered:
        print(f"::error::{len(unregistered)} migration(s) in the repo are NOT in the "
              "ledger — applied by hand, or never applied at all:")
        for version in unregistered:
            print(f"::error::  {version}_{files[version]}.sql")
        print("::error::Fix: apply via `supabase db push`, or register the row if it "
              "is already live. Do not assume 'pending' means 'not applied'.")

    if unrecorded:
        print(f"::error::{len(unrecorded)} migration(s) ran in production with NO file "
              "in supabase/migrations/ — applied through the dashboard:")
        for version in unrecorded:
            print(f"::error::  {version}  ({ledger[version] or 'unnamed'})")
        print("::error::Fix: recover the SQL from schema_migrations.statements into a "
              "migration file, so the repo is a complete record of the schema.")

    if unregistered or unrecorded:
        return 1
    if not quiet:
        print("Migration ledger and supabase/migrations/ agree in both directions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
