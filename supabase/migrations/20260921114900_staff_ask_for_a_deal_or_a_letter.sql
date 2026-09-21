-- Staff may ASK a manager to confirm a deal or to send a composer letter —
-- the founder's answer (3) of 2026-09-21 on the ADR 0175 amendment.
--
-- WHAT HE DECIDED
-- ---------------
-- *Staff may ask a manager to confirm a deal or to send a composer letter,
-- with the same request flow as drafted replies*: a request state, the exact
-- text or terms saved, and a manager releases it with one hold. Before this a
-- staff member was refused before the hold on both doors (the amendment's
-- third fork).
--
-- WHY A TABLE OF ITS OWN, NOT A STATUS ON procurement_conversations
-- ----------------------------------------------------------------
-- A drafted reply's request lives on its own PENDING_APPROVAL row
-- (20260921113500) because that row IS the letter the release sends. A deal
-- confirmation's letter is composed on the server from the terms at release,
-- and a composer letter becomes a conversation row only when it is queued. A
-- request parked as an outbound conversation row would be read as a letter by
-- every thread reader, and `procurement_conversations.status` has no CHECK and
-- no closed vocabulary, so the orchestrator's send claim (a NOT IN block-list,
-- `provider_conversation_agent.py` `_claim_conversation_for_send`) would treat
-- an unknown status as claimable. So a request is its own row here, and the
-- release is the ordinary sealed door (confirm-deal, or the composer's queue)
-- with the request's id.
--
-- WHAT A ROW SAYS
-- ---------------
--   kind            confirm_deal | house_letter
--   payload         the exact terms ({finalPrice, quantity, sendConfirmation})
--                   or the exact letter ({providerId, to, subject, body,
--                   orderId, templateId}) the staffer asked for
--   payload_sha256  sha256 of the payload's canonical form, so "released as
--                   written" is a comparison, not a memory
--   state           waiting -> released | closed
--   released_*      who released it, when, and whether as written
--   conversation_id the queued letter a composer request became
--
-- One waiting deal request per order (a later ask replaces nothing: it is
-- refused while one waits). Letters: any number.
--
-- Locked down in the same file (RLS on, one service_role policy, anon and
-- authenticated revoked); actor columns on public.users(user_id). Additive,
-- idempotent, assertions at the bottom.

CREATE TABLE IF NOT EXISTS public.vendor_send_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  order_id UUID REFERENCES public.procurement_orders(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting',
  released_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  released_as_written BOOLEAN,
  closed_reason TEXT,
  conversation_id UUID REFERENCES public.procurement_conversations(id) ON DELETE SET NULL,
  CONSTRAINT vendor_send_requests_kind_known CHECK (kind IN ('confirm_deal', 'house_letter')),
  CONSTRAINT vendor_send_requests_state_known CHECK (state IN ('waiting', 'released', 'closed')),
  CONSTRAINT vendor_send_requests_sha256 CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT vendor_send_requests_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT vendor_send_requests_deal_names_its_order CHECK (kind <> 'confirm_deal' OR order_id IS NOT NULL),
  CONSTRAINT vendor_send_requests_letter_names_its_vendor CHECK (kind <> 'house_letter' OR provider_id IS NOT NULL),
  CONSTRAINT vendor_send_requests_release_whole CHECK (
    (state = 'released') = (released_at IS NOT NULL)
    AND (released_at IS NULL OR released_as_written IS NOT NULL)
  ),
  CONSTRAINT vendor_send_requests_close_says_why CHECK ((state = 'closed') = (closed_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendor_send_requests_one_waiting_deal
  ON public.vendor_send_requests (order_id)
  WHERE kind = 'confirm_deal' AND state = 'waiting';

CREATE INDEX IF NOT EXISTS idx_vendor_send_requests_waiting
  ON public.vendor_send_requests (restaurant_id, kind, requested_at DESC)
  WHERE state = 'waiting';

ALTER TABLE public.vendor_send_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_send_requests_service_role ON public.vendor_send_requests;
CREATE POLICY vendor_send_requests_service_role
  ON public.vendor_send_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.vendor_send_requests FROM anon, authenticated;

COMMENT ON TABLE public.vendor_send_requests IS
  'A staff member''s request that a manager confirm a deal or send a composer letter (founder, 2026-09-21, ADR 0175 amendment answer 3). The exact terms or letter are kept in payload; the release is the ordinary sealed door carrying the request id. RLS on, service_role only.';

DO $$
DECLARE
  c TEXT;
  fk_target TEXT;
BEGIN
  IF to_regclass('public.vendor_send_requests') IS NULL THEN
    RAISE EXCEPTION 'vendor_send_requests was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.vendor_send_requests')) THEN
    RAISE EXCEPTION 'vendor_send_requests has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.vendor_send_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.vendor_send_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.vendor_send_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vendor_send_requests', 'INSERT')
  THEN
    RAISE EXCEPTION 'vendor_send_requests is still reachable by anon/authenticated';
  END IF;
  FOREACH c IN ARRAY ARRAY['requested_by', 'released_by'] LOOP
    SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
      INTO fk_target
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name
       AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
       AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE kcu.table_schema = 'public'
       AND kcu.table_name = 'vendor_send_requests'
       AND kcu.column_name = c
     LIMIT 1;
    IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
      RAISE EXCEPTION 'vendor_send_requests.% must reference public.users(user_id), found %', c, coalesce(fk_target, 'no foreign key');
    END IF;
  END LOOP;
  RAISE NOTICE 'vendor_send_requests: created, locked down, actor keys on public.users.';
END
$$;
