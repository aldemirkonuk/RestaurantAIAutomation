-- a_count_session_groups_a_walk_of_shelves -- the envelope of a stock-take
-- walked on a phone, shelf by shelf. F-1544 (and F-076: a 112-wine cellar was
-- 112 dialogs), lane 1 of the phone stock count decision
-- (p4-scratch/sim-run/arch/decision-phone-stock-count.md; ADR number from the
-- ADR lane).
--
-- THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S224):
--   F1 (b) a session states its period; month close files its counts by it,
--          only for counts made within 6 h after the period ends, the counted
--          moment kept honest. (Lane 5 adds the period; nothing here.)
--   F2 (a) no approval: each shelf line posts through record_stock_count on
--          sync as the person who counted it; the manager signs off
--          completeness; only a duplicate on the same shelf is held.
--   F3 (a) open bottles: tenths on screen, integer ml in the one writer
--          (lane 2; nothing here).
--   F4 (a) a phone-width web page first.
--
-- WHAT A SESSION IS. A grouping and coverage envelope, never a draft layer
-- and never a hold on stock (F2 a). Every line still commits through the one
-- count writer, record_stock_count (ADR 0078), at sync, as its counter. This
-- file adds no writer and does not touch record_stock_count.
--
-- WHAT THIS FILE DOES (additive; no existing row changes, no existing
-- reader names anything new, so a spot count with no session behaves
-- exactly as before):
--
--   1. public.stock_count_sessions -- one walk: house, kind
--      (closing | month_end | full | opening), status open -> signed_off |
--      abandoned (never back to open, trigger), who opened it and when, an
--      optional open_key so a double tap opens one session, not two.
--   2. public.stock_count_session_shelves -- the leaf shelves the walk
--      covers, in walk order, with the claim (who is counting it) and
--      "shelf done" (who said so, when). A shelf never marked done is NOT
--      COUNTED; absence is never read as zero.
--   3. public.stock_count_parked_lines -- an item found that the house does
--      not carry: free text, a count, the shelf, the counter. Never creates
--      an item; review carries it ("carry this") or drops it (lane 4).
--   4. stock_counts.session_id -- nullable, the session a count was made in.
--      NULL on every existing row and on every spot count. Lane 2 has
--      record_stock_count write it; until then nothing writes it.
--
-- SAME HOUSE, BY CONSTRUCTION. A session's shelves, parked lines and counts
-- reference (session_id, restaurant_id) together, so a row of house A cannot
-- name a session of house B (composite foreign keys onto a UNIQUE (id,
-- restaurant_id)). A shelf or parked line's storage location must be its own
-- house's (trigger), the F-291 rule record_stock_count already applies.
--
-- LOCKED DOWN IN THE SAME MIGRATION (OD-72 / OD-73, new_tables_locked_down):
-- RLS on, a service_role policy only, no anon/authenticated grant. The
-- browser reaches these through the gateway's count-sessions routes, which
-- take the house from the verified token (ADR 0141: a write names the house
-- it is for) and scope every statement to it -- the stock_counts /
-- house_tax_rates shape. [Recorded as a correction to the draft, which
-- said "RLS by house": no inventory table in this corpus is read by a
-- client role, and a JWT-claim policy needs a client grant, which is the
-- OD-72 hole. Rejected: an authenticated policy on a restaurant_id claim.]
--
-- Proof (PGlite, full corpus; fails without this migration):
--   supabase/tests/20270113000000_a_count_session_groups_a_walk_of_shelves_test.sql
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  -- A person, never a placeholder. SET NULL so a person's account can go
  -- without taking the house's count history with it (stock_counts.counted_by).
  opened_by       uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  -- The client's id for the act of opening, so a double tap or a retry opens
  -- one session. NULL = the caller gave none.
  open_key        text,
  signed_off_by   uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  signed_off_at   timestamptz,
  abandoned_by    uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  abandoned_at    timestamptz,
  CONSTRAINT stock_count_sessions_kind_known
    CHECK (kind IN ('closing', 'month_end', 'full', 'opening')),
  CONSTRAINT stock_count_sessions_status_known
    CHECK (status IN ('open', 'signed_off', 'abandoned')),
  CONSTRAINT stock_count_sessions_status_has_its_moment
    CHECK (
      (status = 'open' AND signed_off_at IS NULL AND abandoned_at IS NULL)
      OR (status = 'signed_off' AND signed_off_at IS NOT NULL AND abandoned_at IS NULL)
      OR (status = 'abandoned' AND abandoned_at IS NOT NULL AND signed_off_at IS NULL)
    ),
  CONSTRAINT stock_count_sessions_open_key_not_blank
    CHECK (open_key IS NULL OR length(btrim(open_key)) > 0),
  CONSTRAINT stock_count_sessions_id_house UNIQUE (id, restaurant_id),
  CONSTRAINT stock_count_sessions_one_per_open_key UNIQUE (restaurant_id, open_key)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_sessions_house_open
  ON public.stock_count_sessions (restaurant_id, opened_at DESC)
  WHERE status = 'open';

-- A session that has ended stays ended: sign-off and abandon are facts about
-- the walk, and a later "reopen" would make lines listed as arriving after
-- sign-off (ADR 0241) read as if they had arrived during it.
CREATE OR REPLACE FUNCTION public.stock_count_sessions_ended_stays_ended()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This count has ended (%), so it cannot become %.', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'A count keeps its house, its kind and the moment it was opened.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_count_sessions_ended_stays_ended ON public.stock_count_sessions;
CREATE TRIGGER trg_stock_count_sessions_ended_stays_ended
  BEFORE UPDATE ON public.stock_count_sessions
  FOR EACH ROW EXECUTE FUNCTION public.stock_count_sessions_ended_stays_ended();

-- ---------------------------------------------------------------------------
-- 2. The shelves the walk covers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_count_session_shelves (
  session_id     uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  location_id    uuid NOT NULL REFERENCES public.storage_locations(id),
  -- The walk order, 0, 1, 2 ... as the session was opened.
  sort_order     integer NOT NULL,
  claimed_by     uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  claimed_at     timestamptz,
  done_by        uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- When the counter said the shelf was done (the counted moment, not the
  -- moment it reached the server).
  done_at        timestamptz,
  PRIMARY KEY (session_id, location_id),
  CONSTRAINT stock_count_session_shelves_session_same_house
    FOREIGN KEY (session_id, restaurant_id)
    REFERENCES public.stock_count_sessions (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT stock_count_session_shelves_sort_not_negative CHECK (sort_order >= 0),
  CONSTRAINT stock_count_session_shelves_claim_has_a_time
    CHECK (claimed_by IS NULL OR claimed_at IS NOT NULL),
  CONSTRAINT stock_count_session_shelves_done_has_a_time
    CHECK (done_by IS NULL OR done_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_session_shelves_location
  ON public.stock_count_session_shelves (location_id);

-- ---------------------------------------------------------------------------
-- 3. Items found that the house does not carry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_count_parked_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL,
  restaurant_id   uuid NOT NULL,
  location_id     uuid NOT NULL REFERENCES public.storage_locations(id),
  -- What the counter typed: the label as they read it. Never matched to an
  -- item here; nothing is created silently.
  description     text NOT NULL,
  counted_qty     integer NOT NULL,
  photo_path      text,
  counted_by      uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  counted_at      timestamptz NOT NULL,
  -- The phone's id for this line (its outbox entry), so a retry parks it once.
  client_line_id  text NOT NULL,
  state           text NOT NULL DEFAULT 'parked',
  resolved_by     uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  -- The count a carried line became (lane 4, through record_stock_count).
  resolved_count_id uuid REFERENCES public.stock_counts(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_count_parked_lines_session_same_house
    FOREIGN KEY (session_id, restaurant_id)
    REFERENCES public.stock_count_sessions (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT stock_count_parked_lines_description_not_blank
    CHECK (length(btrim(description)) > 0),
  CONSTRAINT stock_count_parked_lines_qty_not_negative CHECK (counted_qty >= 0),
  CONSTRAINT stock_count_parked_lines_key_not_blank
    CHECK (length(btrim(client_line_id)) > 0),
  CONSTRAINT stock_count_parked_lines_state_known
    CHECK (state IN ('parked', 'carried', 'dropped')),
  CONSTRAINT stock_count_parked_lines_resolution_has_a_time
    CHECK ((state = 'parked') = (resolved_at IS NULL)),
  CONSTRAINT stock_count_parked_lines_one_per_key UNIQUE (restaurant_id, client_line_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_parked_lines_session
  ON public.stock_count_parked_lines (session_id);

-- A shelf or a parked line names its own house's storage location (F-291).
CREATE OR REPLACE FUNCTION public.stock_count_session_location_same_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.storage_locations
    WHERE id = NEW.location_id AND restaurant_id = NEW.restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That place is not one of this house''s storage locations.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_count_session_shelves_same_house ON public.stock_count_session_shelves;
CREATE TRIGGER trg_stock_count_session_shelves_same_house
  BEFORE INSERT OR UPDATE OF location_id, restaurant_id ON public.stock_count_session_shelves
  FOR EACH ROW EXECUTE FUNCTION public.stock_count_session_location_same_house();

DROP TRIGGER IF EXISTS trg_stock_count_parked_lines_same_house ON public.stock_count_parked_lines;
CREATE TRIGGER trg_stock_count_parked_lines_same_house
  BEFORE INSERT OR UPDATE OF location_id, restaurant_id ON public.stock_count_parked_lines
  FOR EACH ROW EXECUTE FUNCTION public.stock_count_session_location_same_house();

REVOKE ALL ON FUNCTION public.stock_count_sessions_ended_stays_ended() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stock_count_session_location_same_house() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.stock_count_sessions_ended_stays_ended() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.stock_count_session_location_same_house() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.stock_count_sessions_ended_stays_ended() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.stock_count_session_location_same_house() FROM authenticated';
  END IF;
END;
$grants$;

-- ---------------------------------------------------------------------------
-- 4. A count names the session it was made in (NULL = a spot count).
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_counts ADD COLUMN IF NOT EXISTS session_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_counts_session_same_house'
       AND conrelid = to_regclass('public.stock_counts')
  ) THEN
    -- MATCH SIMPLE: a NULL session_id (every spot count) is not checked.
    ALTER TABLE public.stock_counts
      ADD CONSTRAINT stock_counts_session_same_house
      FOREIGN KEY (session_id, restaurant_id)
      REFERENCES public.stock_count_sessions (id, restaurant_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_stock_counts_session
  ON public.stock_counts (session_id)
  WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Locked down, in the same migration.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_count_sessions_service_role ON public.stock_count_sessions;
CREATE POLICY stock_count_sessions_service_role
  ON public.stock_count_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.stock_count_sessions FROM anon, authenticated;

ALTER TABLE public.stock_count_session_shelves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_count_session_shelves_service_role ON public.stock_count_session_shelves;
CREATE POLICY stock_count_session_shelves_service_role
  ON public.stock_count_session_shelves
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.stock_count_session_shelves FROM anon, authenticated;

ALTER TABLE public.stock_count_parked_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_count_parked_lines_service_role ON public.stock_count_parked_lines;
CREATE POLICY stock_count_parked_lines_service_role
  ON public.stock_count_parked_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.stock_count_parked_lines FROM anon, authenticated;

COMMENT ON TABLE public.stock_count_sessions IS
  'A stock-take walked shelf by shelf (F-1544). A grouping and coverage envelope, never a hold on stock: every line commits through record_stock_count at sync as its counter (founder 2026-10-12 S224, F2 a). Ended (signed_off / abandoned) stays ended. Gateway-only: every statement is scoped to the house on the token.';
COMMENT ON TABLE public.stock_count_session_shelves IS
  'The leaf shelves a count session covers, in walk order, with who claimed each and who said it was done. A shelf with no done_at was not counted; absence is never read as zero.';
COMMENT ON TABLE public.stock_count_parked_lines IS
  'An item found during a count that the house does not carry: free text, a count, the shelf, the counter. Never creates an item; review carries it through the one count writer or drops it.';
COMMENT ON COLUMN public.stock_counts.session_id IS
  'The count session this count was made in, or NULL for a spot count (every row before 20270113000000). Same house as the count, by a composite foreign key.';

-- ---------------------------------------------------------------------------
-- In-file assertions (structural only; catalog, never a live table).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'record_stock_count') <> 1 THEN
    RAISE EXCEPTION 'a count session must not add a second count writer (ADR 0078)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('stock_count_sessions', 'stock_count_session_shelves', 'stock_count_parked_lines')
       AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'every count session table arrives with RLS on';
  END IF;
END;
$$;

COMMIT;
