-- A low-stock warning can reach an inbox — email joins low_stock's defaults.
--
-- FOUNDER ANSWER (19-lane blocking round, AskUserQuestion, 2026-09-19 ~09:20Z,
-- recorded in memory founder-sketch-decisions-106-115.md): "low-stock = add
-- 'email' to low_stock_channels column DEFAULT (small additive migration in
-- the notify PR)." This is that migration.
--
-- WHY THIS WAS NEEDED, NOT OPTIONAL (Q1, ADR 0147's Recipient routing (OD-121)
-- bullet and OPEN-DECISIONS.md's OD-121 entry, both 2026-09-19 -- not a scratch
-- report):
-- `low_stock_channels`' DEFAULT is `ARRAY['sms','push']` — no `email` —
-- and, per OD-121's 2026-09-19 correction, no screen or API can write any of
-- the six per-category channel arrays for any row, old or new
-- (`NotificationsService.updatePreferences`, `notifications.service.ts:
-- 1156-1196`, never touches `low_stock_channels`). Before the 42P10 upsert
-- bug was fixed (row 39, migration 20260918120000), a member with NO
-- preferences row got low-stock email by default (a missing row was treated
-- as "every channel allowed"). Now that 42P10 is fixed, the FIRST TIME a
-- member saves ANY notification setting a real preferences row is created at
-- the column defaults — and from that moment they would have silently
-- stopped getting low-stock email at that house, with no way for them or an
-- admin to turn it back on, absent this migration. Re-measured live in
-- production 2026-09-19 via the Supabase MCP (SELECT only, project
-- exzueerziesmczwlhomd): `notification_preferences` currently holds 0 rows,
-- so nobody has been hit yet — but the first successful save after row 39
-- shipped without this fix would have tripped it.
--
-- Same shape as row 46's `financial_reports_channels` fix (migration
-- 20260918123000): changing the DEFAULT applied to a NEW row (or a row whose
-- channel value is later reset to default), never an existing row's
-- already-stored array, UNLESS that stored array is EXACTLY the prior
-- default -- see the STANDING RULE below, section 2.
--
-- STANDING RULE (Q2, founder answer, same 19-lane blocking round, batch 4,
-- ~2026-09-19 10:00Z, verbatim, recorded in memory
-- founder-sketch-decisions-106-115.md and, durably, in ADR 0147's Recipient
-- routing (OD-121) bullet and OPEN-DECISIONS.md's OD-121 entry, both
-- 2026-09-19): "channel-default standing rule = untouched rows follow a
-- widened default, customised rows never touched." A migration that widens a
-- `*_channels` column's DEFAULT also updates every existing row that still
-- holds EXACTLY the prior default; a row a member customised away from that
-- default is never touched. Section 2 below is the first application of
-- this rule. It was answered shortly after this file's ALTER (section 1) was
-- first written, when production still held 0 `notification_preferences`
-- rows (Supabase MCP, SELECT only, measured 2026-09-19) -- so the backfill
-- moves nothing there today, but the rule is general and applies to every
-- row this or a later migration ever meets, not only today's empty table.
-- `financial_reports_channels` (row 46's earlier widening) is NOT backfilled
-- by this file -- the rule applies to it too, but that column was outside
-- this migration's task; flagged as a follow-up in ADR 0147, not silently
-- actioned here.
--
-- Idempotent and safe to re-run: section 2's UPDATE only ever matches rows
-- still at the old default, so once a row is moved to the new default a
-- second run finds nothing left to match. No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. Widen the DEFAULT so every NEW row (or one reset to default) gets email.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ALTER COLUMN low_stock_channels
  SET DEFAULT ARRAY['sms'::text, 'push'::text, 'email'::text];

COMMENT ON COLUMN public.notification_preferences.low_stock_channels IS
  'Channels for low_stock-category sends. Default includes email as of '
  '2026-09-19 (founder answer, 19-lane blocking round) — a member with no '
  'saved preferences row previously received low-stock email under the '
  '"missing row = every channel allowed" fallback, and would otherwise lose '
  'it silently the first time any preferences row is created for them. '
  'By the founder''s standing rule (batch 4, same round), a row that still '
  'held exactly the prior default (sms, push) was moved to this one by '
  'section 2 below; a row a member had customised away from that default '
  'was left exactly as they set it.';

-- ---------------------------------------------------------------------------
-- 2. Standing rule: move every existing row still at EXACTLY the prior
--    default, and no other row. Postgres array equality is positional and
--    by count, so this can only match a row holding precisely
--    ARRAY['sms','push'] -- not a superset, not a reordering, not NULL. That
--    is intentional: it is the operational meaning of "still holds exactly
--    the old default" from "a row someone customised is never touched".
-- ---------------------------------------------------------------------------
UPDATE public.notification_preferences
  SET low_stock_channels = ARRAY['sms'::text, 'push'::text, 'email'::text]
  WHERE low_stock_channels = ARRAY['sms'::text, 'push'::text];
