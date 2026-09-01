-- Duplicate purchase-order send guard (approveDraft hotfix).
--
-- approveDraft had no atomic claim: two concurrent taps both passed the
-- status check and both called the vendor email send. The service now claims
-- the row (PENDING_APPROVAL -> SENDING) before sending. These indexes are the
-- database-side backstop for that claim, so the invariant survives a code path
-- that forgets it.
--
-- NOT a unique index on (order_id) WHERE status = 'SENT': one order
-- legitimately accumulates many SENT outbound rows over a multi-round vendor
-- negotiation (inbound-responder.service.ts stages a fresh draft per round,
-- round_count = outboundRounds + 1). Uniqueness there would break negotiation
-- from round two onward. The two invariants below are the ones that actually
-- hold.
--
-- Every statement is idempotent; production may already be ahead of this file.
--
-- Plain CREATE INDEX, deliberately NOT CONCURRENTLY. Two reasons, and the
-- second is the one that will not be obvious later: (1) Supabase runs each
-- migration inside a transaction and CREATE INDEX CONCURRENTLY cannot run in
-- one, so it would need a separate non-transactional path; (2) it would buy
-- nothing — production holds 2 procurement_orders rows in total (and 26
-- decision_log rows), so the table is tiny and the write lock is measured in
-- milliseconds. Revisit only if that volume changes by orders of magnitude.

-- 1. At most ONE in-flight send per order. This is the duplicate-send race
--    itself: two claims for one order cannot both exist, so two sends cannot
--    both be in progress. The predicate matches no existing row (the SENDING
--    status is introduced by this change), so creation cannot fail on legacy
--    data.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_proc_conv_inflight_send
    ON public.procurement_conversations (order_id)
    WHERE ((status)::text = 'SENDING'::text);

COMMENT ON INDEX public.uniq_proc_conv_inflight_send IS
    'At most one in-flight vendor send per order. Backstops the atomic claim in ProcurementService.approveDraft.';

-- 2. One recorded send per RFC822 Message-ID per order. The id is now minted
--    before the send and stored on the row as part of the claim, so a second
--    "sent" record carrying the same id is a duplicate by definition.
--    Wrapped: legacy rows could in principle already violate this, and a
--    duplicate-send guard must not be the thing that blocks a deploy. A
--    warning here means the index is absent and invariant 1 is carrying the
--    load alone.
DO $$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_proc_conv_sent_message_id
        ON public.procurement_conversations (order_id, message_id)
        WHERE (
            message_id IS NOT NULL
            AND (status)::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
        );
EXCEPTION
    WHEN unique_violation OR duplicate_table THEN
        RAISE WARNING
            'uniq_proc_conv_sent_message_id not created (%). Pre-existing duplicate (order_id, message_id) rows must be reconciled first.',
            SQLERRM;
END
$$;
