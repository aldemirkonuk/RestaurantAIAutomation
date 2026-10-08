## A claim filed every door rejection as "damaged" — CLOSED on `fix/claim-keeps-the-door-reason` — 2026-10-08

F-158 (owner-quarter sim, `p4-scratch/sim-findings-share-out-2026-10-02.md` §R3 4,
`sim-ledger.md:209`). Founder ruling W54, ADR 0267 option 8 (on branch
`fix/door-releases-reservation`, PR #664 at the time of writing), verbatim pick
"Keep the door's reason".

**What main did (origin/main 87dafc064).** The door stores its reason on
`procurement_receipt_events.refusal_reason` (`wrong_wine`, `broken_case`,
`temperature`, `other`; `receiving.service.ts:94-99`), but nothing read it
back for the claim. `verifyReceipt` → `openCreditClaim` → `draftClaimFromMatch`
filed every `rejected` verdict as `damaged` (`credit-ledger.ts` `reasonForVerdict`).
/receiving's drafted card printed the raw code (`RcCreditDrafts.tsx:101`,
"damaged"); /receipts › Credits worded it "Refused at the door"
(`ReceiptsCredits.tsx:66`); the letter said "arrived damaged"
(`credit-letter.ts:41`); the scorecard printed "damaged". A broken count on a
kept delivery took the same path.

**Fixed.** `openCreditClaim` reads the order's door `case_count` events and
keeps the one reason they give: wrong_wine→`wrong_item`, broken_case→`broken`,
temperature→`temperature`, other→`other`, a broken count on an accepted/short
delivery→`broken`. No reason, two reasons, or an unreadable read → `damaged`,
still opened. Migration `a_claim_keeps_the_door_reason` widens
`procurement_credits_reason_check` (read-and-append). One wording:
`CREDIT_REASON_WORDING` in `credit-ledger.ts` feeds the letter and the
scorecard; the web mirror `REASON_WORDS` is pinned to it by
`credit-reason-words.test.ts`. Old `damaged` rows are not rewritten; they now
read "Refused or broken at the door" everywhere, which is all they know.
Claims: `claims.d/fix-claim-keeps-the-door-reason.jsonl:1-5`.

## Left open from F-158 — OPEN — 2026-10-08

1. **/receiving's "Refused" lane still counts a broken-only delivery.**
   `laneOf` (`useReceivingNextData.ts:353-366`) folds verdict `rejected` into
   `refused`, so one broken bottle on a kept delivery still counts in
   "Refused N". The ruling covers the claim's reason and its wording, not the
   lane. Decided 2026-10-08 as R3's call under the founder's 2026-10-07
   delegation (forks decided, not asked): rename the lane "Refused or broken"
   (a copy change in one file) on a later branch, not in this PR, which is at
   the 15-file cap. Splitting the lane by door outcome (the gateway queue
   carries the outcome) was rejected for now: it touches more files and no
   ruling asks for broken bottles as their own lane.
2. **`apps/web/src/services/api/credits.ts:19-27` `CreditReason` is stale.** It
   lists the baseline seven; `never_arrived`, `wrong_item`, `broken` and
   `temperature` are missing. Nothing breaks (`ProcurementCredit.reason` is
   `string | null`), but the type lies. Shared file, left to its owner: add the
   four codes to the union.
3. **A desk rejection on top of a door refusal inherits the door's reason.**
   `readDoorReason` does not compare the desk's rejected count with the
   door's, so bottles the desk rejected for another cause are filed under the
   door's reason.
4. **Two reasons on one order make one `damaged` claim.** A claim is one row
   per line and reason; splitting the amount by reason needs a per-reason
   price split nobody has specified.
5. **The door's own buttons still say "Wrong wine" / "Broken case"**
   (`DoorModel.ts:371-376`) while the claim says "Wrong item, refused at the
   door" / "Arrived broken". That is the receiver's pick list, not the claim;
   left as is.
6. **Old `damaged` claims' letters change words.** A `damaged` claim asked
   after this lands says "part of the delivery was refused or arrived broken
   at the door" instead of "arrived damaged".
7. **Disclosed (gate, 2026-10-08) — door `other` files as `other`, not as a
   door dispute.** Per the founder's pick list (other→other), a door refusal
   coded `other` now opens an `other` claim. Its letter files as
   `invoice_mismatch` (`creditLetterCategory`, `credit-letter.ts`
   `DELIVERY_DISPUTE_REASONS` does not hold `other`) and says "there is a
   discrepancy on this delivery"; pages label it "Another reason"
   (`credit-ledger.ts` `CREDIT_REASON_WORDING.other`), which no longer says it
   happened at the door. Before this PR the same refusal filed as `damaged`
   (delivery dispute, "arrived damaged"). Behaviour kept as ruled; a
   door-specific `other` wording would need its own reason code or ruling.
8. **Disclosed (gate, 2026-10-08) — the `never_arrived` letter gets its own
   sentence.** `CREDIT_REASON_SENTENCE` is now derived from
   `CREDIT_REASON_WORDING`, which has a `never_arrived` entry, so that letter
   says "we paid for an order that never arrived" instead of falling back to
   `other`'s "there is a discrepancy on this delivery". Still filed as
   `invoice_mismatch`. A wording change outside F-158's ruling, named here
   rather than left silent.
9. **Pre-existing — the "23505 dedupe" in `openCreditClaim` protects
   nothing.** The only unique index on this path, `uq_pc_line_reason`
   (`20260805000000_baseline_from_production.sql:11859`), is
   `(document_line_id, reason) WHERE document_line_id IS NOT NULL AND state <>
   'written_off'`, and `openCreditClaim` never sets `document_line_id`. So a
   re-verify of the same order with the same verdict can open a second claim
   for money already being chased. The code comment that claimed otherwise is
   corrected on this branch (`procurement.service.ts`, `openCreditClaim`);
   the fix (an order-level unique index like `uq_pc_order_never_arrived`, or a
   read-before-insert) is owed on a later branch.
10. **Fixed on this branch (gate, 2026-10-08) — a refused reason no longer
    loses the claim.** If the gateway runs before migration
    `a_claim_keeps_the_door_reason` lands, `procurement_credits_reason_check`
    refuses `wrong_item` / `broken` / `temperature` with 23514. The insert used
    to be only warned, dropping the claim; it now retries once as `damaged`
    and logs the lost precision (verify-receipt.spec.ts "re-files the claim as
    damaged ... (23514)").
