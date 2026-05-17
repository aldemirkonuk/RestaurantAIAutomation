-- ============================================================================
-- Ensure procurement_orders and provider_knowledge tables exist with all
-- columns required by the API gateway services.
--
-- Root causes fixed:
--   1. procurement_orders may be absent in production → CREATE TABLE IF NOT EXISTS
--   2. provider_knowledge exists but is missing `is_active` and `version`
--      columns → ALTER TABLE ADD COLUMN IF NOT EXISTS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. procurement_orders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurement_orders (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id         UUID        REFERENCES restaurants(id) ON DELETE CASCADE,
  provider_id           UUID        REFERENCES providers(id) ON DELETE CASCADE,
  order_number          TEXT,
  wine_name             TEXT,
  quantity              INTEGER,
  final_confirmed_cost  NUMERIC,
  actual_delivery       DATE,
  status                TEXT        DEFAULT 'pending',
  source                TEXT        DEFAULT 'manual',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. provider_knowledge — create if absent, then patch missing columns
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_knowledge (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      UUID        REFERENCES providers(id) ON DELETE CASCADE,
  category         TEXT        NOT NULL,
  subcategory      TEXT,
  label            TEXT,
  attributes       JSONB       DEFAULT '{}',
  confidence       NUMERIC     DEFAULT 0.8,
  verified         BOOLEAN     DEFAULT false,
  verified_by      UUID,
  version          INTEGER     DEFAULT 1,
  is_active        BOOLEAN     DEFAULT true,
  previous_value   JSONB,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Patch the columns if the table already existed without them
ALTER TABLE provider_knowledge ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT true;
ALTER TABLE provider_knowledge ADD COLUMN IF NOT EXISTS version        INTEGER DEFAULT 1;
ALTER TABLE provider_knowledge ADD COLUMN IF NOT EXISTS previous_value JSONB;

-- ----------------------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_procurement_orders_provider_id
  ON procurement_orders(provider_id);

CREATE INDEX IF NOT EXISTS idx_procurement_orders_restaurant_id
  ON procurement_orders(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_provider_knowledge_provider_id
  ON provider_knowledge(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_knowledge_category
  ON provider_knowledge(category);

CREATE INDEX IF NOT EXISTS idx_provider_knowledge_active
  ON provider_knowledge(provider_id, is_active)
  WHERE is_active = true;
