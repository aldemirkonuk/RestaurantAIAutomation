-- Migration: Add AI Conversation Approval Fields
-- Date: 2026-01-13
-- Description: Extends procurement_conversations table to support manager approval workflow
--              for AI-generated messages (80% push notifications + 20% OneTap integration)

-- Add approval tracking fields to procurement_conversations
ALTER TABLE procurement_conversations 
ADD COLUMN IF NOT EXISTS manager_approval_status VARCHAR(20) DEFAULT 'pending'
  CHECK (manager_approval_status IN ('pending', 'approved', 'modified', 'rejected')),
ADD COLUMN IF NOT EXISTS manager_approved_message TEXT,
ADD COLUMN IF NOT EXISTS manager_notes TEXT,
ADD COLUMN IF NOT EXISTS conversation_context JSONB,
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS approval_channel VARCHAR(20)
  CHECK (approval_channel IN ('push_notification', 'onetap_center', 'web_app')),
ADD COLUMN IF NOT EXISTS time_to_approval_seconds INTEGER;

-- Add index for pending conversations (performance optimization)
CREATE INDEX IF NOT EXISTS idx_conversations_pending 
  ON procurement_conversations(manager_approval_status, paused_at) 
  WHERE manager_approval_status = 'pending';

-- Add index for notification tracking
CREATE INDEX IF NOT EXISTS idx_conversations_notifications
  ON procurement_conversations(notification_sent, approval_channel)
  WHERE notification_sent = true;

-- Add comment for documentation
COMMENT ON COLUMN procurement_conversations.manager_approval_status IS 'AI message approval status: pending (awaiting manager), approved (sent as-is), modified (manager edited), rejected (cancelled)';
COMMENT ON COLUMN procurement_conversations.manager_approved_message IS 'If manager modified the AI message, stores the edited version';
COMMENT ON COLUMN procurement_conversations.manager_notes IS 'Manager notes or reasoning for approval/rejection';
COMMENT ON COLUMN procurement_conversations.conversation_context IS 'Full conversation history and negotiation context for manager reference';
COMMENT ON COLUMN procurement_conversations.paused_at IS 'Timestamp when AI paused for manager approval';
COMMENT ON COLUMN procurement_conversations.resumed_at IS 'Timestamp when manager approved and AI resumed';
COMMENT ON COLUMN procurement_conversations.notification_sent IS 'Whether push notification was sent to manager';
COMMENT ON COLUMN procurement_conversations.approval_channel IS 'Channel used for approval: push_notification (80%), onetap_center (20%), or web_app';
COMMENT ON COLUMN procurement_conversations.time_to_approval_seconds IS 'Performance metric: time from pause to approval';

-- Create view for pending approvals (convenience for frontend)
CREATE OR REPLACE VIEW pending_ai_approvals AS
SELECT 
  c.id AS conversation_id,
  c.order_id,
  c.restaurant_id,
  c.provider_id,
  p.name AS provider_name,
  c.message_text AS ai_message,
  c.conversation_context,
  c.paused_at,
  c.notification_sent,
  EXTRACT(EPOCH FROM (NOW() - c.paused_at)) AS wait_time_seconds,
  o.wine_name,
  o.quantity AS order_quantity,
  o.target_price_per_bottle
FROM procurement_conversations c
JOIN providers p ON c.provider_id = p.id
LEFT JOIN procurement_orders o ON c.order_id = o.id
WHERE c.manager_approval_status = 'pending'
ORDER BY c.paused_at ASC;

COMMENT ON VIEW pending_ai_approvals IS 'Real-time view of AI conversations awaiting manager approval';

