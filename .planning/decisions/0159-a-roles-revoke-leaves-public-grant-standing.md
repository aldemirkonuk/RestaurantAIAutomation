# 0159 — A role's own REVOKE leaves PUBLIC's grant standing; revoke PUBLIC too

- **Status:** Proposed — built by the `fix/finish-leaks` fixer, 2026-09-17; awaiting founder lock
- **Date:** 2026-09-17
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** SECURITY DEFINER, REVOKE, GRANT, PUBLIC, alter default privileges, has_function_privilege, OD-72, grep-friendly: public-grant, default-acl
- **Links:** [[../decisions/OPEN-DECISIONS.md]] OD-72 row (corrected by this ADR); `supabase/migrations/20260825210000_od72_revoke_client_grants.sql` (the original ratchet, lines 183-190); `supabase/migrations/20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql` (closes the two named functions and adds the class-level fix); `.planning/decisions/CLAIMS.jsonl` (new OD-72 row)

## Context

OD-72's 2026-08-26 migration (`20260825210000_od72_revoke_client_grants.sql`, section
3) looped over every anon-executable `SECURITY DEFINER` function and ran `revoke all
on function ... from anon, authenticated`. The OPEN-DECISIONS register recorded OD-72
as **"Closed in production 2026-08-26."** It was not, for two of those functions:
`increment_trust_counter(uuid)` and `seed_sim_restaurant(jsonb)` stayed executable to
`anon` and `authenticated` for 22 more days, until `20260917010400` (this branch)
actually closed them.

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
3. **A CI guard that fails when a migration creates a `SECURITY DEFINER` function with
   no matching `REVOKE ... FROM PUBLIC` in the same file.** Catches the authoring
   mistake at review time, which option 2 does not need anyone to remember to make.
   Costs a new script (`grep prosecdef scripts/` finds nothing today — no such guard
   exists) and ongoing upkeep as a second, hand-written detector; and it cannot catch
   a function created under a role whose default privileges were never locked down,
   which is exactly the gap option 2 closes structurally.
4. *(Leave OD-72's existing ratchet as the only defence)* — already measured false: the
   PGlite probe's stage 1 is exactly this state, and it fails.

## Decision

**Option 2**, applied in `20260917010400_a_security_definer_rpc_answers_only_to_the_server.sql`:

```sql
alter default privileges in schema public
  revoke execute on functions from public;
```

This is the statement OD-72's function-side ratchet needed and did not write. It
closes the class at the database level — every `SECURITY DEFINER` function created in
`public` from this migration forward ships private by default, the same guarantee
`ALTER DEFAULT PRIVILEGES ... REVOKE ALL ... FROM anon, authenticated` gives tables —
with no CI script to write or maintain, and no dependence on a reviewer noticing a
missing `REVOKE` line in a future migration's diff.

Option 3 (a CI guard) is not built here. It would catch a narrower, different failure
— an author who writes `security definer` and also writes an *incomplete* explicit
grant, on a database whose default privileges option 2 has *not* locked down (a second
migration role, a schema this fix does not cover) — and is left as a named, not-built
follow-up rather than assumed unnecessary; see Consequences.

The two named functions themselves are closed the same migration closes the class:
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

- **Easier:** a `SECURITY DEFINER` function written after this migration needs no
  extra step to ship private — the database default now matches the intent every
  author already has, instead of requiring each author to remember an idiom OD-72
  itself forgot.
- **Harder / given up:** a function meant to be client-executable (there are none
  today, per this migration's own grep of `apps/web`/`apps/mobile`) now needs an
  explicit `GRANT ... TO <role>` where it did not before. This is the intended
  trade — reachable by design, not by omission.
- **Not built, named rather than assumed unnecessary:** the CI guard from option 3.
  `ALTER DEFAULT PRIVILEGES` is scoped to the *role that issues it* — if a future
  migration ever runs under a different database role than the one that ran this
  statement (a new CI service account, a manual `psql` session as a different user), a
  function it creates ships client-executable again with nothing here to catch it. Add
  the guard, or re-run this `ALTER DEFAULT PRIVILEGES` for that role, the day migrations
  stop running as a single owning role — the signal to revisit, not "someday."
- **Revisit when:** the migration-runner role changes, or a `SECURITY DEFINER`
  function is found client-executable again despite this migration having applied —
  either means this ADR's mechanism stopped covering the actual write path.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | leaks-review (lane audit) | Found: OD-72 register row false, no CLAIMS row, no guard against the class regenerating |
| 2026-09-17 | `fix/finish-leaks` fixer | Created — mechanism documented, migration fixed, measured with PGlite (three probe runs, see links) |
