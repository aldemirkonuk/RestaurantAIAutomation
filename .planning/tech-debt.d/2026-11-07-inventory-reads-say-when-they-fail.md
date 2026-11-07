## A failed rollup or location read still shows cost, value and margin as —, and the command page reads it as 0, a price or no zone — CLOSED — 2026-11-07

Closed on stacked `fix/inventory-legacy-reads-say-when-they-fail`.

## Single-item reads that never ask for the rollup still say 0 ml open — OPEN — 2026-11-07

`mapInventoryItem` gives `openMl: 0` and `locations: []` for a side its caller never read, without that side's flag: the four row-only calls read neither; create, reactivate and update skip the breakdown. Closed when those callers read what they report (lanes I3, I4).
