## The two lot views run as their owner again — OPEN — 2026-11-07

Filed by `fix/lot-cost-keeps-small-units` (inventory walk #7, lane I5), found while rebuilding the views for migration `a_lot_cost_keeps_small_units`.

**What is true.** OD-72 (`20260825210000_od72_revoke_client_grants.sql`, section 2) set `security_invoker = true` on every postgres-owned view. A week later `lot_cost_truth` redefined `inventory_lot_rollup` and `inventory_location_breakdown` with `CREATE OR REPLACE VIEW` and no `WITH (...)`, which replaces a view's options, so both lost it. Measured on a local build of every migration at `origin/main` 259feea3f: `reloptions` is NULL on both, `{security_invoker=true}` on `inventory_analytics`. Production is not read here. Nothing is exposed today: anon and authenticated hold no grant on either view (OD-72 revoked them, and its default-privilege revoke covers views made later), and the gateway reads them as `service_role`, which bypasses RLS anyway. `a_lot_cost_keeps_small_units` keeps each view's options exactly as it found them, so it neither fixes nor worsens this.

**What closes it.** A migration that sets `security_invoker = true` on both views, plus a guard that fails when a `CREATE OR REPLACE VIEW` on a postgres-owned view in `public` leaves out `security_invoker`. A sibling branch, `fix/lots-are-never-deleted` (`a_used_up_lot_is_kept`), does the same `CREATE OR REPLACE` again.

## A later rebuild of the lot views can put WAC back to 2 places — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `a_used_up_lot_is_kept` (branch `fix/lots-are-never-deleted`, not on main on 2026-11-07) recreates both lot views from a copy of the `lot_cost_truth` text, which rounds WAC to 2 places. Merged before this lane, it is kept: this migration rebuilds each view from the body the database holds and changes only the rounding. Measured locally: its `WHERE qty > 0 OR open_bottle_ml > 0` filter survives, and WAC rounds to 6 places. Merged after this lane, it would put 2 places back. Claim `G24-LOT-COST-KEEPS-SMALL-UNITS` (`../decisions/claims.d/fix-lot-cost-keeps-small-units.jsonl:1`) fails the build in that case, because it refuses any later migration that recreates either view with 2-place rounding. So whichever of the two merges second must carry `, 6)`. QA round 11b: `fix/lots-are-never-deleted` now rounds both views to 6 itself (its claim `LOTS-ARE-NEVER-DELETED` requires it), and the two migrations were applied locally in both orders with WAC at 6 places each time.

**What closes it.** Both are merged with the 6-place rounding in the final view body.

## Per-gram costs are kept, but nothing writes one yet — OPEN — 2026-11-07

Filed with the entries above.

**What is true.** `inventory_lots.unit_cost` and `inventory_transactions.unit_cost` now keep six decimal places. No gateway path creates a food or supply house item yet (proposal G1: `CreateInventoryItemDto.wineId` is still required), so no per-gram lot is written today. The writers that call `apply_stock_movement` with `p_unit_cost` (`inventory.service.ts`, `procurement.service.ts`, `delivery-stock.service.ts`, `inventory-ledger.service.ts`, `house-menu-price.ts`) were not checked for converting a per-kg invoice price into a per-gram cost, or for rounding it on the way in. `inventory_transactions.total_cost` stays at `numeric(10,2)` on purpose: it is a money total, and the migration's header says why. The CSV export on `/inventory` writes WAC as stored (`iv-export.ts` `blank`), so a bottle's WAC may now show up to 6 places there. On screen a cost per unit goes through `cellUnitCost` (`fmtUnitMoney`, `apps/web/src/lib/mudavym/format.ts`): below one whole unit of the currency it keeps four significant digits, up to six places, so 0.035 reads 0.035; prices keep `cellMoney` (QA round 11b). The legacy command page (`/inventory` with `inventory_next` off) printed its price card with `$${n.toFixed(2)}` (`command/bits.tsx` `fmtMoneyExact`), so 0.035 read $0.04 there; its Market avg, You paid (WAC) and Menu price now go through `fmtUnitMoney` with the house currency (`command/RowExpansion.tsx`, QA round 14b). The rest of that page (`fmtMoney` whole-dollar KPIs, `HousePriceCell`) still prints `$`: whole-currency figures that never sit below one unit, on a page no house sees today (QA round 14b found `inventory_next` on for every house).

**What closes it.** The G1 lane opens the API to house items. When it does, it converts invoice units to the item's `uom` at full precision, and a test receives a per-kg invoice line into a per-gram lot.

## This lane is unverified against production until CI — OPEN — 2026-11-07

The pgtest `supabase/tests/<version>_a_lot_cost_keeps_small_units_test.sql` ran only on local Postgres, because CI never runs `supabase/tests/*.sql`. The required `Schema parity / Fresh database equals remote` job is what proves production matches after merge, and it has not run on this change. The local build cannot model production's grants. The migration copies grants and options back from whatever the database holds, and asserts them equal. That was proven locally on a database seeded with production-like grants, not on production itself.

## Applying the column change locks stock for the length of a table rewrite — OPEN — 2026-11-07

Filed by QA round 11b on `fix/lot-cost-keeps-small-units`.

**What is true.** `a_lot_cost_keeps_small_units` changes the type of `inventory_lots.unit_cost` and `inventory_transactions.unit_cost`, which rewrites both tables and rebuilds their indexes (14 on the ledger, 5 on lots, counted on a local build) under ACCESS EXCLUSIVE, and drops and recreates three views, all in one transaction. Every stock read and write waits until it commits, the POS doors included. Measured locally on Postgres 17 with synthetic rows: 1,000,000 ledger rows (342 MB with indexes) and 100,000 lots took 13.6 s. Production's row count and timing were not measured: that is the founder's call.

**What closes it.** The migration is applied in a quiet window with a lock timeout, as the PR body says, and the time it took is written here.

