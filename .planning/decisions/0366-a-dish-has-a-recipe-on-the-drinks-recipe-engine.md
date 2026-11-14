# 0366 — A dish has a recipe on the drinks' recipe engine; a good says which dishes use it

- **Status:** Proposed (2026-11-13). Every fork below is the session's call under the founder's 2026-11-07 /goal ("all goods including foods now (when clicked show how is it being used in what items full kpi cards ... same thing for drinks (recipes)"; "Do not ask me any questions ... reference [the ADRs] but do not have to stick with them"). A lock is his.
- **Date:** 2026-11-13
- **Decider:** Opus head session r15 (sw-walk), under the /goal.
- **Keywords:** dish, recipe, food, owner kind, used in, food cost, pour cost, shelf link, unit of measure
- **Links:**
  - [ADR 0360](0360-a-recipe-is-a-versioned-list-of-house-items-in-base-units.md): the recipe engine this widens. Its line rules (F2, F3, F4, item 11) and grants (item 12) carry over unchanged. Its item 8 ("no pour-cost percentage") is superseded here, see 6.
  - ADR 0359 (open, #784): the house tax basis. Item 6 states what a percentage is of while it is open.
  - [ADR 0051](0051-rebuilt-pages-show-live-data-only.md), [ADR 0053](0053-analytics-cost-unknown-not-invented.md): unknown is null, never 0.
  - Build notes: `p4-scratch/sw-walk/r14/BUILD-2026-11-12-r14.md` Part B (a)-(d), and `r15/BUILD-2026-11-13-r15.md`.

## Context

The r14 walk of a mixed house found a food good's drawer saying "No dish carries a recipe yet": `recipe_versions.owner_kind` allowed only `'cocktail'`, so no food could say which plates use it. A pasted recipe line never proposed a shelf link, even on an exact name (`RecipeSheet.tsx` `fromProposal` sets `inventoryId: null`). A drink had a cost and a price but no pour cost. Food rows on /inventory showed wine columns.

## Decision

1. **A `dishes` table owns a dish's recipe** (`restaurant_id NOT NULL`, name, menu section, price, soft delete). One live dish per folded name in a house.
   - *Rejected:* dishes as `cocktails` rows. It mislabels food, and the drink cards (pure alcohol, glass) would apply to a plate.
   - *Rejected:* menu lines (`menu_items`) as owners. They carry `menu_id NOT NULL`, are re-created with each menu read, and are wine-shaped (`bottle_price`, `by_glass_price`, `vintage`). A recipe must outlive a menu version.
2. **`recipe_versions` widens, it is not forked.** `owner_kind IN ('cocktail','dish')`, a new `dish_id`, and `num_nonnulls(cocktail_id, dish_id) = 1`. A composite FK `(dish_id, restaurant_id) → dishes(id, restaurant_id)` makes a cross-house dish version impossible for any writer, not only the RPC. Dish lines are ordinary `recipe_lines`, so units, base quantities, append-only history and the shelf link are ADR 0360's, with no second copy.
   - *Rejected:* separate `dish_recipe_versions`/`dish_recipe_lines` tables. Every reader (cost, what is in it, "used in") would need two code paths, and the line rules would drift.
3. **A sibling pointer, `recipe_current_dish`**, rather than generalising `recipe_current` to `(owner_kind, owner_id)`.
   - Rejected generalising `recipe_current`: its primary key is `cocktail_id`, and a polymorphic `owner_id` cannot hold a real FK. That would drop the composite FK that keeps the pointer on a version of the same drink (ADR 0360 F4). It would also rewrite a table whose migration is still an open PR.
4. **The line rules move into `recipe_insert_lines`**, which `save_dish_recipe_version` calls. `save_recipe_version` for cocktails is left as ADR 0360 wrote it.
   - Rejected re-creating the cocktail RPC on top of the helper. This migration runs after the recipe chain's, so a `CREATE OR REPLACE` here would silently undo any later amendment that chain makes to its own function.
   - The cost of this is two copies of the line loop until the recipe chain merges. Folding the cocktail RPC onto the helper is a follow-up for that chain.
   - The pgtest proves the cocktail path is unchanged (T5).
5. **The gateway serves dishes on the recipe routes** (`/recipes/:rid/dishes...`):
   - list, create, update;
   - the recipe read, version reads, the save and the cost preview, all owner-generic in `RecipesService`;
   - `GET /recipes/:rid/items/:itemId/dishes`: the dishes whose CURRENT version links the item, each with its cost a plate, price, food cost and the item's amount a plate.
   The inventory drawer reads that route and draws one card row per dish. Reads past 1,000 rows page.
   - *Rejected:* adding dishes to `GET /inventory/:rid/item/:id/used-in`. That service lives on the drawer stack, which has no recipe tables, and the two stacks would have to merge before either worked.
6. **A cost-share card on drinks ("Pour cost") and dishes ("Food cost"): cost a serve ÷ the listed price, as a %.**
   - It is shown only when the cost is complete and the price is known and above 0. Otherwise it reads "Not known" and says which side is missing. It is never a % of a partial cost.
   - This supersedes ADR 0360 item 8, which held the percentage back until the house tax basis (ADR 0359) exists. The founder's /goal asks for full KPI cards, and pour cost is the bar's own measure.
   - The card says what the % is of: "of the price as your list has it; whether that price includes tax is not recorded". It does not back tax out at a guessed rate.
   - When ADR 0359 lands, the card divides by the net price and drops that sentence.
   - *Rejected:* a margin in money. It needs the tax basis to be honest at all.
   - *Rejected:* waiting for ADR 0359. That leaves the founder's ask unbuilt for an open PR.
7. **A pasted line proposes its shelf link on an exact folded name** (case and runs of spaces folded, nothing else). The proposal shows "Linked to X" and the link is saved only by Save, so ADR 0360 F17 ("proposed only") holds.
   - One gateway call per paste: `POST /recipes/:rid/shelf/match`, which reads the whole live shelf, paged.
   - Two shelf items with the same folded name propose no link and say so.
   - *Rejected:* fuzzy matching. A wrong link silently changes cost.
   - *Rejected:* linking at Save without showing it.
8. **Food and supply rows on /inventory read in their own unit** (#1221): Type "Food"/"Supply", "kept in kg", cost a unit, no btl/gl, no "Add a bottle".
   - That PR is based on #1071, not #1182. #1071 owns the list's `goodOf`/`uomOf`, and #1182's tip has neither, so basing on it would have meant re-deriving them in a second place.
   - *Rejected:* separate pages per kind. The founder asked for one list of all goods.

## Not in this record

- Sale depletion for dishes. The till-to-dish map comes with ADR 0360's next wave.
- Preps, batches and sub-recipes. `owner_kind` widens again for them.
- Linking a dish to a menu line.
- A dish's photo, allergens beyond what its lines state, and menu-engineering classes.
