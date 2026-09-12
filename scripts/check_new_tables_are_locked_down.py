#!/usr/bin/env python3
"""
Guard: a migration that CREATEs a public table must also lock that table down.

The ratchet for the OD-72 / OD-73 anon-exposure class. Both were closed on
2026-08-26 by one-time sweeps; nothing made them STAY closed, and this file is
that nothing.

WHY THIS EXISTS
---------------
OD-73 closed 11 public tables that carried `relrowsecurity = false` while holding
the default Supabase grants, so `anon` -- a key shipped into the web bundle --
held SELECT/INSERT/UPDATE/DELETE on the invoice store and the OAuth account-link
table. OD-72 closed 190 more that granted client DML with RLS on and zero
policies. Both are point-in-time migrations: they iterate `pg_class` AS IT WAS
WHEN THEY RAN. A table created by any later migration is outside them by
construction, and the register says so in the founder's own words on OD-94:

    "OD-72 had already revoked postgres's default table grants, so a table
     created today gets no anon grant on its own [...] ORDERING LUCK, NOT A
     CONTROL -- supabase_admin's default still grants anon and we cannot
     alter it."          (.planning/decisions/OPEN-DECISIONS.md, OD-94)

The house rule that follows is stated in two CLAIMS.jsonl rows (OD-59, OD-94):
RLS and the anon/authenticated REVOKE live in the SAME migration that creates
the table, not a follow-up. This guard is that rule, executable.

It is not hypothetical. Run against `main` on 2026-08-26 this file found three
tables that had already regenerated the class -- see WHAT IT FOUND, below.

WHAT IT CHECKS -- TWO INDEPENDENT ARMS
--------------------------------------
For every table the migration corpus creates in schema `public`:

  (a) RLS   -- some migration must `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY`.
  (b) GRANT -- `anon` and `authenticated` must not hold table privileges on it
               when the corpus finishes replaying.

They are checked independently and neither substitutes for the other, because
they fail in opposite directions and close different holes. RLS-on with grants
intact is OD-72 (142 tables, and `master_wine_library` returned 4,094 rows to
the publishable key). Grants-revoked with RLS off is one stray `GRANT` away from
OD-73, and `supabase_admin`-owned defaults still hand out client grants on
tables it creates, which `ALTER DEFAULT PRIVILEGES` run as `postgres` cannot
reach. OD-73's own header puts it plainly: "Grants are access control; RLS is a
second, independent gate."

HOW ARM (b) IS MODELLED -- and why it is not a text search
----------------------------------------------------------
A grep for `revoke all on public.<t>` would report ~all 207 tables as broken,
because that is not how the corpus closed them. The guard replays the corpus in
version order and tracks one bit per table:

  * At CREATE, the table starts client-granted -- Supabase's default ACL grants
    anon+authenticated on every new public table -- UNLESS the corpus has
    already executed `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON
    TABLES FROM anon, authenticated`. Measured: that statement occurs exactly
    once, at 20260825210000_od72_revoke_client_grants.sql:183.
  * A static `REVOKE ... ON <t> FROM anon|authenticated` clears the bit.
  * A static `GRANT ... ON <t> TO anon|authenticated` sets it. Measured across
    the corpus: 9 such GRANTs exist, 8 are `ON FUNCTION` and the 9th is on a
    VIEW (guest_copresence_negatives). ZERO are on tables. The arm is therefore
    not vacuous by luck -- it is armed and nothing has tripped it.
  * A CATALOG SWEEP clears the bit on every table alive at that point: a
    `DO $$ ... $$` block containing both a `revoke ... %I ... from ... anon ...
    authenticated` format string AND a scan of `pg_class` / `information_schema`.
    The `pg_class` half is the discriminator and it earns its keep. Measured:
    TWO DO-blocks in the corpus carry that revoke format string, and only ONE is
    a catalog scan. The other is OD-73 section 4, which loops a hard-coded
    3-element array of `_bak_*` names; crediting it schema-wide would be wrong.
  * Sweep exclusions are honoured. OD-72's loop carries
    `and c.relname <> 'sommelier_conversations'`, so that table keeps its grants
    BY DESIGN and the guard must not pretend otherwise. `relname <> '...'`
    predicates are parsed out of the sweep block and those tables are not
    credited. That is the whole reason the debt list below has an entry.

Arm (a) takes no sweep credit at all. The only dynamic ENABLE RLS in the corpus
is OD-73 section 4's literal-array loop over the three `_bak_*` snapshots, and
none of those three is created by any migration, so there is nothing to credit.

WHAT IT DOES NOT CHECK, STATED PLAINLY
--------------------------------------
  * VIEWS. 26 views and 3 materialized views live in the corpus and OD-72
    section 2 found 16 of them running as their RLS-bypassing owner. That is a
    real hole and a different guard; this one never matches `CREATE VIEW`.
  * FUNCTIONS. `SECURITY DEFINER` + anon EXECUTE was OD-72 section 3 and OD-73's
    `merge_library_wines` finding. Not modelled here.
  * WHETHER THE MIGRATION EVER RAN. This reads .sql files. `check_schema_parity.sh`
    and `check_migrations_single_home.py` cover the ledger; five separate
    incidents this month involved DDL that lived outside `supabase/migrations/`
    and production never saw, and nothing in this file would catch a sixth.
  * POLICY CONTENT. A table can pass arm (a) with `USING (true)`. OD-72 measured
    exactly that on `master_wine_library`. Arm (b) is what actually contains it.
  * PARTITIONS are treated as ordinary tables needing their own posture. The
    corpus contains ZERO (`PARTITION OF` 0, `PARTITION BY` 0, `INHERITS` 0), so
    that branch is written but has never been exercised against real input.

WHY THE BASELINE IS NOT EXEMPT -- measured, not assumed
--------------------------------------------------------
`20260805000000_baseline_from_production.sql` creates 172 of the corpus's 207
tables (83%), and the obvious move is to treat it as the pre-existing set. The
measurement says do not:

    tables created in the baseline ................ 172
    of those, `ENABLE ROW LEVEL SECURITY` present .. 166
    the 6 without ................. procurement_credits, procurement_documents,
                                    procurement_document_lines,
                                    procurement_document_links,
                                    procurement_receipt_events,
                                    user_oauth_accounts

Those 6 are EXACTLY the 6 tables OD-73 named that the baseline creates -- no
more, no fewer. The baseline is a faithful production dump, so it already
carries the truth about which tables were left open; exempting it would blind
the guard to the precise set it exists to catch, and the pre-sweep proof run
below would name 2 tables instead of 8. The baseline also contains ZERO
`GRANT ... TO anon|authenticated` and ZERO `REVOKE` statements, so arm (b) needs
no special-casing for it either.

SPATIAL_REF_SYS
---------------
The known exception in this class, and it needs no entry: measured, NO migration
in the corpus contains a `CREATE TABLE` for it. PostGIS creates it inside
`CREATE EXTENSION`, owned by supabase_admin, which is why OD-73 excluded it (the
ALTER would abort the migration). This guard only ever looks at tables the
corpus itself creates, so `spatial_ref_sys` is out of scope by construction
rather than by exemption.

NEVER VACUOUS
-------------
Every "found nothing" path is a FAILURE, not a pass. Exit 2 is reserved for
"this guard could not check what it says it checks":

  * migrations directory missing / not a directory / unreadable   -> 2
  * any .sql file unreadable or undecodable                       -> 2
  * unbalanced dollar-quote or unterminated block comment         -> 2
  * fewer than MIN_FILES files / MIN_CREATES creates /
    MIN_RLS_STMTS enable-RLS statements                           -> 2  (pattern rot)
  * zero tables resolved into schema `public`                     -> 2
  * a `create table` the strict parser could not name             -> 2
  * a DEBT entry that no longer suppresses anything               -> 2  (shrink-only)
  * DEBT longer than MAX_DEBT                                     -> 2  (shrink-only)

Exit 0 = clean.  Exit 1 = tables missing RLS and/or still client-granted.
Exit 2 = the guard could not check.

WHAT IT FOUND ON THE DAY IT WAS WRITTEN
---------------------------------------
Exit 1 on `main` at 6c4996f9. `20260826175836_evidence_gate_v1.sql` -- restored
verbatim from production's ledger the day before -- creates `source_registry`,
`field_evidence_policy` and `promotion_audit` and contains no RLS, no policy, no
GRANT and no REVOKE anywhere in the file. Arm (b) passes them (they are created
after the OD-72 default-privileges ratchet, which is why production shows no
client grants and why 6c4996f9 correctly called the REVOKEs redundant). Arm (a)
fails them: RLS is simply off. That makes OD-73's closing claim -- "0 public
tables remain RLS-off" -- stale by three tables, roughly two hours after it was
verified.

PROVEN AGAINST A TREE THAT SHOULD FAIL IT
-----------------------------------------
A guard not run against a failing tree is not a guard. Copy the corpus, delete
the two sweeps, run:

    cp supabase/migrations/*.sql "$TMP/pre-sweep/"
    rm "$TMP/pre-sweep/20260825200000_od73_close_anon_dml.sql" \
       "$TMP/pre-sweep/20260825210000_od72_revoke_client_grants.sql"
    python3 scripts/check_new_tables_are_locked_down.py "$TMP/pre-sweep"

Exit 1. Arm (a) names 11 tables: the 3 above, plus the EIGHT that OD-73 named
and that migrations actually create -- the 5 `procurement_*`, `user_oauth_accounts`,
`wine_repair_log`, `wine_merge_log`. Not 7, not 9. OD-73's other four
(`_bak_library_before_corpus`, `_bak_wine_match_keys_20260812`,
`_bak_seed_repair_20260813`, `spatial_ref_sys`) are created by ad-hoc data work
and by `CREATE EXTENSION`, never by a migration, so they are out of scope
rather than missed. Arm (b) names 201 of the 207, which is the same order as
OD-72's own measurement of 203-of-206 client-granted in production.

The other paths are exercised too: exit 0 against the corpus plus a hypothetical
3-table lockdown migration; exit 1 against a new unlocked table, and against a
locked table re-opened by a later `GRANT`; exit 2 against a missing directory, a
file argument, a 30-file corpus, a corpus with the baseline removed, a dynamic
`execute format('create table %I ...')`, an unterminated `$$`, undecodable
bytes, an over-cap DEBT list, and a DEBT entry that no longer suppresses
anything.

Stdlib only. No network. No database. 0.16s on 1.7MB of SQL.

Usage:  python3 scripts/check_new_tables_are_locked_down.py [migrations_dir]
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------------
# Vacuity floors. Measured on `main` at 6c4996f9 (2026-08-26):
#   75 migration files, 207 CREATE TABLE statements, 204 static ENABLE ROW
#   LEVEL SECURITY statements (205 occur in the text; the 205th is the dynamic
#   `execute format('alter table public.%I ...')` in OD-73 section 4, which is
#   deliberately not counted). The floors sit well below those so ordinary
#   growth never trips them, and far above zero so a rotted regex or a wrong
#   directory argument does. The pre-sweep proof tree (73 files, 207 creates,
#   196 enable-RLS) clears all three, which is the point: the proof must fail
#   on arm (a), not on vacuity.
# --------------------------------------------------------------------------
MIN_FILES = 50
MIN_CREATES = 150
MIN_RLS_STMTS = 100

DEFAULT_MIGRATIONS_DIR = "supabase/migrations"
TARGET_SCHEMA = "public"
CLIENT_ROLES = ("anon", "authenticated")

# --------------------------------------------------------------------------
# DEBT -- pre-existing exceptions. SHRINK-ONLY.
#
# MAX_DEBT may be lowered, never raised. An entry that stops suppressing a real
# finding is a FAILURE (exit 2), not a tidy-up, so a table that gets fixed
# forces its entry out of this list instead of rotting inside it.
#
# `arms` names which arm the entry excuses. An entry excuses that arm ONLY.
# --------------------------------------------------------------------------
MAX_DEBT = 1

DEBT: dict[str, dict] = {
    "public.sommelier_conversations": {
        "arms": {"grant"},
        "reason": (
            "Excepted by design in OD-72 -- the single live browser consumer of the "
            "publishable anon key. 20260825210000_od72_revoke_client_grants.sql:70 "
            "excludes it from the sweep by name (`c.relname <> 'sommelier_conversations'`), "
            "so it genuinely still grants anon/authenticated and the guard must say so "
            "rather than over-credit the sweep. Shrinks when the sommelier surface is "
            "routed through the gateway (CLAIMS.jsonl, OD-72 `status: open`)."
        ),
    },
}


# --------------------------------------------------------------------------
# Failure plumbing
# --------------------------------------------------------------------------
class CannotCheck(Exception):
    """Raised for every condition that makes the guard's claim unverifiable."""


# --------------------------------------------------------------------------
# Lexing
#
# Produces three views of one file:
#   code    -- comments removed, single-quoted string BODIES blanked. Every
#              statement regex runs here, so prose inside a RAISE or a
#              COMMENT ON cannot conjure a phantom table. Dollar-quoted bodies
#              are LEFT IN, because a `DO $$ ... $$` block's statements are
#              real statements.
#   strings -- the single-quoted literals, with positions, for sweep detection.
#   blocks  -- (start, end) spans of dollar-quoted bodies, so a sweep can be
#              recognised as one block rather than as scattered text.
# --------------------------------------------------------------------------
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")


def lex(sql: str, where: str) -> tuple[str, list[tuple[int, int, str]], list[tuple[int, int]]]:
    out: list[str] = []
    strings: list[tuple[int, int, str]] = []
    blocks: list[tuple[int, int]] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        two = sql[i : i + 2]

        # -- line comment
        if two == "--":
            j = sql.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
            continue

        # /* nested block comment */
        if two == "/*":
            depth, j = 1, i + 2
            while j < n and depth:
                if sql[j : j + 2] == "/*":
                    depth += 1
                    j += 2
                elif sql[j : j + 2] == "*/":
                    depth -= 1
                    j += 2
                else:
                    j += 1
            if depth:
                raise CannotCheck(
                    f"{where}: unterminated /* block comment opened at offset {i}. "
                    "The lexer cannot separate code from prose, so nothing below is trustworthy."
                )
            out.append("".join(c if c == "\n" else " " for c in sql[i:j]))
            i = j
            continue

        # $tag$ ... $tag$
        m = _DOLLAR_TAG.match(sql, i)
        if m:
            tag = m.group(0)
            j = sql.find(tag, m.end())
            if j == -1:
                raise CannotCheck(
                    f"{where}: unbalanced dollar-quote {tag} opened at offset {i}. "
                    "A DO block that does not close means the statement stream is unparseable."
                )
            blocks.append((m.end(), j))
            out.append(sql[i : j + len(tag)])
            i = j + len(tag)
            continue

        # 'single quoted literal'  (blanked in `code`, captured in `strings`)
        if ch == "'":
            j = i + 1
            buf: list[str] = []
            while j < n:
                if sql[j] == "'":
                    if sql[j + 1 : j + 2] == "'":
                        buf.append("'")
                        j += 2
                        continue
                    j += 1
                    break
                buf.append(sql[j])
                j += 1
            else:
                raise CannotCheck(f"{where}: unterminated string literal opened at offset {i}.")
            strings.append((i, j, "".join(buf)))
            out.append("".join(c if c == "\n" else " " for c in sql[i:j]))
            i = j
            continue

        # "quoted identifier" -- kept verbatim, it is code
        if ch == '"':
            j = sql.find('"', i + 1)
            if j == -1:
                raise CannotCheck(f"{where}: unterminated quoted identifier at offset {i}.")
            out.append(sql[i : j + 1])
            i = j + 1
            continue

        out.append(ch)
        i += 1

    return "".join(out), strings, blocks


# --------------------------------------------------------------------------
# Statement patterns
# --------------------------------------------------------------------------
IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
QNAME = rf"(?P<name>(?:{IDENT}\s*\.\s*)?{IDENT})"

# `create ... table` with every modifier Postgres allows between the two words.
RE_CREATE_TABLE = re.compile(
    r"\bcreate\s+(?:(?:global|local)\s+)?(?:temporary|temp|unlogged|foreign)?\s*"
    rf"table\s+(?:if\s+not\s+exists\s+)?{QNAME}",
    re.I,
)
# Every `create table` at all -- the discrepancy against RE_CREATE_TABLE is what
# catches a dynamic `execute format('create table %I ...')` this cannot name.
RE_CREATE_TABLE_LOOSE = re.compile(r"\bcreate\s+(?:\w+\s+){0,3}?table\b", re.I)
# What must follow a real table name. `create table public.%I (...)` matches
# RE_CREATE_TABLE by backtracking to the schema alone -- it would silently
# invent a table called `public.public` -- so the token after the name is
# checked and anything else is a parse this guard refuses to vouch for.
RE_AFTER_NAME = re.compile(
    r"\s*(?:\(|;|as\b|partition\b|of\b|inherits\b|tablespace\b|using\b|with\b|server\b|options\b)",
    re.I,
)

RE_RLS_ON = re.compile(
    rf"\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?{QNAME}\s+enable\s+row\s+level\s+security",
    re.I,
)
RE_RLS_OFF = re.compile(
    rf"\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?{QNAME}\s+disable\s+row\s+level\s+security",
    re.I,
)
RE_DROP_TABLE = re.compile(rf"\bdrop\s+table\s+(?:if\s+exists\s+)?{QNAME}", re.I)

# REVOKE/GRANT on tables only. `ON FUNCTION|SCHEMA|SEQUENCE|DATABASE|TYPE|...`
# and `ON ALL ... IN SCHEMA` are excluded -- measured, 8 of the corpus's 9
# client-facing GRANTs are `ON FUNCTION` and would otherwise be misread.
_NOT_A_TABLE = r"(?!\s*(?:all|function|routine|procedure|schema|sequence|database|domain|type|language|tablespace|foreign|large|parameter)\b)"
RE_REVOKE = re.compile(
    rf"\brevoke\s+(?:grant\s+option\s+for\s+)?[^;]*?\bon\s+(?:table\s+)?{_NOT_A_TABLE}"
    r"(?P<names>[^;]+?)\s+from\s+(?P<roles>[^;]+?)(?:\s+(?:cascade|restrict))?\s*;",
    re.I | re.S,
)
RE_GRANT = re.compile(
    rf"\bgrant\s+[^;]*?\bon\s+(?:table\s+)?{_NOT_A_TABLE}"
    r"(?P<names>[^;]+?)\s+to\s+(?P<roles>[^;]+?)(?:\s+with\s+grant\s+option)?\s*;",
    re.I | re.S,
)

# The ratchet from OD-72 section 4.
RE_ALTER_DEFAULT_REVOKE = re.compile(
    r"\balter\s+default\s+privileges\b(?P<body>[^;]*?)\brevoke\b(?P<rest>[^;]*?);",
    re.I | re.S,
)

# Sweep recognition, run over dollar-quoted block bodies. Three conditions, and
# each one is load-bearing against a block that actually exists in this corpus:
#   RE_DYNAMIC_REVOKE  -- a `revoke ... %I ... from anon ... authenticated`
#                         format string, with `on function|sequence|schema`
#                         excluded so OD-72 section 3 (the SECURITY DEFINER
#                         function loop, `revoke all on function public.%I(%s)`)
#                         is not mistaken for a table sweep.
#   RE_CATALOG_SCAN    -- the loop must scan the catalog. OD-73 section 4 loops a
#                         hard-coded 3-element array of `_bak_*` names; crediting
#                         it schema-wide would be a lie.
#   RE_RELKIND         -- if the loop filters relkind and that filter names no
#                         table kind ('r' ordinary, 'p' partitioned), it is not a
#                         table sweep. OD-72 section 2 is `relkind in ('v','m')`
#                         -- views and matviews -- and without this check it
#                         silently credits every table in the schema.
RE_DYNAMIC_REVOKE = re.compile(
    r"\brevoke\b(?![^']*?\b(?:function|routine|procedure|sequence|schema|database)\b)"
    r"[^']*?%I[^']*?\bfrom\b[^']*?\banon\b[^']*?\bauthenticated\b",
    re.I | re.S,
)
RE_CATALOG_SCAN = re.compile(r"\bpg_class\b|\binformation_schema\.tables\b", re.I)
RE_RELKIND = re.compile(r"\brelkind\s+in\s*\(([^)]*)\)", re.I)
RE_SWEEP_EXCLUDE = re.compile(r"\brelname\s*(?:<>|!=)\s*'([^']+)'", re.I)


def qualify(raw: str) -> str:
    """`Foo`, `"Foo"`, `public . foo` -> `public.foo`. Unqualified means public."""
    name = re.sub(r"\s*\.\s*", ".", raw.strip())
    parts = []
    for part in name.split("."):
        part = part.strip()
        if part.startswith('"') and part.endswith('"') and len(part) >= 2:
            parts.append(part[1:-1])  # quoted: case preserved
        else:
            parts.append(part.lower())
    if len(parts) == 1:
        parts.insert(0, TARGET_SCHEMA)
    return ".".join(parts)


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


# --------------------------------------------------------------------------
# The replay
# --------------------------------------------------------------------------
def analyse(mig_dir: Path) -> dict:
    files = sorted(mig_dir.glob("*.sql"), key=lambda p: p.name)
    if len(files) < MIN_FILES:
        raise CannotCheck(
            f"only {len(files)} .sql file(s) under {mig_dir} (floor is {MIN_FILES}). "
            "Either the directory is wrong or the corpus was gutted; either way this "
            "guard would pass vacuously."
        )

    live: dict[str, dict] = {}
    created_ever = 0
    rls_stmts = 0
    adp_revoked = False
    adp_where: str | None = None
    sweeps: list[str] = []
    dyn_revoke_blocks = 0
    skipped_other_schema: list[str] = []

    for path in files:
        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise CannotCheck(f"{path}: cannot read ({exc}). An unread migration is an unchecked one.")

        code, _strings, blocks = lex(raw, path.name)

        strict = [m for m in RE_CREATE_TABLE.finditer(code) if RE_AFTER_NAME.match(code, m.end())]
        loose = list(RE_CREATE_TABLE_LOOSE.finditer(code))
        if len(loose) != len(strict):
            named = {m.start() for m in strict}
            orphan = next((m for m in loose if m.start() not in named), loose[0] if loose else None)
            at = f"{path.name}:{line_of(code, orphan.start())}" if orphan else path.name
            raise CannotCheck(
                f"{at}: found {len(loose)} `create table` but could only NAME {len(strict)}. "
                "A table this parser cannot name (a dynamic `execute format('create table %I ...')`, "
                "or a syntax the pattern does not cover) is a table it cannot vouch for."
            )

        events: list[tuple[int, str, str]] = []
        for m in strict:
            events.append((m.start(), "create", qualify(m.group("name"))))
        for m in RE_RLS_ON.finditer(code):
            rls_stmts += 1
            events.append((m.start(), "rls_on", qualify(m.group("name"))))
        for m in RE_RLS_OFF.finditer(code):
            events.append((m.start(), "rls_off", qualify(m.group("name"))))
        for m in RE_DROP_TABLE.finditer(code):
            events.append((m.start(), "drop", qualify(m.group("name"))))

        for kind, pat in (("revoke", RE_REVOKE), ("grant", RE_GRANT)):
            for m in pat.finditer(code):
                roles = m.group("roles").lower()
                if not any(re.search(rf"\b{r}\b", roles) for r in CLIENT_ROLES):
                    continue
                for chunk in m.group("names").split(","):
                    chunk = chunk.strip()
                    if not chunk or "%" in chunk or "(" in chunk:
                        continue
                    if not re.fullmatch(rf"(?:{IDENT}\s*\.\s*)?{IDENT}", chunk):
                        continue
                    events.append((m.start(), kind, qualify(chunk)))

        for m in RE_ALTER_DEFAULT_REVOKE.finditer(code):
            tail = (m.group("body") + " " + m.group("rest")).lower()
            if (
                "schema public" in re.sub(r"\s+", " ", tail)
                and re.search(r"\bon\s+tables\b", tail)
                and all(re.search(rf"\b{r}\b", tail) for r in CLIENT_ROLES)
            ):
                events.append((m.start(), "adp", f"{path.name}:{line_of(code, m.start())}"))

        # Sweeps: a DO block that both revokes dynamically AND scans the catalog.
        for bstart, bend in blocks:
            body = raw[bstart:bend]
            if not RE_DYNAMIC_REVOKE.search(body):
                continue
            dyn_revoke_blocks += 1
            if not RE_CATALOG_SCAN.search(body):
                continue  # literal-array loop (OD-73 s4) -- narrow, not schema-wide
            kinds = RE_RELKIND.search(body)
            if kinds and not re.search(r"'[rp]'", kinds.group(1)):
                continue  # a view/matview loop (OD-72 s2), not a table sweep
            excluded = {qualify(x) for x in RE_SWEEP_EXCLUDE.findall(body)}
            events.append(
                (bstart, "sweep", f"{path.name}:{line_of(raw, bstart)}|" + ",".join(sorted(excluded)))
            )

        events.sort(key=lambda e: e[0])

        for _, kind, arg in events:
            if kind == "create":
                created_ever += 1
                schema = arg.split(".", 1)[0]
                if schema != TARGET_SCHEMA:
                    skipped_other_schema.append(f"{arg} ({path.name})")
                    continue
                live[arg] = {
                    "file": path.name,
                    "rls": False,
                    "granted": not adp_revoked,
                    "adp": adp_where,
                }
            elif kind == "rls_on" and arg in live:
                live[arg]["rls"] = True
            elif kind == "rls_off" and arg in live:
                live[arg]["rls"] = False
            elif kind == "drop":
                live.pop(arg, None)
            elif kind == "revoke" and arg in live:
                live[arg]["granted"] = False
            elif kind == "grant" and arg in live:
                live[arg]["granted"] = True
                live[arg]["regranted_in"] = path.name
            elif kind == "adp":
                adp_revoked = True
                adp_where = arg
            elif kind == "sweep":
                loc, _, excl = arg.partition("|")
                sweeps.append(loc)
                excluded = {e for e in excl.split(",") if e}
                for name, st in live.items():
                    if name not in excluded:
                        st["granted"] = False

    if created_ever < MIN_CREATES:
        raise CannotCheck(
            f"only {created_ever} CREATE TABLE statement(s) parsed (floor is {MIN_CREATES}). "
            "The pattern has rotted or the corpus is not what this guard was measured against."
        )
    if rls_stmts < MIN_RLS_STMTS:
        raise CannotCheck(
            f"only {rls_stmts} ENABLE ROW LEVEL SECURITY statement(s) parsed "
            f"(floor is {MIN_RLS_STMTS}). Arm (a) cannot be trusted to recognise a passing table."
        )
    if not live:
        raise CannotCheck(
            f"zero surviving tables in schema `{TARGET_SCHEMA}` after replaying {len(files)} files. "
            "Nothing to check means nothing was checked."
        )

    return {
        "files": len(files),
        "created_ever": created_ever,
        "live": live,
        "rls_stmts": rls_stmts,
        "sweeps": sweeps,
        "dyn_revoke_blocks": dyn_revoke_blocks,
        "adp": adp_where,
        "skipped_other_schema": skipped_other_schema,
    }


# --------------------------------------------------------------------------
def main(argv: list[str]) -> int:
    if len(argv) > 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    mig_dir = Path(argv[1] if len(argv) > 1 else DEFAULT_MIGRATIONS_DIR)

    if len(DEBT) > MAX_DEBT:
        print(
            f"CANNOT CHECK: DEBT holds {len(DEBT)} entries but MAX_DEBT is {MAX_DEBT}. "
            "This list is shrink-only; raising the cap is not the fix.",
            file=sys.stderr,
        )
        return 2

    if not mig_dir.exists():
        print(f"CANNOT CHECK: {mig_dir} does not exist.", file=sys.stderr)
        return 2
    if not mig_dir.is_dir():
        print(f"CANNOT CHECK: {mig_dir} is not a directory.", file=sys.stderr)
        return 2
    if not os.access(mig_dir, os.R_OK | os.X_OK):
        print(f"CANNOT CHECK: {mig_dir} is not readable.", file=sys.stderr)
        return 2

    try:
        res = analyse(mig_dir)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        return 2

    live = res["live"]
    no_rls = {n for n, s in live.items() if not s["rls"]}
    granted = {n for n, s in live.items() if s["granted"]}

    # Shrink-only: an entry that suppresses nothing must be deleted, not left to rot.
    stale = []
    for name, entry in DEBT.items():
        if name not in live:
            stale.append(f"{name} -- no migration creates it any more")
            continue
        arms = entry["arms"]
        excuses = ("rls" in arms and name in no_rls) or ("grant" in arms and name in granted)
        if not excuses:
            stale.append(f"{name} -- it now passes arms {sorted(arms)} on its own")
    if stale:
        print("CANNOT CHECK: stale DEBT entries. Delete them; this list only shrinks.", file=sys.stderr)
        for s in stale:
            print(f"  - {s}", file=sys.stderr)
        return 2

    fail_rls = sorted(n for n in no_rls if "rls" not in DEBT.get(n, {}).get("arms", ()))
    fail_grant = sorted(n for n in granted if "grant" not in DEBT.get(n, {}).get("arms", ()))

    scope = (
        f"{res['files']} migration file(s), {res['created_ever']} CREATE TABLE, "
        f"{len(live)} live table(s) in `{TARGET_SCHEMA}`, {res['rls_stmts']} ENABLE-RLS statement(s), "
        f"{len(res['sweeps'])} catalog sweep(s) of {res['dyn_revoke_blocks']} dynamic revoke block(s), "
        f"default-privileges ratchet {res['adp'] or 'ABSENT'}, "
        f"{len(DEBT)}/{MAX_DEBT} debt entr(ies)."
    )

    if res["skipped_other_schema"]:
        print(f"NOTE: {len(res['skipped_other_schema'])} table(s) created outside `{TARGET_SCHEMA}`, not checked:")
        for s in res["skipped_other_schema"]:
            print(f"  - {s}")

    if not fail_rls and not fail_grant:
        print(f"OK: every public table the migrations create is locked down. {scope}")
        return 0

    print("FAIL: public table(s) created without the OD-72/OD-73 lockdown.\n")
    print(f"Scope: {scope}\n")
    if fail_rls:
        print(f"(a) RLS NEVER ENABLED -- {len(fail_rls)} table(s):")
        for n in fail_rls:
            print(f"      {n:52s} created in {live[n]['file']}")
        print()
    if fail_grant:
        print(f"(b) anon/authenticated STILL GRANTED -- {len(fail_grant)} table(s):")
        for n in fail_grant:
            why = (
                f"re-granted in {live[n]['regranted_in']}"
                if "regranted_in" in live[n]
                else ("created before the default-privileges ratchet and never revoked"
                      if not live[n]["adp"] else "explicitly granted after the ratchet")
            )
            print(f"      {n:52s} created in {live[n]['file']}  ({why})")
        print()
    print(
        "Fix in the migration that CREATES the table, per OD-59 and OD-94 in\n"
        ".planning/decisions/CLAIMS.jsonl -- not in a follow-up:\n\n"
        "    ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;\n"
        "    DROP POLICY IF EXISTS <t>_service_role ON public.<t>;\n"
        "    CREATE POLICY <t>_service_role ON public.<t>\n"
        "      FOR ALL TO service_role USING (true) WITH CHECK (true);\n"
        "    REVOKE ALL ON public.<t> FROM anon, authenticated;\n\n"
        "If a table genuinely cannot take this, it goes in DEBT at the top of this\n"
        "file with the reason -- and MAX_DEBT only ever goes down."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
