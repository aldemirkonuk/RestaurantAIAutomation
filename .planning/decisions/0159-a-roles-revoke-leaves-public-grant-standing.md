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
  -- <n> cases run`, n >= ~~61~~ **105**), not only the exit code. **[2026-09-18, round 6: also
  exit 2 when `authenticator` is missing, since without it there is no telling which roles
  the API can switch into, and on an allowlist entry with no identity, a partial one, or a
  malformed one. The self-test grew from 61 to 105 cases.]**
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
- **What it does not see.** Time: it judges the end state, so a function open between two
  deploys passes (arm (c)'s same-file rule is the only thing that speaks to that window).
  Extension members, by construction: production's three PostGIS `st_estimatedextent`
  overloads are outside it, and so is an open definer a migration adds to an extension with
  `alter extension ... add function` (replayed: exit 0, the one planted leak it passes).
  Anything outside the build (dashboard, `psql`, production). Code that calls a function at
  runtime which then grants. Privileges other than `EXECUTE` and ownership.
  **[2026-09-18, round 6, source: PR #391 verifier round 5. Three more, measured on PGlite:]**
  - *Reach through another object.* Only `EXECUTE` on the function itself is judged, and
    PostgreSQL runs some functions with no `EXECUTE` check against the caller. A closed
    `SECURITY DEFINER` trigger function fired, as `postgres`, on an `INSERT` by `anon` into
    a table `anon` may write (A3). A closed definer used as an aggregate's state function
    ran as `postgres` when `anon` called an aggregate it may `EXECUTE`, because support
    functions are checked against the aggregate's owner (A9). Both exit 0. The controls
    hold, and are not residuals: a closed definer used as a column `DEFAULT` (A10), called
    in a view `anon` may `SELECT` (A11), or called in an RLS policy (A12) is refused to
    `anon` (`permission denied for function`). Filed OPEN in `v3.0-TECH-DEBT.md`.
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
  trigger. No migration names it today (grep: 0 files). A name assembled at run time, a
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
  from the new tag's template; and the call-through class (triggers, aggregate support
  functions) is OPEN in `v3.0-TECH-DEBT.md`.]**

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
