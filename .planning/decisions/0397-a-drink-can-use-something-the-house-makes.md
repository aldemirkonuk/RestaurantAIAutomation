# 0397 — A drink can use something the house makes (syrup, infusion, batch mix, cordial)

- **Status:** Proposed (2026-11-20). Every fork below is the session's call under the founder's standing delegation; the cost maths (item 4) and scope (item 6) are the ones to look at first.
- **Decider:** Sonnet builder "drinks-gap" (r104, sw-walk).
- **Links:** [ADR 0360](0360-a-recipe-is-a-versioned-list-of-house-items-in-base-units.md) (line contract widened here), [ADR 0366](0366-a-dish-has-a-recipe-on-the-drinks-recipe-engine.md) (the dish engine reused as the component).

## Context

A line of a drink's recipe is `stocked` (a shelf item) or `untracked` (ice, garnish). A bar's simple syrup, infusion, batch mix or cordial is neither: it is made from shelf goods by its own recipe and has a yield. Today it can only be `untracked`, which is not counted, so the drink's cost reads "not priced" and "every recipe costed" fails for most cocktail menus (r104 drinks need 1). No ADR, PR title or code path covers sub-recipes.

## Decision

1. **A house-made component is a `dishes` row with a stated yield** (`yield_qty_base` in `yield_base_unit`: `ml10`, `mg` or `each_milli`). It already has versions, a current pointer, a save path, a cost and a sheet, so nothing is built twice. *Rejected:* (a) an inventory item flagged `made_in_house` with a recipe attached: it needs a third owner kind on `recipe_versions` and its own current pointer; (b) a new `components` table: the same machinery, copied; (c) a `cocktails` row: it would put syrups on the cocktail list.
2. **A line gains the role `made`**, with `component_dish_id` (FK, `ON DELETE RESTRICT`); `role = 'made'` if and only if the component is named. `recipe_lines_untracked_has_no_item` is not lifted: a made line has no shelf item, which that CHECK already allows (the brief assumed it did not).
3. **The rules live in `recipe_insert_lines`**, the one writer both saves share: the component is a live dish of the same house with a yield; the line is measured in the unit the component is made in (ml against ml, g against g, never converted: no density is guessed); a made line has no usable share and no shelf link.
4. **Cost maths (gateway, next PR):** the component's cost per base unit = (its cost for one batch) / `yield_qty_base`; a made line costs `qty_base x that / serves`. A component whose own cost is not complete prices nothing: the line is unpriced and the drink says "N lines not priced", never a partial total (ADR 0051). The line carries a "priced through <component>" rung.
5. **No cycles, three levels deep.** `recipe_component_chain_ok(owner, component)` walks the components' current versions: the owner reached, or a chain of components under a use longer than three, is refused at the use site. Nothing looks upward, so lengthening a component can push an existing drink past three; the gateway cost reads the same cap and leaves such a line unpriced instead of looping.
6. **Scope of this record's first slice:** schema, the line rules and their tests. Not in it: the gateway cost and endpoints to set a component's yield, and the web ("Make it in house" on the line, the component's lines under "What is in a serve", drinks listed through components, hiding components from /dishes). Those follow as stacked PRs.

## Consequences

A dish with a yield is a component and would show on /dishes until the web hides it (a list filter, not a schema change). A component's recipe is edited like any dish, so each save is a new version and a drink always reads its component's current version.
