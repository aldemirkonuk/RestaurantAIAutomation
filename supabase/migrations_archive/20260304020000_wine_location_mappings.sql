-- Wine-to-Location Mappings
CREATE TABLE IF NOT EXISTS wine_location_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    wine_id VARCHAR(255) NOT NULL,
    location_id UUID REFERENCES storage_locations(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, wine_id)
);

CREATE INDEX IF NOT EXISTS idx_wlm_restaurant ON wine_location_mappings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_wlm_location ON wine_location_mappings(location_id);

-- Support soft delete for storage_locations
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
