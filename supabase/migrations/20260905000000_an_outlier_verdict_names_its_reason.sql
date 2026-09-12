-- An outlier verdict names its reason, its basis and its date.
--
-- WHY
-- ---
-- `is_outlier` has been a bare boolean since
-- `20260805154027_vendor_price_observations.sql:99`, and the column's own
-- comment there says it is "Set by the consensus pass, not at write time".
-- Two things changed that on 2026-09-04:
--
--   1. Two writers now set it AT write time (`procurement/own-paper-sighting.ts`
--      via `procurement.service.ts`, and the vendor-site sweep via
--      `vendor-intel/vendor-page-extractor.service.ts`), on the founder's
--      instruction, so a catastrophic parse is kept out of the ladder the
--      moment it lands rather than after a batch.
--   2. ADR 0117 Q7 asked whether the batch pass should still exist. The answer
--      is BOTH: a write-time flag cannot re-judge a row once later evidence
--      arrives, and a nightly pass cannot protect the ladder in the hours
--      before it runs.
--
-- With two judges and two moments, a bare boolean can no longer be read. A
-- `true` no longer says whether it was decided against four priors at write
-- time or against forty rows last night, and a `false` cannot be told apart
-- from the DEFAULT false of a row nothing has ever judged — which is exactly
-- the absence-reported-as-health fault this register keeps meeting. These three
-- columns make the verdict legible:
--
--   outlier_reason      a sentence a person can read, or NULL if unjudged
--   outlier_judged_at   when the verdict was reached, or NULL if unjudged
--   outlier_basis       'write_time' | 'rejudge', or NULL if unjudged
--
-- ALL THREE ARE NULLABLE ON PURPOSE. Every row already in the table was
-- written before any judge existed; back-filling them with a manufactured
-- reason would assert a judgement that never happened. NULL is the honest
-- value and it is the one that says "nobody has looked at this row".
--
-- `is_outlier` itself is untouched: still boolean, still DEFAULT false, still
-- NOT NULL, so `belowTrailingAverage`'s `.eq("is_outlier", false)` filter
-- (`vendor-intel/vendor-comparison.service.ts`) keeps behaving exactly as it
-- does today. This migration adds explanation, it does not change admission.
--
-- RLS IS UNCHANGED. No policy is created, dropped or altered here; the table's
-- existing row-level security from the creating migration continues to govern
-- every one of these columns.

ALTER TABLE public.vendor_price_observations
    ADD COLUMN IF NOT EXISTS outlier_reason text,
    ADD COLUMN IF NOT EXISTS outlier_judged_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS outlier_basis text;

-- The basis is a closed set. An unrecognised value would be silently averaged
-- into whichever branch a reader's `if` happened to fall through to.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vpo_outlier_basis_check'
          AND conrelid = 'public.vendor_price_observations'::regclass
    ) THEN
        ALTER TABLE public.vendor_price_observations
            ADD CONSTRAINT vpo_outlier_basis_check
            CHECK (outlier_basis IS NULL
                   OR outlier_basis IN ('write_time', 'rejudge'));
    END IF;
END $$;

COMMENT ON COLUMN public.vendor_price_observations.outlier_reason IS
    'Why this row is (or is not) flagged, as a sentence. NULL means no judge '
    'has ever looked at this row — which is NOT the same as "judged clean".';

COMMENT ON COLUMN public.vendor_price_observations.outlier_judged_at IS
    'When the verdict in is_outlier was reached. NULL means never judged.';

COMMENT ON COLUMN public.vendor_price_observations.outlier_basis IS
    'write_time = decided against the priors present when the row landed; '
    'rejudge = decided by the nightly pass over the reader''s comparison '
    'window. NULL means never judged.';

-- The nightly pass sweeps the reader's window: rows newer than a cutoff,
-- grouped by product identity. `idx_vpo_product` and `idx_vpo_signature`
-- already serve the identity half; this one serves the "only rows the readers
-- can still see" half so the pass does not seq-scan the whole register.
CREATE INDEX IF NOT EXISTS idx_vpo_rejudge_window
    ON public.vendor_price_observations (observed_at DESC)
    WHERE master_wine_id IS NOT NULL OR signature_hash IS NOT NULL;

-- ASSERTIONS. A migration that cannot prove it did what it says is a migration
-- that reports absence as health.
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendor_price_observations'
      AND column_name IN ('outlier_reason', 'outlier_judged_at', 'outlier_basis');
    IF n <> 3 THEN
        RAISE EXCEPTION 'expected 3 outlier verdict columns, found %', n;
    END IF;

    -- All three must be nullable: see the header. A NOT NULL here would force
    -- a fabricated verdict onto every pre-existing row.
    SELECT count(*) INTO n
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendor_price_observations'
      AND column_name IN ('outlier_reason', 'outlier_judged_at', 'outlier_basis')
      AND is_nullable = 'NO';
    IF n <> 0 THEN
        RAISE EXCEPTION '% outlier verdict column(s) are NOT NULL; all three must be nullable', n;
    END IF;

    -- is_outlier must be exactly as it was: readers filter on it.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vendor_price_observations'
          AND column_name = 'is_outlier'
          AND is_nullable = 'NO'
          AND data_type = 'boolean'
    ) THEN
        RAISE EXCEPTION 'is_outlier is no longer a NOT NULL boolean';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vpo_outlier_basis_check'
          AND conrelid = 'public.vendor_price_observations'::regclass
    ) THEN
        RAISE EXCEPTION 'vpo_outlier_basis_check was not created';
    END IF;

    -- RLS must still be on. This migration does not touch policies, and a
    -- table that lost RLS while we were adding columns must not pass silently.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.vendor_price_observations'::regclass
          AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'row level security is no longer enabled on vendor_price_observations';
    END IF;
END $$;
