-- OD-73 regenerated: RLS for the three evidence-gate tables.
--
-- WHY THIS EXISTS
-- ---------------
-- OD-73 closed on 2026-08-26 with "0 public tables remain RLS-off", verified
-- against the live database. Roughly two hours later that was false again:
-- `20260826175836_evidence_gate_v1.sql` (restored verbatim from production's
-- ledger in 6c4996f9) creates field_evidence_policy, promotion_audit and
-- source_registry with no RLS, no policy, no GRANT and no REVOKE anywhere in
-- the file. The class regenerated the day after the sweep, which is why
-- scripts/check_new_tables_are_locked_down.py now blocks it in CI.
--
-- SEVERITY, STATED HONESTLY
-- -------------------------
-- This is defence-in-depth, not an open door. OD-72 set a standing ratchet at
-- 20260825210000_od72_revoke_client_grants.sql:183 --
--
--     alter default privileges in schema public
--       revoke all on tables from anon, authenticated;
--
-- -- so every table created after that version, these three included, starts
-- with no anon or authenticated grant and is not PostgREST-reachable. The
-- REVOKEs below are therefore redundant today. They are written anyway because
-- the ratchet is a default, and a default is one explicit GRANT away from being
-- undone; the guard's two arms are independent for the same reason.
--
-- WHY A FOLLOW-UP AND NOT AN EDIT TO THE CREATING MIGRATION
-- ---------------------------------------------------------
-- OD-59 and OD-94 both require RLS to live in the migration that CREATES the
-- table, and the guard says so in its own failure message. That rule is right,
-- and it does not fit here: 20260826175836 has ALREADY BEEN APPLIED to
-- production. Editing it would change only databases built from scratch --
-- production would never re-run it -- so a fresh database would have RLS and
-- production would not. That is a new fresh-vs-remote divergence, invisible to
-- check_schema_parity.sh because parity compares columns and functions and not
-- RLS or grants. It is the same shape as the drift that cost today's afternoon.
--
-- A follow-up gets applied to production on the next deploy AND to every fresh
-- build, so the two converge. The convention assumes the creating migration has
-- not shipped; when it has, a follow-up is the only option that fixes both.
--
-- Idempotent throughout: production's state is unknown from here and this file
-- must survive being applied to a database that already has some of it.

-- ---------------------------------------------------------------------------
-- 1. Tables: RLS on, explicit service_role policy, client roles revoked.
-- ---------------------------------------------------------------------------
alter table public.field_evidence_policy enable row level security;
drop policy if exists field_evidence_policy_service_role on public.field_evidence_policy;
create policy field_evidence_policy_service_role on public.field_evidence_policy
  for all to service_role using (true) with check (true);
revoke all on public.field_evidence_policy from anon, authenticated;

alter table public.promotion_audit enable row level security;
drop policy if exists promotion_audit_service_role on public.promotion_audit;
create policy promotion_audit_service_role on public.promotion_audit
  for all to service_role using (true) with check (true);
revoke all on public.promotion_audit from anon, authenticated;

alter table public.source_registry enable row level security;
drop policy if exists source_registry_service_role on public.source_registry;
create policy source_registry_service_role on public.source_registry
  for all to service_role using (true) with check (true);
revoke all on public.source_registry from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Views: a view cannot carry RLS, so grants are the whole control.
-- ---------------------------------------------------------------------------
-- These three read the tables above. `ALTER DEFAULT PRIVILEGES ... ON TABLES`
-- covers views as well, so like the REVOKEs above these are belt-and-braces --
-- and unlike the tables, there is no second control behind them.
revoke all on public.v_library_provenance_health from anon, authenticated;
revoke all on public.v_promotion_blockers        from anon, authenticated;
revoke all on public.v_signature_drift           from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome, per OD-94's pattern. A migration that cannot prove
--    what it did is a migration nobody re-reads.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  missing text[] := '{}';
  granted text[] := '{}';
begin
  foreach t in array array['field_evidence_policy', 'promotion_audit', 'source_registry']
  loop
    if not exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      missing := missing || t;
    end if;
  end loop;

  foreach t in array array[
    'field_evidence_policy', 'promotion_audit', 'source_registry',
    'v_library_provenance_health', 'v_promotion_blockers', 'v_signature_drift'
  ]
  loop
    if has_table_privilege('anon', 'public.' || quote_ident(t), 'SELECT')
       or has_table_privilege('authenticated', 'public.' || quote_ident(t), 'SELECT') then
      granted := granted || t;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception 'OD-73 not closed: RLS still off on public.%',
      array_to_string(missing, ', public.');
  end if;
  if array_length(granted, 1) is not null then
    raise exception 'OD-73 not closed: anon or authenticated can still SELECT public.%',
      array_to_string(granted, ', public.');
  end if;
end $$;
