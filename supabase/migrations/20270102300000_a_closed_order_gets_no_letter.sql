-- A closed order gets no letter (owner-quarter sim F-516).
--
-- WHAT WENT WRONG
-- ---------------
-- An order's vendor letter is drafted in the background: createOrder queues
-- the create-time draft, approveOrder publishes the approval-time one. Either
-- can land after the manager cancelled the order. cancelOrder cascades only the
-- drafts that already exist (procurement.service.ts cancelOrder), and
-- `stage_order_letter` (20261221093000_an_order_letter_is_staged_once) never
-- read the order. A letter staged after the cascade waited as PENDING_APPROVAL
-- on a CANCELLED order, /communications offered it as "Read it and send", and
-- the send went out: the vendor ships wine for an order the house shows as
-- cancelled.
--
-- WHAT THIS CHANGES
-- -----------------
-- `stage_order_letter` reads the order's status under the per-order advisory
-- lock and stages nothing when it is CANCELLED, REJECTED or FAILED. It returns
-- {id: null, staged: false, order_status: <status>} so the agent can tell
-- "the order is closed" from "the order already has its letter".
-- COMPLETED is left alone: a reply about a delivered order is still a letter.
--
-- The order row is read FOR SHARE. cancelOrder's status UPDATE then waits for
-- a staging transaction that read the order open, so the letter is committed
-- before cancelOrder's cascade runs and the cascade closes it; a staging
-- transaction that arrives after the UPDATE committed reads the closed status
-- and stages nothing. Without the row lock the read and the cancel could
-- interleave and leave a letter neither saw.
--
-- The gateway's seal and send refuse the same three states
-- (closedOrderLetterRefusal, procurement.service.ts), for any letter staged
-- before this migration applied.
--
-- Everything else in the function is unchanged: the same keys, the same
-- checks, the same live statuses, the same lock key. CREATE OR REPLACE keeps
-- the grants; they are restated below so this file reads whole.

CREATE OR REPLACE FUNCTION public.stage_order_letter(p_row jsonb, p_kind text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  r public.procurement_conversations;
  v_existing uuid;
  v_id uuid;
  v_unknown text;
  v_order_status text;
BEGIN
  -- A key this door does not write would be dropped in silence; refuse it.
  SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO v_unknown
    FROM pg_catalog.jsonb_object_keys(p_row) AS k
   WHERE k <> ALL (ARRAY[
     'order_id', 'restaurant_id', 'provider_id', 'direction', 'channel',
     'message_text', 'content', 'ai_generated', 'status', 'outbound_email_type',
     'round_count', 'disclaimer_appended', 'constraint_flags', 'rolling_summary',
     'conversation_summary', 'email_headers'
   ]);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'stage_order_letter does not write: %', v_unknown
      USING ERRCODE = '22023';
  END IF;

  r := pg_catalog.jsonb_populate_record(NULL::public.procurement_conversations, p_row);

  IF r.order_id IS NULL OR r.restaurant_id IS NULL THEN
    RAISE EXCEPTION 'stage_order_letter needs an order_id and a restaurant_id'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.lower(r.direction) IS DISTINCT FROM 'outbound' THEN
    RAISE EXCEPTION 'stage_order_letter writes outbound letters only'
      USING ERRCODE = '22023';
  END IF;
  IF r.status IS NULL OR (r.status)::text NOT IN ('PENDING_APPROVAL', 'AUTO_SENT') THEN
    RAISE EXCEPTION 'stage_order_letter stages PENDING_APPROVAL or AUTO_SENT, not %', r.status
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'procurement_conversations.pending:' || r.restaurant_id::text || ':' || r.order_id::text,
      0
    )
  );

  -- F-516: an order the house closed gets no letter.
  SELECT pg_catalog.upper((o.status)::text) INTO v_order_status
    FROM public.procurement_orders o
   WHERE o.id = r.order_id
     AND o.restaurant_id = r.restaurant_id
   FOR SHARE;

  IF v_order_status IN ('CANCELLED', 'REJECTED', 'FAILED') THEN
    RETURN pg_catalog.jsonb_build_object(
      'id', NULL, 'staged', false, 'order_status', v_order_status
    );
  END IF;

  SELECT c.id INTO v_existing
    FROM public.procurement_conversations c
   WHERE c.restaurant_id = r.restaurant_id
     AND c.order_id = r.order_id
     AND pg_catalog.lower(c.direction) = 'outbound'
     AND (c.status)::text IN (
       'PENDING_APPROVAL', 'AUTO_SEND_SCHEDULED', 'AUTO_SENDING',
       'SENDING', 'SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED'
     )
     AND (p_kind IS NULL OR (c.outbound_email_type)::text = p_kind)
   ORDER BY c.created_at DESC NULLS LAST, c.id DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('id', v_existing, 'staged', false);
  END IF;

  INSERT INTO public.procurement_conversations (
    order_id, restaurant_id, provider_id, direction, channel,
    message_text, content, ai_generated, status, outbound_email_type,
    round_count, disclaimer_appended, constraint_flags, rolling_summary,
    conversation_summary, email_headers
  ) VALUES (
    r.order_id, r.restaurant_id, r.provider_id, r.direction, r.channel,
    r.message_text, r.content, COALESCE(r.ai_generated, false), r.status,
    r.outbound_email_type, COALESCE(r.round_count, 0),
    COALESCE(r.disclaimer_appended, false),
    COALESCE(r.constraint_flags, '{}'::jsonb), r.rolling_summary,
    r.conversation_summary, COALESCE(r.email_headers, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object('id', v_id, 'staged', true);
END
$$;

COMMENT ON FUNCTION public.stage_order_letter(jsonb, text) IS
  'The one door for an order''s vendor letter (ADR 0266, F-106; F-516). Under the per-order advisory lock: if the order is CANCELLED, REJECTED or FAILED (read FOR SHARE) it writes nothing and returns {id:null, staged:false, order_status}; if the order already has a live outbound letter (PENDING_APPROVAL, AUTO_SEND_SCHEDULED, AUTO_SENDING, SENDING, SENT, AUTO_SENT, SEND_UNCONFIRMED; of type p_kind when given) it writes nothing and returns {id, staged:false}; otherwise it inserts p_row''s letter columns and returns {id, staged:true}. Called by ProviderCommunicationAgent._handle_order_created and ProviderConversationAgent._create_approval_request (order_inquiry). service_role only.';

REVOKE ALL ON FUNCTION public.stage_order_letter(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stage_order_letter(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_order_letter(jsonb, text) TO service_role;
