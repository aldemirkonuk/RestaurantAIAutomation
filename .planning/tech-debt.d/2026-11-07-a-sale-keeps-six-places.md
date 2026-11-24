## A sale's cost keeps six places only if this lands with #845 — OPEN — 2026-11-07

Filed by `fix/a-sale-keeps-six-places` (QA round 19, lines 57-61).

**What is true.** #909 (`20270302143700_a_lot_cost_keeps_small_units`) puts the lot cost at six places; #845's later-dated `20270303100000` and `20270410100700` put the lot views back to `round(..., 2)` and sum each sale's cost at two places. Migration `20270512100000_a_sale_keeps_six_places` restores six places in both views and in `cost_total` (now `numeric(16,6)`). If #845 merges while #909 is on main and this PR does not, cost of goods loses up to half a cent per draw.

**What closes it.** This PR merging with #845. Settlement money (`inventory_lot_draw_settlements.*_total`, `difference`) stays at two places by design: it is a cent amount, computed once per draw.
