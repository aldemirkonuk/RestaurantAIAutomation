-- A house names its areas, says who works in each and who leads it, and a
-- person can be Away (ADR 0218).
--
-- WHAT THE FOUNDER ASKED FOR (2026-09-21)
-- ----------------------------------------
-- Areas: "no areas for now, but they have labels, classifcation responsible
-- for each so different alerts different notifications for different areas.
-- but if you say their are first is better I'd agree". Area lead: "Yes, cards
-- only". Holiday: "they set away dates, UI shows a visual update maybe
-- crosslined or I let you design it on its name with explanation. with
-- override possible, via either owner/manager account or staff member's
-- account(personal only to that person)".
--
-- THREE TABLES, ALL NEW, NOTHING EXISTING CHANGES SHAPE
-- -----------------------------------------------------
-- 1. `house_areas` — a house's own NAME for each of the six fixed kinds and
--    whether it is switched on. No row means the default name, switched on:
--    nothing is seeded, so a house that never opens the areas sheet has no
--    rows here at all and sees no change.
-- 2. `house_area_members` — one roster person (`team_members.id`) in one
--    area, with the LEAD mark on the same row, so a lead is always a member of
--    the area they lead. Keyed on the roster row, not the account, because the
--    Team page assigns people who have not claimed an account yet; routing
--    passes over a person with no account (nothing can reach them).
-- 3. `house_away` — Away dates, one window per person per house. DATES ONLY:
--    there is no reason column and there never will be one here. KVKK Art. 6
--    makes health data special-category, and a free-text "why" is where it
--    would land (`time_off_requests.reason` is exactly that column, and
--    nothing in this ADR reads it).
--
-- THE HOUSE PROVES ITSELF IN THE KEY
-- ----------------------------------
-- A membership row names its house twice (its own `restaurant_id` and its
-- roster row's), and the composite foreign key makes them agree, so a row can
-- never put house A's cook in house B's bar. The key needs a unique index on
-- `team_members (id, restaurant_id)`; `id` is already the primary key, so the
-- index is redundant as a constraint and exists only to be referenced.
--
-- ACTORS
-- ------
-- Every actor column points at `public.users(user_id)`, the id the JWT
-- carries. `auth.users` and `public.users` are DISJOINT in this database, so a
-- key to `auth.users` would 23503 on the first write and no CI check could
-- catch it (a fresh database has no rows to violate).
--
-- The HOUSE LOG is `system_audit_log`, written by the gateway: every area
-- rename or switch, every membership and lead change, and Away set or ended
-- on someone else's behalf. A person's own Away dates are not written there.
--
-- Additive, idempotent, safe to re-run. RLS on, service_role only, in the SAME
-- file that creates the tables (OD-72 / OD-73). No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 0. The roster row can be referenced together with its house
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_id_restaurant
  ON public.team_members (id, restaurant_id);

-- ---------------------------------------------------------------------------
-- 1. The house's own name for each kind, and whether it is on
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The fixed vocabulary a rule catalogue can point at in code
  -- (`apps/api-gateway/src/areas/area-label.ts`). A house renames a kind; it
  -- never invents one.
  kind TEXT NOT NULL CHECK (
    kind IN ('kitchen', 'bar', 'floor', 'cellar', 'receiving', 'management')
  ),

  name VARCHAR(40) NOT NULL CHECK (btrim(name) <> ''),

  -- Off means: items labelled with this kind are house-wide in this house.
  -- It never hides an item from anybody.
  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  CONSTRAINT uq_house_areas_kind UNIQUE (restaurant_id, kind)
);

-- ---------------------------------------------------------------------------
-- 2. Who works in which area, and who leads it
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_area_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  member_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('kitchen', 'bar', 'floor', 'cellar', 'receiving', 'management')
  ),

  -- The lead mark: acts for everyone on this area's cards (snooze for
  -- everyone, finish, dismiss, undo) and nothing else. It changes no house
  -- role, and it gives no pay and no roster access.
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  -- A person leaves the roster -> their area rows go with them.
  CONSTRAINT fk_house_area_members_member
    FOREIGN KEY (member_id, restaurant_id)
    REFERENCES public.team_members (id, restaurant_id) ON DELETE CASCADE,

  CONSTRAINT uq_house_area_members_member_kind UNIQUE (member_id, kind)
);

-- The routing read: this house's memberships, by kind.
CREATE INDEX IF NOT EXISTS idx_house_area_members_house_kind
  ON public.house_area_members (restaurant_id, kind);

-- ---------------------------------------------------------------------------
-- 3. Away — dates only
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_away (
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The person who is away. Deleting the account deletes the dates: nothing
  -- here is worth keeping about someone who is gone.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- House-local calendar days, both inclusive.
  away_from DATE NOT NULL,
  away_until DATE NOT NULL,

  -- Who set the window: the person, or an owner/manager on their behalf.
  set_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (restaurant_id, user_id),
  CONSTRAINT ck_house_away_order CHECK (away_until >= away_from)
);

-- ---------------------------------------------------------------------------
-- 4. Lock all three down in the same file that creates them
-- ---------------------------------------------------------------------------

ALTER TABLE public.house_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_areas_service_role ON public.house_areas;
CREATE POLICY house_areas_service_role
  ON public.house_areas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_areas FROM anon, authenticated;

ALTER TABLE public.house_area_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_area_members_service_role ON public.house_area_members;
CREATE POLICY house_area_members_service_role
  ON public.house_area_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_area_members FROM anon, authenticated;

ALTER TABLE public.house_away ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_away_service_role ON public.house_away;
CREATE POLICY house_away_service_role
  ON public.house_away
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_away FROM anon, authenticated;

COMMENT ON TABLE public.house_areas IS
  'A house''s own name for each of the six fixed area kinds, and whether it is on. No row = default name, on. ADR 0218. RLS on, service_role only.';
COMMENT ON TABLE public.house_area_members IS
  'One roster person in one area; is_lead marks the area lead (cards only: no role, pay or roster access). ADR 0218. RLS on, service_role only.';
COMMENT ON TABLE public.house_away IS
  'Away dates (inclusive, house-local) per person per house. Dates only, never a reason (KVKK). ADR 0218. RLS on, service_role only.';
