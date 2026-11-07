-- A delivery holds one open claim (QA round 9c on #821, 2026-11-07).
--
-- `ProcurementService.openCreditClaim` raises the vendor claim a receipt
-- verification finds, as an ORDER-level row (`order_id` set, `document_id`
-- and `document_line_id` NULL). A corrected verification restates that one
-- open claim, or sets it aside when nothing is owed any more. But the only
-- index under it, `uq_pc_order_match_reason` (a_verified_receipt_claims_once),
-- is on `(order_id, reason)`, and the reason follows the verdict: "2 refused
-- as cracked" is `damaged`, "2 never shipped" is `qty_short`. So two open
-- claims for the same two bottles could still stand side by side whenever the
-- service did not see the first one -- the open claims could not be read, or
-- two verifications passed each other after the order's lease lapsed.
--
-- This is the rule the service restates against: at most one OPEN
-- order-level claim per order, whatever its reason. Only `open` is counted: a
-- claim already requested, promised, credited or rejected carries the figure
-- the vendor was given and is a person's call, and a correction may still
-- open a draft beside it. `never_arrived` is left to its own index
-- (`uq_pc_order_never_arrived`). Line-level claims are left to
-- `uq_pc_line_reason`.
--
-- WRAPPED, after a_verified_receipt_claims_once and 20260901120000: rows
-- written before this index may already break it, and a guard against
-- duplicate claims must not be the thing that blocks a deploy. Nothing is
-- deleted or restated here -- which of two open claims is the real one is a
-- question for the person chasing them. When the index cannot be built the
-- WARNING names it; until the duplicates are settled and this statement is
-- re-run, a correction the service cannot read through may add a second
-- open claim.

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_order_one_open_claim
    ON public.procurement_credits (order_id)
    WHERE (
      order_id IS NOT NULL
      AND document_id IS NULL
      AND document_line_id IS NULL
      AND (reason)::text <> 'never_arrived'
      AND (state)::text = 'open'
    );
  COMMENT ON INDEX public.uq_pc_order_one_open_claim IS
    'At most one open order-level claim per order, whatever its reason (QA round 9c on H-1): a corrected receipt verification restates the one open claim, so a change of verdict cannot leave a second open claim for the same goods.';
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING
      'uq_pc_order_one_open_claim not created (%). Existing duplicate open order-level claims must be settled first; until then a correction the service cannot read through may add a second open claim.',
      SQLERRM;
END
$$;
