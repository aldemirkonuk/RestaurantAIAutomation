-- A match proposal may no longer nominate an inventory row that does not exist.
--
-- The other half of ADR 0012. That migration constrained
-- `pos_item_mappings.inventory_id` and deliberately left
-- `pos_catalog_match_proposals.candidate_inventory_id` alone, because the right
-- referential action there is not the same one — and picking it in passing, in a
-- migration about something else, is how the wrong one gets locked in.
--
-- Both columns went dangling together for the same reason: `SYNTH_WRITE_SET`
-- omitted both tables, so `synth teardown` deleted the sim `bistro` tenant's
-- inventory and left 92 mappings AND 92 pending proposals pointing at it.
--
-- ---------------------------------------------------------------------------
-- Why SET NULL here, when the mapping got CASCADE
-- ---------------------------------------------------------------------------
-- The two columns mean different things, so they earn different actions.
--
-- A MAPPING is a claim: "this POS item depletes that stock row". If the stock
-- row is gone the claim is void and the whole mapping is meaningless — there is
-- nothing left to say. CASCADE.
--
-- A PROPOSAL is a question: "this POS item is unmatched; is that inventory row
-- the right target?". If the candidate disappears, the QUESTION SURVIVES — the
-- POS item is still unmatched and still needs a human answer. Deleting the
-- proposal would silently drop the open question along with its stale answer,
-- which is the same class of loss B20 built `pos_unresolved_lines` to prevent.
-- SET NULL keeps the question and discards only the dead suggestion.
--
-- This is safe precisely because the approve path already handles the null:
-- catalog-matcher.service.ts:417 throws "Proposal has no candidate inventory
-- item to approve", and a test already covers that branch
-- (catalog-matcher.service.spec.ts:299). So a nulled candidate degrades a
-- proposal from "approve this" to "needs a target" — visible and honest —
-- instead of letting a human approve it into a mapping the FK added by ADR 0012
-- would immediately reject.
--
-- RESTRICT was rejected for the same reason it was rejected on the mapping: it
-- would make `synth teardown` fail rather than complete, turning a data
-- integrity rule into an operational blocker.

-- ---------------------------------------------------------------------------
-- 1. Clear any dangling candidate first
-- ---------------------------------------------------------------------------
-- Idempotent, and a no-op right now: ADR 0012 deleted the 92 orphaned proposals
-- outright (their tenant was gone, so the question died with it, not just the
-- answer), and the table holds 0 rows. This exists so the migration is correct
-- in an environment where the rows were never deleted — there, the honest
-- outcome is a proposal that keeps its question and loses its candidate, which
-- is exactly what the FK will do from here on.
update public.pos_catalog_match_proposals p
   set candidate_inventory_id = null
 where p.candidate_inventory_id is not null
   and not exists (
     select 1 from public.restaurant_inventory i where i.id = p.candidate_inventory_id
   );

-- ---------------------------------------------------------------------------
-- 2. Index the referencing column
-- ---------------------------------------------------------------------------
-- Same reason as ADR 0012's: Postgres indexes the referenced side (a PK) but
-- never the referencing side, so a bulk `delete from restaurant_inventory` —
-- which is what teardown does — would seq-scan this table once per deleted row
-- to find the rows it must null out.
create index if not exists pos_catalog_match_proposals_candidate_inventory_id_idx
  on public.pos_catalog_match_proposals (candidate_inventory_id)
  where candidate_inventory_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The constraint
-- ---------------------------------------------------------------------------
alter table public.pos_catalog_match_proposals
  drop constraint if exists pos_catalog_match_proposals_candidate_inventory_id_fkey;

alter table public.pos_catalog_match_proposals
  add constraint pos_catalog_match_proposals_candidate_inventory_id_fkey
  foreign key (candidate_inventory_id)
  references public.restaurant_inventory (id)
  on delete set null;

comment on column public.pos_catalog_match_proposals.candidate_inventory_id is
  'Suggested stock target awaiting a human answer. NULL = no candidate, which is '
  'a legitimate state (the item is unmatched and needs one). When set it MUST '
  'resolve: the FK nulls it if the inventory row is deleted, keeping the open '
  'question while dropping the dead suggestion (ADR 0014).';
