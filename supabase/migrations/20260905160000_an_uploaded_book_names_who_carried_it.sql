-- price_index_postings — an uploaded book names who carried it, and from what file.
--
-- WHY THESE COLUMNS EXIST (ADR 0117 Q17, answered by the founder 2026-09-05:
-- "Promote them to columns on the postings row")
-- ---------------------------------------------------------------------------
-- Michigan's spirits price book is the only class-B list in the estate that
-- prices what a house actually pays, and it is unfetchable: michigan.gov
-- answers 403 from an Akamai Kona Site Defender edge to any automated reader,
-- and data.michigan.gov publishes `Disallow: /`. So a manager downloads the
-- book and uploads it (`POST /price-index/upload`), and every row it produces
-- is a number a PERSON put on other people's screens.
--
-- Until now the four facts that make that auditable lived in `raw.upload` as
-- JSONB keys. A JSONB key is not a column: it cannot be indexed, it cannot be
-- constrained, and "which manager's upload put this number on the screen" —
-- the exact question someone asks after a bad book — is a scan and a guess.
-- The founder's call promotes them:
--
--   uploaded_by          WHO. A public.users id.
--   upload_file_name     WHICH FILE, as the Commission named it.
--   upload_sha256        WHICH BYTES, so anyone can re-download that edition
--                        and compare byte for byte. This is the whole defence
--                        against a doctored workbook: the MLCC publishes no
--                        signature, so provenance is all there is.
--   upload_edition_date  THE DATE THE FILE NAME STATED.
--
-- WHY `upload_edition_date` IS NOT A DUPLICATE OF `issued_at`. Measured on a
-- real MLCC workbook (2025-08-03 edition, sha256 ff592f82...): NO cell in the
-- sheet carries an effective date, and `docProps` holds only the day the file
-- was authored. The edition date exists in the FILE NAME and nowhere else. So
-- `issued_at` on an uploaded row is a value read out of a string a human could
-- have renamed. Recording separately what the name actually said keeps the
-- original reading intact if `issued_at` is ever corrected, and lets a reader
-- see that the two agree. They are the same value at write time and they are
-- not the same FACT: one is the register's date for the row, the other is the
-- evidence that date came from.
--
-- `uploaded_by` REFERENCES public.users(user_id) — NEVER auth.users. The two
-- tables are disjoint (zero shared ids); the JWT carries `public.users.user_id`,
-- so an actor FK to auth.users 23503s on every real write while CI stays green
-- because a fresh database has no rows to violate.
--
-- ALL FOUR OR NONE. A row with a file name and no uploader is worse than a row
-- with neither: it looks provenanced. The CHECK admits only all-four-NULL (every
-- fetched row, and every row written before this migration) or all-four-NOT-NULL
-- (an upload). Nullable with no DEFAULT, for the same reason `issued_at_basis`
-- is: a DEFAULT would assert a property of rows nobody has looked at.
--
-- The `raw.upload` copy STAYS. It carries `fileBytes`, `sheetName`, `uploadedAt`
-- and `editionDateFrom`, which are not being promoted, and a column added later
-- must never silently delete the evidence that predates it.
--
-- Additive and idempotent. No existing row is rewritten, no existing CHECK is
-- altered, RLS and grants are untouched (the table is already RLS-on,
-- service_role only, anon/authenticated revoked — 20260904200000). The Supabase
-- CLI wraps each migration file in a transaction, so no explicit BEGIN/COMMIT.

ALTER TABLE public.price_index_postings
  ADD COLUMN IF NOT EXISTS uploaded_by UUID,
  ADD COLUMN IF NOT EXISTS upload_file_name TEXT,
  ADD COLUMN IF NOT EXISTS upload_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS upload_edition_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_postings_uploaded_by_fkey'
       AND conrelid = to_regclass('public.price_index_postings')
  ) THEN
    ALTER TABLE public.price_index_postings
      ADD CONSTRAINT price_index_postings_uploaded_by_fkey
      FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_postings_upload_sha256_check'
       AND conrelid = to_regclass('public.price_index_postings')
  ) THEN
    ALTER TABLE public.price_index_postings
      ADD CONSTRAINT price_index_postings_upload_sha256_check
      CHECK (upload_sha256 IS NULL OR upload_sha256 ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_postings_upload_provenance_complete'
       AND conrelid = to_regclass('public.price_index_postings')
  ) THEN
    ALTER TABLE public.price_index_postings
      ADD CONSTRAINT price_index_postings_upload_provenance_complete
      CHECK (
        (uploaded_by IS NULL
          AND upload_file_name IS NULL
          AND upload_sha256 IS NULL
          AND upload_edition_date IS NULL)
        OR
        (uploaded_by IS NOT NULL
          AND upload_file_name IS NOT NULL
          AND btrim(upload_file_name) <> ''
          AND upload_sha256 IS NOT NULL
          AND upload_edition_date IS NOT NULL)
      );
  END IF;
END
$$;

-- The question this exists to answer in one index seek rather than a scan.
CREATE INDEX IF NOT EXISTS idx_price_index_postings_uploaded_by
  ON public.price_index_postings (uploaded_by, issued_at DESC)
  WHERE uploaded_by IS NOT NULL;

COMMENT ON COLUMN public.price_index_postings.uploaded_by IS
  'The person who carried this book in, as a public.users id - NEVER auth.users, which is a disjoint table. NULL on every fetched row. Set together with upload_file_name, upload_sha256 and upload_edition_date or not at all.';
COMMENT ON COLUMN public.price_index_postings.upload_file_name IS
  'The uploaded file''s name, as the issuer published it (e.g. 8-3-25-PRICE-BOOK-EXCEL.xlsx). For the Michigan book this string is the ONLY place the edition date exists - no cell in the sheet carries one.';
COMMENT ON COLUMN public.price_index_postings.upload_sha256 IS
  'sha256 of the exact bytes uploaded. The MLCC publishes no signature, so this is the whole defence against a doctored workbook: anyone can re-download that edition and compare.';
COMMENT ON COLUMN public.price_index_postings.upload_edition_date IS
  'The date the FILE NAME stated, kept beside issued_at rather than folded into it. Equal at write time; if issued_at is ever corrected this preserves what the evidence actually said.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  c record;
  admits_partial boolean;
  admits_auth_fk boolean;
BEGIN
  IF to_regclass('public.price_index_postings') IS NULL THEN
    RAISE EXCEPTION 'price_index_postings does not exist; this migration is out of order';
  END IF;

  FOR c IN
    SELECT unnest(ARRAY['uploaded_by','upload_file_name','upload_sha256','upload_edition_date']) AS name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'price_index_postings'
         AND column_name = c.name
    ) THEN
      RAISE EXCEPTION '% was not added', c.name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'price_index_postings'
         AND column_name = c.name AND is_nullable <> 'YES'
    ) THEN
      RAISE EXCEPTION '% must be nullable - every fetched row has no uploader', c.name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'price_index_postings'
         AND column_name = c.name AND column_default IS NOT NULL
    ) THEN
      RAISE EXCEPTION '% must have no DEFAULT - a default would claim provenance for rows nobody carried', c.name;
    END IF;
  END LOOP;

  -- The FK must point at public.users, not auth.users. This is the fault that
  -- CI cannot catch (a fresh database has no rows to violate), so it is
  -- asserted here where the schema itself can be read.
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conname = 'price_index_postings_uploaded_by_fkey'
       AND ns.nspname <> 'public'
  ) INTO admits_auth_fk;
  IF admits_auth_fk THEN
    RAISE EXCEPTION 'uploaded_by points outside public; auth.users and public.users are disjoint';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
     WHERE con.conname = 'price_index_postings_uploaded_by_fkey'
       AND ref.relname = 'users'
  ) THEN
    RAISE EXCEPTION 'uploaded_by has no foreign key to public.users';
  END IF;

  -- Prove the all-or-nothing CHECK actually refuses a half-provenanced row,
  -- rather than trusting that it was created.
  BEGIN
    EXECUTE $q$
      INSERT INTO public.price_index_postings
        (source_key, source_class, state, issuer, issued_at, price_basis,
         product_name, price, price_unit, source_url, source_ref, content_hash,
         upload_file_name)
      VALUES
        ('upload-probe', 'posted_wholesale_list', 'US-MI', 'probe', DATE '2026-01-01',
         'probe', 'probe', 1, 'per bottle', 'https://example.invalid',
         'upload-probe', repeat('0', 64), '8-3-25-PRICE-BOOK-EXCEL.xlsx')
    $q$;
    admits_partial := true;
  EXCEPTION WHEN check_violation THEN
    admits_partial := false;
  END;
  IF admits_partial THEN
    DELETE FROM public.price_index_postings WHERE source_ref = 'upload-probe';
    RAISE EXCEPTION
      'a row with a file name and no uploader was admitted; a half-provenanced row looks provenanced';
  END IF;

  RAISE NOTICE
    'price_index_postings: uploaded_by (FK -> public.users), upload_file_name, upload_sha256, upload_edition_date added; all-or-nothing CHECK proven to refuse a partial row; RLS and grants untouched.';
END
$$;
