#!/usr/bin/env python3
"""
Guard: every public view the migration corpus leaves behind reads as its caller.

WHY (F-532, 2026-10-09)
-----------------------
A Postgres view runs with its OWNER's rights unless it carries
`security_invoker = true`, so a view over an RLS-locked table hands the whole
table to whoever can select from the view. OD-72
(20260825210000_od72_revoke_client_grants.sql, section 2) found 16 such views
-- `inventory_lot_rollup` returned all of `inventory_lots` to the publishable
key -- and flipped them once. Nothing kept them flipped:

  * `CREATE OR REPLACE VIEW` with no WITH clause RESETS the option.
    20260902150000_lot_cost_truth.sql re-created inventory_lot_rollup and
    inventory_location_breakdown that way, a week after OD-72.
  * three views born after OD-72 never had it.

`check_new_tables_are_locked_down.py` says plainly that it never looks at
views. This is the guard it names as missing.

HOW
---
Replays supabase/migrations in version order and keeps one bit per public
view (`invoker`):

  * CREATE [OR REPLACE] VIEW <v> [WITH (...)] AS   -> bit = the WITH clause's
    security_invoker (absent = off: a replace without it resets the view);
  * ALTER VIEW <v> SET (security_invoker[=true|on]) -> on; RESET (...) -> off;
  * ALTER VIEW <v> RENAME TO <w>                    -> the bit moves;
  * DROP VIEW <v>[, ...]                            -> forgotten;
  * a CATALOG SWEEP -- a dollar-quoted block holding the format string
    `alter view public.%I set (security_invoker = true)` AND a `pg_class`
    scan (OD-72's shape) -- turns every view alive at that point on, except
    those its `relname <> '...'` predicates exclude.

Materialized views cannot take the option and are out of scope (OD-72
revoked their grants instead). Views in another schema are out of scope.
Comments are stripped and string literals blanked before matching, so prose
that says "CREATE OR REPLACE VIEW cannot reorder columns" is not a view.

EXIT CODES
----------
  0  every public view ends invoker
  1  at least one ends running as its owner -- named, with the file that left it
  2  cannot check: no migrations found, or a string literal spells view DDL
     this replay cannot follow (dynamic SQL other than the recognised sweep).
     Absence of evidence is not reported as health.

WHAT IT DOES NOT CHECK
----------------------
  * Whether the migration ran. The end state in a real database is asserted
    by 20270102500000_every_view_reads_as_its_caller.sql itself.
  * DROP TABLE ... CASCADE taking a view with it (the view stays in the model;
    that errs toward a false failure, never a false pass).
  * Grants on views. OD-72's default-privileges revoke holds that half.

`--self-test` replays synthetic corpora through main() and fails unless each
case exits as expected.
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO / "supabase" / "migrations"
FILE_RE = re.compile(r"^\d{14}_.+\.sql$")

IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
QNAME = rf"(?P<name>(?:{IDENT}\s*\.\s*)?{IDENT})"

CREATE_RE = re.compile(
    rf"\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary)\s+)?(?:recursive\s+)?view\s+"
    rf"(?:if\s+not\s+exists\s+)?{QNAME}\s*(?:\([^)]*\)\s*)?"
    rf"(?:with\s*\((?P<opts>[^)]*)\)\s*)?as\b",
    re.I,
)
ALTER_SET_RE = re.compile(
    rf"\balter\s+view\s+(?:if\s+exists\s+)?{QNAME}\s+(?P<verb>set|reset)\s*\((?P<opts>[^)]*)\)",
    re.I,
)
ALTER_RENAME_RE = re.compile(
    rf"\balter\s+view\s+(?:if\s+exists\s+)?{QNAME}\s+rename\s+to\s+(?P<new>{IDENT})",
    re.I,
)
DROP_RE = re.compile(
    rf"\bdrop\s+view\s+(?:if\s+exists\s+)?(?P<names>{IDENT}(?:\s*\.\s*{IDENT})?"
    rf"(?:\s*,\s*{IDENT}(?:\s*\.\s*{IDENT})?)*)",
    re.I,
)
SWEEP_FORMAT_RE = re.compile(
    r"alter\s+view\s+public\.%I\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)", re.I
)
VIEW_DDL_IN_STRING_RE = re.compile(r"\b(?:create\s+(?:or\s+replace\s+)?view|alter\s+view|drop\s+view)\b", re.I)
EXCLUDE_RE = re.compile(r"relname\s*<>\s*'([^']+)'", re.I)
TRUE_WORDS = {"true", "on", "1", "yes", "t", "y"}


def lex(sql: str) -> tuple[str, list[tuple[int, str]], list[tuple[int, str]]]:
    """Return (code, strings, dollar_bodies).

    `code` is the SQL with comments removed and every single-quoted literal
    blanked to '' (dollar-quoted bodies are kept, comment-stripped, since a DO
    body is code). `strings` and `dollar_bodies` carry each literal's offset in
    `code` and its raw text.
    """
    out: list[str] = []
    size = 0  # running length of "".join(out)
    strings: list[tuple[int, str]] = []
    bodies: list[tuple[int, str]] = []

    def emit(text: str) -> None:
        nonlocal size
        out.append(text)
        size += len(text)

    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            emit(" ")
        elif c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                    j += 2
                elif sql[j] == "\\" and i > 0 and sql[i - 1] in "eE":
                    j += 2
                elif sql[j] == "'":
                    break
                else:
                    j += 1
            strings.append((size, sql[i + 1 : j]))
            emit("''")
            i = j + 1
        elif c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:])
            if m and not (i > 0 and (sql[i - 1].isalnum() or sql[i - 1] == "_")):
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                j = n if j < 0 else j
                inner_code, inner_strings, _ = lex(sql[i + len(tag) : j])
                base = size + len(tag)
                bodies.append((base, sql[i + len(tag) : j]))
                strings.extend((base + off, s) for off, s in inner_strings)
                emit(tag + inner_code + tag)
                i = j + len(tag)
            else:
                emit(c)
                i += 1
        else:
            emit(c)
            i += 1
    return "".join(out), strings, bodies


def public_name(qname: str) -> str | None:
    parts = [p.strip().strip('"') for p in re.split(r"\s*\.\s*", qname.strip())]
    if len(parts) == 1:
        return parts[0].lower()
    if parts[0].lower() == "public":
        return parts[1].lower()
    return None


def invoker_from(opts: str | None) -> bool | None:
    """True/False when the option list names security_invoker, else None."""
    if not opts:
        return None
    for item in opts.split(","):
        key, _, val = item.partition("=")
        if key.strip().lower() == "security_invoker":
            return (val.strip().strip("'").lower() in TRUE_WORDS) if val.strip() else True
    return None


def replay(files: list[Path]) -> tuple[dict[str, tuple[bool, str]], list[str]]:
    views: dict[str, tuple[bool, str]] = {}
    cannot: list[str] = []
    for f in files:
        sql = f.read_text(encoding="utf-8")
        code, strings, bodies = lex(sql)
        sweeps = [off for off, body in bodies if SWEEP_FORMAT_RE.search(body) and re.search(r"\bpg_class\b", body, re.I)]
        for off, s in strings:
            if VIEW_DDL_IN_STRING_RE.search(s) and not SWEEP_FORMAT_RE.search(s):
                cannot.append(f"{f.name}: a string literal spells view DDL this replay cannot follow: {s[:80]!r}")
        events: list[tuple[int, str, re.Match[str]]] = []
        for kind, rx in (("create", CREATE_RE), ("set", ALTER_SET_RE), ("rename", ALTER_RENAME_RE), ("drop", DROP_RE)):
            events += [(m.start(), kind, m) for m in rx.finditer(code)]
        events += [(off, "sweep", None) for off in sweeps]  # type: ignore[misc]
        for pos, kind, m in sorted(events, key=lambda e: e[0]):
            if kind == "sweep":
                body = next(b for o, b in bodies if o == pos)
                skip = {x.lower() for x in EXCLUDE_RE.findall(body)}
                for v in list(views):
                    if v not in skip:
                        views[v] = (True, f.name)
                continue
            if kind == "drop":
                for q in re.split(r"\s*,\s*", m.group("names")):
                    v = public_name(q)
                    if v:
                        views.pop(v, None)
                continue
            v = public_name(m.group("name"))
            if v is None:
                continue
            if kind == "create":
                if re.search(r"\b(?:temp|temporary)\b", m.group(0), re.I):
                    continue
                views[v] = (bool(invoker_from(m.group("opts"))), f.name)
            elif kind == "set":
                inv = invoker_from(m.group("opts"))
                if m.group("verb").lower() == "reset":
                    if re.search(r"\bsecurity_invoker\b", m.group("opts"), re.I) and v in views:
                        views[v] = (False, f.name)
                elif inv is not None and v in views:
                    views[v] = (inv, f.name)
            elif kind == "rename" and v in views:
                views[m.group("new").strip('"').lower()] = views.pop(v)
    return views, cannot


def main(argv: list[str], migrations: Path = MIGRATIONS) -> int:
    if "--self-test" in argv[1:]:
        return self_test()
    files = sorted(p for p in migrations.glob("*.sql") if FILE_RE.match(p.name)) if migrations.is_dir() else []
    if not files:
        print(f"CANNOT CHECK: no migrations under {migrations}", file=sys.stderr)
        return 2
    views, cannot = replay(files)
    if cannot:
        print("CANNOT CHECK: view DDL inside a string literal.", file=sys.stderr)
        for c in cannot:
            print(f"  - {c}", file=sys.stderr)
        return 2
    if not views:
        print("CANNOT CHECK: the replay found no public view at all -- that is a broken parser, not health.", file=sys.stderr)
        return 2
    owner = sorted((v, src) for v, (inv, src) in views.items() if not inv)
    if owner:
        print("FAIL: public view(s) that run as their owner and read past the RLS of their base tables:")
        for v, src in owner:
            print(f"  - public.{v}  (left that way by {src})")
        print(
            "\nAdd `WITH (security_invoker = true)` to the CREATE, or a later\n"
            "`ALTER VIEW public.<v> SET (security_invoker = true);`. Note that\n"
            "CREATE OR REPLACE VIEW without the WITH clause resets it (F-532)."
        )
        return 1
    print(f"OK: all {len(views)} public views read as their caller (security_invoker), replayed over {len(files)} migrations.")
    return 0


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------
_SWEEP = (
    "do $$\ndeclare v record;\nbegin\n  for v in select c.relname from pg_class c\n"
    "    where c.relkind = 'v' and c.relname <> 'kept'\n  loop\n"
    "    execute format('alter view public.%I set (security_invoker = true)', v.relname);\n"
    "  end loop;\nend\n$$;\n"
)
_CASES: list[tuple[str, int, dict[str, str]]] = [
    ("born invoker", 0, {"a": "create view public.v1 with (security_invoker = true) as select 1;"}),
    ("born invoker, bare option and on", 0, {"a": "create view v1 with (security_barrier, security_invoker) as select 1;\n"
                                              "create view v2 with (security_invoker=on) as select 1;"}),
    ("born owner", 1, {"a": "create view public.v1 as select 1;"}),
    ("explicitly false", 1, {"a": "create view public.v1 with (security_invoker = false) as select 1;"}),
    ("fixed by a later ALTER", 0, {"a": "create view public.v1 as select 1;", "b": "alter view public.v1 set (security_invoker = true);"}),
    ("F-532: replace without WITH resets", 1, {"a": "create view public.v1 with (security_invoker = true) as select 1;",
                                                "b": "create or replace view public.v1 as select 1, 2;"}),
    ("RESET turns it off", 1, {"a": "create view v1 with (security_invoker = true) as select 1;",
                               "b": "alter view if exists v1 reset (security_invoker);"}),
    ("dropped view is gone", 0, {"a": "create view public.v1 as select 1;\ncreate view public.v2 with (security_invoker=true) as select 1;",
                                 "b": "drop view if exists public.v1 cascade;"}),
    ("rename carries the bit", 1, {"a": "create view public.v1 as select 1;", "b": "alter view public.v1 rename to v2;"}),
    ("sweep credits earlier views", 0, {"a": "create view public.v1 as select 1;", "b": _SWEEP}),
    ("sweep does not credit later views", 1, {"a": "create view public.v1 as select 1;", "b": _SWEEP, "c": "create view public.v3 as select 1;"}),
    ("sweep honours relname <> exclusions", 1, {"a": "create view public.kept as select 1;", "b": _SWEEP}),
    ("materialized views are out of scope", 0, {"a": "create materialized view public.m1 as select 1;\n"
                                                  "create view public.v1 with (security_invoker=true) as select 1;"}),
    ("other schemas are out of scope", 0, {"a": "create view audit.v1 as select 1;\ncreate view public.v2 with (security_invoker=true) as select 1;"}),
    ("comments are not views", 0, {"a": "-- CREATE OR REPLACE VIEW cannot reorder columns as select\n"
                                        "/* create view public.ghost as select 1 */\n"
                                        "create view public.v1 with (security_invoker = true) as select 1;"}),
    ("a string that mentions a view is not one", 0, {"a": "create view public.v1 with (security_invoker = true) as select 1;\n"
                                                         "comment on view public.v1 is 'the view as select of all';"}),
    ("dynamic view DDL cannot be checked", 2, {"a": "create view public.v1 with (security_invoker = true) as select 1;\n"
                                                   "do $$ begin execute 'create view public.v9 as select 1'; end $$;"}),
    ("a non-sweep format string cannot be checked", 2, {"a": "create view public.v1 with (security_invoker = true) as select 1;\n"
                                                             "do $$ begin execute format('alter view public.%I reset (security_invoker)', 'v1'); end $$;"}),
    ("no view at all is not health", 2, {"a": "create table public.t (id int);"}),
    ("no migrations is not health", 2, {}),
]


def self_test() -> int:
    held = 0
    for label, want, corpus in _CASES:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for i, (key, sql) in enumerate(sorted(corpus.items())):
                (root / f"2026080{i}000000_{key}.sql").write_text(sql + "\n", encoding="utf-8")
            import contextlib
            import io

            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                got = main(["x"], root)
        ok = got == want
        held += ok
        print(f"  {'held' if ok else 'BROKE':5}  want {want} got {got}  {label}")
    if held != len(_CASES):
        print(f"SELF-TEST FAILED -- {len(_CASES) - held} of {len(_CASES)} cases broke.")
        return 1
    print(f"SELF-TEST OK -- {held} cases run, every one held.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
