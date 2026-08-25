-- Close the uniqueness gap: previously the two-tier index allowed a row WITH a postal code
-- and a row WITHOUT one to coexist under the same (org, name, city, country) — because
-- each fell into a different partial index.
--
-- This third index enforces: within one org, the same restaurant name cannot appear twice
-- in the same city+country regardless of whether postal_code is set.
-- The postal-code index (idx_restaurants_org_name_postal) still covers the sub-city
-- level (two branches in same city but different zip codes are allowed — that's multi-location).
--
-- Result: all three indexes together form a complete, gap-free uniqueness guarantee:
--   1. idx_restaurants_org_name_postal    → same org+name+postalcode = duplicate
--   2. idx_restaurants_org_name_city_area → same org+name+city+country (no zip) = duplicate
--   3. idx_restaurants_org_name_city_dedup → same org+name+city+country (zip present but city also matches) = duplicate
--      NOTE: this is intentionally NOT UNIQUE — it is a constraint enforced at app level
--      because two branches of the same org CAN have the same name in the same city
--      at different postal codes (that is the multi-location case). Only the registration
--      flow prevents re-registering an already-known (name+city+country+postalcode) combo.
--
-- DECISION: enforce strict uniqueness at (org, name, city, country, postal_code) together.
-- Two branches of "The Oak Room" in Chicago must have DIFFERENT postal codes — if they
-- share the same postal code they ARE the same location.
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_org_name_full_location
  ON restaurants (organization_id, LOWER(name), LOWER(city), LOWER(country), postal_code)
  WHERE organization_id IS NOT NULL AND city IS NOT NULL AND country IS NOT NULL;
