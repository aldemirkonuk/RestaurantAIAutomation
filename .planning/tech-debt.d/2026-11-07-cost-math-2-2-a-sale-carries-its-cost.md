## A glass pour stamps no cost yet — OPEN — 2026-11-07

Filed by `feat/a-sale-carries-its-cost` (cost-math lane 2.2, narrowed).

**What is true.** `apply_stock_movement` now writes `inventory_lot_draws` and the ledger row's `cost_total` / `unpriced_qty` (migration `a_sale_carries_its_cost`). `record_glass_pour` does not: a bottle opened for glasses leaves its lot with no draw and no cost. It was left alone because the open PR that adds `one_pour_size_for_the_house` re-creates it.

**What closes it.** After that PR lands, `record_glass_pour` writes one draw per bottle it opens, at the lot's cost then (proposal F10: cost is stamped when a bottle is opened).

## A negative movement's ledger unit_cost is still whatever the caller sent — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** On a negative movement the ledger row's `unit_cost` is still `p_unit_cost`, unchecked. The lots' cost is now on `cost_total` and the draws. Proposal 2.2 says `unit_cost` = `cost_total` ÷ priced bottles, and a `p_unit_cost` on a negative delta is refused (22023).

**What closes it.** That change, after a census of the callers that send a price with a sale (`scripts/check_lot_cost_provenance.py` lists the call sites).

## Sales from before the draws carry no cost — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** Rows written before `a_sale_carries_its_cost` have no draws, and `cost_total` and `unpriced_qty` are both NULL. A reader can tell them apart from a new sale with no priced bottle, which has `unpriced_qty` ≥ 1. Nothing backfills them: no record says which lots an old sale took, and a lot it emptied was deleted (before R6), so their cost cannot be rebuilt from the database.

**What closes it.** Nothing. Cost of goods (lane 3.1) states the window it covers from the first stamped row.

## R19's other three ledger fixes are not built — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** R19 of PR #589 names four fixes that ship together: the `stock_counts` cascade, the last ml below one measure, a record of how a sale decomposed, and idempotency keys for draws across several lots. This lane builds the record (the draws). Draws need no key of their own: they are written in the ledger row's transaction and an idempotent replay returns before writing any. The `stock_counts` cascade and the last ml below one measure are not built.

**What closes it.** The ADR 0115 D3 lane.
