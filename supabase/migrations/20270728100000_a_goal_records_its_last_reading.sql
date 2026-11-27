-- A GOAL RECORDS ITS LAST READING (reports lane r2, 2026-11-11).
--
-- analytics_goals.current_value is a cache of the goal's last live reading,
-- written by GoalsService.getGoalProgress. When a later reading was refused
-- (no house time zone, a good with no recorded cost, a read that failed), the
-- column kept the older number, and every reader of the stored row (the
-- reports bench, its export, the recommendations goal rule, the insight feed)
-- showed it as where the goal stands now, beside the desk's "could not be
-- scored". Nothing in the row said when the number was read, either.
--
-- ADDS two nullable columns, no default, no backfill:
--   current_read_at  when the last live reading was taken (or refused);
--   current_unread   the refusal's reason when the last reading was refused,
--                    null when it was read.
-- A row written before this has both null: its age is unknown, and the readers
-- that make a pace claim from a stored row skip it until it is next read.
--
-- Additive only: no existing column, constraint, policy or grant changes. The
-- table's RLS and grants cover the new columns as they cover the rest.

ALTER TABLE public.analytics_goals
  ADD COLUMN IF NOT EXISTS current_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_unread text;

COMMENT ON COLUMN public.analytics_goals.current_read_at IS
  'When the goal''s last live reading was taken or refused (GoalsService.getGoalProgress). Null: not read since this column was added.';
COMMENT ON COLUMN public.analytics_goals.current_unread IS
  'Why the last live reading was refused; null when it was read. While set, current_value is an older reading and is not presented as current.';
