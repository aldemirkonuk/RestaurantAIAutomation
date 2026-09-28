-- ADR 0121: one Meta phone number belongs to one live credential; an inbound
-- provider message has one durable receipt per house. Existing duplicate rows
-- deliberately fail this migration for review; no tenant history is discarded.
-- No business-row probes. The migration runner owns the transaction.

CREATE UNIQUE INDEX IF NOT EXISTS uq_house_text_sender_credentials_meta_number_live
  ON public.house_text_sender_credentials (sender_ref)
  WHERE provider = 'meta_cloud' AND revoked_at IS NULL AND sender_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_conversations_whatsapp_inbound
  ON public.procurement_conversations (restaurant_id, message_id)
  WHERE channel = 'whatsapp' AND direction = 'inbound' AND message_id IS NOT NULL;

COMMENT ON INDEX public.uq_house_text_sender_credentials_meta_number_live IS
  'A Meta phone number id resolves to only one live credential across houses. Revoked credential history may retain the id.';
COMMENT ON INDEX public.uq_procurement_conversations_whatsapp_inbound IS
  'Concurrent Meta webhook retries share one inbound receipt per house, including conversations with no order_id.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.uq_house_text_sender_credentials_meta_number_live'::regclass
      AND i.indrelid = 'public.house_text_sender_credentials'::regclass
      AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%(sender_ref)%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%meta_cloud%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%revoked_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'Meta live phone number uniqueness was not established';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.uq_procurement_conversations_whatsapp_inbound'::regclass
      AND i.indrelid = 'public.procurement_conversations'::regclass
      AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%(restaurant_id, message_id)%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%whatsapp%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%inbound%'
  ) THEN
    RAISE EXCEPTION 'WhatsApp inbound receipt uniqueness was not established';
  END IF;
END $$;
