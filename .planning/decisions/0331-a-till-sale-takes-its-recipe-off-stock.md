# 0331 — A till sale takes its recipe off stock

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** founder (2026-10-11 chat), who asked for the industry approach and left the choice of it to the coordinator
- **Keywords:** OD-113, F-1329, recipe, bill of materials, BOM, theoretical usage, actual versus theoretical, depletion, cocktail, cocktail_ingredients, pos mapping, sale_volume_ml, house item, uom, food, spirits, cost per serve
- **Links:** closes OD-113 in `OPEN-DECISIONS.md`; [ADR 0070](0070-a-quantity-states-its-own-unit.md) (a quantity states its own unit, Locked: OD-113's quantity half); [ADR 0115](0115-the-house-item-is-the-ledgers-key.md) (the house item is the ledger's key, the founder's 2026-09-03 identity pick); [ADR 0011](0011-pos-sale-volume-contract.md) (POS sale volume); [ADR 0297](0297-a-glass-is-not-a-bottle.md); [ADR 0048](0048-domain-quant-under-research-math.md) (food into math); `.planning/07-reference/LEDGER-FOOD-MIGRATION-OPTIONS.md` §10

## Context

OD-113 asked whether the core ledger should admit items that are not wine. Two of its halves were already answered:

- **Quantity.** ADR 0070 (Locked) keeps quantities as integers and makes every row state its own unit.
- **Identity.** ADR 0115 makes the house item (`restaurant_inventory.id`) the ledger's key for every beverage, and lets a house item with no library row state its own kind and unit (`set_house_item_identity`, `20270103900000`).

What was still missing was how a sale on the till reaches more than one stock row. F-1329 (sim S187) showed the effect:

- A cocktail sold on the till takes nothing off stock, or at most one bottle.
- A POS mapping holds one `inventory_id` and one `sale_volume_ml` (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:562-595`).
- The recipe editor writes only free text, quantity and unit (`apps/web/src/pages/cellar/next/CocktailRegister.tsx`). Nothing reads `cocktail_ingredients` outside `beverages.service.ts`, which says itself that the table is empty (`:249`, `:773`).

The founder, 2026-10-11, verbatim: *"OD113, is this the industry approach? Apply to that. Do not need my approval for that, you decide."*

## Options considered

1. **One stock row per till item (as built).** It is simple. But a negroni's gin, vermouth and Campari never move, so pour cost and variance are blind for every mixed drink and every dish.
2. **Deplete only from counts (periodic inventory).** There is no recipe to keep. But the house learns usage only at the next count, and it can never tell waste from sales.
3. **Recipe-based (theoretical) depletion.** Each till item has a recipe that lists house items and an amount of each, in that item's own unit. A sale takes every line off stock. Counts are then compared with what the sales say should be left. This is how MarketMan, Restaurant365, Crunchtime and xtraCHEF all work. **Chosen.**

## Decision

**A till item maps to a recipe, and a sale takes each recipe line off stock in the line's own unit. Counts measure actual use against what the recipes say (actual versus theoretical). Any stock the house carries, wine or not, is a house item under ADR 0115, with quantities as in ADR 0070.**

1. **A recipe line names a house item and an amount** in that item's unit (ml, g or each, as ADR 0070 allows). Free text remains only as a label. A line that names no house item is shown as "not linked to stock" and takes nothing off. No amount is guessed.
2. **A single-bottle mapping is a one-line recipe.** Today's `inventory_id` plus `sale_volume_ml` keeps working unchanged. A glass of wine is one line of its pour (ADR 0297).
3. **A sale writes one ledger movement per line, all carrying the sale's id.** That makes the sale idempotent, and a voided sale reverses all of its lines together.
4. **The cost per serve is the sum of the line costs**, each at the house item's own cost. If any line has no cost, the cost per serve is unknown, never partly summed (ADR 0020).
5. **Variance is read from counts:** expected on hand (last count, minus recipe usage, plus receipts) against the counted amount, per house item.
6. **Not decided here.** Prep yields (whole carrot to peeled carrot, ADR 0048's transformation keystone) and sub-recipes are not covered. A recipe line points at a stock row, never at another recipe. Whether a house item with no library row needs a shared food identity remains research (`LEDGER-FOOD-MIGRATION-OPTIONS.md` §10.6). It does not block this decision.

## Consequences

- Mixed drinks and dishes finally move stock, and pour cost and variance cover them.
- Every till item without a recipe stays visible as unlinked rather than silently costing zero.
- Recipes become data the house has to keep up to date. A wrong recipe shows up as a variance at the next count, which is the industry's own check on it.
- Revisit when a house needs prep yields or sub-recipes (the first kitchen with a batch syrup or a stock is the signal).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created from the founder's chat ruling (sim S195) |
