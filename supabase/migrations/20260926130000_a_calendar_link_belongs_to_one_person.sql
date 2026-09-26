-- A calendar link belongs to one person (ADR 0111, review trail 2026-09-21).
--
-- The founder, 2026-09-21, verbatim:
--   "every manager, staff and their labeled taskforces/areas, owners have
--    different calendar subscriptions, they can connect their own. Soit should
--    be personalized"
-- confirmed on this example:
--   "Ayse (bar staff) connects HER OWN link to her phone. It shows only her
--    shifts and bar-area events (deliveries to the bar, bar tasks). The owner
--    connects his own link, which shows everything, or just the parts he picks.
--    When Ayse leaves, only her link stops; nobody else re-subscribes."
-- -> "Yes, personal links".
--
-- Until today a house had ONE feed address, `restaurants.calendar_ical_token`,
-- which served the whole house calendar to anyone holding it. This file:
--
--   1. adds `calendar_feed_links`: one row per person per house, at most one
--      live (partial unique index), the secret stored only as a SHA-256 hash;
--   2. retires every existing shared house link, writing one
--      `system_audit_log` row per house it switched off.
--
-- What it deliberately does NOT do:
--   - drop `restaurants.calendar_ical_token`. Additive only; the column is no
--     longer read by any code (the feed looks up `calendar_feed_links`), and a
--     later lane can drop it once this has been live.
--   - revoke a link when a person leaves. The feed re-reads the person's
--     membership on every request (`calendar-links.service.ts`), so removal
--     stops the link at once without a trigger on the membership tables.
--
-- Idempotent: CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS, and the
-- retirement only touches rows that still carry a token, so a second run
-- changes nothing and files nothing.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One person's link to one house's calendar
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_feed_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The house whose calendar this link reads. Tenancy for an inbound feed
  -- request comes from THIS column, never from anything in the request.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The person the link belongs to, and the only person who can create it.
  -- `public.users.user_id` (the id the JWT carries), never an auth.users id.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- SHA-256 of the secret in the address, lowercase hex. Never the secret: it
  -- is shown once, when it is made, the way `mcp_server_credentials` keeps its
  -- keys (20260912200000).
  token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  -- An owner's pick of what the link shows. NULL = everything their role may
  -- see. Only ever narrows: it cannot add anything the role does not allow.
  categories TEXT[] CHECK (
    categories IS NULL OR categories <@ ARRAY[
      'shifts', 'deliveries', 'orders', 'meetings', 'stock_counts',
      'tastings', 'reminders', 'suppliers', 'holidays', 'other'
    ]::TEXT[]
  ),

  -- When the person first connected, and when the CURRENT secret was issued
  -- (a rotation replaces the secret on this row and moves only issued_at).
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- When a calendar app last read this secret. NULL means it never has; it is
  -- deliberately not defaulted to issued_at, and a rotation resets it.
  last_fetched_at TIMESTAMPTZ,

  -- Soft revoke. A revoked row is kept so the register can say who stopped it.
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  revoke_reason TEXT CHECK (
    revoke_reason IS NULL
    OR revoke_reason IN ('revoked_by_self', 'revoked_by_manager')
  ),
  CONSTRAINT calendar_feed_links_revoke_pair
    CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

-- The feed's lookup: a presented secret, hashed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_feed_links_token_hash
  ON public.calendar_feed_links (token_hash);

-- One live link per person per house.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_feed_links_live_person
  ON public.calendar_feed_links (restaurant_id, user_id)
  WHERE revoked_at IS NULL;

-- The owner/manager register of who has connected.
CREATE INDEX IF NOT EXISTS idx_calendar_feed_links_house_live
  ON public.calendar_feed_links (restaurant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.calendar_feed_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_feed_links_service_role
  ON public.calendar_feed_links;
CREATE POLICY calendar_feed_links_service_role
  ON public.calendar_feed_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.calendar_feed_links FROM anon, authenticated;

COMMENT ON TABLE public.calendar_feed_links IS
  'Personal calendar (iCal) links: one live row per person per house (ADR 0111, 2026-09-21). token_hash is SHA-256 hex of the secret; the secret is shown once and not stored. What the feed serves is decided at read time from the person''s CURRENT role in the house, so a person removed from the house is refused at once. RLS on, service_role only.';

-- ---------------------------------------------------------------------------
-- 2. Retire the shared house link, one audit row per house it stops
-- ---------------------------------------------------------------------------

WITH retired AS (
  UPDATE public.restaurants
     SET calendar_ical_token = NULL
   WHERE calendar_ical_token IS NOT NULL
  RETURNING id
)
INSERT INTO public.system_audit_log (
  actor_type, actor_id, action, entity_type, entity_id, changes,
  restaurant_id, reason
)
SELECT
  'system',
  NULL,
  'calendar_ical_house_link_retired',
  'restaurant',
  retired.id,
  jsonb_build_object(
    'credential', 'calendar_ical_token',
    'migration', '20260926130000'
  ),
  retired.id,
  'Founder 2026-09-21: every person connects their own calendar link, so the shared house link was switched off.'
FROM retired;

COMMIT;
