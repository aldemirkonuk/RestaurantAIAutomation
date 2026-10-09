-- A server's recorded sales are kept when they are removed from the roster.
-- F-576 (owner-quarter sim, wave 17, team-and-roles-lifecycle finding 1).
--
-- WHAT WAS WRONG: `server_sales.member_id` references `team_members(id)`
-- `ON DELETE CASCADE` (baseline `20260805000000_baseline_from_production.sql`
-- :13478, no later migration touched it). Every removal ends in
-- `DELETE FROM team_members` (`TeamService.removeFromHouse`), so removing a
-- server deleted every service they had recorded, in the same statement. The
-- house benchmark every other server is compared to
-- (`PerformanceService.getMemberPerformance`, the last 200 services of the
-- house) lost those services with them.
--
-- THE FIX: the foreign key is dropped; the column and its values stay. The
-- SAME shape ADR 0215 gave `shifts.member_id` and `time_off_requests.member_id`
-- (20261201110200) and `team_certifications.member_id` (20261201110210), and
-- that `team_member_wage_changes.member_id` (20261201110000) never had: a row
-- that must outlive its person's removal cannot be pinned to the row the
-- removal deletes. SET NULL was not taken: it would keep the money but lose
-- whose services they were, and `uq_server_sales (restaurant_id, member_id,
-- service_date)` would stop holding one row per server per day for them. New
-- writes are still checked against the live roster in the gateway
-- (`assertMemberInRestaurant` in `PerformanceService.ingest`, and
-- `ingestBatch` keeps only rows whose person is on the roster), where every
-- other member reference of this kind is checked.
--
-- NOT DONE HERE: these rows are not put on the five-year departure clock
-- (ADR 0215's purge). Sales are the house's takings, not the person's record,
-- and nobody has decided they end; they are kept, as before the removal.
--
-- Additive and idempotent: one constraint dropped (IF EXISTS). No row written,
-- no row deleted.
SET local statement_timeout = '120s';

ALTER TABLE public.server_sales
  DROP CONSTRAINT IF EXISTS server_sales_member_id_fkey;

COMMENT ON COLUMN public.server_sales.member_id IS
  'The server these sales are recorded for. No foreign key to team_members, on purpose (F-576, the ADR 0215 shape): removing a person from the roster must not delete the services they recorded. Checked against the live roster by the gateway at write time (assertMemberInRestaurant), not by this column.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.server_sales'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.team_members'::regclass
  ) THEN
    RAISE EXCEPTION 'server_sales still has a foreign key to team_members: a removal would still take the sales';
  END IF;
END
$$;
