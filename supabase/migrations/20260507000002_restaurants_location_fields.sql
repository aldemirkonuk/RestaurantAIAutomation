-- Extended location fields for restaurant disambiguation.
-- Design rationale: every country has (postal_code, neighborhood, state_province)
-- just named differently. This schema works for US now and all future markets.
--
-- US:      state_province="IL", postal_code="60601", neighborhood="River North"
-- Turkey:  state_province="Antalya", postal_code="07050", neighborhood="Konyaaltı"
-- UK:      state_province="Greater London", postal_code="SW1A 1AA", neighborhood="Mayfair"
-- France:  state_province="Île-de-France", postal_code="75001", neighborhood="Le Marais"

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS state_province VARCHAR(100);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(100);

-- Drop old city+country uniqueness index (replaced by two more precise indexes below).
DROP INDEX IF EXISTS idx_restaurants_org_name_city_country;

-- Primary dedup: same org can't have two branches with the same name in the same postal code.
-- Postal codes are precise enough globally (US zip, UK postcode, TR posta kodu, etc.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_org_name_postal
  ON restaurants (organization_id, LOWER(name), postal_code)
  WHERE organization_id IS NOT NULL AND postal_code IS NOT NULL;

-- Fallback dedup: when postal code is not provided, fall back to city+country+neighborhood.
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_org_name_city_area
  ON restaurants (organization_id, LOWER(name), LOWER(city), LOWER(country), LOWER(COALESCE(neighborhood, '')))
  WHERE organization_id IS NOT NULL AND postal_code IS NULL AND city IS NOT NULL AND country IS NOT NULL;

-- ============================================================================
-- FUTURE PHASES — add via new migrations when needed:
-- ============================================================================
-- Phase N:  ADD COLUMN latitude DECIMAL(10,8);
--           ADD COLUMN longitude DECIMAL(11,8);
--           CREATE INDEX idx_restaurants_location ON restaurants USING gist(
--             point(longitude, latitude)
--           );
-- Phase N:  ADD COLUMN google_place_id VARCHAR(100) UNIQUE;  -- Google Places API
-- Phase N:  ADD COLUMN address_line2 VARCHAR(255);           -- Suite/floor number
-- Phase N:  CREATE TABLE restaurant_addresses (              -- Normalized multi-address support
--             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--             restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
--             address_type VARCHAR(50) DEFAULT 'trading',    -- trading | registered | delivery
--             full_address JSONB,
--             is_primary BOOLEAN DEFAULT false,
--             created_at TIMESTAMPTZ DEFAULT NOW()
--           );
