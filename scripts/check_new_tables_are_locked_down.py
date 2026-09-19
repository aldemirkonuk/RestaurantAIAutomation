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
  * FUNCTIONS -- see ARM (c) below (added 2026-09-18). Arms (a) and (b) still
    never look at functions; arm (c) never looks at tables.
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

ARM (c) -- A FAST PRE-CHECK FOR OPEN SECURITY DEFINER FUNCTIONS (2026-09-18)
------------------------------------------------------------------------------
A SECURITY DEFINER function runs as its owner whoever calls it, so EXECUTE is
the whole access check. PostgreSQL grants EXECUTE on every new function to
PUBLIC, and anon/authenticated inherit PUBLIC. OD-72 revoked from anon and
authenticated only, and `increment_trust_counter(uuid)` stayed callable with the
publishable key -- measured in production on 2026-09-18 as `=X/postgres`, 23
days after OD-72 was recorded closed.

THIS ARM IS NOT THE AUTHORITY. [2026-09-18, round 5, source: PR #391 verifier,
round 4.] It reads migration TEXT, and four review rounds each found SQL
spellings that re-open a definer to anon or authenticated while it exits 0. A
text reader cannot close that list. The authority is
scripts/check_definer_functions_closed.py: it reads pg_proc on the database
schema-parity.yml builds from every migration, in the step right after
`supabase db reset --no-seed`, so it judges what the SQL did. This arm is a
fast pre-check for common spellings. It needs no database, runs in the ci.yml
step every pull request gets, and names the file and line. A pass here means
only that none of the shapes its --self-test names was found. ~~A pass here means
only that the spellings it reads are closed.~~ [CORRECTED 2026-09-18, round 6,
source: PR #391 verifier round 5: it reads more than it judges correctly. It reads
dollar-quoted DO bodies, yet credits a revoke under `if false`, inside an exception
block, before a savepoint rollback, or on another overload of the same name (KNOWN
MISSES), so a spelling it reads can still be open when it passes.]

ADR 0159's first answer was `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE
EXECUTE ON FUNCTIONS FROM PUBLIC`. That statement is a NO-OP: a per-schema
default can only take away what a per-schema default granted, never the
built-in EXECUTE-to-PUBLIC (PGlite probe, PR #391 audit: a function created
after it still carries `=X/postgres`, identical to a control). This arm is the
replacement, as a pre-check. Three rules, replayed in version order over
the text described below, keyed by function name:

  (c1) SAME FILE. A migration that CREATEs, REPLACEs, or ALTERs a function to
       SECURITY DEFINER must, later in that same file, revoke EXECUTE (or ALL)
       from PUBLIC, anon and authenticated. A revoke in a later file does not
       count: the window between the two is a live hole. `FN_GRANDFATHERED`
       names the only two exceptions (the privilege-less baseline dump).
  (c2) END STATE, AS THE REPLAY MODELS IT. No SECURITY DEFINER function may be
       EXECUTE-able by PUBLIC, anon or authenticated when the replay finishes --
       a later GRANT it reads re-opens it, and a grandfathered function must
       still have been closed somewhere. The replay's end state is a model of
       the text it reads, not the database's; the end-state check reads the
       database's.
  (c3) NO FALSE FIX. A per-schema `ALTER DEFAULT PRIVILEGES ... REVOKE ... ON
       FUNCTIONS FROM PUBLIC` fails the build, unless a per-schema default GRANT
       to PUBLIC precedes it (the only thing it can undo). The global form (no
       IN SCHEMA) does work and is not flagged -- it is simply not credited:
       every function still needs its own revoke.

WHAT ARM (c) READS -- static SQL text, and only this much of it
[2026-09-18: round 4 rewrote this as a definition; round 5 narrowed it to what
the code reads (PR #391 verifier, round 4).]
  * Each migration, split into statements on `;` after comments, string literals
    and dollar-quoted bodies are blanked -- so a function BODY never supplies a
    `security definer`, a `;` or a GRANT.
  * The body of a DO block written as a dollar-quoted literal, recursively. A DO
    body written as a single-quoted or E'' literal (`do 'begin ... end'`, `do
    language plpgsql '...'`) is not read.
  * Every EXECUTEd literal, recursively, read like static SQL. An EXECUTEd
    literal is a single-quoted, E'' or dollar-quoted literal whose only
    preceding tokens are `execute`, or `execute format(`: whitespace and
    comments of any length may sit between them, and nothing else may. An E''
    literal (an `E` or `e` that is not the tail of a longer word) is decoded
    first -- `\\b \\f \\n \\r \\t`, `\\'`, `\\\\`, `''`, hex, octal, `\\u` and
    `\\U` -- as PostgreSQL decodes it.
  * Of the other single-quoted and E'' literals -- in the file, in dollar-quoted
    DO bodies and in EXECUTEd literals, never in function bodies -- one question
    only: does its text say `create [or replace] function|procedure`, with
    whitespace alone between the words?

WHAT IT DOES WITH IT. Each item below is a named case in `_ST_CASES`,
`_LEX_CASES` or `_CC_CASES`. That proves the items work; it does not prove that
nothing else slips past.
  * Tracks `create [or replace] function|procedure` (by name, with its kind),
    `alter function|procedure|routine ... security definer`, and `drop
    function|procedure|routine [if exists] ... [cascade|restrict]`.
  * Reads `GRANT|REVOKE EXECUTE|ALL ON FUNCTION|PROCEDURE|ROUTINE <name>[(...)]
    [, ...]` and `... ON ALL FUNCTIONS|PROCEDURES|ROUTINES IN SCHEMA <s>`, each
    ALL reaching only the kind PostgreSQL says it reaches (ALL FUNCTIONS never a
    procedure, ALL PROCEDURES never a function). Roles may be quoted, upper-case
    or PUBLIC; names unqualified or several to a statement; ONE tail of
    CASCADE, RESTRICT, WITH GRANT OPTION or GRANTED BY (two tails together are
    not read, nor is `to group <role>`); argument types may contain ` to `
    (argument lists are masked first: `interval day to second` once ended the
    name list early and hid a GRANT to anon).
  * Does not credit `REVOKE GRANT OPTION FOR ...` (EXECUTE stays standing), a
    REVOKE whose function name, role or privilege is a format() placeholder, or
    a `format('... %I ...')` catalog sweep (OD-72 section 3 is one, and it never
    touched PUBLIC anyway).
  * Refuses, exit 2, because it cannot tell what the SQL does: a `create
    function|procedure` in an EXECUTEd literal (or in a DO block inside one),
    or found by the one question above; a create the strict parser cannot name;
    a GRANT/REVOKE whose function name it cannot read; in an EXECUTEd literal, a
    GRANT whose grantee is a format() placeholder, or a GRANT to PUBLIC, anon or
    authenticated whose function name or privilege is one; and `alter routine
    ... security definer` on a routine no migration creates (its kind decides
    which ALL ... IN SCHEMA reaches it). A function-name or privilege
    placeholder in a GRANT to service_role is not refused.
  * Refuses, exit 2, any migration that names schema `supabase_functions` --
    in code (comments aside; dollar-quoted bodies included) or in any single-
    quoted or E'' literal, decoded, at any depth. [2026-09-18, round 6, source:
    PR #391 verifier round 5, A1c: a migration dropped the platform webhook and
    recreated it as a callable definer granted to anon, the create and the GRANT
    each in a dollar-quoted variable, and this arm exited 0.] The schema is the
    local stack's platform; the end-state check pins its one function by
    identity. A name assembled at run time, a U&"..." identifier or a
    search_path set from an expression is not seen here; the identity pin is.

Measured on 2cb4f1fbc: 138 function creates, 7 SECURITY DEFINER; every one of
the 5 created after the baseline revokes PUBLIC, anon and authenticated in its
own file. Production's postgres-owned SECURITY DEFINER functions in `public` are
the same 7 by name (read-only query, 2026-09-18). No client calls a Postgres
function directly (no `.rpc(` or `/rest/v1/rpc` in apps/web, apps/mobile or
packages; the gateway calls RPCs with the service-role key), and no RLS policy
in production calls a public function (only auth.uid, auth.jwt, now) -- so
FN_CLIENT_CALLABLE, the named allowlist, is empty. The day a SECURITY DEFINER
function must be client-callable, that is a decision (ADR) and an entry there
naming the role and the ADR, not a quiet GRANT.

KNOWN MISSES -- NOT A COMPLETE LIST. Each passes this arm silently. The groups
are examples of what a text reader cannot see, and they are not exhaustive
either. Every example named in the first five groups was replayed as a
migration on a full-corpus build (2026-09-18, ADR 0159), and the end-state check
exits 1 on each; the sixth and seventh groups are outside that check too.
  * DYNAMIC SQL. Anything EXECUTE runs whose text is not an EXECUTEd literal as
    defined above is out of reach: SQL held in a variable (`s := '...'; execute
    s`, however quoted), assembled with `||` or `concat()`, passed as a later
    format() argument, or wrapped in any expression (`execute (...)`, `execute
    f(...)`); and, for the create question, a create hidden by a comment or an
    escape inside a literal that is not EXECUTEd. Examples, each a real leak on
    PGlite that exits 0 here (PR #391 verifier, rounds 2 and 3, 2026-09-18):
    `execute ('grant ... to anon')`; `execute ($f$create function ... security
    definer ...$f$)`; `execute format('%s', 'grant ... to anon')`; `execute
    format('%s', $f$create function ...$f$)`; `execute concat('grant ... ', 'to
    anon')`; `execute 'grant ... ' || 'to anon'`; a GRANT or a create held in a
    variable, single-, E''- or dollar-quoted; `s := 'create /**/ function ...'`.
    Some dynamic shapes are caught by accident (an ALTER ... SECURITY DEFINER
    through a format() name placeholder reads as a function called `public`);
    nothing here claims them.
  * CONTROL FLOW AND TRANSACTIONS. A DO body is read as if every statement in
    it runs, and a file as if every statement commits, so a revoke under `if
    false`, one undone by `raise exception` inside an exception block, or one
    undone by `rollback to savepoint` is credited as closing.
  * STATIC FORMS IT DOES NOT MODEL. `to group anon`; two role tails together;
    a `create schema ... grant ...` element; a GRANT to a role anon or
    authenticated is a member of; a GRANT to a role granted to authenticator,
    which PostgREST can switch into (PR #391 verifier round 5, A8); a DO body
    written as a single-quoted or E''
    literal; an EXECUTEd literal continued on the next line (`execute 'grant
    ... '` then `'to anon'`, which PostgreSQL joins into one string).
  * CALL-TIME SQL. A function body is never read, so a `create function` or a
    GRANT inside one runs unseen when it is called -- including a helper the
    same migration creates, calls and drops (`create function tmp() ... as $$
    begin grant execute on function f(uuid) to anon; end $$; select tmp();`).
  * NAME, NOT SIGNATURE. Functions are keyed by name. A revoke on one overload
    credits every overload of that name, so a new SECURITY DEFINER `f(text)`
    beside a closed `f(uuid)`, revoked only as `f(uuid)`, passes. A rename
    (`alter function f(uuid) rename to g`) or a move (`... set schema s`) is
    not followed, so a closed function renamed or moved and then granted under
    its new name passes.
  * NOT IN THE MIGRATION TEXT. What `create extension` installs is not
    expanded, and the dashboard, psql and seed scripts are never seen.
    Production's three `supabase_admin`-owned PostGIS `st_estimatedextent`
    overloads are SECURITY DEFINER and EXECUTE-able by anon and authenticated
    (measured 2026-09-18). No migration spells a CREATE FUNCTION for them; on a
    fresh build they arrive with `create extension if not exists postgis`
    (20260807001252_distributor_geo_foundation.sql:31, the corpus's only
    PostGIS install), which arm (c) does not expand. Whether production's
    copies came from that statement is not measured (`if not exists` makes it
    a no-op where PostGIS was already installed). OD-72 recorded all three and
    left them on purpose (20260825210000_od72_revoke_client_grants.sql:143-145).
    Production's `seed_sim_restaurant(jsonb)` was closed by no migration in
    this corpus. The end-state check excludes extension members as well, so
    these three are outside both.
  * REACH THROUGH ANOTHER OBJECT. A closed SECURITY DEFINER function fired as a
    trigger on a table a client may write, or used as the state function of an
    aggregate a client may EXECUTE, runs as its owner with no EXECUTE check
    against the caller (PR #391 verifier round 5, A3 and A9, measured on
    PGlite). This arm never reads what a trigger or an aggregate calls, and the
    end-state check judges EXECUTE only, so both pass both. Filed OPEN in
    v3.0-TECH-DEBT.md.

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
  * fewer than MIN_FN_CREATES function creates / MIN_SECDEF
    SECURITY DEFINER functions                                    -> 2  (pattern rot)
  * a `create function|procedure` the strict parser could not name -> 2
  * a `create function|procedure` in an EXECUTEd literal (or in a
    DO block inside one), or spelled -- whitespace alone between
    the words -- in another single-quoted or E'' literal in the
    file, in a dollar-quoted DO body or in an EXECUTEd literal     -> 2
  * a function GRANT/REVOKE whose target name cannot be read      -> 2
  * in an EXECUTEd literal, a function GRANT whose grantee is a `%`
    placeholder, or a GRANT to PUBLIC/anon/authenticated whose
    function name or privilege is one (see ARM (c), WHAT IT DOES)  -> 2
  * `alter routine ... security definer` on a routine no migration
    creates (function or procedure cannot be told apart)           -> 2
  * a migration that names schema `supabase_functions` (the local
    stack's platform; see ARM (c), WHAT IT DOES)                   -> 2
  * an FN_GRANDFATHERED entry that no longer suppresses anything,
    or FN_GRANDFATHERED longer than MAX_FN_GRANDFATHERED          -> 2  (shrink-only)
  * an FN_CLIENT_CALLABLE entry that excuses nothing, names PUBLIC,
    is not schema-qualified, or carries no ADR or no reason       -> 2

Exit 0 = clean.  Exit 1 = tables missing RLS and/or still client-granted, or a
SECURITY DEFINER function still EXECUTE-able by PUBLIC/anon/authenticated.
Exit 2 = the guard could not check.

`--self-test` proves arm (c) on a synthetic corpus built in a temp directory
(nothing read from the checkout): 76 fixture cases, both vacuity floors
(MIN_SECDEF, MIN_FN_CREATES) and the stale-grandfather path, each through
`main()` in a subprocess; the MAX_FN_GRANDFATHERED cap and 9 allowlist cases
through `main()` in-process with a temporary entry; and 6 E'' lexer cases
in-process (95 total; 89 before round 6 added the six platform-schema cases). It prints one line per case and closes with
`SELF-TEST OK -- <n> cases run, every one held: ...`, where <n> counts cases
EXECUTED, not cases listed. The closing line only counts; the case lines above
it are the claim. The CI self-test step asserts that line (n >= 95); the OD-72
CLAIMS row asserts it and the arm-(c) OK tally on the real tree (>= 7 SECURITY
DEFINER creates). Neither trusts the exit code alone -- a guard gutted to exit
0 prints neither line. [2026-09-18, round 4: 139 chosen single-rule mutations
of arm (c) and of the E'' lexer it relies on -- the earlier rounds' breaks, the
round-3 verifier's W1-W7, and one per rule the fixer listed -- each made
--self-test fail on a named case.] [CORRECTED 2026-09-18, round 5, source: PR
#391 verifier, round 4: that sweep was not exhaustive. Four more mutations
(reading every dollar-quoted body as static SQL; a DO statement recursing into
every dollar block; the create question dropping `procedure`; dropping `or
replace`) leave --self-test green. No completeness claim rests on the sweep.]

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

Usage:  python3 scripts/check_new_tables_are_locked_down.py [migrations_dir | --self-test]
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
#              An E'...' literal is stored DECODED (`\n`, `\'`, `\x41` ...),
#              because that decoded text is what EXECUTE would run.
#   blocks  -- (start, end) spans of dollar-quoted bodies, so a sweep can be
#              recognised as one block rather than as scattered text.
# --------------------------------------------------------------------------
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")
# One backslash escape inside an E'...' literal (PostgreSQL's escape-string syntax).
_E_ESCAPE = re.compile(r"\\(?:x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)", re.S)
_E_SIMPLE = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def _e_decode(esc: str) -> str:
    body = esc[1:]
    try:
        if body[0] in "xuU" and len(body) > 1:
            return chr(int(body[1:], 16))
        if body[0] in "01234567":
            return chr(int(body, 8))
    except ValueError:  # a code point past U+10FFFF: PostgreSQL rejects it too
        return "\ufffd"
    return _E_SIMPLE.get(body, body)


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

        # 'single quoted literal'  (blanked in `code`, captured in `strings`).
        # E'...' (an `E` that is not the tail of a longer word) takes backslash
        # escapes, so `\'` does not end it -- lexing it as a plain literal would
        # end the string early and desynchronise everything after it.
        if ch == "'":
            e_string = i > 0 and sql[i - 1] in "eE" and not (i > 1 and (sql[i - 2].isalnum() or sql[i - 2] in "_$"))
            j = i + 1
            buf: list[str] = []
            while j < n:
                if e_string and sql[j] == "\\" and j + 1 < n:
                    esc = _E_ESCAPE.match(sql, j)
                    buf.append(_e_decode(esc.group(0)))
                    j = esc.end()
                    continue
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


# ==========================================================================
# ARM (c) -- a fast LEXICAL pre-check: a SECURITY DEFINER function answers only to
# the server, as far as the migration text it reads shows. Not the authority:
# scripts/check_definer_functions_closed.py reads the built database (ADR 0159).
#
# Added 2026-09-18 (ADR 0159, corrected by the PR #391 audit). See the module
# docstring, section ARM (c), for the rule, the model and what it cannot see.
# ==========================================================================

# PUBLIC is a role here, not a keyword: PostgreSQL grants EXECUTE on every new
# function to PUBLIC, and anon/authenticated inherit whatever PUBLIC holds.
FN_CLIENT_ROLES = ("public", "anon", "authenticated")

# Vacuity floors. Measured on `feat/finish-leaks` at 2cb4f1fbc (2026-09-18):
#   138 `create [or replace] function|procedure` statements named across 185
#   files, 7 of them SECURITY DEFINER (2 in the baseline, 2 in the guest
#   identity slice, 2 procurement echo triggers, 1 experiment trigger).
MIN_FN_CREATES = 60
MIN_SECDEF = 5

# --------------------------------------------------------------------------
# GRANDFATHERED -- (file, function) pairs excused from the SAME-FILE rule only.
# SHRINK-ONLY, exactly like DEBT above: MAX_FN_GRANDFATHERED may be lowered,
# never raised, and an entry that no longer suppresses a same-file failure is a
# FAILURE (exit 2). A grandfathered function is NOT excused from the END-STATE
# rule -- some later migration must still have closed it, or the guard fails.
# --------------------------------------------------------------------------
MAX_FN_GRANDFATHERED = 2

FN_GRANDFATHERED: dict[str, dict[str, str]] = {
    "20260805000000_baseline_from_production.sql": {
        "public.increment_trust_counter": (
            "A dump of production taken without privileges, so it can carry no "
            "REVOKE. Closed by 20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql "
            "(revoke from public, anon, authenticated; grant to service_role)."
        ),
        "public.seed_sim_restaurant": (
            "Same dump, same reason, closed by the same 20260917010400 migration."
        ),
    },
}

# --------------------------------------------------------------------------
# CLIENT-CALLABLE -- SECURITY DEFINER functions a client role is MEANT to call.
#
# EMPTY ON PURPOSE. Measured 2026-09-18: no `.rpc(` and no `/rest/v1/rpc` in
# apps/web, apps/mobile or packages; the gateway calls RPCs with the
# service-role key; no production RLS policy calls a `public` function. So no
# SECURITY DEFINER function has a client caller to allowlist.
#
# The day one needs one, it is a decision, not a quiet GRANT: an entry names the
# function, the client roles it may stay EXECUTE-able by, and the ADR that
# decided it. It excuses rules (c1) and (c2) for exactly those roles. PUBLIC can
# never be allowlisted -- a grant to PUBLIC reaches every role that exists or
# will exist, so the migration must still revoke PUBLIC and GRANT the named
# role. An entry that no longer excuses anything (the function is gone, is no
# longer SECURITY DEFINER, or is closed to the listed roles anyway) is stale and
# the guard exits 2 until it is deleted.
#
#   "public.<f>": {"roles": {"authenticated"}, "adr": "NNNN", "reason": "..."}
# --------------------------------------------------------------------------
FN_CLIENT_CALLABLE: dict[str, dict] = {}

RE_FN_CREATE = re.compile(
    rf"\bcreate\s+(?P<replace>or\s+replace\s+)?(?P<kind>function|procedure)\s+{QNAME}\s*\(",
    re.I,
)
# Every `create function|procedure` at all -- the discrepancy against
# RE_FN_CREATE is what catches a create this parser cannot name.
RE_FN_CREATE_LOOSE = re.compile(r"\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b", re.I)
RE_FN_ALTER = re.compile(rf"\balter\s+(?P<kind>function|procedure|routine)\s+{QNAME}", re.I)
RE_SECDEF = re.compile(r"\bsecurity\s+definer\b", re.I)
RE_FN_DROP = re.compile(
    r"\bdrop\s+(?:function|procedure|routine)\s+(?:if\s+exists\s+)?(?P<names>.+?)"
    r"(?:\s+(?:cascade|restrict))?\s*$",
    re.I | re.S,
)
RE_FN_PRIV = re.compile(
    r"\b(?P<verb>grant|revoke)\s+(?P<gof>grant\s+option\s+for\s+)?(?P<privs>[^;]*?)\s+on\s+"
    r"(?:(?P<all>all\s+(?P<allkind>functions|routines|procedures)\s+in\s+schema)|(?:function|routine|procedure))\s+"
    r"(?P<names>.+?)\s+(?:to|from)\s+(?P<roles>.+?)\s*$",
    re.I | re.S,
)
RE_ROLE_TAIL = re.compile(r"\s+(?:cascade|restrict|with\s+grant\s+option|granted\s+by\s+\S+)\s*$", re.I)
RE_ADP = re.compile(
    r"\balter\s+default\s+privileges\b(?P<head>.*?)\b(?P<verb>grant|revoke)\b(?P<rest>.*)$",
    re.I | re.S,
)
RE_ADP_SCHEMAS = re.compile(r"\bin\s+schema\s+(?P<schemas>.+?)\s*$", re.I | re.S)
# An EXECUTEd literal -- SQL, not prose: a single-quoted, E'' or dollar-quoted literal
# whose only preceding tokens are `execute`, or `execute format(`. Whitespace and
# comments (already blanked in `view`) of ANY length may sit between them; nothing else
# may -- not a `(`, not an earlier argument, not a variable. Matched at the literal's
# opening quote (or tag) against the REVERSED view, so there is no look-back window to
# fall off and the cost does not grow with the statement. [2026-09-18, round 4, source:
# PR #391 verifier round 3: a 40-character look-back window missed a longer comment
# between `execute` and its literal.]
RE_EXECUTED_LITERAL_REV = re.compile(r"[Ee]?\s*(?:\(\s*tamrof\s*)?etucexe(?![A-Za-z0-9_$])", re.I)
RE_BARE_NAME = re.compile(rf"(?:{IDENT}\s*\.\s*)?{IDENT}")
# Which functions `ON ALL <kind> IN SCHEMA` reaches, as PostgreSQL defines it: ALL
# FUNCTIONS never reaches a procedure, ALL PROCEDURES never reaches a function.
ALL_KINDS = {"functions": {"function"}, "procedures": {"procedure"}, "routines": {"function", "procedure"}}


def _executed(rview: str, pos: int) -> bool:
    """Is the literal opening at `pos` of the (un-reversed) view an EXECUTEd literal?"""
    return RE_EXECUTED_LITERAL_REV.match(rview, len(rview) - pos) is not None


def _split_top(text: str) -> list[str]:
    """Split on commas that are not inside parentheses: `f(a, b), g()` -> 2."""
    parts, depth, cur = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def _mask_parens(text: str) -> str:
    """Blank what sits inside parentheses, keeping the length, so an argument type
    such as `interval day to second` cannot supply the `to`/`from` that ends a
    GRANT's function list (it did: the GRANT was read as naming `f(interval day`
    and granting to `second)`, and passed)."""
    out, depth = [], 0
    for ch in text:
        if ch == ")":
            depth -= 1
        out.append(ch if depth == 0 else "_")
        if ch == "(":
            depth += 1
    return "".join(out)


def _roles(text: str) -> set[str]:
    text = RE_ROLE_TAIL.sub("", text)
    return {r.strip().strip('"').lower() for r in text.split(",")} & set(FN_CLIENT_ROLES)


def _fn_names(text: str, where: str) -> list[str] | None:
    """`public.f(uuid, text), g` -> ['public.f', 'public.g']. None = dynamic (`%I`)."""
    out = []
    for chunk in _split_top(text):
        if "%" in chunk:
            return None  # a format() placeholder: a catalog sweep, never credited
        name = chunk.split("(", 1)[0].strip()
        if not RE_BARE_NAME.fullmatch(name):
            raise CannotCheck(
                f"{where}: cannot read the function name in `{chunk[:80]}`. A GRANT or REVOKE this "
                "parser cannot attribute is one that might be the only thing closing a function."
            )
        out.append(qualify(name))
    return out


def _fn_events(text: str, where: str, base: int, out: list, stats: dict, dynamic: bool = False) -> None:
    """Collect function events from one SQL text (a file, a DO body, or an EXECUTEd literal).

    `view` is `code` with dollar-quoted bodies blanked too, so a function BODY
    cannot supply a `security definer`, a `;`, or a phantom GRANT. Every `;` left
    in `view` therefore ends a statement.

    `dynamic` is True when `text` is a literal handed to EXECUTE (or a DO block
    inside one): a CREATE found there is decided at run time and is refused.
    """
    code, strings, blocks = lex(text, where)
    chars = list(code)
    for bs, be in blocks:
        for k in range(bs, be):
            if chars[k] != "\n":
                chars[k] = " "
    view = "".join(chars)
    rview = view[::-1]

    start = 0
    spans = []
    for k, ch in enumerate(view):
        if ch == ";":
            spans.append((start, k))
            start = k + 1
    spans.append((start, len(view)))

    for s, e in spans:
        stmt = view[s:e]

        strict = list(RE_FN_CREATE.finditer(stmt))
        loose = RE_FN_CREATE_LOOSE.findall(stmt)
        if len(loose) != len(strict):
            raise CannotCheck(
                f"{where}: found {len(loose)} `create function|procedure` in one statement near offset "
                f"{base + s} but could only NAME {len(strict)}. A function this parser cannot name is one "
                "it cannot vouch for."
            )
        for m in strict:
            if dynamic:
                raise CannotCheck(
                    f"{where}: a literal handed to EXECUTE creates `{qualify(m.group('name'))}` near offset "
                    f"{base + s + m.start()}. Its SECURITY DEFINER-ness and its grants are decided at run "
                    "time, so this guard cannot vouch for it -- write the CREATE statically."
                )
            stats["creates"] += 1
            out.append((base + s + m.start(), "create", qualify(m.group("name")),
                        (bool(RE_SECDEF.search(stmt, m.end())), bool(m.group("replace")), m.group("kind").lower())))

        m = RE_FN_ALTER.search(stmt)
        if m and RE_SECDEF.search(stmt, m.end()):
            out.append((base + s + m.start(), "alter_secdef", qualify(m.group("name")), m.group("kind").lower()))

        m = RE_FN_DROP.search(stmt)
        if m:
            names = _fn_names(m.group("names"), where)
            for n in names or ():
                out.append((base + s + m.start(), "drop", n, None))

        m = RE_FN_PRIV.search(_mask_parens(stmt))
        if m and m.group("gof"):
            # REVOKE GRANT OPTION FOR revokes only the right to re-grant: EXECUTE stays
            # standing (PGlite, 2026-09-18: `=X/postgres` unchanged). It closes nothing.
            m = None
        fn_list = stmt[m.start("names"):m.end("names")] if m else ""
        if m and m.group("verb").lower() == "grant" and (
            "%" in m.group("roles") or ("%" in m.group("privs") and _roles(m.group("roles")))
        ):
            # format() filling in the GRANTEE, or the privilege handed to a client
            # role: either could open any function to anon, and neither is known
            # until run time. A REVOKE shaped like this is merely not credited.
            raise CannotCheck(
                f"{where}: a function GRANT near offset {base + s} takes its grantee or its privilege "
                "from a run-time placeholder (`%`). This guard cannot tell whether it hands EXECUTE to "
                "PUBLIC, anon or authenticated -- write the role and the privilege statically."
            )
        if m and re.search(r"\b(?:execute|all)\b", m.group("privs"), re.I):
            roles = _roles(m.group("roles"))
            if roles:
                verb = m.group("verb").lower()
                if m.group("all"):
                    schemas = tuple(qualify(x).split(".", 1)[1] for x in _split_top(fn_list))
                    kinds = frozenset(ALL_KINDS[m.group("allkind").lower()])
                    out.append((base + s + m.start(), f"{verb}_all", (schemas, kinds), frozenset(roles)))
                else:
                    names = _fn_names(fn_list, where)
                    if names is None and verb == "grant":
                        # A dynamic REVOKE is merely not credited (the function stays
                        # open in the model). A dynamic GRANT to a client role could
                        # re-open ANY function, and ignoring it would pass a leak.
                        raise CannotCheck(
                            f"{where}: a GRANT near offset {base + s} hands EXECUTE to "
                            f"{', '.join(sorted(roles))} on a function named at run time (`%`). "
                            "This guard cannot tell which function it re-opens -- write it statically."
                        )
                    for n in names or ():
                        out.append((base + s + m.start(), verb, n, frozenset(roles)))

        m = RE_ADP.search(stmt)
        if m and re.search(r"\bon\s+(?:functions|routines)\b", m.group("rest"), re.I):
            sch = RE_ADP_SCHEMAS.search(m.group("head"))
            schemas = tuple(qualify(x).split(".", 1)[1] for x in _split_top(sch.group("schemas"))) if sch else ()
            roles = _roles(re.split(r"\b(?:to|from)\b", m.group("rest"), maxsplit=1, flags=re.I)[-1])
            out.append((base + s + m.start(), "adp_" + m.group("verb").lower(), schemas, frozenset(roles)))

        # Recurse into what actually runs at migration time, and into nothing else:
        # DO-block bodies, and EXECUTEd literals (RE_EXECUTED_LITERAL_REV) --
        # single-quoted, E'' (decoded by lex) or dollar-quoted. An EXECUTEd literal
        # is dynamic: a CREATE in it, or in a DO block inside it, is refused.
        # Everything else EXECUTE can run (a variable, `||`, concat(), a later
        # format() argument, `execute (...)`) is out of reach -- see KNOWN MISSES.
        if re.match(r"\s*do\b", stmt, re.I):
            for bs, be in blocks:
                if s <= bs < e:
                    _fn_events(text[bs:be], where, base + bs, out, stats, dynamic)
        for bs, be in blocks:
            if not (s <= bs < e):
                continue
            tag_start = bs - len(_DOLLAR_TAG.match(text, be).group(0))
            if _executed(rview, tag_start):
                _fn_events(text[bs:be], where, base + bs, out, stats, dynamic=True)
        for ls, _le, lit in strings:
            if not (s <= ls < e):
                continue
            # The one question asked of a literal that is NOT EXECUTEd: does its text
            # say `create [or replace] function|procedure`, whitespace alone between
            # the words? A comment or a concatenation between them hides it (KNOWN MISSES).
            if RE_FN_CREATE_LOOSE.search(lit):
                raise CannotCheck(
                    f"{where}: a string literal near offset {base + ls} creates a function "
                    "dynamically. Its SECURITY DEFINER-ness and its grants are decided at run time, "
                    "so this guard cannot vouch for it -- write the CREATE statically."
                )
            if _executed(rview, ls):
                _fn_events(lit, where, base + ls, out, stats, dynamic=True)


# --------------------------------------------------------------------------
# THE PLATFORM'S SCHEMA -- refused outright. [2026-09-18, round 6, source: PR #391
# verifier round 5, A1c.] `supabase_functions` belongs to the local stack (the pinned
# CLI's webhook.sql creates it and its one SECURITY DEFINER function), and the
# end-state check pins that function by identity. A migration that dropped it and
# recreated it as a callable definer granted to anon, with the create and the GRANT
# each held in a dollar-quoted variable, exited 0 here. This arm cannot tell what a
# migration does to that schema, so any migration that NAMES it is exit 2 -- the
# schema's name anywhere in code (comments aside; dollar-quoted bodies included) or
# inside any single-quoted or E'' literal, decoded, at any depth. No migration names
# it today (grep: 0 files). What this cannot see: a name assembled at run time
# (`'supabase_' || 'functions'`, a variable, format()), a U&"..." escaped identifier,
# or a search_path set from an expression. The identity pin in
# scripts/check_definer_functions_closed.py is what catches those.
# --------------------------------------------------------------------------
RE_PLATFORM_SCHEMA = re.compile(r"(?<![A-Za-z0-9_$])supabase_functions(?![A-Za-z0-9_$])", re.I)


def _platform_refs(text: str, where: str, base: int = 0) -> list[int]:
    """Offsets at which `text` names the platform schema: in code, in any single-quoted
    or E'' literal (decoded), and -- by lexing each dollar-quoted body again -- in the
    literals inside those bodies, decoded too."""
    code, strings, blocks = lex(text, where)
    hits = [base + m.start() for m in RE_PLATFORM_SCHEMA.finditer(code)]
    hits += [base + s for s, _e, lit in strings if RE_PLATFORM_SCHEMA.search(lit)]
    for bs, be in blocks:
        try:
            hits += _platform_refs(text[bs:be], where, base + bs)
        except CannotCheck:
            # A body that is not SQL (another language) need not lex. Its raw text is
            # already searched above, as part of `code`; only E'' decoding is lost.
            pass
    return sorted(hits)


def _cc_roles(name: str) -> set[str]:
    """The client roles FN_CLIENT_CALLABLE lets `name` stay EXECUTE-able by (usually none)."""
    return set(FN_CLIENT_CALLABLE.get(name, {}).get("roles", ()))


def _check_client_callable() -> None:
    """A malformed allowlist entry is one this guard cannot honour -- exit 2, never a guess."""
    for name, entry in FN_CLIENT_CALLABLE.items():
        roles = set(entry.get("roles", ()))
        if name != qualify(name):
            raise CannotCheck(f"FN_CLIENT_CALLABLE: `{name}` must be written schema-qualified and lower-case.")
        if not roles <= {"anon", "authenticated"}:
            # (An entry with NO roles excuses nothing, so the stale check refuses it.)
            raise CannotCheck(
                f"FN_CLIENT_CALLABLE: `{name}` roles {sorted(roles)} -- must be a subset of "
                "anon, authenticated. PUBLIC is never allowlisted: revoke it and GRANT the named role."
            )
        if not re.fullmatch(r"\d{4}", str(entry.get("adr", ""))) or not str(entry.get("reason", "")).strip():
            raise CannotCheck(
                f"FN_CLIENT_CALLABLE: `{name}` needs an `adr` (four digits) and a `reason`. A client-callable "
                "SECURITY DEFINER function is a decision, and the decision has a record."
            )


def analyse_functions(mig_dir: Path) -> dict:
    """Arm (c)'s replay. main() runs analyse() first, over the same files, so the
    MIN_FILES floor and the refusal of an unreadable or undecodable file are already
    enforced by the time this reads them."""
    _check_client_callable()
    files = sorted(mig_dir.glob("*.sql"), key=lambda p: p.name)

    stats = {"creates": 0}
    secdef_creates = 0
    tracked: dict[str, dict] = {}
    kinds: dict[str, str] = {}  # every function or procedure a migration creates -> its kind
    same_file_fail: list[tuple[str, int, str, list[str]]] = []
    grandfather_used: set[tuple[str, str]] = set()
    adp_public_granted: set[str] = set()
    adp_noop: list[str] = []

    for path in files:
        raw = path.read_text(encoding="utf-8")
        refs = _platform_refs(raw, path.name)
        if refs:
            raise CannotCheck(
                f"{path.name}:{line_of(raw, refs[0])}: names schema supabase_functions. That schema is the "
                "local stack's platform (the pinned CLI's webhook.sql), and the end-state check pins its one "
                "SECURITY DEFINER function by identity. A migration that creates, replaces, drops, alters or "
                "grants on anything there is refused by this pre-check, which cannot tell what the SQL does to "
                "it: that needs an ADR, and this rule changes in the same diff (ADR 0159)."
            )
        events: list = []
        _fn_events(raw, path.name, 0, events, stats)
        events.sort(key=lambda ev: ev[0])
        created_here: dict[str, int] = {}

        for pos, kind, arg, extra in events:
            if kind in ("create", "alter_secdef"):
                if kind == "create":
                    secdef, replace, fkind = extra
                    kinds[arg] = fkind
                else:
                    # ALTER ... SECURITY DEFINER. Its kind decides which ON ALL
                    # <kind> IN SCHEMA revoke reaches it; ALTER ROUTINE names none.
                    secdef, replace = True, True
                    fkind = kinds.get(arg) or {"function": "function", "procedure": "procedure"}.get(extra)
                    if fkind is None:
                        raise CannotCheck(
                            f"{path.name}:{line_of(raw, pos)}: ALTER ROUTINE {arg} ... SECURITY DEFINER, and no "
                            "migration creates it, so this guard cannot tell a function from a procedure "
                            "(ON ALL FUNCTIONS never reaches a procedure) -- write ALTER FUNCTION or ALTER PROCEDURE."
                        )
                if secdef:
                    secdef_creates += 1
                    tracked[arg] = {"file": path.name, "line": line_of(raw, pos),
                                    "open": set(FN_CLIENT_ROLES), "kind": fkind}
                    created_here[arg] = line_of(raw, pos)
                elif replace:
                    # replaced as SECURITY INVOKER: no longer in this arm's scope
                    tracked.pop(arg, None)
            elif kind == "drop":
                tracked.pop(arg, None)
            elif kind in ("revoke", "grant"):
                if arg in tracked:
                    op = tracked[arg]["open"]
                    op.difference_update(extra) if kind == "revoke" else op.update(extra)
                    if kind == "grant":
                        tracked[arg]["regranted_in"] = f"{path.name}:{line_of(raw, pos)}"
            elif kind in ("revoke_all", "grant_all"):
                schemas, reach = arg
                for name, st in tracked.items():
                    if name.split(".", 1)[0] in schemas and st["kind"] in reach:
                        st["open"].difference_update(extra) if kind == "revoke_all" else st["open"].update(extra)
                        if kind == "grant_all":
                            st["regranted_in"] = f"{path.name}:{line_of(raw, pos)}"
            elif kind == "adp_grant" and "public" in extra:
                adp_public_granted.update(arg)
            elif kind == "adp_revoke" and "public" in extra:
                # PostgreSQL: a per-schema default can only take away what a
                # per-schema default granted; it cannot remove the built-in
                # EXECUTE-to-PUBLIC. Without a matching per-schema grant this is
                # a no-op that reads like a fix -- ADR 0159's original decision.
                if not set(arg) <= adp_public_granted:
                    adp_noop.append(f"{path.name}:{line_of(raw, pos)}")

        for name, line in created_here.items():
            st = tracked.get(name)
            open_ = (st["open"] - _cc_roles(name)) if st else set()
            if not open_:
                continue
            if name in FN_GRANDFATHERED.get(path.name, {}):
                grandfather_used.add((path.name, name))
                continue
            same_file_fail.append((path.name, line, name, sorted(open_)))

    if stats["creates"] < MIN_FN_CREATES:
        raise CannotCheck(
            f"only {stats['creates']} CREATE FUNCTION/PROCEDURE statement(s) parsed (floor is "
            f"{MIN_FN_CREATES}). The pattern has rotted or the corpus is not what arm (c) was measured against."
        )
    if secdef_creates < MIN_SECDEF:
        raise CannotCheck(
            f"only {secdef_creates} SECURITY DEFINER function(s) found (floor is {MIN_SECDEF}). "
            "Arm (c) cannot be trusted to recognise one."
        )

    stale = [
        f"{f} :: {n} -- it no longer fails the same-file rule on its own"
        for f, names in FN_GRANDFATHERED.items()
        for n in names
        if (f, n) not in grandfather_used
    ]
    end_state_fail = sorted(
        (n, st["file"], st["line"], sorted(st["open"] - _cc_roles(n)), st.get("regranted_in"))
        for n, st in tracked.items()
        if st["open"] - _cc_roles(n)
    )
    # An allowlist entry must still be excusing something at the END of the
    # corpus, or it is stale: the function is gone, no longer SECURITY DEFINER,
    # or already closed to the roles it names.
    stale += [
        f"FN_CLIENT_CALLABLE :: {n} -- it no longer excuses anything (not a live SECURITY DEFINER "
        f"function EXECUTE-able by {', '.join(sorted(_cc_roles(n)))})"
        for n in FN_CLIENT_CALLABLE
        if not (n in tracked and tracked[n]["open"] & _cc_roles(n))
    ]
    return {
        "creates": stats["creates"],
        "secdef": secdef_creates,
        "live_secdef": len(tracked),
        "same_file_fail": same_file_fail,
        "end_state_fail": end_state_fail,
        "adp_noop": adp_noop,
        "stale": stale,
    }


def report_functions(res: dict) -> int:
    """Arm (c)'s verdict. 0 clean, 1 failed, 2 could not check (stale grandfathering)."""
    n_gf = sum(len(v) for v in FN_GRANDFATHERED.values())
    if n_gf > MAX_FN_GRANDFATHERED:
        print(
            f"CANNOT CHECK: FN_GRANDFATHERED holds {n_gf} entries but MAX_FN_GRANDFATHERED is "
            f"{MAX_FN_GRANDFATHERED}. This list is shrink-only; raising the cap is not the fix.",
            file=sys.stderr,
        )
        return 2
    if res["stale"]:
        print("CANNOT CHECK: stale FN_GRANDFATHERED / FN_CLIENT_CALLABLE entries. Delete them; an entry that "
              "excuses nothing may not stay.", file=sys.stderr)
        for s in res["stale"]:
            print(f"  - {s}", file=sys.stderr)
        return 2

    scope = (
        f"{res['creates']} CREATE FUNCTION/PROCEDURE, {res['secdef']} SECURITY DEFINER create(s), "
        f"{res['live_secdef']} live SECURITY DEFINER function(s), {n_gf}/{MAX_FN_GRANDFATHERED} grandfathered, "
        f"{len(FN_CLIENT_CALLABLE)} allowlisted as client-callable."
    )
    if not (res["same_file_fail"] or res["end_state_fail"] or res["adp_noop"]):
        # [CORRECTED 2026-09-18, round 6, source: PR #391 verifier round 5: this line said "no open
        # SECURITY DEFINER function in the migration text it reads", which its own KNOWN MISSES and
        # replay rows 51-53 contradict. It now says only what the self-test proves.]
        print(f"OK: arm (c) pre-check -- found none of the open-definer shapes its --self-test names "
              f"(not a proof: see KNOWN MISSES; the end-state check in schema-parity.yml decides). {scope}")
        return 0

    print("FAIL: SECURITY DEFINER function(s) left callable by PUBLIC/anon/authenticated.\n")
    print(f"Scope: {scope}\n")
    if res["same_file_fail"]:
        print(f"(c1) NOT CLOSED IN THE MIGRATION THAT CREATES IT -- {len(res['same_file_fail'])}:")
        for f, line, n, open_ in res["same_file_fail"]:
            print(f"      {n:44s} {f}:{line}  still EXECUTE-able by {', '.join(open_)}")
        print()
    if res["end_state_fail"]:
        print(f"(c2) STILL CLIENT-EXECUTABLE WHEN THE CORPUS FINISHES -- {len(res['end_state_fail'])}:")
        for n, f, line, open_, regrant in res["end_state_fail"]:
            why = f"re-granted at {regrant}" if regrant else f"created at {f}:{line}, never fully revoked"
            print(f"      {n:44s} EXECUTE-able by {', '.join(open_)}  ({why})")
        print()
    if res["adp_noop"]:
        print("(c3) A PER-SCHEMA DEFAULT REVOKE FROM PUBLIC ON FUNCTIONS -- a no-op that reads like a fix:")
        for loc in res["adp_noop"]:
            print(f"      {loc}")
        print(
            "      `ALTER DEFAULT PRIVILEGES IN SCHEMA s REVOKE ... ON FUNCTIONS FROM PUBLIC` can only\n"
            "      undo a per-schema GRANT; it cannot remove PostgreSQL's built-in EXECUTE-to-PUBLIC.\n"
            "      A function created after it still ships `=X/<owner>` (ADR 0159, 2026-09-18 correction).\n"
        )
    print(
        "Fix in the migration that CREATES (or REPLACEs, or ALTERs to) the SECURITY DEFINER function:\n\n"
        "    REVOKE EXECUTE ON FUNCTION public.<f>(<args>) FROM PUBLIC, anon, authenticated;\n"
        "    GRANT EXECUTE ON FUNCTION public.<f>(<args>) TO service_role;\n\n"
        "Revoking from anon and authenticated alone is the OD-72 bug: both inherit PUBLIC's grant."
    )
    return 1


# --------------------------------------------------------------------------
# --self-test: prove every arm-(c) path on a synthetic corpus. Nothing is read
# from the enclosing checkout -- a self-test that can see the real repository
# can be made to pass by the real repository. The fixture also satisfies the
# table arm's floors and DEBT, so each case exercises `main()` end to end.
# --------------------------------------------------------------------------
def _st_corpus(root: Path, secdef_filler: bool = True, invoker_filler: bool = True) -> None:
    for i in range(55):
        body = []
        for k in range(3):
            t = f"public.t_{i}_{k}"
            body.append(f"create table {t} (id int);\nalter table {t} enable row level security;\n"
                        f"revoke all on {t} from anon, authenticated;\n")
        if invoker_filler:
            body.append(f"create or replace function public.inv_{i}_a() returns int language sql as $$ select 1 $$;\n")
            body.append(f"create function public.inv_{i}_b(p int) returns int\n  language plpgsql\n"
                        f"  as $f$ begin return p; end $f$;\n")
        if secdef_filler and i < 5:
            f = f"public.sd_{i}"
            if i % 2:
                body.append(f"create or replace function {f}(uuid) returns void\n  language plpgsql\n"
                            f"  security definer\n  set search_path = public\n  as $$ begin null; end $$;\n"
                            f"revoke all on function {f}(uuid) from public;\n"
                            f"revoke all on function {f}(uuid) from anon, authenticated;\n")
            else:
                body.append(f"create function {f}() returns int as $$ select 1 $$ language sql security definer;\n"
                            f"revoke execute on function {f}() from public, anon, authenticated;\n"
                            f"grant execute on function {f}() to service_role;\n")
        (root / f"20260810{i:06d}_filler_{i}.sql").write_text("".join(body), encoding="utf-8")
    # The table arm's one DEBT entry must genuinely suppress something.
    (root / "20260801000000_sommelier.sql").write_text(
        "create table public.sommelier_conversations (id int);\n"
        "alter table public.sommelier_conversations enable row level security;\n", encoding="utf-8")
    # The grandfathered pairs, mirrored: created unrevoked, closed by a LATER file
    # through EXECUTEd literals inside a DO block -- the real closing shape.
    closes = []
    for fname, names in FN_GRANDFATHERED.items():
        (root / fname).write_text("".join(
            f"CREATE FUNCTION {n}(p uuid) RETURNS void\n    LANGUAGE plpgsql SECURITY DEFINER\n"
            f"    AS $$ begin null; end $$;\n" for n in names), encoding="utf-8")
        closes += [f"    execute 'revoke execute on function {n}(uuid) from public, anon, authenticated';\n"
                   f"    execute 'grant execute on function {n}(uuid) to service_role';\n" for n in names]
    (root / "20260917010400_closer.sql").write_text(
        "do $$\nbegin\n" + "".join(closes) + "end\n$$;\n", encoding="utf-8")


_ST_CASES: list[tuple[str, int, str | tuple[str, ...] | None, dict[str, str | None]]] = [
    # (label, expected exit, what the output must name (a string, or a tuple of them all),
    #  {filename: content|None to delete})
    ("clean corpus (and the OK line claims only what this self-test proves)", 0,
     "OK: arm (c) pre-check -- found none of the open-definer shapes its --self-test names (not a proof", {}),
    ("SECURITY DEFINER with no revoke", 1, "public.leak_a",
     {"20260920000000_c.sql": "create function public.leak_a() returns int language sql security definer as $$ select 1 $$;"}),
    ("revoked from anon+authenticated only -- the OD-72 shape", 1, "public.leak_b",
     {"20260920000000_c.sql": "create or replace function public.leak_b() returns int\n language sql\n security definer\n"
                              " as $$ select 1 $$;\nrevoke all on function public.leak_b() from anon, authenticated;"}),
    ("attributes after the body, no revoke", 1, "public.leak_c",
     {"20260920000000_c.sql": "create function public.leak_c(a int, b text) returns int as $body$\n"
                              "  select 1 -- ; security invoker\n$body$ language sql stable security definer;"}),
    ("closed where created, re-opened by a later GRANT", 1, ("public.sd_0", "re-granted at 20260920000000_c.sql:1"),
     {"20260920000000_c.sql": "grant execute on function public.sd_0() to authenticated;"}),
    ("created open, closed only by a LATER file (same-file rule)", 1, "public.late",
     {"20260920000000_c.sql": "create function public.late() returns int language sql security definer as $$ select 1 $$;",
      "20260921000000_d.sql": "revoke execute on function public.late() from public, anon, authenticated;"}),
    ("per-schema default revoke from PUBLIC (the no-op)", 1, "20260920000000_c.sql",
     {"20260920000000_c.sql": "alter default privileges in schema public\n  revoke execute on functions from public;"}),
    ("static create inside a DO block, no revoke", 1, "public.leak_d",
     {"20260920000000_c.sql": "do $$ begin\n create function public.leak_d() returns int language sql security definer"
                              " as $fn$ select 1 $fn$;\nend $$;"}),
    ("ALTER FUNCTION ... SECURITY DEFINER, no revoke", 1, "public.inv_3_a",
     {"20260920000000_c.sql": "alter function public.inv_3_a() security definer;"}),
    ("grandfathered function's closing revoke drops PUBLIC", 1, None,
     {"20260917010400_closer.sql": "do $$ begin\n" + "".join(
         f" execute 'revoke execute on function {n}(uuid) from anon, authenticated';\n"
         for names in FN_GRANDFATHERED.values() for n in names) + "end $$;"}),
    ("grandfathered functions never closed", 1, "never fully revoked", {"20260917010400_closer.sql": None}),
    ("closed in the same file by ON ALL FUNCTIONS IN SCHEMA", 0, None,
     {"20260920000000_c.sql": "create function public.ok_all() returns int language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on all functions in schema public from public, anon, authenticated;"}),
    ("create hidden in an EXECUTEd literal", 2, None,
     {"20260920000000_c.sql": "do $$ begin execute 'create function public.dyn() returns int language sql "
                              "security definer as ''select 1'''; end $$;"}),
    ("GRANT to a client role on a function named at run time", 2, None,
     {"20260920000000_c.sql": "do $$ begin execute format('grant execute on function public.%I() to anon', "
                              "'sd_0'); end $$;"}),
    # Added 2026-09-18 (PR #391 verifier): each of the next seven kills a break to
    # the guard that the fourteen above let pass -- see the ADR 0159 mutation table.
    ("closed where created, re-opened by GRANT ON ALL FUNCTIONS IN SCHEMA", 1,
     ("public.sd_0", "re-granted at 20260920000000_c.sql:1"),
     {"20260920000000_c.sql": "grant execute on all functions in schema public to anon;"}),
    ("re-opened by a GRANT carrying a GRANTED BY tail", 1, "public.sd_0",
     {"20260920000000_c.sql": "grant execute on function public.sd_0() to authenticated granted by postgres;"}),
    ("re-opened by a GRANT to a quoted role", 1, "public.sd_0",
     {"20260920000000_c.sql": 'grant execute on function public.sd_0() to "anon";'}),
    ("closed where created by a revoke naming quoted \"public\"", 0, None,
     {"20260920000000_c.sql": "create function public.ok_q() returns int language sql security definer as $$ select 1 $$;\n"
                              'revoke execute on function public.ok_q() from "public", anon, authenticated;'}),
    ("a create function the parser cannot name (non-ASCII identifier)", 2, "`create function|procedure` in one statement",
     {"20260920000000_c.sql": "create function public.café() returns int language sql security definer as $$ select 1 $$;"}),
    ("SECURITY DEFINER created open, dropped in the same file (DROP FUNCTION IF EXISTS ... CASCADE)", 0, None,
     {"20260920000000_c.sql": "create function public.gone() returns int language sql security definer as $$ select 1 $$;\n"
                              "drop function if exists public.gone cascade;"}),
    ("SECURITY DEFINER replaced as SECURITY INVOKER in the same file", 0, None,
     {"20260920000000_c.sql": "create function public.flip() returns int language sql security definer as $$ select 1 $$;\n"
                              "create or replace function public.flip() returns int language sql as $$ select 2 $$;"}),
    # Added 2026-09-18 (PR #391 verifier, round 2): shapes that passed silently.
    # Each of the next ten kills a break to the guard that the 21 above let pass.
    ("re-opened by a GRANT in a dollar-quoted literal handed to EXECUTE", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute $g$grant execute on function public.sd_0() to anon$g$; end $$;"}),
    ("re-opened by a GRANT in an E'' literal handed to EXECUTE", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute E'grant execute on function public.sd_0() to anon'; end $$;"}),
    ("re-opened by an e'' (lower-case) GRANT that only reads right once \\n and \\' are decoded", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute e'grant execute on function public.sd_0()\\nto anon -- it\\'s'; end $$;"}),
    ("create hidden in a dollar-quoted literal handed to EXECUTE", 2, "creates `public.dyn`",
     {"20260920000000_c.sql": "do $$ begin execute $f$create function public.dyn() returns int language sql "
                              "security definer as 'select 1'$f$; end $$;"}),
    ("create held in a single-quoted variable, EXECUTEd later", 2, "creates a function dynamically",
     {"20260920000000_c.sql": "do $$ declare s text := 'create function public.dyn() returns int language sql "
                              "security definer as ''select 1'''; begin execute s; end $$;"}),
    ("GRANT whose grantee is a format() placeholder", 2, "grantee or its privilege",
     {"20260920000000_c.sql": "do $$ begin execute format('grant execute on function public.sd_0() to %I', "
                              "'anon'); end $$;"}),
    ("GRANT to a client role whose privilege is a format() placeholder", 2, "grantee or its privilege",
     {"20260920000000_c.sql": "do $$ begin execute format('grant %s on function public.sd_0() to anon', "
                              "'execute'); end $$;"}),
    ("a REVOKE whose ROLE is a format() placeholder is neither credited nor refused", 1, "public.dr",
     {"20260920000000_c.sql": "create function public.dr() returns int language sql security definer as $$ select 1 $$;\n"
                              "do $$ begin execute format('revoke execute on function public.dr() from %I', "
                              "'public'); end $$;"}),
    ("closed by a revoke whose argument type contains ' to '", 0, None,
     {"20260920000000_c.sql": "create function public.iv(p interval day to second) returns int language sql "
                              "security definer as $$ select 1 $$;\nrevoke execute on function "
                              "public.iv(interval day to second) from public, anon, authenticated;"}),
    ("re-opened by a GRANT whose argument type contains ' to '", 1, "public.iv",
     {"20260920000000_c.sql": "create function public.iv(p interval day to second) returns int language sql "
                              "security definer as $$ select 1 $$;\nrevoke execute on function public.iv "
                              "from public, anon, authenticated;\ngrant execute on function "
                              "public.iv(interval day to second) to anon;"}),
    # Added 2026-09-18, round 4. Sources: PR #391 verifier round 3 (its W1-W7 mutations
    # and the V1 comment), and this round's rule-by-rule mutation sweep over arm (c).
    # Each case below pins one rule: without the case, a mutation that deletes or
    # weakens that rule leaves --self-test green.
    # -- the E'' lexer, end to end
    ("an E opens an E'' literal only when no letter, digit, _ or $ precedes it (else'\\' must not swallow the GRANT)",
     1, "public.sd_0",
     {"20260920000000_c.sql": "select case when true then 'a' else'\\' end;\n"
                              "grant execute on function public.sd_0() to anon; -- the grant's own comment"}),
    ("re-opened by an E'' GRANT whose role is spelled with hex, octal and \\u escapes", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute E'grant execute on function public.sd_0() to "
                              "\\x61n\\157\\u006e'; end $$;"}),
    # -- what is an EXECUTEd literal, and what is not
    ("re-opened by a GRANT in an EXECUTEd literal with a long comment between execute and the literal", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute /* re-open for the public landing page; reviewed by ops, see the "
                              "runbook entry for the day */\n    'grant execute on function public.sd_0() to anon'; end $$;"}),
    ("re-opened by a GRANT in an E'' literal handed to execute format(", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute format(E'grant execute on function public.sd_0() to anon'); end $$;"}),
    ("re-opened by a GRANT in a dollar-quoted literal handed to execute format(", 1, "public.sd_0",
     {"20260920000000_c.sql": "do $$ begin execute format($g$grant execute on function public.sd_0() to anon$g$); "
                              "end $$;"}),
    ("a GRANT spelled in a literal nothing EXECUTEs (a RAISE message) is prose, not SQL", 0, None,
     {"20260920000000_c.sql": "do $$ begin raise notice 'grant execute on function public.sd_0() to anon'; end $$;"}),
    ("a literal after a word that only ends in `execute` (a typed literal) is not EXECUTEd", 0, None,
     {"20260920000000_c.sql": "select public.reexecute 'grant execute on function public.sd_0() to anon';"}),
    # -- dynamic creates
    ("create inside a DO block inside a dollar-quoted EXECUTEd literal", 2, "creates `public.dyn`",
     {"20260920000000_c.sql": "do $o$ begin execute $x$ do $y$ begin create function public.dyn() returns int "
                              "language sql security definer as 'select 1'; end $y$ $x$; end $o$;"}),
    ("create hidden behind a comment inside an EXECUTEd literal", 2, "creates `public.dyn`",
     {"20260920000000_c.sql": "do $$ begin execute 'create /* c */ function public.dyn() returns int language sql "
                              "security definer as ''select 1'''; end $$;"}),
    # -- format() placeholders
    ("a GRANT to service_role whose privilege is a format() placeholder is not refused", 0, None,
     {"20260920000000_c.sql": "do $$ begin execute format('grant %s on function public.sd_0() to service_role', "
                              "'execute'); end $$;"}),
    ("a GRANT to service_role on a function named at run time is not refused", 0, None,
     {"20260920000000_c.sql": "do $$ begin execute format('grant execute on function public.%I() to service_role', "
                              "'sd_0'); end $$;"}),
    ("a REVOKE whose FUNCTION NAME is a format() placeholder is neither credited nor refused", 1, "public.dr",
     {"20260920000000_c.sql": "create function public.dr() returns int language sql security definer as $$ select 1 $$;\n"
                              "do $$ begin execute format('revoke execute on function public.%I() from public, anon, "
                              "authenticated', 'dr'); end $$;"}),
    ("a REVOKE whose PRIVILEGE is a format() placeholder is not credited", 1, "public.dr",
     {"20260920000000_c.sql": "create function public.dr() returns int language sql security definer as $$ select 1 $$;\n"
                              "do $$ begin execute format('revoke %s on function public.dr() from public, anon, "
                              "authenticated', 'execute'); end $$;"}),
    # -- GRANT OPTION FOR, and which kinds ON ALL ... IN SCHEMA reaches
    ("REVOKE GRANT OPTION FOR leaves EXECUTE standing: it does not close the function", 1, "public.gof",
     {"20260920000000_c.sql": "create function public.gof() returns int language sql security definer as $$ select 1 $$;\n"
                              "revoke grant option for execute on function public.gof() from public, anon, authenticated;"}),
    ("SECURITY DEFINER procedure with no revoke", 1, "public.pr",
     {"20260920000000_c.sql": "create procedure public.pr() language sql security definer as $$ select 1 $$;"}),
    ("procedure closed where created by REVOKE ... ON PROCEDURE", 0, None,
     {"20260920000000_c.sql": "create procedure public.pr() language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on procedure public.pr() from public, anon, authenticated;"}),
    ("closed where created by REVOKE ... ON ROUTINE", 0, None,
     {"20260920000000_c.sql": "create function public.rt() returns int language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on routine public.rt() from public, anon, authenticated;"}),
    ("a function is not closed by REVOKE ... ON ALL PROCEDURES IN SCHEMA", 1, "public.k1",
     {"20260920000000_c.sql": "create function public.k1() returns int language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on all procedures in schema public from public, anon, authenticated;"}),
    ("a procedure is not closed by REVOKE ... ON ALL FUNCTIONS IN SCHEMA", 1, "public.k3",
     {"20260920000000_c.sql": "create procedure public.k3() language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on all functions in schema public from public, anon, authenticated;"}),
    ("a procedure closed where created by REVOKE ... ON ALL PROCEDURES IN SCHEMA", 0, None,
     {"20260920000000_c.sql": "create procedure public.k5() language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on all procedures in schema public from public, anon, authenticated;"}),
    ("a function and a procedure closed where created by REVOKE ... ON ALL ROUTINES IN SCHEMA", 0, None,
     {"20260920000000_c.sql": "create function public.k2f() returns int language sql security definer as $$ select 1 $$;\n"
                              "create procedure public.k2p() language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on all routines in schema public from public, anon, authenticated;"}),
    ("GRANT ... ON ALL PROCEDURES IN SCHEMA does not re-open a function", 0, None,
     {"20260920000000_c.sql": "grant execute on all procedures in schema public to anon;"}),
    ("REVOKE ... ON ALL FUNCTIONS IN SCHEMA of another schema does not close a public function", 1, "public.os",
     {"20260920000000_c.sql": "create function public.os() returns int language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on all functions in schema other from public, anon, authenticated;"}),
    # -- ALTER and DROP, each kind
    ("ALTER ROUTINE ... SECURITY DEFINER on a function created as invoker, no revoke", 1, "public.inv_3_a",
     {"20260920000000_c.sql": "alter routine public.inv_3_a() security definer;"}),
    ("ALTER PROCEDURE ... SECURITY DEFINER, no revoke", 1, "public.ap",
     {"20260920000000_c.sql": "create procedure public.ap() language sql as $$ select 1 $$;\n"
                              "alter procedure public.ap() security definer;"}),
    ("ALTER ROUTINE ... SECURITY DEFINER on a routine no migration creates (its kind is unknown)", 2,
     "ALTER ROUTINE public.never_made",
     {"20260920000000_c.sql": "alter routine public.never_made() security definer;"}),
    ("SECURITY DEFINER procedure created open, dropped by DROP PROCEDURE", 0, None,
     {"20260920000000_c.sql": "create procedure public.dp() language sql security definer as $$ select 1 $$;\n"
                              "drop procedure public.dp();"}),
    ("SECURITY DEFINER function created open, dropped by DROP ROUTINE ... RESTRICT", 0, None,
     {"20260920000000_c.sql": "create function public.dro() returns int language sql security definer as $$ select 1 $$;\n"
                              "drop routine public.dro restrict;"}),
    # -- reading roles and names
    ("closed where created by a REVOKE with a CASCADE tail", 0, None,
     {"20260920000000_c.sql": "create function public.tc() returns int language sql security definer as $$ select 1 $$;\n"
                              "revoke execute on function public.tc() from public, anon, authenticated cascade;"}),
    ("re-opened by a GRANT ... WITH GRANT OPTION", 1, "public.sd_0",
     {"20260920000000_c.sql": "grant execute on function public.sd_0() to anon with grant option;"}),
    ("re-opened by a GRANT to an upper-case, unquoted role", 1, "public.sd_0",
     {"20260920000000_c.sql": "grant execute on function public.sd_0() to ANON;"}),
    ("re-opened by a GRANT naming the function unqualified", 1, "public.sd_0",
     {"20260920000000_c.sql": "grant execute on function sd_0() to anon;"}),
    ("a GRANT whose function name cannot be read", 2, "cannot read the function name",
     {"20260920000000_c.sql": "grant execute on function public.café() to anon;"}),
    ("two SECURITY DEFINER functions, one with a two-argument signature, closed by one REVOKE ... RESTRICT", 0, None,
     {"20260920000000_c.sql": "create function public.m1(a int, b text) returns int language sql security definer "
                              "as $$ select 1 $$;\ncreate function public.m2() returns int language sql security definer "
                              "as $$ select 1 $$;\nrevoke execute on function public.m1(int, text), public.m2() "
                              "from public, anon, authenticated restrict;"}),
    ("a new SECURITY INVOKER overload does not un-track the open SECURITY DEFINER one", 1, "public.ov",
     {"20260920000000_c.sql": "create function public.ov(p uuid) returns int language sql security definer "
                              "as $$ select 1 $$;\ncreate function public.ov(p text) returns int language sql as $$ select 1 $$;"}),
    # -- (c3): the per-schema default revoke from PUBLIC, and what it is not
    ("per-schema default revoke from PUBLIC ON ROUTINES (the same no-op)", 1, ("(c3)", "20260920000000_c.sql:1"),
     {"20260920000000_c.sql": "alter default privileges in schema public\n  revoke execute on routines from public;"}),
    ("per-schema default revoke from PUBLIC after a per-schema default GRANT to PUBLIC (it undoes that)", 0, None,
     {"20260920000000_c.sql": "alter default privileges in schema public grant execute on functions to public;\n"
                              "alter default privileges in schema public revoke execute on functions from public;"}),
    ("per-schema default revoke from anon and authenticated only (OD-72's own) is not flagged", 0, None,
     {"20260920000000_c.sql": "alter default privileges in schema public revoke all on functions from anon, "
                              "authenticated;"}),
    ("global default revoke from PUBLIC (no IN SCHEMA: ADR 0159 option 2b) is not flagged", 0, None,
     {"20260920000000_c.sql": "alter default privileges for role postgres revoke execute on functions from public;"}),
    # Added 2026-09-18, round 6 (PR #391 verifier round 5, A1/A1b/A1c): the platform's
    # schema is refused outright, however the migration spells its name.
    ("A1: the platform webhook dropped and recreated callable, in plain SQL", 2,
     "20260920000000_c.sql:1: names schema supabase_functions",
     {"20260920000000_c.sql": "drop function supabase_functions.http_request();\n"
                              "create function supabase_functions.http_request() returns jsonb language sql "
                              "security definer as $$ select '{}'::jsonb $$;\n"
                              "revoke all on function supabase_functions.http_request() from public;\n"
                              "grant execute on function supabase_functions.http_request() to anon, authenticated;"}),
    ("A1c: the create and the GRANT each held in a dollar-quoted variable (the drop on line 2)", 2,
     "20260920000000_c.sql:2: names schema supabase_functions",
     {"20260920000000_c.sql": "select 1;\n"
                              "do $x$ declare s text := $q$drop function supabase_functions.http_request()$q$; "
                              "begin execute s; end $x$;\n"
                              "do $x$ declare s text := $q$create function supabase_functions.http_request() returns "
                              "jsonb language sql security definer as $b$ select '{}'::jsonb $b$$q$; begin execute s; "
                              "end $x$;"}),
    ("ALTER on the platform function, quoted upper-case schema", 2, "names schema supabase_functions",
     {"20260920000000_c.sql": 'ALTER FUNCTION "SUPABASE_FUNCTIONS".http_request() OWNER TO postgres;'}),
    ("the schema named only inside a single-quoted literal (a search_path), then an unqualified drop", 2,
     "names schema supabase_functions",
     {"20260920000000_c.sql": "select set_config('search_path', 'supabase_functions', false);\n"
                              "drop function http_request();"}),
    ("the schema named only through an E'' escape, inside a DO body", 2, "names schema supabase_functions",
     {"20260920000000_c.sql": "do $$ begin execute E'drop function supabase\\x5ffunctions.http_request()'; end $$;"}),
    ("the schema named only in a comment -> not refused", 0, None,
     {"20260920000000_c.sql": "-- supabase_functions belongs to the platform; nothing here touches it\nselect 1;"}),
]

# The E'' lexer, in-process: (label, SQL, the literal contents lex() must return, in order).
# Each decode rule is pinned here even where no verdict can show it (`\b` is not whitespace).
_LEX_CASES: list[tuple[str, str, list[str]]] = [
    ("E'' simple escapes \\b \\f \\n \\r \\t decode", "select E'\\b\\f\\n\\r\\t';", ["\b\f\n\r\t"]),
    ("E'' hex escapes: two digits, one digit, and \\x with none", "select E'\\x41\\x9\\xz';", ["A\txz"]),
    ("e'' octal escapes: three, two and one digit", "select e'\\101\\41\\7';", ["A!\x07"]),
    ("E'' \\u and \\U escapes, and a code point past U+10FFFF", "select E'\\u0041\\U00000041\\U00110000';",
     ["AA�"]),
    ("E'' backslash-quote, backslash-backslash and a doubled quote", "select E'it\\'s \\\\ it''s';", ["it's \\ it's"]),
    ("an E or e opens an E'' literal only when no letter, digit, _ or $ precedes it",
     "select case when true then 'a' else'\\' end, mood_e'\\', a$e'\\', x1e'\\';", ["a", "\\", "\\", "\\", "\\"]),
]

# FN_CLIENT_CALLABLE is empty in this file, so its paths are proven in-process
# with a temporary entry: (label, expected exit, the entry, extra migration).
_CC_OPEN = ("create function public.cc_f() returns int language sql security definer as $$ select 1 $$;\n"
            "revoke execute on function public.cc_f() from public, anon, authenticated;\n"
            "grant execute on function public.cc_f() to authenticated;")
_CC_ENTRY = {"public.cc_f": {"roles": {"authenticated"}, "adr": "0000", "reason": "self-test"}}
_CC_CASES: list[tuple[str, int, dict, str] | tuple[str, int, dict, str, str]] = [
    ("allowlisted for authenticated, PUBLIC and anon revoked, authenticated granted", 0, _CC_ENTRY, _CC_OPEN),
    ("allowlisted for authenticated, but PUBLIC never revoked", 1, _CC_ENTRY,
     _CC_OPEN.replace("from public, anon, authenticated", "from anon")),
    ("allowlisted for authenticated, but granted to anon too", 1, _CC_ENTRY,
     _CC_OPEN + "\ngrant execute on function public.cc_f() to anon;"),
    ("allowlisted, but closed to authenticated anyway (stale)", 2, _CC_ENTRY,
     _CC_OPEN.replace("grant execute on function public.cc_f() to authenticated;", "")),
    ("allowlisted function that no migration creates (stale)", 2, _CC_ENTRY, ""),
    # Without the PUBLIC refusal this entry would excuse a definer that revokes
    # nothing at all and pass (exit 0) -- the case discriminates, it is not a formality.
    ("PUBLIC in an allowlist entry", 2,
     {"public.cc_f": {"roles": {"public", "anon", "authenticated"}, "adr": "0000", "reason": "self-test"}},
     "create function public.cc_f() returns int language sql security definer as $$ select 1 $$;"),
    ("allowlist entry with no ADR", 2,
     {"public.cc_f": {"roles": {"authenticated"}, "adr": "", "reason": "self-test"}}, _CC_OPEN),
    # Round 4: each of the next two pins one check the sweep found unpinned.
    ("allowlist entry with no reason", 2,
     {"public.cc_f": {"roles": {"authenticated"}, "adr": "0000", "reason": " "}}, _CC_OPEN),
    # An unqualified entry would also end up stale (exit 2); the named refusal is what
    # tells the author why, so the case asserts the message too.
    ("allowlist entry not written schema-qualified", 2,
     {"cc_f": {"roles": {"authenticated"}, "adr": "0000", "reason": "self-test"}}, _CC_OPEN,
     "must be written schema-qualified"),
]


def run_self_test() -> int:
    import contextlib
    import io
    import subprocess
    import tempfile

    failures: list[str] = []
    ran: list[str] = []  # one line per case EXECUTED -- the count CI asserts comes from here

    def run(root: Path) -> tuple[int, str]:
        p = subprocess.run([sys.executable, str(Path(__file__).resolve()), str(root)],
                           capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def run_in_process(root: Path) -> tuple[int, str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            rc = main(["self-test", str(root)])
        return rc, buf.getvalue()

    wanted: list[int] = []

    def verdict(label: str, rc: int, out: str, want: int, must_name: str | tuple[str, ...] | None) -> None:
        ran.append(f"  exit {rc} (want {want})  {label}")
        wanted.append(want)
        names = (must_name,) if isinstance(must_name, str) else (must_name or ())
        missing = [n for n in names if n not in out]
        if rc != want:
            failures.append(f"{label}: exit {rc}, expected {want}\n{out}")
        elif missing:
            failures.append(f"{label}: exit {rc} as expected but the output never names {missing}\n{out}")
        elif want == 1 and "FAIL: SECURITY DEFINER" not in out:
            failures.append(f"{label}: exit 1 came from somewhere other than arm (c)\n{out}")

    for label, want, must_name, changes in _ST_CASES:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _st_corpus(root)
            for fname, content in changes.items():
                if content is None:
                    (root / fname).unlink()
                else:
                    (root / fname).write_text(content + "\n", encoding="utf-8")
            rc, out = run(root)
            verdict(label, rc, out, want, must_name)

    # Vacuity: too few SECURITY DEFINER functions, or too few functions at all,
    # must not pass. Each corpus trips exactly one floor, named in the output.
    for label, kwargs, must_name in (
        ("too few SECURITY DEFINER functions (MIN_SECDEF)", {"secdef_filler": False},
         "SECURITY DEFINER function(s) found (floor is"),
        ("too few function creates (MIN_FN_CREATES)", {"invoker_filler": False},
         "CREATE FUNCTION/PROCEDURE statement(s) parsed (floor is"),
    ):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _st_corpus(root, **kwargs)
            rc, out = run(root)
            verdict(label, rc, out, 2, must_name)

    # Shrink-only: a grandfathered pair that closes itself in its own file is stale.
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _st_corpus(root)
        for fname, names in FN_GRANDFATHERED.items():
            p = root / fname
            p.write_text(p.read_text(encoding="utf-8") + "".join(
                f"revoke execute on function {n}(uuid) from public, anon, authenticated;\n" for n in names),
                encoding="utf-8")
        rc, out = run(root)
        verdict("stale grandfather entry", rc, out, 2, "stale FN_GRANDFATHERED")

    # The cap, in-process: one grandfathered pair over MAX_FN_GRANDFATHERED that
    # genuinely suppresses a same-file failure, so the cap is the ONLY thing that
    # can refuse it (without the cap this corpus passes). Always restored.
    saved_gf = {f: dict(v) for f, v in FN_GRANDFATHERED.items()}
    try:
        first = next(iter(FN_GRANDFATHERED))
        FN_GRANDFATHERED[first]["public.gf_over_cap"] = "self-test"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _st_corpus(root)
            rc, out = run_in_process(root)
            verdict("FN_GRANDFATHERED one entry over MAX_FN_GRANDFATHERED", rc, out, 2,
                    f"holds {MAX_FN_GRANDFATHERED + 1} entries")
    finally:
        FN_GRANDFATHERED.clear()
        FN_GRANDFATHERED.update(saved_gf)

    # The allowlist, in-process: swap a temporary entry into FN_CLIENT_CALLABLE,
    # run main() on a synthetic corpus, and always put the real (empty) list back.
    saved = dict(FN_CLIENT_CALLABLE)
    try:
        for label, want, entry, extra, *must in _CC_CASES:
            with tempfile.TemporaryDirectory() as td:
                root = Path(td)
                _st_corpus(root)
                if extra:
                    (root / "20260920000000_c.sql").write_text(extra + "\n", encoding="utf-8")
                FN_CLIENT_CALLABLE.clear()
                FN_CLIENT_CALLABLE.update(entry)
                rc, out = run_in_process(root)
                verdict(f"client-callable: {label}", rc, out, want, must[0] if must else None)
    finally:
        FN_CLIENT_CALLABLE.clear()
        FN_CLIENT_CALLABLE.update(saved)

    # The E'' lexer, in-process. Any exception is a failed case, never a crash.
    lexed = 0
    for label, sql, want_lits in _LEX_CASES:
        try:
            got = [lit for _s, _e, lit in lex(sql, "self-test")[1]]
        except Exception as exc:  # noqa: BLE001 -- a mutated lexer may raise anything
            got = [f"{type(exc).__name__}: {exc}"]
        ran.append(f"  lexed {'as wanted' if got == want_lits else 'WRONG'}  lexer: {label}")
        lexed += 1
        if got != want_lits:
            failures.append(f"lexer: {label}: got {got!r}, wanted {want_lits!r}")

    for line in ran:
        print(line)
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} of {len(ran)} cases run did not hold:")
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    # Exactly as broad as what ran: the case lines printed above ARE the claim, and
    # this line summarises nothing they do not show.
    print(
        f"SELF-TEST OK -- {len(ran)} cases run, every one held: {len(wanted)} synthetic corpora through main() "
        f"({wanted.count(0)} want exit 0, {wanted.count(1)} want exit 1, {wanted.count(2)} want exit 2) and "
        f"{lexed} E'' lexer decodings. Arm (c) is proven on exactly the shapes the case lines above name; "
        "any other SQL spelling is unproven here (module docstring, KNOWN MISSES); the end-state check decides."
    )
    return 0


# --------------------------------------------------------------------------
def main(argv: list[str]) -> int:
    if len(argv) > 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    if argv[1:] == ["--self-test"]:
        return run_self_test()
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
        fres = analyse_functions(mig_dir)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        return 2

    # Both arms always report; neither hides behind the other.
    rc_tables = report_tables(res)
    rc_functions = report_functions(fres)
    return 2 if 2 in (rc_tables, rc_functions) else max(rc_tables, rc_functions)


def report_tables(res: dict) -> int:
    """Arms (a) and (b)'s verdict, unchanged from 2026-08-26."""
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
