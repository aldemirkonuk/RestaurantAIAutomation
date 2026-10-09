-- ONE MAIL MESSAGE IS ONE ROW. F-047 (sim ledger), residual race.
--
-- WHAT BROKE. One inbound vendor reply could be written to
-- procurement_conversations twice. The gateway's handleInboundEmail
-- (rabbitmq-bridge.service.ts, "3. Deduplicate") reads for an earlier row with
-- the same gmail_message_id and then inserts. A read-then-insert is not a
-- guard: two deliveries of the same message (a redelivered queue event, or the
-- force-fetch route re-publishing a message the poll already published,
-- communications.controller.ts) that run at once both read "nothing yet" and
-- both insert. Nothing in the schema refused the second row
-- (baseline_from_production.sql: procurement_conversations has no index on
-- gmail_message_id at all).
--
-- THE RULE. A Gmail message id names one message in one mailbox, and every
-- writer already treats it as one row: the bridge's dedupe reads it with no
-- house filter, and each send path writes the id of the one message it sent
-- onto its own row. So: at most one row per non-null gmail_message_id. Rows
-- with no id (manual notes, WhatsApp, the dedicated-domain webhook) are
-- untouched by the partial predicate.
--
-- EXISTING DUPLICATES. This file never deletes or rewrites a row. If any
-- non-null gmail_message_id already appears on more than one row, the unique
-- index cannot be built; the file then builds nothing, says so with a
-- WARNING naming the count, and the gateway's read-then-insert stays the only
-- guard until a person has looked at those rows. Migrations apply on merge, so
-- a step that cannot prove its data is safe skips and flags; it never raises.
-- NOT checked against production (no production reads from this lane).
--
-- THE WRITER. The gateway treats the refusal (23505) as "already stored", the
-- same outcome its read gives, so the losing delivery logs and stops instead
-- of logging a failed insert.
--
-- LOCK. CREATE UNIQUE INDEX (not CONCURRENTLY: the CLI runs this file in one
-- transaction) holds a SHARE lock on procurement_conversations for one scan,
-- blocking writes, not reads. Re-runnable: IF NOT EXISTS.

SET local statement_timeout = '120s';

DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT gmail_message_id
        FROM public.procurement_conversations
       WHERE gmail_message_id IS NOT NULL
       GROUP BY gmail_message_id
      HAVING count(*) > 1
    ) d;

  IF v_dupes > 0 THEN
    RAISE WARNING
      'procurement_conversations: % gmail_message_id value(s) already sit on more than one row; the one-row-per-message index was NOT built and no row was changed (F-047). Review those rows, then re-run this file.',
      v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS procurement_conversations_one_row_per_gmail_message
      ON public.procurement_conversations (gmail_message_id)
      WHERE gmail_message_id IS NOT NULL;
    COMMENT ON INDEX public.procurement_conversations_one_row_per_gmail_message IS
      'F-047: one row per Gmail message. The gateway reads first and treats a 23505 here as already stored.';
  END IF;
END $$;
