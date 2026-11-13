# 0366 — A dish has a recipe on the drinks' recipe engine; a good says which dishes use it

- **Status:** Proposed (2026-11-13). Every fork below is the session's call under the founder's 2026-11-07 /goal ("all goods including foods now (when clicked show how is it being used in what items full kpi cards ... same thing for drinks (recipes)"; no questions; ADRs referenced, not binding). A lock is his.
- **Decider:** Opus head session r15 (sw-walk).
- **Links:** [ADR 0360](0360-a-recipe-is-a-versioned-list-of-house-items-in-base-units.md) (the engine widened here; its line rules and grants carry over; its item 8 is superseded by 6). ADR 0359 (open, #784): house tax basis. ADR 0051/0053: unknown is null, never 0. PRs: #1222 schema, #1223-#1225 gateway, #1227-#1229 web, #1226 drawer, #1221 list units.

## Context

r14 found a food good's drawer saying "No dish carries a recipe yet" (`owner_kind` allowed only `'cocktail'`), pasted recipe lines never proposing a shelf link (`fromProposal` sets `inventoryId: null`), no pour cost on a priced drink, and wine columns on food rows.

## Decision

1. **A `dishes` table owns a dish's recipe** (`restaurant_id NOT NULL`, name, section, price, soft delete; one live dish per folded name). *Rejected:* dishes as `cocktails` rows (drink cards would apply to a plate); `menu_items` as owners (`menu_id NOT NULL`, re-created per menu read, wine-shaped; a recipe must outlive a menu).
2. **`recipe_versions` widens, not forks:** `owner_kind IN ('cocktail','dish')`, `dish_id`, `num_nonnulls(cocktail_id, dish_id) = 1`, composite FK `(dish_id, restaurant_id) → dishes(id, restaurant_id)` so no writer can make a cross-house dish version. *Rejected:* separate dish version/line tables (two code paths for every reader; drifting line rules).
3. **A sibling pointer `recipe_current_dish`.** *Rejected:* a polymorphic `recipe_current (owner_kind, owner_id)`: no real FK, so it loses ADR 0360 F4's same-drink guarantee, and it rewrites a table still in an open PR.
4. **Line rules move into `recipe_insert_lines`**, called by `save_dish_recipe_version`; the cocktail RPC is left as is. *Rejected:* re-creating it on the helper: a later `CREATE OR REPLACE` here would silently undo the recipe chain's own amendments. Cost: two copies of the line loop until that chain folds its RPC onto the helper (follow-up). pgtest T5 proves the cocktail path unchanged.
5. **Gateway on the recipe routes** (`/recipes/:rid/dishes...`: list, add, change, read, versions, save, cost preview), plus `GET /recipes/:rid/items/:itemId/dishes`: dishes whose CURRENT version links the item, with cost a plate, price and the item's lines. Reads page past 1,000 rows. *Rejected:* extending `/inventory/.../used-in`, which lives on the drawer stack without the recipe tables; the stacks would have to merge before either worked. Shipped as three PRs to stay under the 30K cap.
6. **A cost-share card: "Pour cost" (drink), "Food cost" (dish)** = cost a serve ÷ listed price, shown only when the cost is complete and the price > 0; else "Not known", naming the missing side, never a % of a partial cost. It says it is "of the price as your list has it; whether that price includes tax is not recorded"; when 0359 lands it divides by the net price. Supersedes ADR 0360 item 8. *Rejected:* a money margin (needs the tax basis to be honest); waiting for 0359 (leaves the founder's ask unbuilt).
7. **A pasted line proposes its shelf link on an exact folded name** (case, runs of spaces) via one `POST /recipes/:rid/shelf/match` per paste; shown as "links to X", saved only by Save (ADR 0360 F17 holds); two items of one name link neither and say so. *Rejected:* fuzzy matching (a wrong link silently changes cost); linking at Save unseen.
8. **Food and supply rows read in their own unit** (#1221): type, "kept in kg", cost a unit, no btl/gl. Based on #1071, which owns the list's `goodOf`/`uomOf` (#1182's tip has neither). *Rejected:* separate pages per kind; the founder asked for one list of all goods.

## Not in this record

Sale depletion for dishes (ADR 0360's next wave); preps and sub-recipes (`owner_kind` widens again); linking a dish to a menu line; dish photos, allergens and menu-engineering classes. The web keeps the `cocktail` field name for a dish's read (#1228); renaming it to `owner` is a follow-up.
