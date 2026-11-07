-- A verified receipt claims its money once (QA round 1, H-1, 2026-11-07).
--
-- `ProcurementService.openCreditClaim` (procurement.service.ts) raises the
-- vendor credit claim a receipt verification finds. It inserts an ORDER-level
-- row: `order_id` set, `document_id` and `document_line_id` NULL. Its own
-- comment says a 23505 means "a claim for this line and reason is already
-- open" and is swallowed so "re-running the match must not manufacture a
-- second claim" -- but the only unique index on the table,
-- `uq_pc_line_reason` (baseline), is on `(document_line_id, reason)` WHERE
-- `document_line_id IS NOT NULL`, so it never bites an order-level row. A
-- repeated verification (a retry after a timeout, a second tab, a second
-- person) opened a second claim for the same money, and the open total
-- doubled.
--
-- This is the index that 23505 was written against: at most one
-- non-written-off claim per order and reason among the rows that writer
-- makes. Same shape and the same forgiveness as `uq_pc_line_reason` and
-- `uq_pc_order_never_arrived` (20261021150000): a written_off claim may be
-- followed by a fresh one. `never_arrived` is left to its own index.
--
-- The service also stops a proven repeat before it writes anything
-- (`repeatsTheLatestVerification`, shelf-received.ts); this index is the half
-- that holds when two submits race, and when a re-verification carries
-- invoice charges the service cannot compare.
--
-- WRAPPED, after the precedent in 20260901120000: rows written before this
-- index may already hold the duplicate it forbids, and a guard against
-- duplicate claims must not be the thing that blocks a deploy. Nothing is
-- deleted or restated here -- which of two open claims is the real one is a
-- question for the person chasing them. When the index cannot be built the
-- WARNING names it, and the service's repeat check carries the sequential case
-- alone until the duplicates are settled and this statement is re-run.

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_order_match_reason
    ON public.procurement_credits (order_id, reason)
    WHERE (
      order_id IS NOT NULL
      AND document_id IS NULL
      AND document_line_id IS NULL
      AND (reason)::text <> 'never_arrived'
      AND (state)::text <> 'written_off'
    );
  COMMENT ON INDEX public.uq_pc_order_match_reason IS
    'At most one non-written-off order-level claim per order and reason (QA round 1, H-1): the database half of openCreditClaim''s swallowed 23505, so a repeated receipt verification cannot open a second claim for the same money.';
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING
      'uq_pc_order_match_reason not created (%). Existing duplicate open order-level claims must be settled first; until then only the service repeat check stops a second claim.',
      SQLERRM;
END
$$;
