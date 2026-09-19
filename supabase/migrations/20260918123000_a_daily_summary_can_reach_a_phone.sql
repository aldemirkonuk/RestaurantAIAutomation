-- A daily summary can reach a phone — sms joins financial_reports' defaults.
--
-- FOUNDER ANSWER, ROW 46 (ADR 0149, 2026-09-18, recorded on train/finish-2):
-- ratifies `daily-sms-summary` and `experiment-ended` as `financial_reports`,
-- and `inventory-audit-reminder` as `calendar_reminders`
-- (`apps/api-gateway/src/communications/recipient-resolver.service.ts`,
-- `NOTIFICATION_SEND_CATEGORY`) — these three were the builder's own call
-- (OD-121) and are now the founder's. That mapping was already correct code;
-- nothing here changes it.
--
-- What row 46 DOES change: `daily-sms-summary` is an SMS-ONLY send, mapped to
-- `financial_reports_channels`, whose default is
-- `ARRAY['email','dashboard']` — no `sms`
-- (`20260805000000_baseline_from_production.sql:3911`). A member at that
-- default therefore could never receive the one send that category exists to
-- carry by SMS. Row 46 adds `sms` to the default.
--
-- This is additive: it changes the DEFAULT applied to a NEW row (or a row
-- whose channel value is later reset to default), never an existing row's
-- already-stored array. A member who has explicitly set their own
-- `financial_reports_channels` keeps exactly what they chose.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

ALTER TABLE public.notification_preferences
  ALTER COLUMN financial_reports_channels
  SET DEFAULT ARRAY['email'::text, 'dashboard'::text, 'sms'::text];

COMMENT ON COLUMN public.notification_preferences.financial_reports_channels IS
  'Channels for financial_reports-category sends (daily SMS summary, weekly '
  'email report, experiment-ended). Default includes sms as of 2026-09-18 '
  '(ADR 0149 row 46) — the daily SMS summary is SMS-only, so a row at the '
  'prior default (email, dashboard) could never receive it. Explicit rows '
  'already saved are unaffected; only the DEFAULT changed.';
