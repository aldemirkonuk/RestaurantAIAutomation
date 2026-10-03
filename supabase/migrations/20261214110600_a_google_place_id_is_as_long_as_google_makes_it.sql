-- A GOOGLE PLACE ID IS AS LONG AS GOOGLE MAKES IT. F-006.
--
-- WHAT BROKE. The owner-quarter sim, 2026-10-02 (finding F-006, a BLOCKER):
-- a new owner on /get-started picked a street address from the Places
-- autocomplete, pressed "This is us", and was told "House creation failed:
-- value too long for type character varying(100)". The XHR capture of that
-- POST /api/v1/auth/register/house measured the googlePlaceId at 128
-- characters. That is one measured id: it shows a street-address Place ID can
-- be longer than 100 characters, not that every one is, and Google documents
-- no maximum length.
--
-- WHY. restaurants.google_place_id was created varchar(100) by
-- 20260807001252_distributor_geo_foundation.sql (:52) and never widened. Since
-- Google sets no maximum, any fixed width is a guess that a longer id will one
-- day outgrow. The column becomes `text`. The decision record, with the
-- options weighed and the bound's open fork, is ADR 0265 (Proposed).
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
-- into plain words. The number 2048 is the coordinator's pick, not a founder
-- answer.
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
-- THE SAME IN THE DATABASE, WIDER IN REACH. Today's partial unique index still
-- refuses a second row with the same place id as 23505, and nullability, RLS
-- and grants are as they were. Whether one house per place should be a rule
-- at all is an open founder question (2026-10-02), so this file describes the
-- index as it stands, not as intent. What does change is who reaches it: an
-- id over 100 characters used to fail as 22001 before the index saw it, so two
-- houses picking the same such address could not collide. Now the second one
-- gets 23505. As of this migration both gateway registration paths, the
-- public register route included, pass the raw database message to the
-- browser, so until the separate wording change lands that message names the
-- index. The founder's ruling for a shared place (2026-10-02: open the house,
-- keep the pin, store no place id, say nothing about another house) is
-- gateway work, not schema.
--
-- LOCK. The ALTER takes ACCESS EXCLUSIVE on restaurants, which nearly every
-- request reads. The work is milliseconds at today's size, but the wait for
-- the lock is bounded only by statement_timeout: a long or idle-in-transaction
-- session holding any lock on restaurants would queue every later restaurants
-- query behind this ALTER for up to 120s, after which the migration fails and
-- has to be re-run. statement_timeout follows the repo's ALTER TABLE precedent
-- (for example an_owner_or_manager_may_assign_who_sets_up_zones). No
-- lock_timeout: no migration after the baseline sets one (the baseline's
-- pg_dump header sets it to 0), and adding the first is a precedent left to
-- review. Re-runnable: the type change succeeds again on a second run, and
-- the CHECK is added only if absent. No explicit BEGIN/COMMIT: the Supabase
-- CLI wraps each migration file in a transaction. The closing DO block reads
-- the catalog only; it writes no row.

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
  'The Google Places Place ID of the place the owner picked at sign-up (an establishment or a street address). As of this migration (2026-10) the gateway''s sign-up paths are its only writers, and they write it only alongside a latitude/longitude pair. The schema does not enforce either. text because Google documents no maximum length (F-006: a 128-character address id overflowed the old varchar(100)). At most 2048 bytes (restaurants_google_place_id_length), so a value always fits a btree index entry, whose limit is 2704 bytes.';

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
