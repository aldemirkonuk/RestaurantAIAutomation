-- A truck refused at the door can still be written about; a phoned-in order
-- can say when it was placed (owner-quarter sim F-669; founder S198).
--
-- WHAT WENT WRONG
-- ---------------
-- A truck refused at the door closes its order as FAILED (delivery.service.ts
-- failRefusedOrder) — the only writer of that state. F-516's door
-- (20270102300000_a_closed_order_gets_no_letter) refused to stage any letter
-- on a FAILED order, alongside CANCELLED and REJECTED. So the one letter the
-- house most needs after a refusal — "please credit us" or "please send the
-- right wine" — could not be staged on the order it is about.
--
-- WHAT THIS CHANGES
-- -----------------
-- 1. `stage_order_letter` stages nothing on CANCELLED or REJECTED only. A
--    FAILED order (refused at the door) gets its credit or replacement letter
--    like any other. The gateway's seal and send (closedOrderLetterRefusal)
--    and the agents (order_letter_door.ORDER_LETTER_CLOSED_STATUSES) drop
--    FAILED in the same change. Nothing is sent by this migration: a letter is
--    still staged for a person to read and send.
--    Everything else in the function is unchanged from 20270102300000: the
--    same keys, the same checks, the same live statuses, the same lock key,
--    the same FOR SHARE read. CREATE OR REPLACE keeps the grants; they are
--    restated below so this file reads whole.
--
-- 2. `procurement_orders.placed_on_stated` (date) and `placed_on_stated_by`.
--    A delivery nobody logged — ordered by phone — is booked at the door as
--    an order already delivered ("Logged at door", source 'retroactive'). The
--    door asks one optional question, "When was this ordered?" (Today /
--    Yesterday / Don't know). The answer is the HOUSE's calendar day, as the
--    person stated it (the phone stamps it, so an offline door keeps the day it
--    was asked on). NULL is "Don't know", the preselected answer. It is shown,
--    and it NEVER feeds the lead-time, fastest-days or cutoff estimates: a day
--    somebody remembers is not a measured order time, and a retroactive order
--    is kept out of lead time, on-time and fill rate altogether.
--    `placed_on_stated_by` references public.users(user_id) — the id the JWT
--    carries — NOT auth.users(id), the same as recurrence_status_by.

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

  -- F-516: an order the house closed gets no letter. F-669: a truck refused
  -- at the door (FAILED) is not the house closing the order — its credit or
  -- replacement letter is staged like any other.
  SELECT pg_catalog.upper((o.status)::text) INTO v_order_status
    FROM public.procurement_orders o
   WHERE o.id = r.order_id
     AND o.restaurant_id = r.restaurant_id
   FOR SHARE;

  IF v_order_status IN ('CANCELLED', 'REJECTED') THEN
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
  'The one door for an order''s vendor letter (ADR 0266, F-106; F-516; F-669). Under the per-order advisory lock: if the order is CANCELLED or REJECTED (read FOR SHARE) it writes nothing and returns {id:null, staged:false, order_status}; a FAILED order (a truck refused at the door) is staged like any other, for its credit or replacement letter; if the order already has a live outbound letter (PENDING_APPROVAL, AUTO_SEND_SCHEDULED, AUTO_SENDING, SENDING, SENT, AUTO_SENT, SEND_UNCONFIRMED; of type p_kind when given) it writes nothing and returns {id, staged:false}; otherwise it inserts p_row''s letter columns and returns {id, staged:true}. Called by ProviderCommunicationAgent._handle_order_created and ProviderConversationAgent._create_approval_request (order_inquiry). service_role only.';

REVOKE ALL ON FUNCTION public.stage_order_letter(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stage_order_letter(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_order_letter(jsonb, text) TO service_role;

-- 2. The day a phoned-in order was placed, as the door was told it.
ALTER TABLE public.procurement_orders
  ADD COLUMN IF NOT EXISTS placed_on_stated    date,
  ADD COLUMN IF NOT EXISTS placed_on_stated_by uuid;

ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_placed_on_stated_by_fkey,
  ADD  CONSTRAINT procurement_orders_placed_on_stated_by_fkey
       FOREIGN KEY (placed_on_stated_by)
       REFERENCES public.users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.procurement_orders.placed_on_stated IS
  'The house calendar day a phoned-in order was placed, as the person at the door stated it ("When was this ordered?": Today / Yesterday; NULL = Don''t know). Display only: never read by lead time, fastest days or cutoff estimates (F-669, founder S198).';
COMMENT ON COLUMN public.procurement_orders.placed_on_stated_by IS
  'public.users.user_id of the person who stated placed_on_stated. NULL when nobody stated it.';
