## The landed-cost rule is unwired, and leaves nine things open — OPEN — 2026-11-07

Filed by `feat/landed-cost-one-rule` (cost-math proposal lane 1.2; the session's calls under the founder's /goal of 2026-11-07). Its fixtures are synthetic, not real TR papers.

**What is true.** `apps/api-gateway/src/procurement/landed-cost.ts` imports nothing (`claims.d/feat-landed-cost-one-rule.jsonl:1`). `verifyReceipt` and the delivery path still cost bottles their own way, so no lot cost changes with this commit. Left open on purpose:

- `subtotal` is taken but not cross-checked against the lines; tie-out stays intake's (`ties_out`).
- A free line printed as 12 × 10.00 = 0.00 with no allowance is unresolved, until a real paper shows how intake files one.
- A negative allowance, deposit, discount or charge is unresolved, not normalised: no column's sign convention was traced.
- The rounding tolerance (0.01 + 0.00005 per unit) was chosen, not measured on papers.
- Where intake files a 7161 deposit is untraced. The spec shows `deposit_total` stays out of cost and the same amount on `other_charges` would be cost; the module cannot tell them apart.
- Tax follows ADR 0359 C3 (PR #784, Proposed): the inputs are not columns yet. `reclaims_input_tax` waits on lane 3.5a; `procurement_document_lines` (baseline:4377) keeps no tax basis or rate, and nothing writes the canonical BT-152 `vatRate` (`canonical/canonical-types.ts:183`) to it.
- One tax basis and one rate cover all the paper's charges and its discount, so freight and delivery at different rates cannot be stated. The printed `tax` is checked against the lines' rates only when every line is stock and costed.
- Nothing rounds a cost to `inventory_lots.unit_cost` `numeric(10,2)` (QA round 4, #780 item 2).
- A fully rejected line keeps its freight share (QA round 4, #780 item 3); who bears freight on returned goods is not recorded.

**What closes it.** Lanes 1.3 and 1.4 call `landedCost` after #666's `readInvoicePrice` converts units; the bullets close with real papers.
