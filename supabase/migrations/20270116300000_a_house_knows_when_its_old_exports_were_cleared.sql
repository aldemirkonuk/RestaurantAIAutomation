-- A house knows when its old exports were cleared.
-- (F-1605 remainder, sim-ledger S226. Additive: one new table, nothing altered,
-- nothing dropped, no backfill.)
--
-- WHY
-- ---
-- The daily retention sweep (`ReportExportsService.sweepExpired`, founder's
-- answer 2026-09-17: 90 days, every house alike) deletes `report_exports` rows
-- and kept no trace per house. So an empty export shelf could only say a
-- sentence that is true either way ("anything before <day> has been cleared"),
-- whether files were removed or none was ever written. Absence was reported as
-- history.
--
-- WHAT
-- ----
-- One row per house per sweep that removed anything from it: how many files,
-- when, and under which keeping time. The gateway writes it from the rows the
-- sweep's own DELETE returned, so the count is what was removed, not a count
-- read before the delete. The shelf reads the newest row: "N older files were
-- removed on <date> under the 90-day rule".
--
-- Not recorded: sweeps before this migration (nothing kept them; no backfill),
-- and the 50-per-house trim, which only runs right after a new export is
-- written and so never empties a shelf.
--
-- A house's sweep record goes when the house goes (ON DELETE CASCADE). Read
-- and written only by the gateway, scoped to the house on the token.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

create table if not exists public.report_export_sweeps (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,
  swept_at       timestamptz not null default now(),
  -- A sweep that removed nothing from a house writes no row for it.
  removed_count  integer not null check (removed_count > 0),
  -- The keeping time in force when the files were removed, so a later change
  -- to the rule does not rewrite what an old record says.
  kept_days      smallint not null check (kept_days > 0)
);

comment on table public.report_export_sweeps is
  'One row per house per retention sweep that removed report exports from it (F-1605): how many, when, under which keeping time. '
  'Written by the gateway from the rows its own DELETE returned. Read by the /reports export shelf. No rows before 2027-01-16.';

create index if not exists idx_report_export_sweeps_house_swept
  on public.report_export_sweeps (restaurant_id, swept_at desc);

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.report_export_sweeps enable row level security;

drop policy if exists report_export_sweeps_service_role on public.report_export_sweeps;
create policy report_export_sweeps_service_role
  on public.report_export_sweeps
  for all to service_role using (true) with check (true);

revoke all on public.report_export_sweeps from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
BEGIN
  IF to_regclass('public.report_export_sweeps') IS NULL THEN
    RAISE EXCEPTION 'report_export_sweeps was not created';
  END IF;

  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.report_export_sweeps');
  IF NOT rls THEN
    RAISE EXCEPTION 'report_export_sweeps has row level security OFF';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'report_export_sweeps'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'report_export_sweeps still holds % client grant(s) for anon/authenticated', grants;
  END IF;

  RAISE NOTICE 'a house knows when its old exports were cleared: report_export_sweeps exists, RLS on, no client grants.';
END
$$;
