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
-- This changes the DEFAULT applied to a NEW row (or a row whose channel
-- value is later reset to default) -- UNLESS an existing row still holds
-- EXACTLY the prior default, see the STANDING RULE below, section 2. A
-- member who has customised their own `financial_reports_channels` to
-- anything else keeps exactly what they chose.
--
-- STANDING RULE (founder answer, 19-lane blocking round, batch 4, ~2026-09-19
-- 10:00Z, verbatim, recorded in memory founder-sketch-decisions-106-115.md
-- and, durably, in ADR 0147's Recipient routing (OD-121) bullet and
-- OPEN-DECISIONS.md's OD-121 entry, both 2026-09-19): "channel-default
-- standing rule = untouched rows follow a widened default, customised rows
-- never touched." A migration that widens a `*_channels` column's DEFAULT
-- also updates every existing row that still holds EXACTLY the prior
-- default; a row a member customised away from that default is never
-- touched. Section 2 below is the second application of this rule --
-- `20260925160700_a_low_stock_warning_can_reach_an_inbox.sql`'s section 2,
-- for `low_stock_channels`, was the first.
--
-- [Added 2026-09-21, CLAUDE.md §5b -- this file's ALTER (section 1) was
-- written 2026-09-18, a day before the standing rule above was answered.
-- The backfill it implies was then flagged as a follow-up rather than built
-- -- ADR 0147's Recipient routing bullet and 2026-09-19 changelog row and
-- OPEN-DECISIONS.md's OD-121 entry all said so -- because backfilling this
-- column was outside that pass's task. This lane owns the column, so
-- section 2 below closes that follow-up instead of leaving it for whichever
-- lane touches this column next; all three records are bracket-corrected in
-- place, dated, to point here.] Production held 0
-- `notification_preferences` rows when last measured, 2026-09-19 (Supabase
-- MCP, SELECT only) -- not re-measured by this pass -- so the backfill likely
-- moves nothing there today; the rule is recorded as standing regardless,
-- for every row this or a later migration ever meets.
--
-- Idempotent and safe to re-run: section 2's UPDATE only ever matches rows
-- still at the old default, so once a row is moved to the new default a
-- second run finds nothing left to match. No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. Widen the DEFAULT so every NEW row (or one reset to default) gets sms.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ALTER COLUMN financial_reports_channels
  SET DEFAULT ARRAY['email'::text, 'dashboard'::text, 'sms'::text];

COMMENT ON COLUMN public.notification_preferences.financial_reports_channels IS
  'Channels for financial_reports-category sends (daily SMS summary, weekly '
  'email report, experiment-ended). Default includes sms as of 2026-09-18 '
  '(ADR 0149 row 46) — the daily SMS summary is SMS-only, so a row at the '
  'prior default (email, dashboard) could never receive it. By the '
  'founder''s standing rule (batch 4, same round, applied here 2026-09-21), '
  'a row that still held exactly the prior default (email, dashboard) was '
  'moved to this one by section 2 below; a row a member had customised away '
  'from that default was left exactly as they set it.';

-- ---------------------------------------------------------------------------
-- 2. Standing rule: move every existing row still at EXACTLY the prior
--    default, and no other row. Postgres array equality is positional and
--    by count, so this can only match a row holding precisely
--    ARRAY['email','dashboard'] -- not a superset, not a reordering, not
--    NULL. That is intentional: it is the operational meaning of "still
--    holds exactly the old default" from "a row someone customised is never
--    touched".
-- ---------------------------------------------------------------------------
UPDATE public.notification_preferences
  SET financial_reports_channels = ARRAY['email'::text, 'dashboard'::text, 'sms'::text]
  WHERE financial_reports_channels = ARRAY['email'::text, 'dashboard'::text];
