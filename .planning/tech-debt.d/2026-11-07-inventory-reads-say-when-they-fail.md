## A failed rollup or location read still shows cost, value and margin as —, and the command page reads it as 0, a price or no zone — OPEN — 2026-11-07

G15 sends `rollupReadable` / `locationsReadable: false`. `/inventory` names open ml and zones, not cost, value or margin; `normalizeInventoryItem`, `useInventoryPage.ts`, `command/*` and `RemoveFromInventoryModal` ignore the flags. Over #827's 30K bound, so stacked branch `fix/inventory-legacy-reads-say-when-they-fail` closes it.

## Single-item reads that never ask for the rollup still say 0 ml open — OPEN — 2026-11-07

`mapInventoryItem` gives `openMl: 0` and `locations: []` for a side its caller never read, without that side's flag: the four row-only calls read neither; create, reactivate and update skip the breakdown. Closed when those callers read what they report (lanes I3, I4).
