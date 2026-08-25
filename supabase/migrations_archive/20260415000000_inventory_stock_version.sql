-- BUG-01: Add optimistic locking version column to restaurant_inventory
-- Safe: DEFAULT 0 means existing rows start at version 0, no data loss.

ALTER TABLE restaurant_inventory
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Index to support the WHERE version = N lookup efficiently
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_version
  ON restaurant_inventory (id, version);

COMMENT ON COLUMN restaurant_inventory.version IS
  'Optimistic locking counter. Incremented on every stock_live update. '
  'Update MUST include WHERE version = expected_version to prevent lost updates.';
