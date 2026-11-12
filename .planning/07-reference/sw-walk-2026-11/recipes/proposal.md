# Recipes: change proposal (software walk #6, 2026-11-07)

Read-only. Code read at `origin/main` `e26a5152d` via `git show` / `git grep`; no tests run, nothing built, production not touched.
Inputs: `audit.md` (this folder), `sota.md`, `verdicts.json` (G1-G30, narrowed claims used as corrected; none refuted).
Also read: PR #589's ADR 0115 (`origin/docs/adr-0115-drinks-lock`, unmerged), because it already holds the founder's drinks rulings that bind this software.
Forks: the founder's /goal of 2026-11-07 delegates every fork ("Do not ask me any questions I approve you decide them all"). Every call in §4 is the session's, not his. Merges, production writes and flag flips stay listed for his word.
ADR 0104: no confidence numbers anywhere on a screen; counts ("2 of 3 lines priced") are not confidence.

---

## 1. Verdict

Mudavym has a cocktail list and an empty recipe table, but no recipe software. Ingredient lines are unlinked text in free-form units (`CocktailRegister.tsx:113`, `20260817090000_cocktails.sql:60-72`). Nothing maps a sale to a recipe (`pos_item_mappings` has one `inventory_id`, baseline `:4216-4226`). Only wine depletes (`pos-hub.service.ts:1365`), so no cocktail, spirit, beer or dish has a cost per serve or takes stock.

The wine glass path that does run has five live math errors:
- a glass void returns whole bottles (`pos-hub.service.ts:1480`, `toast.service.ts:657`);
- Toast books an unknown unit as a bottle (`toast.service.ts:638`);
- the house's default pour is ignored by the database (`20261222100000_…:319`);
- the period cost of goods follows bottles opened, not ml poured (`:388-396`, `20270301170000_…:109`);
- saving a recipe can erase it and then say "Nothing was changed" (`beverages.service.ts:691/701`, `CocktailRegister.tsx:131`).

Fix those five first; they need no decision. Then build one recipe engine on ADR 0115's house item and its serve and ml plan (#589). That plan already settles batches, serves, kegs, and voids returning volume, so this software adds four things: versioned lines in base units, a sale that takes its recipe, cost per serve on read, and variance.

---

## 2. Target experience

People pages stay simple: one number per line, plain words, no table names. Technical pages are dense.

Tokens come from `apps/web/src/styles/mudavym.css` (light `:142-188`, dark `:211-255`):
- surfaces use `--paper-0/1/2` and text uses `--ink-1..4`;
- `--seal` marks linked and costed items;
- `--warn` with `--warn-tint` marks "not linked", "no cost yet" and "waiting";
- `--loss` marks a cost over the house's target;
- `--alarm` is kept for refusals (a save that did not happen).

### 2a. The drink's recipe sheet (bar lead, owner, manager; phone and desk). People page.

The sheet opens from a cocktail row in the cellar's Cocktails register.
- **Header:** the name, the price (one per serve), the glass, the garnish and a description (G23).
- **Ingredient rows:** each row has an ingredient picker that searches the house's own shelf, an amount, a unit menu (ml, cl, oz, dash, barspoon, each, g) and a "kept on the shelf / not counted" switch. Garnish, ice and water default to "not counted".
- **Footer, the one line that matters:** "Costs ₺57.00 a serve at today's prices · 15% of the price before KDV". The percent shows only when the house has set its tax basis (§4 F8). Without it the footer reads "Costs ₺57.00 a serve · set your tax basis to see pour cost". When the cost is over the kind's target (ADR 0115 R82), the line turns `--loss` and names the target.
- **A linked ingredient with no cost yet:** the row says "No price yet: it will cost once a delivery of it is checked in". The footer says "2 of 3 ingredients priced", never a partial total presented as the cost.
- **A "kept on the shelf" row not linked to anything:** "This drink won't take stock until 'sweet vermouth' is linked to a bottle on your shelf", in `--warn`.
- **Paste a spec:** a paste box turns "1½ oz gin / 2 dashes Angostura / 1 egg white" into rows the bartender confirms before saving. Fractions, ½ and ¾ are read, "egg white" becomes 1 each, and nothing is saved unconfirmed (G24).
- **Saving:** "Saved. 3 ingredients, version 4." A failed save says "Not saved. Your recipe is as it was" and is true (G7). The sheet shows the saved lines immediately (G8).
- **History:** a quiet link, "Earlier versions (3)". A sale always remembers which version it used.
- **Staff without the right:** they see the sheet read-only, with no cost and no price, matching the staff money rule.

### 2b. House prep (batches, syrups, juices). People page.
- A prep is an item labelled "House prep" (ADR 0115 R61), with its own recipe and a yield ("makes 2 L", "makes 20 serves").
- "Record a run" asks for: what was used (prefilled from the recipe and editable), what it made, and its use-by date.
- The run is record-only until the founder switches stock moves on (R60). The screen says so: "Recorded. Stock does not move yet."
- Cost per litre of the prep is ingredients only (R76). A cocktail that uses the prep costs it like any other ingredient.

### 2c. Till to recipe map (owner, manager; desk). Technical page, dense.
- One table: till item / modifier, then serve (name, ml), then item, then recipe version, then status (`takes stock`, `waiting: unlinked ingredient`, `waiting: no size`, `kind not switched on`).
- The waiting lines (A8 queue) are sortable, and each has one action that fixes the cause.
- A count marks older waiting lines "covered by count" (R29).

### 2d. What was poured vs what was counted (owner, manager; desk). Technical page, dense.
- For each item between two counts, show four ml figures and one money figure:
  - opening count,
  - received,
  - theoretical out (sales × recipe + serves),
  - counted close,
  - the gap in ml and in money at that period's cost.
- Gaps sort by money. Every figure names its source.
- An item with sales that waited or were "covered by count" says how many, so the gap is never presented as clean when it is not.

### 2e. Settings: serves and pour. People page.
- Serve sizes per kind come from ADR 0115 step S (R25 "confirm the set first"). One server value, shown with who set it and when, replaces the browser-only default pour (G13).
- The dead "Enable recipes" and "Recipe yield unit" switches are removed (G15).

### 2f. Food (later, same engine)
- The same sheet, with g, kg and each, a trim/yield % per ingredient, and nested preps (a sauce inside a plate).
- Cost rolls up through preps, and a cycle is refused at save.

---

## 3. Phased build plan

Rules for every lane: at most 15 files and a 30K diff per PR. Open it as a DRAFT, because a CI PASS auto-merges (memory `ci-audit-gate-out-of-credit`). Migration versions are assigned at merge (memory `migrations-numbered-at-merge`). Each lane carries its CLAIMS row and a guard where one can check it.

"Fails on main" means the test is written first and shown red at `origin/main`.

### Phase A: server correctness on paths that run today (no dependency on #589)

| Lane | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| A1 | `fix/a-recipe-save-is-one-act` | G7, G9, G25 | migration `…_a_recipe_save_is_one_act.sql` (RPC `set_cocktail_recipe`: delete+insert in one transaction, tenant-checked); `supabase/tests/…_test.sql`; `beverages.service.ts` (`:665-722` → one rpc; `:307,:364` fetch limit+1); `beverages.service.spec.ts`; `beverages.controller.ts` (owner/manager on `:184,:194,:206,:230`); new `beverages.controller.roles.spec.ts`; claims row (~7) | (1) service: `setCocktailIngredients` makes exactly one `rpc('set_cocktail_recipe')` call and never calls `.delete()` (main calls `.delete()` at `:691`). (2) pgtest: an RPC call with a line breaking `has_a_referent` raises and the previous 3 lines are still there. (3) a staff token on POST/PATCH/DELETE/PUT gets 403 (main: 2xx, only `JwtAuthGuard` at `beverages.controller.ts:59`). (4) a list of exactly 300 rows returns `truncated: false` (main: true). | #650 edits `beverages.service.ts`: rebase after it. No logical conflict. |
| A1w | `fix/a-saved-recipe-shows-what-saved` | G8, G22 (client), G23, G26 | `useCellarNextData.ts` (`:1025-1026` add `['cellar','recipe',…]`); `CocktailRegister.tsx` (copy `:127,:131`; description field; emptied field sends `null`); `CellarRegisters.test.tsx` (`:316` pin changes); `CocktailRegister.test.tsx` (~4) | (1) after a successful save the `['cellar','recipe',rid,cid]` key is invalidated (main: not). (2) success copy contains no `cocktail_ingredients` (main `:127` does). (3) clearing garnish sends `garnish: null` (main omits the key, so it is never cleared). (4) the add form has a description field. | A1 (failure copy relies on the atomic RPC); #650 (`useCellarNextData.ts`) |
| A2 | `fix/a-void-gives-back-what-was-poured` | G11 (supersedes B19, ADR 0011 `:224`) | migration `…_a_void_gives_back_the_pour.sql` (RPC `return_glass_pour`: add `pours×pour_ml` to the open container. A container that reaches full size folds back to one sealed bottle. Anything above the cap is written as a named variance row, R49 shape. Key `${sale_key}:void`); pgtest; `pos-hub.service.ts` (`:1454-1484` volume voids call it); `pos-hub` void spec; `toast.service.ts` (`:651-660`); toast spec; ADR 0011 amendment; claims row (~8) | (1) pos-hub: voiding a 2-glass line of 150 ml calls `return_glass_pour(p_pours 2, p_pour_ml 150)` and never `apply_stock_movement(+2)` (main `:1480`). (2) Toast: same (main `:657` `p_delta: qty`). (3) pgtest: a fresh 750 ml bottle, sell 2×150, void them: live ml is 750 and sealed count is back where it started (main: +1 ghost bottle, 750 ml). (4) replaying the void moves nothing. | none. Cost-math's void-cost lane (cost-math G12) stacks on it. |
| A3 | `fix/toast-keeps-the-volume-contract` | G10, G20, G28 (Toast part); same defect as cost-math G13 | new `pos-hub/sale-volume.ts` (the ADR 0011 resolver lifted out of `pos-hub.service.ts:456-524`); its spec; `pos-hub.service.ts` (import); `toast.service.ts` (`:524-575` one mapping read per check; `:638` no default; `:672-676` pass pour ml and `p_occurred_at`); toast spec (~5) | (1) a Toast glass line whose mapping has no `sale_unit` queues and calls no stock RPC (main: `apply_stock_movement −1` bottle). (2) a Toast glass sale passes the mapping's `sale_volume_ml` and the check's close time (main `:675` null, no date). (3) a 40-line Toast check reads `pos_item_mappings` once (main: 40). | A2 (both edit Toast's void branch) |
| A4 | `fix/one-pour-size-for-the-house` | G13, G15, G17, G19 | migration redefining `record_glass_pour` with `COALESCE(p_pour_ml, ri.pour_size_ml, r.default_pour_ml, 150)` (now `20261222100000_…:319`); pgtest; a restaurant-settings route writing `default_pour_ml` (no writer exists: `git grep default_pour_ml apps/api-gateway/src` hits only reads in `inventory.service.ts`); its spec; `inventory.service.ts` (`:368-370` key required → 400); `inventory.dto.ts`; `volumeUtils.ts` (`:9` min → 10); `MeasurementSection.tsx` (server value; switches removed); `MeasurementSection.test.tsx`; `restaurantSettingsStore.ts` (keys removed); claims row (~11) | (1) pgtest: a house default of 125, an item with no pour and `p_pour_ml` null pours 125 ml (main: 150). (2) web: saving the default pour sends a request and writes no localStorage key (main: localStorage only). (3) "Enable recipes" is not rendered (main renders it, and nothing reads it). (4) POST pour without `idempotencyKey` → 400 (main: 201, random key). (5) `isValidPourSize(20)` is true (main: false). | none. Its 150 last resort is R7's interim; step S replaces the chain. |
| A5 | `fix/no-invented-glass-cost` | G16, G21 | `volumeUtils.ts` (delete dead `costPerGlass` `:86`); `volumeUtils.test.ts`; `wineData.ts` (delete `getDefaultMenuPrice` `:87`); `useInventoryPage.ts` (`:51-58,:316-326`: an unpriced wine sorts last); its test (~5) | (1) the margin sort puts a wine with no menu price last (main: sorts it on 3× cost). (2) the guard `git grep -n "cost \* 3\|costPerGlass" apps/web/src` is empty. | none |

**Contract only, built by cost-math (G12).** The ledger writes a glass-sale row only when a bottle opens (`20261222100000_…:388-396`), and `pos_item_sales` reads `-sum(quantity_change)` (`20270301170000_…:109`). The cost-math lane that stamps a sale's cost (cost-math G2) must therefore book every glass as `pour_ml / bottle_ml` of the drawn lot's cost. It must also give `pour_events` the check's date, since today it has only `created_at` (insert at `:403`).
- Test it must pass: five 150 ml glasses from one 750 ml bottle at ₺600, in two periods (one glass, then four), cost ₺120 and ₺480.
- Main gives ₺600 and ₺0.
- Recipes does not build this, to keep one owner for `pos_item_sales`.

### Phase B: the recipe engine, server

Phase B is gated on #589 merging (his word) and on ADR 0115 steps M1, M2, M3, D1, D2, F and S. B3's stock moves also need D3 and the per-house cocktail switch-on (X19).

| Lane | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| B0 | `docs/recipes-is-a-software` | G30 (doc) | `.planning/08-softwares/recipes.md` (SOFTWARE-CONTRACT §0-§9); ADR "a recipe is a versioned list of house items in base units" (§4 F1-F7, F15-F17); README row in its own PR (memory `readme-row-append-is-gate-released`); claims rows (~4) | CLAIMS rows: `git grep -n "recipe_lines" supabase/migrations` empty (status `open`, flips at B1). | none (docs) |
| B1 | `feat/recipe-tables` | G2 (model half), G5 (model), G6, G14 | migration: `recipe_units` (closed vocabulary; base `ml`/`g`/`each`; factor to tenths of a ml / mg) and `house_recipe_units` (house values for dash and barspoon); `recipes` (one per owner `(item_kind,item_id)`, `current_version_id`); `recipe_versions` (append-only: `yield_serves > 0`, method, glass, garnish, `dilution_pct` null, author, at); `recipe_lines` (`role` CHECK `stocked`/`untracked`; the item arc in D2's shape; `qty_entered`, `unit_code`, `qty_base bigint` set by trigger; CHECK `stocked ⇒ item`); RLS; move `cocktail_ingredients` rows (#589 measured 0, `0115:105` on the branch) skip-and-flag; pgtest (~4) | pgtest: "1.5 oz" stores `qty_base` 444 (tenths of a ml: 44.36 ml, half-up); "2 dash" uses the house's dash; a `stocked` line with no item is refused; a version row cannot be updated. All fail on main (no tables). | ADR 0115 M3 (tenths of a ml), D1, D2 |
| B2 | `feat/recipe-reads-and-cost` | G3 (cost half), G15 (server) | new gateway `recipes/` module (controller, service, dto, module, 2 specs); `beverages.service.ts` (`recipesAvailable` from data, not `false` at `:367`); `app.module.ts` (~8) | Cost-per-serve spec: a Negroni of 30 ml each of gin (700 ml at ₺700), Campari (1 L at ₺500) and vermouth (750 ml at ₺300) costs ₺57.00 a serve. With the vermouth unpriced it returns `priced 2 of 3` and no total. Staff get no cost fields. Fails on main (no route). | B1; cost-math's per-ml lot cost read (`inventory-cost.ts` `resolveUnitCost`) |
| B3 | `feat/a-sale-takes-its-recipe` | G1, G2 (sale half), G18 | migration: one set-based RPC `record_check_serves(p_restaurant, p_lines jsonb, p_key, p_occurred_at)`. It maps serve → item. A recipe explodes `lines × qty / yield_serves`; a single-ingredient serve draws its ml. Any `stocked` line unlinked or unsized makes the whole line wait (A8). It stamps `recipe_version_id` and voids through A2's reversal. A volume above one container draws across containers (R19), replacing the `pos-hub.service.ts:487` refusal. Also: pgtest; `pos-hub.service.ts` (one RPC per check; the `is_wine` skip `:1365` becomes "kind switched on"); spec; `toast.service.ts` via A3's resolver; spec (~7) | (1) a check with 2 Negronis makes one RPC and takes gin, Campari and vermouth 60 ml each. (2) voiding it returns the same. (3) a replay moves nothing. (4) an unlinked vermouth puts the line in `pos_unresolved_lines` and moves nothing. (5) a 1 L carafe from 750 ml bottles draws 1000 ml (main: refused at `:487`). | B1; ADR 0115 D3 and S; A2; A3 |
| B4 | `feat/house-prep-runs-record-only` | G14 (batch) | migration (`prep_runs`, `prep_run_inputs`); gateway endpoints in `recipes/`; specs (~6) | A run records inputs, yield, ingredient-only cost and use-by, and no `inventory_transactions` row appears (R60). Fails on main. | B1; ADR 0115 K (cocktail forms `batch`/`prep`) |
| B5 | `feat/the-menu-carries-cocktails` | G29 | `scan-parser.service.ts` (`:80` the class is kept); `menus.service.ts` (create the cocktail item, "recipe owed"); specs (~5) | A scanned menu with "Negroni 450" creates a house cocktail item priced 450 with no recipe lines (main: nothing written). | the ADR 0186 amendment (R53, owed per #589); #761/#762 (`menus.service.ts`); #656 |

### Phase C: screens

| Lane | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| C1 | `feat/the-recipe-sheet` | G5, G24, the §2a sheet | `pages/cellar/next/recipe/` (RecipeSheet, LineRow, ShelfPicker, `parseSpec.ts` + test, `useRecipe.ts`, test); `services/api/recipes.ts`; `CocktailRegister.tsx` (mount); `cellar-columns.ts` (`:650-662` RECIPE copy says what is true) (~10) | (1) `parseSpec("1½ oz gin")` gives 1.5 oz gin. (2) `"2 egg whites"` gives 2 each "egg white" (main regex `:113` gives unit "egg"). (3) choosing an item from the picker sends `item_kind`/`item_id` (main sends none). (4) an incomplete cost shows "2 of 3 ingredients priced" and no total. | B2; #650 (`cellar-columns.ts`) |
| C2 | `fix/cocktails-loads-only-cocktails` | G27 | `CellarNext.tsx` (`:85`); `useCellarNextData.ts` (`:1307` split); `CatalogueRegister.tsx` (`:300-307`); test (~4) | Rendering `/cocktails` makes no wine-book request (fetch-mock count; main fetches the 500-row wine pages). | A1w; #650 |
| C3 | `feat/till-to-recipe-desk` | §2c | page, hook, API client, tests (~6) | A waiting line shows its cause and its one fixing action. | B3 |
| C4 | `feat/poured-vs-counted` | G30 | migration (view `recipe_theoretical_usage(restaurant, from, to)`); gateway reader; page; tests (~8) | Two counts 700 ml apart, with 450 ml theoretical out, show a 250 ml gap and its money. Fails on main (no view). | B3; ADR 0115 D3 count RPC; the phone-count lanes (memory 2026-10-12) |
| C5 | `feat/food-recipes` | G4 | same engine: `g`/`each`, `trim_pct` on a line, nested preps with a cycle refusal, plate cost; sheet variant (~10) | A plate whose sauce prep is itself a recipe costs the sum through the prep. A prep that includes itself is refused. | ADR 0115's food design (OD-219 asks for it, "attacked, before any K-PR merges"); B1-B2 |

Lane count: **17**. Phase A has 6 lanes, Phase B has 6 and Phase C has 5. The cost-math contract lane is not counted.

---

## 4. Forks: the session's calls

Each fork gives the call, the rejected alternatives and why, one honest attempt to kill the call, and whether the call survived.

**F1. What the recipe engine stands on.**
- **Call:** ADR 0115 as locked on #589. Recipe tables key on the house item `(item_kind, item_id)` in D2's arc shape and never on a table name, so they work whether a cocktail lives in `cocktails` or a generated `cocktail_items`.
- **Rejected:**
  - A recipe-local stock book for non-wine goods. It is a second ledger that ADR 0115 H4 already rejected for per-register stock tables.
  - Pointing at `restaurant_inventory` now. The "separate table per kind" ruling (#589 group 1) makes non-wine rows there "misfiled", for D7 to move.
- **Kill attempt:** #589 has waited a month, and M1-S is about eight migrations. Cocktail cost per serve stays empty that whole time.
- **Survived, with a named cost.** Phase A ships now and needs nothing. B1 and B2 need only M3, D1, D2, F and S, not D3-D8. Spirits still have no lot cost until the house can receive them, which is 0115's job either way, so building aside would only add a merge later.

**F2. What an ingredient line points at.**
- **Call:** a stocked house item for `stocked` lines. A line marked `untracked` (garnish, ice, water, "food not set up yet" per R66) carries text and never depletes or costs.
- **Rejected:**
  - Catalogue identities (today's `beverage_id`/`wine_id`, `cocktails.sql:60-72`), because they have no lot.
  - Free text, which is G5.
- **Kill attempt:** "lime juice" is food, and food has no items yet, so every sour is incomplete.
- **Survived.** R64 makes house juice a prep and R66 gives food a typed placeholder. The sheet says exactly which line blocks stock.

**F3. Units.**
- **Call:** a closed vocabulary. The line keeps what was typed (`1.5 oz`) and stores an integer base: tenths of a ml (R81), mg or each. Fixed factors: cl 10 ml, oz 29.5735 ml (US fluid ounce, labelled "US oz"), tsp 5 ml, tbsp 15 ml. House-editable values with a Mudavym starting value: dash 1 ml, barspoon 5 ml. Rounding is half-up to a tenth of a ml.
- **Rejected:**
  - Free text (G6).
  - ml-only entry, because bartenders write oz and dashes.
  - The imperial oz, because TR and EU bars use cl and ml, and US specs dominate published recipes.
- **Kill attempt:** a dash varies with the bottle (an Angostura dash is not a Peychaud's dash).
- **Survived.** The house can change it, and dashes are a rounding error in cost. Variance shows the effect if it matters.

**F4. Editing history.**
- **Call:** append-only versions, with a current pointer. A sale stamps its `recipe_version_id`.
- **Rejected:** editing in place, which rewrites the past for COGS and variance.
- **Kill attempt:** overkill for 55 cocktails and 0 lines (#589 `0115:105`).
- **Survived.** It costs one table. Without it, the first spec change silently re-prices last month's variance.

**F5. Where a recipe attaches, and how serves use it.**
- **Call:** a recipe belongs to the item (cocktail, prep, later dish) and yields N serves. A serve (ADR 0115 R9) points at the item, and a multiplier comes from the serve or its modifier (R46). A single-ingredient serve (a glass of wine, a 50 ml rakı, a pint from the keg) never needs a recipe; it draws its own ml (X2).
- **Rejected:**
  - A recipe per serve, which duplicates the spec for single and double.
  - A recipe for every drink, which is busywork for a glass of wine.
- **Kill attempt:** a "double Negroni" is not 2× everything for some bars.
- **Survived.** That bar makes it its own item; R67 already says a form that differs is a new item.

**F6. A sale whose recipe is incomplete.**
- **Call:** the whole line waits and takes nothing (A8, "Queue it, take nothing").
- **Rejected:** depleting the linked lines and skipping the rest. That books a Negroni as gin and Campari only, and variance blames the vermouth on theft.
- **Kill attempt:** every cocktail queues until fully linked, and the queue drowns.
- **Survived.** `untracked` keeps garnish out of it, the sheet warns before the first sale, and X19 switches cocktails on per house only when the house says so.

**F7. Which cost the sheet shows.**
- **Call:** today's lot WAC per ml of each linked item, computed on read. There is no job recomputing on invoice arrival, because a read is always current. COGS uses the lots actually drawn, which is cost-math's stamp.
- **Rejected:**
  - FIFO on the sheet, because the next pour's lot is not known before it happens.
  - Last invoice price, because one delivery would swing the number.
  - A typed cost per line as a stopgap, which is a second cost truth that ADR 0298's readers would have to reconcile.
- **Kill attempt:** the sheet and the report show two numbers for one drink.
- **Survived.** They are labelled "a serve at today's prices" and "cost of what sold", and they differ for a real reason.

**F8. The pour-cost percentage.**
- **Leading call:** divide by the menu price, labelled "incl. KDV" when the house's tax basis is unknown.
- **Kill attempt:** in Turkey the menu price includes 20% KDV, so the shown % is too low by a sixth. Owners compare it with the 18-24% rule of thumb (`sota.md` 7), which assumes a price before tax.
- **Did not survive. Revised call:** show the % only against the price before tax, once the house's tax basis is set (founder 2026-10-12: per-house basis). Until then show cost and price only, with "set your tax basis to see pour cost".
- **Rejected:** labelled gross % (it misleads, as above) and assuming 20% (ADR 0020).

**F9. Superseding B19 now, ahead of ADR 0115 D3.**
- **Call:** yes, in A2. The volume goes back to the open container, capped, with a named excess. The founder already picked "Kegs; voids return volume" (#589 group 5), and the /goal covers the rest.
- **Rejected:**
  - Waiting for D3, while every glass void inflates stock in production.
  - Sending voids to review, which is the founder's rejected option.
- **Kill attempt:** D3 changes "to the open container" into "to the sale's lot" (R49), so the work is done twice.
- **Survived.** D3 replaces one RPC body. Callers and tests stay.

**F10. The Toast door.**
- **Call:** Toast uses pos-hub's ADR 0011 resolver (A3), one contract for both doors.
- **Rejected:** patching Toast's default to "glass", which is the same guess pointing the other way.
- **Kill attempt:** Toast mappings may lack `sale_volume_ml`, so lines will queue after the change.
- **Survived.** Queueing an unknown is A8 and ADR 0011's rule. Today the same lines silently take a bottle.

**F11. The default pour chain.**
- **Call:** item pour, then the house default, then 150 ml, for wine only, until step S.
- **Rejected:** queueing every glass with no stated pour. That is the A8 purist reading, but R7 sanctions the 750/150 interim for wine until a production count.
- **Kill attempt:** keeping a guess at all contradicts F6.
- **Survived.** F6 governs recipes, which have no interim ruling. Wine has one, and S removes it.

**F12. The smallest pour.**
- **Call:** 10 ml, enforced on the server as well as in the browser.
- **Rejected:**
  - 30 ml (G17), which blocks 20-25 ml spirit measures.
  - No minimum, which lets a typo of 1 ml through.
- **Kill attempt:** a 5 ml tasting.
- **Survived.** A tasting is a serve, not a default pour.

**F13. Who writes recipes and prices.**
- **Call:** owner or manager. Staff read without money fields.
- **Rejected:** any signed-in staff, which is today (G9).
- **Kill attempt:** a head bartender who is not a manager cannot fix a spec.
- **Survived for now.** A "menu and recipes" right under ADR 0253's jobs and rights is the clean later answer, and is noted in B0.

**F14. The browser-only "Enable recipes" switch.**
- **Call:** delete it (A4). A recipe takes stock when the house switches the cocktail kind on (X19), on the server.
- **Rejected:** wiring the switch, which leaves one browser's setting deciding a whole house's stock.
- **Kill attempt:** none found.
- **Survived.**

**F15. Where the screens live.**
- **Call:** one engine, and the sheet lives on the item: drinks in the cellar's Cocktails register, preps under "House prep", dishes on the menu side later. No `/recipes` route now.
- **Rejected:** a separate Recipes page like Backbar or WISK.
- **Kill attempt:** owners look for "Recipes" in the navigation.
- **Partly survived.** Revisit when food lands. C3 and C4 give the technical desks their own pages.

**F16. Dilution.**
- **Call:** a display-only `dilution_pct` on a built drink, used for the glass volume shown and never for cost. A batch states its water as an `untracked` line.
- **Rejected:** a Mudavym default by method. `sota.md` 4 found no source, and ADR 0020 forbids inventing one.
- **Kill attempt:** without dilution the served volume is wrong for glass fit.
- **Survived.** The house types it once per drink.

**F17. Paste a spec.**
- **Call:** keep it as a convenience. It parses into rows that must be confirmed.
- **Rejected:**
  - A textarea as the editor, which is G5.
  - A picker only, which is slow for entering 55 drinks.
- **Kill attempt:** parser misreads get confirmed blindly.
- **Survived.** An unlinked `stocked` row stays visibly `--warn`, and nothing depletes until it is linked.

**F18. Who owns the ml-proportional cost fix (G12).**
- **Call:** cost-math, through the contract in §3.
- **Rejected:** recipes fixing `pos_item_sales`, which would put two owners on one function.
- **Kill attempt:** cost-math's queue is long.
- **Survived.** The latent error has no reader yet (`pos_item_sales` has no consumer, per the audit grep), so ordering, not ownership, is the risk.

---

## 5. Integration contract with neighbouring softwares

| Neighbour | It gives recipes | Recipes gives it | Never |
|---|---|---|---|
| House items / inventory-command (ADR 0115) | `(item_kind, item_id)`, format ml (F), unit freeze (D6), kind switch-on (X19) | "used in N recipes" per item, for the inventory "used-in" ask (QUEUE #7) | Recipes never creates or edits an item |
| Stock ledger (ADR 0115 D3; ADR 0285) | one draw RPC that takes ml and is lot-aware, and A2's reversal | per-ingredient ml with an idempotency key `${check_key}:${line}:${ingredient}` | No direct writes to `inventory_lots` |
| POS bridge: pos-hub, Toast, Floor Checker (#757, ADRs 0345-0353) | `(check, line, serve, qty, occurred_at, is_void)` through one resolver (A3) | one `record_check_serves` call per check, with the waiting lines and their cause | No per-line RPC loops; no door with its own unit rules |
| Serves and prices (ADR 0115 S; menus) | serve ml and price per (item, serve ml) | the serve's cost at today's prices | Recipes never stores a price |
| cost-math | lot WAC per ml (`resolveUnitCost`), tax basis, the drawn-lot cost stamp | `recipe_version_id` and the exploded ml per sale line | Recipes does not compute COGS |
| Menu upload (ADR 0186 amendment) | a cocktail item, "recipe owed" | nothing | The scan never writes recipe lines |
| Counts (phone count, 2026-10-12) | counted ml per item per period | theoretical out per item per period (C4) | No variance from an uncounted period |
| Reports-analytics (ADR 0297, 0298) | none | consumption rows in mode `recipe` with ml, so demand counts each line by its own mode | No bottle-equivalent made from a cocktail count |
| Notifications / recommendations | none | "over its pour-cost target" (R82), only when the tax basis is set | No figure with a confidence number (ADR 0104) |

---

## 6. What stays unverified

- **Production was not queried.**
  - Main's ADR 0115 says its migration is "NOT applied" (`0115:3`). #589 says phase 1 was applied with PR #289 on 2026-09-12.
  - `cocktail_ingredients` = 0 rows is #589's measurement, not re-measured.
- **No tests were run.** Every "fails on main" above is a prediction from reading code, and each lane must show it red first.
- **G9:** the body of the global `TenantGuard` (`app.module.ts:183-189`) was not read, so whether a staff member of house A can write house B is unknown. The verdict narrowed the claim to "no role gate".
- **G27:** whether the cellar shell's loads block the cocktail list was not traced. C2's test measures requests, not blocking.
- **G18:** whether today's `record_glass_pour` can draw one pour larger than a container was not tested. B3 assumes R19's multi-lot draw.
- **A4:** the restaurant-settings route that will write `default_pour_ml` was not located. `git grep` finds no writer of `default_pour_ml` or `measurement_unit` in `apps/api-gateway/src`. No mobile caller of manual pour was found, so requiring the key breaks only callers outside the repo, if any exist.
- **A5:** whether any server path turns `glassesPerBottle` (`inventory.service.ts:91`, floor) into money was not traced.
- **Line drift:** citations into files that #650, #761 and #762 touch will shift when those merge.
- **Conversions:** the oz/dash/barspoon factors are conventions, not measurements.
- **SOTA:** the vendor behaviour in `sota.md` is marketing copy, not observed behaviour.
- **#589 readings:** the 0115 rulings cited here (R9, R25, R46, R49, R60-R82, X2, X19, A8) were read on the unmerged branch. They bind only when #589 merges, by his word.
- **Retire-to-write:** B0 adds `.planning/08-softwares/recipes.md`. The /goal waives the binding, and no retirement candidate was found by grep.
