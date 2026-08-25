-- OD-71 — the ten POS reference columns that still had no foreign key.
--
-- WHY THIS EXISTS
-- ---------------
-- `pos_item_mappings` had NO foreign keys at all. That is how 92 rows came to
-- point at a `restaurant_id` present in no row of `restaurants` and at 92
-- `inventory_id`s resolving to nothing: `synth teardown` deleted the tenant and
-- the database had no way to object. ADR 0012 closed `inventory_id` and ADR 0014
-- closed `candidate_inventory_id`, deliberately leaving the rest for this one.
--
-- A dangling reference here is not a mild defect. Both stock RPCs
-- `RAISE 'inventory % not found'`, so the line wrote nothing — but it had already
-- passed the `if (!it.inventory_id)` branch that queues unmapped lines, so it
-- landed in NEITHER stock NOR `pos_unresolved_lines`. A black hole, not a
-- shortfall.
--
-- DELETE BEHAVIOUR IS DERIVED, NOT INVENTED
-- -----------------------------------------
-- Measured across the 224 existing public foreign keys:
--   restaurant_id -> restaurants : CASCADE 62, NO ACTION 6, SET NULL 4
--   -> auth.users                : SET NULL 2 of 2
-- So tenant scoping cascades and actor attribution nulls, because that is what
-- this schema already does. Where the census was genuinely split
-- (master_wine_library, restaurant_inventory), the tie-break is ADR 0014's rule:
-- **a claim dies with its target; a question outlives its answer.**
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Tenant scoping — CASCADE (the 62-case majority)
-- ---------------------------------------------------------------------------
-- Every one of these tables is tenant-scoped and meaningless without its
-- restaurant. Cascading is also what the synth teardown always assumed was
-- happening, which is precisely why nobody noticed it was not.
alter table public.pos_item_mappings
  drop constraint if exists pos_item_mappings_restaurant_id_fkey,
  add  constraint pos_item_mappings_restaurant_id_fkey
       foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

alter table public.pos_catalog_match_proposals
  drop constraint if exists pos_catalog_match_proposals_restaurant_id_fkey,
  add  constraint pos_catalog_match_proposals_restaurant_id_fkey
       foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

alter table public.pos_checks
  drop constraint if exists pos_checks_restaurant_id_fkey,
  add  constraint pos_checks_restaurant_id_fkey
       foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

alter table public.pos_unresolved_lines
  drop constraint if exists pos_unresolved_lines_restaurant_id_fkey,
  add  constraint pos_unresolved_lines_restaurant_id_fkey
       foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Identity claims against the wine library — SET NULL
-- ---------------------------------------------------------------------------
-- `master_wine_id` asserts "this POS item IS that library wine". If the library
-- entry is merged away or deleted, the mapping itself is still a real mapping to
-- a real inventory row — it has merely lost a claim about identity. CASCADE here
-- would delete a working mapping because a catalogue entry was tidied up.
alter table public.pos_item_mappings
  drop constraint if exists pos_item_mappings_master_wine_id_fkey,
  add  constraint pos_item_mappings_master_wine_id_fkey
       foreign key (master_wine_id) references public.master_wine_library(id) on delete set null;

-- Same reasoning, and the same direction ADR 0014 already chose for this row's
-- sibling `candidate_inventory_id`: a proposal is a QUESTION, and it outlives the
-- answer it was proposing.
alter table public.pos_catalog_match_proposals
  drop constraint if exists pos_catalog_match_proposals_candidate_master_wine_id_fkey,
  add  constraint pos_catalog_match_proposals_candidate_master_wine_id_fkey
       foreign key (candidate_master_wine_id) references public.master_wine_library(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. The unresolved queue's two inventory columns — SET NULL, both of them
-- ---------------------------------------------------------------------------
-- An unresolved line IS a question: "what wine is this, and how much does one
-- sale remove?" Deleting the inventory row it referenced does not answer the
-- question or make it moot — it makes it *more* open. CASCADE would silently
-- shrink the review queue whenever inventory changed, which is the one thing a
-- queue must never do to itself.
--
-- `mapped_inventory_id` is what the pipeline KNEW; `resolved_inventory_id` is
-- what a human DECIDED (ADR 0011). Both nulling out is correct and leaves the
-- row's `reason` telling the reviewer what is still being asked.
alter table public.pos_unresolved_lines
  drop constraint if exists pos_unresolved_lines_mapped_inventory_id_fkey,
  add  constraint pos_unresolved_lines_mapped_inventory_id_fkey
       foreign key (mapped_inventory_id) references public.restaurant_inventory(id) on delete set null;

alter table public.pos_unresolved_lines
  drop constraint if exists pos_unresolved_lines_resolved_inventory_id_fkey,
  add  constraint pos_unresolved_lines_resolved_inventory_id_fkey
       foreign key (resolved_inventory_id) references public.restaurant_inventory(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Actor attribution — SET NULL (2 of 2 existing cases)
-- ---------------------------------------------------------------------------
-- Deleting a user must never delete the record that something was resolved. The
-- decision stands; only the attribution is lost. CASCADE here would let an
-- account deletion quietly erase queue history.
alter table public.pos_unresolved_lines
  drop constraint if exists pos_unresolved_lines_resolved_by_fkey,
  add  constraint pos_unresolved_lines_resolved_by_fkey
       foreign key (resolved_by) references auth.users(id) on delete set null;

alter table public.pos_catalog_match_proposals
  drop constraint if exists pos_catalog_match_proposals_resolved_by_fkey,
  add  constraint pos_catalog_match_proposals_resolved_by_fkey
       foreign key (resolved_by) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5. Indexes on the referencing side
-- ---------------------------------------------------------------------------
-- Postgres indexes the referenced key, never the referencing column. Without
-- these, every CASCADE delete of a restaurant sequentially scans each POS table,
-- and `pos_checks` is the table expected to grow fastest of anything here.
create index if not exists pos_item_mappings_restaurant_id_idx
  on public.pos_item_mappings (restaurant_id);
create index if not exists pos_catalog_match_proposals_restaurant_id_idx
  on public.pos_catalog_match_proposals (restaurant_id);
create index if not exists pos_checks_restaurant_id_idx
  on public.pos_checks (restaurant_id);
create index if not exists pos_unresolved_lines_restaurant_id_idx
  on public.pos_unresolved_lines (restaurant_id);

-- Partial: these columns are mostly NULL, so a full index is mostly empty pages.
create index if not exists pos_item_mappings_master_wine_id_idx
  on public.pos_item_mappings (master_wine_id) where master_wine_id is not null;
create index if not exists pos_catalog_match_proposals_candidate_master_wine_id_idx
  on public.pos_catalog_match_proposals (candidate_master_wine_id) where candidate_master_wine_id is not null;
create index if not exists pos_unresolved_lines_mapped_inventory_id_idx
  on public.pos_unresolved_lines (mapped_inventory_id) where mapped_inventory_id is not null;
create index if not exists pos_unresolved_lines_resolved_inventory_id_idx
  on public.pos_unresolved_lines (resolved_inventory_id) where resolved_inventory_id is not null;
