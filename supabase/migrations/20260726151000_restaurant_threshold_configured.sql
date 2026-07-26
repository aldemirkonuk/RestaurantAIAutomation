-- Get Started Overhaul: "activated" = menu_uploaded AND a default threshold
-- has been explicitly set (not just relying on the column's DEFAULT 3, which
-- would make every restaurant look "configured" from row creation).

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS threshold_configured BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN restaurants.threshold_configured IS
  'True once an owner/manager has explicitly confirmed default_threshold_min via the get-started flow (as opposed to it merely holding its schema default). Used to compute "activated" alongside menu_uploaded.';
