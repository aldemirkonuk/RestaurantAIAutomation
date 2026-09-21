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
One read-only session (`set_session(readonly=True)`), four SELECTs:
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
    return type, whether it returns a set, kind, `proconfig`, and `md5(prosrc)`;
  * REACH_SQL: every SECURITY DEFINER function PostgreSQL would run for a judged
    role WITHOUT checking that role's EXECUTE, and by which path (REACH THROUGH
    ANOTHER OBJECT, below); and every owner-context path that runs code the catalog
    does not describe (BLIND, below) [2026-09-19, round-7 repair].
authenticator's own membership paths are not listed: by the definition above it is
a member of every judged role and of service_role, so each of those paths is either
judged as that role or is the service_role exception.

REACH THROUGH ANOTHER OBJECT [2026-09-19, round 7]
---------------------------------------------------
EXECUTE is not the only way in. PostgreSQL runs some functions with no EXECUTE check
against the caller, and a SECURITY DEFINER function run that way runs as its owner
however closed its ACL is. Each path below was measured on the PGlite build (a
closed definer behind the object, then `anon` triggers it: it ran, counted by
`pg_stat_get_xact_function_calls` or a tripwire in its SET clause) unless it says
otherwise; ADR 0159 has the table. A function reached by any of them FAILS, named
with the path, and CLIENT_CALLABLE never excuses a reach-through reason:
  * TRIGGERS (`pg_trigger.tgfoid`), on every write a judged role can make land on
    the table, per event (INSERT, UPDATE, DELETE, TRUNCATE; a column privilege
    counts; RLS does not narrow it; a disabled trigger still counts). A write lands
    on the table it names, on its partitions and inheritance children, on the base
    of an auto-updatable view, on whatever a rule on it writes, and -- AS THE
    REFERENCING TABLE'S OWNER -- on the table a foreign key's ON DELETE / ON UPDATE
    CASCADE, SET NULL or SET DEFAULT action changes. [Added 2026-09-19, round-7
    repair: an UPDATE of a partitioned table also lands as DELETE on the partition a
    row leaves and INSERT on the one it enters (row movement fires both triggers:
    replay B9, B9d), and the base of a view over a view that is updatable only
    through INSTEAD OF triggers counts as written (B14). Both passed round 7.]
  * EVERYTHING ELSE A CASCADED TABLE'S OBJECTS CALL, since a foreign-key action runs
    as that table's owner: CHECK constraints, column defaults and generated
    columns, index expressions and predicates, the partition key, rule actions,
    trigger WHEN clauses, and the CHECKs and defaults of domains its columns use.
    (RLS policies are not applied to a foreign-key action: measured, not judged.)
    [Added 2026-09-19, round-7 repair 2: and the partition key of every partitioned
    ANCESTOR of the table -- a partition's own constraint evaluates it, so a foreign
    key declared on a partition runs its parent's key expression as the owner (replay
    C7).]
  * A FOREIGN KEY'S CHECK, not only its actions [2026-09-19, round-7 repair 2]: a
    judged role's INSERT or UPDATE of the referencing table runs the check as the
    referenced table's OWNER, and its UPDATE or DELETE of the referenced table runs the
    NO ACTION / RESTRICT check as the referencing table's owner (ri_triggers.c switches
    to the queried table's owner). The check runs the key's equality operators and any
    cast between the two key types -- an implicit SQL-standard cast ran the closed
    definer for anon's INSERT (C2) and for anon's DELETE (C2n). The constraint SEEDS the
    walk below. [CORRECTED 2026-09-19, round-7 repair 2: the first repair said "a
    foreign key's own check ... runs only operator-family members"; it also runs a cast,
    and it was never seeded.]
  * AUTOANALYZE and MAINTAIN: index expressions and predicates and extended-
    statistics expressions of a table a judged role may write (autoanalyze runs
    them as the owner) or MAINTAIN (ANALYZE and REINDEX measured, REINDEX of a
    partitioned table reaching its partitions; CLUSTER and VACUUM FULL rebuild
    indexes the same way, ~~not measured~~ [CORRECTED 2026-09-19, round-7 repair:
    measured, B20 and B21 ran the index expression as the owner]); and a materialized view it may
    MAINTAIN: REFRESH runs its query, the views it reads and the policies of the
    tables it reads, as the view's owner. [Added 2026-09-19, round-7 repair 2: and
    EVERY COLUMN, not only indexed ones -- ANALYZE runs each column's type statistics
    code as the owner: the type's analyze function, a range's subtype_diff and subtype
    operator class, and the type's default btree and hash operator classes, down
    through domains, arrays, ranges, multiranges and composites. A range column with no
    index ran its SQL-standard subtype_diff, and the closed definer it calls, 300 times
    for anon's ANALYZE (C1; PL/pgSQL: C1p, BLIND; autoanalyze: C1a, judged from the
    catalog). MAINTAIN on a foreign table counts: ANALYZE reaches it too.]
  * AGGREGATES: all eight support functions (aggtransfn, aggfinalfn, aggcombinefn,
    aggserialfn, aggdeserialfn, aggmtransfn, aggminvtransfn, aggmfinalfn) of an
    aggregate a judged role may EXECUTE or that another path reaches -- they are
    checked against the aggregate's owner, not the caller;
  * A TYPE A JUDGED ROLE OWNS: CREATE CAST checks no EXECUTE on the function it
    names, so a definer taking or returning that type is one cast to json away;
  * ANY ROLE AT ALL (reported as PUBLIC), because the invoking object is reached by
    using a value, an operator or a command, not by a privilege this check could
    read: operator-family support functions and member operators (sorting, hashing,
    indexes and the type cache call them), operator restriction and join
    estimators, [2026-09-19, round-7 repair 2:] THE FUNCTION OF AN OPERATOR THAT HAS A
    SELECTIVITY ESTIMATOR, AND OF ITS NEGATOR AND COMMUTATOR -- eqsel, scalarltsel and
    kin, eqjoinsel and the extended-statistics code call it on the column's statistics
    while PLANNING any query that names the operator, before and without the
    executor's EXECUTE check; neqsel and neqjoinsel estimate through the negator, and a
    `constant op column` clause through the commutator (C10: anon's EXPLAIN ran the
    closed definer 6 times and executed nothing; C10n and C10c ran it with no error at
    all; C10j, a join estimator) -- planner support functions, a type's input, output, receive, send,
    typmod input and output, analyze and subscripting functions, a range type's
    canonical and subtype_diff functions, every cast function (to_json(),
    json_agg() and to_jsonb() call a cast to json with no check; a cast written in
    SQL is checked -- measured), event triggers (any DDL fires them, even DDL that
    is then refused), text search parser and template functions, a language's
    call, inline and validator functions (a call handler's SECURITY DEFINER and SET
    are measured to be ignored by PostgreSQL; judged anyway), foreign-data wrapper
    handlers and validators, access-method handlers, encoding conversions,
    transforms, and TABLESAMPLE handlers.
  * WHAT AN OWNER-CONTEXT OBJECT NAMES, HOWEVER IT NAMES IT [2026-09-19, round-7
    repair]. Round 7 followed only an object's direct `pg_depend` rows to `pg_proc`,
    so a closed definer reached through another catalog object ran as the owner and
    passed: an operator in a cascaded CHECK (replay B1), a cast to a domain (B2), an
    operator in an index expression under MAINTAIN (B3) or a materialized view's
    query (B4), a SQL-standard function body (B5), a policy's subquery on a second
    table (B7), a domain inside a composite default (B15), a chain of all of these
    (B17), a domain cast in a materialized view (B26). Every object run as an
    owner for a judged role in the four owner contexts this check knows -- a
    foreign-key action's triggers and table objects, index and statistics
    expressions under autoanalyze and MAINTAIN, a refreshed materialized view's
    rules and policies (~~a foreign key's own check, as ri_triggers.c reads and not
    measured, runs only operator-family members, judged as PUBLIC above~~ [CORRECTED
    2026-09-19, round-7 repair 2: it also runs a cast between the key types, as the
    other table's owner (C2, C2n), so it is a fifth owner context and a seed now (A
    FOREIGN KEY'S CHECK, above); and ANALYZE's column statistics widen the autoanalyze
    and MAINTAIN ones]) -- now
    SEEDS a walk over the
    catalog: what it depends on (functions, operators and their functions and
    estimators, types, operator classes and families, text search configurations,
    dictionaries, parsers and templates), [2026-09-19, round-7 repair 2:] an
    operator's NEGATOR and COMMUTATOR (the planner rewrites NOT (a op b) as a negator
    b, so the negator's function runs where only the operator is named: C3 in a
    cascaded CHECK, C3m under REFRESH, C3i in an index predicate under REINDEX; the
    commutator is followed as well, though the one swap measured -- a hash join, C9 --
    refuses a commutator outside the operator family), the type of each column it names (a
    whole-row reference names them all: B27), another relation it reads (that relation's columns, its row-level
    policies when RLS is on, a view's query; a foreign key's referenced table is not
    read as a query, so not followed), a domain's CHECKs, the casts from and to a
    type and the operator-family members that take it, an aggregate's support
    functions, and a SQL-standard body's own dependencies. A SECURITY DEFINER
    function the walk reaches FAILS like any other reach, naming the first object
    it went through.
  * BLIND -- EXIT 2 [2026-09-19, round-7 repair]. The walk stops where the catalog
    stops describing what runs. When it reaches any of these, the check cannot say
    what is called, so it exits 2 (never 0), naming the object and the path:
    an invoker function outside the system schemas and extensions whose body the
    catalog does not parse (PL/pgSQL, a string-bodied LANGUAGE sql, C: replay B6,
    B6s, B12, B22, B27, B28 -- the closed definer its body calls ran as the owner); a
    SQL-standard function whose body names a relation (what it writes there is not
    followed); a pg_catalog builtin that runs code handed to it only at call time
    -- the query_to_xml, cursor_to_xml, table_to_xml, schema_to_xml and
    database_to_xml families, ts_stat, ts_rewrite, pg_input_is_valid,
    pg_input_error_info, brin_summarize_new_values, brin_summarize_range,
    brin_desummarize_range, gin_clean_pending_list -- found by its `:funcid` in the
    object's stored expression tree, since pg_depend records no builtin (B13, B23);
    and a function, type or read relation OWNED BY A JUDGED ROLE, which can replace
    the body, add a CHECK or a cast, or change a policy at will (B16, B24, B25).
    [Added 2026-09-19, round-7 repair 2: the builtins that take a type or a table BY
    OID at call time -- record_in, array_in, domain_in, range_in, multirange_in (a
    domain's CHECK ran, named by a bare OID: C4, C4r, C4a) and
    satisfies_hash_partition (a table's hash support function ran: C5).]
    The walk runs once per distinct seed OBJECT, and the roles and paths are joined
    back only to what it reaches [2026-09-19, round-7 repair 2: the first repair walked
    once per (role, path); with this repair's seeds that was 495,706 walk rows and
    97.5 s on PGlite for the corpus plus the pinned storage-api schema. Per seed
    object: 14,480 rows, 3.0 s there, and 864 rows, 0.3 s, on the corpus build (the
    first repair, with fewer seeds: 56,496 rows, 11.7 s, and 4,040 rows, 1.0 s)].
    The first legitimate owner-context PL/pgSQL function (an updated_at trigger on
    a table a client's DELETE cascades into, say) will stop CI here: exit 2 means
    this check cannot vouch for it, and what to do then is a decision (ADR 0159,
    Revisit), not a quiet allowlist.
Measured to CHECK THE CALLER, so not judged here: a column default (K2), a CHECK
constraint (K1), a stored generated column (K3), a domain CHECK (K5 a cast; B19 a
write), an index expression (K6) or predicate (K7) and a partition key (K8) on the
caller's own write; a view (K11); an RLS policy, USING (K9) and WITH CHECK (K10),
including through a view owned by a role the policy applies to (V11, V12); a rule
action (K12); a trigger's WHEN clause (T14); an operator written in a query (K16,
O5) [CORRECTED 2026-09-19, round-7 repair 2: the executor checks it, but when the
operator -- or one whose negator or commutator it is -- has a selectivity estimator,
the planner has already run its function on the column statistics (C10, judged
above); the negator the planner swaps in is checked on the caller's own write (C3k),
and a hash join refuses a swapped-in commutator outside the operator family (C9k)];
a cast written in SQL (X1); a function argument's default (K15); TRUNCATE ...
CASCADE into a table the caller may not truncate (B10: refused); and every object a
client builds itself from a closed definer (CREATE TRIGGER T15, AGGREGATE G5,
OPERATOR O9, range type R3, CONVERSION V2 all refuse it; a base type Y9, an
estimator O8 and an operator class B18 need a superuser) -- except CREATE CAST,
judged above. A client's own type in a cast to json is no path either: to_json()
of a composite never consults a cast (B11), and a polymorphic definer named as the
cast fails to resolve its argument type (B11e). A virtual generated column (K4) and
a publication row filter (U1) cannot call a user function at all. [CORRECTED
2026-09-19, round-7 repair, source: the round-7 verifier: this list said more than
the probes measured -- "an operator class needs a superuser" had no probe (B18 now
measures it), and "a domain CHECK on the caller's own write" was measured by a cast
(K5), not a write (B19 now measures the write). Each item now names its probe.]
[CORRECTED 2026-09-19, round 7: until this round the check judged EXECUTE alone and
named the trigger (A3) and aggregate (A9) cases as residuals. The founder chose the
optimal path over leaving them named ("do what the optimal scenario would do, no we
can do this later or second plan", 2026-09-19).]

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
    is never a pass;
  * REACH_SQL names a path by which PostgreSQL runs it for PUBLIC or a judged role
    with no EXECUTE check (REACH THROUGH ANOTHER OBJECT, above). No allowlist
    entry excuses such a path.

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
  * psycopg2 missing, a failed connection, or a failed catalog query -- REACH_SQL
    included (it needs PostgreSQL 17's MAINTAIN privilege), and a reach row of the
    wrong width or naming a function the catalog query did not return;
  * anon, authenticated or authenticator missing (without authenticator there is
    no telling which roles the API can switch into);
  * fewer than MIN_PUBLIC_SECDEF in-scope SECURITY DEFINER functions in schema
    `public` (the corpus creates 7; lower it in a diff when a migration drops one);
  * a malformed CLIENT_CALLABLE entry (identity included), or one that excuses
    nothing;
  * a BLIND owner-context path (REACH THROUGH ANOTHER OBJECT): code PostgreSQL runs
    as an object's owner for a judged role that the catalog does not describe, or
    a reach row whose blind column is neither true nor false [2026-09-19, round-7
    repair]. A leak found in the same run still exits 1, with the blind paths
    printed under it.

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
  * ~~REACH THROUGH ANOTHER OBJECT. Only EXECUTE on the function itself is judged.
    [...] (A3) [...] (A9). Both pass here. [...] Filed OPEN in v3.0-TECH-DEBT.md.~~
    [CORRECTED 2026-09-19, round 7: judged now -- see REACH THROUGH ANOTHER OBJECT
    above; A3 and A9 exit 1. What is left of that class:]
  * ~~WHAT A REACHED FUNCTION DOES. A reached function's own body -- the functions
    it calls, the tables it writes (whose triggers then fire) -- is not followed:
    PL/pgSQL and dynamic SQL cannot be read from the catalog. So neither is
    anything reached only through a function the allowlist excuses. A foreign-key
    cascade is followed because the catalog states it.~~ [CORRECTED 2026-09-19,
    round-7 repair: in owner context this is no longer unseen. A SQL-standard body
    is followed; any other body, a builtin that runs code handed to it at call time,
    and anything a judged role owns is BLIND (exit 2), never a pass. What stays
    unseen: the body of a function that runs AS THE CALLER (a trigger or
    aggregate support function on the client's own write, a type's input function):
    whatever it calls is checked against that caller, so it needs no following; and
    the allowlisted platform function's body, which is pinned by md5(prosrc) and
    was read by hand (webhook.sql, v2.116.0).]
  * PATHS PGLITE CANNOT RUN, judged from the catalog but never exercised: an
    aggregate's serialfn and deserialfn (only parallel aggregation calls them, and
    PGlite starts no workers); a foreign-data wrapper's handler (PGlite has no FDW
    and a handler must be C); transforms (no PL that applies them); a login event
    trigger (PGlite opens no second connection); autoanalyze (no autovacuum --
    ANALYZE under MAINTAIN stood in for it). Everything else was measured on
    PostgreSQL 18.3 (PGlite); CI's stack is 17, whose planner does not call index-
    AM handlers the way 18's merge-join code does (judged unconditionally anyway).
    Of the round-7 repair's builtin list, only ts_rewrite and pg_input_is_valid
    were exercised [2026-09-19, round-7 repair 2: and domain_in, record_in,
    array_in and satisfies_hash_partition; not range_in or multirange_in];
    autoanalyze of column statistics (C1a) is judged from the catalog, ANALYZE under
    MAINTAIN standing in for it; the xml families need libxml, and the brin/gin maintenance
    builtins need those index types, so they are judged from the list alone.
  * A TYPE, TEXT SEARCH CONFIGURATION OR DICTIONARY NAMED BY A BARE OID OR BY TEXT in
    owner context -- format_type(<oid>, ...), ts_parse(<oid>, ...),
    to_tsvector(<oid>::regconfig, ...), tsvector_update_trigger's configuration argument --
    is not followed [2026-09-19, round-7 repair 2]. What those reach is C (a
    typmod output function, text search parsers and templates), which only a
    superuser can install, and it is judged as PUBLIC above when it is a definer.
    Adding them to the BLIND builtins would make every owner-context to_tsvector()
    BLIND.
  * STRICTER THAN MEASURED, ON PURPOSE [2026-09-19, round-7 repair 2]: the walk follows
    an operator's commutator, though the one swap measured refuses a commutator outside
    the operator family (C9 exits 1 while PostgreSQL errors); a foreign key's check walks
    every cast from and to its key types, every operator family over them and their
    domains' CHECKs; a column's statistics seed takes the type's default btree and hash
    operator classes whole. And one rule was measured on 18.3 only: a client cannot name
    someone else's operator as the negator or commutator of its own (CT1, CT2: must be
    owner). The CREATE OPERATOR documentation states it; were CI's 17 to allow it, the
    estimator path would reach every operator's function.
  * THE SUPABASE LOCAL STACK'S OWN SCHEMAS were never built here (Docker hung). Its
    storage schema grants anon and authenticated ALL -- MAINTAIN included -- on
    storage.objects, buckets, prefixes and buckets_analytics, and a DELETE on
    buckets_analytics cascades into the iceberg tables, so on CI those are SEEDS of
    the walk. Read from the pinned sources, they reach only builtin and extension
    code; if CI says otherwise it exits 1 or 2 naming the path, never 0. [2026-09-19,
    round-7 repair 2: partly measured -- the pinned storage-api's own 62 migrations
    applied on top of the corpus build in PGlite, with its role installer off as on the
    stack: exit 0, 0 reached, 0 BLIND. Realtime, auth, pg_net, pg_graphql and pgsodium
    were not built.]
  * ~~DOMAINS INSIDE A COMPOSITE COLUMN. A cascaded table's domain CHECKs are judged
    for a column whose type is the domain or an array of it, not for a domain
    nested inside a composite type the column uses.~~ [CORRECTED 2026-09-19, round-7
    repair: the walk follows a composite's attributes to their domains (replay B15:
    a SET DEFAULT whose default builds a composite with a domain field).]
  * A TYPE'S NEW OWNER LATER. The cast-by-owner rule reads which types a judged
    role owns now; a type given to one later is judged by the build that has it.
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
  * PRIVILEGES THAT ARE NOT EXECUTE, except as REACH_SQL reads them. EXECUTE and
    ownership decide direct reach; INSERT, UPDATE, DELETE, TRUNCATE, MAINTAIN and
    type ownership are read only to find reach through another object [2026-09-19,
    round 7]. A client role that could reach the function by some other privilege
    (CREATE on its schema to shadow it, say) is out of scope.
  * ROLES THE API CANNOT SWITCH INTO. A role that authenticator is not a member
    of is not judged, and neither is service_role (above).

Exit 0 = clean.  Exit 1 = a SECURITY DEFINER function answers to PUBLIC or a judged
role.  Exit 2 = could not check (a BLIND owner-context path included).

`--self-test` drives the classifier, the identity pin, the judged roles, the
allowlist rules, the floor, the DSN host rule, main()'s wiring and the fetch-error
paths on synthetic rows, and fetch() itself through a stand-in driver (read-only
session, the four SELECTs in order, the judged roles handed to QUERY and REACH_SQL,
the row widths, each reach-through row attached to its function), with no
database. It replays every reach-through path the PGlite build measured as a leak
and as its closed control -- the round-7 repair's adversarial rows and its BLIND
rows (exit 2) included, and the second repair's C rows -- pins each arm of REACH_SQL by its load-bearing clauses
and every query by the md5 of its exact text (QUERIES_MD5: a clause pin cannot see
a falsifier added beside it, so any edit to a query fails until it is re-pinned in
a diff that re-runs the ADR 0159 replay),
and refuses a SQL comment in any query (an arm commented out would keep its pins). It prints one line per case and closes with `SELF-TEST OK
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

#: The reach-through query (REACH THROUGH ANOTHER OBJECT in the docstring): one row per
#: (SECURITY DEFINER function, PUBLIC or judged role, path) where PostgreSQL would run the
#: function for that role with no EXECUTE check against it, then one row per BLIND path
#: (blind = true, the object's description in `name`). SQL comments are refused in
#: every query (--self-test), so each arm is explained here instead, in order:
#:   writes      -- what a judged role may INSERT/UPDATE/DELETE/TRUNCATE (column privileges
#:                  count, RLS does not narrow), and where it lands: partitions and
#:                  inheritance children, the base of an auto-updatable view, whatever a
#:                  rule writes, and -- as_owner -- a foreign key's CASCADE/SET NULL/SET
#:                  DEFAULT target;
#:   maintain    -- what a judged role may MAINTAIN, down to partitions; mvreads -- what a
#:                  materialized view it may MAINTAIN reads, through views;
#:   dom         -- each domain and the domains it is built on;
#:   attached    -- every function a relation's objects call: triggers (with their event
#:                  bits), WHEN clauses, constraints, defaults and generated columns,
#:                  indexes, the partition key, rules, statistics, policies, and the
#:                  CHECKs and defaults of its columns' domains;
#:   objects     -- every expression-bearing object of a relation (the rows `attached` reads);
#:   aggsupport  -- the eight support functions of every aggregate;
#:   reached     -- triggers on any write; everything attached to a table a foreign-key
#:                  action writes as its owner; index and statistics expressions under
#:                  autoanalyze and MAINTAIN; a refreshed materialized view's rules and
#:                  policies; support functions of an aggregate a judged role may
#:                  EXECUTE; functions taking or returning a type a judged role owns
#:                  (CREATE CAST checks no EXECUTE); and, as PUBLIC, every function the
#:                  catalog wires into operator families, operators' estimators, planner
#:                  support, types, ranges, casts, event triggers, text search, languages,
#:                  foreign-data wrappers, access methods, conversions, transforms and
#:                  TABLESAMPLE;
#:   everything  -- plus the support functions of an aggregate any of those reach;
#:   seeds       -- [round-7 repair] every object PostgreSQL runs AS AN OWNER for a judged role: a
#:                  foreign-key action's triggers and table objects, index and statistics
#:                  expressions under autoanalyze and MAINTAIN, a refreshed view's rules and
#:                  policies -- with `home`, the relation the object belongs to;
#:   walk        -- from each seed, whatever it names however it names it: pg_depend to
#:                  functions, operators, types, operator classes and families; a named
#:                  column's type; another relation it reads (not a foreign key's target):
#:                  its columns, its policies when RLS is on, a view's query; a domain's
#:                  CHECKs; a type's casts and operator-family members; an operator's
#:                  function and estimators; an aggregate's support functions. It never
#:                  walks past a SECURITY DEFINER function (that one is reported);
#:   blind       -- walk nodes the catalog does not describe: an invoker body it cannot
#:                  parse, a SQL-standard body naming a relation, a runtime-code builtin
#:                  found by `:funcid` in the stored expression tree, and anything a judged
#:                  role owns. Returned with blind = true; the check exits 2 on them.
#: The verdict: definers reached by the direct arms, definers the walk reaches that no direct
#: arm names (with the first object it went through), then the blind rows.
REACH_FIELDS = ("schema", "name", "args", "who", "how", "blind")

REACH_SQL = """
with recursive
judged as (
  select r.oid, r.rolname from pg_roles r where r.rolname = any(%(judged)s)
),
ops(op, tgbit, updbit, evtype) as (
  values ('INSERT', 4, 8, '3'), ('DELETE', 8, 16, '4'), ('UPDATE', 16, 4, '2'), ('TRUNCATE', 32, 0, '')
),
writes(who, rel, op, as_owner, via) as (
  select j.rolname, c.oid, o.op, false, format('%%s may %%s %%s', j.rolname, o.op, c.oid::regclass)
    from judged j
    cross join pg_class c
    cross join ops o
   where c.relkind in ('r', 'p', 'v', 'f')
     and case when o.op in ('INSERT', 'UPDATE') then has_any_column_privilege(j.oid, c.oid, o.op)
              else has_table_privilege(j.oid, c.oid, o.op) end
  union
  select w.who, e.rel, e.op, w.as_owner or e.as_owner, e.via
    from writes w
    cross join lateral (
      select i.inhrelid as rel, w.op as op, false as as_owner, w.via as via
        from pg_inherits i
       where i.inhparent = w.rel
      union all
      select i.inhrelid, m.op, false,
             format('%%s; an UPDATE that moves a row to another partition deletes it from one and inserts it into the other', w.via)
        from pg_inherits i
        join pg_class p on p.oid = i.inhparent and p.relkind = 'p'
        cross join (values ('INSERT'), ('DELETE')) m(op)
       where i.inhparent = w.rel and w.op = 'UPDATE'
      union all
      select d.refobjid, t.op, false, w.via
        from pg_rewrite r
        join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
                        and d.refclassid = 'pg_class'::regclass and d.refobjid <> w.rel
        join pg_class c on c.oid = d.refobjid and c.relkind in ('r', 'p', 'v', 'f')
        join ops s on s.op = w.op
        cross join ops t
       where r.ev_class = w.rel and w.op <> 'TRUNCATE' and t.op <> 'TRUNCATE'
         and ((r.ev_type = '1' and t.op = w.op and (pg_relation_is_updatable(w.rel, true) & s.updbit) <> 0)
              or r.ev_type = s.evtype)
      union all
      select k.conrelid, case when w.op = 'DELETE' and k.confdeltype = 'c' then 'DELETE' else 'UPDATE' end, true, w.via
        from pg_constraint k
       where k.contype = 'f' and k.confrelid = w.rel
         and ((w.op = 'DELETE' and k.confdeltype in ('c', 'n', 'd'))
              or (w.op = 'UPDATE' and k.confupdtype in ('c', 'n', 'd')))
    ) e
),
maintain(who, rel, via) as (
  select j.rolname, c.oid, format('%%s may MAINTAIN %%s', j.rolname, c.oid::regclass)
    from judged j
    cross join pg_class c
   where c.relkind in ('r', 'p', 'm', 'f') and has_table_privilege(j.oid, c.oid, 'MAINTAIN')
  union
  select m.who, i.inhrelid, m.via
    from maintain m
    join pg_inherits i on i.inhparent = m.rel
),
mvreads(who, rel, via) as (
  select m.who, m.rel, m.via
    from maintain m
    join pg_class c on c.oid = m.rel and c.relkind = 'm'
  union
  select v.who, d.refobjid, v.via
    from mvreads v
    join pg_rewrite r on r.ev_class = v.rel
    join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
                    and d.refclassid = 'pg_class'::regclass and d.refobjid <> v.rel
),
dom(start, typ) as (
  select t.oid, t.oid from pg_type t where t.typtype = 'd'
  union
  select dm.start, t.typbasetype
    from dom dm
    join pg_type t on t.oid = dm.typ
    join pg_type b on b.oid = t.typbasetype and b.typtype = 'd'
),
objects(classid, objid, rel, kind, what, own) as (
  select 'pg_trigger'::regclass::oid, t.oid, t.tgrelid, 'when', format('the WHEN clause of trigger %%I', t.tgname), t.tgfoid::oid
    from pg_trigger t
  union all
  select 'pg_constraint'::regclass::oid, k.oid, k.conrelid, 'constraint', format('constraint %%I', k.conname), 0::oid
    from pg_constraint k
   where k.conrelid <> 0
  union all
  select 'pg_attrdef'::regclass::oid, a.oid, a.adrelid, 'default', format('the default or generation expression of column %%I', c.attname), 0::oid
    from pg_attrdef a
    join pg_attribute c on c.attrelid = a.adrelid and c.attnum = a.adnum
  union all
  select 'pg_class'::regclass::oid, i.indexrelid, i.indrelid, 'index', format('index %%s', i.indexrelid::regclass), 0::oid
    from pg_index i
  union all
  select 'pg_class'::regclass::oid, a.relid::oid, c.oid, 'partition key',
         case when a.relid = c.oid then 'its partition key'
              else format('the partition key of its parent %%s', a.relid) end, 0::oid
    from pg_class c
    cross join lateral pg_partition_ancestors(c.oid) a
    join pg_class pa on pa.oid = a.relid and pa.relkind = 'p'
   where c.relkind = 'p' or c.relispartition
  union all
  select 'pg_rewrite'::regclass::oid, r.oid, r.ev_class, 'rule', format('rule %%I', r.rulename), 0::oid
    from pg_rewrite r
  union all
  select 'pg_statistic_ext'::regclass::oid, s.oid, s.stxrelid, 'statistics', format('statistics object %%I', s.stxname), 0::oid
    from pg_statistic_ext s
  union all
  select 'pg_policy'::regclass::oid, p.oid, p.polrelid, 'policy', format('policy %%I', p.polname), 0::oid
    from pg_policy p
  union all
  select 'pg_constraint'::regclass::oid, k.oid, a.attrelid, 'domain', format('a CHECK of domain %%s (column %%I)', dm.start::regtype, a.attname), 0::oid
    from pg_attribute a
    join pg_type at on at.oid = a.atttypid
    join dom dm on dm.start in (a.atttypid, at.typelem)
    join pg_constraint k on k.contypid = dm.typ
   where a.attnum > 0 and not a.attisdropped
  union all
  select 'pg_type'::regclass::oid, dm.typ, a.attrelid, 'domain', format('the default of domain %%s (column %%I)', dm.start::regtype, a.attname), 0::oid
    from pg_attribute a
    join pg_type at on at.oid = a.atttypid
    join dom dm on dm.start in (a.atttypid, at.typelem)
   where a.attnum > 0 and not a.attisdropped
),
attached(rel, fn, kind, what, tgtype) as (
  select t.tgrelid, t.tgfoid::oid, 'trigger', format('trigger %%I', t.tgname), t.tgtype::int
    from pg_trigger t
  union all
  select o.rel, d.refobjid, o.kind, o.what, null::int
    from objects o
    join pg_depend d on d.classid = o.classid and d.objid = o.objid and d.refclassid = 'pg_proc'::regclass
   where d.refobjid <> o.own
),
aggsupport(agg, fn, field) as (
  select a.aggfnoid::oid, s.fn, s.field
    from pg_aggregate a
    cross join lateral (values ('aggtransfn', a.aggtransfn::oid), ('aggfinalfn', a.aggfinalfn::oid),
                               ('aggcombinefn', a.aggcombinefn::oid), ('aggserialfn', a.aggserialfn::oid),
                               ('aggdeserialfn', a.aggdeserialfn::oid), ('aggmtransfn', a.aggmtransfn::oid),
                               ('aggminvtransfn', a.aggminvtransfn::oid), ('aggmfinalfn', a.aggmfinalfn::oid)) s(field, fn)
   where s.fn <> 0
),
reached(fn, who, how) as (
  select a.fn, w.who,
         format('%%s on %%s fires it with no EXECUTE check (%%s%%s)', a.what, a.rel::regclass, w.via,
                case when w.as_owner then '; a foreign-key action writes the table as its owner' else '' end)
    from writes w
    join ops o on o.op = w.op
    join attached a on a.rel = w.rel and a.kind = 'trigger' and (a.tgtype & o.tgbit) <> 0
  union all
  select a.fn, w.who,
         format('%%s on %%s runs as the table''s owner, never checked against the caller (%%s; a foreign-key action writes the table as its owner)',
                a.what, a.rel::regclass, w.via)
    from writes w
    join attached a on a.rel = w.rel and a.kind in ('when', 'constraint', 'default', 'index', 'partition key', 'rule', 'domain')
   where w.as_owner
  union all
  select a.fn, w.who,
         format('%%s on %%s: autoanalyze runs it as the table''s owner after writes (%%s)', a.what, a.rel::regclass, w.via)
    from writes w
    join attached a on a.rel = w.rel and a.kind in ('index', 'statistics')
  union all
  select a.fn, m.who,
         format('%%s on %%s: ANALYZE, REINDEX and CLUSTER run it as the table''s owner (%%s)', a.what, a.rel::regclass, m.via)
    from maintain m
    join attached a on a.rel = m.rel and a.kind in ('index', 'statistics')
  union all
  select a.fn, v.who,
         format('%%s on %%s: REFRESH MATERIALIZED VIEW runs it as the view''s owner (%%s)', a.what, a.rel::regclass, v.via)
    from mvreads v
    join attached a on a.rel = v.rel and a.kind in ('rule', 'policy')
  union all
  select s.fn, j.rolname,
         format('%%s of aggregate %%s, which %%s may EXECUTE: support functions are checked against the aggregate''s owner, not the caller',
                s.field, s.agg::regprocedure, j.rolname)
    from aggsupport s
    join judged j on has_function_privilege(j.oid, s.agg, 'EXECUTE')
  union all
  select p.oid, j.rolname,
         format('%%s owns type %%s, and CREATE CAST checks no EXECUTE: a cast to json with this function runs for any to_json()',
                j.rolname, t.oid::regtype)
    from judged j
    join pg_type t on t.typowner = j.oid
    join pg_proc p on (p.pronargs > 0 and p.proargtypes[0] = t.oid) or p.prorettype = t.oid
  union all
  select x.fn, 'PUBLIC', x.how
    from (select p.amproc::oid, format('support function %%s of operator family %%s: sorting, hashing, indexes and the type cache call it with no EXECUTE check',
                                       p.amprocnum, f.opfname)
            from pg_amproc p
            join pg_opfamily f on f.oid = p.amprocfamily
          union all
          select o.oprcode::oid, format('operator %%s is in operator family %%s: the type cache and indexes call it with no EXECUTE check',
                                        o.oid::regoperator, f.opfname)
            from pg_amop a
            join pg_operator o on o.oid = a.amopopr
            join pg_opfamily f on f.oid = a.amopfamily
          union all
          select o.oprrest::oid, format('restriction estimator of operator %%s: the planner calls it for any query that uses the operator', o.oid::regoperator)
            from pg_operator o
           where o.oprrest <> 0
          union all
          select o.oprjoin::oid, format('join estimator of operator %%s: the planner calls it for any query that uses the operator', o.oid::regoperator)
            from pg_operator o
           where o.oprjoin <> 0
          union all
          select q.oprcode::oid, format('the function of operator %%s: the selectivity estimator of operator %%s calls it on column statistics while planning, with no EXECUTE check',
                                        q.oid::regoperator, o.oid::regoperator)
            from pg_operator o
            join pg_operator q on q.oid in (o.oid, o.oprnegate, o.oprcom)
           where (o.oprrest <> 0 or o.oprjoin <> 0) and q.oprcode <> 0
          union all
          select p.prosupport::oid, format('planner support function of %%s: the planner calls it for any query that names that function', p.oid::regprocedure)
            from pg_proc p
           where p.prosupport <> 0
          union all
          select s.fn, format('%%s of type %%s: called wherever a value of the type is read, written or described', s.field, t.oid::regtype)
            from pg_type t
            cross join lateral (values ('input function', t.typinput::oid), ('output function', t.typoutput::oid),
                                       ('receive function', t.typreceive::oid), ('send function', t.typsend::oid),
                                       ('typmod input function', t.typmodin::oid), ('typmod output function', t.typmodout::oid),
                                       ('analyze function', t.typanalyze::oid), ('subscripting handler', t.typsubscript::oid)) s(field, fn)
           where s.fn <> 0
          union all
          select s.fn, format('%%s of range type %%s: called wherever a value of the type is built or indexed', s.field, r.rngtypid::regtype)
            from pg_range r
            cross join lateral (values ('canonical function', r.rngcanonical::oid), ('subtype_diff function', r.rngsubdiff::oid)) s(field, fn)
           where s.fn <> 0
          union all
          select c.castfunc, format('the cast from %%s to %%s: to_json(), json_agg() and to_jsonb() call a cast to json with no EXECUTE check',
                                    c.castsource::regtype, c.casttarget::regtype)
            from pg_cast c
           where c.castfunc <> 0
          union all
          select e.evtfoid, format('event trigger %%I: %%s', e.evtname,
                                   case when e.evtevent = 'login' then 'every login fires it'
                                        else 'any DDL command fires it, even one its own privileges then refuse' end)
            from pg_event_trigger e
          union all
          select s.fn, format('%%s of text search parser %%s', s.field, p.prsname)
            from pg_ts_parser p
            cross join lateral (values ('start function', p.prsstart::oid), ('gettoken function', p.prstoken::oid),
                                       ('end function', p.prsend::oid), ('headline function', p.prsheadline::oid),
                                       ('lextypes function', p.prslextype::oid)) s(field, fn)
           where s.fn <> 0
          union all
          select s.fn, format('%%s of text search template %%s', s.field, t.tmplname)
            from pg_ts_template t
            cross join lateral (values ('init function', t.tmplinit::oid), ('lexize function', t.tmpllexize::oid)) s(field, fn)
           where s.fn <> 0
          union all
          select s.fn, format('%%s of language %%s', s.field, l.lanname)
            from pg_language l
            cross join lateral (values ('call handler', l.lanplcallfoid), ('inline handler', l.laninline),
                                       ('validator', l.lanvalidator)) s(field, fn)
           where s.fn <> 0
          union all
          select s.fn, format('%%s of foreign-data wrapper %%s', s.field, w.fdwname)
            from pg_foreign_data_wrapper w
            cross join lateral (values ('handler', w.fdwhandler), ('validator', w.fdwvalidator)) s(field, fn)
           where s.fn <> 0
          union all
          select a.amhandler::oid, format('handler of access method %%s', a.amname)
            from pg_am a
          union all
          select c.conproc::oid, format('encoding conversion %%s', c.conname)
            from pg_conversion c
          union all
          select s.fn, format('%%s of the transform for %%s in language %%s', s.field, t.trftype::regtype, l.lanname)
            from pg_transform t
            join pg_language l on l.oid = t.trflang
            cross join lateral (values ('from-SQL function', t.trffromsql::oid), ('to-SQL function', t.trftosql::oid)) s(field, fn)
           where s.fn <> 0
          union all
          select p.oid, 'a TABLESAMPLE method: any query may name it'
            from pg_proc p
           where p.prorettype = 'tsm_handler'::regtype
         ) x(fn, how)
),
everything(fn, who, how) as (
  select fn, who, how from reached
  union all
  select s.fn, r.who, format('%%s of aggregate %%s, which is reached this way: %%s', s.field, s.agg::regprocedure, r.how)
    from reached r
    join aggsupport s on s.agg = r.fn
),
stattypes(home, col, typ) as (
  select a.attrelid, a.attname::text, a.atttypid
    from pg_attribute a
   where a.attnum > 0 and not a.attisdropped
     and (a.attrelid in (select m.rel from maintain m)
          or a.attrelid in (select w.rel from writes w join pg_class c on c.oid = w.rel and c.relkind in ('r', 'p')))
  union
  select s.home, s.col, x.typ
    from stattypes s
    join pg_type t on t.oid = s.typ
    cross join lateral (
      select t.typbasetype as typ where t.typtype = 'd'
      union all
      select t.typelem where t.typelem <> 0 and t.typlen = -1
      union all
      select r.rngsubtype from pg_range r where r.rngtypid = t.oid
      union all
      select r.rngtypid from pg_range r where r.rngmultitypid = t.oid
      union all
      select a.atttypid from pg_attribute a where t.typtype = 'c' and a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped
    ) x
),
statobj(home, col, classid, objid, what) as (
  select s.home, s.col, 'pg_proc'::regclass::oid, t.typanalyze::oid, format('the analyze function of type %%s', t.oid::regtype)
    from stattypes s
    join pg_type t on t.oid = s.typ and t.typanalyze <> 0
  union
  select s.home, s.col, 'pg_proc'::regclass::oid, r.rngsubdiff::oid, format('the subtype_diff function of range type %%s', r.rngtypid::regtype)
    from stattypes s
    join pg_range r on r.rngtypid = s.typ and r.rngsubdiff <> 0
  union
  select s.home, s.col, 'pg_opclass'::regclass::oid, r.rngsubopc, format('the subtype operator class of range type %%s', r.rngtypid::regtype)
    from stattypes s
    join pg_range r on r.rngtypid = s.typ
  union
  select s.home, s.col, 'pg_opclass'::regclass::oid, c.oid, format('the default %%s operator class of type %%s', a.amname, s.typ::regtype)
    from stattypes s
    join pg_opclass c on c.opcintype = s.typ and c.opcdefault
    join pg_am a on a.oid = c.opcmethod and a.amname in ('btree', 'hash')
),
seeds(who, how, home, classid, objid) as (
  select w.who::text,
         format('%%s on %%s fires it with no EXECUTE check (%%s; a foreign-key action writes the table as its owner)', a.what, a.rel::regclass, w.via),
         a.rel, 'pg_proc'::regclass::oid, a.fn
    from writes w
    join ops o on o.op = w.op
    join attached a on a.rel = w.rel and a.kind = 'trigger' and (a.tgtype & o.tgbit) <> 0
   where w.as_owner
  union
  select w.who::text,
         format('%%s on %%s runs as the table''s owner, never checked against the caller (%%s; a foreign-key action writes the table as its owner)',
                o.what, o.rel::regclass, w.via),
         o.rel, o.classid, o.objid
    from writes w
    join objects o on o.rel = w.rel and o.kind in ('when', 'constraint', 'default', 'index', 'partition key', 'rule', 'domain')
   where w.as_owner
  union
  select w.who::text, format('%%s on %%s: autoanalyze runs it as the table''s owner after writes (%%s)', o.what, o.rel::regclass, w.via),
         o.rel, o.classid, o.objid
    from writes w
    join objects o on o.rel = w.rel and o.kind in ('index', 'statistics')
  union
  select m.who::text, format('%%s on %%s: ANALYZE, REINDEX and CLUSTER run it as the table''s owner (%%s)', o.what, o.rel::regclass, m.via),
         o.rel, o.classid, o.objid
    from maintain m
    join objects o on o.rel = m.rel and o.kind in ('index', 'statistics')
  union
  select v.who::text, format('%%s on %%s: REFRESH MATERIALIZED VIEW runs it as the view''s owner (%%s)', o.what, o.rel::regclass, v.via),
         o.rel, o.classid, o.objid
    from mvreads v
    join objects o on o.rel = v.rel and o.kind in ('rule', 'policy')
  union
  select m.who::text, format('column %%I of %%s: ANALYZE runs %%s as the table''s owner (%%s)', o.col, o.home::regclass, o.what, m.via),
         o.home, o.classid, o.objid
    from maintain m
    join statobj o on o.home = m.rel
  union
  select w.who::text, format('column %%I of %%s: autoanalyze runs %%s as the table''s owner after writes (%%s)', o.col, o.home::regclass, o.what, w.via),
         o.home, o.classid, o.objid
    from writes w
    join statobj o on o.home = w.rel
  union
  select w.who::text, format('the check of foreign key %%I on %%s runs as the owner of %%s, never checked against the caller (%%s)',
                             k.conname, k.conrelid::regclass, case when k.conrelid = w.rel then k.confrelid else k.conrelid end::regclass, w.via),
         k.conrelid, 'pg_constraint'::regclass::oid, k.oid
    from writes w
    join pg_constraint k on k.contype = 'f'
                        and ((k.conrelid = w.rel and w.op in ('INSERT', 'UPDATE'))
                             or (k.confrelid = w.rel and w.op in ('UPDATE', 'DELETE')))
),
sobj(home, classid, objid) as (
  select distinct s.home, s.classid, s.objid from seeds s
),
walk(shome, sclassid, sobjid, home, classid, objid, via) as (
  select s.home, s.classid, s.objid, s.home, s.classid, s.objid, ''::text
    from sobj s
  union
  select w.shome, w.sclassid, w.sobjid, e.home, e.classid, e.objid, case when w.via = '' then e.label collate "default" else w.via end
    from walk w
    cross join lateral (
      select d.refclassid as classid, d.refobjid as objid, w.home as home,
             case when d.refclassid = 'pg_proc'::regclass then format('function %%s', d.refobjid::regprocedure)
                  when d.refclassid = 'pg_operator'::regclass then format('operator %%s', d.refobjid::regoperator)
                  when d.refclassid = 'pg_type'::regclass then format('type %%s', d.refobjid::regtype)
                  else pg_describe_object(d.refclassid, d.refobjid, 0) end as label
        from pg_depend d
       where d.classid = w.classid and d.objid = w.objid
         and d.refclassid in ('pg_proc'::regclass, 'pg_operator'::regclass, 'pg_type'::regclass,
                              'pg_opclass'::regclass, 'pg_opfamily'::regclass, 'pg_ts_config'::regclass,
                              'pg_ts_dict'::regclass, 'pg_ts_parser'::regclass, 'pg_ts_template'::regclass)
         and not (w.classid = 'pg_trigger'::regclass and d.refclassid = 'pg_proc'::regclass
                  and d.refobjid in (select t.tgfoid from pg_trigger t where t.oid = w.objid))
      union all
      select 'pg_type'::regclass::oid, a.atttypid, w.home, format('column %%I of %%s', a.attname, a.attrelid::regclass)
        from pg_depend d
        join pg_attribute a on a.attrelid = d.refobjid
                           and (a.attnum = d.refobjsubid
                                or (d.refobjsubid = 0 and d.refobjid = w.home and a.attnum > 0 and not a.attisdropped))
       where d.classid = w.classid and d.objid = w.objid and d.refclassid = 'pg_class'::regclass
      union all
      select 'pg_class'::regclass::oid, d.refobjid, d.refobjid, format('relation %%s', d.refobjid::regclass)
        from pg_depend d
       where d.classid = w.classid and d.objid = w.objid and d.refclassid = 'pg_class'::regclass and d.refobjid <> w.home
         and not (w.classid = 'pg_constraint'::regclass and d.objid in (select k.oid from pg_constraint k where k.contype = 'f'))
      union all
      select 'pg_type'::regclass::oid, a.atttypid, w.home, format('column %%I of %%s', a.attname, a.attrelid::regclass)
        from pg_attribute a
       where w.classid = 'pg_class'::regclass and a.attrelid = w.objid and a.attnum > 0 and not a.attisdropped
      union all
      select 'pg_policy'::regclass::oid, p.oid, w.home, format('policy %%I on %%s', p.polname, p.polrelid::regclass)
        from pg_policy p
        join pg_class c on c.oid = p.polrelid and c.relrowsecurity
       where w.classid = 'pg_class'::regclass and p.polrelid = w.objid
      union all
      select 'pg_rewrite'::regclass::oid, r.oid, w.home, format('the query of view %%s', r.ev_class::regclass)
        from pg_rewrite r
        join pg_class c on c.oid = r.ev_class and c.relkind = 'v'
       where w.classid = 'pg_class'::regclass and r.ev_class = w.objid and r.ev_type = '1'
      union all
      select 'pg_constraint'::regclass::oid, k.oid, w.home, format('a CHECK of domain %%s', k.contypid::regtype)
        from pg_constraint k
       where w.classid = 'pg_type'::regclass and k.contypid = w.objid
      union all
      select 'pg_proc'::regclass::oid, c.castfunc, w.home, format('the cast from %%s to %%s', c.castsource::regtype, c.casttarget::regtype)
        from pg_cast c
       where w.classid = 'pg_type'::regclass and w.objid in (c.castsource, c.casttarget) and c.castfunc <> 0
      union all
      select 'pg_proc'::regclass::oid, p.amproc::oid, w.home, format('support function %%s of operator family %%s', p.amprocnum, f.opfname)
        from pg_amproc p
        join pg_opfamily f on f.oid = p.amprocfamily
       where (w.classid = 'pg_type'::regclass and w.objid in (p.amproclefttype, p.amprocrighttype))
          or (w.classid = 'pg_opfamily'::regclass and p.amprocfamily = w.objid)
      union all
      select 'pg_operator'::regclass::oid, a.amopopr, w.home, format('operator %%s of operator family %%s', a.amopopr::regoperator, f.opfname)
        from pg_amop a
        join pg_opfamily f on f.oid = a.amopfamily
       where (w.classid = 'pg_type'::regclass and w.objid in (a.amoplefttype, a.amoprighttype))
          or (w.classid = 'pg_opfamily'::regclass and a.amopfamily = w.objid)
      union all
      select 'pg_opfamily'::regclass::oid, c.opcfamily, w.home, format('operator class %%s', c.opcname)
        from pg_opclass c
       where w.classid = 'pg_opclass'::regclass and c.oid = w.objid
      union all
      select 'pg_proc'::regclass::oid, s.fn, w.home, format('%%s of operator %%s', s.field, o.oid::regoperator)
        from pg_operator o
        cross join lateral (values ('the function', o.oprcode::oid), ('the restriction estimator', o.oprrest::oid),
                                   ('the join estimator', o.oprjoin::oid)) s(field, fn)
       where w.classid = 'pg_operator'::regclass and o.oid = w.objid and s.fn <> 0
      union all
      select 'pg_operator'::regclass::oid, s.op, w.home, format('%%s of operator %%s', s.field, o.oid::regoperator)
        from pg_operator o
        cross join lateral (values ('the negator', o.oprnegate::oid), ('the commutator', o.oprcom::oid)) s(field, op)
       where w.classid = 'pg_operator'::regclass and o.oid = w.objid and s.op <> 0
      union all
      select 'pg_proc'::regclass::oid, s.fn, w.home, format('%%s of aggregate %%s', s.field, s.agg::regprocedure)
        from aggsupport s
       where w.classid = 'pg_proc'::regclass and s.agg = w.objid
    ) e
   where not (w.classid = 'pg_proc'::regclass and w.objid in (select p.oid from pg_proc p where p.prosecdef))
),
blindnode(what, shome, sclassid, sobjid, via) as (
  select case when p.proowner in (select j.oid from judged j)
                then format('function %%s is owned by %%s, which can replace it at will', p.oid::regprocedure, pg_get_userbyid(p.proowner))
              when p.prosqlbody is null
                then format('function %%s is LANGUAGE %%s: its body is not in the catalog, so what it calls cannot be followed', p.oid::regprocedure, l.lanname)
              else format('function %%s names a relation in its body: what it writes there is not followed', p.oid::regprocedure) end,
         w.shome, w.sclassid, w.sobjid, w.via
    from walk w
    join pg_proc p on w.classid = 'pg_proc'::regclass and p.oid = w.objid and not p.prosecdef
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where p.proowner in (select j.oid from judged j)
      or (p.prosqlbody is null and l.lanname <> 'internal'
          and n.nspname !~ '^(pg_catalog|information_schema|pg_toast|pg_temp_[0-9]+|pg_toast_temp_[0-9]+)$'
          and not exists (select 1 from pg_depend x where x.classid = 'pg_proc'::regclass and x.objid = p.oid and x.deptype = 'e'))
      or (p.prosqlbody is not null
          and exists (select 1 from pg_depend x where x.classid = 'pg_proc'::regclass and x.objid = p.oid and x.refclassid = 'pg_class'::regclass))
  union
  select format('function %%s runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed',
                b.oid::regprocedure),
         w.shome, w.sclassid, w.sobjid, w.via
    from walk w
    cross join lateral (
      select k.conbin::text as tree from pg_constraint k where w.classid = 'pg_constraint'::regclass and k.oid = w.objid
      union all
      select a.adbin::text from pg_attrdef a where w.classid = 'pg_attrdef'::regclass and a.oid = w.objid
      union all
      select concat(i.indexprs::text, ' ', i.indpred::text) from pg_index i where w.classid = 'pg_class'::regclass and i.indexrelid = w.objid
      union all
      select p.partexprs::text from pg_partitioned_table p where w.classid = 'pg_class'::regclass and p.partrelid = w.objid
      union all
      select concat(r.ev_qual::text, ' ', r.ev_action::text) from pg_rewrite r where w.classid = 'pg_rewrite'::regclass and r.oid = w.objid
      union all
      select x.stxexprs::text from pg_statistic_ext x where w.classid = 'pg_statistic_ext'::regclass and x.oid = w.objid
      union all
      select concat(p.polqual::text, ' ', p.polwithcheck::text) from pg_policy p where w.classid = 'pg_policy'::regclass and p.oid = w.objid
      union all
      select t.tgqual::text from pg_trigger t where w.classid = 'pg_trigger'::regclass and t.oid = w.objid
      union all
      select t.typdefaultbin::text from pg_type t where w.classid = 'pg_type'::regclass and t.oid = w.objid
      union all
      select p.prosqlbody::text from pg_proc p where w.classid = 'pg_proc'::regclass and p.oid = w.objid
    ) t
    join pg_proc b on b.pronamespace = 'pg_catalog'::regnamespace
                  and b.proname in ('query_to_xml', 'query_to_xmlschema', 'query_to_xml_and_xmlschema', 'cursor_to_xml',
                                    'cursor_to_xmlschema', 'table_to_xml', 'table_to_xmlschema', 'table_to_xml_and_xmlschema',
                                    'schema_to_xml', 'schema_to_xmlschema', 'schema_to_xml_and_xmlschema', 'database_to_xml',
                                    'database_to_xmlschema', 'database_to_xml_and_xmlschema', 'ts_stat', 'ts_rewrite',
                                    'pg_input_is_valid', 'pg_input_error_info', 'brin_summarize_new_values',
                                    'brin_summarize_range', 'brin_desummarize_range', 'gin_clean_pending_list',
                                    'record_in', 'array_in', 'domain_in', 'range_in', 'multirange_in',
                                    'satisfies_hash_partition')
                  and position(format(':funcid %%s ', b.oid) in t.tree) > 0
  union
  select format('type %%s is owned by %%s, which can add a CHECK or a cast to it at will', t.oid::regtype, pg_get_userbyid(t.typowner)),
         w.shome, w.sclassid, w.sobjid, w.via
    from walk w
    join pg_type t on w.classid = 'pg_type'::regclass and t.oid = w.objid
   where t.typowner in (select j.oid from judged j)
  union
  select format('relation %%s is owned by %%s, which can change its policies or its query at will', c.oid::regclass, pg_get_userbyid(c.relowner)),
         w.shome, w.sclassid, w.sobjid, w.via
    from walk w
    join pg_class c on w.classid = 'pg_class'::regclass and c.oid = w.objid
   where c.relowner in (select j.oid from judged j)
),
blind(what, who, how) as (
  select b.what, s.who, s.how || case when b.via = '' then '' else format(', through %%s', b.via) end
    from blindnode b
    join seeds s on s.home = b.shome and s.classid = b.sclassid and s.objid = b.sobjid
),
walkdef(fn, who, how) as (
  select w.objid, s.who, s.how || case when w.via = '' then '' else format(', through %%s', w.via) end
    from walk w
    join pg_proc q on w.classid = 'pg_proc'::regclass and q.oid = w.objid and q.prosecdef
    join seeds s on s.home = w.shome and s.classid = w.sclassid and s.objid = w.sobjid
)
select distinct n.nspname::text, p.proname::text, oidvectortypes(p.proargtypes), e.who, e.how, false
  from (select fn, who::text, how from everything
        union all
        select d.fn, d.who, d.how
          from walkdef d
         where not exists (select 1 from everything x where x.fn = d.fn and x.who::text = d.who)) e
  join pg_proc p on p.oid = e.fn and p.prosecdef
  join pg_namespace n on n.oid = p.pronamespace
union all
select distinct '', b.what, '', b.who, b.how, true
  from blind b
 order by 1, 2, 3, 4, 5
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
#: REACH_SQL's arms, one clause at least per arm: --self-test fails if any is edited away.
REACH_SQL_MUST_SAY = tuple((c, 1) for c in (
    # the judged roles, and what they may write
    "r.rolname = any(%(judged)s)",
    "has_any_column_privilege(j.oid, c.oid, o.op)",
    "has_table_privilege(j.oid, c.oid, o.op)",
    "('INSERT', 4, 8, '3'), ('DELETE', 8, 16, '4'), ('UPDATE', 16, 4, '2'), ('TRUNCATE', 32, 0, '')",
    # where a write lands: children, a row an UPDATE moves between partitions, views (a view over a
    # view with INSTEAD OF triggers included), rules, foreign-key actions (as the owner)
    "select i.inhrelid as rel, w.op as op, false as as_owner, w.via as via",
    "join pg_class p on p.oid = i.inhparent and p.relkind = 'p'",
    "cross join (values ('INSERT'), ('DELETE')) m(op)",
    "where i.inhparent = w.rel and w.op = 'UPDATE'",
    "(pg_relation_is_updatable(w.rel, true) & s.updbit) <> 0",
    "or r.ev_type = s.evtype",
    "select w.who, e.rel, e.op, w.as_owner or e.as_owner, e.via",
    "where k.contype = 'f' and k.confrelid = w.rel",
    "k.confdeltype in ('c', 'n', 'd')",
    "k.confupdtype in ('c', 'n', 'd')",
    # MAINTAIN, down to partitions, and what a refreshed materialized view reads
    "where c.relkind in ('r', 'p', 'm', 'f') and has_table_privilege(j.oid, c.oid, 'MAINTAIN')",
    "join pg_inherits i on i.inhparent = m.rel",
    "join pg_class c on c.oid = m.rel and c.relkind = 'm'",
    "join pg_rewrite r on r.ev_class = v.rel",
    # what a relation's objects are, and what they call directly
    "select t.tgrelid, t.tgfoid::oid, 'trigger'",
    "'pg_trigger'::regclass::oid, t.oid, t.tgrelid, 'when'",
    "'pg_constraint'::regclass::oid, k.oid, k.conrelid, 'constraint'",
    "'pg_attrdef'::regclass::oid, a.oid, a.adrelid, 'default'",
    "'pg_class'::regclass::oid, i.indexrelid, i.indrelid, 'index'",
    "'pg_class'::regclass::oid, a.relid::oid, c.oid, 'partition key',",
    "cross join lateral pg_partition_ancestors(c.oid) a",
    "join pg_class pa on pa.oid = a.relid and pa.relkind = 'p'",
    "where c.relkind = 'p' or c.relispartition",
    "'pg_rewrite'::regclass::oid, r.oid, r.ev_class, 'rule'",
    "'pg_statistic_ext'::regclass::oid, s.oid, s.stxrelid, 'statistics'",
    "'pg_policy'::regclass::oid, p.oid, p.polrelid, 'policy'",
    "join pg_constraint k on k.contypid = dm.typ",
    "'pg_type'::regclass::oid, dm.typ, a.attrelid, 'domain'",
    "join pg_depend d on d.classid = o.classid and d.objid = o.objid and d.refclassid = 'pg_proc'::regclass",
    # aggregates: all eight support functions
    "('aggtransfn', a.aggtransfn::oid)", "('aggfinalfn', a.aggfinalfn::oid)",
    "('aggcombinefn', a.aggcombinefn::oid)", "('aggserialfn', a.aggserialfn::oid)",
    "('aggdeserialfn', a.aggdeserialfn::oid)", "('aggmtransfn', a.aggmtransfn::oid)",
    "('aggminvtransfn', a.aggminvtransfn::oid)", "('aggmfinalfn', a.aggmfinalfn::oid)",
    "join judged j on has_function_privilege(j.oid, s.agg, 'EXECUTE')",
    "join aggsupport s on s.agg = r.fn",
    # the reached arms
    "join attached a on a.rel = w.rel and a.kind in ('when', 'constraint', 'default', 'index', 'partition key', 'rule', 'domain')",
    "join attached a on a.rel = w.rel and a.kind in ('index', 'statistics')",
    "join attached a on a.rel = m.rel and a.kind in ('index', 'statistics')",
    "join attached a on a.rel = v.rel and a.kind in ('rule', 'policy')",
    "join pg_type t on t.typowner = j.oid",
    "(p.pronargs > 0 and p.proargtypes[0] = t.oid) or p.prorettype = t.oid",
    # reached by any role (PUBLIC)
    "select x.fn, 'PUBLIC', x.how",
    "where o.oprrest <> 0", "where o.oprjoin <> 0",
    "where p.prosupport <> 0",
    "('input function', t.typinput::oid)", "('output function', t.typoutput::oid)",
    "('receive function', t.typreceive::oid)", "('send function', t.typsend::oid)",
    "('typmod input function', t.typmodin::oid)", "('typmod output function', t.typmodout::oid)",
    "('analyze function', t.typanalyze::oid)", "('subscripting handler', t.typsubscript::oid)",
    "('canonical function', r.rngcanonical::oid)", "('subtype_diff function', r.rngsubdiff::oid)",
    "from pg_event_trigger e",
    "('start function', p.prsstart::oid)", "('gettoken function', p.prstoken::oid)",
    "('end function', p.prsend::oid)", "('headline function', p.prsheadline::oid)",
    "('lextypes function', p.prslextype::oid)",
    "('init function', t.tmplinit::oid)", "('lexize function', t.tmpllexize::oid)",
    "('call handler', l.lanplcallfoid)", "('inline handler', l.laninline)", "('validator', l.lanvalidator)",
    "('handler', w.fdwhandler)", "('validator', w.fdwvalidator)",
    "select a.amhandler::oid", "select c.conproc::oid",
    "('from-SQL function', t.trffromsql::oid)", "('to-SQL function', t.trftosql::oid)",
    "p.prorettype = 'tsm_handler'::regtype",
    "select p.amproc::oid", "select o.oprcode::oid", "select o.oprrest::oid", "select o.oprjoin::oid",
    "select p.prosupport::oid", "select c.castfunc,", "select e.evtfoid,",
    # [round-7 repair 2] a selectivity estimator calls the operator's function -- and its negator's and
    # commutator's -- on column statistics while planning (C10, C10n, C10c, C10j)
    "select q.oprcode::oid,",
    "join pg_operator q on q.oid in (o.oid, o.oprnegate, o.oprcom)",
    "where (o.oprrest <> 0 or o.oprjoin <> 0) and q.oprcode <> 0",
    "select p.oid, 'a TABLESAMPLE method: any query may name it'",
    # what each reached arm selects, and a foreign-key action marked as the owner
    "select a.fn, m.who,", "select a.fn, v.who,", "select s.fn, j.rolname,", "select p.oid, j.rolname,",
    "select s.fn, r.who,", "then 'DELETE' else 'UPDATE' end, true, w.via",
    # SEEDS: every object PostgreSQL runs as an owner for a judged role (a foreign-key action's
    # triggers and objects, autoanalyze, MAINTAIN, REFRESH) -- the walk starts from each
    "a.rel, 'pg_proc'::regclass::oid, a.fn",
    "join objects o on o.rel = w.rel and o.kind in ('when', 'constraint', 'default', 'index', 'partition key', 'rule', 'domain')",
    "join objects o on o.rel = w.rel and o.kind in ('index', 'statistics')",
    "join objects o on o.rel = m.rel and o.kind in ('index', 'statistics')",
    "join objects o on o.rel = v.rel and o.kind in ('rule', 'policy')",
    # [round-7 repair 2] ANALYZE runs every column's type statistics code (C1, C1p, C1a) ...
    "(a.attrelid in (select m.rel from maintain m)",
    "or a.attrelid in (select w.rel from writes w join pg_class c on c.oid = w.rel and c.relkind in ('r', 'p')))",
    "select t.typbasetype as typ where t.typtype = 'd'",
    "select t.typelem where t.typelem <> 0 and t.typlen = -1",
    "select r.rngsubtype from pg_range r where r.rngtypid = t.oid",
    "select r.rngtypid from pg_range r where r.rngmultitypid = t.oid",
    "select a.atttypid from pg_attribute a where t.typtype = 'c' and a.attrelid = t.typrelid",
    "join pg_type t on t.oid = s.typ and t.typanalyze <> 0",
    "join pg_range r on r.rngtypid = s.typ and r.rngsubdiff <> 0",
    "'pg_opclass'::regclass::oid, r.rngsubopc,",
    "join pg_opclass c on c.opcintype = s.typ and c.opcdefault",
    "join pg_am a on a.oid = c.opcmethod and a.amname in ('btree', 'hash')",
    "join statobj o on o.home = m.rel",
    "join statobj o on o.home = w.rel",
    # ... and a foreign key's CHECK runs as the other table's owner (C2, C2p, C2n)
    "join pg_constraint k on k.contype = 'f'",
    "and ((k.conrelid = w.rel and w.op in ('INSERT', 'UPDATE'))",
    "or (k.confrelid = w.rel and w.op in ('UPDATE', 'DELETE')))",
    # WALK: what an owner-context object names, however it names it
    # [round-7 repair 2] walked once per distinct seed object; the roles are joined back to what it reaches
    "select distinct s.home, s.classid, s.objid from seeds s",
    "select s.home, s.classid, s.objid, s.home, s.classid, s.objid, ''::text",
    "select w.shome, w.sclassid, w.sobjid, e.home, e.classid, e.objid,",
    "d.refclassid in ('pg_proc'::regclass, 'pg_operator'::regclass, 'pg_type'::regclass,",
    "'pg_opclass'::regclass, 'pg_opfamily'::regclass, 'pg_ts_config'::regclass,",
    "'pg_ts_dict'::regclass, 'pg_ts_parser'::regclass, 'pg_ts_template'::regclass)",
    "and d.refobjid in (select t.tgfoid from pg_trigger t where t.oid = w.objid)",
    "join pg_attribute a on a.attrelid = d.refobjid",
    "or (d.refobjsubid = 0 and d.refobjid = w.home and a.attnum > 0 and not a.attisdropped))",
    "d.refclassid = 'pg_class'::regclass and d.refobjid <> w.home",
    "not (w.classid = 'pg_constraint'::regclass and d.objid in (select k.oid from pg_constraint k where k.contype = 'f'))",
    "where w.classid = 'pg_class'::regclass and a.attrelid = w.objid and a.attnum > 0 and not a.attisdropped",
    "join pg_class c on c.oid = p.polrelid and c.relrowsecurity",
    "join pg_class c on c.oid = r.ev_class and c.relkind = 'v'",
    "where w.classid = 'pg_type'::regclass and k.contypid = w.objid",
    "where w.classid = 'pg_type'::regclass and w.objid in (c.castsource, c.casttarget) and c.castfunc <> 0",
    "where (w.classid = 'pg_type'::regclass and w.objid in (p.amproclefttype, p.amprocrighttype))",
    "(w.classid = 'pg_opfamily'::regclass and p.amprocfamily = w.objid)",
    "where (w.classid = 'pg_type'::regclass and w.objid in (a.amoplefttype, a.amoprighttype))",
    "(w.classid = 'pg_opfamily'::regclass and a.amopfamily = w.objid)",
    "where w.classid = 'pg_opclass'::regclass and c.oid = w.objid",
    "('the function', o.oprcode::oid), ('the restriction estimator', o.oprrest::oid),",
    "where w.classid = 'pg_operator'::regclass and o.oid = w.objid and s.fn <> 0",
    "where w.classid = 'pg_proc'::regclass and s.agg = w.objid",
    # [round-7 repair 2] the planner swaps an operator for its negator (C3, C3m, C3i) or commutator
    "(values ('the negator', o.oprnegate::oid), ('the commutator', o.oprcom::oid)) s(field, op)",
    "where w.classid = 'pg_operator'::regclass and o.oid = w.objid and s.op <> 0",
    "where not (w.classid = 'pg_proc'::regclass and w.objid in (select p.oid from pg_proc p where p.prosecdef))",
    # BLIND: owner-context code the catalog cannot describe -> exit 2
    "join pg_proc p on w.classid = 'pg_proc'::regclass and p.oid = w.objid and not p.prosecdef",
    "p.prosqlbody is null and l.lanname <> 'internal'",
    "n.nspname !~ '^(pg_catalog|information_schema|pg_toast|pg_temp_[0-9]+|pg_toast_temp_[0-9]+)$'",
    "x.classid = 'pg_proc'::regclass and x.objid = p.oid and x.deptype = 'e'",
    "p.prosqlbody is not null",
    "x.classid = 'pg_proc'::regclass and x.objid = p.oid and x.refclassid = 'pg_class'::regclass",
    "position(format(':funcid %%s ', b.oid) in t.tree) > 0",
    "join pg_proc b on b.pronamespace = 'pg_catalog'::regnamespace",
    "'query_to_xml', 'query_to_xmlschema', 'query_to_xml_and_xmlschema', 'cursor_to_xml',",
    "'ts_stat', 'ts_rewrite',",
    "'pg_input_is_valid', 'pg_input_error_info', 'brin_summarize_new_values',",
    "'brin_summarize_range', 'brin_desummarize_range', 'gin_clean_pending_list',",
    # [round-7 repair 2] builtins handed a type or a table by OID (C4, C4r, C4a, C5)
    "'record_in', 'array_in', 'domain_in', 'range_in', 'multirange_in',",
    "'satisfies_hash_partition')",
    "select k.conbin::text as tree from pg_constraint k",
    "select a.adbin::text from pg_attrdef a",
    "select concat(i.indexprs::text, ' ', i.indpred::text) from pg_index i",
    "select p.partexprs::text from pg_partitioned_table p",
    "select concat(r.ev_qual::text, ' ', r.ev_action::text) from pg_rewrite r",
    "select x.stxexprs::text from pg_statistic_ext x",
    "select concat(p.polqual::text, ' ', p.polwithcheck::text) from pg_policy p",
    "select t.tgqual::text from pg_trigger t",
    "select t.typdefaultbin::text from pg_type t",
    "select p.prosqlbody::text from pg_proc p",
    "where t.typowner in (select j.oid from judged j)",
    "where c.relowner in (select j.oid from judged j)",
    # the verdict: definers only, one row per (function, who, path), then the blind rows
    "join pg_proc p on p.oid = e.fn and p.prosecdef",
    "join pg_proc q on w.classid = 'pg_proc'::regclass and q.oid = w.objid and q.prosecdef",
    "where not exists (select 1 from everything x where x.fn = d.fn and x.who::text = d.who)",
    "join seeds s on s.home = b.shome and s.classid = b.sclassid and s.objid = b.sobjid",
    "join seeds s on s.home = w.shome and s.classid = w.sclassid and s.objid = w.sobjid",
    "select distinct n.nspname::text, p.proname::text, oidvectortypes(p.proargtypes), e.who, e.how, false",
    "select distinct '', b.what, '', b.who, b.how, true\n  from blind b\n order by 1, 2, 3, 4, 5\n",
)) + (("join dom dm on dm.start in (a.atttypid, at.typelem)", 2), ("where s.fn <> 0", 8),
      ("select a.fn, w.who,", 3), ("from pg_inherits i", 2), ("where i.inhparent = w.rel", 2),
      ("join attached a on a.rel = w.rel and a.kind = 'trigger' and (a.tgtype & o.tgbit) <> 0", 2),
      ("where w.as_owner", 3), ("from pg_amproc p", 2), ("from pg_amop a", 2), ("from pg_cast c", 2),
      ("p.proowner in (select j.oid from judged j)", 2), ("w.shome, w.sclassid, w.sobjid, w.via", 4))


#: md5 of each query's exact text, as the ADR 0159 replay measured it [2026-09-19, round-7 repair].
#: A clause pin cannot see a falsifier inserted beside the clause it pins (`where false and (...)`,
#: an extra `and false` line) -- the repair's mutation table found two such survivors -- so any
#: edit to a query fails --self-test until it is re-pinned here, in a diff that re-runs the replay.
QUERIES_MD5 = {
    "ROLES_SQL": "5e2ea6cc9b62517b0b1f4fa2fe5f0359",
    "CLIENT_SQL": "4e2f656e14b4fa265742e1e446447008",
    "QUERY": "c1be21fc11faa8b22891428ea2886da2",
    "REACH_SQL": "6d61c09d09ad23185b7c69545bbb15eb",
}


def query_pins_broken(q: str, must: tuple = QUERY_MUST_SAY) -> list[str]:
    """The `must` clauses `q` does not say exactly as often as required, and any SQL comment
    (an arm commented out would still say its clauses)."""
    broken = [f"{c!r} x{q.count(c)}, not x{n}" for c, n in must if q.count(c) != n]
    return broken + [f"the query carries a SQL comment ({tok!r})" for tok in ("--", "/*") if tok in q]


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
             adr_dir: Path, floor: int = MIN_PUBLIC_SECDEF, blind: list | tuple = ()) -> tuple[int, str]:
    """The whole verdict, from fetched rows. Returns (exit code, report).

    `blind` holds REACH_SQL's (what, who, how) rows for code PostgreSQL runs as an object's owner for
    a judged role that the catalog does not describe: never a pass (exit 2), and printed under a leak."""
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
    through_n = 0
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
        left += [(who, f"through another object: {how}") for who, how in row.get("through", ())]
        through_n += bool(row.get("through"))
        if left:
            leaks.append((key, row["owner"], left, mismatched.get(key, [])))

    stale = sorted(set(allow) - used)
    blind_by: dict[str, list[tuple[str, str]]] = {}
    for what, who, how in blind:
        blind_by.setdefault(what, []).append((who, how))
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
        if through_n:
            lines.append("Reached through another object: make the function SECURITY INVOKER, or take the")
            lines.append("object out of reach (revoke the write, the MAINTAIN, the EXECUTE on the aggregate).")
            lines.append("CLIENT_CALLABLE never excuses this.")
    if stale:
        lines.append("CANNOT CHECK -- CLIENT_CALLABLE entr(ies) that excuse nothing in this database:")
        for k in stale:
            lines.append(f"  {k}")
            lines.extend(f"      {d}" for d in mismatched.get(k, []))
        lines.append("   Remove the entry (the list only shrinks), or find why the function changed.")
    if public_n < floor:
        lines.append(f"CANNOT CHECK -- {public_n} in-scope SECURITY DEFINER function(s) in schema public, "
                     f"fewer than the floor of {floor}. Either this is not the database migrations "
                     f"build, or a hardening PR legitimately lowered the live count -- if so, lower "
                     f"MIN_PUBLIC_SECDEF in this script to match, with a comment naming the PR and why.")
    if blind_by:
        lines.append("CANNOT CHECK -- code PostgreSQL runs as an object's owner for PUBLIC or a role the API can "
                     "switch into, which the catalog does not describe (BLIND):")
        for what, paths in blind_by.items():
            lines.append(f"  BLIND {what}")
            lines.extend(f"      {who}: {how}" for who, how in paths)
        lines.append("   Make the function SQL-standard (BEGIN ATOMIC, naming no relation) so the catalog records what it")
        lines.append("   calls, give the object to a role the API cannot switch into, or take the path out of reach.")
    summary = (f"{public_n} in public (floor {floor}), {len(scope)} in scope, {ext} extension member(s) "
               f"excluded, {system} in system schemas excluded, {len(used)}/{len(allow)} allowlisted "
               f"(identity pinned), {through_n} reached through another object, "
               f"{len(blind_by)} owner-context object(s) it cannot read; "
               f"judged: PUBLIC, {', '.join(sorted(judged))}")
    if leaks:
        lines.append(f"DEFINER-CHECK FAIL -- {len(leaks)} open; {summary}")
        return 1, "\n".join(lines)
    if stale or public_n < floor or blind_by:
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


def attach_reach(rows: list[dict], reach: list[tuple]) -> list[tuple[str, str, str]]:
    """Hang each REACH_SQL row on its function's catalog row, as (who, how); return the BLIND rows
    as (what, who, how)."""
    by_key = {fn_key(r): r for r in rows}
    blind: list[tuple[str, str, str]] = []
    for r in reach:
        if len(r) != len(REACH_FIELDS):
            raise CannotCheck(f"the reach query returned rows that are not {len(REACH_FIELDS)} columns wide")
        hit = dict(zip(REACH_FIELDS, r))
        if hit["blind"] is True:
            blind.append((hit["name"], hit["who"], hit["how"]))
            continue
        if hit["blind"] is not False:
            raise CannotCheck(f"the reach query's blind column held {hit['blind']!r}, not true or false")
        row = by_key.get(fn_key(hit))
        if row is None:
            raise CannotCheck(f"the reach query named {fn_key(hit)}, which the catalog query did not return")
        row["through"].append((hit["who"], hit["how"]))
    return blind


def fetch(dsn: str) -> tuple[dict[str, bool], dict[str, bool], list[dict], list[tuple[str, str, str]]]:
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
                return present, {}, [], []
            cur.execute(CLIENT_SQL)
            judged = judged_roles(present, {r[0]: bool(r[1]) for r in cur.fetchall()})
            cur.execute(QUERY, {"judged": sorted(judged)})
            raw = cur.fetchall()
            if any(len(r) != len(ROW_FIELDS) for r in raw):
                raise CannotCheck(f"the catalog query returned rows that are not {len(ROW_FIELDS)} columns wide")
            rows = [dict(zip(ROW_FIELDS, r), through=[]) for r in raw]
            cur.execute(REACH_SQL, {"judged": sorted(judged)})
            blind = attach_reach(rows, cur.fetchall())
        return present, judged, rows, blind
    except Exception as exc:  # noqa: BLE001
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
        raise CannotCheck(f"the catalog query failed ({type(exc).__name__}: {first})") from exc
    finally:
        conn.close()


def run(dsn: str, fetcher=fetch, env: dict | None = None, allow: dict | None = None) -> tuple[int, str]:
    try:
        require_local(dsn, env)
        present, judged, rows, blind = fetcher(dsn)
    except CannotCheck as exc:
        return 2, f"CANNOT CHECK -- {exc}\n   Exiting 2. A check that could not ask must never read as PASS."
    return evaluate(present, judged, rows, CLIENT_CALLABLE if allow is None else allow, ADR_DIR, blind=blind)


# ---------------------------------------------------------------------------
# --self-test: synthetic rows, no database
# ---------------------------------------------------------------------------
def _row(schema="public", name="f", args="uuid", owner="postgres", acl_null=False, ext=False,
         grantees=("postgres",), via=(), reach=(), language="plpgsql", returns="void", retset=False,
         kind="f", config=(), src_md5="0" * 32, through=()) -> dict:
    return {"schema": schema, "name": name, "args": args, "owner": owner, "acl_null": acl_null, "ext": ext,
            "grantees": list(grantees), "via": list(via), "reach": list(reach), "language": language,
            "returns": returns, "retset": retset, "kind": kind, "config": list(config), "src_md5": src_md5,
            "through": [tuple(t) for t in through]}


def _closed(name: str, schema: str = "public") -> dict:
    return _row(schema=schema, name=name, grantees=("postgres", "service_role"))


#: ADR 0159 round 7: the first reach-through line the PGlite replay printed for each newly judged
#: path (a closed definer behind the object; the full table is in the ADR). --self-test replays each:
#: with the path the function must fail printing that line, and its closed control -- the same
#: function with no path -- must pass. Row ids are the replay's.
_REACH_REPLAYS = (
    ('T1', 'zz_trg', '', 'anon',
     'trigger zz_bi on zz_t fires it with no EXECUTE check (anon may INSERT zz_t)'),
    ('T2', 'zz_trg', '', 'anon',
     'trigger zz_bi on zz_t fires it with no EXECUTE check (anon may INSERT zz_t)'),
    ('T3', 'zz_trg', '', 'anon',
     'trigger zz_bu on zz_t fires it with no EXECUTE check (anon may UPDATE zz_t)'),
    ('T4', 'zz_trg', '', 'anon',
     'trigger zz_bd on zz_t fires it with no EXECUTE check (anon may DELETE zz_t)'),
    ('T5', 'zz_trg', '', 'anon',
     'trigger zz_bt on zz_t fires it with no EXECUTE check (anon may TRUNCATE zz_t)'),
    ('T6', 'zz_trg', '', 'anon',
     'trigger zz_io on zz_v fires it with no EXECUTE check (anon may INSERT zz_v)'),
    ('T7', 'zz_trg', '', 'anon',
     'trigger zz_bi on zz_base fires it with no EXECUTE check (anon may INSERT zz_av)'),
    ('T8', 'zz_trg', '', 'anon',
     'trigger zz_bi on zz_tgt fires it with no EXECUTE check (anon may INSERT zz_r)'),
    ('T9', 'zz_trg', '', 'anon',
     'trigger zz_bi on zz_p1 fires it with no EXECUTE check (anon may INSERT zz_p)'),
    ('T10', 'zz_trg', '', 'anon',
     'trigger zz_bu on zz_chi fires it with no EXECUTE check (anon may UPDATE zz_par)'),
    ('T11', 'zz_trg', '', 'anon',
     'trigger zz_bd on zz_b fires it with no EXECUTE check (anon may DELETE zz_a; a foreign-key action writes the table as its owner)'),
    ('T12', 'zz_trg', '', 'anon',
     'trigger zz_bu on zz_b fires it with no EXECUTE check (anon may DELETE zz_a; a foreign-key action writes the table as its owner)'),
    ('T13', 'zz_trg', '', 'anon',
     'trigger zz_bu on zz_b fires it with no EXECUTE check (anon may UPDATE zz_a; a foreign-key action writes the table as its owner)'),
    ('C1', 'zz_chk', 'integer', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C2', 'zz_dflt', '', 'anon',
     "the default or generation expression of column a_id on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C3', 'zz_ix', 'integer', 'anon',
     "index zz_b_ix on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C4', 'zz_gen', 'integer', 'anon',
     "the default or generation expression of column g on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C6', 'zz_when', 'integer', 'anon',
     "the WHEN clause of trigger zz_bu on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C7', 'zz_rulefn', 'integer', 'anon',
     "rule zz_also on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C8', 'zz_pk', 'integer', 'anon',
     "its partition key on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C9', 'zz_domchk', 'integer', 'anon',
     "a CHECK of domain zz_dom (column a_id) on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('G1', 'zz_sf', 'text, integer', 'anon',
     "aggtransfn of aggregate zz_agg(integer), which anon may EXECUTE: support functions are checked against the aggregate's owner, not the caller"),
    ('G2', 'zz_ff', 'integer', 'anon',
     "aggfinalfn of aggregate zz_agg(integer), which anon may EXECUTE: support functions are checked against the aggregate's owner, not the caller"),
    ('G3', 'zz_mff', 'integer', 'anon',
     "aggmfinalfn of aggregate zz_agg(integer), which anon may EXECUTE: support functions are checked against the aggregate's owner, not the caller"),
    ('G4', 'zz_comb', 'integer, integer', 'anon',
     "aggcombinefn of aggregate zz_agg(integer), which anon may EXECUTE: support functions are checked against the aggregate's owner, not the caller"),
    ('O1', 'zz_mcmp', 'zzm, zzm', 'PUBLIC',
     'support function 1 of operator family zzm_ops: sorting, hashing, indexes and the type cache call it with no EXECUTE check'),
    ('O6', 'zz_jsel', 'internal, oid, internal, smallint, internal', 'PUBLIC',
     'join estimator of operator =%=(integer,integer): the planner calls it for any query that uses the operator'),
    ('O7', 'zz_jsel', 'internal, oid, internal, smallint, internal', 'PUBLIC',
     'join estimator of operator =%=(integer,integer): the planner calls it for any query that uses the operator'),
    ('S1', 'zz_supp', 'internal', 'PUBLIC',
     'planner support function of zz_series(integer,integer): the planner calls it for any query that names that function'),
    ('Y1', 'zz_tin', 'cstring', 'PUBLIC',
     'input function of type zzt: called wherever a value of the type is read, written or described'),
    ('Y7', 'zz_tan', 'internal', 'PUBLIC',
     'analyze function of type zza: called wherever a value of the type is read, written or described'),
    ('Y8', 'zz_tsub', 'internal', 'PUBLIC',
     'subscripting handler of type zzs: called wherever a value of the type is read, written or described'),
    ('R1', 'zz_rcan', 'zzr', 'PUBLIC',
     'canonical function of range type zzr: called wherever a value of the type is built or indexed'),
    ('R2', 'zz_rsd', 'double precision, double precision', 'PUBLIC',
     'subtype_diff function of range type zzr2: called wherever a value of the type is built or indexed'),
    ('X2', 'zz_cint', 'zzc', 'PUBLIC',
     'the cast from zzc to integer: to_json(), json_agg() and to_jsonb() call a cast to json with no EXECUTE check'),
    ('M1', 'zz_ix', 'integer', 'anon',
     "index zz_t_ix on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t)"),
    ('M3', 'zz_sx', 'integer', 'anon',
     "statistics object zz_st on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t)"),
    ('M4', 'zz_mvf', '', 'anon',
     'rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv)'),
    ('M6', 'zz_pol', '', 'anon',
     "policy zz_p on zz_t: REFRESH MATERIALIZED VIEW runs it as the view's owner (anon may MAINTAIN zz_mv)"),
    ('M7', 'zz_vf', '', 'anon',
     'rule "_RETURN" on zz_v: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv)'),
    ('M9', 'zz_ix', 'integer', 'anon',
     "index zz_p1_ix on zz_p1: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_p)"),
    ('L1', 'zz_inl', 'internal', 'PUBLIC',
     'inline handler of language zzpl'),
    ('L2', 'zz_hnd', '', 'PUBLIC',
     'call handler of language zzpl2'),
    ('L3', 'zz_val', 'oid', 'PUBLIC',
     'validator of language zzpl3'),
    ('F1', 'zz_fdwv', 'text[], oid', 'PUBLIC',
     'validator of foreign-data wrapper zzfdw'),
    ('A1', 'zz_amh', 'internal', 'PUBLIC',
     'handler of access method zzbt'),
    ('A2', 'zz_tamh', 'internal', 'PUBLIC',
     'handler of access method zzheap'),
    ('V1', 'zz_conv', 'integer, integer, cstring, internal, integer, boolean', 'PUBLIC',
     'encoding conversion zz_cv'),
    ('W1', 'zz_pe', 'internal', 'PUBLIC',
     'end function of text search parser zzp'),
    ('W6', 'zz_ti', 'internal', 'PUBLIC',
     'init function of text search template zztpl'),
    ('Z1', 'zz_tsm', 'internal', 'PUBLIC',
     'a TABLESAMPLE method: any query may name it'),
    ('E1', 'zz_evt', '', 'PUBLIC',
     'event trigger zz_et: any DDL command fires it, even one its own privileges then refuse'),
    ('K6-aa', 'zz_ix', 'integer', 'anon',
     "index zz_t_zz_ix_idx on zz_t: autoanalyze runs it as the table's owner after writes (anon may INSERT zz_t)"),
    ('M5-aa', 'zz_sx', 'integer', 'anon',
     "statistics object zz_st on zz_t: autoanalyze runs it as the table's owner after writes (anon may INSERT zz_t)"),
    ('XO', 'zz_ojson', 'zzo', 'anon',
     'anon owns type zzo, and CREATE CAST checks no EXECUTE: a cast to json with this function runs for any to_json()'),
    ('GS', 'zz_deser', 'bytea, internal', 'anon',
     "aggdeserialfn of aggregate zz_avg(numeric), which anon may EXECUTE: support functions are checked against the aggregate's owner, not the caller"),
    ('F2', 'zz_fdwh', '', 'PUBLIC',
     'handler of foreign-data wrapper zzfdw2'),
    ('TR', 'zz_fromsql', 'internal', 'PUBLIC',
     'from-SQL function of the transform for zzt2 in language plpgsql'),
    ('EL', 'zz_login', '', 'PUBLIC',
     'event trigger zz_login: every login fires it'),
)

#: ADR 0159 round-7 REPAIR (2026-09-19): the adversarial pass. Each row is the first reach-through line
#: the worktree's script printed on the PGlite plant of that attack (audit-391-r7-repair/attacks.mjs;
#: V* rebuild the round-7 verifier's list, B* are the paths the round-7 query missed or mis-scoped).
#: Replayed exactly as _REACH_REPLAYS: the leak must fail naming that line, its closed control must pass.
_REACH_REPLAYS_R7_REPAIR = (
    ('V1', 'zz_trg', '', 'anon',
     'trigger zz_io on zz_v fires it with no EXECUTE check (anon may UPDATE zz_v)'),
    ('V2', 'zz_trg', '', 'anon',
     'trigger zz_au on zz_t fires it with no EXECUTE check (anon may UPDATE zz_t)'),
    ('V3', 'zz_trg', '', 'anon',
     'trigger zz_at on zz_p1 fires it with no EXECUTE check (anon may TRUNCATE zz_p)'),
    ('V4', 'zz_minv', 'integer, integer', 'anon',
     "aggminvtransfn of aggregate zz_agg(integer), which anon may EXECUTE: support functions are checked against the aggregate's owner, not the caller"),
    ('V5', 'zz_rsel', 'internal, oid, internal, integer', 'PUBLIC',
     'restriction estimator of operator =%=(integer,integer): the planner calls it for any query that uses the operator'),
    ('V6', 'zz_cjson', 'zzc', 'PUBLIC',
     'the cast from zzc to json: to_json(), json_agg() and to_jsonb() call a cast to json with no EXECUTE check'),
    ('V7', 'zz_tin', 'cstring', 'PUBLIC',
     'input function of type zzt: called wherever a value of the type is read, written or described'),
    ('V8', 'zz_ix', 'integer', 'anon',
     "index zz_b_ix on zz_b runs as the table's owner, never checked against the caller (anon may UPDATE zz_a; a foreign-key action writes the table as its owner)"),
    ('V9', 'zz_chk', 'integer', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may UPDATE zz_a; a foreign-key action writes the table as its owner)"),
    ('V10', 'zz_trg', '', 'anon',
     'trigger zz_bu on zz_tgt fires it with no EXECUTE check (anon may DELETE zz_v)'),
    ('B1', 'zz_opf', 'integer, integer', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through operator =%=(integer,integer)"),
    ('B2', 'zz_dchk', 'integer', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through type zz_dom"),
    ('B3', 'zz_opf', 'integer, integer', 'anon',
     "index zz_t_ix on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t), through operator +%(integer,integer)"),
    ('B4', 'zz_opf', 'integer, integer', 'anon',
     'rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv), through operator =%=(integer,integer)'),
    ('B5', 'zz_f', 'integer', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through function zz_g(integer)"),
    ('B7', 'zz_pol', '', 'anon',
     "policy zz_p on zz_t: REFRESH MATERIALIZED VIEW runs it as the view's owner (anon may MAINTAIN zz_mv), through relation zz_t2"),
    ('B8', 'zz_sf', 'integer, integer', 'anon',
     'aggtransfn of aggregate zz_agg(integer), which is reached this way: rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv)'),
    ('B9', 'zz_trg', '', 'anon',
     'trigger zz_bi on zz_p2 fires it with no EXECUTE check (anon may UPDATE zz_p; an UPDATE that moves a row to another partition deletes it from one and inserts it into the other)'),
    ('B9d', 'zz_trg', '', 'anon',
     'trigger zz_bd on zz_p1 fires it with no EXECUTE check (anon may UPDATE zz_p; an UPDATE that moves a row to another partition deletes it from one and inserts it into the other)'),
    ('B14', 'zz_trg', '', 'anon',
     'trigger zz_io on zz_v1 fires it with no EXECUTE check (anon may INSERT zz_v2)'),
    ('B15', 'zz_dchk', 'integer', 'anon',
     "the default or generation expression of column a_id on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through type zz_dom"),
    ('B17', 'zz_dchk', 'integer', 'anon',
     "index zz_t_ix on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t), through operator +%(integer,integer)"),
    ('B20', 'zz_ix', 'integer', 'anon',
     "index zz_t_ix on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t)"),
    ('B21', 'zz_ix', 'integer', 'anon',
     "index zz_t_ix on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t)"),
    ('B26', 'zz_dchk', 'integer', 'anon',
     'rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv), through column d of zz_mv'),
)
#: ... and every attack whose owner-context path runs code the catalog does not describe: the check
#: must exit 2 printing `  BLIND <what>` and the path under it; with no such row it must pass.
_BLIND_REPLAYS = (
    ('B6', 'function zz_g(integer) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through function zz_g(integer)"),
    ('B6s', 'function zz_g(integer) is LANGUAGE sql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through function zz_g(integer)"),
    ('B12', 'function zz_cj(zzc) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     "constraint zz_b_c_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through column c of zz_b"),
    ('B13', 'function ts_rewrite(tsquery,text) runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed', 'anon',
     "constraint zz_b_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('B16', 'function zz_s.zz_g(integer) is owned by anon, which can replace it at will', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through function zz_s.zz_g(integer)"),
    ('B22', 'function zz_otrg() is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     'trigger zz_bd on zz_b fires it with no EXECUTE check (anon may DELETE zz_a; a foreign-key action writes the table as its owner)'),
    ('B23', 'function pg_input_is_valid(text,text) runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('B24', 'type zz_dom is owned by anon, which can add a CHECK or a cast to it at will', 'anon',
     "constraint zz_b_a_id_fkey on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through column a_id of zz_b"),
    ('B25', 'relation zz_t is owned by anon, which can change its policies or its query at will', 'anon',
     'rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv), through relation zz_t'),
    ('B27', 'function zz_cj(zzc) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     "constraint zz_b_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through column c of zz_b"),
    ('B28', 'function zz_rsd(double precision,double precision) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     "index zz_rt_r_idx on zz_rt: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_rt), through column r of zz_rt"),
)

#: ADR 0159 round-7 REPAIR 2 (2026-09-19): the second adversarial pass (audit-391-r7-repair2/attacks2.mjs). Each row
#: is the first reach-through line the worktree's script printed on the PGlite plant (extract3.json); replayed
#: exactly as _REACH_REPLAYS: the leak must fail naming that line, its closed control must pass.
_REACH_REPLAYS_R7_REPAIR2 = (
    ('C1', 'zz_f', 'double precision, double precision', 'anon',
     "column r of zz_rt: ANALYZE runs the subtype_diff function of range type zzr2 as the table's owner (anon may MAINTAIN zz_rt), through function zz_f(double precision,double precision)"),
    ('C1a', 'zz_f', 'double precision, double precision', 'anon',
     "column r of zz_rt: autoanalyze runs the subtype_diff function of range type zzr2 as the table's owner after writes (anon may INSERT zz_rt), through function zz_f(double precision,double precision)"),
    ('C2', 'zz_f', 'text', 'anon',
     'the check of foreign key zz_b_k_fkey on zz_b runs as the owner of zz_a, never checked against the caller (anon may INSERT zz_b), through column id of zz_a'),
    ('C2n', 'zz_f', 'text', 'anon',
     "index zz_a_pkey on zz_a: autoanalyze runs it as the table's owner after writes (anon may DELETE zz_a), through column id of zz_a_pkey"),
    ('C3', 'zz_f', 'integer, integer', 'anon',
     "constraint zz_b_v_check on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through operator =%=(integer,integer)"),
    ('C3m', 'zz_f', 'integer, integer', 'anon',
     'rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv), through operator =%=(integer,integer)'),
    ('C3i', 'zz_f', 'integer, integer', 'anon',
     "index zz_t_ix on zz_t: ANALYZE, REINDEX and CLUSTER run it as the table's owner (anon may MAINTAIN zz_t), through operator =%=(integer,integer)"),
    ('C9', 'zz_f', 'integer, integer', 'anon',
     'rule "_RETURN" on zz_mv: REFRESH MATERIALIZED VIEW runs it as the view\'s owner (anon may MAINTAIN zz_mv), through column x of zz_t2'),
    ('C10', 'zz_f', 'integer, integer', 'PUBLIC',
     'the function of operator =%=(integer,integer): the selectivity estimator of operator =%=(integer,integer) calls it on column statistics while planning, with no EXECUTE check'),
    ('C10s', 'zz_f', 'integer, integer', 'PUBLIC',
     'the function of operator =%=(integer,integer): the selectivity estimator of operator =%=(integer,integer) calls it on column statistics while planning, with no EXECUTE check'),
    ('C10n', 'zz_f', 'integer, integer', 'PUBLIC',
     'the function of operator #%#(integer,integer): the selectivity estimator of operator <>%=(integer,integer) calls it on column statistics while planning, with no EXECUTE check'),
    ('C10c', 'zz_f', 'integer, integer', 'PUBLIC',
     'the function of operator >%=(integer,integer): the selectivity estimator of operator <%=(integer,integer) calls it on column statistics while planning, with no EXECUTE check'),
    ('C10j', 'zz_f', 'integer, integer', 'PUBLIC',
     'the function of operator =%=(integer,integer): the selectivity estimator of operator =%=(integer,integer) calls it on column statistics while planning, with no EXECUTE check'),
    ('C7', 'zz_f', 'integer', 'anon',
     "the partition key of its parent zz_bp on zz_b1 runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner), through function zz_k(integer)"),
    ('C8', 'zz_trg', '', 'anon',
     'trigger zz_cd on zz_c fires it with no EXECUTE check (anon may DELETE zz_a; a foreign-key action writes the table as its owner)'),
    ('C8r', 'zz_trg', '', 'anon',
     'trigger zz_ci on zz_c fires it with no EXECUTE check (anon may DELETE zz_a; a foreign-key action writes the table as its owner)'),
)
#: ... and its plants that run owner-context code the catalog does not describe (exit 2, BLIND).
_BLIND_REPLAYS_R7_REPAIR2 = (
    ('C1p', 'function zz_rsd(double precision,double precision) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     "column r of zz_rt: ANALYZE runs the subtype_diff function of range type zzr2 as the table's owner (anon may MAINTAIN zz_rt)"),
    ('C2p', 'function zz_cast(zze) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls cannot be followed', 'anon',
     'the check of foreign key zz_b_k_fkey on zz_b runs as the owner of zz_a, never checked against the caller (anon may INSERT zz_b), through column id of zz_a'),
    ('C4', 'function domain_in(cstring,oid,integer) runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed', 'anon',
     "constraint zz_c on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C4r', 'function record_in(cstring,oid,integer) runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed', 'anon',
     "constraint zz_c on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C4a', 'function array_in(cstring,oid,integer) runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed', 'anon',
     "constraint zz_c on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
    ('C5', 'function satisfies_hash_partition(oid,integer,integer,"any") runs code it is handed only when it is called (SQL text, or a type or relation named by text or by a bare OID), so what that code calls cannot be followed', 'anon',
     "constraint zz_c on zz_b runs as the table's owner, never checked against the caller (anon may DELETE zz_a; a foreign-key action writes the table as its owner)"),
)

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
                 must_lines: tuple[str, ...] = (), blind: list | tuple = ()) -> None:
            rc, out = evaluate(present, judged, rows, allow if allowlist is None else allowlist, adr_dir, floor,
                               blind=blind)
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
        case("the low-floor message also tells a hardening PR what to do", 2, _SEVEN[:6] + [_HTTP],
             ("fewer than the floor of 7", "lower MIN_PUBLIC_SECDEF in this script to match"))
        case("an empty database -> 2", 2, [], ("fewer than the floor",))
        case("a leak still wins over a low floor (exit 1, never masked)", 1,
             [_row(name="open", acl_null=True, grantees=("PUBLIC", "postgres"))], ("public.open(uuid)",))

        # -- reach through another object (round 7): every path the PGlite replay judged -----
        for rid, name, args, who, how in _REACH_REPLAYS + _REACH_REPLAYS_R7_REPAIR + _REACH_REPLAYS_R7_REPAIR2:
            closed = _row(name=name, args=args, grantees=("postgres", "service_role"))
            case(f"reach {rid}: {how[:60]}... -> exit 1", 1, base + [_with(closed, through=[(who, how)])],
                 (f"public.{name}({args})  (owner postgres)", "1 reached through another object"),
                 must_lines=(f"      {who}: through another object: {how}",))
            case(f"reach {rid}, closed control (the same function, no path) -> exit 0", 0, base + [closed],
                 ("DEFINER-CHECK OK", "0 reached through another object"))
        # -- owner-context code the catalog does not describe (round-7 repair): BLIND, exit 2 -----------
        for rid, what, who, how in _BLIND_REPLAYS + _BLIND_REPLAYS_R7_REPAIR2:
            case(f"blind {rid}: {what[:60]}... -> exit 2", 2, base, ("CANNOT CHECK -- code PostgreSQL runs as an object's owner",),
                 must_lines=(f"  BLIND {what}", f"      {who}: {how}",
                             "   Exiting 2. A check that could not ask must never read as PASS."),
                 must_not=("DEFINER-CHECK OK",), blind=[(what, who, how)])
            case(f"blind {rid}, closed control (no such path) -> exit 0", 0, base, ("DEFINER-CHECK OK",
                 "0 owner-context object(s) it cannot read"))
        b0 = _BLIND_REPLAYS[0]
        case("blind: a leak still wins (exit 1), and the blind path is printed under it", 1,
             base + [_row(name="open", acl_null=True, grantees=("PUBLIC", "postgres"))],
             ("DEFINER-CHECK FAIL -- 1 open", "1 owner-context object(s) it cannot read"),
             must_lines=(f"  BLIND {b0[1]}", f"      {b0[2]}: {b0[3]}"), blind=[b0[1:]])
        case("blind: two paths to one object are printed under one BLIND line", 2, base,
             must_lines=(f"  BLIND {b0[1]}", f"      {b0[2]}: {b0[3]}", f"      authenticated: {b0[3]}"),
             blind=[b0[1:], (b0[1], "authenticated", b0[3])])
        case("blind and a stale allowlist entry are both named, exit 2", 2, _SEVEN,
             ("excuse nothing", f"  BLIND {b0[1]}"), blind=[b0[1:]])
        tr = ("anon", "trigger zz_bi on zz_t fires it with no EXECUTE check (anon may INSERT zz_t)")
        case("reach: CLIENT_CALLABLE never excuses a path through another object, even on its own function", 1,
             _SEVEN + [_with(_HTTP, through=[tr])],
             ("      anon: through another object: trigger zz_bi", "1/1 allowlisted"),
             must_not=("anon: an explicit grant",))
        case("reach: a path through another object is never the allowlist's use of its entry", 1,
             _SEVEN + [_with(_HTTP, grantees=["postgres"], reach=[], through=[tr])],
             ("anon: through another object", "excuse nothing"))
        case("reach: PUBLIC by any role's use of a value is named, and fails", 1,
             base + [_with(_closed("typ"), through=[("PUBLIC", "input function of type t: called wherever a "
                                                               "value of the type is read, written or described")])],
             must_lines=("      PUBLIC: through another object: input function of type t: called wherever a value "
                         "of the type is read, written or described",))
        case("reach: every path is named, one line each", 1,
             base + [_with(_closed("two"), through=[tr, ("authenticated", tr[1].replace("anon", "authenticated"))])],
             must_lines=(f"      anon: through another object: {tr[1]}",
                         f"      authenticated: through another object: {tr[1].replace('anon', 'authenticated')}"))
        case("reach: the fix names SECURITY INVOKER and taking the object out of reach", 1,
             base + [_with(_closed("fixme"), through=[tr])],
             must_lines=("Reached through another object: make the function SECURITY INVOKER, or take the",
                         "CLIENT_CALLABLE never excuses this."))
        case("reach: a direct leak alone does not print the reach-through fix", 1,
             base + [_row(name="direct", grantees=("anon", "postgres"), reach=("anon",))],
             ("anon: an explicit grant",), must_not=("Reached through another object",))
        case("reach: an extension member reached through another object stays out of scope", 0,
             base + [_row(name="st_x", ext=True, through=[tr])], ("1 extension member(s) excluded",))
        case("reach: a pg_catalog function reached through another object stays out of scope", 0,
             base + [_row(schema="pg_catalog", name="sys2", through=[tr])], ("1 in system schemas excluded",))

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
                return _PRESENT, _JUDGED, _SEVEN + [_HTTP], []
            rc, out = run(dsn, fetcher=fake, env=env or {})
            ran.append(f"  exit {rc} (want {want})  DSN: {label}")
            if rc != want or must not in out:
                failures.append(f"DSN {label}: exit {rc} (want {want}), wanted {must!r}\n{out}")

        host_case("the local stack URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", 0,
                  "DEFINER-CHECK OK")

        def blind_fake(_dsn):
            return _PRESENT, _JUDGED, _SEVEN + [_HTTP], [_BLIND_REPLAYS[0][1:]]
        rc, out = run("postgresql://u@127.0.0.1/db", fetcher=blind_fake, env={})
        ok = rc == 2 and f"  BLIND {_BLIND_REPLAYS[0][1]}" in out.splitlines()
        ran.append(f"  exit {rc} (want 2)  run(): a BLIND row fetch() returns reaches the verdict")
        if not ok:
            failures.append(f"run() dropped the blind rows: exit {rc}\n{out}")
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
                        want_sqls: tuple = (ROLES_SQL, CLIENT_SQL, QUERY, REACH_SQL), want_through=None,
                        want_blind=None) -> None:
            log: list = []
            saved = sys.modules.get("psycopg2")
            sys.modules["psycopg2"] = fake_driver(results, log)
            rows: list = []
            blind: list = []
            try:
                try:
                    _present, judged, rows, blind = fetch("postgresql://u@127.0.0.1/db")
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
            if len(want_sqls) == 4 and want_judged is not None:
                ok = ok and params[2] == {"judged": want_judged} and params[3] == {"judged": want_judged}
            if want_through is not None:
                ok = ok and [r["through"] for r in rows] == want_through
            if want_blind is not None:
                ok = ok and blind == want_blind
            ran.append(f"  {'held' if ok else 'BROKEN'}  fetch(): {label}")
            if not ok:
                failures.append(f"fetch() {label}: got {got}, rows {rows}, blind {blind}, statements "
                                f"{[(e[0], str(e[1])[:40] if len(e) > 1 else '') for e in log]}")

        three = [("anon", False), ("authenticated", False), ("authenticator", False)]
        driver_case("read-only; judged = what authenticator reaches + anon/authenticated, handed to QUERY and REACH_SQL",
                    [three, [("authenticator", False), ("zz_premium", False)], [good_row], []],
                    ["anon", "authenticated", "authenticator", "zz_premium"], 1, want_through=[[]], want_blind=[])
        driver_case("a catalog row of the wrong width -> cannot check",
                    [three, [("anon", False)], [good_row[:-1]]], None, 0, "not 15 columns wide",
                    want_sqls=(ROLES_SQL, CLIENT_SQL, QUERY))
        driver_case("authenticator missing -> stops before the judged-roles query",
                    [three[:2]], [], 0, want_sqls=(ROLES_SQL,))
        trig = ("public", "f", "uuid", "anon", "trigger t on x fires it with no EXECUTE check (anon may INSERT x)", False)
        driver_case("a reach-through row is hung on the function it names",
                    [three, [("authenticator", False)], [good_row, ("public", "g", "") + good_row[3:]], [trig]],
                    ["anon", "authenticated", "authenticator"], 2, want_through=[[trig[3:5]], []], want_blind=[])
        driver_case("a reach-through row naming a function the catalog query did not return -> cannot check",
                    [three, [("authenticator", False)], [good_row], [("public", "ghost", "") + trig[3:]]], None, 0,
                    "the reach query named public.ghost(), which the catalog query did not return")
        driver_case("a reach-through row of the wrong width -> cannot check",
                    [three, [("authenticator", False)], [good_row], [trig[:-1]]], None, 0, "not 6 columns wide")
        opaque = ("", "function g(integer) is LANGUAGE plpgsql: its body is not in the catalog, so what it calls "
                  "cannot be followed", "", "anon", "constraint c on b runs as the table's owner", True)
        driver_case("a BLIND row is returned as (what, who, how), never hung on a definer",
                    [three, [("authenticator", False)], [good_row], [opaque]],
                    ["anon", "authenticated", "authenticator"], 1, want_through=[[]], want_blind=[opaque[1:2] + opaque[3:5]])
        driver_case("a reach row whose blind column is neither true nor false -> cannot check",
                    [three, [("authenticator", False)], [good_row], [trig[:5] + (None,)]], None, 0,
                    "blind column held None")

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
        pinned: list[str] = []
        for q, must in ((QUERY, QUERY_MUST_SAY), (CLIENT_SQL, CLIENT_SQL_MUST_SAY), (REACH_SQL, REACH_SQL_MUST_SAY)):
            pinned.append(q)
            broken = query_pins_broken(q, must)
            for clause, times in must:
                held = not any(b.startswith(repr(clause)) for b in broken)
                ran.append(f"  {'held' if held else 'BROKEN'}  query says {clause!r} x{times}")
            commented = [b for b in broken if b.startswith("the query carries")]
            ran.append(f"  {'held' if not commented else 'BROKEN'}  query carries no SQL comment "
                       f"({q.strip().splitlines()[0][:30]!r}...)")
            if broken:
                failures.append(f"a query no longer says: {broken}")
        import hashlib
        for name, q in (("ROLES_SQL", ROLES_SQL), ("CLIENT_SQL", CLIENT_SQL), ("QUERY", QUERY), ("REACH_SQL", REACH_SQL)):
            got = hashlib.md5(q.encode()).hexdigest()
            held = got == QUERIES_MD5.get(name)
            ran.append(f"  {'held' if held else 'BROKEN'}  {name} is the text the ADR 0159 replay measured (md5 pinned)")
            if not held:
                failures.append(f"{name} changed: md5 {got}, QUERIES_MD5 pins {QUERIES_MD5.get(name)}. Re-run the ADR 0159 "
                                "replay on the changed query, then re-pin it here in the same diff")
        every = all(any(q is x for x in pinned) for q in (QUERY, CLIENT_SQL, REACH_SQL))
        ran.append(f"  {'held' if every else 'BROKEN'}  all three queries' pins were checked")
        if not every:
            failures.append("a query's pins were not checked")
        trigger_arm = ("  select a.fn, w.who,\n         format('%%s on %%s fires it with no EXECUTE check (%%s%%s)', "
                       "a.what, a.rel::regclass, w.via,")
        for label, gutted, must in (
                ("one ACL default read dropped",
                 QUERY.replace("coalesce(p.proacl, acldefault('f', p.proowner))", "p.proacl", 1), QUERY_MUST_SAY),
                ("the trigger arm commented out", REACH_SQL.replace(trigger_arm, "--" + trigger_arm, 1), REACH_SQL_MUST_SAY),
                ("the trigger arm's event test dropped",
                 REACH_SQL.replace(" and (a.tgtype & o.tgbit) <> 0", "", 1), REACH_SQL_MUST_SAY),
                ("the aggregate arm dropped",
                 REACH_SQL.replace("join judged j on has_function_privilege(j.oid, s.agg, 'EXECUTE')",
                                   "join judged j on false", 1), REACH_SQL_MUST_SAY),
                ("one aggregate support field dropped",
                 REACH_SQL.replace("('aggfinalfn', a.aggfinalfn::oid),", "", 1), REACH_SQL_MUST_SAY),
                ("row movement between partitions dropped",
                 REACH_SQL.replace("where i.inhparent = w.rel and w.op = 'UPDATE'", "where false", 1), REACH_SQL_MUST_SAY),
                ("a view over a view with INSTEAD OF triggers no longer counted as written",
                 REACH_SQL.replace("pg_relation_is_updatable(w.rel, true)", "pg_relation_is_updatable(w.rel, false)", 1),
                 REACH_SQL_MUST_SAY),
                ("the walk no longer follows operators",
                 REACH_SQL.replace("'pg_operator'::regclass, 'pg_type'::regclass,", "'pg_type'::regclass,", 1), REACH_SQL_MUST_SAY),
                ("the walk no longer follows a domain's CHECKs",
                 REACH_SQL.replace("where w.classid = 'pg_type'::regclass and k.contypid = w.objid", "where false", 1),
                 REACH_SQL_MUST_SAY),
                ("the opaque-body BLIND rule dropped",
                 REACH_SQL.replace("p.prosqlbody is null and l.lanname <> 'internal'", "false", 1), REACH_SQL_MUST_SAY),
                ("the runtime-code builtin scan dropped",
                 REACH_SQL.replace("position(format(':funcid %%s ', b.oid) in t.tree) > 0", "false", 1), REACH_SQL_MUST_SAY),
                ("the walk's reach rows dropped from the verdict",
                 REACH_SQL.replace("where not exists (select 1 from everything x where x.fn = d.fn and x.who::text = d.who)",
                                   "where false", 1), REACH_SQL_MUST_SAY),
                # [round-7 repair 2] each arm the second repair added
                ("the estimator arm dropped (an operator's function run on column statistics while planning)",
                 REACH_SQL.replace("where (o.oprrest <> 0 or o.oprjoin <> 0) and q.oprcode <> 0", "where false", 1),
                 REACH_SQL_MUST_SAY),
                ("the estimator arm narrowed to the operator itself (its negator and commutator dropped)",
                 REACH_SQL.replace("join pg_operator q on q.oid in (o.oid, o.oprnegate, o.oprcom)",
                                   "join pg_operator q on q.oid = o.oid", 1), REACH_SQL_MUST_SAY),
                ("the walk no longer follows an operator's negator",
                 REACH_SQL.replace("(values ('the negator', o.oprnegate::oid), ('the commutator', o.oprcom::oid)) s(field, op)",
                                   "(values ('the commutator', o.oprcom::oid)) s(field, op)", 1), REACH_SQL_MUST_SAY),
                ("the column-statistics seeds dropped",
                 REACH_SQL.replace("join statobj o on o.home = m.rel", "join statobj o on false", 1), REACH_SQL_MUST_SAY),
                ("a range's subtype_diff no longer seeded",
                 REACH_SQL.replace("join pg_range r on r.rngtypid = s.typ and r.rngsubdiff <> 0", "join pg_range r on false", 1),
                 REACH_SQL_MUST_SAY),
                ("the foreign-key check seed dropped",
                 REACH_SQL.replace("and ((k.conrelid = w.rel and w.op in ('INSERT', 'UPDATE'))", "and ((false", 1),
                 REACH_SQL_MUST_SAY),
                ("an ancestor's partition key no longer judged for its partitions",
                 REACH_SQL.replace("where c.relkind = 'p' or c.relispartition", "where c.relkind = 'p'", 1), REACH_SQL_MUST_SAY),
                ("the type-by-OID builtins dropped from the scan",
                 REACH_SQL.replace("'record_in', 'array_in', 'domain_in', 'range_in', 'multirange_in',", "", 1),
                 REACH_SQL_MUST_SAY),
                ("the walk run per (role, path) again -- no longer once per seed object",
                 REACH_SQL.replace("select distinct s.home, s.classid, s.objid from seeds s", "select s.home, s.classid, s.objid from seeds s", 1),
                 REACH_SQL_MUST_SAY)):
            caught = gutted != (QUERY if must is QUERY_MUST_SAY else REACH_SQL) and bool(query_pins_broken(gutted, must))
            ran.append(f"  {'held' if caught else 'BROKEN'}  the pin notices {label}")
            if not caught:
                failures.append(f"query_pins_broken() did not notice {label}")

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
