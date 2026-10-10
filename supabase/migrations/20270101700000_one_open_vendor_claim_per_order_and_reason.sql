-- F-465 (sim wave 12, 2026-10-09): re-verifying a delivery opened a second
-- vendor credit claim for the same money.
--
-- `verifyReceipt` opens its claim with no document line, and treated 23505 as
-- "a claim for this is already open". But the only unique index on
-- procurement_credits was uq_pc_line_reason (document_line_id, reason) WHERE
-- document_line_id IS NOT NULL, which a verification claim never has. So a
-- correction re-run, a phone outbox replay or a second check after truck two
-- each added another open claim, and the Credits line counted every one.
--
-- The gateway now reads the order's live claims first and restates the open
-- one in place. This index is the database's half: at most one OPEN claim per
-- order and reason that is tied to no document. Only `open` — a claim already
-- asked of the vendor (requested, promised) is the gateway's to leave alone,
-- and a written-off or settled one may be followed by a fresh claim.
--
-- Existing duplicates would stop the index from building. Each extra open copy
-- is written off with a note (the newest stays open: it is the latest check's
-- reading). These were never sent to a vendor, and written_off is the existing
-- state that stops a claim counting as money owed.

SET LOCAL statement_timeout = '120s';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY order_id, reason
           ORDER BY opened_at DESC, created_at DESC NULLS LAST, id DESC
         ) AS n
    FROM public.procurement_credits
   WHERE state = 'open'
     AND order_id IS NOT NULL
     AND document_id IS NULL
     AND document_line_id IS NULL
)
UPDATE public.procurement_credits c
   SET state = 'written_off',
       settled_at = now(),
       notes = concat_ws(E'\n', nullif(c.notes, ''),
         'Closed as a copy: a later check of this delivery opened the same claim again. The vendor had not been asked for this one.'),
       updated_at = now()
  FROM ranked r
 WHERE c.id = r.id
   AND r.n > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_order_reason_open
  ON public.procurement_credits (order_id, reason)
  WHERE (state = 'open' AND order_id IS NOT NULL
         AND document_id IS NULL AND document_line_id IS NULL);

COMMENT ON INDEX public.uq_pc_order_reason_open IS
  'At most one open vendor claim per order and reason that is tied to no document (F-465). verifyReceipt restates that claim on a re-check instead of opening another; this is the database''s half of that read-then-write.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'procurement_credits'
       AND indexname = 'uq_pc_order_reason_open'
  ) THEN
    RAISE EXCEPTION 'uq_pc_order_reason_open was not created';
  END IF;
END
$$;
