-- Add phone_type to provider_contacts
ALTER TABLE provider_contacts ADD COLUMN IF NOT EXISTS phone_type TEXT DEFAULT 'main_line';

-- Create provider_locations table
CREATE TABLE IF NOT EXISTS provider_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Main Location',
  type TEXT NOT NULL DEFAULT 'office' CHECK (type IN ('office', 'warehouse', 'store', 'other')),
  address TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_locations_provider_id ON provider_locations(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_locations_restaurant_id ON provider_locations(restaurant_id);

-- Enable RLS
ALTER TABLE provider_locations ENABLE ROW LEVEL SECURITY;

-- RLS: restaurant members can manage their provider locations
CREATE POLICY "provider_locations_restaurant_access"
  ON provider_locations
  FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM user_restaurant_access
      WHERE user_id = auth.uid()
    )
  );

-- Backfill: create a primary location from existing provider address where it exists
-- address is JSONB; cast to text and extract line1 if present, otherwise use raw cast
INSERT INTO provider_locations (provider_id, restaurant_id, name, type, address, is_primary)
SELECT
  id,
  restaurant_id,
  'Main Location',
  'office',
  CASE
    WHEN jsonb_typeof(address) = 'object' AND address->>'line1' IS NOT NULL THEN address->>'line1'
    WHEN jsonb_typeof(address) = 'string' THEN address #>> '{}'
    ELSE address::text
  END,
  true
FROM providers
WHERE address IS NOT NULL
  AND address::text NOT IN ('null', '{}', '""', '')
  AND is_active = true
  AND restaurant_id IS NOT NULL
ON CONFLICT DO NOTHING;
