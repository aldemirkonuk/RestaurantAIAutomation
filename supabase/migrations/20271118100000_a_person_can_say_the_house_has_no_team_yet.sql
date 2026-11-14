-- A house run by its owner alone can finish its setup (r36 onboarding gap 12).
-- completed_at waited for an invite; the person can now answer "No team yet".
-- The answer is the person's own (like checklist_dismissed) and settles the
-- team step only while the house has no invite. A time, not a flag, because
-- completed_at is when the last step held. NULL = not answered or taken back.

ALTER TABLE public.user_onboarding_progress
  ADD COLUMN IF NOT EXISTS no_team_yet_at timestamptz;

COMMENT ON COLUMN public.user_onboarding_progress.no_team_yet_at IS
  'When this person answered "No team yet" on the setup''s invite step; NULL when not answered or taken back.';
