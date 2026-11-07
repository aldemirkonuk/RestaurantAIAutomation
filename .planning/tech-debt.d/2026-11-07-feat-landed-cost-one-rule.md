## The landed-cost rule is unwired, and leaves six things open — OPEN — 2026-11-07

Filed by `feat/landed-cost-one-rule` (cost-math proposal lane 1.2; the session's calls under the founder's /goal of 2026-11-07). Its fixtures are synthetic, not real TR papers.

**What is true.** `apps/api-gateway/src/procurement/landed-cost.ts` imports nothing (`claims.d/feat-landed-cost-one-rule.jsonl:1`). `verifyReceipt` and the delivery path still cost bottles their own way, so no lot cost changes with this commit. Left open on purpose:

- `subtotal` is taken but not cross-checked against the lines; tie-out stays intake's (`ties_out`).
- A free line printed as 12 × 10.00 = 0.00 with no allowance is unresolved, until a real paper shows how intake files one.
- A negative allowance, deposit, discount or charge is unresolved, not normalised: no column's sign convention was traced.
- The rounding tolerance (0.01 + 0.00005 per unit) was chosen, not measured on papers.
- Where intake files a 7161 deposit is untraced. The spec shows `deposit_total` stays out of cost and the same amount on `other_charges` would be cost; the module cannot tell them apart.
- The tax basis is passed through. Lane 3.5a applies it.

**What closes it.** Lanes 1.3 and 1.4 call `landedCost` after #666's `readInvoicePrice` converts units; the bullets close with real papers.
