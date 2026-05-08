-- Phase 26 gap: add country field to restaurants for disambiguation
-- (same restaurant name in same city across different countries would be identical without this)
-- Also adds intra-organization uniqueness: an owner can't duplicate their own restaurant.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS country VARCHAR(100);

-- Soft uniqueness within an org: same owner can't register the same restaurant twice.
-- Different organizations can legitimately share a name+city+country (unrelated businesses).
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_org_name_city_country
  ON restaurants (organization_id, LOWER(name), LOWER(city), LOWER(country))
  WHERE organization_id IS NOT NULL AND city IS NOT NULL AND country IS NOT NULL;
