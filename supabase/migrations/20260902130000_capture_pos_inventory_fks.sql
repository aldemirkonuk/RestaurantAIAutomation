-- Capture the two POS -> restaurant_inventory foreign keys that only ever
-- existed on production.
--
-- WHY THIS EXISTS
-- ---------------
-- Found 2026-09-02 by the FIRST real run of the rewritten schema-parity check
-- (ADR 0072), on the pull request that rewrote it. Four objects were in remote
-- and in no migration:
--
--   pos_item_mappings_inventory_id_fkey                      (ON DELETE CASCADE)
--   pos_catalog_match_proposals_candidate_inventory_id_fkey  (ON DELETE SET NULL)
--   pos_item_mappings_inventory_id_idx                       (partial)
--   pos_catalog_match_proposals_candidate_inventory_id_idx   (partial)
--
-- These are the POS-bridge work: an `inventory_id` foreign key added by hand
-- alongside deleting 92 orphaned mappings. `20260825140000_pos_referential_
-- integrity.sql:8-9` states outright that "ADR 0012 closed `inventory_id` and
-- ADR 0014 closed `candidate_inventory_id`, deliberately leaving the rest for
-- this one" — but neither was ever written as a migration. They were closed on
-- production and nowhere else, so any database rebuilt from this repository
-- would have silently lacked both, which is the exact condition the 2026-08-05
-- baseline existed to clean up.
--
-- The OLD parity check could not have caught this: it compared column names and
-- broad types plus bare function names, and a foreign key is none of those.
--
-- DELETE BEHAVIOUR IS COPIED FROM PRODUCTION, NOT CHOSEN HERE
-- -----------------------------------------------------------
-- The two differ, deliberately, and the sibling migration already records why
-- (`20260825140000:24-25`): **a claim dies with its target; a question outlives
-- its answer.** A mapping asserts "this POS item IS this inventory row" — a
-- claim, so CASCADE. A match proposal asks "might it be?" — a question, so SET
-- NULL, matching what ADR 0014 chose for its sibling column. Both were read
-- back from production with pg_get_constraintdef before this file was written;
-- getting the two the wrong way round would be worse than the drift.
--
-- IDEMPOTENT, AND CONVERGENT RATHER THAN MERELY TOLERANT
-- ------------------------------------------------------
-- These objects ALREADY EXIST on production, so a bare ADD CONSTRAINT would
-- fail on apply. The `drop constraint if exists` + `add constraint` pair used
-- here is the idiom the sibling migration already uses on these same tables,
-- and it is deliberately stronger than a `DO $$ ... EXCEPTION WHEN
-- duplicate_object` block: swallowing the exception accepts whatever definition
-- is already there, so a production constraint with the WRONG delete behaviour
-- would survive and the mismatch would persist unseen. Dropping and re-adding
-- makes this file authoritative — after it runs, the definition is the one
-- written here, on every database.
--
-- Re-validation is free: measured on production 2026-09-02, both columns hold
-- **0 non-null values and 0 orphans**, so the re-add scans nothing and cannot
-- fail. (The 92 orphans that motivated the original hand-applied work were
-- deleted at that time.)
--
-- After this merges, production already has these objects, so tell the ledger:
--   supabase migration repair --status applied 20260902130000

set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. pos_item_mappings.inventory_id — a claim, so CASCADE
-- ---------------------------------------------------------------------------
alter table public.pos_item_mappings
  drop constraint if exists pos_item_mappings_inventory_id_fkey,
  add  constraint pos_item_mappings_inventory_id_fkey
       foreign key (inventory_id) references public.restaurant_inventory(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. pos_catalog_match_proposals.candidate_inventory_id — a question, so SET NULL
-- ---------------------------------------------------------------------------
alter table public.pos_catalog_match_proposals
  drop constraint if exists pos_catalog_match_proposals_candidate_inventory_id_fkey,
  add  constraint pos_catalog_match_proposals_candidate_inventory_id_fkey
       foreign key (candidate_inventory_id) references public.restaurant_inventory(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. The two partial indexes that back them
-- ---------------------------------------------------------------------------
-- Partial on IS NOT NULL, matching production exactly and matching the sibling
-- migration's own indexes on these tables: the overwhelming majority of rows
-- have no inventory link, and an index entry per unmapped row buys nothing.
create index if not exists pos_item_mappings_inventory_id_idx
  on public.pos_item_mappings (inventory_id) where inventory_id is not null;

create index if not exists pos_catalog_match_proposals_candidate_inventory_id_idx
  on public.pos_catalog_match_proposals (candidate_inventory_id) where candidate_inventory_id is not null;
