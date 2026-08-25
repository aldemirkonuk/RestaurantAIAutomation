-- Phase 32 gap: workflow status column for AI draft pipeline
-- procurement_conversations.status: PENDING_APPROVAL | APPROVED | DISCARDED | AUTO_SENT | DELIVERED | DRAFT
ALTER TABLE procurement_conversations
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'DRAFT';

COMMENT ON COLUMN procurement_conversations.status IS
  'Phase 32 AI draft workflow state: PENDING_APPROVAL | APPROVED | DISCARDED | AUTO_SENT | DELIVERED | DRAFT';

CREATE INDEX IF NOT EXISTS idx_conv_status_restaurant
  ON procurement_conversations(restaurant_id, status)
  WHERE status IS NOT NULL;

-- Provider auto-reply pre-approval flag (D-32-07 gate 3)
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT false;

-- Restaurant feature flags table (D-32-07 gate 1: paid tier auto-send)
CREATE TABLE IF NOT EXISTS restaurant_feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  auto_send_enabled BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_feature_flags_restaurant
  ON restaurant_feature_flags(restaurant_id);
