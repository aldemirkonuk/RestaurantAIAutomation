# R1 - Code state: inventory exports, goods model, dishes/recipes, nutrition, taste

Researcher R1, 2026-11-19. Read-only: origin/main (fetched today) plus `gh pr` data for 1,246 open PRs.
Nothing was built, committed or queried in production. `main:` = origin/main. "Open" = draft PR on
aldemirkonuk/RestaurantAIAutomation. Open PR graph is a tree stacked up to 40+ deep (see section 6).

## 0. Headline

1. The export is wine-shaped in three independent layers: the columns (producer, vintage, bottle size, bottle
   price), the data (the web list is built from the wine-library join), and the model (nothing exists for a taste
   profile of anything except wine).
2. On main there is NO nutrition, allergen, dish, recipe or recipe-line table. All of it lives in open PRs.
   Main has only `cocktails` + `cocktail_ingredients` (empty by design) for recipes.
3. A taste profile exists today only for wine (`master_wine_library.wine_structure` / `sensory_profile`
   jsonb + generated columns) and, as empty-capable columns, for the `beverages` table (body, acidity,
   serving_temp, glass_type, type_attributes). No dish or food has any taste field anywhere.
4. The Flavor Lab is a study of whether a guest's liking can be predicted. It produces a method and measured
   property axes for 4 public datasets, not a product taste vocabulary. It can inform schema shape
   (named measured axes, never fabricated), not data.

## 1. The count sheet and every inventory export

### 1a. Which page makes the file
- Route picks the page by a house flag: `InventoryRoute.tsx:28` -> `InventoryNext` when
  `mudavym_design_inventory_next` is on, else `InventoryCommandPage` (legacy).
- Founder's header list (Location, Wine, Producer, Vintage, Type, Bottle size (ml), System qty live/shadow,
  Par, Counted qty, Variance, Last counted) matches NEITHER builder on main exactly:
  - Legacy `InventoryCommandPage.tsx:605-660` `countSheetColumns`: "Wine", "Bottle size" (no ml), no "Last counted".
  - Next `InventoryNext.tsx:518-555` `exportCountSheet`: "Title", "Bottle size (ml)", "Last counted".
  - `git log -S"header: 'Wine'"` finds no "Wine" header in Next ever (introduced as "Title" in #677, 3bbec7bfa).
  - So the founder's file is either a hand-paraphrase or a stale deploy. Unresolved; flag for the verifier.
    Either way the cause of "wine-only" is the same (below).

### 1b. Every export surface on main (grep exportTable/runExport)
| Surface | file:line | Columns |
|---|---|---|
| Legacy count sheet | InventoryCommandPage.tsx:605 (button :753) | wine-shaped, 18 cols |
| Legacy valuation / selected / all-locations | InventoryCommandPage.tsx:569, :693, :702, :1877 | "Wine", Producer, Type, Live, Shadow, Par, WAC, Your bottle/glass price, Market, Value |
| Next count sheet | InventoryNext.tsx:518 | Location, Title, Producer, Vintage, Type, Bottle size (ml), System qty live/shadow, Par, Counted, Variance, Days since, Last counted, Velocity, Runway, WAC, Value, Observation |
| Next valuation, selection | iv-export.ts:51 `valuationColumns`; InventoryNext.tsx:556-558, :863 | Title, Producer, Type, Live, Shadow, Par, Velocity, Runway, WAC, Your bottle price, Your glass price, Value at cost, Currency |
| Next "Export this row" | RowDropdown.tsx:391 | same as valuation |
| Team overlay | TeamOverlays.tsx:927 | unrelated |
Shared writer: `lib/tableExport.ts` (csv, xlsx, clipboard, print). There is NO export on /cellar, /dishes,
/cocktails, /menu, /receipts, /recipes, or any taste/nutrition view. The only exports in the product are the three
inventory ones above.

### 1c. Why a house's file comes out wine-only (three layers)
1. Columns: Producer, Vintage, Bottle size (ml), Your bottle price, Your glass price are drink-only by meaning.
   No column says Kind, Category, Unit, Vendor, Pack, Allergens, Nutrition or anything about taste.
2. Row data: `toRow` (useInventoryNextData.ts:203) reads producer, vintage, type, grape, bottleSizeMl from the
   wine-library row (`w?.producer`, `w?.vintage`, `typeOf(w?.category, w?.beverageKind)` at :229-233). A carried
   food has no library row so those are null -> blank cells. `typeOf` (:176) returns null for no library row.
   `InvRow` (:72-120) has no `kind` of the ledger (its `kind` is the library's beverage_kind), no `uom`, no
   `displayName`, no allergens, no nutrition, no taste.
3. Gateway: list is `restaurant_inventory` + `master_wine_library (*)` only (`inventory.service.ts:324,415,597`,
   `mapInventoryItem` :81-135: `bottleSizeMl` defaults to the library or 750 at :87-90 - a food gets a 750-ml
   bottle). Nothing joins `beverages` (spirits/beer/sake by `beverage_id`) into the inventory list.
   The ledger already carries what is needed: `restaurant_inventory.kind` (wine, beer, whiskey, spirit, liqueur,
   cocktail, sake, cider, non_alcoholic, soft_drink, food, supply, other), `uom`, `display_name`,
   `identity_provenance`, `beverage_id` (migration 20260903171000_the_house_item_is_the_ledgers_key.sql:~349,
   `house_items` view :497). `select *` already sends them; the web throws them away.

### 1d. Open PRs that touch the exports - what each fixes, what stays wine-only
| PR | Base | What it fixes | Leaves |
|---|---|---|---|
| #1744 (3 files) | #1738 | Name column head "Good" in a food house (count sheet + valuation) | all drink columns stay, blank |
| #1765 | #1744 | Same for "Export this row" | same |
| #1792 (4 files) | #1765 | `forHouse()` + `DRINK_ONLY_HEADERS` (iv-export.ts): a house whose every row is a good drops Producer, Vintage, Bottle size (ml), Your bottle/glass price from count sheet, valuation, row export. A house with one drink keeps them all | Mixed house still gets wine columns, blank for foods; no Kind/Unit/Category column; no taste; no allergens/nutrition |
| #1743 (2 files) | #1738 | "this good" for a nameless good on count/write-off/move sheets (sheets, not export) | - |
| #1754 (2 files) | #1743 | A count the house took ticks the setup's count step | not an export |
| #1022 (5 files) | #1021 | Count/write-off/order SHEETS take the good's uom (kg, l; decimal input for weighed goods). Sheets only | export untouched |
| #1373 (8 files) | #1356 | Count sheet, valuation, selection and row export gain a **Unit** column; weighed goods written in kg/l, WAC per kg/l, Bottle size blank for g/ml/each; list headers renamed. Own call: converts to counting unit | Base is a DIFFERENT branch than #1792's (via #934/#900, not #1022). Both edit `exportCountSheet` + `valuationColumns` -> will conflict. Neither contains the other |
| #1582 (5 files) | #1571 | "Count many titles under one seal" sheet (blind counts, one HoldToApprove). Entry, not export | not an export |
| #1888 (10 files) | #1880 | Phone: one Filter button, staff count mode (Count bar). UI | not an export |
| #1912 | #1888 | A good's quantity says its unit on list/phone card | list only |
| #1693 | fix/inventory-staff-do-not-write-cost | Gateway: a non-wine good falls back to the house's declared name | name only |
| #1233 | #1221 | List Type reads the ledger `kind` for a house-added spirit/soft drink (was "not recorded") | list only; export `Type` uses same `typeOf`? verify |
| #1150, #1646 | - | Carry a good in kg/l; paste-list carry of many goods (entry) | - |

AFTER ALL OF THEM (merge #1373 into #1792's stack): a food house's count sheet = Location, Good, Type
(blank/"kind" only where #1233 reached), Unit, qty live/shadow/par in kg/l, Counted, Variance, Days since, Last
counted, Velocity, Runway, WAC per kg/l, Value, Observation. STILL ABSENT for every kind: Kind/Category, Vendor
(InvRow has providerName, no column), pack size, allergens, nutrition, any taste/flavor field, cost per recipe
unit. A mixed house still carries the wine columns (blank for foods). Spirits/beer: Producer, Vintage kept
from library only if library-matched; ABV, age, expression, cask finish (all on `beverages`) never exported.
No export exists at all for dishes, cocktails, recipes, menu.

## 2. Goods data model by kind

| Kind | Where it lives on main | Detail fields |
|---|---|---|
| Wine | `master_wine_library` (3,497 live rows, 20260818030000:~29) + `restaurant_inventory.master_wine_id`; `wine_*` side tables (baseline :6348-6500) | name, producer, vintage, grape, region, country, bottle_size_ml, tasting_notes, `wine_structure` jsonb {body, sweetness, acidity, tannins, alcohol_level, texture, finish, alcohol_pct}, `sensory_profile` jsonb {primary/secondary/tertiary_aromas}; generated cols acidity, tannins, texture, finish, *_aromas |
| Spirits, beer, sake, cider, liqueur | `public.beverages` (20260817070000:217), linked by `restaurant_inventory.beverage_id` (kind CHECK `restaurant_inventory_one_catalogue_check`: a row is wine OR beverage) | beverage_type, producer, brand, abv_pct, volume_ml, package_format, barcode/sku/upc/ean, **body, acidity, serving_temp_celsius, glass_type**, age_years, cask_finish, expression, proof, `type_attributes` jsonb, data_enrichment jsonb, embedding vector(384). Population: "left NULL at migration" (:~260) |
| Cocktails (a drink the house makes) | `cocktails` + `cocktail_ingredients` (20260817090000:26,60) | name, display_name, menu_section, method, glass, garnish, price, description, data_enrichment jsonb; ingredients empty "by design" |
| Foods, supplies, house-declared drinks | `restaurant_inventory` rows with `kind` in (food, supply, soft_drink, other...), `uom`, `display_name`, `identity_provenance='house_declared'`; created by gateway POST `/inventory/:rid/house-items` (#862, OPEN, not on main) | name, kind, uom (bottle, case, keg, pack, each, glass, shot, ml, l, mg, g, kg), threshold. Ledger holds integer base units (ADR 0070): flour = 12,400 g |
| Menu lines | `menu_items` (baseline :3783) wine-shaped: producer, vintage, grape_variety, wine_library_id, inventory_item_id, by_glass_price, bottle_price | no taste; `restaurant_menus` + versions (open PRs) |
| POS | `pos_item_mappings` (baseline :4216) one button -> one `inventory_id`; #1421 adds `cocktail_id` | - |

Web types: `InvRow` (useInventoryNextData.ts:72), `ApiItem/ApiWine` (services/api/types.ts), legacy
`InventoryItem` (useInventoryPage.ts). Gateway: inventory/ (service :81 mapInventoryItem), beverages/ (list
beverages :244, cocktails :324, ledger :388, registers :431), cellar/cellar-registers.ts (seven registers
from beverage_kind / beverage_type), wines/wines.service.ts (:81 tasting_notes, :137 wine_structure,
:194 tastingNotes, :240-248 structure to API).

On main the web /inventory list for a spirit or beer reads only through the wine library's coarse
`beverage_kind` (`typeOf`, :176-185); the `beverages` table's body/acidity/serve temp never reach inventory.

## 3. Dishes / recipes / menu / POS (ALL open-PR; none on main except cocktails)

Dependency order (bases in the open graph):
- #863 `recipe_versions`, `recipe_lines`, `recipe_current` (append-only; owner_kind cocktail; lines have role
  stocked|untracked, inventory_id, qty_entered, unit_code, qty_base in ml10/mg/each_milli) -> #864 cost a serve
  -> #867 gateway read/version/save -> #887-#892, #937 cellar recipe sheet (5-part) -> #1012-#1030 sheet states,
  versions, edit -> #1139-#1141 alcohol + nutrition card on drinks -> #1165/#1166 cost preview
  -> #1186/#1191 house money.
- #1222 `dishes` table + `recipe_versions.dish_id` + `recipe_current_dish` + `recipe_insert_lines` (migration
  20270803100000, ADR 0366: "a plate the house makes and sells"; dishes has name, menu_section, price, description
  ONLY) -> #1223 gateway read/save dish recipe -> #1224 dish list with cost a plate -> #1225 "which dishes use a
  good", pasted-line matching -> (about 70 more) -> #1503/#1504/#1512 dishes take the menu's price -> #1579/#1583/
  #1598/#1621 menu's dishes come onto the list -> #1907 (`integ/g1-menu-take-prices-base`) takes menu prices onto
  many dishes -> #1915 (tip).
- Cost refinements: #1458 `a_good_says_what_one_weighs` (piece_grams/ml_grams stated weights) -> #1463 nutrition
  counts through a stated weight -> #1525 line "usable" yield; #1536/#1537 sold-out good keeps last cost;
  #1913 pour/food cost and margin follow the tax basis (tip, base #1589).
- Draw/POS: #1421 (till button names a drink recipe, `pos_item_mappings.cocktail_id`) -> #1478/#1480/#1483 draw,
  remainder, void -> #1540 -> #1796/#1811/#1815/#1820 -> #1908/#1909 Toast sale draws recipe -> **#1914**
  (`POST /pos-hub/mappings/:rid/till-recipe`, `GET /pos-hub/checks/...`; web TillRecipeMap, CheckMarginSection,
  PosMappingPanel). #1914 states: "Dish -> button link not done: dishes and recipes live only in the #1907 stack."
  A dish sale has no draw writer.
- Allergens on lists: #1609/#1613/#1626/#1657/#1658 (recipe lists carry allergens; "check one").

Missing (gap, no PR): a dish/cocktail EXPORT; dish -> POS draw; a dish's taste/flavor description.

## 4. Nutrition card chain (ALL open PRs, none on main)

| PR | What | Base |
|---|---|---|
| #922 | Schema `item_nutrition` (per 100 g or 100 ml; energy, fat, saturates, carbohydrate, sugars, protein, salt, abv_pct; source house/pack_label/open_food_facts/usda_fdc; stated_by) + `item_allergens` (14 EU allergens, contains/may_contain/free). Migration 20270512091500 | main |
| #923, #924, #926, #927 | Macro rules, read/state endpoints, label-lookup draft, Open Food Facts lookup | #922 |
| #1013 | Gateway holds the macro rules (refuse >100 g sum per 100 g; warn on kcal 4/4/9 mismatch) | #927 |
| #938 | Web: state what is in a good (form) | #900 |
| #939 | NutritionCard in drawer's NutritionCard slot | #938 |
| #940 | `sumRecipe` pure: sum a dish or cocktail from its lines | #939 |
| #1002 | Macro checks in form, `RecipeNutrition` mounted on cocktail recipe, draft with no notes | #940 |
| #1495 | Card says saturates ("of which saturates / sugars") | #1002 |
| #1140/#1141 | Drink's nutrition card: allergens first, pure alcohol (0.789 g/ml), opened drink shows cards then nutrition | recipe chain |
| #1463 | `serveNutrition` counts through stated weights | #1458 |
| #1638 | env: name the USDA FoodData Central key | - |
Gaps: no nutrition on dishes through the nutrition card (`sumRecipe` only wired to cocktail recipe; #1829 says a
dish's unread what-is-in sentence says plate); nutrition and allergens never reach any export; no per-serve
nutrition for a dish in a list; USDA key named but lookup source for foods in non-US is Open Food Facts only.

## 5. Taste / flavor / tasting-note fields anywhere

| Where | Shape | Coverage |
|---|---|---|
| `master_wine_library.tasting_notes` (text), `.wine_structure` {body, sweetness, acidity, tannins, alcohol_level, texture, finish, alcohol_pct}, `.sensory_profile` {primary/secondary/tertiary_aromas} | baseline :3484-3485; generated cols 20260818030000; backfill 20260817110000 | wine only; the one real taste model |
| `apps/web/src/data/wineops_basic_v1.json` (1,800 sensory hits) and `wineData.ts:34-38, 107-114, 204-225` (body, sweetness, aromas) | static dataset / UI mapper; `body \|\| "medium"`, `sweetness \|\| "dry"` DEFAULTS at :222-223 invent values | wine demo data |
| `apps/web/src/pages/cellar/next/cellar-format.ts:104, 193-202` `composedTastingSentence` (only when body+acidity+sweetness all present; labels reasoned-from-grape notes as "typical profile, not a tasting"); `BottleLeaf.tsx:64` Tasting block | UI for wine | honest-unknown pattern to reuse |
| `beverages` body, acidity, serving_temp_celsius, glass_type, type_attributes jsonb | schema only; unpopulated | spirits/beer/sake/cider |
| `cocktails.data_enrichment`, `description` | schema only; unpopulated | cocktails |
| `services/agent-orchestrator`: sommelier_agent.py (:8, :30, :72 `food_wine_pairings` dict), wine_prompts.py, haiku_enrichment_service.py, wine_field_parser.py, dataset_ingestion_service.py, `master_wine_library_seed.json` | python agents that FILL wine sensory jsonb | wine; pairing table hardcoded |
| Dishes / foods / supplies | NONE. `dishes` has name, menu_section, price, description; `item_nutrition` is macros, not flavor | zero |
| Guests' liking | NONE stored; `recommendation_impressions` (20260817000000) logs what was shown, not what was liked | zero |

## 6. Flavor Lab - what could feed a product taste profile

Branch `claude/flavor-lab-prediction-coverage-4197c8` (LOCAL ONLY, not on origin; head 5f335a96d, 2026-11-13,
checked out in a worktree; ADR 0363 + 0365 claims file inside). Path `research/flavor-lab/` (~2 MB):
`liking-study/` (FINDINGS.md 31 KB, REVIEW.md, INDEX-REGISTER.md 69 KB, `likinglab/*.py`, `results/*.json`,
`data/MANIFEST.json` of 13 public datasets, `evidence/F1-F7 + A1-A3`) and `next/` (KIT-PILOT-PLAN,
MECHANISM-RESEARCH-DESIGN, TASTING-PROTOCOL, DATA-REQUESTS).

What it is: a measured answer to "can we predict a guest's liking before tasting". Findings that matter here:
- Crowd favourite per item is the base everywhere (53-76% pair accuracy); personal prediction adds value only
  where a list splits (4 coffees: 0.559 -> 0.680) and median lift is +0.000 elsewhere (FINDINGS.md section 2).
- Hard ceiling: 42-69% of score differences between two tastings of one product are noise.
- Section 7 "Pathway" (FINDINGS.md:221-246): 1 crowd score per item after serving, 2 test per list before
  personalising, 3 one question per split, 4 keep each guest's scores, 5 offer a taster, 6 remember what the
  guest had. Not worth building: demographics, personality quizzes, price/medal promises, chemistry-only.
- Section 13 / `mechanism.py` (:1-40): named measured axes per product (apple sweet/acid/crisp/juicy; chocolate
  cocoa/crunchy; cocktail sweet/bitter/strong/thick/pulp; coffee strength/roast). One trait is stable across
  halves (apple acidity 0.456); the rest fail. Named properties predict as well as anonymous components
  (+0.016 to +0.033 lift) but "not shown to hold for other items".
What can feed a product taste profile: (a) the SHAPE - a small set of named, measured, per-category axes with an
explicit "unknown", never a 0 or a default; (b) item-features-as-stand-in for a new item with no scores
(FINDINGS.md:235); (c) crowd score per item as the one measured signal, which needs a guest-rating write path
that does not exist; (d) the pre-registered protocol (TASTING-PROTOCOL.md). What it CANNOT supply: a taste
vocabulary or values for dishes, spirits or beer. The study's datasets are coffee, wine, beer, spirits, canned
cocktail, juice, tea, chocolate, crisps, guacamole, apple, bread, ham, cuisines, candy; the axes are properties
measured by panels. Nothing in it is a table of dish flavor data; nothing in it is wired to any product.

## 7. Gap list (ordered by founder visibility)

G1. Export has no Kind, Category, Unit (only #1373), Vendor, Pack, Allergens, Nutrition, Taste columns for any kind.
G2. Mixed houses still get blank Producer/Vintage/Bottle size columns for foods (#1792 only drops them when every row is a good).
G3. #1373 (Unit/kg conversion in exports) and #1792 (drop drink-only columns) are parallel branches off #900/#1022 and will conflict in `exportCountSheet` + `valuationColumns`. No integration PR exists.
G4. Legacy `InventoryCommandPage` count sheet (flag-off houses) still says "Wine"; no open PR touches it (grep of PR file lists).
G5. Gateway list joins only `master_wine_library`; `beverages` (spirits, beer) never joins; `bottleSizeMl` defaults to 750 for any row (inventory.service.ts:87).
G6. Web `InvRow` discards ledger `kind`, `uom`, `display_name`; only #1233 (and goodOf/uomOf in the stack) read them.
G7. Nutrition and allergens exist only as open PRs; nothing exports them; dishes do not show the nutrition card.
G8. No taste model for dishes, foods, spirits, beer, sake, cider, cocktails; `beverages.body/acidity/serving_temp/glass_type/type_attributes` and `cocktails.data_enrichment` are empty. Wine-only taste model has invented defaults in `wineData.ts:222-223`.
G9. No export for dishes, cocktails, recipes, menu, nutrition, allergens.
G10. Dish -> POS draw and dish -> till button absent (#1914 states it).
G11. No guest-rating write path; `recommendation_impressions` logs shown, not liked.
G12. `menu_items` is wine-shaped (producer, vintage, grape_variety, bottle/glass price); a dish line has nowhere for taste or allergen.
G13. Flavor Lab branch is not pushed; its code fixes "not yet made" (FINDINGS.md section 10).
G14. Low-stock view does not include foods (per #934 body: BUG 3 server view still open).

## 8. Dependency chain - what a new build must stack on

Open graph facts: 1,246 open PRs, trees up to 52 descendants. Migration high-water over main + every open
PR is **20271202100000** (#1917); main's own latest is 20270302100000. A new migration must be past
20271202100000 (re-check at build time).

Chains (bottom to top):
- INVENTORY LIST + EXPORT (needed for any export/columns work):
  main <- #860 <- #861 <- #862 (house-items POST) <- #896 <- #898 <- #899 <- #900 (carry food + kind filter)
  <- #938/#939/#940 <- #1002 <- #1008 <- #1021 <- #1022 <- ... <- #1515 <- #1571 <- #1588 <- #1685 <- #1717 <-
  #1726 <- #1728 <- #1738 <- #1744 <- #1765 <- #1792 <- #1864 <- #1873 <- #1880 <- #1888 <- **#1912 (tip)**.
  #1794 is a second tip off #1792. This is the chain a column/export change must stack on, because #1792 owns
  `forHouse`/`DRINK_ONLY_HEADERS` and #1912 owns the list-unit reading.
- UNIT-IN-EXPORT: main <- #860..#900 <- #934 <- #1071 <- #1221 <- #1233 <- #1356 <- #1373 <- #1493 / #1510.
  Not inside #1912's ancestry. A new export build must either (i) stack on #1912 and re-apply #1373's Unit
  column (cite it), or (ii) first get an integration branch merging #1373 into #1912's stack. Recommend (i)
  with an explicit note, because (ii) is a merge of two 40-deep trees. It is the builder's call; record it.
- NUTRITION/ALLERGEN: main <- #922 <- #923/#924/#926/#927 <- #1013 (gateway rules, side branch);
  web: #900 <- #938 <- #939 <- #940 <- #1002 <- #1495 (tip, plus #1015 form refusal). #1495 is also an
  ancestor of the #1022/#1912 stack (via #1002), so building on #1912 already contains the nutrition card.
  (#1013 is NOT in #1912's ancestry; its gateway rules are separate.)
- RECIPES/DISHES: main <- #863 <- #864 <- #867 <- #887..#937 <- #1012..#1073 <- #1139..#1141 <- #1160..#1166
  <- #1186/#1191 <- #1222 (dishes schema) <- #1223 <- #1224 <- #1225 <- (+70) <- #1503..#1512, #1579..#1621
  <- #1907 <- #1915. Recipe/dish chain tips: #1231, #1512, #1564, #1661, #1779, #1788, #1806, #1829, #1915.
  Separate from the inventory chain; nothing in #1912's ancestry contains dishes. A dish export or dish taste
  field must stack on the dishes tip it needs (#1915 for menu/dish prices; #1829 for what-is-in sentence).
- POS/RECIPE DRAW: main <- #1396 <- #1421 <- #1478 <- #1480 <- #1483 <- #1540 <- #1796 <- #1811 <- #1815 <-
  #1820 <- #1908 <- #1909 <- **#1914 (tip)**.
- TASTE (new): nothing to stack on for goods outside wine. The only taste ancestry is on main
  (`master_wine_library`, `beverages`). A taste-profile schema should add to `restaurant_inventory`-linked
  tables (not wine library) and be independent of the recipe chains, then be read by both export (stack
  #1912) and dish list (stack dishes tip). Two stacks cannot be one PR; expect two PR families.

Cross-stack file conflicts to expect: `InventoryNext.tsx` (#1373 vs #1792/#1888/#1912), `iv-export.ts` (#1373,
#1792, #1744), `useInventoryNextData.ts` (#1233, #1407, #1704, #1912), `ItemDrawer.tsx` (#1022, #1373, #1888),
`RowDropdown.tsx` (#1022, #1373).

## 9. Not verified / limits
- Did not run any code or tests; all findings are static reading of main and `gh pr diff`.
- The founder's file header mismatch (1a) is not resolved; production was not queried.
- #1233's effect on the export `Type` cell (it fixes the list; whether `valuationColumns` uses the same `type`) not traced.
- Counts of the PR tree come from `gh pr list --limit 3000` at fetch time; chains computed from base/head names only.
- Flavor Lab: read FINDINGS sections 1-4, 7, 13 and mechanism.py header only; the 69 KB register and results were not read.
