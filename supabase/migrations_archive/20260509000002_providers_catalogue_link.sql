-- Phase 27 VENDOR-02: Link providers to vendor_catalogue + is_custom flag

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS catalogue_vendor_id UUID REFERENCES vendor_catalogue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for catalogue lookups
CREATE INDEX IF NOT EXISTS idx_providers_catalogue_vendor ON providers (catalogue_vendor_id)
  WHERE catalogue_vendor_id IS NOT NULL;

-- Update existing providers: if they pre-exist they are all custom
UPDATE providers SET is_custom = TRUE WHERE catalogue_vendor_id IS NULL;
