-- A note or message sent to someone who is Away waits until they are back, and
-- one Away window is at most 366 days in the schema as well as the gateway
-- (ADR 0218, round 2).
--
-- WHAT THE FOUNDER PICKED (2026-09-21)
-- ------------------------------------
-- He answered the lane's seven questions with "Take all seven": the options he
-- picked, bundled, not his own words for each. The two this file serves:
--   (3) a note or message sent to one person who is Away waits until they are
--       back (held, delivered on return), and the sender sees "away until
--       <date>";
--   (6) Away lasts at most 366 days.
--
-- WHAT CHANGES
-- ------------
-- 1. `house_away_held` — NEW. One row per (item, person) that is waiting for a
--    person who is Away. The gateway writes it at send time and deletes it
--    when it delivers (or when the person has left the house). Two kinds:
--      - `team_note`: points at the note and the roster row; the note's words
--        stay on `team_notes`, where they already are, so nothing is copied;
--      - `team_message`: a manager's message to named people, which has no
--        record of its own (`POST …/team/broadcast`), so its title and body
--        are kept HERE, and only until it is delivered. KVKK: the minimum —
--        the words exist in this table only while they wait, and no reason for
--        anybody's Away is stored anywhere.
-- 2. `team_note_deliveries.state` gains one value, `held_away`: the receipt a
--    sender reads while the note waits ("Away until 28 Sep …"). It is
--    rewritten with what happened when the note is delivered. Widening a CHECK
--    to admit one more value removes nothing that was allowed before.
-- 3. `house_away` gains `ck_house_away_at_most_366_days`: both days inclusive,
--    so `away_until - away_from` is at most 365. The table is new in this same
--    PR (20260921170300) and holds no rows anywhere, so the check is VALID.
--
-- ACTORS: `user_id` and `sent_by` point at `public.users(user_id)`, the id the
-- JWT carries (`auth.users` is disjoint). THE HOUSE PROVES ITSELF IN THE KEY:
-- a held note names its house twice and composite keys make them agree with
-- the note's house and the roster row's house.
--
-- Additive, idempotent, safe to re-run. RLS on, service_role only, in the SAME
-- file that creates the table (OD-72 / OD-73). No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 0. The note can be referenced together with its house
-- ---------------------------------------------------------------------------

-- `id` is already the primary key; the index exists only to be referenced.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_notes_id_restaurant
  ON public.team_notes (id, restaurant_id);

-- ---------------------------------------------------------------------------
-- 1. What waits for a person who is Away
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_away_held (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The person it waits for. A deleted account is owed nothing.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN ('team_note', 'team_message')),

  -- `team_note` only. Deleting the note or the roster row deletes the hold.
  note_id UUID,
  member_id UUID,

  -- `team_message` only: its words, kept only until it is delivered.
  title TEXT,
  body TEXT,
  -- Which of the product's own channels the sender asked for (inbox, push).
  channels TEXT[] NOT NULL DEFAULT '{}',

  -- Who sent it. Kept so the release can be traced; SET NULL with the account.
  sent_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  -- The last Away day when it was held — what the sender was told.
  away_until DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A release claims a row before it delivers and deletes it after; a claim
  -- older than the gateway's stale limit may be taken over after a crash.
  claimed_at TIMESTAMPTZ,

  CONSTRAINT fk_house_away_held_note
    FOREIGN KEY (note_id, restaurant_id)
    REFERENCES public.team_notes (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT fk_house_away_held_member
    FOREIGN KEY (member_id, restaurant_id)
    REFERENCES public.team_members (id, restaurant_id) ON DELETE CASCADE,

  -- Each kind carries exactly what it needs and nothing of the other's.
  CONSTRAINT ck_house_away_held_shape CHECK (
    (kind = 'team_note'
       AND note_id IS NOT NULL AND member_id IS NOT NULL
       AND title IS NULL AND body IS NULL)
    OR
    (kind = 'team_message'
       AND note_id IS NULL AND member_id IS NULL
       AND body IS NOT NULL AND btrim(body) <> '')
  )
);

-- One hold per note per person: a retried send cannot queue it twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_house_away_held_note_member
  ON public.house_away_held (note_id, member_id)
  WHERE kind = 'team_note';

-- The release reads by house and person.
CREATE INDEX IF NOT EXISTS idx_house_away_held_house_user
  ON public.house_away_held (restaurant_id, user_id);

ALTER TABLE public.house_away_held ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_away_held_service_role ON public.house_away_held;
CREATE POLICY house_away_held_service_role
  ON public.house_away_held
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_away_held FROM anon, authenticated;

COMMENT ON TABLE public.house_away_held IS
  'A note or message waiting for a person who is Away (ADR 0218, round 2): delivered and deleted when they are back, deleted if they leave the house first. A message''s words live here only while it waits. RLS on, service_role only.';

-- ---------------------------------------------------------------------------
-- 2. The receipt that says a note is waiting
-- ---------------------------------------------------------------------------

ALTER TABLE public.team_note_deliveries
  DROP CONSTRAINT IF EXISTS team_note_deliveries_state_check;
ALTER TABLE public.team_note_deliveries
  ADD CONSTRAINT team_note_deliveries_state_check CHECK (state IN (
    'delivered',
    'accepted_by_service',
    'no_device_registered',
    'no_consent',
    'no_sender',
    'declined',
    'read_failed',
    'failed',
    'held_away'             -- the person is Away; it waits (ADR 0218)
  ));

-- ---------------------------------------------------------------------------
-- 3. One Away window is at most 366 days, both ends inclusive
-- ---------------------------------------------------------------------------

ALTER TABLE public.house_away
  DROP CONSTRAINT IF EXISTS ck_house_away_at_most_366_days;
ALTER TABLE public.house_away
  ADD CONSTRAINT ck_house_away_at_most_366_days
  CHECK (away_until - away_from <= 365);

-- ---------------------------------------------------------------------------
-- 4. Assertions: a migration that cannot prove it applied reports absence as
--    health.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'house_away_held' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'house_away_held must exist with row level security on';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_note_deliveries_state_check'
      AND pg_get_constraintdef(oid) LIKE '%held_away%'
  ) THEN
    RAISE EXCEPTION 'team_note_deliveries.state must admit held_away';
  END IF;
  -- A state check under any OTHER name would still refuse the new value.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.team_note_deliveries'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%state%'
      AND pg_get_constraintdef(oid) NOT LIKE '%held_away%'
  ) THEN
    RAISE EXCEPTION 'another CHECK on team_note_deliveries.state still refuses held_away';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_house_away_at_most_366_days'
  ) THEN
    RAISE EXCEPTION 'house_away must refuse a window longer than 366 days';
  END IF;
END $$;
