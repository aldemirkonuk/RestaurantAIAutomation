-- A send refused before it left closes its draft and says why — the founder's
-- answer (6) of 2026-09-21.
--
-- WHAT HE DECIDED
-- ---------------
-- Both send paths close the draft on a definite refusal, with the reason shown.
-- The relay's path does it with `RELAY_REFUSED` (ADR 0099, lane r5/relay). The
-- gateway's own in-process send — `approveDraft`, when GmailService refuses to
-- build the message (ADR 0172, `refusedBeforeSend`) — used to hand the draft
-- back to PENDING_APPROVAL for another tap that would be refused identically.
-- It now answers 422 and closes the draft as `SEND_REFUSED`, with the gateway's
-- own sentence kept here.
--
-- WHY NOT THE RELAY'S COLUMN
-- --------------------------
-- `relay_refusal_reason` (20260921113000) is scoped by its CHECK to
-- `status = 'RELAY_REFUSED'` and lives on a branch this lane does not carry. A
-- second column scoped to `SEND_REFUSED` keeps the two paths independent: each
-- names which door refused, and neither can write the other's state.
--
-- `procurement_conversations.status` has no CHECK of its own (measured by the
-- relay lane), so the new status needs no vocabulary change; the orchestrator's
-- send claim learns it as terminal in the same change
-- (`_SEND_TERMINAL_STATUSES`), so a replayed approval cannot re-claim a closed
-- row.
--
-- Additive: one nullable column and one CHECK over a column that starts NULL
-- on every existing row, so the CHECK validates against nothing old.

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS send_refusal_reason TEXT;

ALTER TABLE public.procurement_conversations
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_refusal_reason_scoped;
ALTER TABLE public.procurement_conversations
  ADD CONSTRAINT procurement_conversations_send_refusal_reason_scoped CHECK (
    send_refusal_reason IS NULL
    OR (status = 'SEND_REFUSED' AND btrim(send_refusal_reason) <> '')
  );

COMMENT ON COLUMN public.procurement_conversations.send_refusal_reason IS
  'Why the gateway''s own send refused this draft before anything left (ADR 0172 refusedBeforeSend). Set only with status SEND_REFUSED, which closes the draft (founder, 2026-09-21: a definite refusal closes, not retried).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
       AND column_name = 'send_refusal_reason'
  ) THEN
    RAISE EXCEPTION 'procurement_conversations.send_refusal_reason was not added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_conversations_send_refusal_reason_scoped'
       AND conrelid = 'public.procurement_conversations'::regclass
  ) THEN
    RAISE EXCEPTION 'the send-refusal scope CHECK is missing';
  END IF;
END
$$;
