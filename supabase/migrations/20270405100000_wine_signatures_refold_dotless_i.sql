-- Recompute the stored wine signature hashes the dotless-ı fold changed, and
-- never merge two wines to do it.
--
-- WHY
--
-- wine_names_fold_turkish_dotless_i made public.wine_normalize_text fold "ı"
-- to "i" (QA round 1, B-1) and refreshed normalized_name / normalized_producer.
-- It left master_wine_library.signature_hash alone, so a row stored before it
-- -- "Yakut / Kavaklıdere" keyed as "kavakl dere" -- still holds the old hash,
-- while a new "KAVAKLIDERE" invoice line or a fresh "Kavaklıdere" menu insert
-- hashes under the new rule and misses it on the signature leg of
-- match_library_wine (QA round 5, #785). The same hash is copied into
-- master_wine_library_submissions.signature_hash,
-- restaurant_wine_roster.signature_hash and menu_changes.wine_signature_hash,
-- which are joined back to the library on it.
--
-- WHAT
--
-- For every live master_wine_library row whose identity fields hold an "ı"
-- and whose stored hash differs from the one its own fields give now (the
-- rows v_signature_drift lists, with the shared or the venue-scoped formula
-- as the row requires), oldest first:
--
--   1. If no other row holds the new hash, the row takes it, and every copy of
--      its old hash in submissions, menu_changes and the roster moves with it.
--   2. If another row already holds the new hash, NOTHING is written to either
--      row. The later row keeps its old hash and the pair is written to
--      public.wine_signature_refold_review (held_by = the row holding the new
--      hash). Two rows meeting on one hash after the fold are the duplicate
--      the fold exists to expose; joining them is a merge decision
--      (merge_library_wines), which a migration must not take.
--   3. A roster row whose venue already has a row under the new hash keeps its
--      old hash (uq_roster_restaurant_hash would refuse it) and is written to
--      the review table with held_by = that venue's row.
--
-- "Oldest first" means the earliest row (created_at, id) gets the folded hash
-- when two stored ı-rows meet on it; when the hash is already held by a row
-- that was never wrong (an all-capitals "KAVAKLIDERE" stored under the old
-- rule hashes the same as under the new one), the stored ı-row keeps its old
-- hash whatever its age: a row that is already correct is never rewritten.
--
-- Not touched: rows with deleted_at set (v_signature_drift leaves them out;
-- they still hold their hashes for the UNIQUE index, so they can be held_by),
-- rows whose signature_hash is NULL (left NULL on purpose as duplicates awaiting
-- a merge, 20260813020000_fix_signature_upsert_conflict_target), and drift
-- that has nothing to do with "ı" (fn_repair_signature_hashes is for that).
--
-- IDEMPOTENT
--
-- A second run finds the moved rows no longer drifting, and the held-back rows
-- drifting still: it writes nothing to them and the review rows already exist
-- (UNIQUE (table_name, row_id, folded_hash), ON CONFLICT DO NOTHING). The
-- passes repeat until one moves nothing, so a row held back only because an
-- older ı-row still sat on its new hash gets it once that row moves.
--
-- Measured in PGlite 0.5.8 (PostgreSQL 18.3) over every migration before this
-- one, superuser, Supabase platform stubbed. Not run against production; how
-- many rows it moves there is not measured.

CREATE TABLE IF NOT EXISTS public.wine_signature_refold_review (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   text NOT NULL
    CHECK (table_name IN ('master_wine_library', 'restaurant_wine_roster')),
  row_id       uuid NOT NULL,
  stored_hash  text NOT NULL,
  folded_hash  text NOT NULL,
  held_by      uuid NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  CONSTRAINT wine_signature_refold_review_once
    UNIQUE (table_name, row_id, folded_hash)
);

ALTER TABLE public.wine_signature_refold_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wine_signature_refold_review_service_role
  ON public.wine_signature_refold_review;
CREATE POLICY wine_signature_refold_review_service_role
  ON public.wine_signature_refold_review
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.wine_signature_refold_review FROM anon, authenticated;

COMMENT ON TABLE public.wine_signature_refold_review IS
  'Rows the dotless-i signature refold (20270405100000_wine_signatures_refold_'
  'dotless_i) did not move because another row already held the folded hash. '
  'row_id keeps stored_hash; held_by holds folded_hash. Each pair is a merge '
  'decision (merge_library_wines), never an UPDATE. Set resolved_at when '
  'decided. RLS on, service_role only.';

-- The refold is a function, called once below, so a test can seed stale rows
-- and run the very code this migration runs (supabase/tests/20270405100000_
-- wine_signatures_refold_dotless_i_test.sql) rather than grep its text. It
-- returns how many library rows moved. Re-running it is safe for the same
-- reasons the migration is (IDEMPOTENT above). Owner only: nothing in the app
-- calls it, and a re-key is not a house's or a browser's to start.
CREATE OR REPLACE FUNCTION public.refold_wine_signatures_dotless_i()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $refold$
DECLARE
  r        record;
  v_holder uuid;
  v_moved  integer;
  v_total  integer := 0;
BEGIN
  LOOP
    v_moved := 0;
    FOR r IN
      SELECT d.id, d.stored_hash, d.correct_hash
      FROM public.v_signature_drift d
      JOIN public.master_wine_library m ON m.id = d.id
      WHERE d.stored_hash IS NOT NULL
        AND concat_ws(' ', m.producer, m.name, m.country, m.region,
                      m.grape_variety) LIKE '%ı%'
      ORDER BY m.created_at NULLS LAST, m.id
    LOOP
      -- Re-read per row: an earlier row in this pass may have taken the hash.
      SELECT m.id INTO v_holder
      FROM public.master_wine_library m
      WHERE m.signature_hash = r.correct_hash AND m.id <> r.id
      LIMIT 1;
      CONTINUE WHEN v_holder IS NOT NULL;

      -- signature_hash only: trg_sync_signature_hash fires on identity
      -- columns, so it does not recompute anything here.
      UPDATE public.master_wine_library
      SET signature_hash = r.correct_hash
      WHERE id = r.id;

      UPDATE public.master_wine_library_submissions
      SET signature_hash = r.correct_hash
      WHERE signature_hash = r.stored_hash;

      UPDATE public.menu_changes
      SET wine_signature_hash = r.correct_hash
      WHERE wine_signature_hash = r.stored_hash;

      INSERT INTO public.wine_signature_refold_review
        (table_name, row_id, stored_hash, folded_hash, held_by)
      SELECT 'restaurant_wine_roster', w.id, w.signature_hash, r.correct_hash,
             x.id
      FROM public.restaurant_wine_roster w
      JOIN public.restaurant_wine_roster x
        ON x.restaurant_id = w.restaurant_id
       AND x.signature_hash = r.correct_hash
      WHERE w.signature_hash = r.stored_hash
      ON CONFLICT ON CONSTRAINT wine_signature_refold_review_once DO NOTHING;

      UPDATE public.restaurant_wine_roster w
      SET signature_hash = r.correct_hash
      WHERE w.signature_hash = r.stored_hash
        AND NOT EXISTS (
          SELECT 1 FROM public.restaurant_wine_roster x
          WHERE x.restaurant_id = w.restaurant_id
            AND x.signature_hash = r.correct_hash);

      v_moved := v_moved + 1;
    END LOOP;
    v_total := v_total + v_moved;
    EXIT WHEN v_moved = 0;
  END LOOP;

  -- Whatever still drifts on an "ı" is held back by a row on its new hash.
  INSERT INTO public.wine_signature_refold_review
    (table_name, row_id, stored_hash, folded_hash, held_by)
  SELECT 'master_wine_library', d.id, d.stored_hash, d.correct_hash, h.id
  FROM public.v_signature_drift d
  JOIN public.master_wine_library m ON m.id = d.id
  JOIN LATERAL (
    SELECT x.id FROM public.master_wine_library x
    WHERE x.signature_hash = d.correct_hash AND x.id <> d.id
    LIMIT 1
  ) h ON true
  WHERE d.stored_hash IS NOT NULL
    AND concat_ws(' ', m.producer, m.name, m.country, m.region,
                  m.grape_variety) LIKE '%ı%'
  ON CONFLICT ON CONSTRAINT wine_signature_refold_review_once DO NOTHING;

  RETURN v_total;
END
$refold$;

REVOKE ALL ON FUNCTION public.refold_wine_signatures_dotless_i()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.refold_wine_signatures_dotless_i() IS
  'Moves each live master_wine_library row whose identity fields hold a dotless '
  'i to its folded signature hash, with its submission, menu_changes and roster '
  'copies; holds back (wine_signature_refold_review) any row whose folded hash '
  'another row holds. Merges nothing. Returns the library rows moved. Owner only.';

SELECT public.refold_wine_signatures_dotless_i();
