-- A POS mapping may no longer name a stock target that does not exist.
--
-- State this fixes (production, verified 2026-08-25): all 92 rows in
-- `pos_item_mappings` carried a non-null `inventory_id` that resolved to ZERO
-- rows in `restaurant_inventory`, alongside 92 still-`pending`
-- `pos_catalog_match_proposals` with equally dangling `candidate_inventory_id`.
--
-- Root cause was NOT synthesis. Every one of the 92 ids reproduces exactly as
-- uuid5(SIM_NS, 'sim.inventory.bistro.<signature_hash>') over the 342 wines in
-- datasets/sim/menus/bistro.json — 92/92, zero misses — and the owning
-- restaurant_id is uuid5(SIM_NS, 'sim.restaurant.bistro'). These were real
-- seeded rows whose inventory (and whose restaurant) `synth teardown` deleted.
-- Both tables are written INDIRECTLY, by CatalogMatcherService.pullAndMatch
-- rather than by seed.py, so neither was in SYNTH_WRITE_SET — the exact leak
-- scripts/synth/write_set.py already calls out twice, for pos_checks and
-- pos_unresolved_lines, and missed twice here. That registry is fixed in the
-- same commit; this migration removes the rows it left behind and makes the
-- database refuse to hold them again.
--
-- Why the leftovers are worse than they look. A dangling mapping is a BLACK
-- HOLE, not a corruption. Probed against production and rolled back: both
-- `apply_stock_movement` and `record_glass_pour` RAISE 'inventory % not found',
-- so supabase-js returns { error }, pos-hub.service.ts:420-424 logs a warn and
-- moves on — nothing is written and no stock moves. But the line has already
-- skipped the `if (!it.inventory_id)` queue branch at pos-hub.service.ts:347,
-- so it lands in NEITHER stock NOR pos_unresolved_lines. The sale vanishes
-- silently, which is strictly worse than the unmapped case B20 built the queue
-- to prevent. It has not fired yet only because the 92 belong to the dead
-- `bistro` tenant while the 66 live pos_checks belong to a different
-- restaurant that has no mappings at all.

-- ---------------------------------------------------------------------------
-- 1. Remove the orphans
-- ---------------------------------------------------------------------------
-- Scoped by NOT EXISTS rather than by the sim restaurant id: the FK below
-- cannot be created while ANY violating row exists, and an orphan mapping is a
-- silent black hole for every tenant, not just this one. Deliberately not
-- repaired in place — re-pointing at another restaurant's inventory would
-- invent links no matcher produced, against decision 34 ("a wrong link is
-- worse than no link"), and the correct rows are regenerable rather than lost:
-- re-seeding the archetype restores the identical uuid5 inventory ids, after
-- which pullAndMatch reproduces the mappings.
delete from public.pos_item_mappings m
 where m.inventory_id is not null
   and not exists (
     select 1 from public.restaurant_inventory i where i.id = m.inventory_id
   );

-- Same leak, same tenant, same reason. A pending proposal whose candidate no
-- longer exists cannot be reviewed to any good end: approving it would write
-- precisely the mapping the FK below now rejects.
delete from public.pos_catalog_match_proposals p
 where p.candidate_inventory_id is not null
   and not exists (
     select 1 from public.restaurant_inventory i where i.id = p.candidate_inventory_id
   );

-- ---------------------------------------------------------------------------
-- 2. Index before constraint
-- ---------------------------------------------------------------------------
-- Postgres indexes the REFERENCED side automatically (restaurant_inventory.id
-- is a PK) but never the referencing side. Without this, every
-- `delete from restaurant_inventory` — which is what teardown does, in bulk —
-- seq-scans pos_item_mappings once per deleted row to find cascade targets.
create index if not exists pos_item_mappings_inventory_id_idx
  on public.pos_item_mappings (inventory_id)
  where inventory_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The constraint
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE, decided by the founder 2026-08-25 (ADR 0012).
--
-- The alternative was RESTRICT, which would make a teardown fail loudly rather
-- than quietly discard mapping work. CASCADE won because a mapping is cheap and
-- reproducible — pullAndMatch regenerates it from the catalog and the inventory
-- — while the inventory row it points at is the durable object. RESTRICT would
-- also have broken `synth teardown` outright until every caller learned to
-- delete mappings first, converting a data-integrity fix into an operational
-- one.
--
-- inventory_id stays NULLABLE and unconstrained when null: an unmapped item is
-- a legitimate, expected state (it is what routes a line into
-- pos_unresolved_lines). The FK constrains "claims a target" — not "has one".
--
-- NOT VALID is deliberately NOT used. The orphans are deleted above, so the
-- table validates cleanly right now; a NOT VALID constraint would leave the
-- door open to exactly the rows this migration exists to remove.
alter table public.pos_item_mappings
  drop constraint if exists pos_item_mappings_inventory_id_fkey;

alter table public.pos_item_mappings
  add constraint pos_item_mappings_inventory_id_fkey
  foreign key (inventory_id)
  references public.restaurant_inventory (id)
  on delete cascade;

comment on column public.pos_item_mappings.inventory_id is
  'Stock target for this POS item. NULL = unmapped (the line is queued into '
  'pos_unresolved_lines). When set it MUST resolve: FK cascades on inventory '
  'delete, because a mapping to a deleted inventory row silently swallows the '
  'sale rather than queueing it (ADR 0012).';
