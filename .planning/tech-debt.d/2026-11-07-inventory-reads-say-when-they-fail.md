## The legacy inventory page still shows a failed open-bottle or location read as 0 ml and no zones — OPEN — 2026-11-07

Filed by `fix/inventory-reads-say-when-they-fail` (inventory walk #7, lane I1, gap G15).

**What is true.** The gateway now sends `openMl: undefined` with `rollupReadable: false`, and `locations: undefined` with `locationsReadable: false`, when `inventory_lot_rollup` or `inventory_location_breakdown` cannot be read (`apps/api-gateway/src/inventory/inventory.service.ts`, `fetchLotRollup`, `fetchLocationBreakdown`, `mapInventoryItem`). `/inventory` (InventoryNext) reads the flags in `toRow`. But `normalizeInventoryItem` (`apps/web/src/services/api/inventory.ts`) still fills `openMl ?? 0` and `locations ?? []`. Every other reader of that output ignores the flags: the legacy command page (`pages/inventory/useInventoryPage.ts`, `pages/inventory/command/RowExpansion.tsx`) and `RemoveFromInventoryModal`. So on those surfaces a failed read still looks like an empty bottle in no location.

**What closes it.** Either the normaliser stops defaulting the two fields when the matching flag is `false`, or each remaining reader checks the flag. This lane did neither, so the change stayed inside InventoryNext.

## Single-item reads that never ask for the rollup still say 0 ml open — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `mapInventoryItem` keeps returning `openMl: 0` and `locations: []` for whichever side its caller never read. The four calls that pass a row alone (`inventory.service.ts`, `return this.mapInventoryItem(data)` and its `data ? … : null` forms) read neither side, so they send both defaults and omit both `rollupReadable` and `locationsReadable`. The create, reactivate and update paths read the rollup but not the breakdown: their `openMl` is a real read and they carry `rollupReadable`, but their `locations: []` is a default and they omit `locationsReadable`. An omitted flag never claims a read that did not happen, but the `0` and `[]` sent under it are still defaults, not reads.

**What closes it.** Those callers read what they report, or report the two fields as absent. Lane I3 (`fix/count-returns-its-own-item`, G16) rewrites the count path's whole-house rollup read; lane I4 owns the create path. Both are sequenced after this one in proposal §3.
