-- Phase 32: Provider Outbound Communication Engine
-- Adds provider intelligence JSONB columns and procurement_conversations additions

-- 1. Provider intelligence columns (D-32-09)
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS profile_foundational JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS profile_dynamic      JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_providers_profile_foundational ON providers
  USING gin(profile_foundational)
  WHERE profile_foundational != '{}';

CREATE INDEX IF NOT EXISTS idx_providers_profile_dynamic ON providers
  USING gin(profile_dynamic)
  WHERE profile_dynamic != '{}';

-- 2. procurement_conversations additions (RESEARCH.md GAP-3 + Phase 32 requirements)
ALTER TABLE procurement_conversations
  ADD COLUMN IF NOT EXISTS restaurant_id       UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS outbound_email_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS round_count         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS constraint_flags    JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS disclaimer_appended BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rolling_summary     TEXT;

-- Backfill restaurant_id from procurement_orders join (GAP-3 mitigation)
UPDATE procurement_conversations pc
SET restaurant_id = po.restaurant_id
FROM procurement_orders po
WHERE pc.order_id = po.id
  AND pc.restaurant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conv_restaurant_id
  ON procurement_conversations(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_conv_status_restaurant
  ON procurement_conversations(restaurant_id, status)
  WHERE status = 'PENDING_APPROVAL';

-- Constraint: only valid outbound email type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_outbound_email_type'
      AND table_name = 'procurement_conversations'
  ) THEN
    ALTER TABLE procurement_conversations
      ADD CONSTRAINT chk_outbound_email_type CHECK (
        outbound_email_type IS NULL OR
        outbound_email_type IN ('PRICE_INQUIRY','DEMAND_OFFER','PROMO_INQUIRY','WINE_INQUIRY')
      );
  END IF;
END $$;
