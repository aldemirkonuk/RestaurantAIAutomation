-- A vendor's usual currency can now be written from their own invoices, and
-- the row says which of the two it came from: a person, or the invoices.
--
-- THE FOUNDER, 2026-10-01 (vendors review, ruling VEN-W13), verbatim:
--   "write auto and when other currencies are discovere then use option 1"
--   "3 invoices"
--   "Person's value stays, sheet shows the clash"
--   "Keep it, switch to the one-tap offer"
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES, AND WHAT DOES NOT
-- ---------------------------------------------------------------------------
-- Until today `providers.usual_currency` could only be TYPED BY A PERSON, and
-- `providers_usual_currency_names_its_author` (20260906170000) made the code,
-- the person and the moment one fact. The ruling adds a second author: when
-- at least three invoices from this vendor, in this house, each printed the
-- same currency on their own page, none of the counted ones disagree, and none
-- of them was restated by a manager, the gateway writes that code with no
-- person on it -- and the row must then say it came from the invoices and how
-- many there were. A code with neither a person nor an invoice count behind it
-- is still refused: that is the "currency by nobody" this column was built to
-- prevent, and it stays prevented.
--
-- What does NOT change: this column still files no invoice. It is offered as
-- the starting value on an order sheet and printed on the vendor's profile.
-- And a person's value is never overwritten by the invoices -- that rule lives
-- in the gateway (a guarded write that only fills an empty field), and a
-- person's later answer always replaces an invoice-written one.
--
-- ---------------------------------------------------------------------------
-- TWO COLUMNS AND ONE REPLACED CHECK
-- ---------------------------------------------------------------------------
--   usual_currency_source         'person' or 'invoices'. NULL only when no
--                                 code is on file.
--   usual_currency_invoice_count  how many agreeing invoices stood behind an
--                                 invoice-written code (at least 3). NULL for a
--                                 person's code, and NULL when nothing is on
--                                 file.
--
-- The CHECK is written with every IS NOT NULL spelled out. 20260906170000
-- MEASURED that `x IN (...)` against a NULL evaluates to NULL and a CHECK that
-- evaluates to NULL PASSES -- a guard that reads right and enforces nothing.
--
-- ---------------------------------------------------------------------------
-- WHY A SMALL TRIGGER CLEARS THE TWO NEW COLUMNS WHEN THE CODE IS CLEARED
-- ---------------------------------------------------------------------------
-- `arrival_restore_entry` (20260922231100) undoes a setup-page write by putting
-- back the three columns it snapshotted -- code, person, moment -- and knows
-- nothing of the two added here. Undoing "a person stated EUR" on a vendor that
-- had nothing would put back three NULLs and leave `usual_currency_source =
-- 'person'` behind, which the CHECK below refuses, and the undo would fail.
-- So when a write leaves no code on file, the trigger clears where it came
-- from and how many invoices said so: with no code there is nothing for either
-- to describe. It fills nothing in and never invents a source.
--
-- ---------------------------------------------------------------------------
-- BACK-FILL
-- ---------------------------------------------------------------------------
-- Every code on file before today was typed by a person (the old CHECK
-- required a person on every one), so every such row is marked 'person'. No
-- row is written from invoices here: no document stored before today carries
-- a printed-currency sighting, and the gateway only starts counting with the
-- next invoice it reads.
--
-- ADDITIVE apart from the one CHECK it replaces. No table created, no column
-- dropped, no RLS change.
SET local statement_timeout = '120s';

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS usual_currency_source TEXT,
  ADD COLUMN IF NOT EXISTS usual_currency_invoice_count INTEGER;

COMMENT ON COLUMN public.providers.usual_currency IS
  'The ISO 4217 code this vendor usually invoices in. Typed by a person on the vendor profile, OR written by the gateway when at least 3 of this vendor''s invoices in this house printed the same code on their own page, none of the counted ones disagree and none was restated by a manager (founder, 2026-10-01, VEN-W13). usual_currency_source says which. A person''s value is never overwritten from invoices. IT NEVER FILES AN INVOICE: it is offered as the starting value on the order sheet and printed on the profile.';
COMMENT ON COLUMN public.providers.usual_currency_set_by IS
  'The person who typed it, from public.users(user_id) - never auth.users, which is disjoint from it. NULL when the code was written from invoices (usual_currency_source = ''invoices''), because no person stated it.';
COMMENT ON COLUMN public.providers.usual_currency_source IS
  'Where usual_currency came from: person (typed on the vendor profile; usual_currency_set_by names them) or invoices (at least usual_currency_invoice_count of their invoices printed it). NULL only when no code is on file.';
COMMENT ON COLUMN public.providers.usual_currency_invoice_count IS
  'How many agreeing invoices stood behind an invoice-written usual_currency - at least 3. NULL for a person''s code and when no code is on file.';

UPDATE public.providers
   SET usual_currency_source = 'person'
 WHERE usual_currency IS NOT NULL
   AND usual_currency_source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'providers_usual_currency_source_is_known'
       AND conrelid = to_regclass('public.providers')
  ) THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_usual_currency_source_is_known
      CHECK (usual_currency_source IS NULL
             OR usual_currency_source IN ('person', 'invoices'));
  END IF;
END
$$;

-- The old rule ("the code, the person and the moment are one fact") becomes
-- "the code and the moment, and EITHER a person OR at least three invoices".
ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_usual_currency_names_its_author;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_usual_currency_names_its_author
  CHECK (
    (usual_currency IS NULL
      AND usual_currency_set_by IS NULL
      AND usual_currency_set_at IS NULL
      AND usual_currency_source IS NULL
      AND usual_currency_invoice_count IS NULL)
    OR
    (usual_currency IS NOT NULL
      AND usual_currency_set_at IS NOT NULL
      AND usual_currency_source IS NOT NULL
      AND (
        (usual_currency_source = 'person'
          AND usual_currency_set_by IS NOT NULL
          AND usual_currency_invoice_count IS NULL)
        OR
        (usual_currency_source = 'invoices'
          AND usual_currency_set_by IS NULL
          AND usual_currency_invoice_count IS NOT NULL
          AND usual_currency_invoice_count >= 3)
      ))
  );

-- With no code on file there is nothing for a source or a count to describe.
-- See the header for the undo this keeps working.
CREATE OR REPLACE FUNCTION public.providers_usual_currency_clears_its_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.usual_currency IS NULL THEN
    NEW.usual_currency_source := NULL;
    NEW.usual_currency_invoice_count := NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.providers_usual_currency_clears_its_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.providers_usual_currency_clears_its_source() FROM anon, authenticated;

DROP TRIGGER IF EXISTS providers_usual_currency_clears_its_source ON public.providers;
CREATE TRIGGER providers_usual_currency_clears_its_source
  BEFORE INSERT OR UPDATE OF usual_currency ON public.providers
  FOR EACH ROW
  EXECUTE FUNCTION public.providers_usual_currency_clears_its_source();

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT;
  unsourced BIGINT;
BEGIN
  SELECT string_agg(v.col, ', ') INTO missing
    FROM (VALUES ('usual_currency_source'), ('usual_currency_invoice_count')) AS v(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'providers'
        AND column_name = v.col
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'these columns were not added: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'providers_usual_currency_names_its_author'
       AND conrelid = to_regclass('public.providers')
       AND pg_get_constraintdef(oid) ILIKE '%usual_currency_invoice_count >= 3%'
  ) THEN
    RAISE EXCEPTION 'providers_usual_currency_names_its_author was not replaced with the person-or-three-invoices rule';
  END IF;

  SELECT count(*) INTO unsourced
    FROM public.providers
   WHERE usual_currency IS NOT NULL AND usual_currency_source IS NULL;
  IF unsourced > 0 THEN
    RAISE EXCEPTION '% vendor(s) hold a usual currency with no source after the back-fill', unsourced;
  END IF;
END
$$;
