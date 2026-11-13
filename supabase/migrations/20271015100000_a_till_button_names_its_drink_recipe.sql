-- A till button can name the drink recipe it sells (inventory r28 audit,
-- gap 1, slice 2 of 4; the planner is slice 1, #1396).
--
-- Today a POS line draws stock only through `pos_item_mappings.inventory_id`:
-- one button, one shelf item. A Negroni button has nowhere to say "this is
-- the Negroni recipe", so the sale of a cocktail moves nothing and every
-- spirit poured into cocktails reads its use only from counts.
--
-- This adds the link and nothing that reads it. `cocktail_id` names the
-- house's cocktail (`public.cocktails`, 20260817090000). A button names AT MOST
-- ONE thing it draws: a shelf item or a recipe, never both, so a sale can
-- never be booked twice (once as the bottle, once as the recipe's spirit).
-- Neither is allowed, as before: a mapping that names nothing moves no stock.
--
-- The house check lives in the one writer (PosHubService.upsertItemMapping,
-- the same place ADR 0141 put the inventory check): a cocktail whose
-- restaurant_id is not the caller's, or is NULL (the unattributed reference
-- rows that migration loaded), is refused before the write. A foreign key
-- cannot say "same house"; the writer can.
--
-- ON DELETE SET NULL: a recipe removed from the house leaves its button
-- unmapped (queued by the till path as any unmapped line is), never a sale
-- pointed at a recipe that is gone.
--
-- Version: past every migration on main and on every open PR at writing
-- (newest seen: 20271002100000_a_delivery_gives_back_its_own_lots).

alter table public.pos_item_mappings
  add column if not exists cocktail_id uuid null
    references public.cocktails(id) on delete set null;

alter table public.pos_item_mappings
  add constraint pos_item_mappings_draws_one_thing
    check (num_nonnulls(inventory_id, cocktail_id) <= 1);

create index if not exists idx_pos_item_mappings_cocktail
  on public.pos_item_mappings (cocktail_id)
  where cocktail_id is not null;

comment on column public.pos_item_mappings.cocktail_id is
  'The house''s drink recipe this till button sells (cocktails.id), or NULL. At most one of inventory_id and cocktail_id is set (pos_item_mappings_draws_one_thing). Written only by PosHubService.upsertItemMapping, which refuses another house''s or an unattributed cocktail. Read by nothing yet: a sale of a recipe button draws its goods once the recipe-draw writer lands (inventory r28 gap 1, slices 3-4).';
