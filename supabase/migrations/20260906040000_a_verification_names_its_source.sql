-- A verification names its source. (2026-09-05, ADR 0117 Q26; additive: one
-- CHECK constraint on an existing table, no table created, no column added.)
--
-- THE FINDING
-- -----------
-- Every `vendor_catalogue.verified_at` in production (17 rows, read on
-- 2026-09-05) was stamped in the two seconds two migrations applied on
-- 2026-08-10: `20260807001352_distributor_vendor_backfill.sql:32` wrote
-- `verified_at = now()` for fifteen rows while setting Census-geocoded
-- coordinates, and `20260807001552_distributor_data_quality.sql:36,52` did the
-- same for two address corrections. "Verified" therefore meant "an address got
-- coordinates". Nothing checked the website, the name or the business, and
-- three of those websites were a casino, a wine school and a clothes shop
-- (cleared 2026-09-05). `source_ref` was NULL on every one of the seventeen.
--
-- The founder: "Clear it and find the stamper." The stamps are cleared by
-- `scripts/clear_vendor_catalogue_verified_at.py` on his word (a script, not a
-- migration: live vendor rows are edited by hand after a read). This file is
-- what stops the NEXT migration from stamping a verification nobody made: a
-- `verified_at` must come with a `source_ref` that says what verified it.
--
-- Rows the script did not reach (a replay on a fresh database has none; a
-- production row stamped between the script's run and this file's apply would
-- be the only case) are cleared here with the count said out loud, so the
-- constraint can be created and the stamp is never silently kept.

DO $$
DECLARE
  cleared int;
BEGIN
  UPDATE public.vendor_catalogue
     SET verified_at = NULL,
         notes = CASE WHEN notes IS NULL OR btrim(notes) = ''
                      THEN 'verified_at cleared by migration 20260906040000: it carried no source_ref (ADR 0117 Q26).'
                      ELSE notes || ' | verified_at cleared by migration 20260906040000: it carried no source_ref (ADR 0117 Q26).' END
   WHERE verified_at IS NOT NULL
     AND source_ref IS NULL;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RAISE NOTICE 'vendor_catalogue: cleared % verified_at stamp(s) that named no source (expected 0 after scripts/clear_vendor_catalogue_verified_at.py ran)', cleared;
END
$$;

ALTER TABLE public.vendor_catalogue
  DROP CONSTRAINT IF EXISTS chk_vendor_catalogue_verified_names_its_source;

ALTER TABLE public.vendor_catalogue
  ADD CONSTRAINT chk_vendor_catalogue_verified_names_its_source
  CHECK (verified_at IS NULL OR source_ref IS NOT NULL);

COMMENT ON COLUMN public.vendor_catalogue.verified_at IS
  'When something checked that this row describes the business it names. Requires source_ref (what did the checking). Until 2026-09-05 every value came from two geocoding migrations and meant only that coordinates were set; those were cleared (ADR 0117 Q26).';

-- Assert the outcome rather than report success.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.vendor_catalogue')
       AND conname = 'chk_vendor_catalogue_verified_names_its_source'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'vendor_catalogue: the verified-names-its-source check was not created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_catalogue WHERE verified_at IS NOT NULL AND source_ref IS NULL) THEN
    RAISE EXCEPTION 'vendor_catalogue: a verified_at with no source_ref survived';
  END IF;
  RAISE NOTICE 'a verification names its source: vendor_catalogue.verified_at now requires source_ref.';
END
$$;
