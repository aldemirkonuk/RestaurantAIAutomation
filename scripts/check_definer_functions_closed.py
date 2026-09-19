#!/usr/bin/env python3
"""
End-state check: no SECURITY DEFINER function answers to a role the API can reach.

ADR 0159. This is the AUTHORITY for that class. It reads the catalog of a database
that was just built from supabase/migrations/, so it judges what the SQL DID, not
how the SQL was spelled.

WHY THIS EXISTS
---------------
A SECURITY DEFINER function runs as its owner whoever calls it, so EXECUTE is the
whole access check. PostgreSQL grants EXECUTE on every new function to PUBLIC, and
anon/authenticated inherit PUBLIC. OD-72 revoked from anon and authenticated only,
and `increment_trust_counter(uuid)` stayed callable with the publishable key.

The first class-level control was lexical: arm (c) of
scripts/check_new_tables_are_locked_down.py reads migration TEXT. Four review
rounds (PR #391, 2026-09-18) each found SQL spellings that re-open a definer to
anon/authenticated while that arm exits 0 -- a DO body written as a single-quoted
literal, `to group anon`, a GRANT to a role anon is a member of, `create schema
... grant ...`, a revoke under `if false`, a revoke undone by an exception block
or a savepoint, dynamic EXECUTE shapes, rename-then-grant, overloads. A text reader
cannot close that list, because the language keeps offering new spellings. The
catalog has one spelling for the outcome: `pg_proc.proacl`. So arm (c) is now an
early warning for common spellings, and this check is what decides.

WHO IS JUDGED -- the roles a client can reach [2026-09-18, round 6]
--------------------------------------------------------------------
PUBLIC, plus every role PostgREST can switch into: every role `authenticator` (the
API's login role) is a member of, directly or through other roles
(`pg_has_role('authenticator', r, 'MEMBER')`). That includes `authenticator` itself,
`anon`, `authenticated`, and any custom role a migration grants to `authenticator`
-- PostgREST runs `SET ROLE <the JWT's role claim>`, so such a role is one JWT away.
`anon` and `authenticated` are judged even if `authenticator` is not a member of them.

ONE STATED EXCEPTION: `service_role`. It is the server's role: the gateway calls
RPCs with the service-role key, its JWT is signed with the project secret and is
never shipped to a client, and a GRANT to it is exactly the closed state every
definer migration writes (`grant execute ... to service_role`). Judging it would
fail every correctly closed function. A role reachable only THROUGH service_role
is still judged, as any other role authenticator reaches.

[Round 5 judged only PUBLIC, anon and authenticated. PR #391 verifier, round 5, A8: a
role granted to authenticator and holding EXECUTE on a definer passed with exit 0.]

WHAT IT READS
-------------
One read-only session (`set_session(readonly=True)`), three SELECTs:
  * which of anon, authenticated and authenticator exist (all three must -- see
    NEVER VACUOUS), and whether each is a superuser;
  * the judged roles (above), and whether each is a superuser;
  * every function with `pg_proc.prosecdef`, with its schema, owner, whether it is
    a member of an extension (`pg_depend.deptype = 'e'`), every grantee of EXECUTE
    in `aclexplode(coalesce(proacl, acldefault('f', proowner)))` -- a NULL proacl
    IS the built-in default, which grants PUBLIC -- which judged role other than
    authenticator reaches a grantee or the owner through role membership
    (`pg_has_role(..., 'MEMBER')`, whatever its INHERIT setting), which judged roles
    `has_function_privilege()` says can EXECUTE it, and its identity: language,
    return type, whether it returns a set, kind, `proconfig`, and `md5(prosrc)`.
authenticator's own membership paths are not listed: by the definition above it is
a member of every judged role and of service_role, so each of those paths is either
judged as that role or is the service_role exception.

WHAT IT DECIDES (the classifier, which --self-test drives with no database)
--------------------------------------------------------------------------
IN SCOPE: every SECURITY DEFINER function outside the PostgreSQL system schemas
(`pg_catalog`, `information_schema`, `pg_toast`, `pg_temp_<n>`,
`pg_toast_temp_<n>`) that is not a member of an extension. Every other schema is
in scope, Supabase's platform schemas included.

A function in scope FAILS (exit 1) when any of these holds, and each is named:
  * PUBLIC holds EXECUTE -- by the built-in default (NULL proacl) or explicitly;
  * a judged role holds EXECUTE by name (with or without grant option);
  * a judged role owns the function, or (authenticator aside) is a member --
    direct or indirect, whatever its INHERIT setting -- of a role that holds
    EXECUTE or of the function's owner;
  * has_function_privilege() is true for a judged role by a path none of the
    above names (a superuser is named as one) -- a catch-all, so an unnamed path
    is never a pass.

CLIENT_CALLABLE is the only way out. An entry names the function by
`schema.name(argtypes)`, the client roles it excuses (anon and/or authenticated,
never PUBLIC), the ADR that decided it (the ADR file must exist), a reason, and
the function's IDENTITY: owner, language, return type, returns-set, kind,
`proconfig` and `md5(prosrc)`. An entry excuses only the roles it names, and only
while every identity field matches; a function that answers to the same signature
but is not the pinned one is judged like any other, and the report names each
field that differs. An entry that excuses nothing -- the function is absent, not a
definer, out of scope, no longer reaches those roles, or is not the pinned one and
reaches nobody -- is exit 2: the list only shrinks, and never by accident.

[2026-09-18, round 6, source: PR #391 verifier round 5, A1c: the entry matched on
signature alone, so a migration that dropped supabase_functions.http_request() and
recreated it as a callable `returns jsonb` SECURITY DEFINER granted to anon passed,
canary and all, and anon's call ran as postgres. The pin is `md5(prosrc)` plus the
settings, not `md5(pg_get_functiondef())`: prosrc is stored verbatim, while
pg_get_functiondef is a deparse whose layout belongs to the server version (the
proof build is PostgreSQL 18.3, CI's stack 17).]

It has one entry today, a platform function, not a decision about this
product's API: `supabase_functions.http_request()`, which the pinned Supabase
CLI (v2.116.0, `apps/cli-go/internal/db/start/templates/webhook.sql:35-104` creates
it, `:132` gives it to supabase_functions_admin, `:227-230` make it SECURITY
DEFINER and grant it to anon and authenticated) installs in the local stack it
starts for PostgreSQL 15+ (this repo runs 17). No migration creates it. It returns
`trigger`, and PL/pgSQL refuses a direct call of a trigger function. The pinned
`md5(prosrc)` was measured on a build that runs that template's CREATE FUNCTION
verbatim, and equals the md5 of the text between its `$function$` quotes. Production
has no anon-executable SECURITY DEFINER function outside extensions except
increment_trust_counter (read-only query, 2026-09-18). If CI's stack stops creating
it, the entry excuses nothing (exit 2). If it creates a function that differs in any
pinned field, anon and authenticated stay unexcused on it (exit 1, each differing
field named). Either way this check says so; neither is a pass.

NEVER VACUOUS -- exit 2 means "could not check", never a pass
------------------------------------------------------------
  * no DSN (`--dsn` or DEFINER_CHECK_DB_URL); a DSN naming any host or hostaddr
    but localhost, 127.0.0.1, ::1 or a unix socket; a DSN with no host while
    PGHOST names another; a PGHOSTADDR naming another (libpq connects to hostaddr
    whatever host says); a `service=` DSN, or PGSERVICE set (libpq would read the
    host from a service file this check never sees). This reads a database built
    from migrations; it refuses to be pointed at production or any remote
    database, and it never reads .env or any SUPABASE_* variable;
  * psycopg2 missing, a failed connection, or a failed catalog query;
  * anon, authenticated or authenticator missing (without authenticator there is
    no telling which roles the API can switch into);
  * fewer than MIN_PUBLIC_SECDEF in-scope SECURITY DEFINER functions in schema
    `public` (the corpus creates 7; lower it in a diff when a migration drops one);
  * a malformed CLIENT_CALLABLE entry (identity included), or one that excuses
    nothing.

WHAT IT DOES NOT SEE, STATED PLAINLY
------------------------------------
  * TIME. It judges the END STATE of one build. A function left open by one
    migration and closed by a later one passes here, though production is open
    between the two deploys. Arm (c)'s same-file rule (c1) is the only thing that
    speaks to that window, and it is lexical.
  * THE EMPTY BUILD, NOT PRODUCTION'S DATA. It judges the database the migrations
    build from nothing. A migration that does something different where rows
    already exist -- a GRANT under `if exists (select 1 from auth.users)`, say --
    is judged as the empty build runs it. Replayed (PR #391 verifier round 5, A2):
    exit 0 on the fresh build; the same migration on a copy holding one auth.users
    row leaves anon holding EXECUTE, and this check exits 1 there.
  * REACH THROUGH ANOTHER OBJECT. Only EXECUTE on the function itself is judged.
    PostgreSQL runs some functions with no EXECUTE check against the caller.
    Measured on PGlite (verifier round 5 and this round): a closed SECURITY
    DEFINER trigger function fires, as its owner, on an INSERT by anon into a
    table anon may write (A3); a closed SECURITY DEFINER aggregate state function
    runs as its owner when anon calls an aggregate anon may EXECUTE, because
    support functions are checked against the aggregate's owner (A9). Both pass
    here. The controls hold: a closed definer used as a column DEFAULT (A10) or
    called in a view anon may SELECT (A11) is refused to anon. Filed OPEN in
    v3.0-TECH-DEBT.md.
  * EXTENSION MEMBERS and SYSTEM SCHEMAS, by construction. Production's three
    PostGIS `st_estimatedextent` overloads are SECURITY DEFINER and anon-
    executable members of `postgis`; they are out of scope here exactly as they
    are for arm (c) (see v3.0-TECH-DEBT.md). A function a migration adds to an
    extension with `alter extension ... add function` would leave scope the same
    way.
  * WHAT THIS BUILD DOES NOT CONTAIN. Only `supabase/migrations/` and the local
    stack's platform; never the dashboard, psql sessions, seed data or production.
  * CALL-TIME SQL. A function that, when CALLED, grants EXECUTE somewhere changes
    nothing until it is called. A migration that calls it is caught; code that
    calls it at runtime is not.
  * PRIVILEGES THAT ARE NOT EXECUTE. Only EXECUTE and ownership are read. A
    client role that could reach the function by some other privilege (CREATE on
    its schema to shadow it, say) is out of scope.
  * ROLES THE API CANNOT SWITCH INTO. A role that authenticator is not a member
    of is not judged, and neither is service_role (above).

Exit 0 = clean.  Exit 1 = a SECURITY DEFINER function answers to PUBLIC or a judged
role.  Exit 2 = could not check.

`--self-test` drives the classifier, the identity pin, the judged roles, the
allowlist rules, the floor, the DSN host rule, main()'s wiring and the fetch-error
paths on synthetic rows, and fetch() itself through a stand-in driver (read-only
session, the three SELECTs in order, the judged roles handed to QUERY, the row
width), with no database. It prints one line per case and closes with `SELF-TEST OK
-- <n> cases run, every one held`, <n> counting cases executed. On a database it
prints `DEFINER-CHECK OK -- <k> in public (floor 7), ...`. schema-parity.yml
asserts both lines, not only the exit codes, and so does the OD-72 CLAIMS row
for the self-test.

`--without-allowlist` judges with CLIENT_CALLABLE emptied. schema-parity.yml
runs it first, as a canary: on the local stack it must exit 1 with the exact line
`  supabase_functions.http_request()  (owner supabase_functions_admin)`, which
proves on the real database -- with no write to it -- that this check can fail
there, and that the platform function is owned by the role the pin names.

Usage:
  DEFINER_CHECK_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \\
      python3 scripts/check_definer_functions_closed.py
  python3 scripts/check_definer_functions_closed.py --dsn <local url> [--without-allowlist]
  python3 scripts/check_definer_functions_closed.py --self-test
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

DSN_ENV = "DEFINER_CHECK_DB_URL"
#: Always judged, and the only roles a CLIENT_CALLABLE entry may excuse.
CLIENT_ROLES = ("anon", "authenticated")
#: The API's login role: every role it is a member of is one PostgREST can switch into.
API_LOGIN_ROLE = "authenticator"
MUST_EXIST = (*CLIENT_ROLES, API_LOGIN_ROLE)
MIN_PUBLIC_SECDEF = 7
REPO = Path(__file__).resolve().parent.parent
ADR_DIR = REPO / ".planning" / "decisions"

SYSTEM_SCHEMA = re.compile(r"^(?:pg_catalog|information_schema|pg_toast|pg_temp_\d+|pg_toast_temp_\d+)$")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

#: What an allowlist entry pins, beyond its signature. Every field must match.
IDENTITY_FIELDS = ("owner", "language", "returns", "retset", "kind", "config", "src_md5")

#: The only functions allowed to answer to a client role. Key: `schema.name(argtypes)`,
#: argtypes as `oidvectortypes(proargtypes)` prints them. Add an entry in a diff that
#: cites the ADR deciding it, never to quiet this check.
CLIENT_CALLABLE: dict[str, dict] = {
    "supabase_functions.http_request()": {
        "roles": {"anon", "authenticated"},
        "adr": "0159",
        "reason": (
            "Supabase platform, not a migration: the pinned CLI (v2.116.0, "
            "apps/cli-go/internal/db/start/templates/webhook.sql:35-104, :132, :227-230) creates it, "
            "gives it to supabase_functions_admin, makes it SECURITY DEFINER and grants EXECUTE to anon "
            "and authenticated in the local stack it starts. It returns trigger; PL/pgSQL refuses a "
            "direct call of a trigger function."
        ),
        # Measured 2026-09-18 on a build that runs the template's CREATE FUNCTION verbatim;
        # src_md5 also equals the md5 of the template text between its $function$ quotes.
        "identity": {
            "owner": "supabase_functions_admin",
            "language": "plpgsql",
            "returns": "trigger",
            "retset": False,
            "kind": "f",
            "config": ["search_path=supabase_functions"],
            "src_md5": "cb8a5741f829fe414ecd51c25be75c9a",
        },
    },
}

ROLES_SQL = "select rolname, rolsuper from pg_roles where rolname in ('anon', 'authenticated', 'authenticator')"

#: The roles PostgREST can switch into, minus the stated service_role exception.
CLIENT_SQL = """
select r.rolname, r.rolsuper
  from pg_roles r
 where pg_has_role('authenticator', r.oid, 'MEMBER')
   and r.rolname <> 'service_role'
 order by 1
"""

ROW_FIELDS = ("schema", "name", "args", "owner", "acl_null", "ext", "grantees", "via", "reach",
              "language", "returns", "retset", "kind", "config", "src_md5")

QUERY = """
select n.nspname,
       p.proname,
       oidvectortypes(p.proargtypes),
       pg_get_userbyid(p.proowner),
       p.proacl is null,
       exists (select 1 from pg_depend d
                where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'),
       array(select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where a.privilege_type = 'EXECUTE'
              order by 1),
       array(select c.rolname || ' via ' || pg_get_userbyid(g.oid)
               from pg_roles c
               cross join (select a.grantee as oid
                             from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.privilege_type = 'EXECUTE' and a.grantee <> 0
                           union
                           select p.proowner) g
              where c.rolname = any(%(judged)s)
                and c.rolname <> 'authenticator'
                and g.oid <> c.oid
                and pg_has_role(c.oid, g.oid, 'MEMBER')
              order by 1),
       array(select c.rolname
               from pg_roles c
              where c.rolname = any(%(judged)s)
                and has_function_privilege(c.oid, p.oid, 'EXECUTE')
              order by 1),
       l.lanname,
       p.prorettype::regtype::text,
       p.proretset,
       p.prokind::text,
       coalesce(p.proconfig, '{}'::text[]),
       md5(p.prosrc)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
 where p.prosecdef
 order by 1, 2, 3
"""

#: The queries' load-bearing clauses, with how often each must appear. --self-test fails
#: if any is edited away (the ACL default is read twice: grantees, and membership).
QUERY_MUST_SAY = (
    ("where p.prosecdef", 1),
    ("coalesce(p.proacl, acldefault('f', p.proowner))", 2),
    ("a.privilege_type = 'EXECUTE'", 2),
    ("d.deptype = 'e'", 1),
    ("pg_has_role(c.oid, g.oid, 'MEMBER')", 1),
    ("select p.proowner", 1),
    ("c.rolname = any(%(judged)s)", 2),
    ("c.rolname <> 'authenticator'", 1),
    ("has_function_privilege(c.oid, p.oid, 'EXECUTE')", 1),
    ("l.lanname", 1),
    ("p.prorettype::regtype::text", 1),
    ("p.proretset", 1),
    ("p.prokind::text", 1),
    ("coalesce(p.proconfig, '{}'::text[])", 1),
    ("md5(p.prosrc)", 1),
)
CLIENT_SQL_MUST_SAY = (
    ("pg_has_role('authenticator', r.oid, 'MEMBER')", 1),
    ("r.rolname <> 'service_role'", 1),
)


def query_pins_broken(q: str, must: tuple = QUERY_MUST_SAY) -> list[str]:
    """The `must` clauses `q` does not say exactly as often as required."""
    return [f"{c!r} x{q.count(c)}, not x{n}" for c, n in must if q.count(c) != n]


class CannotCheck(Exception):
    """Every condition under which this check cannot say what it claims."""


def fn_key(row: dict) -> str:
    return f"{row['schema']}.{row['name']}({row['args']})"


def judged_roles(present: dict[str, bool], reachable: dict[str, bool]) -> dict[str, bool]:
    """Role -> is-superuser, for every role judged: what authenticator reaches, plus anon and authenticated."""
    out = dict(reachable)
    for role in CLIENT_ROLES:
        if role in present:
            out.setdefault(role, present[role])
    return out


def reasons_for(row: dict, judged: dict[str, bool]) -> list[tuple[str, str]]:
    """(who, how) for every path by which PUBLIC or a judged role reaches EXECUTE."""
    out: list[tuple[str, str]] = []
    if row["owner"] in judged:
        out.append((row["owner"], "it owns the function (and can grant itself EXECUTE at will)"))
    if "PUBLIC" in row["grantees"]:
        out.append(("PUBLIC", "the built-in default, never revoked" if row["acl_null"] else "an explicit grant"))
    for role in sorted(judged):
        if role in row["grantees"]:
            extra = "" if role in CLIENT_ROLES else f" ({role} is a role the API can switch into)"
            out.append((role, f"an explicit grant{extra}"))
    for entry in row["via"]:
        role, _, through = entry.partition(" via ")
        out.append((role, f"membership of {through}, which holds EXECUTE or owns the function"))
    for role in row["reach"]:
        if not any(who in (role, "PUBLIC") for who, _ in out):
            how = ("a superuser the API can switch into: every function answers to it" if judged.get(role)
                   else "has_function_privilege() is true by a path this check does not name")
            out.append((role, how))
    return out


def identity_of(row: dict) -> dict:
    return {"owner": row["owner"], "language": row["language"], "returns": row["returns"],
            "retset": row["retset"], "kind": row["kind"], "config": list(row["config"]),
            "src_md5": row["src_md5"]}


def identity_mismatch(row: dict, pinned: dict) -> list[str]:
    got = identity_of(row)
    return [f"{f} is {got[f]!r}; the pin says {pinned[f]!r}" for f in IDENTITY_FIELDS if got[f] != pinned[f]]


def in_scope(row: dict) -> bool:
    return not SYSTEM_SCHEMA.match(row["schema"]) and not row["ext"]


def validate_allowlist(allow: dict[str, dict], adr_dir: Path) -> None:
    for key, entry in allow.items():
        if not re.fullmatch(r"[a-z_][a-z0-9_$]*\.[a-z_][a-z0-9_$]*\([^()]*\)", key):
            raise CannotCheck(f"CLIENT_CALLABLE key {key!r} is not `schema.name(argtypes)`")
        roles = entry.get("roles")
        if not roles or not set(roles) <= set(CLIENT_ROLES):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] must name anon and/or authenticated only (never PUBLIC)")
        adr = str(entry.get("adr", ""))
        if not re.fullmatch(r"\d{4}", adr):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] cites no ADR number")
        if not list(adr_dir.glob(f"{adr}-*.md")):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] cites ADR {adr}, and no such ADR file exists")
        if len(str(entry.get("reason", "")).strip()) < 20:
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] carries no reason")
        ident = entry.get("identity")
        if not isinstance(ident, dict) or set(ident) != set(IDENTITY_FIELDS):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] must pin an identity with exactly the fields "
                              f"{', '.join(IDENTITY_FIELDS)} -- a signature alone can be redefined")
        if not all(isinstance(ident[f], str) and ident[f] for f in ("owner", "language", "returns", "kind")):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] identity: owner, language, returns and kind must be non-empty text")
        if not isinstance(ident["retset"], bool):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] identity: retset must be true or false")
        if not isinstance(ident["config"], list) or not all(isinstance(c, str) for c in ident["config"]):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] identity: config must be a list of `name=value` text")
        if not re.fullmatch(r"[0-9a-f]{32}", str(ident["src_md5"])):
            raise CannotCheck(f"CLIENT_CALLABLE[{key!r}] identity: src_md5 must be 32 lower-case hex digits")


def evaluate(present: dict[str, bool], judged: dict[str, bool], rows: list[dict], allow: dict[str, dict],
             adr_dir: Path, floor: int = MIN_PUBLIC_SECDEF) -> tuple[int, str]:
    """The whole verdict, from fetched rows. Returns (exit code, report)."""
    lines: list[str] = []
    try:
        validate_allowlist(allow, adr_dir)
        missing = [r for r in MUST_EXIST if r not in present]
        if missing:
            raise CannotCheck(f"role(s) {', '.join(missing)} do not exist in this database")
        unjudged = [r for r in CLIENT_ROLES if r not in judged]
        if unjudged:
            raise CannotCheck(f"role(s) {', '.join(unjudged)} missing from the judged roles")
    except CannotCheck as exc:
        return 2, f"CANNOT CHECK -- {exc}\n   Exiting 2. A check that could not ask must never read as PASS."

    scope = [r for r in rows if in_scope(r)]
    system = sum(1 for r in rows if SYSTEM_SCHEMA.match(r["schema"]))
    ext = sum(1 for r in rows if r["ext"] and not SYSTEM_SCHEMA.match(r["schema"]))
    public_n = sum(1 for r in scope if r["schema"] == "public")

    leaks: list[tuple[str, str, list[tuple[str, str]], list[str]]] = []
    mismatched: dict[str, list[str]] = {}
    used: set[str] = set()
    for row in scope:
        key = fn_key(row)
        found = reasons_for(row, judged)
        entry = allow.get(key)
        excused: set[str] = set()
        if entry:
            differs = identity_mismatch(row, entry["identity"])
            if differs:
                mismatched[key] = differs
            else:
                excused = set(entry["roles"])
        if excused and any(who in excused for who, _ in found):
            used.add(key)
        left = [(who, how) for who, how in found if who not in excused]
        if left:
            leaks.append((key, row["owner"], left, mismatched.get(key, [])))

    stale = sorted(set(allow) - used)
    if leaks:
        lines.append("FAIL: SECURITY DEFINER function(s) answer to PUBLIC or a role the API can switch into:")
        for key, owner, left, differs in leaks:
            lines.append(f"  {key}  (owner {owner})")
            for who, how in left:
                lines.append(f"      {who}: {how}")
            if differs:
                lines.append("      not excused: CLIENT_CALLABLE pins a different function under this signature --")
                lines.extend(f"        {d}" for d in differs)
        lines.append("")
        lines.append("Fix in the migration that creates the function (or re-opens it):")
        lines.append("    REVOKE EXECUTE ON FUNCTION <schema>.<f>(<args>) FROM PUBLIC, anon, authenticated;")
        lines.append("    GRANT EXECUTE ON FUNCTION <schema>.<f>(<args>) TO service_role;")
        lines.append("A client-callable definer needs an ADR and a CLIENT_CALLABLE entry, never a quiet GRANT.")
    if stale:
        lines.append("CANNOT CHECK -- CLIENT_CALLABLE entr(ies) that excuse nothing in this database:")
        for k in stale:
            lines.append(f"  {k}")
            lines.extend(f"      {d}" for d in mismatched.get(k, []))
        lines.append("   Remove the entry (the list only shrinks), or find why the function changed.")
    if public_n < floor:
        lines.append(f"CANNOT CHECK -- {public_n} in-scope SECURITY DEFINER function(s) in schema public, "
                     f"fewer than the floor of {floor}. This is not the database migrations build.")
    summary = (f"{public_n} in public (floor {floor}), {len(scope)} in scope, {ext} extension member(s) "
               f"excluded, {system} in system schemas excluded, {len(used)}/{len(allow)} allowlisted "
               f"(identity pinned); judged: PUBLIC, {', '.join(sorted(judged))}")
    if leaks:
        lines.append(f"DEFINER-CHECK FAIL -- {len(leaks)} open; {summary}")
        return 1, "\n".join(lines)
    if stale or public_n < floor:
        lines.append("   Exiting 2. A check that could not ask must never read as PASS.")
        return 2, "\n".join(lines)
    lines.append(f"DEFINER-CHECK OK -- {summary}")
    return 0, "\n".join(lines)


def dsn_hosts(dsn: str) -> tuple[list[str], list[str]]:
    """(hosts, hostaddrs) a libpq DSN names ('' = none). Raises on what it cannot read."""
    dsn = dsn.strip()
    if not dsn:
        raise CannotCheck(f"no database URL: pass --dsn or set {DSN_ENV}")
    if re.match(r"^postgres(?:ql)?://", dsn):
        parts = urlsplit(dsn)
        netloc = parts.netloc.rsplit("@", 1)[-1]
        hosts = []
        for hp in netloc.split(","):
            if hp.startswith("["):
                hosts.append(hp[1:hp.index("]")])
            else:
                hosts.append(unquote(hp.split(":", 1)[0]))
        query = parse_qs(parts.query)
        for val in query.get("host", []):
            hosts.extend(val.split(","))
        addrs = [a for val in query.get("hostaddr", []) for a in val.split(",")]
        return hosts, addrs
    if "=" in dsn:
        found: dict[str, list[str]] = {"host": [], "hostaddr": []}
        for m in re.finditer(r"(?:^|\s)(host|hostaddr)\s*=\s*('(?:[^'\\]|\\.)*'|\S+)", dsn):
            found[m.group(1)].extend(m.group(2).strip("'").split(","))
        return found["host"] or [""], found["hostaddr"]
    raise CannotCheck("the database URL is neither a postgresql:// URL nor key=value pairs")


def require_local(dsn: str, env: dict | None = None) -> None:
    env = os.environ if env is None else env
    if re.search(r"(?:^|[\s?&])service\s*=", dsn):
        raise CannotCheck("refusing a service-file DSN: its host cannot be read from here")
    if env.get("PGSERVICE", "").strip():
        raise CannotCheck("refusing to run with PGSERVICE set: libpq would take the host from a service "
                          "file this check never reads")
    hosts, addrs = dsn_hosts(dsn)
    if not any(hosts):  # no host named: libpq falls back to PGHOST
        hosts = hosts + env.get("PGHOST", "").split(",")
    if not any(addrs):  # no hostaddr named: libpq falls back to PGHOSTADDR, and connects THERE
        addrs = env.get("PGHOSTADDR", "").split(",")
    for host in hosts:
        if host and not host.startswith("/") and host not in LOCAL_HOSTS:
            raise CannotCheck(
                f"refusing host {host!r}: this check reads a database built from migrations on this "
                "machine (localhost, 127.0.0.1, ::1 or a unix socket), never production or any remote one")
    for addr in addrs:
        if addr and addr not in LOCAL_HOSTS:
            raise CannotCheck(
                f"refusing hostaddr {addr!r}: libpq connects to hostaddr whatever host says, and this "
                "check reads only a database on this machine")


def fetch(dsn: str) -> tuple[dict[str, bool], dict[str, bool], list[dict]]:
    """READ-ONLY. Never prints the DSN or connection error text (either can embed it)."""
    try:
        import psycopg2  # noqa: PLC0415 -- only the database arm needs it
    except ImportError as exc:
        raise CannotCheck("psycopg2 is not installed (pip install psycopg2-binary)") from exc
    try:
        conn = psycopg2.connect(dsn, connect_timeout=15)
    except Exception as exc:  # noqa: BLE001 -- reported by type, never swallowed
        raise CannotCheck(f"could not connect to the database ({type(exc).__name__})") from exc
    try:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(ROLES_SQL)
            present = {r[0]: bool(r[1]) for r in cur.fetchall()}
            if set(MUST_EXIST) - set(present):
                return present, {}, []
            cur.execute(CLIENT_SQL)
            judged = judged_roles(present, {r[0]: bool(r[1]) for r in cur.fetchall()})
            cur.execute(QUERY, {"judged": sorted(judged)})
            raw = cur.fetchall()
            if any(len(r) != len(ROW_FIELDS) for r in raw):
                raise CannotCheck(f"the catalog query returned rows that are not {len(ROW_FIELDS)} columns wide")
            rows = [dict(zip(ROW_FIELDS, r)) for r in raw]
        return present, judged, rows
    except Exception as exc:  # noqa: BLE001
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
        raise CannotCheck(f"the catalog query failed ({type(exc).__name__}: {first})") from exc
    finally:
        conn.close()


def run(dsn: str, fetcher=fetch, env: dict | None = None, allow: dict | None = None) -> tuple[int, str]:
    try:
        require_local(dsn, env)
        present, judged, rows = fetcher(dsn)
    except CannotCheck as exc:
        return 2, f"CANNOT CHECK -- {exc}\n   Exiting 2. A check that could not ask must never read as PASS."
    return evaluate(present, judged, rows, CLIENT_CALLABLE if allow is None else allow, ADR_DIR)


# ---------------------------------------------------------------------------
# --self-test: synthetic rows, no database
# ---------------------------------------------------------------------------
def _row(schema="public", name="f", args="uuid", owner="postgres", acl_null=False, ext=False,
         grantees=("postgres",), via=(), reach=(), language="plpgsql", returns="void", retset=False,
         kind="f", config=(), src_md5="0" * 32) -> dict:
    return {"schema": schema, "name": name, "args": args, "owner": owner, "acl_null": acl_null, "ext": ext,
            "grantees": list(grantees), "via": list(via), "reach": list(reach), "language": language,
            "returns": returns, "retset": retset, "kind": kind, "config": list(config), "src_md5": src_md5}


def _closed(name: str, schema: str = "public") -> dict:
    return _row(schema=schema, name=name, grantees=("postgres", "service_role"))


_PIN = CLIENT_CALLABLE["supabase_functions.http_request()"]["identity"]
_SEVEN = [_closed(f"secdef_{i}") for i in range(7)]
_HTTP = _row(schema="supabase_functions", name="http_request", args="",
             grantees=("anon", "authenticated", "postgres", "service_role", "supabase_functions_admin"),
             reach=("anon", "authenticated"), **{f: (list(v) if f == "config" else v) for f, v in _PIN.items()})
_PRESENT = {"anon": False, "authenticated": False, "authenticator": False}
_JUDGED = {"anon": False, "authenticated": False, "authenticator": False}


def _with(row: dict, **changes) -> dict:
    out = dict(row)
    out.update(changes)
    return out


def run_self_test() -> int:
    import tempfile

    ran: list[str] = []
    failures: list[str] = []

    with tempfile.TemporaryDirectory() as td:
        adr_dir = Path(td)
        (adr_dir / "0159-selftest.md").write_text("x\n")
        allow = {k: dict(v) for k, v in CLIENT_CALLABLE.items()}

        def case(label: str, want: int, rows: list[dict], must: tuple[str, ...] = (),
                 present: dict = _PRESENT, judged: dict = _JUDGED, allowlist: dict | None = None,
                 floor: int = MIN_PUBLIC_SECDEF, must_not: tuple[str, ...] = (),
                 must_lines: tuple[str, ...] = ()) -> None:
            rc, out = evaluate(present, judged, rows, allow if allowlist is None else allowlist, adr_dir, floor)
            ran.append(f"  exit {rc} (want {want})  {label}")
            miss = [m for m in must if m not in out] + [m for m in must_lines if m not in out.splitlines()]
            extra = [m for m in must_not if m in out]
            if rc != want or miss or extra:
                failures.append(f"{label}: exit {rc} (want {want}); missing {miss}; unwanted {extra}\n{out}")

        base = _SEVEN + [_HTTP]
        # -- the corpus shape, and every path in --------------------------------
        case("seven closed definers + the platform webhook -> clean", 0, base,
             ("DEFINER-CHECK OK -- 7 in public (floor 7)", "1/1 allowlisted (identity pinned)",
              "judged: PUBLIC, anon, authenticated, authenticator"))
        case("NULL proacl = PUBLIC by the built-in default", 1,
             base + [_row(name="open", acl_null=True, grantees=("PUBLIC", "postgres"), reach=_JUDGED)],
             ("public.open(uuid)", "PUBLIC: the built-in default, never revoked"))
        case("explicit grant to PUBLIC", 1,
             base + [_row(name="pub", grantees=("PUBLIC", "postgres"), reach=_JUDGED)],
             ("PUBLIC: an explicit grant",))
        case("explicit grant to anon", 1,
             base + [_row(name="a", grantees=("anon", "postgres"), reach=("anon",))], ("anon: an explicit grant",))
        case("explicit grant to authenticated", 1,
             base + [_row(name="b", grantees=("authenticated", "postgres"), reach=("authenticated",))],
             ("authenticated: an explicit grant",))
        case("grant to a role anon is a member of", 1,
             base + [_row(name="m", grantees=("leaky", "postgres"), via=("anon via leaky",))],
             ("anon: membership of leaky",))
        case("owner is a role authenticated is a member of", 1,
             base + [_row(name="o", owner="leaky", grantees=("leaky",), via=("authenticated via leaky",))],
             ("authenticated: membership of leaky",))
        case("authenticated made a member of service_role (grants to service_role reach it)", 1,
             base[:1] + [_with(_SEVEN[1], via=["authenticated via service_role"])] + base[2:],
             ("public.secdef_1(uuid)", "authenticated: membership of service_role"))
        case("owned by anon, own EXECUTE revoked -> still a leak", 1,
             base + [_row(name="own", owner="anon", grantees=("postgres",))], ("anon: it owns the function",))
        case("has_function_privilege true with no named path -> still a leak", 1,
             base + [_row(name="h", reach=("anon",))], ("anon: has_function_privilege() is true",))
        case("a leak in another schema (a SET SCHEMA move) is in scope", 1,
             base + [_row(schema="other", name="moved", grantees=("anon", "postgres"), reach=("anon",))],
             ("other.moved(uuid)",))
        case("overloads are judged one signature at a time", 1,
             base + [_closed("ov"), _row(name="ov", args="text", acl_null=True, grantees=("PUBLIC", "postgres"))],
             ("public.ov(text)",), must_not=("public.ov(uuid)",))
        # -- every role the API can switch into (round 6) -------------------------
        premium = dict(_JUDGED, zz_premium=False)
        case("a role granted to authenticator holds EXECUTE (verifier A8) -> judged", 1,
             base + [_row(name="p", grantees=("postgres", "zz_premium"), reach=("zz_premium",))],
             ("public.p(uuid)", "zz_premium: an explicit grant (zz_premium is a role the API can switch into)"),
             judged=premium)
        case("a role authenticator is NOT a member of holds EXECUTE -> not judged", 0,
             base + [_row(name="r", grantees=("postgres", "reporting"))])
        case("authenticator itself holds EXECUTE -> judged", 1,
             base + [_row(name="au", grantees=("authenticator", "postgres"), reach=("authenticator",))],
             ("authenticator: an explicit grant",))
        case("a role the API can switch into owns the function", 1,
             base + [_row(name="po", owner="zz_premium", grantees=("zz_premium",), reach=("zz_premium",))],
             ("zz_premium: it owns the function",), judged=premium)
        case("a superuser the API can switch into -> named", 1,
             base[:1] + [_with(_SEVEN[1], reach=["zz_su"])] + base[2:],
             ("zz_su: a superuser the API can switch into",), judged=dict(_JUDGED, zz_su=True))
        case("authenticator missing -> 2", 2, base, ("authenticator do not exist",),
             present={"anon": False, "authenticated": False})
        case("anon missing -> 2", 2, base, ("anon do not exist",),
             present={"authenticated": False, "authenticator": False})
        case("anon not among the judged roles -> 2", 2, base, ("anon missing from the judged roles",),
             judged={"authenticated": False, "authenticator": False})
        # -- what is out of scope, by construction -------------------------------
        case("an extension member granted to PUBLIC is excluded", 0,
             base + [_row(name="st_estimatedextent", args="text, text", owner="supabase_admin", ext=True,
                          grantees=("PUBLIC", "anon"), reach=("anon", "authenticated"))],
             ("1 extension member(s) excluded",))
        case("pg_catalog is a system schema", 0,
             base + [_row(schema="pg_catalog", name="sys", acl_null=True, grantees=("PUBLIC",))],
             ("1 in system schemas excluded",))
        case("pg_temp_3 is a system schema", 0,
             base + [_row(schema="pg_temp_3", name="t", acl_null=True, grantees=("PUBLIC",))],
             ("1 in system schemas excluded",))
        case("a user schema named pg_catalogue is NOT a system schema", 1,
             base + [_row(schema="pg_catalogue", name="t", acl_null=True, grantees=("PUBLIC",))],
             ("pg_catalogue.t(uuid)",))
        # -- the allowlist ------------------------------------------------------------
        case("the allowlist excuses only the roles it names (PUBLIC on it still fails)", 1,
             _SEVEN + [_with(_HTTP, grantees=_HTTP["grantees"] + ["PUBLIC"])],
             ("supabase_functions.http_request()", "PUBLIC: an explicit grant"),
             must_not=("anon: an explicit grant",))
        case("the allowlist never excuses a role the API can switch into that it does not name", 1,
             _SEVEN + [_with(_HTTP, grantees=_HTTP["grantees"] + ["zz_premium"])],
             ("zz_premium: an explicit grant",), judged=premium, must_not=("anon: an explicit grant",))
        case("an entry whose function is absent excuses nothing -> 2", 2, _SEVEN,
             ("excuse nothing", "supabase_functions.http_request()"))
        case("an entry whose function no longer reaches its roles -> 2", 2,
             _SEVEN + [_with(_HTTP, grantees=["postgres"], reach=[])], ("excuse nothing",))
        case("an entry whose function became an extension member -> 2", 2,
             _SEVEN + [_with(_HTTP, ext=True)], ("excuse nothing",))
        # -- the identity pin (round 6: verifier A1c) -----------------------------------
        hijack = _with(_HTTP, owner="postgres", language="sql", returns="jsonb", config=["search_path="],
                       src_md5="f" * 32)
        case("A1c: dropped and recreated as a callable `returns jsonb` definer -> not excused", 1,
             _SEVEN + [hijack],
             ("supabase_functions.http_request()  (owner postgres)", "anon: an explicit grant",
              "authenticated: an explicit grant", "not excused: CLIENT_CALLABLE pins a different function",
              "returns is 'jsonb'; the pin says 'trigger'", "owner is 'postgres'"),
             must_not=("DEFINER-CHECK OK",),
             must_lines=("        returns is 'jsonb'; the pin says 'trigger'",))
        for field, value in (("owner", "postgres"), ("language", "sql"), ("returns", "jsonb"), ("retset", True),
                             ("kind", "p"), ("config", ["search_path=public"]), ("src_md5", "e" * 32)):
            case(f"identity: {field} differs alone -> not excused", 1, _SEVEN + [_with(_HTTP, **{field: value})],
                 (f"{field} is {value!r}; the pin says {_PIN[field]!r}", "anon: an explicit grant"))
        case("identity differs and it reaches nobody -> 2, and the difference is named", 2,
             _SEVEN + [_with(_HTTP, src_md5="e" * 32, grantees=["postgres"], reach=[])],
             ("excuse nothing", "src_md5 is 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'"))
        bad = {
            "PUBLIC in roles": {"roles": {"PUBLIC"}},
            "no roles": {"roles": set()},
            "no ADR": {"adr": None},
            "a non-number ADR": {"adr": "ADR"},
            "an ADR with no file": {"adr": "9999"},
            "no reason": {"reason": "  "},
            "no identity": {"identity": None},
            "an identity missing a field": {"identity": {f: v for f, v in _PIN.items() if f != "src_md5"}},
            "an identity with a stray field": {"identity": dict(_PIN, owner_oid=10)},
            "an identity whose md5 is not hex": {"identity": dict(_PIN, src_md5="z" * 32)},
            "an identity whose retset is not a boolean": {"identity": dict(_PIN, retset="false")},
            "an identity whose config is text": {"identity": dict(_PIN, config="search_path=x")},
            "an identity with an empty owner": {"identity": dict(_PIN, owner="")},
        }
        good = {"roles": {"anon", "authenticated"}, "adr": "0159", "reason": "x" * 30, "identity": dict(_PIN)}
        for label, change in bad.items():
            entry = {k: v for k, v in dict(good, **change).items() if v is not None}
            case(f"allowlist entry with {label} -> 2", 2, base, ("CANNOT CHECK -- CLIENT_CALLABLE",),
                 allowlist={"supabase_functions.http_request()": entry})
        (adr_dir / "159-three-digits.md").write_text("x\n")
        case("allowlist entry citing a 3-digit ADR, even with a file -> 2", 2, base, ("cites no ADR number",),
             allowlist={"supabase_functions.http_request()": dict(good, adr="159")})
        case("--without-allowlist: the platform webhook is reported as open, owner named on one exact line", 1,
             base, ("anon: an explicit grant",), allowlist={},
             must_lines=("  supabase_functions.http_request()  (owner supabase_functions_admin)",))
        case("allowlist key that is not schema.name(args) -> 2", 2, base, ("is not `schema.name(argtypes)`",),
             allowlist={"http_request": good})
        # -- never vacuous ------------------------------------------------------------
        case("six in public, floor seven -> 2", 2, _SEVEN[:6] + [_HTTP], ("fewer than the floor of 7",))
        case("an empty database -> 2", 2, [], ("fewer than the floor",))
        case("a leak still wins over a low floor (exit 1, never masked)", 1,
             [_row(name="open", acl_null=True, grantees=("PUBLIC", "postgres"))], ("public.open(uuid)",))

        # -- judged_roles(): what fetch() judges ----------------------------------------
        got = judged_roles({"anon": False, "authenticated": False, "authenticator": False},
                           {"authenticator": False, "zz_premium": False})
        ok = got == {"anon": False, "authenticated": False, "authenticator": False, "zz_premium": False}
        ran.append(f"  {'held' if ok else 'BROKEN'}  judged roles add anon and authenticated to what authenticator reaches")
        if not ok:
            failures.append(f"judged_roles(): {got}")

        # -- the DSN host rule and the fetch paths, through run() ---------------------
        def host_case(label: str, dsn: str, want: int, must: str, env: dict | None = None) -> None:
            def fake(_dsn):
                return _PRESENT, _JUDGED, _SEVEN + [_HTTP]
            rc, out = run(dsn, fetcher=fake, env=env or {})
            ran.append(f"  exit {rc} (want {want})  DSN: {label}")
            if rc != want or must not in out:
                failures.append(f"DSN {label}: exit {rc} (want {want}), wanted {must!r}\n{out}")

        host_case("the local stack URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", 0,
                  "DEFINER-CHECK OK")
        host_case("localhost", "postgres://u@localhost/db", 0, "DEFINER-CHECK OK")
        host_case("IPv6 loopback", "postgresql://u@[::1]:5432/db", 0, "DEFINER-CHECK OK")
        host_case("unix socket, key=value", "dbname=postgres host=/tmp", 0, "DEFINER-CHECK OK")
        host_case("key=value with no host", "dbname=postgres user=postgres", 0, "DEFINER-CHECK OK")
        host_case("a Supabase pooler host", "postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres", 2,
                  "refusing host")
        host_case("a remote host hidden in ?host=", "postgresql://u@127.0.0.1/db?host=db.x.supabase.co", 2,
                  "refusing host")
        host_case("a remote host in a multi-host URL", "postgresql://u@127.0.0.1:1,db.example.com:2/db", 2,
                  "refusing host")
        host_case("a remote host, key=value", "host=db.example.com dbname=postgres", 2, "refusing host")
        host_case("no host in the DSN, PGHOST remote", "dbname=postgres", 2, "refusing host",
                  env={"PGHOST": "db.example.com"})
        host_case("no host in the URL, PGHOSTADDR remote", "postgresql:///postgres", 2, "refusing hostaddr",
                  env={"PGHOSTADDR": "10.1.2.3"})
        host_case("a local host in the URL, PGHOSTADDR remote", "postgresql://u@127.0.0.1/db", 2,
                  "refusing hostaddr", env={"PGHOSTADDR": "192.0.2.1"})
        host_case("a local host in the URL, PGHOSTADDR local", "postgresql://u@127.0.0.1/db", 0,
                  "DEFINER-CHECK OK", env={"PGHOSTADDR": "127.0.0.1"})
        host_case("a remote hostaddr in ?hostaddr=", "postgresql://u@localhost/db?hostaddr=192.0.2.1", 2,
                  "refusing hostaddr")
        host_case("host=localhost with a remote hostaddr, key=value", "host=localhost hostaddr=192.0.2.1", 2,
                  "refusing hostaddr")
        host_case("a service-file DSN", "service=prod dbname=postgres", 2, "refusing a service-file DSN")
        host_case("PGSERVICE set, key=value with no host (verifier: libpq read a remote host from it)",
                  "dbname=postgres user=postgres", 2, "PGSERVICE", env={"PGSERVICE": "prod"})
        host_case("PGSERVICE set, even with a local host named", "postgresql://u@127.0.0.1/db", 2, "PGSERVICE",
                  env={"PGSERVICE": "prod"})
        host_case("an empty DSN", "", 2, "no database URL")
        host_case("an unreadable DSN", "not a dsn", 2, "neither a postgresql:// URL")

        def fetch_case(label: str, exc: Exception, must: str) -> None:
            def boom(_dsn):
                raise exc
            rc, out = run("postgresql://u@127.0.0.1/db", fetcher=boom, env={})
            ran.append(f"  exit {rc} (want 2)  fetch: {label}")
            if rc != 2 or must not in out:
                failures.append(f"fetch {label}: exit {rc} (want 2), wanted {must!r}\n{out}")

        # -- fetch() itself, through a stand-in driver: the read-only session, the order of
        #    the three SELECTs, the judged roles handed to QUERY, the row-width check ---------
        import types

        def fake_driver(results: list[list[tuple]], log: list) -> types.ModuleType:
            class Cur:
                def __enter__(self):
                    return self

                def __exit__(self, *exc):
                    return False

                def execute(self, sql, params=None):
                    log.append(("execute", sql, params))

                def fetchall(self):
                    return results[sum(1 for e in log if e[0] == "execute") - 1]

            class Conn:
                def set_session(self, readonly=False):
                    log.append(("readonly", readonly))

                def cursor(self):
                    return Cur()

                def close(self):
                    log.append(("close",))

            mod = types.ModuleType("psycopg2")
            mod.connect = lambda dsn, connect_timeout=None: Conn()
            return mod

        good_row = ("public", "f", "uuid", "postgres", False, False, ["postgres"], [], [], "plpgsql", "void",
                    False, "f", [], "0" * 32)

        def driver_case(label: str, results: list[list[tuple]], want_judged, want_rows: int, must: str = "",
                        want_sqls: tuple = (ROLES_SQL, CLIENT_SQL, QUERY)) -> None:
            log: list = []
            saved = sys.modules.get("psycopg2")
            sys.modules["psycopg2"] = fake_driver(results, log)
            try:
                try:
                    _present, judged, rows = fetch("postgresql://u@127.0.0.1/db")
                    got = (sorted(judged), len(rows), "")
                except CannotCheck as exc:
                    got = (None, 0, str(exc))
            finally:
                if saved is None:
                    sys.modules.pop("psycopg2", None)
                else:
                    sys.modules["psycopg2"] = saved
            sqls = [e[1] for e in log if e[0] == "execute"]
            params = [e[2] for e in log if e[0] == "execute"]
            ok = (("readonly", True) in log and log[-1] == ("close",) and got[0] == want_judged
                  and got[1] == want_rows and must in got[2])
            ok = ok and sqls == list(want_sqls)
            if len(want_sqls) == 3 and want_judged is not None:
                ok = ok and params[2] == {"judged": want_judged}
            ran.append(f"  {'held' if ok else 'BROKEN'}  fetch(): {label}")
            if not ok:
                failures.append(f"fetch() {label}: got {got}, log {log}")

        three = [("anon", False), ("authenticated", False), ("authenticator", False)]
        driver_case("read-only; judged = what authenticator reaches + anon/authenticated, handed to QUERY",
                    [three, [("authenticator", False), ("zz_premium", False)], [good_row]],
                    ["anon", "authenticated", "authenticator", "zz_premium"], 1)
        driver_case("a catalog row of the wrong width -> cannot check",
                    [three, [("anon", False)], [good_row[:-1]]], None, 0, "not 15 columns wide")
        driver_case("authenticator missing -> stops before the judged-roles query",
                    [three[:2]], [], 0, want_sqls=(ROLES_SQL,))

        fetch_case("psycopg2 missing", CannotCheck("psycopg2 is not installed"), "psycopg2 is not installed")
        fetch_case("connection refused", CannotCheck("could not connect to the database (OperationalError)"),
                   "could not connect")
        fetch_case("query failed", CannotCheck("the catalog query failed (ProgrammingError: x)"),
                   "the catalog query failed")

        # -- main() wiring, in-process: argv and the environment reach run() ----------
        import contextlib
        import io

        def main_case(label: str, argv: list[str], want: int, must: str) -> None:
            saved = os.environ.pop(DSN_ENV, None)
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    rc = main(argv)
            finally:
                if saved is not None:
                    os.environ[DSN_ENV] = saved
            ran.append(f"  exit {rc} (want {want})  main: {label}")
            if rc != want or must not in buf.getvalue():
                failures.append(f"main {label}: exit {rc} (want {want}), wanted {must!r}\n{buf.getvalue()}")

        main_case("--dsn naming a remote host", ["--dsn", "postgresql://u@db.example.com/postgres"], 2,
                  "refusing host")
        main_case(f"no --dsn and no ${DSN_ENV}", [], 2, "no database URL")
        main_case("--without-allowlist still refuses a remote host",
                  ["--without-allowlist", "--dsn", "host=db.example.com"], 2, "refusing host")

        # -- the queries still ask what the classifier assumes -------------------------
        for q, must in ((QUERY, QUERY_MUST_SAY), (CLIENT_SQL, CLIENT_SQL_MUST_SAY)):
            broken = query_pins_broken(q, must)
            for clause, times in must:
                held = not any(b.startswith(repr(clause)) for b in broken)
                ran.append(f"  {'held' if held else 'BROKEN'}  query says {clause!r} x{times}")
            if broken:
                failures.append(f"a query no longer says: {broken}")
        gutted = QUERY.replace("coalesce(p.proacl, acldefault('f', p.proowner))", "p.proacl", 1)
        caught = bool(query_pins_broken(gutted))
        ran.append(f"  {'held' if caught else 'BROKEN'}  the pin notices one ACL default read dropped")
        if not caught:
            failures.append("query_pins_broken() did not notice a dropped acldefault()")

    for line in ran:
        print(line)
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} of {len(ran)} cases run did not hold:")
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    print(f"SELF-TEST OK -- {len(ran)} cases run, every one held.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true", help="drive the classifier on synthetic rows, no database")
    ap.add_argument("--dsn", default=None, help=f"local database URL (default: ${DSN_ENV})")
    ap.add_argument("--without-allowlist", action="store_true",
                    help="judge with CLIENT_CALLABLE empty: on the Supabase local stack this must exit 1 "
                         "naming supabase_functions.http_request() -- the proof, on the real database, "
                         "that this check can fail")
    args = ap.parse_args(argv)
    if args.self_test:
        return run_self_test()
    dsn = args.dsn if args.dsn is not None else os.environ.get(DSN_ENV, "")
    rc, report = run(dsn, allow={} if args.without_allowlist else None)
    print(report)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
