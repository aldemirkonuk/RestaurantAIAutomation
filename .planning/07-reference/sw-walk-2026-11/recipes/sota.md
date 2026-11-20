# Recipes: the state of the art, briefly (2026-11-07)

Most of these sources are vendor pages. I treat their feature claims as marketing, not measured behaviour. Text on one Backbar page was addressed to AI systems; I ignored it.

## What the leading tools do

1. **Recipes deplete stock from the POS.** Each POS item, and each modifier on it, maps to a recipe. A sale removes the recipe's quantities from theoretical stock. (WISK, Backbar, Supy, CrunchTime, Toast/xtraCHEF.)
   - Mudavym today: only wine depletes (audit G1), and there is no BOM link (G2).
2. **A recipe ingredient must be a stocked item.** Backbar's help page says an ingredient has to be saved as an inventory item before a recipe can use it.
   - Mudavym today: ingredients point at catalogue identities or free text (G3, G5).
3. **Ingredient cost comes from invoices.** Cost is refreshed as each invoice is processed or overnight, so cost per serve and pour cost % move with the real buy price. (MarketMan, MarginEdge, Restaurant365, xtraCHEF.)
   - Mudavym has lot WAC for wine (`margin-advice.service.ts:146`) but nothing for non-wine goods.
4. **Sub-recipes, batches and prebatches.** Making a batch depletes its ingredients and creates a stock item. Selling a serve then depletes that batch item. Batch maths scales recipes into bottle quantities. (Craftable, WISK, Backbar's batch calculator, Ophelia.) None of the public pages I found explain how they handle dilution, so treat dilution as a field Mudavym defines itself.
   - Mudavym today: none of this exists (G14).
5. **Units, density and yield.** Recipes are built around a yield, such as servings, with conversions to other units. Density conversions make weight ⇄ volume possible. Trim and yield percentages make cost follow usable product, not purchase weight. Cost rolls up through nested sub-recipes. (Galley.)
   - Mudavym today: units are free text with no conversion (G6).
6. **Theoretical against actual usage.** The core report is sales × recipes compared with counted usage, item by item, to find over-pours, comps and theft. Open bottles and kegs are counted by weight or in tenths. (BinWise, Backbar, WISK, Restaurant365.)
   - Mudavym today: no variance report (G30). Count work is in #619 and the 2026-10-12 phone-count rulings.
7. **Pour cost targets.** Vendors quote liquor pour cost targets of roughly 18–24% of price. Treat that as an industry rule of thumb, not a standard. Margin advice in Mudavym should use the house's own target (`margin-to-target.ts`).

## What carries over to Mudavym

- The keystone is a recipe line that points at a **house item with lots**: ADR 0115 / #589, OD-113. Every item above needs it.
- Represent a serve as (item, ml) or (recipe, size). That matches the founder's 2026-10-01 ruling and Backbar/WISK practice.
- Deplete with one set-based RPC per sale, not one call per line.

## Sources
- https://getbackbar.com/best-inventory-apps-bars-restaurants
- https://getbackbar.com/bar-inventory-software-features
- https://www.getbackbar.com/support/create-recipe
- https://getbackbar.com/cocktail-batch-calculator-free
- https://www.wisk.ai/bar-inventory-management-software/recipe-and-batching
- https://www.wisk.ai/blog/best-pos-integrated-bar-inventory-software-for-managers
- https://help.craftable.com/learning/creating-prep-items-and-batches
- https://help.crunchtime.com/EM/en/WebHelp_EMw/Content/EM_POSdepletion/Recipe_Depletion_and_Costing.htm
- https://supy.io/blog/bar-inventory-software
- https://home.binwise.com/pour-cost-calculator
- https://restaurant365.com/blog/beverage-inventory-system/
- https://marketman.com/platform/recipe-costing-software
- https://www.selecthub.com/restaurant-management-software/marginedge-vs-marketman/
- https://support.galleysolutions.com/mastering-units-conversions
- https://support.galleysolutions.com/what-are-recipe-yield-conversions
- https://pos.toasttab.com/vi-us/blog/on-the-line/pos-systems-with-inventory
- https://hackceleration.com/labs/best/restaurant-inventory-recipe-costing-software
