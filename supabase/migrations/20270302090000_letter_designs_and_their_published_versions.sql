-- Letter designs: a house's own mail layouts, and the versions it published.
--
-- ADR 0357 (Letter Bench v4 is the house mail terminal), founder answer 5,
-- 2026-11-02: storage is NEW tables. `communication_templates` stays flat
-- (subject + plain body) and keeps serving the old send paths untouched.
--
-- WHAT A DESIGN IS
-- ----------------
-- An ordered list of typed blocks (ADR 0180 grammar) plus a look and a purpose.
-- `blocks` is the draft the editor autosaves. Publishing copies it into
-- `letter_design_versions` as an immutable snapshot, so a letter sent from
-- version 3 can still be shown as version 3 after the design moves on.
--
-- WHAT IS NOT HERE
-- ----------------
-- No backfill: nothing true to backfill WITH. No send reference yet: the Send
-- tab's `designId` + version snapshot arrives with its own PR (ADR 0357 step 4).
-- No hard delete of a design: `archived_at` hides it, because a filed letter may
-- still point at one of its versions.
--
-- `public.users`, never `auth.users` (the two share zero ids; the JWT carries
-- public.users.user_id). ON DELETE SET NULL: who edited is worth keeping and
-- not worth depending on.
--
-- RLS and the anon/authenticated REVOKE live in this file, with the CREATE
-- (check_new_tables_are_locked_down.py). The gateway reads with the service role
-- and scopes every query by restaurant_id itself.

CREATE TABLE IF NOT EXISTS public.letter_designs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  purpose           text NOT NULL CHECK (purpose IN (
                      'order_confirmation', 'price_query', 'delivery_dispute',
                      'invoice_mismatch', 'promotion_reply')),
  look              text NOT NULL DEFAULT 'paper',
  blocks            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocks) = 'array'),
  published_version integer CHECK (published_version IS NULL OR published_version >= 1),
  created_by        uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  updated_by        uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);

CREATE INDEX IF NOT EXISTS letter_designs_house_idx
  ON public.letter_designs (restaurant_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.letter_design_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id     uuid NOT NULL REFERENCES public.letter_designs(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version >= 1),
  name          text NOT NULL,
  purpose       text NOT NULL,
  look          text NOT NULL,
  blocks        jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'),
  published_by  uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (design_id, version)
);

CREATE INDEX IF NOT EXISTS letter_design_versions_house_idx
  ON public.letter_design_versions (restaurant_id, design_id, version DESC);

-- A version belongs to the same house as its design; refuse a row that says
-- otherwise rather than trusting every caller to get it right.
CREATE OR REPLACE FUNCTION public.letter_design_versions_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A published letter design version is a record and is never edited.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.letter_designs
     WHERE id = NEW.design_id AND restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'A letter design version must belong to the house of its design.';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS letter_design_versions_guard ON public.letter_design_versions;
CREATE TRIGGER letter_design_versions_guard
  BEFORE INSERT OR UPDATE ON public.letter_design_versions
  FOR EACH ROW EXECUTE FUNCTION public.letter_design_versions_guard();

ALTER TABLE public.letter_designs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS letter_designs_service_role ON public.letter_designs;
CREATE POLICY letter_designs_service_role
  ON public.letter_designs FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.letter_designs FROM anon, authenticated;

ALTER TABLE public.letter_design_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS letter_design_versions_service_role ON public.letter_design_versions;
CREATE POLICY letter_design_versions_service_role
  ON public.letter_design_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.letter_design_versions FROM anon, authenticated;

COMMENT ON TABLE public.letter_designs IS
  'A house''s own letter layout: typed blocks (ADR 0180), a look and a purpose; the draft the editor autosaves. ADR 0357. RLS on, service_role only.';
COMMENT ON TABLE public.letter_design_versions IS
  'Immutable published snapshots of a letter design, so a sent letter can still show the version it left from. ADR 0357. RLS on, service_role only.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'letter_designs' AND c.relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'letter_design_versions' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'letter design tables must have row level security on';
  END IF;
END
$$;
