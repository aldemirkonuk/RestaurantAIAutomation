-- A preference is kept once per person per house — and a push subscription
-- is kept somewhere else entirely.
--
-- FOUNDER ANSWER, ROW 39 (ADR 0149, 2026-09-18, recorded on train/finish-2):
-- notification preferences are PER PERSON PER HOUSE, not per person. This
-- settles the fork `20260813090000_fix_remaining_upsert_targets.sql` §3 and
-- `0027-push-recipients-are-not-resolved-here.md` §3 left open: option (b),
-- not (a).
--
-- WHAT WAS ACTUALLY BROKEN
-- -------------------------
-- `notification_preferences` has carried `UNIQUE (restaurant_id, user_id)`
-- since the production baseline
-- (`20260805000000_baseline_from_production.sql:7212-7216`) — this migration
-- does not need to invent that constraint, only guarantee it, because nothing
-- in this repository's live migration set ever dropped it. The 42P10 every
-- save hits is a CODE defect, not a schema one:
-- `NotificationsService.updatePreferences` and `.registerPushSubscription`
-- upsert with `onConflict: "user_id"`, which names no unique index at all, so
-- PostgREST cannot plan the statement. That half of the fix is
-- `apps/api-gateway/src/notifications/notifications.service.ts` and
-- `apps/api-gateway/src/notifications/notifications.controller.ts` in this
-- same commit — a migration cannot repair an ON CONFLICT clause.
--
-- This migration's job is the part that IS schema: guarantee the unique key
-- the corrected `updatePreferences` upsert now targets actually exists (the
-- corrected `registerPushSubscription` targets the new table in §2 instead,
-- on `(user_id, endpoint)`), additively and
-- idempotently, and give the one column that does NOT belong to a house
-- (a browser's push subscription is a property of a DEVICE, not of a
-- restaurant) a home that is not inside a row this migration just made
-- per-house.
--
-- WHY THIS DOES NOT MEASURE PRODUCTION FIRST
-- -------------------------------------------
-- A read-only production probe was not available to this lane. Rather than
-- guess, the guard below is written to FAIL LOUDLY if the assumption is
-- wrong: `ADD CONSTRAINT ... UNIQUE` itself raises (23505) and aborts the
-- migration transaction if any `(restaurant_id, user_id)` pair is already
-- duplicated. Nothing here deletes a row to make a constraint fit — the
-- opposite of that is the point (CLAUDE.md §5b, "write it to fail loudly on
-- duplicates rather than delete anything"). If this migration ever fails on
-- 23505 in a real environment, that is a data problem for a person to look
-- at, not something this file should paper over.
--
-- WHY notification_preferences.push_subscription IS NOT DROPPED
-- ----------------------------------------------------------------
-- Migrations here are additive and never destructive. The column stays,
-- unread by any application code as of this commit (COMMENT below says so),
-- so a rollback of the code loses nothing and a future cleanup can drop it
-- once nothing depends on it remaining.
--
-- WHY THE NEW TABLE IS NOT NAMED `push_subscriptions`
-- -----------------------------------------------------
-- That exact name is settled, permanently, as an abandoned storage model
-- (ADR 0027 / OD-95, `scripts/check_queried_tables_exist.py` KNOWN_MISSING).
-- This is a different table, with a different shape (one row per device per
-- user, no restaurant_id at all — a subscription is not scoped to a house),
-- so it gets a different name: `notification_push_devices`.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. Guarantee the unique key the corrected updatePreferences upsert targets.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.notification_preferences'::regclass
      AND conname = 'notification_preferences_restaurant_id_user_id_key'
  ) THEN
    -- Fails loudly (23505) if any (restaurant_id, user_id) pair is already
    -- duplicated. That failure is the correct outcome here: this migration
    -- must never silently delete a row to make itself pass.
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_restaurant_id_user_id_key
      UNIQUE (restaurant_id, user_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT notification_preferences_restaurant_id_user_id_key
  ON public.notification_preferences IS
  'Founder answer, ADR 0149 row 39 (2026-09-18): preferences are per person '
  'PER HOUSE. The upsert target for NotificationsService.updatePreferences '
  'is (restaurant_id, user_id), taken from the verified token, never from '
  'the request body. Push devices are not kept here: '
  'NotificationsService.registerPushSubscription upserts into '
  'notification_push_devices on (user_id, endpoint).';

-- ---------------------------------------------------------------------------
-- 2. A home for a push subscription that is not inside a per-house row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Actor FK to public.users(user_id), NOT auth.users — the two tables share
  -- no ids in this deployment and the JWT carries public.users.user_id
  -- (CLAUDE.md; ADR 0026).
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- The Web Push endpoint URL. Unique together with user_id: re-subscribing
  -- the same browser updates its keys in place instead of accumulating dead
  -- rows, and PostgREST can infer this pair as an ON CONFLICT target.
  endpoint TEXT NOT NULL,

  -- The full PushSubscription object (endpoint + keys.p256dh + keys.auth), as
  -- the browser's Push API hands it back. endpoint is pulled out as its own
  -- column above because it is what a 410/404 cleanup and a lookup both key
  -- on; storing it twice is cheaper than parsing jsonb on every delivery
  -- attempt.
  subscription JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_notification_push_devices_user_endpoint UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_notification_push_devices_user
  ON public.notification_push_devices (user_id);

ALTER TABLE public.notification_push_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_push_devices_service_role
  ON public.notification_push_devices;
CREATE POLICY notification_push_devices_service_role
  ON public.notification_push_devices
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.notification_push_devices FROM anon, authenticated;

COMMENT ON TABLE public.notification_push_devices IS
  'A browser''s Web Push subscription, per user per device. NOT scoped by '
  'restaurant_id: a subscription belongs to a device, not a house, unlike '
  'notification_preferences (ADR 0149 row 39). Replaces '
  'notification_preferences.push_subscription, which had no unique index it '
  'could be upserted against (42P10 on every write) and is left in place, '
  'unread, rather than dropped. RLS on, service_role only.';

-- ---------------------------------------------------------------------------
-- 3. Defensive backfill. Written to run against a database where the prior
--    writer had already been fixed by some other means; expected to move
--    zero rows here, because registerPushSubscription's onConflict never
--    matched a real index, so no push_subscription write has ever
--    succeeded. ON CONFLICT DO NOTHING: additive, never destructive, and
--    idempotent on re-run.
--
--    [Fixed 2026-09-19, D5/D6 -- notify lane, wave 5.] `notification_preferences
--    .user_id` carries NO foreign key to `public.users` (only
--    `restaurant_id` does -- baseline_from_production.sql:12794-12798), so a
--    row naming a `user_id` absent from `public.users` is not schema-illegal
--    there. `notification_push_devices.user_id` above DOES carry that FK
--    (`ON DELETE CASCADE`, this file, section 2). Without the EXISTS guard
--    below, one such orphaned `notification_preferences` row with a non-null
--    `push_subscription` makes this INSERT...SELECT raise 23503 and abort
--    the whole migration transaction -- for every house, not just the
--    orphan's -- since Supabase runs one migration file as one transaction.
--    Filtering it out is correct, not merely defensive: an orphaned user has
--    no row in `public.users` to ever authenticate as and receive a push to,
--    so its subscription was never deliverable either before or after this
--    migration, and the source row is left untouched (additive, never
--    destructive).
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_push_devices (user_id, endpoint, subscription)
SELECT
  np.user_id,
  np.push_subscription ->> 'endpoint',
  np.push_subscription
FROM public.notification_preferences np
WHERE np.push_subscription IS NOT NULL
  AND np.push_subscription ->> 'endpoint' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users u WHERE u.user_id = np.user_id
  )
ON CONFLICT (user_id, endpoint) DO NOTHING;

COMMENT ON COLUMN public.notification_preferences.push_subscription IS
  'DEPRECATED 2026-09-18 (ADR 0149 row 39). No application code reads or '
  'writes this column any more — see public.notification_push_devices. Left '
  'in place rather than dropped: migrations here are additive, never '
  'destructive.';
