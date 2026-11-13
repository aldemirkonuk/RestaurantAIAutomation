## Sales before this fix are settled only by a job the founder runs — OPEN — 2026-11-07

Filed by `fix/a-sale-settles-its-cost` (QA round 15 finding 2).

**What is true.** From migration `a_sale_settles_its_cost` on, `finalise_delivery_cost` finalises a lot sold out while provisional and writes an `inventory_lot_draw_settlements` row for each provisional or unpriced draw. Draws whose lot was already finalised before it have no settlement. `scripts/jobs/settle-provisional-draws.sql` writes them; it is a dry run unless `-v apply=1`, and only the founder runs it. A sold-out provisional lot that no verify has reached since is settled by the next verify, not by the job.

**What closes it.** The founder runs the job (dry run first) against production.

## Lot cost still carries two places on this stack — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `inventory_lot_draws.unit_cost` and the settlement costs are `numeric(14,6)`; `inventory_lots.unit_cost` is still `numeric(10,2)` here. Widening it is #839's change, in the separate #909 stack.

**What closes it.** #909 landing.

## A duplicate verify can overwrite a person's manual revaluation — OPEN — 2026-11-07

Filed with the entry above (QA round 15 line 48; pre-existing, not changed here).

**What is true.** `finalise_delivery_cost` has no guard against a repeat verify at a different price overwriting a cost a person set by hand. Each overwrite is kept in `inventory_lot_revaluations` and now settles provisional draws again, so the history is complete, but the later price wins.

**What closes it.** A guard on manual provenance in `finalise_delivery_cost`.
