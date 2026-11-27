-- One "your house is waiting" letter per onboarding row (DD-r108-57).
-- sent_at is claimed in one conditional UPDATE (where it is null), so two
-- instances cannot both send; the token hash is the digest's pattern.
-- Version past main when written; renumber at merge if needed.

ALTER TABLE public.user_onboarding_progress
  ADD COLUMN IF NOT EXISTS setup_reminder_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS setup_reminder_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setup_reminder_token_hash text NULL;

-- The hourly sweep reads only rows still waiting for their one letter.
CREATE INDEX IF NOT EXISTS user_onboarding_progress_setup_reminder_due
  ON public.user_onboarding_progress (created_at)
  WHERE setup_reminder_sent_at IS NULL AND menu_uploaded = false AND setup_reminder_opt_out = false;

CREATE UNIQUE INDEX IF NOT EXISTS user_onboarding_progress_setup_reminder_token
  ON public.user_onboarding_progress (setup_reminder_token_hash)
  WHERE setup_reminder_token_hash IS NOT NULL;
