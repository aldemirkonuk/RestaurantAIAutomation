#!/usr/bin/env python3
"""Guard: schema lives in exactly one place -- supabase/migrations/.

WHY THIS EXISTS
---------------
This is the other half of scripts/check_queried_tables_exist.py, and it guards
the cause rather than the symptom. On 2026-08-26, five tables were found that
the code queries and production does not have. In every case the CREATE TABLE
existed -- in `supabase/migrations_archive/` or
`services/database/migrations_archive/`, directories `supabase db push` has
never looked at. The migration was written, reviewed, committed, and never
applied, and nothing anywhere said so.

The repository has SIX places that hold SQL, and only one of them is wired to
anything (counts measured 2026-08-26):

  supabase/migrations/                  the one home. Applied by `supabase db push`.
  supabase/migrations_archive/          105 files. Never applied.
  services/database/migrations_archive/ 16 files. Never applied.
  Supabase_SQL_Files/                   8 files named SQL_editor1..6 -- literally
                                        DDL someone pasted into the Supabase SQL
                                        editor and then committed. This is the
                                        mechanism that produced the 27 tables,
                                        403 columns and 13 functions the
                                        2026-08-05 baseline had to absorb.
  md/02-architecture/                   a DATABASE_SCHEMA.sql, a
                                        SCHEMA_MIGRATION_ADDITIONS.sql, a cron
                                        setup, and a migrations/ subdirectory
                                        with one numbered migration in it.
  md_files/02-architecture/             a second copy of DATABASE_SCHEMA.sql.

WHAT THIS CHECKS
----------------
1. INVENTORY. Every .sql file outside supabase/migrations/ must be listed in
   scripts/sql_outside_migrations.txt. A NEW one fails: writing a migration
   into an archive, or into a new seventh directory, is the defect. A listed
   file that has been deleted also fails, so the inventory shrinks as the
   archives are cleaned up rather than rotting into a list nobody reads.

   The inventory is regenerated with --update. That is not a way to neuter the
   guard: the accept step is a diff of a committed file, reviewed in the pull
   request that adds the line.

   Filtering to files that contain DDL was measured and rejected: of the 136
   .sql files outside the one home, 130 contain DDL, so the filter buys almost
   nothing and would wave through a data migration that only DELETEs or UPDATEs.

2. SOLE DEFINITION -- the rule the brief asked for. A file outside
   supabase/migrations/ may not be the ONLY definition of a relation the live
   code queries. If the live directory also defines it, the outside copy is
   superseded history and is fine. If it does not, the outside copy is the only
   source, it was never applied, and the query fails in production. That set is
   the defect class exactly.

3. COLUMN CENSUS -- REPORTS, DOES NOT BLOCK. See below.

  ./scripts/check_migrations_single_home.py
  ./scripts/check_migrations_single_home.py --update   # regenerate the inventory

Exit 0 = pass.  Exit 1 = violation.  Exit 2 = could not check (see below).

THE COLUMN CENSUS, AND WHY IT ONLY REPORTS
------------------------------------------
Check 2 is silent on the `restaurant_feature_flags` instance, and this is the
one blind spot worth stating twice. Both the live directory and an archive
define that table, so it is "reconciled" as far as check 2 is concerned. What
differed was its SHAPE: production is EAV (`flag_name` varchar + `enabled`
boolean) and services/database/migrations_archive/011_add_restaurant_feature_flags.sql
declares 22 `enable_*` boolean columns. Two different data models under one
name. Every toggle was inert at the database, and `enable_ai_negotiation` could
not be turned OFF, because the failed read fell back to "enabled".

A column-level comparison DOES see it. Measured 2026-08-26,
restaurant_feature_flags ranks FIRST of 25 tables at +22 archive-only columns.
(An earlier draft of this guard rejected column-level checking as noise. That
rejection was wrong, and the reason is instructive: its probe stopped at the
first archive file defining a name, so 011 was never compared, and it counted
`UNIQUE(a, b)` as a column named `unique(a,`. With both bugs fixed the signal
is clean and the real instance is at the top.)

It reports rather than blocks because most of the other 24 entries are
legitimate history -- pre-baseline columns that were dropped or renamed on
purpose -- and a shrink-only list that cannot shrink is a list people learn to
skip. Whether this should become a blocking ratchet is a decision for the
founder, not for this script: see the open question in
.planning/04-specs/HANDOFF-schema-guard.md.

WHAT THIS DOES NOT CATCH
------------------------
* DDL that was never committed anywhere at all. Nothing in the repository can
  see that; only check_queried_tables_exist.py --against-production can.
* A table whose archived and live definitions differ in a column TYPE or a NOT
  NULL rather than in the set of column names. The census compares name sets.
"""

from __future__ import annotations

import argparse
import importlib.util
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
LIVE_HOME = "supabase/migrations"
INVENTORY = REPO / "scripts/sql_outside_migrations.txt"

SKIP_DIRS = {".git", "node_modules", ".turbo", "dist", "build", ".next", "venv", "__pycache__"}

# Sanity floor: the inventory described 136 files when this guard was written.
# If a scan returns a handful, the walk is looking at the wrong tree and every
# file would read as "deleted".
MIN_SCANNED = 50

# ---------------------------------------------------------------------------
# SOLE_DEFINITION_DEBT -- shrink-only, same posture as KNOWN_MISSING in
# check_queried_tables_exist.py and PY_UNLOGGED_DEBT in
# check_model_calls_logged.sh.
#
# Each of these is a relation the live code queries whose ONLY definition in
# this repository is a file outside supabase/migrations/. Recorded so the guard
# is green on arrival and can therefore block the ninth.
#
# The fix for an entry is always the same: move the CREATE into
# supabase/migrations/ under a version past everything on main, push it, and
# delete the line. Copying the archived file verbatim is wrong -- pick the
# version that matches what the code actually expects. restaurant_feature_flags
# is the cautionary tale: two definitions, 7 columns and 22, and the applied one
# was not the one the service was written against.
# ---------------------------------------------------------------------------
SOLE_DEFINITION_DEBT: dict[str, str] = {
    "notification_logs": "supabase/migrations_archive/20260208024921_baseline_schema.sql",
    "pos_webhook_logs": "supabase/migrations_archive/20260208024921_baseline_schema.sql",
    "provider_important_dates": "supabase/migrations_archive/20260208024921_baseline_schema.sql",
    "provider_ratings": "supabase/migrations_archive/20260208024921_baseline_schema.sql",
    "push_subscriptions": "supabase/migrations_archive/20260208024921_baseline_schema.sql",
    "scheduled_reports": "supabase/migrations_archive/20260208024921_baseline_schema.sql",
}


def load_extractor():
    """Reuse the extraction and SQL parsing from the sibling guard.

    One implementation of "what does the code query" and one of "what does a
    migration declare". Two copies would drift, and a guard that disagrees with
    its own sibling teaches people to believe neither.
    """
    path = REPO / "scripts/check_queried_tables_exist.py"
    if not path.is_file():
        print(f"FAIL (exit 2): {path} is missing. This guard has nothing to reuse.")
        raise SystemExit(2)
    spec = importlib.util.spec_from_file_location("check_queried_tables_exist", path)
    mod = importlib.util.module_from_spec(spec)
    # Registered before exec: @dataclass resolves annotations through sys.modules.
    sys.modules["check_queried_tables_exist"] = mod
    spec.loader.exec_module(mod)
    return mod


def scan_sql_outside() -> list[str]:
    out: list[str] = []
    live = REPO / LIVE_HOME
    for f in REPO.rglob("*.sql"):
        if any(part in SKIP_DIRS for part in f.parts):
            continue
        try:
            f.relative_to(live)
            continue  # inside the one home, including its seed/ subdirectory
        except ValueError:
            pass
        out.append(str(f.relative_to(REPO)))
    return sorted(out)


# ---------------------------------------------------------------------------
# Column extraction, for the census only
# ---------------------------------------------------------------------------
# Table-level constraint clauses are not columns. Matched after splitting the
# first token on "(" as well as whitespace, so `UNIQUE(a, b)` reduces to
# `unique` rather than to a column named `unique(a,`.
CONSTRAINT_KEYWORDS = {
    "primary",
    "foreign",
    "unique",
    "check",
    "constraint",
    "exclude",
    "like",
    "partition",
    "inherits",
    "with",
    "on",
    "tablespace",
    "period",
}

ADD_COLUMN_RE = re.compile(
    r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:\"?public\"?\.)?\"?([a-z_][a-z0-9_]*)\"?"
    r"\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?([a-z_][a-z0-9_]*)\"?",
    re.I,
)


def _first_token(clause: str) -> str:
    parts = clause.split()
    if not parts:
        return ""
    return re.split(r"[(\s]", parts[0].strip('"'), maxsplit=1)[0].lower()


def columns_of(text: str, table: str, create_table_re) -> set[str] | None:
    """Union of the columns every `CREATE TABLE <table>` in `text` declares.

    None means the text does not define the table at all -- distinct from "it
    defines it with no columns", which would make a diff look clean.
    """
    found: set[str] = set()
    seen = False
    for m in create_table_re.finditer(text):
        if m.group(1).lower() != table:
            continue
        open_paren = text.find("(", m.end())
        if open_paren < 0:
            continue
        depth = 0
        close = open_paren
        for i in range(open_paren, len(text)):
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
                if depth == 0:
                    close = i
                    break
        clauses: list[str] = []
        depth = 0
        cur = ""
        for ch in text[open_paren + 1 : close]:
            if ch == "(":
                depth += 1
            if ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                clauses.append(cur.strip())
                cur = ""
            else:
                cur += ch
        clauses.append(cur.strip())
        seen = True
        for c in clauses:
            tok = _first_token(c)
            if tok and tok not in CONSTRAINT_KEYWORDS:
                found.add(tok)
    return found if seen else None


def column_census(g, outside_files: list[str], queried: set[str]) -> list[tuple[str, str, list[str]]]:
    """(table, outside_file, columns the outside file has and the live home lacks)."""
    live_text = "\n".join(
        g.strip_sql_comments(f.read_text(encoding="utf-8", errors="replace"))
        for f in sorted((REPO / LIVE_HOME).glob("*.sql"))
    )
    live_added: dict[str, set[str]] = {}
    for m in ADD_COLUMN_RE.finditer(live_text):
        live_added.setdefault(m.group(1).lower(), set()).add(m.group(2).lower())

    rows: list[tuple[str, str, list[str]]] = []
    for rel_path in outside_files:
        f = REPO / rel_path
        try:
            text = g.strip_sql_comments(f.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        names = {m.group(1).lower() for m in g.CREATE_TABLE_RE.finditer(text)}
        for name in sorted(names & queried):
            outside_cols = columns_of(text, name, g.CREATE_TABLE_RE)
            live_cols = columns_of(live_text, name, g.CREATE_TABLE_RE)
            if not outside_cols or live_cols is None:
                continue
            extra = outside_cols - (live_cols | live_added.get(name, set()))
            if extra:
                rows.append((name, rel_path, sorted(extra)))
    rows.sort(key=lambda r: (-len(r[2]), r[0]))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--update",
        action="store_true",
        help="regenerate scripts/sql_outside_migrations.txt from the tree",
    )
    args = ap.parse_args()

    fail = 0
    blocked: list[str] = []

    found = scan_sql_outside()
    if len(found) < MIN_SCANNED:
        blocked.append(
            f"only {len(found)} .sql file(s) found outside {LIVE_HOME}, below the "
            f"{MIN_SCANNED} floor. The walk is looking at the wrong tree."
        )

    if args.update:
        INVENTORY.write_text(
            "# Every .sql file in this repository that is NOT in supabase/migrations/.\n"
            "# Regenerate with: ./scripts/check_migrations_single_home.py --update\n"
            "# A new line here is a migration written somewhere it will never be\n"
            "# applied. The review of that decision is the review of this diff.\n"
            + "\n".join(found)
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {INVENTORY.relative_to(REPO)} with {len(found)} entries.")
        return 0

    # --- check 1: inventory ------------------------------------------------
    print(f"== SQL files outside {LIVE_HOME}: {len(found)}")
    by_dir: dict[str, int] = {}
    for p in found:
        parent = str(pathlib.PurePath(p).parent)
        by_dir[parent] = by_dir.get(parent, 0) + 1
    for d, n in sorted(by_dir.items(), key=lambda kv: -kv[1]):
        print(f"   {n:4d}  {d}/")

    if not INVENTORY.is_file():
        blocked.append(
            f"{INVENTORY.relative_to(REPO)} does not exist. Without it this guard "
            f"has no baseline and cannot tell a new migration from an old one. "
            f"Create it with --update."
        )
        recorded: set[str] = set()
    else:
        recorded = {
            line.strip()
            for line in INVENTORY.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        }

    added = sorted(set(found) - recorded)
    removed = sorted(recorded - set(found))

    if added and INVENTORY.is_file():
        fail = 1
        print()
        print(f"FAIL: {len(added)} .sql file(s) appeared outside {LIVE_HOME}:")
        for p in added:
            print(f"     {p}")
        print()
        print(f"   -> If it is a migration, it belongs in {LIVE_HOME}/ under a version")
        print("      past everything on main, and it needs `supabase db push`. Anywhere")
        print("      else and it will be reviewed, merged, and never applied -- which is")
        print("      the defect this guard exists for.")
        print("   -> If it genuinely is not a migration (a fixture, a documented example),")
        print("      run --update and let the added line be reviewed in the PR.")

    if removed and INVENTORY.is_file():
        fail = 1
        print()
        print(f"FAIL: {len(removed)} inventoried file(s) no longer exist:")
        for p in removed:
            print(f"     {p}")
        print("   -> Run --update. An inventory that lists files that are gone stops")
        print("      being a baseline and becomes a list nobody trusts.")

    # --- check 2: sole definition -----------------------------------------
    g = load_extractor()
    ex = g.extract(REPO)
    queried = ex.tables()
    if not queried:
        blocked.append("the extractor found zero queried relations -- see its own vacuity rules")
    live_declared, _live_fns, nfiles = g.declared_relations(REPO / LIVE_HOME)
    if nfiles and len(live_declared) < g.MIN_DECLARED:
        blocked.append(
            f"only {len(live_declared)} relations parsed from {LIVE_HOME} -- the SQL "
            f"patterns have rotted, so 'the live directory also declares it' cannot be trusted"
        )

    sole: dict[str, str] = {}
    reconciled = 0
    for rel_path in found:
        f = REPO / rel_path
        try:
            text = g.strip_sql_comments(f.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        defined = set()
        for m in g.CREATE_TABLE_RE.finditer(text):
            defined.add(m.group(1).lower())
        for m in g.CREATE_VIEW_RE.finditer(text):
            defined.add(m.group(1).lower())
        for name in defined & queried:
            if name in live_declared:
                reconciled += 1
            else:
                sole.setdefault(name, rel_path)

    print()
    print(f"== relations the code queries that are defined outside {LIVE_HOME}")
    print(f"   {reconciled} definition(s) are superseded -- {LIVE_HOME} declares them too")
    print(f"   {len(sole)} relation(s) have their ONLY definition outside it")

    new_sole = {k: v for k, v in sole.items() if k not in SOLE_DEFINITION_DEBT}
    debt_sole = {k: v for k, v in sole.items() if k in SOLE_DEFINITION_DEBT}

    if debt_sole:
        print()
        print("   KNOWN DEBT -- written, committed, never applied. Not approved, tracked:")
        for name, path in sorted(debt_sole.items()):
            print(f"     {name:34s} {path}")

    if new_sole:
        fail = 1
        print()
        print(f"FAIL: {len(new_sole)} relation(s) the code queries are defined ONLY outside")
        print(f"      {LIVE_HOME}:")
        for name, path in sorted(new_sole.items()):
            print(f"     {name:34s} {path}")
        print()
        print(f"   -> Move the CREATE into {LIVE_HOME}/ under a version past everything on")
        print("      main, and push it. Do not copy the archived file blindly: pick the")
        print("      definition the code actually expects. restaurant_feature_flags is the")
        print("      cautionary tale -- two definitions, 7 columns and 22, and the applied")
        print("      one was not the one the service was written against.")
        print("   -> Do NOT add it to SOLE_DEFINITION_DEBT. That list is shrink-only.")

    # ratchet: an entry that is fixed, or that nothing queries any more
    for name in SOLE_DEFINITION_DEBT:
        if name in live_declared:
            fail = 1
            print()
            print(f"FAIL: '{name}' is on the debt list but {LIVE_HOME} now declares it.")
            print("   -> Delete the entry.")
        elif name not in queried:
            fail = 1
            print()
            print(f"FAIL: '{name}' is on the debt list but no code queries it any more.")
            print("   -> Delete the entry. The list must describe what is actually true.")

    # --- check 3: column census (reports, does not block) ------------------
    census = column_census(g, found, queried)
    print()
    print("== COLUMN CENSUS -- reports, does not block (see the module docstring)")
    print(
        f"   {len(census)} (table, outside-file) pair(s) across "
        f"{len({r[0] for r in census})} code-queried table(s) declare a column that"
    )
    print(f"   {LIVE_HOME} does not. This is the granularity at which the")
    print("   restaurant_feature_flags instance is visible, and only this one.")
    for name, path, extra in census[:8]:
        print(f"     {name:32s} +{len(extra):3d}  {path}")
    if len(census) > 8:
        print(f"     ...  and {len(census) - 8} more pair(s)")
    if not census:
        print("   (nothing -- if that is a surprise, the column parse has rotted)")

    print()
    if blocked:
        print("BLOCKED: this guard could not check what it claims to check.")
        for b in blocked:
            print(f"   * {b}")
        print()
        print("FAIL (exit 2) -- not reported as a pass. A check that goes green because")
        print("       it found nothing to inspect is the shape of the defect it guards.")
        return 2
    if fail:
        print("FAIL (exit 1) -- schema is defined somewhere it will never be applied.")
        return 1
    print(f"PASS -- {LIVE_HOME}/ is the only home for schema, or the exception is on the")
    print(f"       shrink-only debt list ({len(SOLE_DEFINITION_DEBT)} entries).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
