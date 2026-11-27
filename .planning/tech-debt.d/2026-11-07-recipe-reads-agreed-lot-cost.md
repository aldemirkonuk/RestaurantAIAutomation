
## Analytics loaders do not yet read the agreed lot cost — OPEN — 2026-11-07

Filed by `fix/recipe-reads-agreed-lot-cost` (QA round 15, finding 2).

**What is true.** A delivery cost settled at VERIFIED through an accepted vendor proposal is posted with `cost_provenance` 'manual' and `cost_state` 'final'. `resolveUnitCost` now reads such a cost as `agreed_lot_wac` when its lot argument carries `has_agreed_cost` / `agreed_wac` (new view `public.inventory_lot_agreed_cost`, `inventory_lot_rollup` left alone because two open PRs redefine it). The recipe cost passes the lot straight through. But the analytics loaders (`analytics.service.ts:150`, `advanced-analytics.service.ts:79`, `pricing/margin-advice.service.ts`) do not read the view yet, so until wired, analytics still reads accepted-proposal items as before (unknown), while a recipe reads their price.

**What closes it.** Each loader joins `inventory_lot_agreed_cost` by `inventory_id` and spreads `has_agreed_cost` / `agreed_wac` onto the lot row it hands `resolveUnitCost`. Claim `RECIPE-READS-AGREED-LOT-COST` covers the resolver half only.

Also: `inventory_lots.unit_cost` is still `numeric(10,2)` on this branch, so a landed cost's six places are not yet stored; the view keeps six places in the average and will keep them once the column widens.
