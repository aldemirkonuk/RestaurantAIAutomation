-- A restatement keeps the rate it was filed at (r104 invoices-gap g1).
-- ADDITIVE: three nullable columns and one CHECK; no data is written. All three
-- are NULL on a plain relabel, and the CHECK refuses a half-stated conversion.
ALTER TABLE public.procurement_document_currency_changes
  ADD COLUMN IF NOT EXISTS paper_currency CHARACTER(3),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS rate_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdcc_conversion_is_all_or_nothing') THEN
    ALTER TABLE public.procurement_document_currency_changes
      ADD CONSTRAINT pdcc_conversion_is_all_or_nothing
      CHECK (
        (paper_currency IS NULL AND exchange_rate IS NULL AND rate_date IS NULL)
        OR (paper_currency ~ '^[A-Z]{3}$' AND exchange_rate > 0 AND rate_date IS NOT NULL)
      );
  END IF;
END $$;
