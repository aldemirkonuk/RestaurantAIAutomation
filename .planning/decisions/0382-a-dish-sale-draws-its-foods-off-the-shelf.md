# 0382 — A dish sale draws its foods off the shelf, once per check line, and its void gives them back

- **Status:** Proposed (2026-11-20). Not locked; a lock is the founder's. Every fork below is the session's call under the founder's standing delegation (r103 inventory builder); nothing here is built.
- **Date:** 2026-11-20
- **Decider:** r103 inventory builder (sw-walk), after DD-r102-31 (selector: APPROVE under a new ADR).
- **Keywords:** dish, recipe draw, pos_item_mappings, dish_id, usable_pct, yield, void, idempotent, COGS, food cost
- **Links:** ADR 0360 (a recipe is a versioned list of house items in base units; "sale depletion is the next wave"), ADR 0366 (a dish has a recipe on the drinks' recipe engine; its "Not in this record" names this), ADR 0020 (a failed read says so), ADR 0051/0053 (unknown is null, never 0). PRs: #1908 (`feat/g1-inv-recipe-draw-wired-to-sales`, the drink draw this reuses), #1909 (Toast caller), the `feat/a-dish-has-a-recipe-schema` branch (the `dishes` table).

## Context

A food or supply moves only by receipts and counts. A sold dish takes nothing off the shelf, so a kitchen's food cost of goods reads zero and a good's use is measured from its counts alone (`apps/web/src/pages/inventory/next/ItemCards.tsx:260`, `NOT_DRAWN_BY_SALES`: "A sale does not draw a food or supply down yet"). The drink path exists: #1908's `sellRecipeLine` (`apps/api-gateway/src/pos-hub/recipe-sale.ts`) plans a draw from a mapped cocktail's current recipe version, books it through `record_recipe_draw`, and a void calls `reverse_recipe_draw`, keyed by the sale key, with the remainder carried (`recipe-draw.ts`, "settle keeps 0 <= carry < one unit"). What is missing is the dish side of the till mapping, and the yield of a good.

`pos_item_mappings` (baseline `20260805000000_baseline_from_production.sql:4216`) carries `master_wine_id` and `inventory_id` only. #1908 reads a cocktail id from it. A dish has no owner column there.

## Decision

1. **`pos_item_mappings` gets its own `dish_id`**, a composite FK `(dish_id, restaurant_id) -> dishes(id, restaurant_id)` (the 0366 pattern, so no writer can map a till button to another house's dish), with `num_nonnulls(cocktail_id, dish_id) <= 1`. `cocktail_id` is never reused for a dish. *Rejected:* reusing `cocktail_id` for both owners (a lookup by id would need a second query to learn the kind, and a stale id could draw a drink recipe off a food sale); one polymorphic `(owner_kind, owner_id)` pair with no real FK (loses the cross-house guarantee, the same reason 0366 item 3 refused it).
2. **The draw reuses #1908's path, not a copy.** `sellRecipeLine` takes an owner `{kind, id}`; its reads (`readRecipe`) pick the cocktail or dish current-version pointer, and the same `record_recipe_draw` / `reverse_recipe_draw` writers book and unbook. *Rejected:* a parallel dish writer (two copies of the carry and lock rules, which already drifted once between the cocktail and dish line loops, 0366 item 4).
3. **Idempotent per check line.** The key is the till's sale key plus the line's own id (`<sale_key>:<line_id>`), never the check alone, so two identical dishes on one check are two draws and a replayed webhook is one. A replay returns `{kind: "replay"}` and books nothing. *Rejected:* keying by check (a second line of the same dish would be swallowed as a replay).
4. **Yield: `usable_pct` is the good's, gross = qty x 100 / usable_pct.** A new `restaurant_inventory.usable_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (usable_pct > 0 AND usable_pct <= 100)`; the plan converts each recipe line's net quantity to the gross the shelf gives up (an onion at 85% usable: 100 g on the plate takes 117.65 g off the shelf), then the existing carry settles the remainder. *Rejected:* yield on the recipe line (the same trim loss repeated and drifting across every dish using the good); yield on the dish (a dish does not trim an onion); a global 100% (understates what the kitchen buys). A good with no stated yield draws at 100%, and the card says it is "as stated", never a measured loss (ADR 0051).
5. **Reversible on void.** A void reverses exactly the lots and carry the sale booked (by the same line key), including a part-void of a line (the serves voided, not the line). Nothing booked for the sale: `{kind: "nothing"}`. A void that cannot be planned queues with a sentence; it never books a guess.
6. **Fractional serves.** A line's `serves` may be fractional (a half portion, 0.5); the exact draw is scaled and carried, never rounded up to a whole serve. A serves value that is not a positive finite number queues as `no_sale_volume`.
7. **Comped lines still draw.** A comped or zero-price line leaves the shelf, so it draws; its cost is booked as waste or comp cost by the same writer, not as a sale. A voided or refunded line (not a comp) reverses per item 5.
8. **A dish with no current recipe version, a recipe line with no shelf link, or an unconfirmed house books nothing and queues** (`unmapped` or `no_sale_volume`, the two reasons the review queue holds), the same as a drink. A failed read of the recipe or shelf says so (ADR 0020); it is never an empty draw.
9. **Food COGS reads the draw, not zero.** The sale row carries the weighted cost of the lots drawn (ADR 0381 for drinks); a dish line carries the same, and a dish sold with an unlinked line carries "not known", never a partial figure presented whole.

## Consequences

- A kitchen's food cost and a good's use come from sales once a dish is mapped, and `NOT_DRAWN_BY_SALES` shows only for goods no mapped dish uses.
- Cost: one migration (`dish_id` on `pos_item_mappings`, `usable_pct` on `restaurant_inventory`), an owner parameter on #1908's path, and a per-dish mapping screen on /menu or /inventory (no UI is decided here).
- Sequencing: after #1908 and #1909 merge, and after the dish schema (`feat/a-dish-has-a-recipe-schema`) lands, since both the FK target and the current-version pointer live there.
- Revisit when a house reports a draw that disagrees with its counts by more than its stated yield explains: that is a wrong `usable_pct`, not a code bug.

## Not in this record

Preps and sub-recipes as owners; modifier lines (a "no onion" modifier subtracting a line); a dish photo or allergen on the draw; a house-wide yield default by category. Each needs its own fork.

## Review trail

- r102 panel: DD-r102-31, YES / YES / YES; selector APPROVE under a new ADR. Written here as Proposed; nothing built.
