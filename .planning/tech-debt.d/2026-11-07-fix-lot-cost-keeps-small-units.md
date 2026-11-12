## The two lot views run as their owner again — OPEN — 2026-11-07

Filed by `fix/lot-cost-keeps-small-units` (inventory walk #7, lane I5), found while rebuilding the views for migration `a_lot_cost_keeps_small_units`.

**What is true.** OD-72 (`20260825210000_od72_revoke_client_grants.sql`, section 2) set `security_invoker = true` on every postgres-owned view. A week later `lot_cost_truth` redefined `inventory_lot_rollup` and `inventory_location_breakdown` with `CREATE OR REPLACE VIEW` and no `WITH (...)`, which replaces a view's options, so both lost it. Measured on a local build of every migration at `origin/main` 259feea3f: `reloptions` is NULL on both, `{security_invoker=true}` on `inventory_analytics`. Production is not read here. Nothing is exposed today: anon and authenticated hold no grant on either view (OD-72 revoked them, and its default-privilege revoke covers views made later), and the gateway reads them as `service_role`, which bypasses RLS anyway. `a_lot_cost_keeps_small_units` keeps each view's options exactly as it found them, so it neither fixes nor worsens this.

**What closes it.** A migration that sets `security_invoker = true` on both views, plus a guard that fails when a `CREATE OR REPLACE VIEW` on a postgres-owned view in `public` leaves out `security_invoker`. A sibling branch, `fix/lots-are-never-deleted` (`a_used_up_lot_is_kept`), does the same `CREATE OR REPLACE` again.

## A later rebuild of the lot views can put WAC back to 2 places — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `a_used_up_lot_is_kept` (branch `fix/lots-are-never-deleted`, not on main on 2026-11-07) recreates both lot views from a copy of the `lot_cost_truth` text, which rounds WAC to 2 places. Merged before this lane, it is kept: this migration rebuilds each view from the body the database holds and changes only the rounding. Measured locally: its `WHERE qty > 0 OR open_bottle_ml > 0` filter survives, and WAC rounds to 6 places. Merged after this lane, it would put 2 places back. Claim `G24-LOT-COST-KEEPS-SMALL-UNITS` (`../decisions/claims.d/fix-lot-cost-keeps-small-units.jsonl:1`) fails the build in that case, because it refuses any later migration that recreates either view with 2-place rounding. So whichever of the two merges second must carry `, 6)`.

**What closes it.** Both are merged with the 6-place rounding in the final view body.

## Per-gram costs are kept, but nothing writes one yet — OPEN — 2026-11-07

Filed with the entries above.

**What is true.** `inventory_lots.unit_cost` and `inventory_transactions.unit_cost` now keep six decimal places. No gateway path creates a food or supply house item yet (proposal G1: `CreateInventoryItemDto.wineId` is still required), so no per-gram lot is written today. The writers that call `apply_stock_movement` with `p_unit_cost` (`inventory.service.ts`, `procurement.service.ts`, `delivery-stock.service.ts`, `inventory-ledger.service.ts`, `house-menu-price.ts`) were not checked for converting a per-kg invoice price into a per-gram cost, or for rounding it on the way in. `inventory_transactions.total_cost` stays at `numeric(10,2)` on purpose: it is a money total, and the migration's header says why. The CSV export on `/inventory` writes WAC as stored (`iv-export.ts` `blank`), so a bottle's WAC may now show up to 6 places there. The screen rounds it through `cellMoney`.

**What closes it.** The G1 lane opens the API to house items. When it does, it converts invoice units to the item's `uom` at full precision, and a test receives a per-kg invoice line into a per-gram lot.

## This lane is unverified against production until CI — OPEN — 2026-11-07

The pgtest `supabase/tests/<version>_a_lot_cost_keeps_small_units_test.sql` ran only on local Postgres, because CI never runs `supabase/tests/*.sql`. The required `Schema parity / Fresh database equals remote` job is what proves production matches after merge, and it has not run on this change. The local build cannot model production's grants. The migration copies grants and options back from whatever the database holds, and asserts them equal. That was proven locally on a database seeded with production-like grants, not on production itself.
