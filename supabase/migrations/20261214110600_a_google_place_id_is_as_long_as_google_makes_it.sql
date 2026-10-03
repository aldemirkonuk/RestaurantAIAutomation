-- A GOOGLE PLACE ID IS AS LONG AS GOOGLE MAKES IT. F-006.
--
-- WHAT BROKE. The owner-quarter sim, 2026-10-02 (finding F-006, a BLOCKER):
-- a new owner on /get-started picked a street address from the Places
-- autocomplete, pressed "This is us", and was told "House creation failed:
-- value too long for type character varying(100)". The XHR capture of that
-- POST /api/v1/auth/register/house measured the googlePlaceId at 128
-- characters. A restaurant that is not yet a Google establishment can only be
-- found by its street address, and an address's Place ID is longer than an
-- establishment's, so every such house hit this wall.
--
-- WHY. restaurants.google_place_id was created varchar(100) by
-- 20260807001252_distributor_geo_foundation.sql (:52) and never widened. Google
-- documents no maximum length for a Place ID, so any fixed width is a guess
-- that a longer id will one day outgrow. The column becomes `text`.
--
-- WHY A BOUND ANYWAY, AND WHY IN BYTES. The column carries a partial unique
-- index (idx_restaurants_google_place_id, same file :65-66). A btree entry
-- larger than 2704 BYTES is refused with 54000 ("index row size exceeds btree
-- maximum"), so an unbounded `text` would trade one raw error for another at
-- some length. The bound is on octet_length, not char_length: a Place ID is
-- ASCII today, but a character bound does not keep a multibyte value under a
-- byte limit (1,000 three-byte characters are 3,000 bytes). 2048 bytes is 16x
-- the measured 128-character id and sits below the index's 2704-byte limit
-- with room for the index tuple's own header, so a value the CHECK admits is
-- always a value the index can hold. A value over it is refused as 23514 by
-- restaurants_google_place_id_length, a named constraint the gateway can turn
-- into plain words.
--
-- WHAT DEPENDS ON THE COLUMN. Measured on a database built from every file in
-- supabase/migrations (PGlite, pg_depend on the column): only the partial
-- unique index above. No view, policy, trigger, generated column or
-- publication names it. varchar -> text is binary-coercible, so the ALTER does
-- not rewrite the table. It DOES rebuild the unique index: Postgres does not
-- reuse a partial index across a type change (measured in PGlite, PG 18: the
-- index's relfilenode changed and the table's did not; a plain index given the
-- same change kept its file). Both the rebuild and the CHECK's
-- one validating scan cost one pass over restaurants under the ALTER's lock,
-- and no existing row can fail the CHECK (100 characters of varchar(100) are
-- at most 400 bytes).
--
-- UNCHANGED. Uniqueness where not null (two houses cannot claim one Google
-- place; a duplicate is still 23505), nullability, RLS, grants. The words the
-- gateway shows for a refused value are a separate change.
--
-- statement_timeout follows the repo's ALTER TABLE precedent (for example
-- an_owner_or_manager_may_assign_who_sets_up_zones). No lock_timeout: no
-- migration after the baseline sets one (the baseline's pg_dump header sets
-- it to 0). Re-runnable: the type change succeeds again on a second run, and
-- the CHECK is added only if absent. No
-- explicit BEGIN/COMMIT: the Supabase CLI wraps each migration file in a
-- transaction. The closing DO block reads the catalog only; it writes no row.

SET local statement_timeout = '120s';

ALTER TABLE public.restaurants
  ALTER COLUMN google_place_id TYPE text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_google_place_id_length'
       AND conrelid = to_regclass('public.restaurants')
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_google_place_id_length
      CHECK (google_place_id IS NULL OR octet_length(google_place_id) <= 2048);
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.google_place_id IS
  'The Google Places Place ID of the place the owner picked on /get-started (an establishment, or a street address when the house is not yet on Google). Written only by the gateway''s AuthService.coordinateColumns (auth.service.ts), and only alongside a real latitude/longitude pair. text because Google documents no maximum length (F-006: a 128-character address id overflowed the old varchar(100)); bounded to 2048 bytes by restaurants_google_place_id_length so it always fits the unique index. Unique where not null (idx_restaurants_google_place_id): two houses cannot claim one Google place.';

DO $$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'public.restaurants'::regclass
         AND a.attname = 'google_place_id'
         AND NOT a.attisdropped) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'restaurants.google_place_id is not text';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurants_google_place_id_length'
       AND conrelid = 'public.restaurants'::regclass
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'restaurants_google_place_id_length is missing or not validated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
     WHERE indexrelid = to_regclass('public.idx_restaurants_google_place_id')
       AND indisunique
  ) THEN
    RAISE EXCEPTION 'idx_restaurants_google_place_id is missing or no longer unique';
  END IF;
END $$;
