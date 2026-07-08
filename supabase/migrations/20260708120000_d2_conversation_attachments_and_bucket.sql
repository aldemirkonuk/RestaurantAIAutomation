-- D2: persist vendor email attachments (refs) + a private storage bucket.
-- Applied to the live project (exzueerziesmczwlhomd) via the Supabase MCP on 2026-07-08;
-- committed here for repo/version-control parity.

CREATE TABLE IF NOT EXISTS public.conversation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.procurement_conversations(id) ON DELETE CASCADE,
  order_id UUID,
  restaurant_id UUID,
  provider_id UUID,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT NOT NULL,
  sha256 TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_attach_conversation ON public.conversation_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_attach_order ON public.conversation_attachments(order_id);
CREATE INDEX IF NOT EXISTS idx_conv_attach_restaurant ON public.conversation_attachments(restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_attach_sha ON public.conversation_attachments(conversation_id, sha256) WHERE sha256 IS NOT NULL;

-- Backend uses the service-role key (bypasses RLS). Enable RLS with no public policy so the
-- table is server-only; attachments are served through the API via signed URLs.
ALTER TABLE public.conversation_attachments ENABLE ROW LEVEL SECURITY;

-- Private bucket for the persisted bytes (25 MB cap, image/PDF only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vendor-attachments', 'vendor-attachments', false, 26214400,
        ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif','application/pdf'])
ON CONFLICT (id) DO NOTHING;
