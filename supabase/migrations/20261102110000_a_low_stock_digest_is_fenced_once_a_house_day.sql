-- PR #488, founder item 74 (2026-09-27), verbatim "Own fence column
-- (Recommended)": a separate "digest sent on <house date>" record, stamped
-- whenever a low-stock digest email is ATTEMPTED, independent of the inbox
-- row and of the held-queue ledger. One additive migration.
--
-- WHY. Under same-day catch-up (founder item 70) every hourly tick after a
-- house's digest hour is "due", so the once-a-day fence carries the whole
-- weight of "never double-send". Until this migration that fence was
-- inventory_alert_state.last_digest_at, and #486's rule stamps it only when
-- the digest wrote an inbox row. A digest that wrote none (deduped, failed,
-- a house with no members) was fenced only by one process's memory, so a
-- restart or a second gateway replica could email it again the same day
-- (v3.0-TECH-DEBT TD-2026-09-27-LOW-STOCK-DIGEST-UNTOLD-NOT-FENCED).
--
-- WHY A TABLE, NOT A COLUMN ON restaurants. The founder's words name a
-- column of its own; this is that column, in a one-row-per-house table.
-- restaurants carries `update_restaurants_updated_at BEFORE UPDATE`
-- (baseline_from_production.sql), and restaurants.updated_at is read as
-- "when this house's row last changed" (operating-hours.service.ts returns it
-- as the hours' updatedAt; organizations.service.ts selects it). A daily
-- digest write there would move that date every day for a reason that is not
-- a change to the house.
--
-- HOW THE GATEWAY USES IT (low-stock-alerts.service.ts, runDigestSweepAt):
--   read   one batched SELECT per tick; a failed read SKIPS every due house.
--   judge  attempted_at read in the house's CURRENT zone: on or after today's
--          house date means already attempted today, so no send.
--   claim  compare-and-set BEFORE the email: INSERT when no row was read (the
--          primary key lets one of two concurrent inserts win), else UPDATE
--          ... WHERE attempted_at = <the value read>. A lost or failed claim
--          SKIPS; only the run holding the claim sends.
--
-- sent_on is the house-local date the claim was for, in the zone the house
-- had at that tick. attempted_at is the sweep's hour tick (it can run up to
-- 29 minutes ahead of the clock on a late run, by design: it is on the same
-- house date as sent_on). The compare uses attempted_at, so a house whose
-- zone changes is judged in its new zone.
--
-- BACKFILL. A house already sent today under the old fence must not be sent
-- again the moment the new code starts. Each house with a last_digest_at gets
-- a row from its newest stamp: attempted_at = that stamp, sent_on = its date
-- in the house's zone when Postgres knows the zone name, else UTC (the
-- gateway's own fallback, LOW_STOCK_DIGEST_FALLBACK_ZONE). sent_on is not
-- what the gateway compares, so a zone Node knows and Postgres does not
-- changes only that informational date. ON CONFLICT DO NOTHING: re-running
-- this file never moves a fence the gateway has already written.
--
-- Additive and idempotent: IF NOT EXISTS throughout; no existing row is
-- updated or deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.low_stock_digest_fence (
  restaurant_id UUID PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sent_on DATE NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.low_stock_digest_fence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS low_stock_digest_fence_service_role
  ON public.low_stock_digest_fence;
CREATE POLICY low_stock_digest_fence_service_role
  ON public.low_stock_digest_fence
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.low_stock_digest_fence FROM anon, authenticated;
-- Stated, not inherited: the gateway reads and writes with the service role.
GRANT SELECT, INSERT, UPDATE ON public.low_stock_digest_fence TO service_role;

COMMENT ON TABLE public.low_stock_digest_fence IS
  'The low-stock digest''s once-a-day fence, one row per house (founder item 74, 2026-09-27: "Own fence column (Recommended)"). Claimed compare-and-set BEFORE the digest email is attempted, independent of the inbox row and of inventory_alert_state.last_digest_at. RLS on, service_role only.';
COMMENT ON COLUMN public.low_stock_digest_fence.sent_on IS
  'The house-local date the last digest attempt was for, in the zone the house had at that tick.';
COMMENT ON COLUMN public.low_stock_digest_fence.attempted_at IS
  'The sweep hour tick that claimed sent_on. The gateway reads it in the house''s current zone to decide "already attempted today", and compares against it to claim the next date.';

INSERT INTO public.low_stock_digest_fence (restaurant_id, sent_on, attempted_at)
SELECT s.restaurant_id,
       (s.last_at AT TIME ZONE z.zone)::date,
       s.last_at
FROM (
  SELECT restaurant_id, max(last_digest_at) AS last_at
  FROM public.inventory_alert_state
  WHERE last_digest_at IS NOT NULL
  GROUP BY restaurant_id
) s
JOIN public.restaurants r ON r.id = s.restaurant_id
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN EXISTS (
             SELECT 1 FROM pg_catalog.pg_timezone_names n
             WHERE n.name = btrim(r.timezone)
           ) THEN btrim(r.timezone)
           ELSE 'UTC'
         END AS zone
) z
ON CONFLICT (restaurant_id) DO NOTHING;

COMMIT;
