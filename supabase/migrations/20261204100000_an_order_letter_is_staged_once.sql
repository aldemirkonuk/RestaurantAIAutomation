-- An order holds one waiting draft, and its order letter is written once
-- (ADR 0266; owner-quarter sim F-106; COMMS-W24's server half, ADR 0260).
--
-- WHAT WENT WRONG
-- ---------------
-- Two agents each staged an outbound PENDING_APPROVAL letter for one order,
-- with no shared fence and nothing in the database against it:
--   - ProviderCommunicationAgent, when the order is created
--     (`_handle_order_created`, provider_communication_agent.py);
--   - ProviderConversationAgent, when the order is approved (approveOrder
--     always publishes `procurement.conversation_request` with intent
--     `order_inquiry`; `_create_approval_request` inserted with no check).
-- Every reader assumes one waiting row per order. With two, `approveDraft`'s
-- `.single()` answered 404 "No pending draft found", the seal and send-request
-- reads' `.maybeSingle()` answered 500, and the rail showed only the newest.
--
-- WHAT THIS ADDS
-- --------------
-- 1. `discard_reason`: why a draft was closed without being sent. Scoped by
--    its CHECK to status DISCARDED, like `send_refusal_reason` and
--    `relay_refusal_reason` (founder 2026-10-02, F7: its own column).
-- 2. A trigger that keeps one PENDING_APPROVAL row per (restaurant_id,
--    order_id), for every writer: when a row becomes PENDING_APPROVAL, the
--    older waiting rows are DISCARDED with a reason naming the newer one; a row
--    returned to PENDING_APPROVAL while a NEWER draft already waits (a released
--    send claim, a reverted schedule) is itself DISCARDED instead. Newest wins,
--    so the survivor is the row the rail and OrderLetter already show. Only
--    PENDING_APPROVAL is covered (founder 2026-10-02, F6); AUTO_SEND_SCHEDULED
--    is untouched.
-- 3. `stage_order_letter(p_row, p_kind)`: the one door for the ORDER LETTER.
--    It writes nothing, and returns the existing row, when the order already
--    has a live outbound letter (waiting, scheduled, sending or sent). Both
--    agents' order-letter inserts go through it, so whichever writes first
--    wins and the second write never happens (ADR 0260: "The W25 branch stops
--    the second write"). The trigger alone could not do that: it would let the
--    approval-time letter replace the create-time one the owner may have held.
--
-- WHY AN ADVISORY LOCK
-- --------------------
-- Check-then-insert races: two agent runs overlap (max_concurrent_tasks=10)
-- and the create-time writer can land after the approval-time one. The RPC and
-- the trigger take the same transaction-scoped advisory lock per
-- (restaurant_id, order_id), so the check and the write are one step. The lock
-- re-enters within a transaction, so the RPC's own insert passes its trigger.
-- Precedent: 20261201000000_a_vendor_has_one_primary_branch.
--
-- NOT IN THIS MIGRATION
-- ---------------------
-- Orders that ALREADY hold two waiting drafts are left as they are; readers
-- keep failing on them until the reconcile migration (PR-3, after a read-only
-- dry-run) discards the later one per the founder's F0 answer (2026-10-02:
-- the first-written survives) and adds the unique index as a backstop. The
-- trigger fires only when a row BECOMES PENDING_APPROVAL, so it never touches
-- an existing pair on its own.
--
-- Additive: one nullable column, one CHECK over a column that starts NULL on
-- every existing row, one trigger, two functions. Nothing is deleted.

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS discard_reason TEXT;

ALTER TABLE public.procurement_conversations
  DROP CONSTRAINT IF EXISTS procurement_conversations_discard_reason_scoped;
ALTER TABLE public.procurement_conversations
  ADD CONSTRAINT procurement_conversations_discard_reason_scoped CHECK (
    discard_reason IS NULL
    OR ((status)::text = 'DISCARDED' AND btrim(discard_reason) <> '')
  );

COMMENT ON COLUMN public.procurement_conversations.discard_reason IS
  'Why this draft was closed without being sent. Set only with status DISCARDED (procurement_conversations_discard_reason_scoped). Written by trg_proc_conv_one_pending_draft when a newer draft for the same order replaces it (ADR 0266, F-106). Older DISCARDED rows (regenerate) carry none.';

-- ── One waiting draft per order, newest wins ────────────────────────────────
CREATE OR REPLACE FUNCTION public.proc_conv_one_pending_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_newer uuid;
BEGIN
  IF NEW.order_id IS NULL OR (NEW.status)::text IS DISTINCT FROM 'PENDING_APPROVAL' THEN
    RETURN NEW;
  END IF;
  -- A row already waiting that is only being edited is not a new draft.
  IF TG_OP = 'UPDATE' AND (OLD.status)::text IS NOT DISTINCT FROM 'PENDING_APPROVAL' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'procurement_conversations.pending:' || NEW.restaurant_id::text || ':' || NEW.order_id::text,
      0
    )
  );

  -- A waiting row is never a closed one.
  NEW.discard_reason := NULL;

  -- Returned to waiting (a released claim, a reverted schedule) while a newer
  -- draft for the order already waits: the newer one stands. A fresh insert
  -- wins a tie on created_at (two rows written in one transaction share
  -- now()); only a row coming BACK to waiting breaks a tie by id.
  SELECT c.id INTO v_newer
    FROM public.procurement_conversations c
   WHERE c.restaurant_id = NEW.restaurant_id
     AND c.order_id = NEW.order_id
     AND (c.status)::text = 'PENDING_APPROVAL'
     AND c.id <> NEW.id
     AND (c.created_at > NEW.created_at
          OR (TG_OP = 'UPDATE' AND c.created_at = NEW.created_at AND c.id > NEW.id))
   ORDER BY c.created_at DESC, c.id DESC
   LIMIT 1;

  IF v_newer IS NOT NULL THEN
    NEW.status := 'DISCARDED';
    NEW.discard_reason :=
      'A newer draft for this order was already waiting (' || v_newer::text || ').';
    RETURN NEW;
  END IF;

  UPDATE public.procurement_conversations c
     SET status = 'DISCARDED',
         discard_reason =
           'Replaced by a newer draft for this order (' || NEW.id::text || ').'
           || CASE WHEN c.send_requested_at IS NOT NULL
                   THEN ' The send request on it no longer applies.'
                   ELSE '' END
   WHERE c.restaurant_id = NEW.restaurant_id
     AND c.order_id = NEW.order_id
     AND (c.status)::text = 'PENDING_APPROVAL'
     AND c.id <> NEW.id;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.proc_conv_one_pending_draft() IS
  'Keeps one PENDING_APPROVAL row per (restaurant_id, order_id): when a row becomes PENDING_APPROVAL the older waiting rows are DISCARDED with a discard_reason naming it, and a row returned to waiting while a newer one waits is DISCARDED instead. Shares stage_order_letter''s advisory lock. ADR 0266 (F-106; COMMS-W24 server half).';

DROP TRIGGER IF EXISTS trg_proc_conv_one_pending_draft ON public.procurement_conversations;
CREATE TRIGGER trg_proc_conv_one_pending_draft
  BEFORE INSERT OR UPDATE OF status ON public.procurement_conversations
  FOR EACH ROW EXECUTE FUNCTION public.proc_conv_one_pending_draft();

-- ── The one door for the order letter ───────────────────────────────────────
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
  'The one door for an order''s vendor letter (ADR 0266, F-106). Under the per-order advisory lock: if the order already has a live outbound letter (PENDING_APPROVAL, AUTO_SEND_SCHEDULED, AUTO_SENDING, SENDING, SENT, AUTO_SENT, SEND_UNCONFIRMED; of type p_kind when given) it writes nothing and returns {id, staged:false}; otherwise it inserts p_row''s letter columns and returns {id, staged:true}. Called by ProviderCommunicationAgent._handle_order_created and ProviderConversationAgent._create_approval_request (order_inquiry). service_role only.';

REVOKE ALL ON FUNCTION public.stage_order_letter(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stage_order_letter(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_order_letter(jsonb, text) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
       AND column_name = 'discard_reason'
  ) THEN
    RAISE EXCEPTION 'procurement_conversations.discard_reason was not added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_conversations_discard_reason_scoped'
       AND conrelid = 'public.procurement_conversations'::regclass
  ) THEN
    RAISE EXCEPTION 'the discard-reason scope CHECK is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_proc_conv_one_pending_draft'
       AND tgrelid = 'public.procurement_conversations'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_proc_conv_one_pending_draft is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'stage_order_letter'
  ) THEN
    RAISE EXCEPTION 'public.stage_order_letter is missing';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.stage_order_letter(jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'stage_order_letter must not be callable by anon or authenticated';
  END IF;
END
$$;
