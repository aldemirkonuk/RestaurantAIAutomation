-- An order holds one waiting draft: settle the pairs already there, then
-- index it (ADR 0266, F-106 PR-3; founder F0, 2026-10-02: the first-written
-- survives).
--
-- WHY
-- ---
-- `an_order_letter_is_staged_once` (PR-1) stops a SECOND order letter from
-- being written, and its trigger keeps one PENDING_APPROVAL row per
-- (restaurant_id, order_id) from then on. It left orders that ALREADY held
-- two waiting drafts as they were. Every reader of the waiting draft assumes
-- one row (`approveDraft`'s `.single()`, the seal and send-request reads'
-- `.maybeSingle()`), so those orders answered 404/500 until settled.
--
-- WHAT THIS DOES
-- --------------
-- 1. Reconcile. Within each (restaurant_id, order_id), the PENDING_APPROVAL
--    rows are ranked `created_at ASC NULLS LAST, id ASC` (F0: the
--    first-written survives; it is the create-time letter, and the row an
--    owner's hold was placed on, since a seal is issued only while one draft
--    waits). Every other waiting row becomes DISCARDED with a discard_reason
--    naming the survivor. Only PENDING_APPROVAL is touched (F6); nothing is
--    deleted.
-- 2. A partial unique index, (restaurant_id, order_id) WHERE PENDING_APPROVAL,
--    as the backstop under the trigger. With the trigger in place no writer
--    meets its 23505; it catches a writer that bypasses the trigger.
--
-- The production dry run (scripts/f106_reconcile_dry_run.sql, 2026-10-08)
-- found no order with two waiting drafts, so step 1 is expected to change
-- nothing there. It stays because any other database built from these
-- migrations (a branch, a restore) may hold pairs, and the index cannot be
-- built over a pair.
--
-- The table is locked ACCESS EXCLUSIVE first (lock_timeout 5s), so no writer
-- races the reconcile and the index build has no lock upgrade (ADR 0266's
-- design §2d; `an_order_letter_is_staged_once` needed no prologue because its
-- first statement already took that lock). The UPDATE makes rows DISCARDED,
-- never PENDING_APPROVAL, so the one-pending trigger returns early for each.

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.procurement_conversations IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgname = 'trg_proc_conv_one_pending_draft'
       AND tgrelid = 'public.procurement_conversations'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'an_order_letter_is_staged_once must be applied first: trg_proc_conv_one_pending_draft is missing';
  END IF;
END
$$;

-- ── 1. Reconcile: the first-written waiting draft survives ─────────────────
WITH ranked AS (
  SELECT c.id,
         first_value(c.id) OVER w AS survivor,
         row_number()      OVER w AS rn
    FROM public.procurement_conversations c
   WHERE c.order_id IS NOT NULL
     AND (c.status)::text = 'PENDING_APPROVAL'
  WINDOW w AS (PARTITION BY c.restaurant_id, c.order_id
               ORDER BY c.created_at ASC NULLS LAST, c.id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
)
UPDATE public.procurement_conversations c
   SET status = 'DISCARDED',
       discard_reason =
         'A letter for this order was already waiting (' || r.survivor::text
         || '). Settled by the F-106 reconcile (ADR 0266, F0: the first-written survives).'
         || CASE WHEN c.send_requested_at IS NOT NULL
                 THEN ' The send request on it no longer applies.'
                 ELSE '' END
  FROM ranked r
 WHERE c.id = r.id
   AND r.rn > 1;

-- ── 2. The backstop index ──────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_proc_conv_one_pending_draft_per_order
  ON public.procurement_conversations (restaurant_id, order_id)
  WHERE ((status)::text = 'PENDING_APPROVAL');

COMMENT ON INDEX public.uniq_proc_conv_one_pending_draft_per_order IS
  'At most one PENDING_APPROVAL letter per (restaurant_id, order_id). Backstop under trg_proc_conv_one_pending_draft and stage_order_letter (ADR 0266, F-106).';

-- ── Asserts ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = 'public.uniq_proc_conv_one_pending_draft_per_order'::regclass
     AND i.indisunique
     AND i.indisvalid;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'uniq_proc_conv_one_pending_draft_per_order is missing, not unique, or not valid';
  END IF;
  IF v_def NOT LIKE '%(restaurant_id, order_id)%'
     OR v_def NOT LIKE '%PENDING_APPROVAL%' THEN
    RAISE EXCEPTION 'uniq_proc_conv_one_pending_draft_per_order has the wrong shape: %', v_def;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_conversations
     WHERE order_id IS NOT NULL AND (status)::text = 'PENDING_APPROVAL'
     GROUP BY restaurant_id, order_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'an order still holds two waiting drafts after the reconcile';
  END IF;
END
$$;
