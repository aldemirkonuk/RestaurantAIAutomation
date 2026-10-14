-- Who a crew note was sent to, and how it reached them, is kept when they are
-- removed from the roster. F-1701 (owner-quarter sim, wave 56).
--
-- WHAT WAS WRONG: `team_note_recipients.member_id`
-- (20260904180000_a_crew_note_is_a_record.sql:95-96) and
-- `team_note_deliveries.member_id` (20260905210000_a_house_sends_in_its_own_name
-- .sql:323-324) reference `team_members(id)` `ON DELETE CASCADE`, and no later
-- migration touched either. Every removal ends in `DELETE FROM team_members`
-- (`TeamService.removeFromHouse`), so removing a person erased their recipient
-- and delivery rows on every past note, and the note's "Sent to N / X of N
-- opened" (`NotesService` addressedCount/openedCount, counted from the rows
-- that survive) was rewritten after the fact. The table's own header says the
-- recipients are the roster AT THE TIME precisely so this cannot happen.
--
-- THE FIX: both foreign keys are dropped; the columns and their values stay.
-- The same shape who_opened_the_week_outlives_their_removal gave
-- `schedule_receipts` (F-585), a_servers_sales_outlive_their_removal gave
-- `server_sales` (F-576) and ADR 0215 gave shifts. SET NULL was not taken: it
-- would lose who the row was about and break the one-row-per-person unique
-- indexes. Rows are written only from the live roster by the gateway, and the
-- web already names an unknown id "no longer on the roster" (TeamOverlays.tsx).
-- The note_id keys (ON DELETE CASCADE to team_notes) are unchanged, and
-- `house_away_held` keeps its cascade: it is a pending send, not a record.
--
-- Additive and idempotent: two constraints dropped (IF EXISTS). No row written,
-- no row deleted.
SET local statement_timeout = '120s';

ALTER TABLE public.team_note_recipients
  DROP CONSTRAINT IF EXISTS team_note_recipients_member_id_fkey;
ALTER TABLE public.team_note_deliveries
  DROP CONSTRAINT IF EXISTS team_note_deliveries_member_id_fkey;

COMMENT ON COLUMN public.team_note_recipients.member_id IS
  'The roster member the note was addressed to at the time. No foreign key to team_members, on purpose (F-1701, the F-585 / ADR 0215 shape): removing a person must not rewrite who a past note was sent to.';
COMMENT ON COLUMN public.team_note_deliveries.member_id IS
  'The roster member this delivery was for. No foreign key to team_members, on purpose (F-1701, the F-585 / ADR 0215 shape): removing a person must not erase how a past note reached them.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid IN ('public.team_note_recipients'::regclass,
                          'public.team_note_deliveries'::regclass)
       AND c.contype = 'f'
       AND c.confrelid = 'public.team_members'::regclass
  ) THEN
    RAISE EXCEPTION 'a crew note''s recipients or deliveries still reference team_members: a removal would still rewrite who it was sent to';
  END IF;
END
$$;
