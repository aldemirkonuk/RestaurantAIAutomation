-- price_index_postings.issued_at_basis — whose date `issued_at` is.
--
-- WHY THIS COLUMN EXISTS (ADR 0117 Q27, answered by the founder 2026-09-05)
-- ------------------------------------------------------------------------
-- `issued_at` is documented on this table as "the ISSUER's own
-- effective/publication date, never the fetch date", and `refuseStale` reads it
-- as the freshness signal. That is exactly right for a periodical: Iowa, Oregon,
-- California, Michigan and Defra all stamp their own editions, and the whole
-- gate exists because `bh_fv020.txt` served a 975-day-old file behind an HTTP
-- 200.
--
-- A merchant shop is not a periodical. Measured 2026-09-05 across six recorded
-- merchant pages, exactly ONE states a date its price applies from
-- (schema.org `Offer.validFrom`). Refusing the other five kept the column's
-- contract intact and delivered one row in six; filing them with our read date
-- and no label would have made every shop row eternally fresh and the staleness
-- gate vacuous for the whole class.
--
-- So the date is filed and LABELLED. `issued_at_basis` says which clock
-- `issued_at` came from, and `refuseStale` ages a `fetch_date` row from that
-- read rather than treating it as a publication.
--
--   'issuer_stated'  the publisher printed this date. The only value a class-B
--                    or class-E posting may carry, and the only one a reader may
--                    render as "issued".
--   'fetch_date'     nobody published a date; this is the day WE read the page,
--                    and the reader renders it as "read on".
--
-- NULLABLE ON PURPOSE, WITH NO DEFAULT. Every row written before this column
-- existed came from a parser that reads the issuer's own date — but a DEFAULT of
-- 'issuer_stated' would be this codebase's standing fault written into DDL: a
-- column asserting a property of rows nobody has looked at. NULL means "written
-- before a basis was recorded", which is the truth, and it is what separates it
-- from a row that was judged. Same shape as `outlier_basis`
-- (`20260905000000_an_outlier_verdict_names_its_reason.sql`).
--
-- Additive and idempotent. No existing row is rewritten, no CHECK on an existing
-- column is altered, RLS and grants are untouched. The Supabase CLI wraps each
-- migration file in a transaction, so there is no explicit BEGIN/COMMIT.

ALTER TABLE public.price_index_postings
  ADD COLUMN IF NOT EXISTS issued_at_basis VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_index_postings_issued_at_basis_check'
      AND conrelid = to_regclass('public.price_index_postings')
  ) THEN
    ALTER TABLE public.price_index_postings
      ADD CONSTRAINT price_index_postings_issued_at_basis_check
      CHECK (issued_at_basis IS NULL
             OR issued_at_basis IN ('issuer_stated', 'fetch_date'));
  END IF;
END
$$;

COMMENT ON COLUMN public.price_index_postings.issued_at_basis IS
  'Whose clock issued_at came from: ''issuer_stated'' (the publisher printed it) or ''fetch_date'' (nobody published one, so it is the day we read the page and the reader must say "read on", never "issued"). NULL means the row was written before a basis was recorded - never a claim that the date is the issuer''s. refuseStale ages a fetch_date row from the read.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  nullable text;
  admits_bad boolean;
BEGIN
  IF to_regclass('public.price_index_postings') IS NULL THEN
    RAISE EXCEPTION 'price_index_postings does not exist; this migration is out of order';
  END IF;

  SELECT is_nullable INTO nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'price_index_postings'
     AND column_name = 'issued_at_basis';
  IF nullable IS NULL THEN
    RAISE EXCEPTION 'issued_at_basis was not added';
  END IF;
  IF nullable <> 'YES' THEN
    RAISE EXCEPTION
      'issued_at_basis must be nullable - a row written before a basis was recorded has no basis';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'price_index_postings'
       AND column_name = 'issued_at_basis'
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'issued_at_basis must have no DEFAULT - a default would assert a basis for rows nobody looked at';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_postings_issued_at_basis_check'
       AND conrelid = to_regclass('public.price_index_postings')
  ) THEN
    RAISE EXCEPTION 'the issued_at_basis CHECK is missing; any string could be written';
  END IF;

  -- Prove the CHECK actually refuses, rather than trusting that it was created.
  BEGIN
    EXECUTE $q$
      INSERT INTO public.price_index_postings
        (source_key, source_class, state, issuer, issued_at, price_basis,
         product_name, price, price_unit, source_url, source_ref, content_hash,
         issued_at_basis)
      VALUES
        ('constraint-probe', 'retail_reference', 'GB-ENG', 'probe', DATE '2026-01-01',
         'probe', 'probe', 1, 'per bottle', 'https://example.invalid',
         'constraint-probe', repeat('0', 64), 'guessed')
    $q$;
    admits_bad := true;
  EXCEPTION WHEN check_violation THEN
    admits_bad := false;
  END;
  IF admits_bad THEN
    -- Never reached with the CHECK in place; the DELETE is here so that a
    -- failure of this assertion does not also leave a probe row behind.
    DELETE FROM public.price_index_postings WHERE source_ref = 'constraint-probe';
    RAISE EXCEPTION 'issued_at_basis accepted a value outside its CHECK';
  END IF;

  IF EXISTS (SELECT 1 FROM public.price_index_postings WHERE source_ref = 'constraint-probe') THEN
    RAISE EXCEPTION 'the constraint probe left a row behind';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.price_index_postings')) THEN
    RAISE EXCEPTION 'price_index_postings has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.price_index_postings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.price_index_postings', 'SELECT')
  THEN
    RAISE EXCEPTION 'price_index_postings is reachable by anon/authenticated';
  END IF;

  RAISE NOTICE 'issued_at_basis added: nullable, no default, CHECK proven to refuse, RLS untouched.';
END
$$;
