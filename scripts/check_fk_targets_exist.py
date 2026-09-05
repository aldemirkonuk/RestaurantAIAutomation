#!/usr/bin/env python3
"""Guard: a foreign key names a table that exists at the point it is written.

WHY THIS EXISTS
---------------
On 2026-09-04, commit 29e439c4 shipped

    supabase/migrations/20260904230000_a_tool_the_house_has_seen_before.sql:52
        REFERENCES public.user_mcp_connections(id) ON DELETE CASCADE

against a table that an EARLIER migration had already renamed away:

    supabase/migrations/20260903151000_the_house_declares_a_person_consents.sql:63
        ALTER TABLE public.user_mcp_connections
          RENAME TO restaurant_mcp_connections;

`supabase db reset` would have stopped on that file with `42P01 relation
"public.user_mcp_connections" does not exist`, taking the whole migration set
with it. It was fixed in 88d7b5a8 before it could reach main.

WHY NOTHING ALREADY CAUGHT IT
-----------------------------
Measured on 2026-09-04 against a temp tree holding the PRE-FIX file
(`git show 29e439c4:...` in place of the fixed one):

    scripts/check_queried_tables_exist.py            exit 0  (PASS)
    scripts/check_fk_repoint_by_referenced_column.py exit 0  (OK)

Neither is blind by accident; each is looking at a different thing.

  * check_queried_tables_exist reads TypeScript and Python call sites
    (`TS_ROOTS` / `PY_ROOTS`, its lines 180-192) and asks whether the relations
    the CODE queries are DECLARED by supabase/migrations. A foreign key is not
    a call site, and `grep -c REFERENCES scripts/check_queried_tables_exist.py`
    is 0: the string does not occur in it at all. The TypeScript side of this
    very defect had already been corrected before the commit; only the SQL was
    wrong, so its corner of the triangle was clean.

  * check_fk_repoint_by_referenced_column reads SQL, but for one shape:
    `unnest(conkey)` without `confkey`. Its four `REFERENCES` occurrences
    (lines 322, 355, 432, 438) are all inside its own self-test fixtures.

  * schema-parity.yml WOULD have gone red -- it runs `supabase db reset` and is
    a required status. But it runs after a push, on a runner, and it reports as
    a red pull request rather than as a red file: it names the migration that
    failed to apply, not the rename that made it fail, and it costs a full CI
    round trip to learn it. This guard is the same fact, before the push, in a
    second, naming both halves.

WHAT THIS PARSES
----------------
Every `supabase/migrations/*.sql`, in filename order (which is the order the
Supabase CLI applies them). Comments (`--` and nestable `/* */`) are blanked
first, preserving offsets; single-quoted strings are blanked too. Dollar-quoted
bodies (`$$ ... $$`, `$fn$ ... $fn$`) are NOT blanked -- the rename that caused
this defect lives inside a `DO $$` block, and a guard that skipped those would
have been green on the very file it exists for.

Then, in positional order across each file, these events:

    CREATE [TEMP|UNLOGGED|...] TABLE [IF NOT EXISTS] <name>   adds <name>
    ALTER TABLE [IF EXISTS] [ONLY] <name> RENAME TO <new>     removes <name>,
                                                              adds <new>
    DROP TABLE [IF EXISTS] <name>[, <name>...]                removes each
    CREATE [OR REPLACE] [MATERIALIZED] VIEW <name>            records a VIEW
    REFERENCES <name>                                          must resolve

Names may be schema-qualified or bare (bare resolves to `public`, which is what
these migrations run under) and may be double-quoted. A `REFERENCES` inside the
`CREATE TABLE` that defines its own target resolves, because events are ordered
by position and the CREATE comes first.

WHAT IT REFUSES TO PARSE (exit 2, never a pass)
-----------------------------------------------
  * An unterminated block comment, dollar-quote or single-quoted string.
  * DYNAMIC DDL: a single-quoted string containing `CREATE ... TABLE`,
    `ALTER TABLE ... RENAME TO`, `DROP TABLE`, or the foreign-key shape
    `REFERENCES <name>(`. `EXECUTE format('CREATE TABLE ...')` is a table this
    guard's model would never learn about, so every later FK would be judged
    against a schema missing it. Those four and no more: a bare `references`
    is an RFC-822 header the baseline reads out of jsonb
    (20260805000000_baseline_from_production.sql:455), and a bare `alter table`
    is OD-73 enabling RLS in a loop
    (20260825200000_od73_close_anon_dml.sql:273). Refusing on either would
    refuse to check the whole corpus. Measured 2026-09-04: the corpus has 19
    `EXECUTE format` sites and every one builds an UPDATE, a REVOKE or an
    ALTER VIEW, so this arm is currently silent -- it is here so that the first
    one that is not stops the guard instead of quietly shrinking its universe.
  * A corpus with zero `REFERENCES` in it. That is the extraction having rotted,
    not a schema without foreign keys, and it must not read as health
    (the "absence reported as health" rule).

WHAT IT CANNOT SEE
------------------
  * A CONDITIONAL rename or drop is treated as TAKEN. `20260903151000` wraps
    its rename in `IF to_regclass(...) IS NOT NULL THEN`; on a fresh reset that
    branch fires, which is the case that matters. A guard that also modelled
    the branch not firing would have to model the database, which is
    schema-parity.yml's job.
  * A table dropped by a LATER migration than the FK that references it. That
    is the mirror defect and a different guard: this one walks forward and asks
    only "did the target exist when this line was written".
  * COLUMNS. `REFERENCES public.restaurants(id)` is checked for `restaurants`,
    not for `id`. check_read_columns_exist.py is the column-level guard for
    reads; there is no column-level guard for foreign keys.
  * Schemas this repo does not create: auth, storage, extensions, cron, net,
    vault, realtime, graphql, pgsodium, supabase_functions. Four FKs point at
    `auth.users`. They are SKIPPED and counted here, not blessed -- an actor
    FK to auth.users is its own live defect (auth.users and public.users hold
    disjoint ids), and it needs a guard that knows about ids, not about names.

  ./scripts/check_fk_targets_exist.py
  ./scripts/check_fk_targets_exist.py --migrations-dir <path>
  ./scripts/check_fk_targets_exist.py --verbose
  ./scripts/check_fk_targets_exist.py --self-test

Exit 0 = pass.  Exit 1 = a foreign key names a table that does not exist yet.
Exit 2 = the guard could not check what it claims to check.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
import tempfile
from dataclasses import dataclass, field

MIGRATIONS_DIR = "supabase/migrations"

# Schemas this repository does not create and cannot reason about by name.
EXTERNAL_SCHEMAS = {
    "auth",
    "storage",
    "extensions",
    "cron",
    "net",
    "vault",
    "realtime",
    "graphql",
    "graphql_public",
    "pgsodium",
    "pgsodium_masks",
    "supabase_functions",
    "supabase_migrations",
    "information_schema",
    "pg_catalog",
    "topology",
    "tiger",
}

_IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
_QNAME = rf"{_IDENT}(?:\s*\.\s*{_IDENT})?"

RE_CREATE_TABLE = re.compile(
    r"\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?"
    r"(?:(?:TEMPORARY|TEMP|UNLOGGED|FOREIGN)\s+)?"
    rf"TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?({_QNAME})",
    re.IGNORECASE,
)
RE_CREATE_VIEW = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?"
    rf"VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?({_QNAME})",
    re.IGNORECASE,
)
RE_RENAME = re.compile(
    rf"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?({_QNAME})\s+RENAME\s+TO\s+({_IDENT})",
    re.IGNORECASE,
)
RE_DROP = re.compile(
    rf"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?({_QNAME}(?:\s*,\s*{_QNAME})*)",
    re.IGNORECASE,
)
# (?<!") so a column literally named "references" is not read as the keyword.
RE_REFERENCES = re.compile(rf'(?<!")\bREFERENCES\s+({_QNAME})', re.IGNORECASE)

# Only the four statements that could change this guard's model of the schema
# count as DDL hiding in a string. Two near misses in the corpus prove why the
# broader shapes are wrong:
#   * the BARE word `references` -- the baseline reads the RFC-822 header
#     `p_email_headers ->> 'references'` at
#     20260805000000_baseline_from_production.sql:455;
#   * a BARE `alter table` -- OD-73 enables RLS through
#     `execute format('alter table public.%I enable row level security', t)` at
#     20260825200000_od73_close_anon_dml.sql:273. That changes a table's
#     security, never its name, so the model is untouched.
# Refusing on either would have refused to check the entire corpus.
RE_DDL_IN_STRING = re.compile(
    r"\bCREATE\s+(?:[A-Za-z]+\s+)?TABLE\b"
    r"|\bALTER\s+TABLE\b.{0,200}?\bRENAME\s+TO\b"
    r"|\bDROP\s+TABLE\b"
    rf"|\bREFERENCES\s+{_QNAME}\s*\(",
    re.IGNORECASE | re.DOTALL,
)


class CannotCheck(Exception):
    """The guard could not read what it claims to read. Exit 2, never exit 0."""


def normalise(raw: str) -> str:
    """`Public."Foo"` -> `public.Foo`; bare `foo` -> `public.foo`."""
    parts = [p.strip() for p in raw.split(".")]
    cleaned = []
    for p in parts:
        p = p.strip()
        if p.startswith('"') and p.endswith('"') and len(p) >= 2:
            cleaned.append(p[1:-1])          # quoted: case preserved
        else:
            cleaned.append(p.lower())        # unquoted: Postgres folds to lower
    if len(cleaned) == 1:
        return f"public.{cleaned[0]}"
    return f"{cleaned[0].lower()}.{cleaned[1]}"


def blank_noncode(text: str, where: str) -> str:
    """Replace comments and single-quoted strings with spaces, offsets intact.

    Dollar-quoted bodies survive: a `DO $$ ... $$` block holds real DDL.
    Raises CannotCheck on an unterminated construct or on dynamic DDL.
    """
    out = list(text)
    i = 0
    n = len(text)
    dq_stack: list[tuple[str, int]] = []

    def blank(a: int, b: int) -> None:
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if ch == "-" and nxt == "-":
            j = text.find("\n", i)
            j = n if j == -1 else j
            blank(i, j)
            i = j
            continue

        if ch == "/" and nxt == "*":
            depth = 1
            j = i + 2
            while j < n and depth:
                if text[j] == "/" and j + 1 < n and text[j + 1] == "*":
                    depth += 1
                    j += 2
                elif text[j] == "*" and j + 1 < n and text[j + 1] == "/":
                    depth -= 1
                    j += 2
                else:
                    j += 1
            if depth:
                raise CannotCheck(f"{where}: unterminated /* block comment")
            blank(i, j)
            i = j
            continue

        if ch == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            if j >= n:
                raise CannotCheck(f"{where}: unterminated single-quoted string")
            body = text[i + 1 : j]
            hit = RE_DDL_IN_STRING.search(body)
            if hit:
                line = text.count("\n", 0, i) + 1
                raise CannotCheck(
                    f"{where}:{line}: dynamic DDL -- a quoted string contains "
                    f"'{hit.group(0)}'. This guard models the schema by reading "
                    f"static DDL; a table built or repointed at runtime is a "
                    f"table it would never learn about, so every later foreign "
                    f"key would be judged against an incomplete schema. Teach "
                    f"the guard the statement, or hoist it out of the string."
                )
            blank(i, j + 1)
            i = j + 1
            continue

        if ch == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", text[i:])
            if m:
                # Keep the BODY (a `DO $$` block holds real DDL); blank only the
                # delimiters, so the tag cannot be read as an identifier. A stack
                # rather than a find(), so scanning continues INSIDE the body and
                # its own comments and strings are handled there too.
                tag = m.group(0)
                if dq_stack and dq_stack[-1][0] == tag:
                    dq_stack.pop()
                else:
                    dq_stack.append((tag, i))
                blank(i, i + len(tag))
                i += len(tag)
                continue

        i += 1

    if dq_stack:
        tag, pos = dq_stack[-1]
        line = text.count("\n", 0, pos) + 1
        raise CannotCheck(f"{where}:{line}: unterminated dollar-quote {tag}")

    return "".join(out)


@dataclass
class Origin:
    file: str
    line: int
    how: str          # "renamed to X" / "dropped"

    def __str__(self) -> str:
        return f"{self.file}:{self.line} ({self.how})"


@dataclass
class Report:
    files: int = 0
    creates: int = 0
    renames: int = 0
    drops: int = 0
    views: int = 0
    fks_checked: int = 0
    fks_external: int = 0
    failures: list[str] = field(default_factory=list)
    detail: list[str] = field(default_factory=list)


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def walk(migrations: pathlib.Path, label: str) -> Report:
    if not migrations.is_dir():
        raise CannotCheck(f"'{migrations}' is not a directory -- nothing to check")
    files = sorted(p for p in migrations.glob("*.sql"))
    if not files:
        raise CannotCheck(f"'{migrations}' holds no .sql files -- nothing to check")

    rep = Report(files=len(files))
    tables: set[str] = set()
    views: set[str] = set()
    gone: dict[str, Origin] = {}

    for path in files:
        rel = f"{label}/{path.name}"
        raw = path.read_text(encoding="utf-8", errors="replace")
        code = blank_noncode(raw, rel)

        events: list[tuple[int, str, tuple]] = []
        for m in RE_CREATE_TABLE.finditer(code):
            events.append((m.start(), "create", (normalise(m.group(1)),)))
        for m in RE_CREATE_VIEW.finditer(code):
            events.append((m.start(), "view", (normalise(m.group(1)),)))
        for m in RE_RENAME.finditer(code):
            old = normalise(m.group(1))
            schema = old.split(".", 1)[0]
            new = normalise(m.group(2))
            if "." not in m.group(2):
                new = f"{schema}.{new.split('.', 1)[1]}"
            events.append((m.start(), "rename", (old, new, line_of(code, m.start()))))
        for m in RE_DROP.finditer(code):
            names = [normalise(x) for x in m.group(1).split(",")]
            events.append((m.start(), "drop", (names, line_of(code, m.start()))))
        for m in RE_REFERENCES.finditer(code):
            events.append((m.start(), "fk", (normalise(m.group(1)), line_of(code, m.start()))))

        events.sort(key=lambda e: e[0])

        for _pos, kind, args in events:
            if kind == "create":
                tables.add(args[0])
                gone.pop(args[0], None)
                rep.creates += 1
            elif kind == "view":
                views.add(args[0])
                rep.views += 1
            elif kind == "rename":
                old, new, ln = args
                tables.discard(old)
                tables.add(new)
                gone[old] = Origin(rel, ln, f"renamed to {new.split('.', 1)[1]}")
                gone.pop(new, None)
                rep.renames += 1
            elif kind == "drop":
                names, ln = args
                for nm in names:
                    tables.discard(nm)
                    gone[nm] = Origin(rel, ln, "dropped")
                rep.drops += 1
            elif kind == "fk":
                target, ln = args
                schema = target.split(".", 1)[0]
                if schema in EXTERNAL_SCHEMAS:
                    rep.fks_external += 1
                    continue
                rep.fks_checked += 1
                if target in tables:
                    continue
                why = gone.get(target)
                if why is not None:
                    rep.failures.append(
                        f"{rel}:{ln}: REFERENCES {target} -- removed by {why}"
                    )
                elif target in views:
                    rep.failures.append(
                        f"{rel}:{ln}: REFERENCES {target} -- that name is a VIEW, "
                        f"and a foreign key cannot reference a view"
                    )
                else:
                    rep.failures.append(
                        f"{rel}:{ln}: REFERENCES {target} -- no migration up to "
                        f"and including this one creates it"
                    )
    return rep


def render(rep: Report, verbose: bool) -> int:
    print(
        f"== {rep.files} migration file(s): {rep.creates} CREATE TABLE, "
        f"{rep.renames} RENAME TO, {rep.drops} DROP TABLE, {rep.views} view(s)."
    )
    print(
        f"== {rep.fks_checked} foreign key target(s) checked; "
        f"{rep.fks_external} skipped as external schemas "
        f"({', '.join(sorted(EXTERNAL_SCHEMAS))[:60]}...)."
    )
    if rep.fks_checked == 0:
        print(
            "CANNOT CHECK: zero foreign keys were found in the migration set. "
            "A schema with no foreign keys and an extraction that has rotted "
            "look identical from here, so this is not a pass."
        )
        return 2
    if rep.failures:
        print()
        print(f"FAIL -- {len(rep.failures)} foreign key(s) name a table that does not exist yet:")
        for f in rep.failures:
            print(f"  {f}")
        print()
        print(
            "  `supabase db reset` stops on the first of these with 42P01 and "
            "takes the whole migration set with it, so schema-parity.yml (a "
            "required status) goes red for every later file too. Point the key "
            "at the name the table has by then."
        )
        return 1
    if verbose:
        for d in rep.detail:
            print(f"   {d}")
    print()
    print(
        "PASS -- every foreign key names a table that exists at the point the "
        "migration writes it."
    )
    return 0


# --------------------------------------------------------------------------
# self-test: the guard's own failure path must fire.
# --------------------------------------------------------------------------

def self_test() -> int:
    checks: list[tuple[str, bool]] = []

    def case(name: str, files: dict[str, str], expect: str, needle: str = "") -> None:
        with tempfile.TemporaryDirectory() as d:
            base = pathlib.Path(d)
            for fn, body in files.items():
                (base / fn).write_text(body, encoding="utf-8")
            try:
                rep = walk(base, "t")
                got = "fail" if rep.failures else ("vacuous" if rep.fks_checked == 0 else "pass")
                blob = " ".join(rep.failures)
            except CannotCheck as e:
                got, blob = "cannot", str(e)
            ok = got == expect and (needle in blob if needle else True)
            checks.append((f"{name}: expected {expect}, got {got}", ok))

    good = "CREATE TABLE public.a (id uuid primary key);\n"

    case(
        "the 29e439c4 shape (rename, then a key at the old name)",
        {
            "001_a.sql": good,
            "002_rename.sql": "ALTER TABLE public.a RENAME TO b;\n",
            "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
        },
        "fail",
        "renamed to b",
    )
    case(
        "the fix (the key names the new table)",
        {
            "001_a.sql": good,
            "002_rename.sql": "ALTER TABLE public.a RENAME TO b;\n",
            "003_fk.sql": "CREATE TABLE public.c (b_id uuid REFERENCES public.b(id));\n",
        },
        "pass",
    )
    case(
        "a rename inside DO $$ is seen",
        {
            "001_a.sql": good,
            "002_rename.sql": (
                "DO $$\nBEGIN\n  IF to_regclass('public.a') IS NOT NULL THEN\n"
                "    ALTER TABLE public.a RENAME TO b;\n  END IF;\nEND\n$$;\n"
            ),
            "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
        },
        "fail",
        "renamed to b",
    )
    case(
        "a REFERENCES inside a comment is not a foreign key",
        {
            "001_a.sql": good,
            "002_c.sql": (
                "-- this column REFERENCES public.nowhere(id) one day\n"
                "/* and REFERENCES public.elsewhere(id) too */\n"
                "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n"
            ),
        },
        "pass",
    )
    case(
        "RENAME COLUMN is not RENAME TO",
        {
            "001_a.sql": good,
            "002_col.sql": "ALTER TABLE public.a RENAME COLUMN id TO a_id;\n",
            "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(a_id));\n",
        },
        "pass",
    )
    case(
        "DROP TABLE removes the target",
        {
            "001_a.sql": good,
            "002_drop.sql": "DROP TABLE IF EXISTS public.a CASCADE;\n",
            "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
        },
        "fail",
        "dropped",
    )
    case(
        "a bare name resolves to public",
        {
            "001_a.sql": "CREATE TABLE a (id uuid primary key);\n",
            "002_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES a(id));\n",
        },
        "pass",
    )
    case(
        "a self-reference inside its own CREATE TABLE resolves",
        {
            "001_a.sql": "CREATE TABLE public.a (id uuid primary key, parent uuid REFERENCES public.a(id));\n",
        },
        "pass",
    )
    case(
        "an FK to a name nothing ever created",
        {
            "001_fk.sql": "CREATE TABLE public.c (x uuid REFERENCES public.ghost(id));\n",
        },
        "fail",
        "no migration up to",
    )
    case(
        "an FK to a VIEW is named as a view",
        {
            "001_v.sql": "CREATE VIEW public.v AS SELECT 1;\n",
            "002_fk.sql": "CREATE TABLE public.c (x uuid REFERENCES public.v(id));\n",
        },
        "fail",
        "is a VIEW",
    )
    case(
        "auth.users is skipped, not blessed",
        {
            "001_fk.sql": "CREATE TABLE public.c (x uuid REFERENCES auth.users(id));\n",
        },
        "vacuous",
    )
    case(
        "the word 'references' as a string constant is not dynamic DDL",
        {
            "001_a.sql": good,
            "002_fn.sql": (
                "CREATE FUNCTION public.f() RETURNS text AS $$\n"
                "BEGIN RETURN h ->> 'references'; END\n$$ LANGUAGE plpgsql;\n"
                "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n"
            ),
        },
        "pass",
    )
    case(
        "a dynamic ALTER TABLE that only enables RLS is not a model change",
        {
            "001_a.sql": good,
            "002_rls.sql": (
                "DO $$ BEGIN\n"
                "  EXECUTE format('alter table public.%I enable row level security', 'a');\n"
                "END $$;\n"
                "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n"
            ),
        },
        "pass",
    )
    case(
        "a dynamic RENAME TO does refuse",
        {
            "001_a.sql": good,
            "002_dyn.sql": "DO $$ BEGIN EXECUTE 'alter table public.a rename to b'; END $$;\n",
        },
        "cannot",
        "dynamic DDL",
    )
    case(
        "dynamic DDL refuses to parse",
        {
            "001_dyn.sql": "DO $$ BEGIN EXECUTE 'CREATE TABLE public.z (id uuid)'; END $$;\n",
        },
        "cannot",
        "dynamic DDL",
    )
    case(
        "an unterminated dollar-quote refuses to parse",
        {"001_bad.sql": "DO $$ BEGIN NULL;\n"},
        "cannot",
        "unterminated dollar-quote",
    )
    case("an empty directory is not a pass", {}, "cannot", "no .sql files")

    bad = [c for c, ok in checks if not ok]
    for c, ok in checks:
        print(f"  {'ok  ' if ok else 'FAIL'}  {c}")
    if bad:
        print(f"\nSELF-TEST FAILED: {len(bad)} of {len(checks)} case(s).")
        return 1
    print(f"\nSELF-TEST PASSED: {len(checks)} case(s), including the 29e439c4 shape.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--migrations-dir", default=None,
                    help="directory of .sql migrations (default: supabase/migrations)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--self-test", action="store_true",
                    help="prove the guard's own failure path fires")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if args.migrations_dir:
        migrations = pathlib.Path(args.migrations_dir)
        label = migrations.as_posix()
    else:
        repo = pathlib.Path(__file__).resolve().parent.parent
        migrations = repo / MIGRATIONS_DIR
        label = MIGRATIONS_DIR

    try:
        rep = walk(migrations, label)
    except CannotCheck as e:
        print(f"CANNOT CHECK: {e}")
        print(
            "  Exit 2 is not a skip. The guard could not read what it claims to "
            "read, and a guard with nothing to look at gives the same answer as "
            "one that looked and found health."
        )
        return 2

    return render(rep, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
