-- Split contact_name into first_name + last_name on providers table.
-- Also add website column if missing (was only in JSONB before).
-- Existing contact_name data is back-filled: first word → first_name, rest → last_name.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS contact_first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS contact_last_name  VARCHAR(150),
  ADD COLUMN IF NOT EXISTS website            VARCHAR(500),
  ADD COLUMN IF NOT EXISTS rating             NUMERIC(2,1) CHECK (rating >= 0 AND rating <= 5);

-- Back-fill from primary_contact JSONB name field (contact_name column does not exist in this schema)
UPDATE providers
SET
  contact_first_name = SPLIT_PART(primary_contact->>'name', ' ', 1),
  contact_last_name  = NULLIF(TRIM(SUBSTRING(primary_contact->>'name' FROM POSITION(' ' IN (primary_contact->>'name')) + 1)), '')
WHERE contact_first_name IS NULL
  AND primary_contact->>'name' IS NOT NULL
  AND primary_contact->>'name' <> '';

-- Back-fill website from primary_contact JSONB if available
UPDATE providers
SET website = primary_contact->>'website'
WHERE website IS NULL AND primary_contact->>'website' IS NOT NULL;

COMMENT ON COLUMN providers.contact_first_name IS 'First name of primary contact — used for personalised salutations (e.g. Hi {first_name})';
COMMENT ON COLUMN providers.contact_last_name  IS 'Last name of primary contact';
COMMENT ON COLUMN providers.website            IS 'Provider website URL';
COMMENT ON COLUMN providers.rating             IS 'Manager-assigned rating 0–5';
