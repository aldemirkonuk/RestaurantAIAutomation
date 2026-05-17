-- Add columns that the API update/create payload sends but may be missing in production.
-- All additions use IF NOT EXISTS so they are safe to run on any schema variant.
--
-- Root cause: the original providers CREATE TABLE predated the Supabase migration system.
-- When the baseline migration (20260208024921) ran, the table already existed, so the
-- CREATE TABLE IF NOT EXISTS was a no-op and any newer columns were never applied.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS payment_terms        TEXT    DEFAULT 'Net 30',
  ADD COLUMN IF NOT EXISTS company_name         TEXT,
  ADD COLUMN IF NOT EXISTS personality_notes    TEXT,
  ADD COLUMN IF NOT EXISTS primary_contact      JSONB   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alternative_contacts JSONB[],
  ADD COLUMN IF NOT EXISTS regions_covered      TEXT[],
  ADD COLUMN IF NOT EXISTS tier                 TEXT,
  ADD COLUMN IF NOT EXISTS reliability_score    NUMERIC,
  ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ;

-- Back-fill personality_notes from ai_personality_notes if the old column exists and the new one is empty.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'providers' AND column_name = 'ai_personality_notes'
  ) THEN
    UPDATE providers
    SET personality_notes = ai_personality_notes
    WHERE personality_notes IS NULL AND ai_personality_notes IS NOT NULL AND ai_personality_notes <> '';
  END IF;
END $$;

-- Back-fill contact_first_name / contact_last_name from legacy contact_name column if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'providers' AND column_name = 'contact_name'
  ) THEN
    UPDATE providers
    SET
      contact_first_name = SPLIT_PART(COALESCE(contact_name, ''), ' ', 1),
      contact_last_name  = NULLIF(TRIM(SUBSTRING(COALESCE(contact_name, '') FROM POSITION(' ' IN COALESCE(contact_name, '')) + 1)), '')
    WHERE contact_first_name IS NULL
      AND contact_name IS NOT NULL
      AND contact_name <> '';
  END IF;
END $$;
