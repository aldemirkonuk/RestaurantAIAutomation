## A part-lot transfer still copies the lot without its delivery, date or cost state — OPEN — 2026-11-07

Filed by `fix/lots-are-never-deleted` (cost-math lane 2.1, R6 of PR #589).

**What is true.** `transfer_stock` now moves a whole lot by changing its `location_id`. Moving part of a lot still inserts a new lot (the baseline INSERT, kept in `a_used_up_lot_is_kept`) without `delivery_id` or `received_at`, and its `cost_state` falls to the default `'final'`. So the moved half of a provisional lot is never restated by `finalise_delivery_cost`, and FIFO treats it as received now.

**What closes it.** The copy carries those three columns from its source lot.

## A used-up provisional lot is never finalised — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** A lot is now kept at qty 0, but `finalise_delivery_cost` and `revalue_lot` loop only `qty > 0` lots (`20260906233000_stock_at_the_door_cost_at_verified.sql:238`, `:339`). A provisional lot sold out before its invoice was verified keeps its estimated `unit_cost`. Nothing reads a depleted lot's cost yet.

**What closes it.** Cost-math lane 2.4 restates a delivery's depleted lots too.

## Deleting an item still deletes its lots — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `inventory_lots.inventory_id` is `ON DELETE CASCADE` (`20260805000000_baseline_from_production.sql:12686`). No gateway code hard-deletes an item (2026-11-07 grep) and the item merge repoints lots first, so none is lost today; any other hard delete would take them.

**What closes it.** `ON DELETE RESTRICT`, after a census of hard deletes.
