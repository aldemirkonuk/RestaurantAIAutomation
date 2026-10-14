-- a_house_keeps_each_tax_basis_answer — every answer a house gives to
-- "do your till prices include tax?" is kept, in order, with its moment
-- (F-1624 remainder, wave 53 sim; ADR 0341).
--
-- WHY
-- ---
-- restaurants.tax_basis holds only the answer in force, and
-- tax_basis_confirmed_at only its moment. A house that answered include, then
-- "added on top", then include again showed one switch day (the last), so the
-- calendar, Settings and the month close could not say which stretch of days
-- each answer covered. ADR 0341 F2 (only from now) is unchanged: no stored
-- check is restamped, and this file writes no pos_checks row.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   1. public.house_tax_basis_answers: one row per answer (house, basis,
--      who, when). The house day an answer takes effect on is read from
--      answered_at on the house's own clock (ADR 0296, houseDayOf), as the
--      switch day already is, so there is one rule for the day, not two.
--   2. An AFTER UPDATE trigger on restaurants appends the row in the same
--      statement that changes the answer, so the record and the history can
--      never disagree. A repeat of the answer in force changes nothing and
--      appends nothing (ADR 0341 §1 "Confirm once").
--   3. Append-only: UPDATE, DELETE and TRUNCATE are refused, except the
--      cascade when the house itself is deleted.
--   4. Locked down: RLS on, service_role only, anon and authenticated revoked.
--
--   5. The answer each house has in force now is kept as its first row, from
--      restaurants (basis, who, when): it is the one answer on record. An
--      answer it replaced before this migration was never kept anywhere and
--      is not invented. No pos_checks row is read or written (F2).
BEGIN;

SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.house_tax_basis_answers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  basis         text NOT NULL,
  answered_by   uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  answered_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT house_tax_basis_answers_basis_is_an_answer
    CHECK (basis IN ('prices_include_tax', 'prices_exclude_tax', 'not_vat_charging'))
);

CREATE INDEX IF NOT EXISTS house_tax_basis_answers_house_when
  ON public.house_tax_basis_answers (restaurant_id, answered_at);

COMMENT ON TABLE public.house_tax_basis_answers IS
  'Every answer a house gave to whether its till prices include tax, append-only, one row per change, written by the restaurants trigger in the same statement as the change. The day an answer takes effect is the house day of answered_at (ADR 0296). Stored checks are never restamped from it (ADR 0341 F2). F-1624.';
COMMENT ON COLUMN public.house_tax_basis_answers.answered_at IS
  'restaurants.tax_basis_confirmed_at of the answer: the moment it was given, and so the switch reports mark.';

CREATE OR REPLACE FUNCTION public.a_tax_basis_answer_is_kept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tax_basis IS DISTINCT FROM OLD.tax_basis
     AND NEW.tax_basis <> 'unset' THEN
    INSERT INTO public.house_tax_basis_answers (restaurant_id, basis, answered_by, answered_at)
    VALUES (NEW.id, NEW.tax_basis, NEW.tax_basis_confirmed_by, NEW.tax_basis_confirmed_at);
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.house_tax_basis_answers_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The house deleted: its foreign key cascades one trigger level down.
  IF pg_trigger_depth() > 1 AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'house_tax_basis_answers is append-only: % is not permitted. A changed answer is a new row.',
    TG_OP;
END
$$;

COMMENT ON FUNCTION public.a_tax_basis_answer_is_kept() IS
  'F-1624. Appends one house_tax_basis_answers row when restaurants.tax_basis changes to an answer, with the confirmation person and moment the same statement wrote.';
COMMENT ON FUNCTION public.house_tax_basis_answers_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on house_tax_basis_answers except the cascade from the house being deleted.';

REVOKE ALL ON FUNCTION public.a_tax_basis_answer_is_kept() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.house_tax_basis_answers_append_only() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_tax_basis_answer_is_kept() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.house_tax_basis_answers_append_only() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.a_tax_basis_answer_is_kept() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.house_tax_basis_answers_append_only() FROM authenticated';
  END IF;
END;
$grants$;

DROP TRIGGER IF EXISTS a_tax_basis_answer_is_kept ON public.restaurants;
CREATE TRIGGER a_tax_basis_answer_is_kept
  AFTER UPDATE OF tax_basis ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.a_tax_basis_answer_is_kept();

DROP TRIGGER IF EXISTS trg_house_tax_basis_answers_append_only ON public.house_tax_basis_answers;
CREATE TRIGGER trg_house_tax_basis_answers_append_only
  BEFORE UPDATE OR DELETE ON public.house_tax_basis_answers
  FOR EACH ROW EXECUTE FUNCTION public.house_tax_basis_answers_append_only();

DROP TRIGGER IF EXISTS trg_house_tax_basis_answers_no_truncate ON public.house_tax_basis_answers;
CREATE TRIGGER trg_house_tax_basis_answers_no_truncate
  BEFORE TRUNCATE ON public.house_tax_basis_answers
  FOR EACH STATEMENT EXECUTE FUNCTION public.house_tax_basis_answers_append_only();

INSERT INTO public.house_tax_basis_answers (restaurant_id, basis, answered_by, answered_at)
SELECT r.id, r.tax_basis, r.tax_basis_confirmed_by, r.tax_basis_confirmed_at
  FROM public.restaurants r
 WHERE r.tax_basis <> 'unset'
   AND NOT EXISTS (SELECT 1 FROM public.house_tax_basis_answers a WHERE a.restaurant_id = r.id);

ALTER TABLE public.house_tax_basis_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_tax_basis_answers_service_role ON public.house_tax_basis_answers;
CREATE POLICY house_tax_basis_answers_service_role
  ON public.house_tax_basis_answers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_tax_basis_answers FROM anon, authenticated;

COMMIT;
