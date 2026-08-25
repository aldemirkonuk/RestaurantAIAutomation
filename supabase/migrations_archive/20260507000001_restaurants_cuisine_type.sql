-- The live restaurants table predates the baseline migration (address=jsonb, no cuisine_type).
-- Add cuisine_type so the registration flow can store it.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cuisine_type VARCHAR(100);
