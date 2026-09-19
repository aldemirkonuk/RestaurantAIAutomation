# 0159 — A role's own REVOKE leaves PUBLIC's grant standing; revoke PUBLIC too

- **Status:** Proposed — built by the `fix/finish-leaks` fixer, 2026-09-17; awaiting founder lock. **[CORRECTED 2026-09-18, source: PR #391 audit: the decision as first written (option 2) was a no-op. It is now option 3, built as arm (c) of `scripts/check_new_tables_are_locked_down.py`. See Decision.]** **[2026-09-18, round 5, source: PR #391 verifier round 4: the class is now decided by an end-state check, `scripts/check_definer_functions_closed.py`, in `schema-parity.yml`; arm (c) is a fast pre-check. See Decision.]**
- **Date:** 2026-09-17
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** SECURITY DEFINER, REVOKE, GRANT, PUBLIC, alter default privileges, has_function_privilege, OD-72, grep-friendly: public-grant, default-acl
- **Links:** [[../decisions/OPEN-DECISIONS.md]] OD-72 row (corrected by this ADR); `supabase/migrations/20260825210000_od72_revoke_client_grants.sql` (the original ratchet, lines 183-190); `supabase/migrations/20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql` (closes the two named functions ~~and adds the class-level fix~~ **[2026-09-18: the "class-level fix" was a no-op and has been removed]**); `scripts/check_new_tables_are_locked_down.py` arm (c) (**[2026-09-18]** the class-level fix that replaced it; **[round 5]** now a fast pre-check); `scripts/check_definer_functions_closed.py` + `.github/workflows/schema-parity.yml` (**[2026-09-18, round 5]** the end-state check, the authority); `.planning/decisions/CLAIMS.jsonl` (new OD-72 row)

## Context

OD-72's 2026-08-26 migration (`20260825210000_od72_revoke_client_grants.sql`, section
3) looped over every anon-executable `SECURITY DEFINER` function and ran `revoke all
on function ... from anon, authenticated`. The OPEN-DECISIONS register recorded OD-72
as **"Closed in production 2026-08-26."** It was not, for two of those functions:
`increment_trust_counter(uuid)` and `seed_sim_restaurant(jsonb)` stayed executable to
`anon` and `authenticated` for 22 more days, until `20260917010400` (this branch)
actually closed them. **[2026-09-18, PR #391 audit: that migration has not been applied
to production yet (`schema_migrations` tops out at `20260917020000`), so nothing is
closed there yet. Production ACLs read the same day: `increment_trust_counter(uuid)` is
`{=X/postgres,postgres=X/postgres,service_role=X/postgres}`, still callable by `anon`
and `authenticated`. `seed_sim_restaurant(jsonb)` is already
`{postgres=X/postgres,service_role=X/postgres}`. No migration in the corpus closed it,
so that happened outside the migrations, on a date nothing records. The "22 more days"
is measured only for `increment_trust_counter`.]**

**The mechanism.** PostgreSQL grants `EXECUTE` on a newly created function to `PUBLIC`
by default — this is a hardcoded creation-time default, not something any migration
set — and every role, `anon` and `authenticated` included, implicitly carries
whatever `PUBLIC` holds on top of its own explicit grants. `revoke ... from anon,
authenticated` removes only what was explicitly granted to those two roles by name; it
does nothing to the access either role still has by inheriting from `PUBLIC`. Neither
function was ever the target of an explicit `REVOKE EXECUTE ... FROM PUBLIC`, so the
creation-time `PUBLIC` grant was never touched and
`has_function_privilege('anon', 'public.increment_trust_counter(uuid)', 'EXECUTE')`
stayed `true` through OD-72's own revoke.

**The ratchet meant to prevent exactly this already existed, and does not work either.**
`20260825210000_od72_revoke_client_grants.sql:186-187` runs:

```sql
alter default privileges in schema public
  revoke all on functions from anon, authenticated;
```

intending to stop a *future* `create function` from being client-executable, the same
way lines 183-184 do for tables. It does not, for a reason distinct from the first: a
default-privileges entry only changes what gets granted automatically to the roles it
names. Nothing before this statement ever set up a default grant *to `anon` or
`authenticated` specifically* — the only automatic grant on function creation is
PostgreSQL's built-in one, to `PUBLIC`. Revoking a per-role default that was never
being applied changes nothing about what a new function ships with; `PUBLIC`'s
built-in default survives untouched, so a `SECURITY DEFINER` function created *today*,
after OD-72's ratchet, still ships client-executable through `PUBLIC` on arrival. This
branch's two functions were not created after the ratchet — they predate OD-72 — but
the ratchet's own ineffectiveness against the class was never verified, only assumed.

**[CORRECTED 2026-09-18, source: PR #391 audit.** The conclusion above is right: the
ratchet does not stop a new function from being client-executable. The mechanism given
for it is wrong. Supabase's bootstrap *does* set a per-role default for `anon` and
`authenticated` on functions in `public`. Production's `pg_default_acl`, read
2026-09-18, still names both in `supabase_admin`'s row for `public`. `postgres`'s row
is `{postgres=X/postgres,service_role=X/postgres}`, and OD-72's statement is the only
one in the corpus that removes those two roles from it. So the ratchet did change the
default. It changed nothing that mattered, because a new function still gets
`EXECUTE` for `PUBLIC` from PostgreSQL's built-in global default, and both roles
inherit that grant. The same fact is why this ADR's first decision (below) also did
nothing.]**

**Why nobody caught it for 22 days.** OD-72's own section 5 verification re-checked
tables and views only; it never re-asserted the function revoke. A gap that ships as
reported success is CLAUDE.md's "absence reported as health" pattern, and this is a
security instance of it — measured directly with a PGlite probe reproducing the exact
mechanism (`p4-scratch/pglite-probe/leaks-security-definer-rpc.mjs`): stage 0
(freshly created functions) shows all three roles executable, as PostgreSQL's default;
stage 1 (OD-72's revoke statements applied alone, nothing else) shows all three
**still** executable — the bug, reproduced mechanically rather than taken on faith;
stage 2 (this branch's migration) shows `anon`/`authenticated` closed and
`service_role` preserved.

## Options considered

1. **Fix the two named functions only, case by case, as each is found.** Cheapest per
   instance. Leaves the class open: the next `SECURITY DEFINER` function anyone writes
   ships client-executable by default, exactly like these two did, and closing it
   depends on someone remembering to add an explicit `REVOKE ... FROM PUBLIC` on that
   one function — the same thing OD-72's author did not do.
2. **`alter default privileges in schema public revoke execute on functions from
   public;`** — one statement, changing what `CREATE FUNCTION` grants from this point
   forward for every function created by the role that issues it. Mirrors the
   table-side idiom OD-72's own migration already uses (`... revoke all on tables from
   anon, authenticated` — tables default to no `PUBLIC` grant at all, so the analogous
   statement for tables is closing a different, narrower gap; functions are the
   PostgreSQL object type that specifically defaults to granting `PUBLIC`, which is
   why this statement, and not the table-side one, is the one this class actually
   needed). Depends on future migrations running as the same database role — true
   today (Supabase migrations apply as one owning role) and cheap to re-verify if that
   ever changes.
   **[CORRECTED 2026-09-18, source: PR #391 audit: this statement is a no-op.** With
   `IN SCHEMA`, `ALTER DEFAULT PRIVILEGES` can only take back what an `IN SCHEMA`
   grant gave. It cannot remove the built-in global `EXECUTE`-to-`PUBLIC`. A PGlite
   probe (`p4-scratch/pglite-probe/audit-391-defacl.mjs`) created a function after it and got
   `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`, identical to a control
   run without it. A second probe (`p4-scratch/pglite-probe/audit-391-leaks-before-after.mjs <before.sql> <after.sql>`) applied this migration
   before and after the statement was removed and got identical ACLs. Production has
   no global function default, so there the statement would also have done nothing.]
2b. **[Added 2026-09-18, source: PR #391 audit, PGlite probe
   `p4-scratch/pglite-probe/audit-391-defacl.mjs`, its GLOBAL row (run as `postgres`, no
   `for role`); re-run in round 4 with the same result]** **The form that does work: the global default, `alter
   default privileges for role postgres revoke execute on functions from public`**
   (no `IN SCHEMA`). The same probe shows a function created after it with no
   `PUBLIC` entry: `anon` and `authenticated` false, `service_role` still true through
   the per-schema row. Not chosen; see Decision.
3. **A CI guard that fails when a migration creates a `SECURITY DEFINER` function with
   no matching `REVOKE ... FROM PUBLIC` in the same file.** Catches the authoring
   mistake at review time, which option 2 does not need anyone to remember to make.
   Costs a new script (`grep prosecdef scripts/` finds nothing today — no such guard
   exists) and ongoing upkeep as a second, hand-written detector; and it cannot catch
   a function created under a role whose default privileges were never locked down,
   which is exactly the gap option 2 closes structurally.
   **[CORRECTED 2026-09-18. Sources: PR #391 audit (option 2 is a no-op, PGlite probe
   `p4-scratch/pglite-probe/audit-391-defacl.mjs`); for the existing guard, its docstring
   and `ci.yml` at `2cb4f1fbc` (`check_new_tables_are_locked_down.py:86-87`, `ci.yml:809`).
   That last clause is backwards.** A text guard does not
   depend on which role runs the migration. Option 2 never closed any gap, and
   option 2b depends on the role. There was also no need for a new script.
   `scripts/check_new_tables_are_locked_down.py` is already the OD-72/OD-73 ratchet
   and already runs in CI (`.github/workflows/ci.yml`, step "Every public table a
   migration creates is locked down"). Its docstring listed functions as "Not
   modelled here", so this option extends it as arm (c).]
4. *(Leave OD-72's existing ratchet as the only defence)* — already measured false: the
   PGlite probe's stage 1 is exactly this state, and it fails.

## Decision

**[CORRECTED 2026-09-18, source: PR #391 audit. The proposed decision is now option 3.
The option 2 statement has been removed from `20260917010400`. It was a no-op (see
option 2's correction), and it had been recorded in five places as a fix: this ADR,
the migration's comment and success notice, the OD-72 CLAIMS row (which grepped for
the statement's text), the OD-72 register row's 2026-09-17 correction in
`OPEN-DECISIONS.md`, and this ADR's row in `decisions/README.md`. The PR #391 audit
named the first three; the last two were found by grepping `.planning/` for the
statement. All five are corrected.**

**[CORRECTED 2026-09-18, round 5, source: PR #391 verifier, round 4.] The class is decided
by an end-state check, not by arm (c).** Four review rounds each found SQL spellings that
re-open a `SECURITY DEFINER` function to `anon` or `authenticated` while arm (c) exits 0: a
`DO` body written as a single-quoted literal, `to group anon`, a `GRANT` to a role `anon` is
a member of, `create schema ... grant ...`, a revoke under `if false` or undone by an
exception block or a savepoint, dynamic `EXECUTE` shapes, rename-then-grant, overloads. A
text reader cannot close that list. The database can: `pg_proc.proacl` has one spelling for
the outcome.

- **What decides.** `scripts/check_definer_functions_closed.py` reads the catalog of the
  database `schema-parity.yml` builds from every migration, in the step right after
  `supabase db reset --no-seed`. It fails (exit 1) when any `SECURITY DEFINER` function
  outside the PostgreSQL system schemas and outside extensions (`pg_depend.deptype = 'e'`)
  answers to `PUBLIC`, `anon` or `authenticated`: by the built-in default (a `NULL`
  `proacl`), a grant, ownership, or membership of a role that holds `EXECUTE` or owns the
  function; `has_function_privilege()` is a catch-all behind those. Read-only; it refuses
  any host but localhost, `127.0.0.1`, `::1` or a unix socket, and never reads `.env` or a
  `SUPABASE_*` variable. **[2026-09-18, round 6, source: PR #391 verifier round 5, A8: a
  role granted to `authenticator` and holding `EXECUTE` on a definer passed with exit 0.
  The check now judges `PUBLIC` plus every role PostgREST can switch into: every role
  `authenticator` is a member of, directly or through other roles (`pg_has_role(
  'authenticator', r, 'MEMBER')`), which includes `authenticator`, `anon`, `authenticated`
  and any custom role. One stated exception, `service_role`: it is the server's role (the
  gateway calls RPCs with the service-role key, its JWT is signed with the project secret
  and never shipped), and a grant to it is the closed state every definer migration writes.
  A role reachable only through `service_role` is still judged. A superuser the API can
  switch into is named as one. The local-host rule now also refuses `PGSERVICE` and a
  `PGHOSTADDR` naming another host: libpq connects to `hostaddr` whatever `host` says, and
  the verifier's `PGSERVICE` probe reached `192.0.2.1` through a DSN with no host.]**
  **[2026-09-19, round 7, source: the founder's word on round 6's named residuals (quoted
  under "What arm (c) is now"). `EXECUTE` is no longer the only way in the check judges. A
  fourth read-only query (`REACH_SQL`) finds every `SECURITY DEFINER` function PostgreSQL
  would run for `PUBLIC` or a judged role with no `EXECUTE` check against that role, and the
  function fails with the path named; `CLIENT_CALLABLE` never excuses such a path. Judged:
  triggers on every write a judged role can make land on their table (per event; a column
  privilege counts; RLS does not narrow it) -- the table it names, its partitions and
  inheritance children, the base of an auto-updatable view, whatever a rule writes, and, as
  the referencing table's owner, the table a foreign key's `CASCADE`/`SET NULL`/`SET DEFAULT`
  action changes; everything else a cascaded table's objects call (`CHECK`, defaults and
  generated columns, index expressions and predicates, the partition key, rule actions,
  trigger `WHEN` clauses, its columns' domains); index and extended-statistics expressions
  under autoanalyze (any write) and `MAINTAIN` (down to partitions), and a materialized
  view's query, the views it reads and the policies of the tables it reads under `REFRESH`;
  all eight support functions of an aggregate a judged role may `EXECUTE` or another path
  reaches; a function taking or returning a type a judged role owns (`CREATE CAST` checks no
  `EXECUTE`); and, as `PUBLIC`, every function the catalog wires into operator families,
  operator estimators, planner support, a type's I/O, typmod, analyze and subscripting
  slots, range canonical/subtype_diff, casts, event triggers, text search parsers and
  templates, languages, foreign-data wrappers, access methods, conversions, transforms and
  `TABLESAMPLE`. Each path, how it was measured and its replay rows are in "Round 7: the
  path table" below.]** **[CORRECTED 2026-09-19, round-7 repair, source: the round-7 verifier
  (NOT READY: it ran no adversarial pass and re-measured nothing, and asked whether the reach
  query, which followed an object's `pg_depend` rows to `pg_proc` only, missed paths that run
  a function through another catalog object). It did. "Every path ... as far as this round
  could enumerate them" was the round-7 builder's word: 23 of 44 adversarial plants ran a
  closed definer for `anon` while the round-7 check exited 0 (table "Round 7 repair: the
  adversarial pass" below). Three changes close them. (1) *Writes:* an `UPDATE` of a
  partitioned table also lands as `DELETE` on the partition a row leaves and `INSERT` on the
  one it enters (row movement fires both triggers), and the base of a view over a view that
  is updatable only through `INSTEAD OF` triggers counts as written. (2) *The walk:* every
  object run as an owner for a judged role in the four owner contexts the check knows -- a
  foreign-key action's triggers and table objects, index and statistics expressions under
  autoanalyze and `MAINTAIN`, a refreshed materialized view's rules and policies -- seeds a
  walk over the catalog: what it
  depends on (functions, operators and their functions and estimators, types, operator
  classes and families, text search objects), the type of each column it names (a whole-row
  reference names them all), another relation it reads (its columns, its policies when RLS
  is on, a view's query; a foreign key's target is not read as a query), a domain's
  `CHECK`s, a type's casts and operator-family members, an aggregate's support functions,
  and a SQL-standard body's own dependencies. A `SECURITY DEFINER` function it reaches fails,
  named with the first object the walk went through. (3) *BLIND, exit 2:* where the walk
  reaches code the catalog does not describe -- an invoker body it does not parse (PL/pgSQL,
  string-bodied `LANGUAGE sql`, C) outside system schemas and extensions, a SQL-standard body
  naming a relation, a `pg_catalog` builtin that runs code handed to it at call time (the
  `query_to_xml`/`cursor_to_xml`/`table_to_xml`/`schema_to_xml`/`database_to_xml` families,
  `ts_stat`, `ts_rewrite`, `pg_input_is_valid`, `pg_input_error_info` and the BRIN/GIN
  maintenance builtins, found by `:funcid` in the stored expression tree because `pg_depend`
  records no builtin), or a function, type or read relation a judged role owns -- the check
  cannot say what runs, so it exits 2, never 0, naming the object and the path. A leak in the
  same run still exits 1. Each query is also pinned by the md5 of its exact text
  (`QUERIES_MD5`), because the repair's mutation table showed a clause pin cannot see a
  falsifier added beside the clause.]** **[CORRECTED 2026-09-19, round-7 repair 2, source: the
  round-7 verifier's re-run: nobody had yet attacked the repaired walk. A second adversarial
  pass (27 plants, 22 controls; table "Round 7 repair 2: the second adversarial pass" below)
  found six paths on which a closed definer ran for `anon` while the repaired check exited 0.
  "Every object run as an owner ... in the four owner contexts this check knows" was not every
  object, and not every context. (1) `ANALYZE` runs every column's statistics code as the
  owner, not only index and statistics expressions: the type's analyze function, a range's
  `subtype_diff` and subtype operator class, and the default btree and hash operator classes,
  down through domains, arrays, ranges, multiranges and composites (C1: a range column with no
  index, 300 calls). These now seed the walk under `MAINTAIN` and autoanalyze, and `MAINTAIN` on
  a foreign table counts. (2) A foreign key's *check*, not only its actions, runs as the other
  table's owner (`ri_triggers.c`): a client's `INSERT` or `UPDATE` of the referencing table as
  the referenced table's owner, its `UPDATE` or `DELETE` of the referenced table as the
  referencing table's owner. It runs the key's equality operators and any cast between the key
  types (C2, C2n); the constraint now seeds the walk. (3) The planner rewrites `NOT (a op b)`
  as `a negator b` (`eval_const_expressions`), so the walk follows an operator's negator, and
  its commutator (C3, C3m, C3i). (4) Builtins handed a type or a table by bare OID --
  `record_in`, `array_in`, `domain_in`, `range_in`, `multirange_in`, `satisfies_hash_partition`
  -- join the BLIND list (C4, C4r, C4a, C5). (5) A partition's own constraint evaluates its
  ancestors' partition keys, so each partition now carries them among its objects (C7: a
  foreign key declared on a partition ran its parent's key expression). (6) In plain client
  context, a selectivity estimator calls the operator's function -- or its negator's, or its
  commutator's -- on column statistics while planning, before and without the executor's
  `EXECUTE` check (C10: `anon`'s `EXPLAIN` ran the closed definer 6 times and executed
  nothing; C10n and C10c raised no error at all). The function of every operator that has an
  estimator, and of its negator and commutator, is now judged as `PUBLIC`. A client cannot
  build that link to someone else's operator: naming it as the negator or commutator of its
  own needs ownership of it (CT1, CT2). The walk also runs once per distinct seed object and
  joins the roles back only to what it reaches. With the new seeds, walking per role and path
  took 97.5 s on PGlite for the corpus plus the pinned storage-api schema (a first build of
  that proxy, 61 of its 62 migrations applied); per seed object it takes 3.0 s on the full
  proxy.]**
- **The allowlist.** `CLIENT_CALLABLE` names a function, the client roles it excuses (never
  `PUBLIC`), an ADR whose file exists, and a reason; an entry that excuses nothing is exit 2.
  It holds one platform function, not a product decision: `supabase_functions.http_request()`,
  which the pinned CLI (v2.116.0, `apps/cli-go/internal/db/start/templates/webhook.sql:227-230`)
  makes `SECURITY DEFINER` and grants to `anon` and `authenticated` on the local stack it
  starts for PostgreSQL 15+ (this repo runs 17; the parity job's log shows image `17.6.1.165`). It
  returns `trigger`, and PL/pgSQL refuses a direct call (`0A000 trigger functions can only
  be called as triggers`, measured on PGlite). Production has no such function
  `anon`-executable (read-only query, 2026-09-18). **[CORRECTED 2026-09-18, round 6, source:
  PR #391 verifier round 5, A1c: that reason was enforced nowhere. The entry matched on
  signature alone, so a migration that dropped the webhook and recreated it as a callable
  `returns jsonb` definer granted to `anon` passed the end-state check, its canary and arm
  (c), and `anon`'s call ran as `postgres`. An entry now also pins the function's identity:
  owner `supabase_functions_admin`, language `plpgsql`, returns `trigger`, not a set, kind
  `f`, `proconfig` `{search_path=supabase_functions}`, and `md5(prosrc)`
  `cb8a5741f829fe414ecd51c25be75c9a`. It excuses nothing unless every field matches, and
  the report names each field that differs. The md5 was measured on a build that runs the
  v2.116.0 template's `CREATE FUNCTION` verbatim (fetched from the tag,
  `apps/cli-go/internal/db/start/templates/webhook.sql:35-104`), and equals the md5 of the
  template text between its `$function$` quotes. It pins `prosrc` plus the settings rather
  than `pg_get_functiondef()`, because `prosrc` is stored verbatim and `pg_get_functiondef`
  is a deparse whose layout belongs to the server version (PGlite is 18.3, CI's stack 17).
  The canary now requires the exact line `  supabase_functions.http_request()  (owner
  supabase_functions_admin)`. Not measured on the local stack: if its body differs from the
  tag's, the first CI run fails and names `src_md5`; it cannot pass silently.]**
- **Never vacuous.** Exit 2 when it cannot connect, when `anon` or `authenticated` is
  missing, when fewer than 7 in-scope definers exist in `public` (`MIN_PUBLIC_SECDEF`; the
  corpus creates 7), and on a malformed or stale allowlist entry. In CI a canary runs first,
  with the allowlist emptied (`--without-allowlist`): it must exit 1 naming the webhook,
  which proves on the real database, with no write, that the check can fail there. Both CI
  steps assert the printed report (`DEFINER-CHECK OK -- <k> in public`, k >= 7; `SELF-TEST OK
  -- <n> cases run`, n >= ~~61~~ ~~105~~ ~~342~~ **491**), not only the exit code. **[2026-09-18, round 6: also
  exit 2 when `authenticator` is missing, since without it there is no telling which roles
  the API can switch into, and on an allowlist entry with no identity, a partial one, or a
  malformed one. The self-test grew from 61 to 105 cases.]** **[2026-09-19, round 7: also
  exit 2 when the reach query fails (it needs PostgreSQL 17's `MAINTAIN`), returns a row of
  the wrong width, or names a function the catalog query did not return. The self-test
  grew from 105 to 342 cases: every reach-through replay row as a leak and as its closed
  control, each arm of `REACH_SQL` pinned by its clauses and by what it selects, a case that
  every query's pins were checked, and no SQL comment allowed in any query (an arm commented
  out would keep its pins).]** **[2026-09-19, round-7 repair: also exit 2 on a BLIND
  owner-context path (above) and on a reach row whose blind column is neither true nor
  false. 342 re-measured on the round-7 script as delivered (held). The self-test grew from
  342 to 491 cases: the 25 adversarial leak rows and the 11 BLIND rows, each with its
  control; a leak printed with the blind paths under it; `run()` handing blind rows to the
  verdict; the new arms' clause pins; and the md5 of each query.]**
- **Proven.** A database built from all 185 migrations (PGlite 0.5.8, PostgreSQL 18.3,
  through a loopback wire-protocol bridge to `psycopg2`): exit 0 on this tree. The 70
  distinct migrations planted by the round 1-4 probe and bypass files were replayed on top,
  one at a time: exit 1 on all 58 that leak (measured by `has_function_privilege()` or
  membership, independently of the check), exit 0 on all 11 that do not, and 1 (`revoke ...
  granted by supabase_admin`) aborts its own migration, so the rebuild step fails. Two shapes
  the round 3-4 docs named without planting (an overload; an `E''`-quoted variable) and a
  `WITH INHERIT TRUE` twin of the membership row also exit 1. The pre-fix no-op
  migration leaves no leak at the end state (exit 0); a later definer relying on it exits 1;
  deleting the closing migration exits 1; dropping `public` from either named revoke aborts
  that migration on its own assertion. The self-test has 61 cases; 36 single mutations of the
  script each fail the self-test or the CI step on the built database. Evidence, re-runnable:
  `p4-scratch/pglite-probe/audit-391-r5-endstate/` (`pgbuild.mjs`, `endstate.mjs`,
  `replay-table.md`, `mut-endstate.txt`, `mut-claim.txt`, `ci-steps.txt`).
  **Not measured:** the Supabase local stack itself. Docker Desktop would not start on the
  machine, so the proof ran on PGlite with a bootstrap standing in for the platform (roles,
  schemas, an `auth` stub, the two platform definers above), stub `vector` and `postgis`
  extensions, three textual patches (two vector indexes omitted, `geography(Point, 4326)`
  read as `geography`), and migrations applied as a superuser. The first CI run of
  `schema-parity.yml` is the local-stack measurement; the canary and the stale-entry rule
  make a platform difference red, not silent. **[2026-09-18, round 6: replayed again on the
  PGlite build with Supabase's default privileges and the webhook created from the v2.116.0
  template verbatim. The 74 earlier rows and T0-T5 give exactly the verifier's round-5
  exits (61 leaks exit 1, 11 non-leaks exit 0, 1 migration aborts itself, 1 extension-member
  leak passes by design). The verifier's new rows: A1, A1b and A1c (the hijack) now exit 1
  here and exit 2 on arm (c); A8 exits 1; A5 still exits 1. A2, A3 and A9 still exit 0: they
  are named below as what it does not see. The literal CI step body, run against a served
  build through a stand-in `supabase status`, exits 0 on this tree and 1 on A1c (at the
  canary), on a body-only change that keeps the owner (at the real run, naming `src_md5`),
  on a re-own to `postgres`, on A8 and on a planted open definer.]**
  **[2026-09-19, round 7: replayed with both the round-6 script (`08116dad0`) and this
  round's, on the same PGlite build: 222 rows. The 80 earlier rows (74 planted spellings,
  T0-T5) and the A and N rows keep their verdicts, except A3 (trigger), A9 (aggregate
  `sfunc`) and N1 (aggregate `finalfunc`), which move 0 -> 1. The 59 new rows exit 1 and
  their 59 closed controls exit 0 (the round-6 script: 0 on all 118). The literal CI step
  body, served a build through a stand-in `supabase status`, exits 0 on this tree and 1 on
  A3, at the real run. Not measured: the Supabase local stack (Docker is hung on the proof
  machine). Read from the pinned images' sources instead of measured: storage-api v1.70.3
  drops every `SECURITY DEFINER` function it once created (migrations 0052, 0059); the
  supabase/postgres 17.6.1.165 schema has one outside extensions (`pgbouncer.get_auth`,
  attached to nothing); its event-trigger functions are not definers; realtime v2.129.3 and
  gotrue v2.196.0 migrations name none. So the first CI run is expected to print
  `0 reached through another object`; if it does not, it fails naming the path.]**
  **[2026-09-19, round-7 repair, source: the round-7 verifier: none of the numbers above had
  been re-run by anyone but their builder. Re-measured on a fresh PGlite build of all 185
  migrations, every row judged three ways -- the round-6 script, the round-7 script as
  delivered, and the repaired one (302 rows,
  `p4-scratch/pglite-probe/audit-391-r7-repair/replay8.json`). The round-7 claims hold for
  the round-7 script: 74 planted spellings 61 exit 1 / 13 exit 0, T0 0, T1 0, T2 1, T3 1, T4
  and T5 abort their own build; the A and N rows unchanged but A3, A9, N1 (0 -> 1); 59 leak
  rows 1 and 59 closed controls 0; self-test 342; the lockdown guard's 95. The repaired
  script gives every one of those rows the same exit but one: round 7's R2 closed control
  (a range type whose subtype_diff was made an invoker PL/pgSQL function, on a GiST-indexed
  column `anon` may insert into) moves 0 -> 2, BLIND. That is the new rule working, not a
  regression: autoanalyze and ANALYZE compute a range column's length histogram through
  subtype_diff as the table's owner, and B28 plants exactly that shape with a body calling a
  closed definer -- it ran for `anon` under `MAINTAIN` + `ANALYZE`; with the function
  SQL-standard instead (R2s) the check exits 0. The 44 adversarial plants and 36 controls
  give the wanted exit on the repaired script; round 7 as delivered missed 23 plants. The
  literal CI step body, served a build through a stand-in `supabase status`, exits 0 on this
  tree, 1 on B1 and 2 on B6, both at the real run after the canary passed. On this tree the
  walk is not vacuous: 20 seeds (both indexes of `sommelier_conversations`, under
  autoanalyze and `MAINTAIN` for `anon` and `authenticated`) and 146 catalog nodes walked,
  0 reached, 0 BLIND.]** **[2026-09-19, round-7 repair 2, source: the round-7 verifier's
  re-run, again: re-measured on a fresh PGlite build of all 185 migrations (PostgreSQL 18.3),
  every row judged four ways -- the round-6 script, round 7 as delivered, the first repair and
  this one (351 rows: `p4-scratch/pglite-probe/audit-391-r7-repair2/rp/replay9.json` and
  `replay9-ATK2.json`). The first three columns match the first repair's `replay8.json` on all
  302 rows they share, and this repair gives the first repair's exit on every one of those
  rows. Only the second pass's plants move: 13 from 0 to 1 and 6 from 0 to 2. Its 22 controls
  exit 0 under all four scripts. The first pass's 44 plants and 36 controls still give the
  wanted exit, and the 105 path probes give the same verdicts. The literal CI step body exits
  0 on this tree, 1 on C2 and 2 on C4, both at the real run after the canary passed. Every
  self-test replay row (117) matches, line for line, what the script printed on its PGlite
  plant. On this tree: 144 seeds (11 distinct objects), 301 catalog nodes walked, 0 reached,
  0 BLIND, 0.3 s. On this tree plus the pinned storage-api's 62 migrations (the proxy for CI's
  stack, below): 0 reached, 0 BLIND, 3.0 s.]**
- **What it does not see.** Time: it judges the end state, so a function open between two
  deploys passes (arm (c)'s same-file rule is the only thing that speaks to that window).
  Extension members, by construction: production's three PostGIS `st_estimatedextent`
  overloads are outside it, and so is an open definer a migration adds to an extension with
  `alter extension ... add function` (replayed: exit 0, the one planted leak it passes).
  Anything outside the build (dashboard, `psql`, production). Code that calls a function at
  runtime which then grants. Privileges other than `EXECUTE` and ownership.
  **[2026-09-18, round 6, source: PR #391 verifier round 5. Three more, measured on PGlite:]**
  - ~~*Reach through another object.* Only `EXECUTE` on the function itself is judged, and
    PostgreSQL runs some functions with no `EXECUTE` check against the caller. [...] (A3).
    [...] (A9). Both exit 0. [...] Filed OPEN in `v3.0-TECH-DEBT.md`.~~ **[CORRECTED
    2026-09-19, round 7: judged now (see "What decides" and the path table below); A3 and A9
    exit 1 and the tech-debt entry is closed. The controls A10, A11 and A12 still hold and
    still exit 0. What remains of the class, each named in the script's WHAT IT DOES NOT
    SEE:]**
    - ~~*What a reached function does.* Its body is not followed: the functions it calls and
      the tables it writes (whose triggers then fire) cannot be read from the catalog, so
      neither is anything reached only through a function the allowlist excuses. A
      foreign-key cascade is followed because the catalog states it.~~ **[CORRECTED
      2026-09-19, round-7 repair: in owner context this is no longer unseen. A SQL-standard
      body is followed through its `pg_depend` rows; any other body, a builtin that runs code
      handed to it at call time, and anything a judged role owns is BLIND (exit 2). What stays
      unseen, and why it needs no following: the body of a function that runs as the caller
      (a trigger or aggregate support function on the client's own write, a type's I/O),
      since whatever it calls is checked against that caller; and the allowlisted platform
      function's body, pinned by `md5(prosrc)` and read by hand from the v2.116.0 template.]**
    - *Paths PGlite cannot run* are judged from the catalog but were never exercised: an
      aggregate's `serialfn`/`deserialfn` (only parallel aggregation calls them; PGlite
      starts no workers), a foreign-data wrapper's handler (no FDW; a handler must be C),
      transforms (no PL here applies them), a `login` event trigger (no second connection),
      and autoanalyze (no autovacuum; `ANALYZE` under `MAINTAIN` stood in). Everything was
      measured on PostgreSQL 18.3, not CI's 17. **[2026-09-19, round-7 repair: CLUSTER and
      VACUUM FULL, "not measured" in the script until now, were measured (B20, B21: the index
      expression ran as the owner). Of the BLIND builtins only `ts_rewrite` and
      `pg_input_is_valid` were exercised (B13, B23); the xml families need libxml and the
      BRIN/GIN builtins those index types, so they are judged from the list alone.]**
      **[2026-09-19, round-7 repair 2: autoanalyze of column statistics (C1a) is judged from
      the catalog, with `ANALYZE` under `MAINTAIN` standing in (C1). Of the builtins this
      repair added to the BLIND list, `range_in` and `multirange_in` were not exercised.]**
    - ~~*A domain nested inside a composite column type* of a cascaded table;~~ **[CORRECTED
      2026-09-19, round-7 repair: the walk follows a composite's attributes to their domains
      (B15).]** *a type given to a judged role later* (judged by the build that has it).
    - **[2026-09-19, round-7 repair]** *The Supabase local stack's own schemas.* Never built
      here (Docker hung). Its storage schema grants `anon` and `authenticated` `ALL`, so
      `MAINTAIN` too, on `storage.objects`, `buckets`, `prefixes` and `buckets_analytics`
      (`0046`, `0026`, `0038` of the pinned storage-api), and a `DELETE` on
      `buckets_analytics` cascades into the iceberg tables (`0038`, `0048`): on CI those are
      seeds of the walk. Read from those sources, their indexes, defaults and constraints
      reach only builtin and extension code. If CI finds otherwise it exits 1 or 2 naming the
      path, never 0. **[2026-09-19, round-7 repair 2: partly measured now. The pinned
      storage-api's 62 migrations, read from its source, were applied in order on the corpus
      build in PGlite with its role installer off, as on the stack: exit 0, 0 reached, 0
      BLIND, 3.0 s, under both repairs. Realtime, auth, pg_net, pg_graphql and pgsodium were
      not built.]**
    - **[2026-09-19, round-7 repair 2]** *A type, text search configuration or dictionary
      named by a bare OID or by text* in owner context is not followed: `format_type(<oid>,
      ...)`, `ts_parse(<oid>, ...)`, `to_tsvector(<oid>::regconfig, ...)`, the configuration
      argument of `tsvector_update_trigger`. What those reach is C (a typmod output function,
      text search parsers and templates) that only a superuser can install, and it is judged
      as `PUBLIC` when it is a definer. Putting those builtins on the BLIND list would make
      every owner-context `to_tsvector()` BLIND.
    - **[2026-09-19, round-7 repair 2]** *Stricter than measured, on purpose.* The walk follows
      an operator's commutator, though the one swap measured refuses a commutator outside the
      operator family (C9 exits 1 while PostgreSQL errors). A foreign key's check walks every
      cast from and to its key types, every operator family over them and their domains'
      `CHECK`s. A column's statistics seed takes the type's default btree and hash classes
      whole.
    - **[2026-09-19, round-7 repair 2]** *PostgreSQL 17's rule on operator links.* On 18.3 a
      client cannot name someone else's operator as the negator or commutator of its own
      (CT1, CT2: must be owner), and the `CREATE OPERATOR` documentation states the same rule;
      17 was not measured. Were 17 to allow it, the estimator path would reach every
      operator's function, not only those of operators with an estimator.
  - *The empty build, not production's data.* A migration that does something different
    where rows exist is judged as the empty build runs it. A2 grants `EXECUTE` on
    `increment_trust_counter` to `anon` only `if exists (select 1 from auth.users)`: exit 0
    on the fresh build; the same migration on a copy holding one `auth.users` row exits 1.
  - *Roles the API cannot switch into.* A role `authenticator` is not a member of is not
    judged, and neither is `service_role` (the exception above).
- **What arm (c) is now.** A fast pre-check for common spellings: no database, the `ci.yml`
  step every pull request gets, file and line named. Its three rules stand as that; nothing
  below claims it is complete, and every sentence that did is corrected in place.
  **[2026-09-18, round 6, source: PR #391 verifier round 5, A1c: it also refuses (exit 2) any
  migration that names schema `supabase_functions`, in code or in any literal, decoded, at
  any depth. That is broader than a rule on function DDL there, on purpose: once the name
  sits in a literal or behind a `search_path`, text cannot tell a drop from a grant from a
  trigger. **[2026-09-19, round 7: kept broad by the founder's choice. Round 6 left it as his
  call whether to narrow it; his word, in chat on 2026-09-19, on round 6's two open calls:
  "do what the optimal scenario would do, no we can do this later or second plan". The
  strict option is the optimal one here, so the refusal stays as written.]** No migration names it today (grep: 0 files). A name assembled at run time, a
  `U&"..."` identifier or a `search_path` set from an expression is not seen; the end-state
  check's identity pin is. Its `OK` line and docstring now claim only what its self-test
  proves: they had said "no open SECURITY DEFINER function in the migration text it reads"
  and "the spellings it reads are closed", though it reads dollar-quoted `DO` bodies and
  still credits a revoke under `if false`, in an exception block, before a savepoint
  rollback, or on another overload.]**

**What is built.** Arm (c) of `scripts/check_new_tables_are_locked_down.py`. **[2026-09-18,
round 5: a pre-check now; the end-state check above decides.]** It
already runs as a CI step, so `ci.yml` only gains a `--self-test` step. It has three
rules, replayed over `supabase/migrations/` in version order:
(c1) a migration that creates, replaces, or alters a function to `SECURITY DEFINER`
must revoke `EXECUTE` from `PUBLIC`, `anon` and `authenticated` in that same file;
(c2) no `SECURITY DEFINER` function may still be `EXECUTE`-able by any of the three
when the corpus finishes, so a later `GRANT` re-opens it **[round 5: when its replay of the
text it reads finishes; that replay is a model, and the end-state check reads the database]**;
(c3) the per-schema default revoke from `PUBLIC` fails the build, so this no-op cannot
come back as a fix.
The baseline's two functions are the only grandfathered pairs, and only for (c1). The
list is shrink-only with a cap of 2, and (c2) still requires `20260917010400` to close
them. A function that is meant to be client-callable goes in a named allowlist,
`FN_CLIENT_CALLABLE`, which is empty. An entry names the roles (`anon` and/or
`authenticated`, never `PUBLIC`) and the ADR that decided it, and the guard exits 2 on
an entry that excuses nothing.

What arm (c) reads and refuses is stated as a definition, and every refusal and credit
below is a `--self-test` case. **[2026-09-18, round 4, source: PR #391 verifier round 3. Three
verifier rounds each found SQL spellings that slipped past sentences written one shape at
a time, so this paragraph and the residuals below replace that wording with classes.]**
It reads static SQL text: each migration's statements, the bodies of `DO` blocks, and
EXECUTEd literals. **[CORRECTED 2026-09-18, round 5, source: PR #391 verifier round 4:
only `DO` bodies written as dollar-quoted literals are read; `do 'begin ... end'`, `do
E'...'` and `do language plpgsql '...'` are not, and a `GRANT` in one passed.]** An EXECUTEd literal is a single-quoted, `E''` or dollar-quoted literal
whose only preceding tokens are `execute` or `execute format(`, with any whitespace or
comment between them. An `E''` literal is decoded first, as PostgreSQL decodes it. It exits
2 on:
- a `create function|procedure` in an EXECUTEd literal, or in any other single-quoted or
  `E''` literal ~~outside a dollar-quoted body~~ **[round 5: in the file, in a dollar-quoted
  `DO` body or in an EXECUTEd literal, never in a function body]** when the words are
  separated by whitespace alone;
- a create, `GRANT` or `REVOKE` whose function name it cannot read;
- in an EXECUTEd literal, a `GRANT` whose grantee is a `%` placeholder, or a `GRANT` to
  `PUBLIC`, `anon` or `authenticated` whose function name or privilege is one;
- `alter routine ... security definer` on a routine no migration creates;
- **[2026-09-18, round 6]** a migration that names schema `supabase_functions`.

It does not credit `REVOKE GRANT OPTION FOR` (that leaves `EXECUTE` standing) or a
`REVOKE` with a placeholder, and `ON ALL FUNCTIONS|PROCEDURES|ROUTINES IN SCHEMA` reaches
only the kinds PostgreSQL says it reaches. A `GRANT` that is static inside an EXECUTEd
literal is read like any static `GRANT` (exit 1 if it re-opens a function). The guard masks
argument lists before it reads a `GRANT`, because an argument type containing ` to `
(`interval day to second`) used to end the function list early: the `GRANT` read as
granting to `second)` and passed.

**Known residuals, as classes. Each passes silently, and the guard's docstring names
it.** **[CORRECTED 2026-09-18, round 5, source: PR #391 verifier round 4: not a complete
list. Two more groups pass arm (c) silently: control flow and transactions (a revoke under
`if false`, undone by an exception block, or undone by `rollback to savepoint` is credited),
and static forms it does not model (`to group anon`, two role tails together, `create
schema ... grant ...`, a `GRANT` to a role a client role is a member of, a single-quoted
`DO` body, an EXECUTEd literal continued on the next line, which PostgreSQL joins). The guard docstring now calls the list KNOWN MISSES and says it is not
exhaustive. Every example here was replayed against the end-state check, which exits 1 on
each.]** **[CORRECTED 2026-09-18, round 6, source: PR #391 verifier round 5: "every example
here" is true of the first three bullets below. The last, *Not in the migration text*, is
outside the end-state check too: it excludes extension members, and it never sees the
dashboard or `psql`.]**
- *Dynamic SQL.* Anything `EXECUTE` runs that is not an EXECUTEd literal as defined
  above. That covers SQL held in a variable, assembled with `||` or `concat()`, passed as
  a later `format()` argument, or wrapped in an expression (`execute (...)`), and a
  `create` hidden by a comment or an escape inside a literal that is not EXECUTEd. These
  members were measured: each is a real leak on PGlite, and each exits 0 on the guard (PR
  #391 verifier, rounds 2 and 3):
  - `execute ('grant ...')`
  - `execute ($f$create function ...$f$)`
  - `execute format('%s', 'grant ...')` and `execute format('%s', $f$create function ...$f$)`
  - `execute concat(...)` and `execute 'grant ... ' || 'to anon'`
  - a `GRANT` or a create held in a variable, however quoted
  - `s := 'create /**/ function ...'`

  These examples do not define the class.
- *Call-time SQL.* The guard never reads a function body, so it never sees a `GRANT` or a
  `create function` inside a helper that the migration creates and then calls.
- *Name, not signature.* Functions are keyed by name. A new `SECURITY DEFINER` overload
  revoked only under the other overload's signature passes. So does a closed function
  that is renamed or moved (`rename to`, `set schema`) and then granted under its new
  name.
- *Not in the migration text.* The guard does not see what `create extension` installs,
  or anything run from the dashboard or `psql`.

Round 4 re-planted the 42 bypass rows from round 3 and added 3 of its own, 45 rows
in all. Every dynamic-SQL and static-model row passes the guard, as the classes say,
with one exception: V7, an `ALTER ... SECURITY DEFINER` through a `format()` name placeholder,
is caught by accident (the placeholder reads as a function called `public`), and
nothing claims it. Every row the definition covers is caught, and the 8 controls pass
clean. Round 4's rule-by-rule mutation sweep also found two static spellings that the guard credited as closing
revokes, while PostgreSQL leaves `EXECUTE` standing (PGlite probe
`p4-scratch/pglite-probe/audit-391-r4-static-misreads.mjs`, 2026-09-18):
- `REVOKE GRANT OPTION FOR EXECUTE ...`
- `REVOKE ... ON ALL PROCEDURES IN SCHEMA` on a function

Both now exit 1, and each is a self-test case. The first has a twin in arm (b), for tables.
That twin is not fixed; see `v3.0-TECH-DEBT.md`.

On the tree the guard passes: 138 function creates, 7 `SECURITY DEFINER`, and
all 5 created after the baseline close in their own file. Production's
`postgres`-owned `SECURITY DEFINER` functions in `public` are the same 7 by name. On a
tree that should fail it exits 1: the pre-fix migration, `public` dropped from either
named revoke, the closing migration deleted, a planted open definer, a planted definer
revoked from `anon` and `authenticated` only, and a later re-grant. The guard as it
stood at `2cb4f1fbc` exits 0 on the planted definer and on the pre-fix migration.
`--self-test` proves ~~23~~ ~~32~~ ~~42~~ ~~89~~ **95** cases on a synthetic corpus, and each of ~~12~~
~~23~~ ~~40~~ **139** deliberate breaks to the guard's own rules makes it fail. **[2026-09-18, source: PR #391
verifier: at 23 cases, eight breaks passed the self-test (a `GRANT ... ON ALL FUNCTIONS
IN SCHEMA` never re-opening, a `GRANTED BY` tail, quoted roles, an unnameable create not
refused, both `MIN_FN_CREATES` and `MAX_FN_GRANDFATHERED` removed, `DROP` ignored,
replace-as-invoker still tracked). Nine cases now kill all eight.]** **[2026-09-18,
source: PR #391 verifier, round 2 (bypass sweep): a `GRANT` in a dollar-quoted or `E''`
literal handed to `execute`, `format()` with the role as the placeholder, and a
`create function` in a dollar-quoted `execute` passed the guard with exit 0. Ten cases
were added (32 to 42). The break count is now 40: the 22 behind the old "23" (that
number counted the control row), the verifier's own 8 distinct breaks (a ninth repeats
one of the 22), and 10 against this round's code. Each of the 10 is killed only by the
new cases: under each one, the 32 older cases alone still pass.]** **[2026-09-18, round 4,
source: PR #391 verifier, round 3: seven of its mutations (W1-W7) left the 42-case self-test
green, and two of them turned a caught real leak into a silent pass. Round 4 mutated the
lexer's `E''` rules and every rule, alternative and check in arm (c), one at a time. That
made 139 breaks: the earlier rounds' 40 re-expressed against this code, W1-W7 (W5 and W6
each split in two), and 90 more. 47 cases were added (42 to 89). Every break now fails a
named case, and none leaves the self-test green. **[CORRECTED 2026-09-18, round 5, source:
PR #391 verifier round 4: true of those 139 chosen breaks only. Four more (O1-O4: every
dollar-quoted body read as static SQL; a `DO` statement recursing into every dollar block;
the create question without `procedure`; without `or replace`) leave the self-test green
and turn a caught leak into a pass. No completeness claim rests on the sweep.]** Code that no mutation could reach was
removed rather than tested: a duplicate `MIN_FILES` check and file read (the table arm
does both first), an empty-statement skip, two redundant pops, and redundant clauses in
`_mask_parens` and in the allowlist check. The self-test's closing line now only counts
the cases; the case lines printed above it are the claim.]** The OD-72 CLAIMS
row asserts what the guard prints, not only its exit code: the arm-(c) `OK` line with at
least 7 `SECURITY DEFINER` creates on the real tree, and `SELF-TEST OK -- <n> cases run`
with n at least ~~32~~ ~~42~~ ~~89~~ **95**, where n counts cases executed. **[2026-09-18, round 6:
six platform-schema cases added (89 to 95); floor 95 in `ci.yml` and the CLAIMS row.]** The CI self-test step asserts the
same `SELF-TEST OK` line. **[2026-09-18, source: PR
#391 verifier: both CI steps and the CLAIMS row trusted exit codes alone, so the guard
gutted to exit 0 at its entry point, at the top of `main()` or at the top of
`run_self_test()` left all three green. Each of the three now fails the CLAIMS row and
the self-test step.]** The "Every public table..." CI step itself still reads only the
exit code; the CLAIMS row, run by `check_decision_claims.sh` in CI, is what catches a
gutted guard there. A PGlite probe applied the migration before and
after the statement was removed and got identical ACLs, so removing it changes nothing
in any database.

**Why not option 2b (the global default, which does work).** Nothing measured today
depends on the built-in `PUBLIC` `EXECUTE`:
- no `.rpc(` or `/rest/v1/rpc` in `apps/web`, `apps/mobile` or `packages`;
- the gateway calls RPCs with the service-role key (`database.service.ts:15`);
- no production RLS policy calls a `public` function, only `auth.uid`, `auth.jwt` and
  `now`;
- 90 of the 96 `postgres`-owned invoker functions in `public` are `PUBLIC`-executable today and would keep
  that, since a default change only affects new functions.

What would depend on it later: in production, 2 views call 3 `postgres`-owned `public`
functions (`pg_depend`, read 2026-09-18). The 4 column defaults that call a `public`
function call extension functions, which 2b would not touch. Under 2b, a new function
used in a view like those would need an explicit `GRANT` before a client role could
read the view.

So 2b is available. It was not chosen as the fix for four reasons:
(i) It changes the default for **every** function `postgres` creates in **every**
schema, including `SECURITY INVOKER` helpers where `PUBLIC` `EXECUTE` is harmless and
an RLS helper would need it. That is a posture change wider than this finding, and it
is the founder's call.
(ii) It cannot see `CREATE OR REPLACE` of a function that already exists, because the
ACL is kept. It also cannot see a function created by another role.
(iii) It is invisible in review. `check_schema_parity.sh` and `schema-parity.yml`
compare neither `pg_default_acl` nor `proacl` (grep finds neither), so drift would not
show.
(iv) The house rule is that solving a class once means a sweep, a blocking guard, and
an ADR.
2b could be added later as a second layer. Doing so would need its own decision.

*[Original 2026-09-17 text, kept for the record. Superseded by the correction above:]*

~~**Option 2**~~, applied in `20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql`:

```sql
alter default privileges in schema public
  revoke execute on functions from public;
```

This is the statement OD-72's function-side ratchet needed and did not write. It
closes the class at the database level — every `SECURITY DEFINER` function created in
`public` from this migration forward ships private by default, the same guarantee
`ALTER DEFAULT PRIVILEGES ... REVOKE ALL ... FROM anon, authenticated` gives tables —
with no CI script to write or maintain, and no dependence on a reviewer noticing a
missing `REVOKE` line in a future migration's diff. **[FALSE, 2026-09-18, source: PR #391
audit, PGlite probe `p4-scratch/pglite-probe/audit-391-defacl.mjs`: the statement
closed nothing. A function created after it still carried
`{=X/postgres,postgres=X/postgres,service_role=X/postgres}`, identical to a control, so
nothing ships private by default. The class is held at review time by guard arm (c)
instead; see the correction at the top of this section.]**

Option 3 (a CI guard) is not built here. It would catch a narrower, different failure
— an author who writes `security definer` and also writes an *incomplete* explicit
grant, on a database whose default privileges option 2 has *not* locked down (a second
migration role, a schema this fix does not cover) — and is left as a named, not-built
follow-up rather than assumed unnecessary; see Consequences. **[STALE, 2026-09-18,
source: PR #391 audit: option 3 is now the decision and is built, as arm (c) of
`scripts/check_new_tables_are_locked_down.py`. The failure it catches is not narrower:
option 2 locked nothing down, so every open `SECURITY DEFINER` function a migration
writes is in its scope.]**

The two named functions themselves are closed the same migration closes the class
**[2026-09-18, source: PR #391 audit, PGlite probe
`p4-scratch/pglite-probe/audit-391-defacl.mjs`: it does not close the class, see above;
what follows about the two functions holds]**:
explicit `REVOKE EXECUTE ... FROM public, anon, authenticated` plus an explicit `GRANT
... TO service_role`, each guarded on `to_regprocedure(...) is not null` so a database
whose chain never created them does not abort (measured: the unguarded form aborted
with `function public.increment_trust_counter(uuid) does not exist` on a fresh schema
— `p4-scratch/pglite-probe/REVIEW-leaks-migration-safety.mjs`, case B — and the guarded
form does not), and a runtime `DO` block that asserts `has_function_privilege` is
false for `anon`/`authenticated` and true for `service_role` before the migration will
report success, the same idiom OD-72's own migration used and the one piece of rigor
that, applied to *this* migration and not just the last one, is what makes this fix
trustworthy rather than merely plausible.

### Round 7: the path table (2026-09-19)

Every path by which PostgreSQL runs a function without checking the caller's `EXECUTE`, as
far as this round could enumerate them. **Caller checked?** is measured on the PGlite build
(PostgreSQL 18.3; a closed `SECURITY DEFINER` function behind the object, then `anon`
triggers it): *no* means it ran, counted by `pg_stat_get_xact_function_calls` or, for an
internal-language function (never counted), proven by a tripwire in its `SET` clause that
fires only once fmgr enters it; *yes* means `permission denied for function`. **Replay** is
the round-7 script's exit on the planted path and on its closed control (the same objects
with the reach removed: the write, `MAINTAIN` or aggregate `EXECUTE` revoked, the type given
back, or the function made `SECURITY INVOKER`). Probe ids are those of `paths.mjs`; replay ids
those of `replay7.mjs` (evidence below). **[CORRECTED 2026-09-19, round-7 repair: "as far as
this round could enumerate them" was not far enough -- the table lists the object that
invokes a function, and misses a function reached through another catalog object from an
owner-context one. Those paths, and the adversarial rebuild of this table, are in "Round 7
repair: the adversarial pass" below.]**

| Path | Caller checked? | Judged now | Replay leak / closed |
|---|---|---|---|
| Trigger on a table the role may INSERT (A3) / column-INSERT only / column-UPDATE only / DELETE / TRUNCATE | no (T1-T5; ran as `postgres`) | yes | 1 / 0 each (T1-T5) |
| Trigger reached through an INSTEAD OF view / an auto-updatable view's base / a DO ALSO rule's target / a partition / an inheritance child (the role holds nothing on the target) | no (T6-T10) | yes | 1 / 0 each |
| Trigger on B under a foreign key's ON DELETE CASCADE / SET NULL / ON UPDATE CASCADE from A the role may write | no (T11-T13) | yes, as B's owner | 1 / 0 each |
| Everything else B's objects call under a cascade: CHECK, SET DEFAULT's default, index expression, stored generated column, trigger WHEN, rule action, partition key, domain CHECK **[round-7 repair 2: and an ancestor's partition key, which a partition's constraint evaluates (C7); a foreign key's check, as the other table's owner (C2, C2n)]** | no (C1-C4, C6-C9) | yes | 1 / 0 each |
| RLS policy on B under a cascade (FORCE) | not evaluated (C5) | no | - |
| Aggregate `aggtransfn` (A9) / `aggfinalfn` (N1) / `aggmtransfn`+`aggminvtransfn`+`aggmfinalfn` / `aggcombinefn` | no (G1-G4; checked against the aggregate's owner) | yes | 1 / 0 each |
| Aggregate `aggserialfn` / `aggdeserialfn` | not exercisable: only parallel aggregation calls them | yes | 1 / 0 (GS) |
| Operator-family support function (btree compare: ORDER BY, merge join; hash alone: hashed GROUP BY) | no (O1, O11, O10) | yes, PUBLIC | 1 / 0 (O1) |
| Operator-family member operator through the type cache (array `=`) | no (O4) | yes, PUBLIC | same row |
| The same member operator in sorted / hashed GROUP BY, or written in WHERE | yes (O2, O3, O5) **[CORRECTED 2026-09-19, round-7 repair 2: written in WHERE the executor checks it, but when the operator -- or one whose negator or commutator it is -- has a selectivity estimator, the planner has already run its function on column statistics (C10, C10n, C10c, C10j)]** | (judged via O4) **[and now as `PUBLIC` through the estimator arm]** | - |
| Operator restriction / join estimator | no (O6, O7) | yes, PUBLIC **[round-7 repair 2: and the function of the operator, its negator and its commutator, which the estimator calls (C10-C10j)]** | 1 / 0 each |
| Planner support function (`prosupport`) | no (S1) | yes, PUBLIC | 1 / 0 |
| Type input / output / receive / send / typmod input / typmod output / analyze (under MAINTAIN) / subscripting | no (Y1-Y8) | yes, PUBLIC | 1 / 0 (Y1: six functions; Y7; Y8) |
| Range canonical / subtype_diff (GiST insert) | no (R1, R2) | yes, PUBLIC | 1 / 0 each |
| Cast to json via `to_json()`, `json_agg()` (PostgREST's shape), `to_jsonb()` | no (X2-X4) | yes, PUBLIC: every cast function | 1 / 0 (X2) |
| Cast written in SQL | yes (X1) | (judged via X2) | - |
| `CREATE CAST` by a type's owner naming a function it cannot EXECUTE | allowed (X5); the cast then runs it for `anon` (X6) | yes: a type a judged role owns | 1 / 0 (XO) |
| Index expression under REINDEX / ANALYZE by a MAINTAIN holder; statistics expression under ANALYZE; REINDEX of a partitioned parent reaching a partition's index **[round-7 repair 2: and every column's statistics code under ANALYZE (C1)]** | no (M1-M3, M9) | yes | 1 / 0 (M1, M3, M9) |
| ANALYZE of a partitioned parent reaching a partition | not called (M8: each partition's privilege is checked) | (judged via M9) | - |
| Materialized view REFRESH by a MAINTAIN holder: its query, a view it reads, a policy of a table it reads | no (M4, M7, M6) | yes | 1 / 0 each |
| Autoanalyze of a table the role may write: index / statistics expression | not exercisable: no autovacuum (ANALYZE without MAINTAIN is skipped, M5) | yes | 1 / 0 (K6-aa, M5-aa) |
| Language inline handler (DO) / validator (CREATE FUNCTION in `pg_temp`) | no (L1, ran as `postgres`; L3) | yes, PUBLIC | 1 / 0 each |
| Language call handler | no check, and its SECURITY DEFINER and SET are ignored (L2, L4: ran as `anon`) | yes, PUBLIC (strict) | 1 / 0 (L2) |
| Foreign-data wrapper validator (CREATE SERVER) / handler | no (F1) / not exercisable: no FDW here | yes, PUBLIC | 1 / 0 (F1, F2) |
| Index / table access-method handler | no (A1, A2) | yes, PUBLIC | 1 / 0 each |
| Encoding conversion (`convert()`) | no (V1) | yes, PUBLIC | 1 / 0 |
| Text search parser start / gettoken / end / lextypes / headline; template init / lexize | no (W1-W7) | yes, PUBLIC | 1 / 0 (W1: five; W6: two) |
| TABLESAMPLE handler | no (Z1) | yes, PUBLIC | 1 / 0 |
| Event trigger: DDL by `postgres`, by `anon` (a temp table), by `anon` then refused | no (E1-E3; ran as `postgres`) | yes, PUBLIC | 1 / 0 (E1) |
| Login event trigger / transform functions | not exercisable: no second connection / no PL applies them | yes, PUBLIC | 1 / 0 (EL, TR) |
| Controls: column DEFAULT (A10), CHECK, stored generated column, domain CHECK, index expression, partial-index predicate, partition key, RLS USING (A12) and WITH CHECK, view (A11), rule action, CHECK through a view or a rule, a function argument's default, operator in WHERE (N2), trigger WHEN on the caller's own write | yes (K1-K3, K5-K16, T14) **[2026-09-19, round-7 repair: K5 measured the domain CHECK by a cast, not a write; B19 measures the write: yes. RLS through a view owned by a role the policy applies to: yes (V11, V12)]** **[round-7 repair 2: the negator the planner swaps into a CHECK on the caller's own write: yes (C3k)]** | no | - |
| A client wiring a closed definer into its own trigger, aggregate, operator, range, conversion | yes (T15, G5, O9, R3, V2) | no | - |
| ... its own estimator, base type, operator class | refused: superuser only (O8, Y9) **[CORRECTED 2026-09-19, round-7 repair: the operator class had no probe; B18 measures it: refused, superuser only]** | no | - |
| Virtual generated column; publication row filter | not a path: user functions refused (K4, U1) | no | - |

On this tree the reach query returns nothing: the three definer triggers
(`procurement_order_items`, `procurement_orders`, `ux_experiment_state`) take no write a
judged role can make land on them, directly or through a view, rule, partition or cascade;
no aggregate, type, cast, operator, language, access method, conversion, text search object
or event trigger uses a `SECURITY DEFINER` function; no judged role owns a type (0 rows).
`anon` and `authenticated` may write (and `MAINTAIN`) `sommelier_conversations` alone,
besides `UPDATE` on `pg_settings`, and no foreign key references that table (0 rows). Evidence, re-runnable: `p4-scratch/pglite-probe/audit-391-r7-reach/`
(`paths.mjs`/`probes.mjs`/`harness.mjs` and `paths.json` for the probes; `replay7.mjs` and
`replay7.json` for the 222-row replay; `ci-step-T0.txt`, `ci-step-A3.txt`; the mutation
tables `mut7-script.txt`, `mut7-claim.txt`).

### Round 7 repair: the adversarial pass (2026-09-19)

The round-7 verifier returned NOT READY without running its adversarial pass. This is that
pass, run by the repair. Each attack plants a closed `SECURITY DEFINER` function behind one
object on a fresh copy of the corpus build, then has `anon` trigger it. **Caller checked?**
uses the probe evidence of the path table: *no* means the function ran with no check on
`anon`, shown by its call count or its tripwire. The two exit columns are the check's
verdict on the plant and on its control, which takes the reach away (the write, `MAINTAIN`,
the aggregate's `EXECUTE`, or `SECURITY INVOKER` for a `PUBLIC` slot). V1-V12 rebuild the
verifier's list, each as a variation on round 7's probe of that path, not a copy of it.
B1-B28 are the paths the verifier's open question pointed at, plus the controls needed to
test every sentence of the script's "measured to check the caller" list. **Wanted:** exit 1
on a leak, exit 2 (BLIND) where the owner-context code cannot be read, exit 0 where the path
checks the caller or is no path.

| Id | Attack | Caller checked? | Round 7 as delivered: plant / control | Repaired: plant / control |
|---|---|---|---|---|
| V1 | INSTEAD OF UPDATE trigger on a view; anon holds only a column UPDATE on the view | no: ran | 1 / 0 | 1 / 0 |
| V2 | AFTER UPDATE OF v trigger; anon holds only UPDATE (v) | no: ran | 1 / 0 | 1 / 0 |
| V3 | AFTER TRUNCATE trigger on a partition; anon holds TRUNCATE on the partitioned parent only | no: ran | 1 / 0 | 1 / 0 |
| V4 | moving aggregate: ONLY the inverse transition function (aggminvtransfn) closed | no: ran | 1 / 0 | 1 / 0 |
| V5 | restriction estimator (oprrest) planned inside a view anon may SELECT (the view's query names the operator, anon's does not) | no: tripwire | 1 / 0 | 1 / 0 |
| V6 | cast to json called by json_build_object() on a value of the type | no: ran | 1 / 0 | 1 / 0 |
| V7 | type input function reached by json_populate_record() on a composite whose attribute has that type | no: tripwire | 1 / 0 | 1 / 0 |
| V8 | index expression on B, maintained by ON UPDATE CASCADE from A anon may UPDATE | no: ran | 1 / 0 | 1 / 0 |
| V9 | CHECK on B, re-evaluated by ON UPDATE CASCADE from A anon may UPDATE | no: ran | 1 / 0 | 1 / 0 |
| V10 | ON DELETE DO INSTEAD rule on a view anon may DELETE, whose action UPDATEs a table with a closed trigger | no: ran | 1 / 0 | 1 / 0 |
| V11 | RLS WITH CHECK of a table written through a view owned by a role the policy applies to; anon INSERTs through the view | yes | 0 / - | 0 / - |
| V12 | RLS USING of a table read through a view owned by a role the policy applies to; anon SELECTs the view | yes | 0 / - | 0 / - |
| B1 | operator (not the function) in a CHECK on B, ON DELETE SET NULL from A anon may DELETE | no: ran | 0 / 0 | 1 / 0 |
| B2 | a cast to a domain inside a CHECK on B (the column is not the domain), ON DELETE SET NULL | no: ran | 0 / 0 | 1 / 0 |
| B3 | operator in an index expression, anon holding MAINTAIN runs REINDEX | no: ran | 0 / 0 | 1 / 0 |
| B4 | operator in a materialized view's query, anon holding MAINTAIN runs REFRESH | no: ran | 0 / 0 | 1 / 0 |
| B5 | SQL-standard (BEGIN ATOMIC) invoker function in a CHECK on B calls the closed definer; ON DELETE SET NULL | no: ran | 0 / 0 | 1 / 0 |
| B6 | PL/pgSQL invoker function in a CHECK on B calls the closed definer (a body the catalog cannot read); ON DELETE SET NULL | no: ran | 0 / 0 | 2 / 0 |
| B6s | string-bodied LANGUAGE sql invoker function in a CHECK on B calls the closed definer; ON DELETE SET NULL | no: ran | 0 / 0 | 2 / 0 |
| B7 | REFRESH: a policy on the table a materialized view reads has a subquery on a second table whose own policy calls the closed definer | no: ran | 0 / 0 | 1 / 0 |
| B8 | REFRESH: a materialized view's query calls an aggregate whose state function is the closed definer (regression row) | no: ran | 1 / 0 | 1 / 0 |
| B9 | row movement: anon UPDATEs a partitioned parent (UPDATE only) and the row moves -> BEFORE INSERT trigger on the destination partition | no: ran | 0 / 0 | 1 / 0 |
| B9d | row movement: the same UPDATE -> BEFORE DELETE trigger on the source partition | no: ran | 0 / 0 | 1 / 0 |
| B10 | TRUNCATE ... CASCADE: anon holds TRUNCATE on A only; B references A and carries a closed TRUNCATE trigger | permission denied for table zz_b | 0 / - | 0 / - |
| B11 | anon creates a composite type in pg_temp and a CREATE CAST to json naming a closed definer that takes record, then calls to_json() | not called | 0 / - | 0 / - |
| B11e | anon creates an enum in pg_temp and a CREATE CAST to json naming a closed definer that takes anyenum, then calls to_json() | could not determine actual argument type for polymorphic function "zz_ej" | 0 / - | 0 / - |
| B12 | to_json() in a CHECK on B: the column's type has a PL/pgSQL (invoker) cast to json that calls the closed definer; ON DELETE SET NULL | no: ran | 0 / 0 | 2 / 0 |
| B13 | a builtin that runs SQL text (ts_rewrite(tsquery, text)) in a CHECK on B; the text calls the closed definer; ON DELETE SET NULL | no: ran | 0 / 0 | 2 / 0 |
| B14 | view chain: anon INSERTs a view over a view that is not auto-updatable but has a closed INSTEAD OF trigger | no: ran | 0 / 0 | 1 / 0 |
| B15 | a domain nested in a composite: B's FK column defaults to row(1)::zzcomp (field of domain zz_dom); ON DELETE SET DEFAULT | no: ran | 0 / 0 | 1 / 0 |
| B16 | a function a judged role OWNS sits in a CHECK on B; anon replaces its body to call the closed definer, then deletes from A | no: ran | 0 / 0 | 2 / 0 |
| B17 | deep: operator -> SQL-standard function -> cast to a domain -> the closed definer, in an index expression under MAINTAIN | no: ran | 0 / 0 | 1 / 0 |
| B18 | the round-7 docstring's unmeasured claim: anon builds its OWN operator class naming a closed support function | must be superuser to create an operator class | 0 / - | 0 / - |
| B19 | the round-7 docstring's claim 'a domain CHECK on the caller's own write': anon INSERTs into a column of the domain | yes | 0 / - | 0 / - |
| B20 | CLUSTER by anon holding MAINTAIN: an index expression (round 7: "not measured") | no: ran | 1 / 0 | 1 / 0 |
| B21 | VACUUM FULL by anon holding MAINTAIN: an index expression (round 7: "not measured") | no: ran | 1 / 0 | 1 / 0 |
| B22 | an invoker PL/pgSQL trigger on B fired by ON DELETE CASCADE from A; its body calls the closed definer | no: ran | 0 / 0 | 2 / 0 |
| B23 | pg_input_is_valid(text, 'public.zz_dom') in a CHECK on B: the domain is named by text, so no catalog row links them; ON DELETE SET NULL | no: ran | 0 / 0 | 2 / 0 |
| B24 | a domain a judged role OWNS types B's FK column; anon adds a NOT VALID CHECK calling the closed definer, then deletes from A (SET NULL) | no: ran | 0 / 0 | 2 / 0 |
| B25 | REFRESH: a materialized view reads a table a judged role OWNS; anon adds a policy calling the closed definer, then refreshes | no: ran | 0 / 0 | 2 / 0 |
| B26 | REFRESH: a materialized view's query casts to a domain whose CHECK calls the closed definer | no: ran | 0 / 0 | 1 / 0 |
| B27 | a whole-row reference in a CHECK on B (row_to_json(zz_b.*)): an enum column's PL/pgSQL cast to json calls the closed definer; ON DELETE SET NULL | no: ran | 0 / 0 | 2 / 0 |
| B28 | why round 7's R2 closed control now exits 2: a range type's INVOKER PL/pgSQL subtype_diff (the control's shape) calls the closed definer; anon holding MAINTAIN runs ANALYZE of a GiST-indexed column | no: ran | 0 / 0 | 2 / 0 |
| R2s | round 7's R2 closed control with its subtype_diff made SQL-standard (BEGIN ATOMIC): a body the catalog records, so nothing BLIND | not called | 0 / - | 0 / - |

Summary. The round-7 check as delivered caught every V row, and it missed 23 of the 26
plants that should exit 1 or 2 among B1-B28. Every miss was a closed definer that ran for
`anon`. The repaired check gives the wanted exit on all 44 plants, and all 36 controls exit
0 under both scripts. Three findings are not paths, and each is recorded as measured:

- `to_json()` of a composite never consults a cast (B11).
- A polymorphic definer named in `CREATE CAST` cannot resolve its argument type, so it fails (B11e).
- `TRUNCATE ... CASCADE` into a table the caller may not truncate is refused (B10).

Evidence: `p4-scratch/pglite-probe/audit-391-r7-repair/`. It is re-runnable after
`node survey.mjs` has rebuilt `base.blob`.

- `attacks.mjs`, `attacks-final.json`, `attack-table.md`: the attacks and their results.
- `replay8.mjs`, `replay8.json`, `replay8-ATK.json`: the 302-row replay, judged three ways.
- `extract.json`: the lines the self-test replays.
- `ci-step-T0.txt`, `ci-step-B1.txt`, `ci-step-B6.txt`: the literal CI step body.
- `mut8-script-full.txt`, `mut8-script-clauses.txt`: the self-test mutation table, run with and without the md5 pins.
- `mut8-claim.txt`: the OD-72 CLAIMS row's mutation table.
- `paths.json`: the 105 round-7 probes, re-run.
- `mut7-*-delivered-rerun.txt`: round 7's own mutation tables, re-run on the script as delivered.

### Round 7 repair 2: the second adversarial pass (2026-09-19)

The round-7 verifier's re-run found that nobody had yet attacked the repaired walk. This pass
did, from the owner contexts' source rather than from the first pass's list: which of
PostgreSQL's code switches to an object's owner (`ri_triggers.c`, `analyze.c`, `vacuum.c`,
`cluster.c`, `indexcmds.c`, `matview.c`), and what the planner and executor call on a catalog
OID without an `EXECUTE` check (`selfuncs.c`, `eval_const_expressions`, the type-input
builtins). Method as in the first pass; **Caller checked?** counts calls made before any
error, so a function the planner ran and the executor then refused reads "ran". The three
exit columns are the round-7 script as delivered, the first repair (`r8tree/`) and this repair.

| Id | Attack | Caller checked? | Round 7 as delivered: plant / control | First repair: plant / control | Repair 2: plant / control |
|---|---|---|---|---|---|
| C1 | ANALYZE by anon holding MAINTAIN of a range column with NO index: range_typanalyze calls the type's SQL-standard subtype_diff, which calls the closed definer | no: ran 300x | 0 / 0 | 0 / 0 | 1 / 0 |
| C1p | C1 with a PL/pgSQL subtype_diff (a body the catalog cannot read) | no: ran 300x | 0 / 0 | 0 / 0 | 2 / 0 |
| C1a | C1 under autoanalyze: anon holds only INSERT on the table (PGlite runs no autovacuum; the path is ANALYZE as the owner, measured by C1) | not run: no autovacuum (C1 is the same path under ANALYZE) | 0 / 0 | 0 / 0 | 1 / 0 |
| C2 | a foreign key's check on anon's INSERT into B runs as A's owner: the FK column's type reaches A's key through an implicit SQL-standard cast that calls the closed definer | no: ran 1x | 0 / 0 | 0 / 0 | 1 / 0 |
| C2p | C2 with a PL/pgSQL cast function | no: ran 1x | 0 / 0 | 0 / 0 | 2 / 0 |
| C2n | NO ACTION: anon's DELETE from A runs the foreign key's check on B as B's owner, casting each B row through the same cast | no: ran 1x | 0 / 0 | 1 / 0 | 1 / 0 |
| C3 | NOT (v =%= 1) in a CHECK on B: the operator's negator's function is the closed definer; ON DELETE SET NULL from A | no: ran 1x | 0 / 0 | 0 / 0 | 1 / 0 |
| C3m | NOT (x =%= 1) in a materialized view's query; anon holding MAINTAIN runs REFRESH | no: ran 3x | 0 / 0 | 0 / 0 | 1 / 0 |
| C3i | NOT (v =%= 1) as an index predicate; anon holding MAINTAIN runs REINDEX | no: ran 5x | 0 / 0 | 0 / 0 | 1 / 0 |
| C3k | control: NOT (v =%= 1) in a CHECK on anon's own INSERT -- the negator's function is checked against the caller | yes | 0 / - | 0 / - | 0 / - |
| C9 | a hash join on t2.x =%= t1.y in a materialized view's query: the planner commutes the clause to =%='s COMMUTATOR, whose function is the closed definer; anon holding MAINTAIN runs REFRESH | no call: the planner swapped the commutator in, then the executor refused it (`could not find hash function for hash operator`) | 0 / 0 | 0 / 0 | 1 / 0 |
| C9k | control: the same join run by anon itself -- the commutator's function is checked against the caller | refused the same way: no call | 0 / - | 0 / - | 0 / - |
| C10 | EXPLAIN by anon of `v =%= 5`: =%='s function is the closed definer, its restriction estimator the builtin eqsel, which calls it on the column's most common values | no: ran 6x, then permission denied for function zz_f | 0 / 0 | 0 / 0 | 1 / 0 |
| C10s | C10 as a plain SELECT: the planner runs the closed definer, then the executor refuses | no: ran 6x, then permission denied for function zz_f | 0 / 0 | 0 / 0 | 1 / 0 |
| C10n | EXPLAIN of `v <>%= 5`, restriction estimator neqsel: it estimates through the NEGATOR, whose function is the closed definer | no: ran 6x | 0 / 0 | 0 / 0 | 1 / 0 |
| C10c | EXPLAIN of `5 <%= v` (the column on the right), estimator scalarltsel: it estimates through the COMMUTATOR, whose function is the closed definer | no: ran 201x | 0 / 0 | 0 / 0 | 1 / 0 |
| C10j | EXPLAIN of a join on a.v =%= b.v, join estimator eqjoinsel: it calls the closed definer on both sides' most common values | no: ran 10x, then permission denied for function zz_f | 0 / 0 | 0 / 0 | 1 / 0 |
| C10k | control: the same operator with no estimator -- EXPLAIN calls nothing, and a SELECT is refused by the executor | yes | 0 / - | 0 / - | 0 / - |
| CT1 | control: anon creates pg_temp.<># (int4ne, restrict neqsel) naming public.#%# -- whose function is the closed definer -- as its NEGATOR, then EXPLAINs a query using it | refused: must be owner of operator public.#%# | 0 / - | 0 / - | 0 / - |
| CT2 | control: the same with public.#%# named as the COMMUTATOR of pg_temp.<# (int4lt, restrict scalarltsel) | refused: must be owner of operator public.#%# | 0 / - | 0 / - | 0 / - |
| C4 | domain_in(text, <literal oid of the domain>, -1) in a CHECK on B: no catalog row links them; ON DELETE SET NULL | no: ran 1x | 0 / 0 | 0 / 0 | 2 / 0 |
| C4r | record_in(text, <literal oid of a composite with a domain field>, -1) in a CHECK on B; ON DELETE SET NULL | no: ran 1x | 0 / 0 | 0 / 0 | 2 / 0 |
| C4a | array_in(text, <literal oid of the domain>, -1) in a CHECK on B; ON DELETE SET NULL | no: ran 1x | 0 / 0 | 0 / 0 | 2 / 0 |
| C5 | satisfies_hash_partition(<literal oid of a table>, 2, 0, <a macaddr literal>) in a CHECK on B: that table's hash opclass support function (SQL-standard) calls the closed definer; ON DELETE SET NULL | no: ran 1x | 0 / 0 | 0 / 0 | 2 / 0 |
| C7 | a foreign key on partition B1 itself, ON DELETE SET NULL: the cascade's UPDATE ONLY B1 checks B1's partition constraint, the PARENT's key expression, which calls the closed definer through a SQL-standard function | no: ran 1x | 0 / 0 | 0 / 0 | 1 / 0 |
| C8 | chained cascade A -> B -> C (ON DELETE CASCADE twice); C carries a closed BEFORE DELETE trigger | no: ran 1x | 1 / 0 | 1 / 0 | 1 / 0 |
| C8r | cascade A -> B, and a DO ALSO rule on B writes C, which carries a closed BEFORE INSERT trigger | no: ran 1x | 1 / 0 | 1 / 0 | 1 / 0 |

Summary. The first repair exited 0 on 19 of the 22 plants that should exit 1 or 2 (it caught
C2n by another route and the chained cascades C8 and C8r); in 17 of those 19 the closed
definer ran for `anon`, C1a is autoanalyze (not runnable here) and C9 is refused by the
executor. This repair gives the wanted exit on all 27 plants, and all 22 controls exit 0
under all three scripts. C9 is the one row stricter than measured (see "What it does not
see"). Two findings are not paths, and are recorded as measured: a client cannot link someone
else's operator as the negator or commutator of its own (CT1, CT2), and a hash join refuses a
commutator outside the operator family (C9, C9k).

Evidence: `p4-scratch/pglite-probe/audit-391-r7-repair2/`, re-runnable after `node
survey.mjs` has rebuilt `base.blob`.

- `attacks2.mjs`, `attacks2-final.json`, `attack-table2.md`: this pass and its results;
  `attacks-final.json`: the first pass (44 plants) re-judged by this repair.
- `rp/replay9.mjs`, `rp/replay9.json`, `rp/replay9-ATK2.json`: the 351-row replay, four scripts.
- `extract.json`, `extract3.json`: the lines the self-test replays, as the script printed them.
- `ci-step-T0.txt`, `ci-step-C2.txt`, `ci-step-C4.txt`: the literal CI step body.
- `platform.mjs`, `platform-final.log`: the corpus plus the pinned storage-api schema.
- `reachstats.mjs`, `reachstats-final.log`: seeds, walk rows and time, both repairs, both builds.
- `mut9-script-full.txt`, `mut9-script-clauses.txt`, `mut9-claim.txt`: the mutation tables.
- `paths.json`: the 105 round-7 probes, re-run.

## Consequences

**[CORRECTED 2026-09-18, source: PR #391 audit.** The first bullet below was false,
because the statement it depends on did nothing. The third bullet's guard is now
built. What holds now:
- **Harder:** an author who writes `security definer` must also write
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` in the same migration, or CI
  fails and names the function.
- **Easier:** the rule no longer depends on anyone remembering it. It also does not
  depend on which database role runs the migration.
- **Given up:** what arm (c) cannot see, as classes (the Decision's residuals).
  **[2026-09-18, round 5: no longer given up for the class; the end-state check catches every
  replayed example. What is given up now is the end-state check's own blind spots (the
  Decision's round-5 block): the window between deploys, extension members, anything
  outside the build.]**
  - Dynamic SQL other than an EXECUTEd literal: a variable, `||`, `concat()`, a later
    `format()` argument, `execute (...)`, and a create hidden by a comment or an escape in a
    literal that nothing EXECUTEs.
  - SQL inside a function body, which runs at call time.
  - Overloads, renames and schema moves, because functions are keyed by name.
  - Anything outside the migration text, including what `create extension` installs.

  ~~Inside a `DO` block or an EXECUTEd literal, the guard refuses or credits exactly what
  `--self-test` names.~~ **[CORRECTED 2026-09-18, round 5, source: PR #391 verifier round 4:
  false. It credits a revoke that never runs (`if false`, an exception block), and it does not
  read a `DO` body written as a single-quoted literal.]** **[2026-09-18, round 4, source: PR #391 verifier, round 3: the
  round-3 text here said a create "in a dollar-quoted literal handed to `execute`" is
  refused. Two such shapes passed: `execute ($f$...$f$)` and `execute format('%s',
  $f$...$f$)`.]**
- **Outside the corpus, measured and NOT fixed here (2026-09-18, read-only production
  query):** production has four `SECURITY DEFINER` functions `EXECUTE`-able by `anon`
  and `authenticated` across every schema but `pg_catalog`/`information_schema`. One is
  `increment_trust_counter(uuid)`, which `20260917010400` closes once applied. The other
  three are PostGIS's `public.st_estimatedextent` overloads (2, 3 and 4 arguments),
  owned by `supabase_admin`, members of extension `postgis` 3.3.7. ~~No migration creates
  them (PostGIS does, inside `create extension`), so arm (c) cannot see them.~~
  **[CORRECTED 2026-09-18, round 4, source: PR #391 verifier round 3: false on a fresh
  build.]** No migration spells a `CREATE FUNCTION` for them. On a fresh
  build they arrive with `create extension if not exists postgis`
  (`20260807001252_distributor_geo_foundation.sql:31`, the corpus's only PostGIS
  install), and arm (c) does not expand what an extension installs, so it cannot see
  them. Whether production's copies came from that statement is not measured: `if not
  exists` makes it a no-op where PostGIS was already installed. They were
  not unknown: OD-72 recorded all three as `SECURITY DEFINER` and `anon`-executable and
  left them on purpose (`20260825210000_od72_revoke_client_grants.sql:143-145`:
  `supabase_admin` owns them, they are read-only geometry statistics, and a migration
  cannot `ALTER` them). That acceptance lives only in a migration comment, with no ADR
  and no register row. Each ACL grants `EXECUTE` to `PUBLIC`, `anon` and
  `authenticated` explicitly, from `supabase_admin`; `postgres` is not the owner, holds
  no grant option on them, is not superuser and is not a member of `supabase_admin`
  (all measured), so a `REVOKE` in a migration run as `postgres` would remove nothing.
  Filed OPEN in `.planning/v3.0-TECH-DEBT.md` ("Three PostGIS
  `st_estimatedextent` overloads..."), as an acceptance with no record, not as a new
  exposure.
- **Revisit when:** a `SECURITY DEFINER` function has to be client-callable (that
  needs an ADR and an `FN_CLIENT_CALLABLE` entry in the guard), or the founder wants option 2b as a
  database-level second layer.]** **[2026-09-18, round 5: also when the first CI run of the
  end-state check disagrees with the PGlite proof (a platform definer the allowlist does not
  name, or a stale webhook entry), when the pinned CLI is bumped (the webhook entry cites its
  `webhook.sql`), and when a migration adds a function to an extension. A client-callable
  definer then needs a `CLIENT_CALLABLE` entry in both scripts.]** **[2026-09-18, round 6: a
  CLI bump also means re-measuring the webhook's pinned identity (`src_md5` and the rest)
  from the new tag's template~~; and the call-through class (triggers, aggregate support
  functions) is OPEN in `v3.0-TECH-DEBT.md`~~.]** **[CORRECTED 2026-09-19, round 7: that
  class is closed, judged by the end-state check. Revisit also when CI's stack moves to a
  new PostgreSQL major (the path table was measured on 18.3 and a new major can add a path
  that runs a function without checking the caller), and when the first CI run reports a
  platform function reached through another object.]** **[2026-09-19, round-7 repair: revisit
  also when the check first exits 2 on a BLIND path in a legitimate schema. The likely case is
  a table that a client's `DELETE` cascades into and that carries a PL/pgSQL `updated_at`
  trigger. The trigger then runs as the table's owner, and the catalog cannot say what its
  body calls. How to vouch for such a function is an open decision. One option is a list of
  functions read by hand, pinned by `md5(prosrc)` the way `CLIENT_CALLABLE` pins its entry.
  Another is to require SQL-standard bodies in owner context. This ADR does not pre-decide
  it: exit 2 stops CI until the founder decides. Revisit, too, when CI's first run reports a
  seed or a BLIND path in the Supabase stack's own schemas (see "What it does not see").]**
  **[2026-09-19, round-7 repair 2: the column-statistics and foreign-key-check seeds reach
  further, so a BLIND stop in a legitimate schema is likelier: a client-writable table with a
  column of a range type whose `subtype_diff` is PL/pgSQL (C1p), or a foreign key whose key
  types meet through a PL/pgSQL cast (C2p). Same open decision. Revisit also when CI's stack
  moves to a PostgreSQL major whose planner, `ri_triggers.c` or maintenance commands run
  another catalog function as an owner or without a check.]**

*[Original 2026-09-17 bullets, kept for the record:]*

- ~~**Easier:** a `SECURITY DEFINER` function written after this migration needs no
  extra step to ship private — the database default now matches the intent every
  author already has, instead of requiring each author to remember an idiom OD-72
  itself forgot.~~ **[False, 2026-09-18, source: PR #391 audit, PGlite probe
  `p4-scratch/pglite-probe/audit-391-defacl.mjs`: see the correction above.]**
- **Harder / given up:** a function meant to be client-executable (there are none
  today, per this migration's own grep of `apps/web`/`apps/mobile`) now needs an
  explicit `GRANT ... TO <role>` where it did not before. This is the intended
  trade — reachable by design, not by omission. **[FALSE, 2026-09-18, source: PR #391
  audit: the database default never changed, so no function needs a `GRANT` it did not
  need before; every new function still ships `EXECUTE` to `PUBLIC`. What changed is
  review-time: under guard arm (c) a `SECURITY DEFINER` function meant to be
  client-callable needs an ADR, an `FN_CLIENT_CALLABLE` entry naming the role, a revoke
  from `PUBLIC` and an explicit `GRANT` to that role. `SECURITY INVOKER` functions are
  unchanged.]**
- **Not built, named rather than assumed unnecessary:** the CI guard from option 3.
  `ALTER DEFAULT PRIVILEGES` is scoped to the *role that issues it* — if a future
  migration ever runs under a different database role than the one that ran this
  statement (a new CI service account, a manual `psql` session as a different user), a
  function it creates ships client-executable again with nothing here to catch it. Add
  the guard, or re-run this `ALTER DEFAULT PRIVILEGES` for that role, the day migrations
  stop running as a single owning role — the signal to revisit, not "someday."
  **[STALE, 2026-09-18, source: PR #391 audit: the guard is built, as arm (c) of
  `scripts/check_new_tables_are_locked_down.py`, and it reads migration text, so it does
  not depend on which role runs them. The `ALTER DEFAULT PRIVILEGES` this bullet leans on
  protected nothing for any role and has been removed.]**
- **Revisit when:** the migration-runner role changes, or a `SECURITY DEFINER`
  function is found client-executable again despite this migration having applied —
  either means this ADR's mechanism stopped covering the actual write path.
  **[SUPERSEDED, 2026-09-18, source: PR #391 audit, PGlite probe
  `p4-scratch/pglite-probe/audit-391-defacl.mjs`: the mechanism this bullet watches was a
  no-op. The live revisit triggers are in the corrected block above.]**

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | leaks-review (lane audit) | Found: OD-72 register row false, no CLAIMS row, no guard against the class regenerating |
| 2026-09-17 | `fix/finish-leaks` fixer | Created — mechanism documented, migration fixed, measured with PGlite (three probe runs, see links) |
| 2026-09-18 | PR #391 audit planner | Found: the option 2 statement is a no-op (PGlite probe), and three records certify it as a fix: the migration comment, this ADR, and the OD-72 CLAIMS row |
| 2026-09-18 | `fix/finish-leaks` fixer | Corrected: no-op removed, option 3 built as guard arm (c) plus `--self-test`, the named `FN_CLIENT_CALLABLE` allowlist (empty) and the dynamic-GRANT refusal, production default ACLs and function ACLs measured read-only, the OD-72 register row and README row corrected too, CLAIMS row rewritten without a stderr redirect and mutation-tested (18 breaks). Still Proposed, awaiting founder lock |
| 2026-09-18 | PR #391 verifier | Found: the CLAIMS row and both CI steps trusted exit codes alone (three guts to exit 0 stayed green); eight breaks to the guard passed its self-test; the dynamic-GRANT wording overstated what is refused; two original sentences and the "not built" bullet stood unbracketed; production's three `supabase_admin` PostGIS `st_estimatedextent` overloads are client-executable `SECURITY DEFINER` |
| 2026-09-18 | `fix/finish-leaks` fixer (round 2) | Corrected: the CLAIMS row and the self-test CI step now assert the guard's printed report (arm-(c) `OK` tally at least 7 on the tree, `SELF-TEST OK` at least 32 cases executed); 9 self-test cases added (23 to 32), all 23 guard breaks now fail it; dynamic-GRANT and dynamic-create wording narrowed, residuals named; original false sentences bracketed; the PostGIS finding filed OPEN in `v3.0-TECH-DEBT.md`. Claim mutation table: all 30 breaks fail it (the 10 guard breaks also fail the CI self-test step), the 3 documented residuals pass. Still Proposed, awaiting founder lock |
| 2026-09-18 | PR #391 verifier (round 2) | Found: the PostGIS entry, Consequences and the evidence file said no migration names `st_estimatedextent`, but `20260825210000_od72_revoke_client_grants.sql:143-145` records all three overloads and leaves them on purpose; a `create function` in a dollar-quoted `execute` literal passed silently while four sentences said a create inside a literal is refused; five re-open shapes passed unnamed (a `GRANT` in a dollar-quoted or `E''` `execute` literal, `format()` with the role as the placeholder, rename-then-grant, a `GRANT` inside a helper the migration calls); "the only dynamic GRANT it sees" overstated; two brackets carried no source |
| 2026-09-18 | `fix/finish-leaks` fixer (round 3) | Corrected: the PostGIS entry, this ADR and the evidence file now say OD-72 saw the overloads and left them, with no ADR or register row; the guard reads `E''` literals (decoded) and dollar-quoted `execute` literals, refuses a `create function` in either and a `format()` `GRANT` whose grantee or privilege is a placeholder (exit 2), and masks argument lists, because an `interval day to second` argument had split a `GRANT`'s name list and hidden a grant to `anon` (found this round; the verifier's sweep had scored that row caught for the wrong reason); rename, set-schema, helper-call and dollar-quoted-variable shapes named as residuals; both brackets sourced; self-test 32 to 42 cases, floor raised to 42 in CI and in the CLAIMS row. Self-test mutation table: 40 breaks, all killed; each of the 10 new ones survives the 32 older cases alone. Claim mutation table: 37 breaks, all fail the OD-72 CLAIMS verify (the 11 that break the guard or its self-test also fail the CI self-test step), and the 8 documented residuals pass. Still Proposed, awaiting founder lock |
| 2026-09-18 | PR #391 verifier (round 3) | Found: the create refusal was worded more broadly than it works. A comment between `create` and `function` in a literal nothing EXECUTEs passed, and so did `execute ($f$...$f$)` and a create passed as a later `format()` argument. Four more `GRANT` shapes passed unnamed: a comment of more than 40 characters before the literal, `execute (...)`, a later `format()` argument, and `concat()`. Seven mutations (W1-W7) left the self-test green; two of them turned a caught leak into a silent pass. "No migration creates them" is false on a fresh build (`20260807001252:31`). Three brackets carried no source |
| 2026-09-18 | `fix/finish-leaks` fixer (round 4) | Stopped enumerating shapes. The guard docstring, this ADR and the tech-debt entry now state what arm (c) reads as a definition (static text, `DO` bodies, EXECUTEd literals), and the residuals as four classes (dynamic SQL, call-time SQL, name not signature, not in the migration text), with the verifier's bypasses as examples. The 40-character look-back window is gone: an EXECUTEd literal is matched on the reversed view, with any whitespace or comment between. The self-test's closing line only counts. Every rule, alternative and check in arm (c), and the lexer's `E''` rules, was mutated one at a time: 139 breaks, each killed by a named case, 0 NO-OP. 47 cases were added (42 to 89), and the floor is 89 in `ci.yml` and in the CLAIMS row. The sweep found two static misreads, both real leaks on PGlite: `REVOKE GRANT OPTION FOR` and `ON ALL PROCEDURES` were credited as closing a function. Both now exit 1, and `ON ALL <kind>` reaches only that kind. The arm-(b) twin of the first is filed OPEN, not fixed. Unreachable code was removed. Three brackets are sourced, and the PostGIS sentence now names `20260807001252:31`. Still Proposed, awaiting founder lock |
| 2026-09-18 | PR #391 verifier (round 4) | Found: a `DO` body written as a single-quoted or `E''` literal is not read, though two sentences said every `DO` body is; four static `GRANT` forms pass (`to group anon`, two role tails, `create schema ... grant ...`, a grant to a role `anon` is a member of); control flow (`if false`, an exception block, a savepoint) is credited and no class named it; four more mutations (O1-O4) leave the self-test green, so "0 NO-OP" held only for the chosen set; the register rows' "held for the SQL a migration spells statically" was broader than proven; "outside a dollar-quoted body" was the wrong scope |
| 2026-09-18 | `fix/finish-leaks` fixer (round 5) | Changed the approach instead of adding shapes. Built `scripts/check_definer_functions_closed.py`, an end-state check on the database `schema-parity.yml` builds, wired right after `supabase db reset --no-seed` with a canary and a self-test step (61 cases). Replayed the 70 distinct migrations the round 1-4 probe and bypass files planted, on a full-corpus PGlite build: exit 1 on all 58 leaks, 0 on all 11 non-leaks, 1 migration aborts itself; plus 4 rows of its own, one of them a leak it passes by design (an open definer added to an extension), named. Narrowed arm (c) to a fast pre-check in its docstring, its OK line, this ADR, the tech-debt entry, the README row, the OD-72 register row and CLAIMS row, and fixed the round-4 wording findings by narrowing. The OD-72 CLAIMS row now pins the end-state step, its position, its floors and its self-test (27-row mutation table, 0 wrong). Not measured on the Supabase local stack (Docker would not start); the first CI run is that measurement. Still Proposed, awaiting founder lock |
| 2026-09-18 | PR #391 verifier (round 5) | Found: the allowlist matched on signature alone, so dropping the webhook and recreating it callable passed the end-state check, its canary and arm (c) (A1c; `anon`'s call ran as `postgres`); a role granted to `authenticator` was not judged (A8); reach through a trigger or an aggregate's support function (A3, A9) and a data-dependent grant (A2) were not named as residuals; two arm-(c) sentences claimed more than its self-test; the local-host rule missed `PGSERVICE`; the OD-72 CLAIMS row survived `if: false` on the self-test step and a neutered canary condition |
| 2026-09-18 | `fix/finish-leaks` fixer (round 6) | Pinned each allowlist entry to the function's identity (owner, language, return type, returns-set, kind, `proconfig`, `md5(prosrc)` measured from the v2.116.0 template), and the canary to the exact owner line; arm (c) refuses any migration naming `supabase_functions` (exit 2). The end-state check judges every role `authenticator` reaches, `service_role` excepted with its reason; the host rule refuses `PGSERVICE` and a remote `PGHOSTADDR` (found this round: libpq connects to `hostaddr` whatever `host` says). Named as residuals: reach through a trigger or an aggregate (filed OPEN in tech debt; a `DEFAULT`, a view and an RLS policy were measured to refuse the caller, so they are controls, not residuals), and the empty build versus production's data. Narrowed arm (c)'s two sentences. The CLAIMS row pins the self-test step's `if:` and the canary's three lines verbatim. Replay: the 80 earlier rows unchanged; A1, A1b, A1c, A8 now exit 1 (A1-A1c exit 2 on arm (c)). Self-tests 105 and 95 cases. Still Proposed, awaiting founder lock |
| 2026-09-19 | `fix/finish-leaks` fixer (round 7) | On the founder's word ("do what the optimal scenario would do, no we can do this later or second plan"): kept arm (c)'s broad `supabase_functions` refusal, and closed the reach-through residuals instead of naming them. The end-state check gained a fourth read-only query that judges every path PostgreSQL runs a `SECURITY DEFINER` function by with no `EXECUTE` check against the caller -- triggers on any write a judged role can make land (views, rules, partitions, foreign-key actions as the owner), what a cascaded table's objects call, autoanalyze/`MAINTAIN`, aggregate support functions, types a judged role owns, and as `PUBLIC` every catalog-wired slot (operator families, estimators, planner support, type I/O, ranges, casts, event triggers, text search, languages, FDWs, access methods, conversions, transforms, `TABLESAMPLE`). 105 probes measured which paths check the caller (path table above). Replay: 222 rows, only A3, A9 and N1 move (0 -> 1); 59 new leak rows exit 1, their 59 closed controls 0. Self-test 105 -> 342 cases, floor raised in `schema-parity.yml` and the OD-72 CLAIMS row, which now also greps the trigger and aggregate arms. TECH-DEBT's reach-through entry closed. Not measured: the local stack (Docker hung) and PostgreSQL 17 itself. Still Proposed, awaiting founder lock |
| 2026-09-19 | PR #391 verifier (round 7) | NOT READY. It ran no adversarial pass and re-ran none of the builder's numbers (replay, 105 probes, mutation tables, self-test, lockdown guard, `check_decision_claims.sh`, the other guards). It confirmed the worktree's six changed files and, on its own PGlite build, the tree's exit 0 with 0 reached. Open question: the reach query followed an object's `pg_depend` rows to `pg_proc` only, so a function run through another catalog object from an owner-context arm (an operator, a cast to a domain) may be missed, and the "measured to check the caller" list may say more than the probes did |
| 2026-09-19 | `fix/finish-leaks` fixer (round-7 repair) | Ran the adversarial pass: 44 plants, 36 controls (table above). The round-7 check missed 23 plants, and each one ran a closed definer for `anon`. It follows now every object an owner-context path runs (a walk over `pg_depend`, column types, relations read, domain CHECKs, casts, operator families, aggregates and SQL-standard bodies), counts row movement between partitions and views over `INSTEAD OF` views as writes, and exits 2 (BLIND) on owner-context code the catalog does not describe. Each query is pinned by its md5. Re-measured every round-7 number: they hold for the round-7 script. On the repaired script, R2's closed control moves 0 -> 2, which B28 shows is a real path. The docstring's "measured to check the caller" list now names a probe for every item (two had none: B18, B19), and CLUSTER and VACUUM FULL are measured. Self-test 342 -> 491 cases. Floor raised in `schema-parity.yml` and the OD-72 CLAIMS row, which now also greps the walk, the BLIND rule and wiring, the md5 check and `REACH_SQL`'s md5. Self-test mutation table: 117 mutants, 115 killed by the self-test; the other 2 are killed by the CLAIMS row. CLAIMS mutation table: 67 rows, 0 wrong. Not measured: the Supabase local stack (Docker hung), PostgreSQL 17, and the BLIND builtins other than `ts_rewrite` and `pg_input_is_valid`. Still Proposed, awaiting founder lock |
| 2026-09-19 | `fix/finish-leaks` fixer (round-7 repair 2) | Ran a second adversarial pass, drawn from the owner contexts' source code (27 plants, 22 controls; table "Round 7 repair 2"). The first repair exited 0 on 19 of 22 plants, and in 17 of them a closed definer ran for `anon`. The paths: column statistics under `ANALYZE`, a foreign key's check, an operator's negator, builtins handed a type or table by OID, a partition's parent key, and, in client context, an operator function a selectivity estimator runs while planning. The check now seeds column statistics and foreign-key checks, follows negators and commutators, judges ancestors' partition keys and six more builtins, judges the estimator path as `PUBLIC`, and walks once per seed object (97.5 s to 3.0 s on the storage-api proxy). Re-measured: the 351-row replay four ways (every earlier row unchanged), the first pass's 44 plants and 36 controls, the 105 probes, the literal CI step body (0 / 1 / 2), the tree and the storage-api proxy (0 reached, 0 BLIND each). Self-test 491 -> 576 cases; the floor raised in `schema-parity.yml` and in the OD-72 CLAIMS row, which now also greps the new arms and `REACH_SQL`'s new md5. Self-test mutation table: 141 mutants, 137 killed; the other 4 (replay tables emptied, the md5 check off) are killed by the CLAIMS row, and clause pins alone kill 134. CLAIMS mutation table: 77 rows, 0 wrong. Not measured: the rest of the Supabase stack, PostgreSQL 17. Still Proposed, awaiting founder lock |
| 2026-09-19 | CI, first run on the real stack (schema-parity run 35416265310) | The end-state check ran on the Supabase stack built from every migration: `DEFINER-CHECK OK -- 7 in public (floor 7), 9 in scope, 5 extension member(s) excluded, 1/1 allowlisted (identity pinned); judged: PUBLIC, anon, authenticated, authenticator`. The same log also shows a FAIL line naming `supabase_functions.http_request()` (explicit anon and authenticated grants); the log is not enough to say which pass printed it. Evidence is kept by the orchestrator (scratch `fix0159-r7/ci-first-real-stack-run-35416265310.txt`). |
| 2026-09-19 | PR #396 reviewer B (relayed by the trust-counter session) | Residual: the baseline migration has zero GRANT/REVOKE lines, so schema-parity's "Fresh database equals remote" compares shapes and never grants, and cannot prove any grant claim. This check covers definer EXECUTE on the built database. Production's table and view grants are still measured only by a read-only SELECT (OD-72's 2026-09-19 bracket). |
