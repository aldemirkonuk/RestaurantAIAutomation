-- A relay refusal closes the draft, and does not retry it — ADR 0099,
-- founder answer 2026-09-21.
--
-- THE FORK THIS CLOSES
-- ---------------------
-- ADR 0099's 2026-09-19 answer ("relay 4xx = split by code, 400/403/422
-- final, 401 parks") called a 400/403/422 relay refusal "definite" and had
-- `ProviderConversationAgent._release_send_claim` hand the conversation's
-- claim back to its PRIOR status (DRAFT or PENDING_APPROVAL) and re-raise, so
-- `BaseAgent._process_with_retry` / the message bus retried the send. The
-- founder's 2026-09-21 answer narrows that: a 400/403/422 is the relay's own
-- doors deciding, BEFORE any transport, that this exact request cannot go
-- out — a malformed body, a recipient or conversation outside the house's
-- book, or a blocked guardrail. Retrying the identical request refuses it
-- again, identically; only a person editing the draft changes the outcome.
-- What he chose: option (b) of the round-6 relay question, "Close, no
-- retry". His own words were the delegation: "do the best option from UI
-- and UX standpoint, if needed change your decision and build again". The
-- same day's answer on this route: a header refusal answers a final 422,
-- not 200 success:false, and the draft closes with the reason shown. That
-- last sentence is the recorded answer, not a quote. ADR 0099's
-- 2026-09-21 bracket says which words are his.
--
-- WHAT THIS MIGRATION ADDS
-- --------------------------
-- Only a place to hold the reason. The new terminal status word itself
-- (`RELAY_REFUSED`) needs no schema change to become legal data:
-- `procurement_conversations.status` is `character varying(20)` with NO
-- CHECK constraint at all — confirmed again here, the same fact the
-- previous migration (20260927140000) already found and recorded in its own
-- header ("that table's status column carries no CHECK constraint at all,
-- so the value never had to be declared"). That gap is NOT closed here: the
-- column is written from 20+ call sites across apps/api-gateway/src and
-- services/agent-orchestrator (relay, letters composer, inbound parsing,
-- retention, conversations, providers — a repo-wide grep for
-- `procurement_conversations` finds them), so a single enum-wide CHECK
-- covering every value any of them writes is a cross-cutting change of its
-- own, not a lane-scoped one, and is left as an explicit open item below
-- rather than guessed at here.
--
-- `relay_refusal_reason` is new: a nullable TEXT column that holds the
-- gateway's own sentence — the same text `email_composer_service.py`
-- already produces as `gateway refused the send: HTTP {code} — {detail}`
-- — verbatim, so a manager reading the draft sees exactly what the relay
-- said, not a paraphrase. It is populated ONLY when status is
-- `RELAY_REFUSED` (enforced below): every other status leaves it NULL, the
-- same one-column-one-state discipline `relay_email_queue.failure_reason`
-- and `house_mail_exports.failure_reason` already follow, just declared as
-- a CHECK instead of left as a convention nothing enforces. Safe to add
-- WITH full validation (not NOT VALID): the column is brand new and starts
-- NULL on every existing row, so the constraint holds trivially for all of
-- them — there is no legacy data to reconcile against, unlike a constraint
-- on `status` itself would face.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS relay_refusal_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'procurement_conversations_relay_refusal_reason_scoped'
  ) THEN
    ALTER TABLE public.procurement_conversations
      ADD CONSTRAINT procurement_conversations_relay_refusal_reason_scoped
      CHECK (relay_refusal_reason IS NULL OR status = 'RELAY_REFUSED');
  END IF;
END
$$;

COMMENT ON COLUMN public.procurement_conversations.relay_refusal_reason IS
  'The relay gateway''s own sentence for a definite, terminal 400/403/422 refusal (ADR 0099, founder 2026-09-21: "Close, no retry") — set only alongside status = RELAY_REFUSED (procurement_conversations_relay_refusal_reason_scoped enforces the pairing). Written by ProviderConversationAgent._close_relay_refused (services/agent-orchestrator/agents/provider_conversation_agent.py); read as relayRefusalReason by ProcurementService.getConversationHistory (the /communications ledger) and getOrderConversations (the /orders thread drawer).';

COMMENT ON COLUMN public.procurement_conversations.status IS
  'Free-text lifecycle, no CHECK constraint (confirmed 2026-09-21, unchanged from 20260927140000''s own finding) — written from many services, so a single enum is a cross-cutting change filed as an open item, not guessed at in this migration. RELAY_REFUSED (added 2026-09-21, ADR 0099) is a TERMINAL state: the relay''s own doors refused this exact request (400/403/422) before, or instead of, any transport, and the send claim is NOT released for retry — a person must edit the draft and send a new one. See relay_refusal_reason for why.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'procurement_conversations'
      AND column_name = 'relay_refusal_reason'
  ) THEN
    RAISE EXCEPTION 'procurement_conversations.relay_refusal_reason was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'procurement_conversations_relay_refusal_reason_scoped'
  ) THEN
    RAISE EXCEPTION 'procurement_conversations is missing procurement_conversations_relay_refusal_reason_scoped';
  END IF;

  RAISE NOTICE 'procurement_conversations.relay_refusal_reason: added, scoped to RELAY_REFUSED.';
END
$$;
