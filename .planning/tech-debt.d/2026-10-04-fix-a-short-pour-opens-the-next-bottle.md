## A stranded open bottle stopped every later glass sale leaving stock (AW08) — FIXED in code, repair OWED — 2026-10-04

Branch `fix/a-short-pour-opens-the-next-bottle`, [ADR 0285](../decisions/0285-a-short-pour-opens-the-next-bottle.md). Line numbers are at `8c673db4b`.

`record_glass_pour` (`supabase/migrations/20260805000000_baseline_from_production.sql:1132`) opened a new bottle only from the lot holding the open one (`:1170-1173`). When that lot had 0 sealed and less than one pour, it raised at `:1175`, even with sealed bottles in other lots. Nothing cleared that remainder, and the gateway only logged the failure (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:880-883`). So the item's later glass sales failed and their bottles stayed in `stock_live`. That inflated the cellar total (A-012) and /inventory's cover, velocity and reorder (A-001). This was reproduced on a PGlite build of every migration.

- **Fixed in code.** Migration `a_short_pour_opens_the_next_bottle` draws across every live lot: open bottles first, then sealed bottles oldest first. Its SQL test of the same slug proves it: T1-T5 and T12 fail without the migration and pass with it.
- **OWED: the repair.** Pours already lost (Tuzlu Rüzgar, about 752 Jul-Aug lines per the walk, not re-measured) are not put back by the migration. The replay is written, unrun, at `p4-scratch/sim-run/fixes/repair/glasspour-tuzlu-stranded-pours.sql` (outside the repo). It has a read-only dry run, and its apply block ends in ROLLBACK. It waits for the founder's yes (ADR 0285, fork 2) and for this migration to be live. Until then, no Jul-Aug re-import should run. The POS hub re-runs a closed check's stock effects on every upsert (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:538`), so once the migration is live, a re-sent old check pours its failed line dated now(), not at its `closed_at`, and inflates velocity.

## A manual pour of 0 ml or less was recorded, and a negative one added stock — FIXED — 2026-10-04

The old body subtracted `p_pour_ml` from the open bottle without checking its sign. A pour of −150 ml turned an open 300 ml into 450 ml, and a 0 ml pour wrote a `pour_events` row. `record_glass_pour` now refuses both with 22023, and a missing pour count with 22004 (migration `a_short_pour_opens_the_next_bottle`, test T5 and T5n). The manual route could reach it: its body is an inline type with no validation (`apps/api-gateway/src/inventory/inventory.controller.ts:492-495`). That gateway code is unchanged, so the RPC is now the guard.

## A lot sold to its last sealed bottle is deleted with its open bottle — OPEN — 2026-10-04

`apply_stock_movement` deletes a lot when a whole-bottle sale takes its last sealed bottle (`supabase/migrations/20260912163000_a_stock_write_names_its_house.sql:242-244`). The lot's `open_bottle_ml` disappears with it, so poured-from stock leaves the book unrecorded. Seen while building ADR 0285 and not fixed there. It is ADR 0115 M1's ("drained lots are kept", PR #589), which also adds the depleted status.

## Two gateway comments say an over-container pour drives open_bottle_ml negative — OPEN — 2026-10-04

`apps/api-gateway/src/pos-hub/pos-hub.service.ts:86-90` and `apps/api-gateway/src/pos-hub/pos-hub.sale-volume.spec.ts:292-294` say a pour larger than its container sets `open_bottle_ml` negative, "silent lot corruption". The schema says it could not: the CHECK `inventory_lots_open_bottle_ml_check` (`baseline:3189`) refuses it as 23514 (measured on PGlite; no production rows were read), and since ADR 0285 the RPC opens as many bottles as the pour needs. The queue guard those comments explain (ADR 0011 1b) still stands. ADR 0011's own sentence is corrected in place. The two comments are left for the next branch that edits pos-hub: lane `postime` holds `pos-hub.service.ts`, and this lane was told not to touch it.
