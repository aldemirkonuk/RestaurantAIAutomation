-- ONE OPEN VENDOR CONVERSATION PER KIND. F-568 residual (owner-quarter sim,
-- wave 16, vendor sheet Actions).
--
-- WHAT WAS WRONG: the vendor sheet's outreach and onboarding actions open a
-- `provider_conversation_sessions` row through `openSessionOnce`
-- (provider-intelligence.controller.ts), which reads for an active session of
-- the same vendor and kind and inserts only when none is found. Two requests
-- at the same instant both read "none" and both insert: nothing in the table
-- forbade two active rows (baseline `20260805000000_baseline_from_production.sql`,
-- CREATE TABLE public.provider_conversation_sessions; its indexes are all
-- plain). The agent acts on the newest active session only, so every extra
-- row is an orphan the vendor page still lists as running.
--
-- THE FIX: a unique partial index on (provider_id, restaurant_id,
-- session_type) WHERE status = 'active'. A losing concurrent insert now fails
-- with 23505 and the gateway answers it with the row that won.
--
-- EXISTING DUPLICATES: not measured against production (no production call
-- from this lane). So the index is built only after any older duplicates are
-- closed, in this same transaction under a lock that holds off new inserts:
-- for each (vendor, house, kind) the newest active row (created_at, then id)
-- stays active, the others become 'abandoned' (a status the CHECK already
-- admits) with closed_at stamped if it was empty. Nothing is deleted; the
-- closed rows keep their messages, drafts and history.
--
-- NOT CHANGED: 'waiting_response', 'paused_for_approval' and
-- 'follow_up_scheduled' rows are not counted; the gateway's open-once read
-- looks only at 'active', and so does this index.
SET local statement_timeout = '120s';

LOCK TABLE public.provider_conversation_sessions IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY provider_id, restaurant_id, session_type
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS rn
    FROM public.provider_conversation_sessions
   WHERE status = 'active'
)
UPDATE public.provider_conversation_sessions s
   SET status = 'abandoned',
       closed_at = coalesce(s.closed_at, now())
  FROM ranked r
 WHERE s.id = r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pcs_one_active_per_kind
  ON public.provider_conversation_sessions (provider_id, restaurant_id, session_type)
  WHERE status = 'active';

COMMENT ON INDEX public.uq_pcs_one_active_per_kind IS
  'One active conversation per vendor, house and kind (F-568). A second insert fails with 23505 and the gateway returns the active row instead (openSessionOnce).';
