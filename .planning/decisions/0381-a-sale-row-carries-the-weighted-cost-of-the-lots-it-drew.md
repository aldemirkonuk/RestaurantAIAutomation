# 0381 — A sale's ledger row carries the weighted cost of the lots it drew

- **Status:** Proposed (2026-11-20). DD-r102-21 was approved by the selector; the mechanics (trigger, six places, unpriced rule) are the executor's under the founder's standing delegation.
- **Date:** 2026-11-20
- **Decider:** selector (DD-r102-21): the row records the quantity-weighted cost and which lots. Executor (r103 builder "invoices"): how.
- **Keywords:** cost of goods, depletion row, unit_cost, cost_total, inventory_lot_draws, weighted cost, FIFO
- **Links:** PR #845 (draws and cost_total), PRs #919 #932 #949 #1004 #1025 #1034 #1035 (the chain this sits on), PR #1815 (cost_at_sale, a different stack)

## Context

`a_sale_carries_its_cost` (#845) stamps `cost_total` and one `inventory_lot_draws` row per lot on a till sale, but the ledger row's own `unit_cost` stayed `p_unit_cost`, NULL for every POS sale. #845's header says so: "the ledger row's unit_cost is still p_unit_cost". The per-bottle figure existed only by summing draws.

## Options considered

1. **Trigger** `BEFORE INSERT` on `inventory_transactions` sets `unit_cost = cost_total / bottles`. Reads what any version of `apply_stock_movement` writes. *Chosen.*
2. **Re-create `apply_stock_movement`** with the assignment. Rejected: the function is re-created by #932 and #949 in this chain and by other open PRs; a copy here is overwritten or overwrites by version order.
3. **A view over the draws.** Rejected: the selector asked for the row to record it, and a view leaves the column NULL for every reader of the ledger.

## Decision

1. A negative `sale` row whose bottles were all priced (`unpriced_qty = 0`, `cost_total` not null) carries `unit_cost = round(cost_total / bottles, 6)`. (3 at 12.00 + 2 at 14.00) / 5 = 12.80. The lots are the row's draws.
2. Any unpriced bottle leaves `unit_cost` as given (NULL): the weighted cost of the whole row is unknown, and a lower figure from the priced part would be a false one (ADR 0067).
3. `unit_cost` widens from `numeric(10,2)` to `numeric(14,6)`, as `cost_total` did.
4. Other row types keep what the caller gave. Older rows are not back-filled.

## Consequences

- `cost_at_sale` (#1815, `wine_consumption_log`) is NOT asserted equal to this row. #1815 prices a line from the recorded WAC (`resolveUnitCost`), this row from FIFO lots, and the two stacks share no base. They agree only when every lot costs the same. Making them equal means #1815's writer reads the depletion row it has just caused (the consumption insert already follows `apply_stock_movement`), and glass pours (`record_glass_pour`, no draws yet) have no row to read. Open; see the r103 note.
- Settlements (`inventory_lot_draw_settlements`) adjust cost after a verify; this column is the cost when the bottles left and is not restated.

## Review trail

- r103 builder, 2026-11-20: SQL test `supabase/tests/20271210100000_a_sale_row_carries_the_weighted_cost_of_its_lots_test.sql`, run on a PGlite build of all migrations; four mutations of the trigger each fail it.

## Deviation from the approval (r104)

DD-r102-21 / DD-r103-9 said "no new unit_cost column on the ledger row". This ADR adds no column, but it is not as small as that sentence reads: it adds a `BEFORE INSERT` trigger on `inventory_transactions` and widens the existing `unit_cost` from `numeric(10,2)` to `numeric(14,6)`. The widening is needed (a 10.0049 bottle must not print as 10.00) and the trigger was chosen over re-creating `apply_stock_movement`, which several open PRs of the stack re-create. Recorded here as a deviation the selector can reverse; the alternative (a view over the draws, option 3) was rejected above.

## cost_at_sale does not yet read this row (r104, FORK, not built)

`wine_consumption_log.cost_at_sale` (#1815/#1820, `sale-cost.ts`) is recorded WAC x qty; the ledger row's `unit_cost` is FIFO over the drawn lots. They differ whenever lots cost differently (3 at 12 + 2 at 14: row 12.80 a bottle). The planned fix, reading the row's `cost_total` by idempotency key, was stopped at its own precondition: a glass pour does not reach `apply_stock_movement`. `record_glass_pour` (`20261222100000_a_pos_sale_is_dated_by_its_check.sql`, the latest definition on the combined #1820 + #1035 + #2004 + #1984 tip) inserts its own `inventory_transactions` row with no `cost_total`, no `unpriced_qty`, no `idempotency_key` and no `inventory_lot_draws`; the key goes to `pour_events`. So the trigger of this ADR never fires for a pour, and a pour has no ledger row to read. Whole-bottle lines do reach `apply_stock_movement`.

Open fork for the selector: (a) make `record_glass_pour` price its bottles and write draws (a migration on a hot path), then read the row for every line; or (b) read the row for whole-bottle lines only and keep WAC for pours under its own basis word. Neither was built.
