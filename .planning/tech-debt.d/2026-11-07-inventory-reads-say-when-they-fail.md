## A failed rollup or location read still shows cost, value and margin as —, and the command page reads it as 0, a price or no zone — OPEN — 2026-11-07

Filed by `fix/inventory-reads-say-when-they-fail` (G15). The gateway sends `rollupReadable: false` / `locationsReadable: false` with `openMl`, `wac` and `locations` absent. `/inventory` (InventoryNext) names the open bottle and the zones, but not cost, value or margin. `normalizeInventoryItem` (`apps/web/src/services/api/inventory.ts`) still fills 0 and [], and `useInventoryPage.ts`, `command/RowExpansion.tsx`, `command/InventoryCommandPage.tsx` and `RemoveFromInventoryModal` ignore the flags (cost falls back to `price`). Over this PR's 30K bound (QA round 10b), so the stacked branch `fix/inventory-legacy-reads-say-when-they-fail` closes it.

## Single-item reads that never ask for the rollup still say 0 ml open — OPEN — 2026-11-07

`mapInventoryItem` returns `openMl: 0` and `locations: []` for whichever side its caller never read, and omits that side's flag. The four row-only calls read neither; create, reactivate and update read the rollup but not the breakdown. Closed when those callers read what they report (lanes I3, I4).
