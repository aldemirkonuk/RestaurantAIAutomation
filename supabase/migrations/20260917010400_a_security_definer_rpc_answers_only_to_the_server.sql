-- A SECURITY DEFINER RPC answers only to the server (2026-09-17)
--
-- WHAT WAS FOUND
-- -------------------------------------------------------------------------
-- `increment_trust_counter(uuid)` and `seed_sim_restaurant(jsonb)` are both
-- SECURITY DEFINER (baseline_from_production.sql:678, :1392): they run as
-- their owner regardless of who calls them. OD-72
-- (20260825210000_od72_revoke_client_grants.sql, section 3) already tried to
-- close this — it looped over every anon-executable SECURITY DEFINER
-- function and ran `revoke all on function ... from anon, authenticated`.
-- That revoke did not close these two.
--
-- WHY IT DID NOT CLOSE THEM
-- -------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE on a newly created function to PUBLIC by
-- default, and every role — anon and authenticated included — implicitly
-- carries whatever PUBLIC holds, on top of its own explicit grants. Neither
-- function was ever explicitly `REVOKE ... FROM PUBLIC`, so the default
-- PUBLIC grant was still standing after OD-72 ran. Revoking a role's own
-- explicit grant does nothing to the access that role still has through
-- PUBLIC — `has_function_privilege('anon', ...)` after OD-72 was (and,
-- unfixed, still is) `true` for both. This is the same shape as the schema
-- guidance's caution about revoking from a role that also inherits from a
-- group it was not un-membered from — the group's grant survives.
--
-- [Measured in production 2026-09-18, PR #391 audit: `increment_trust_counter`
-- is still `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`, so it is
-- open to anon and authenticated today. `seed_sim_restaurant` is already
-- `{postgres=X/postgres,service_role=X/postgres}`. Nothing in this migration
-- corpus closed it, so the change happened outside it. Both revokes stay: a
-- database built from this corpus has both functions open.]
--
-- OD-72's own verification (section 5) only re-checked tables and views; it
-- never re-asserted the function revoke, so the gap shipped as reported
-- success. Section 5 of this migration closes that specific absence for
-- exactly these two functions — see CLAUDE.md's "absence reported as
-- health" rule.
--
-- WHO STILL NEEDS TO CALL THEM
-- -------------------------------------------------------------------------
-- Both are called only from server processes holding the service-role key,
-- never from a browser client (checked: no `apps/web` or `apps/mobile`
-- reference either name).
--   * `increment_trust_counter` — `services/agent-orchestrator/services/
--     override_service.py:475`, via a Supabase client built from
--     `SUPABASE_SERVICE_KEY` / `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
--     (`config/settings.py:26-30`, `:276-287`).
--   * `seed_sim_restaurant` — `scripts/synth/seed.py:766` (PostgREST RPC),
--     built from `SUPABASE_SERVICE_ROLE_KEY` (`seed.py:761-764`).
-- Both keep working: the grant below is explicit, so it does not depend on
-- whatever default privileges Supabase's own bootstrap happens to hold for
-- service_role.
--
-- Exact signatures, from the baseline:
--   public.increment_trust_counter(p_user_id uuid)
--   public.seed_sim_restaurant(payload jsonb)

-- Guarded on `to_regprocedure`, not assumed present: a chain that never
-- created these functions (this migration applied on top of a fresh schema
-- with no baseline) must not abort the whole migration over DDL naming a
-- function that does not exist here. Measured with a PGlite probe
-- (p4-scratch/pglite-probe/REVIEW-leaks-migration-safety.mjs, case B)
-- against the unguarded version of this file, which did abort that way.
do $$
begin
  if to_regprocedure('public.increment_trust_counter(uuid)') is not null then
    execute 'revoke execute on function public.increment_trust_counter(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.increment_trust_counter(uuid) to service_role';
  else
    raise notice 'increment_trust_counter(uuid): does not exist on this database, nothing to lock down';
  end if;

  if to_regprocedure('public.seed_sim_restaurant(jsonb)') is not null then
    execute 'revoke execute on function public.seed_sim_restaurant(jsonb) from public, anon, authenticated';
    execute 'grant execute on function public.seed_sim_restaurant(jsonb) to service_role';
  else
    raise notice 'seed_sim_restaurant(jsonb): does not exist on this database, nothing to lock down';
  end if;
end
$$;

-- The CLASS -- every SECURITY DEFINER function a later migration writes -- is
-- closed at review time, not here.
--
-- [CORRECTED 2026-09-18, source: PR #391 audit.] This spot used to hold
-- `alter default privileges in schema public` + `revoke execute on functions
-- from public`, captioned "close the CLASS". That statement is a NO-OP and has
-- been removed. PostgreSQL applies a per-schema default ACL on top of the
-- global one, so an IN SCHEMA revoke can only take back what an IN SCHEMA
-- grant gave; EXECUTE-to-PUBLIC is the built-in global default and it cannot
-- touch it. Measured with a PGlite probe: a function created after the
-- statement carried `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`,
-- identical to a control run without it.
--
-- The caption's other claim was wrong too. It said OD-72's own
-- `... revoke all on functions from anon, authenticated`
-- (20260825210000_od72_revoke_client_grants.sql:186-187) had no default to
-- revoke. Production's pg_default_acl (read 2026-09-18) shows postgres's
-- per-schema function default in `public` as
-- `{postgres=X/postgres,service_role=X/postgres}`, with no anon or
-- authenticated. supabase_admin's row in `public` still names both, and
-- OD-72's statement is the only one in this corpus that removes them. So it
-- did change the default. It just never mattered, because PUBLIC's grant
-- already covers both roles.
--
-- What replaced it: arm (c) of scripts/check_new_tables_are_locked_down.py
-- (already a CI step) fails the build when a migration creates, replaces or
-- alters-to a SECURITY DEFINER function without revoking EXECUTE from PUBLIC,
-- anon and authenticated in that same file, and refuses the no-op statement
-- if it is ever written again. ADR 0159 records why a database-wide default
-- (`alter default privileges for role postgres revoke execute on functions
-- from public`, the global form, which does work) was not chosen here.
--
-- [2026-09-18, round 5, source: PR #391 verifier round 4: arm (c) reads
-- migration text and is only a fast pre-check for common spellings. The class
-- is decided by scripts/check_definer_functions_closed.py, an end-state check
-- on the database schema-parity.yml builds from every migration (ADR 0159).]

-- ---------------------------------------------------------------------------
-- Assert the outcome. A revoke that reports success without measuring is
-- exactly the failure this migration exists to fix (CLAUDE.md §0.5, §9).
-- Each check is itself guarded on `to_regprocedure`: `has_function_privilege`
-- errors on a signature that does not resolve, the same as the bare REVOKE
-- above did before it was guarded, and a database that never created these
-- functions has nothing to assert about them.
-- ---------------------------------------------------------------------------
do $$
declare
  bad text;
begin
  select string_agg(x.label, ', ') into bad
  from (
    values
      ('increment_trust_counter(uuid)'::text,
       case when to_regprocedure('public.increment_trust_counter(uuid)') is null then false
            else has_function_privilege('anon', 'public.increment_trust_counter(uuid)', 'EXECUTE')
                 or has_function_privilege('authenticated', 'public.increment_trust_counter(uuid)', 'EXECUTE')
       end),
      ('seed_sim_restaurant(jsonb)'::text,
       case when to_regprocedure('public.seed_sim_restaurant(jsonb)') is null then false
            else has_function_privilege('anon', 'public.seed_sim_restaurant(jsonb)', 'EXECUTE')
                 or has_function_privilege('authenticated', 'public.seed_sim_restaurant(jsonb)', 'EXECUTE')
       end)
  ) as x(label, still_executable)
  where x.still_executable;

  if bad is not null then
    raise exception 'security-definer lockdown not closed — still client-executable: %', bad;
  end if;

  if to_regprocedure('public.increment_trust_counter(uuid)') is not null then
    if not has_function_privilege('service_role', 'public.increment_trust_counter(uuid)', 'EXECUTE') then
      raise exception 'security-definer lockdown broke the server caller — service_role lost EXECUTE on increment_trust_counter';
    end if;
  end if;

  if to_regprocedure('public.seed_sim_restaurant(jsonb)') is not null then
    if not has_function_privilege('service_role', 'public.seed_sim_restaurant(jsonb)', 'EXECUTE') then
      raise exception 'security-definer lockdown broke the server caller — service_role lost EXECUTE on seed_sim_restaurant';
    end if;
  end if;

  raise notice 'increment_trust_counter/seed_sim_restaurant: anon and authenticated can no longer EXECUTE where the function exists; service_role still can.';
end
$$;
