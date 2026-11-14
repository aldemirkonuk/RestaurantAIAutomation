-- A house run by its owner alone can finish its setup (r36 onboarding gap 12).
--
-- The setup's last step is "Invite a team member", and `completed_at` waited
-- for an invite. An owner who works alone kept "Get started 3/4" until they
-- put the whole checklist away. The person can now answer "No team yet":
-- the answer settles the team step while the house has no invite, and an
-- invite, once there, settles it for everyone.
--
-- The answer is the person's, like `checklist_dismissed`, so it lives on the
-- person's own row. A timestamp, not a flag: `completed_at` is when the last
-- step held, and for this step that is when the answer was given. NULL = not
-- answered (or taken back). The gateway reads it on its own, so a database
-- this column has not reached yet answers the setup as before.

ALTER TABLE public.user_onboarding_progress
  ADD COLUMN IF NOT EXISTS no_team_yet_at timestamptz;

COMMENT ON COLUMN public.user_onboarding_progress.no_team_yet_at IS
  'When this person answered "No team yet" on the setup''s invite step; NULL when not answered or taken back. Settles the team step only while the house has no invite.';
