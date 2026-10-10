-- Who opened a published week is kept when they are removed from the roster.
-- F-585 (owner-quarter sim, wave 17, found while fixing F-576).
--
-- WHAT WAS WRONG: `schedule_receipts.member_id` references `team_members(id)`
-- `ON DELETE CASCADE` (baseline `20260805000000_baseline_from_production.sql`
-- :13462, no later migration touched it). Every removal ends in
-- `DELETE FROM team_members` (`TeamService.removeFromHouse`), so removing a
-- person erased the record that they had opened the published week, and the
-- schedule's "who has opened the week" read as if they never had.
--
-- THE FIX: the foreign key is dropped; the column and its values stay. The
-- same shape migration a_servers_sales_outlive_their_removal gave
-- `server_sales.member_id` (F-576) and ADR 0215 gave shifts, leave and
-- credentials (20261201110200/110210): a row that must outlive its person's
-- removal cannot be pinned to the row the removal deletes. SET NULL was not
-- taken: it would lose whose receipt it was, and `uq_schedule_receipts
-- (schedule_id, member_id)` would stop holding one row per person per week.
-- Writes are still made only for the caller's own roster row
-- (`ScheduleService` acknowledge reads the member from the live roster), and
-- the web already names an unknown id "someone no longer on the roster"
-- (TeamOverlays.tsx). The schedule_id key (ON DELETE CASCADE to schedules) is
-- unchanged.
--
-- Additive and idempotent: one constraint dropped (IF EXISTS). No row written,
-- no row deleted.
SET local statement_timeout = '120s';

ALTER TABLE public.schedule_receipts
  DROP CONSTRAINT IF EXISTS schedule_receipts_member_id_fkey;

COMMENT ON COLUMN public.schedule_receipts.member_id IS
  'The roster member who opened the published week. No foreign key to team_members, on purpose (F-585, the F-576 / ADR 0215 shape): removing a person from the roster must not erase that they opened it. Written only for the caller''s own live roster row by the gateway.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.schedule_receipts'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.team_members'::regclass
  ) THEN
    RAISE EXCEPTION 'schedule_receipts still has a foreign key to team_members: a removal would still erase who opened the week';
  END IF;
END
$$;
