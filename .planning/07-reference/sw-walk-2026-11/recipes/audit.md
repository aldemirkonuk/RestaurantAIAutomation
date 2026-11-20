# Recipes — software walk audit (2026-11-07)

Read-only audit of `origin/main` (fetched this session). Every citation is `path:line` on origin/main.
No production was touched; anything about what is *applied* in production is marked "not verifiable read-only".
No confidence numbers (ADR 0104).

---

## 1. What this software is for (in the restaurant's words)

"When the bartender rings up a Negroni, I want the house to know it just used 30 ml gin, 30 ml Campari and
30 ml vermouth. The bottles in the back should go down, and I should see what that drink cost me tonight at
the price I actually paid for those bottles. The same goes for a glass of house red, a pint from the keg, a
double whisky, and later the kitchen's plates. If the drink costs too much for its price, tell me. If the
shelf count does not match what the till says we poured, tell me that too."

In system terms, a recipe software owns:

- **The spec.** Ingredients, quantities in a real unit (ml, cl, oz, dash, each, g), garnish, glass, method, yield and dilution.
- **Batches.** Batches and prebatches made from other recipes (sub-recipes).
- **The link from goods to recipe.** Each ingredient points at a stocked **house item** whose lots carry cost.
- **The link from recipe to sale.** Each POS or menu item and size (single, double, glass, bottle, pint) points at a recipe or serve.
- **Cost per serve.** Ingredient quantities × current lot cost (WAC or FIFO), recomputed when a new invoice lands.
- **Depletion on sale.** Every sold line removes its recipe's quantities from stock, idempotently, with voids reversed by the same amounts.
- **Variance.** Theoretical usage (sales × recipes) against counted usage.

Scope ruling (memory: scope-all-beverages-then-foods): all beverages first, then foods.

---

## 2. Path map (what exists today)

### 2.1 Screens / components (apps/web)

| Piece | Location | Notes |
|---|---|---|
| Lazy route `CellarNext` | `apps/web/src/App.tsx:104` | `/cocktails` route `App.tsx:430`; QueryClient staleTime 5 s + refetchOnWindowFocus `App.tsx:157-161` |
| Register switch to cocktails | `apps/web/src/pages/cellar/next/CatalogueRegister.tsx:300-307` | Routes the cocktails register to `CocktailRegister` |
| Cocktail register (list + add + edit + recipe) | `apps/web/src/pages/cellar/next/CocktailRegister.tsx` (564 lines) | Add form `:312-322`, edit `:445-455`, ledger section `:492-558` |
| Recipe editor | `CocktailRegister.tsx:82-211` | Textarea, one ingredient per line, parsed by regex `:113` `/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{1,10})?\s+(.*)$/`; success copy `:127`, failure copy "Nothing was changed" `:131` |
| Data hooks | `apps/web/src/pages/cellar/next/useCellarNextData.ts` | `useCocktailWrites` `:1021-1070`; recipe query key `['cellar','recipe',…]` `:1077`; `CATALOGUE_READ_LIMIT = 300` `:1103`; `CocktailListVM.recipesAvailable: false` `:447`; page loader `useCellarNextData` `:1307` |
| RECIPE column copy | `apps/web/src/pages/cellar/next/cellar-columns.ts:121, :650-662` | Promises a cost per pour "derivable … needing no migration" |
| Settings: measurement | `apps/web/src/pages/settings/next/MeasurementSection.tsx:2-12, :81-98` | Default pour, "Enable recipes", "Recipe yield unit": all in browser localStorage |
| Volume maths | `apps/web/src/utils/volumeUtils.ts` | `POUR_SIZE_MIN_ML = 30` `:9`; `getGlassesPerBottle` (floor) `:60-68`; `costPerGlass` `:86` |
| Legacy pour cost | `apps/web/src/data/wineData.ts:76` (`calculatePourCost`), `:87` (`getDefaultMenuPrice` = 3×) | |
| Legacy inventory sort | `apps/web/src/pages/inventory/useInventoryPage.ts:51-58, :316-326` | Sorts margin on a fabricated 3× price |

### 2.2 Endpoints (apps/api-gateway)

`apps/api-gateway/src/beverages/beverages.controller.ts`. The class is guarded by `JwtAuthGuard` only (~`:58`), with no `@Roles`, and the in-file `guard()` helper is at `:254-275`.

| Verb + path | Line | Service method |
|---|---|---|
| GET `beverages/cocktails/:restaurantId` | `:89` | `listCocktails` `beverages.service.ts:324-372` |
| POST cocktails | `:184` | `createCocktail` `:551` |
| PATCH cocktail | `:194` | `updateCocktail` `:582` |
| DELETE cocktail (soft) | `:206` | `deleteCocktail` `:630` |
| GET `…/ingredients` | `:219` | `readCocktailIngredients` `:725` |
| PUT `…/ingredients` | `:230` | `setCocktailIngredients` `:665-722` |

DTOs are in `apps/api-gateway/src/beverages/dto/beverages.dto.ts`:

- `CocktailFieldsDto` `:126` (price Min 0 / Max 100000).
- `CocktailIngredientDto` `:201` (unit is free text, MaxLength 30; quantity Min 0).
- `SetCocktailIngredientsDto` `:240` (ArrayMaxSize 40).

### 2.3 Sale → depletion path (where a recipe *should* plug in)

| Step | Location |
|---|---|
| POS hub resolves sale volume (ADR 0011) | `apps/api-gateway/src/pos-hub/pos-hub.service.ts` ~`:456-524`; capacity refusal `:487` |
| Inventory volume read filtered to wine | `pos-hub.service.ts:1342-1347` |
| **Non-wine lines skipped** | `pos-hub.service.ts:1365` `if (!it.is_wine) continue;` |
| Glass pour RPC call | `pos-hub.service.ts:1443` `p_pour_ml: Math.round(resolved.ml)` |
| Void returns whole bottles (B19) | `pos-hub.service.ts:1454` comment, `:1480` `p_delta: isVoid ? qty : -qty` |
| Toast: per-line mapping lookup | `apps/api-gateway/src/toast/toast.service.ts:523-540` |
| Toast: unit default | `toast.service.ts:638` `const unit = saleUnit ?? "bottle"` |
| Toast: idempotency key | `toast.service.ts:640` |
| Toast: glass void → +qty bottles | `toast.service.ts:657` |
| Toast: glass sale pour unknown | `toast.service.ts:675` `p_pour_ml: null` |
| Manual pour | `apps/api-gateway/src/inventory/inventory.service.ts:386`; fallback key `:368-370` |
| Glasses per bottle (server) | `inventory.service.ts:86-94` (floor; default `restaurants.default_pour_ml ?? 150`) |
| Menu-scan classifier knows "cocktail" | `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:80`, `wine-extract-item.interface.ts:31` (never creates a cocktail row) |

### 2.4 Pricing / cost

| Piece | Location |
|---|---|
| Glass cost from bottle cost (correct proportional maths) | `apps/api-gateway/src/pricing/margin-to-target.ts:112-121` |
| Wine-only glass margin advice on lot WAC | `apps/api-gateway/src/pricing/margin-advice.service.ts:249-300` (WAC read `:146`, `:182`) |
| Cocktail counts in cellar registers | `apps/api-gateway/src/cellar/cellar-registers.service.ts:184-204, :624` |

### 2.5 Tables / views / functions (supabase/migrations)

| Object | Location | Shape |
|---|---|---|
| `cocktails` | `20260817090000_cocktails.sql:26-42` | name, display_name, menu_section, method, glass, garnish, `price numeric`, description, data_enrichment, source, soft delete; `restaurant_id` nullable |
| `cocktail_ingredients` | same file `:60-72` | `cocktail_id`, `beverage_id` → global `beverages`, `wine_id` → `master_wine_library`, `free_text`, `quantity numeric`, `unit text`, `sort_order`; CHECK has_a_referent; created empty (`:19-24`) |
| `catalogue_items` view (unions cocktails) | `20260817100000_catalogue_items_cocktails.sql` | |
| Tenant RLS for cocktails + ingredients | `20260818000000_beverage_security_fixes.sql:29-51` | |
| `menu_items` | `20260805000000_baseline_from_production.sql:3783` | `by_glass_price`, `bottle_price`, `wine_library_id`, `inventory_item_id`; no cocktail/recipe FK |
| `pos_item_mappings` | baseline `:4216` | one POS item → one `inventory_id` |
| `pour_events` | baseline `:4235` | integer `pour_ml` |
| `restaurant_inventory` | baseline `:3259` | |
| House-item identity (ADR 0115) | `20260903171000_the_house_item_is_the_ledgers_key.sql` | header `:3` "GATED. DO NOT APPLY"; drops NOT NULL on `master_wine_id` `:168/:176/:179`; adds `kind`, `uom`, `display_name`, `beverage_id` `:276-280`; kind CHECK `:347` includes cocktail and food; uom CHECK `:361`; `house_items` view `:497`; trigger `set_house_item_identity` `:415` |
| `record_glass_pour` (cross-lot, ADR 0285) | `20261217112500_a_short_pour_opens_the_next_bottle.sql:77-194` | pour default `COALESCE(p_pour_ml, ri.pour_size_ml, 150)` `:102-103`; all-or-nothing availability `:130-131`; ledger row `-bottles_opened` `:172-182` |
| `record_glass_pour` + `p_occurred_at` (ADR 0281) | `20261222100000_a_pos_sale_is_dated_by_its_check.sql:288-301` | pour_events insert `:403` carries no occurred date |
| Wine states its own pour | `20260922230900_a_wine_can_state_its_own_pour.sql:34-37` | |
| `pos_item_sales` (ADR 0298 COGS) | `20270301170000_cost_of_goods_reads_what_sold.sql:48` | `bottles_out = -sum(quantity_change)` `:108-117`; no consumer in apps/services (grep) |

### 2.6 Jobs

No job computes recipe cost, recomputes cost on invoice arrival, or reports theoretical-vs-actual variance. Grep for `cocktail_ingredients` across `services/` and `apps/api-gateway/src/**/*.processor.ts|cron` finds no hit. `scripts/synth/recipes.py` holds simulation archetypes, not drink recipes.

### 2.7 Decisions and records that bind this area

- ADR 0011: the sale volume contract.
- ADR 0048 (`.planning/decisions/0048-*.md:68`): L2 yield + recipe/BOM is the keystone.
- ADR 0070: integer quantity + `uom`.
- ADR 0115: still Proposed ("NOT applied", `0115-*.md:3`).
- ADR 0281: a POS sale is dated by its check.
- ADR 0285: a short pour opens the next bottle.
- ADR 0297 (a glass is not a bottle): Proposed.
- ADR 0298: COGS via `pos_item_sales`.
- OD-113 (`OPEN-DECISIONS.md:72`): the identity axis for non-wine goods.
- `v3.0-TECH-DEBT.md:2903-2905`: 79 of 92 lines at Sim Vanilla Kaleiçi were queued as unmapped wine.
- `.planning/08-softwares/` has no recipes software doc.

### 2.8 Open PRs overlapping this area

- **#589** `docs/adr-0115-drinks-lock`: locks the house-item key that recipes need for goods links.
- **#650** `fix/cellar-till-names-with-a-serve-size` (ADR 0301): serve-size names on the till, overlapping G14.
- **#619** `fix/stockout-counts-open-ml`: counts open-bottle ml, which feeds G12.
- **#615** `owner-sales-read-net`: changes the sales read that cost per serve would join.

---

## 3. How it performs today (judged by reading code)

### Route weight

`/cocktails` mounts the whole Cellar Next data hook (`useCellarNextData.ts:1307`). That hook loads:

- the wine book in 500-row pages;
- inventory and providers;
- the registers and the live feed;

all before the cocktail register renders. A page that shows at most 300 cocktails (`:1103`) pays for the full wine catalogue.

`CocktailRegister.tsx` is 24 KB in the lazy CellarNext chunk, so its own size is fine.

### Waterfalls

- `listCocktails` runs two sequential queries: the list, then reference counts (`beverages.service.ts:324-372`). They could run in parallel or as one.
- Reading a recipe costs an ownership read, then the lines (`:725`).
- Writing a recipe costs an ownership read, then a delete, then an insert (`:665-722`). That is three round trips and is not atomic (see G7).

### N+1

The Toast ingest queries `pos_item_mappings` once per order line inside the loop (`toast.service.ts:523-540`). A 40-line check means 40 lookups. The pos-hub path batches its inventory read (`pos-hub.service.ts:1342-1347`), so it is not N+1.

### Slow queries

No recipe maths runs in SQL today, so there is no slow recipe query. `record_glass_pour` takes row locks across lots (ADR 0285) and is called once per glass line. That is acceptable at current volumes, but a cocktail BOM would multiply it by the ingredient count, so a set-based depletion RPC is needed before cocktails deplete.

### Cache

The 5 s staleTime plus refetch on focus (`App.tsx:157-161`) hides some staleness. The recipe key is still never invalidated after a save (G8).

---

## 4. Gaps

Severity: **blocker** means the software cannot do its job; **major** means wrong numbers or data loss; **minor** means polish, performance or copy.

### Model and links

**G1 (blocker).** Nothing beyond wine depletes on sale.

`pos-hub.service.ts:1365` `if (!it.is_wine) continue;` and the wine-only volume read `:1342-1347` skip cocktails, spirits, beer and food lines entirely. Stock and cost of goods for every non-wine sale are therefore zero.

**G2 (blocker).** No sale-to-recipe (BOM) link exists.

- `pos_item_mappings` maps one POS item to exactly one `inventory_id` (baseline `:4216`).
- `menu_items` has no cocktail or recipe FK (baseline `:3783`).

A sold Negroni cannot reach its three ingredients, even if the recipe is written.

**G3 (blocker).** Recipe ingredients point at catalogue identities, not the house's stocked goods, so there is no lot cost.

`cocktail_ingredients.beverage_id` points at the global `beverages` table and `wine_id` at `master_wine_library` (`20260817090000_cocktails.sql:60-72`). Neither points at `restaurant_inventory` or its lots.

Non-wine goods cannot be stocked at all:

- ADR 0115 is still Proposed (`0115-*.md:3`), and its migration header says "GATED. DO NOT APPLY" (`20260903171000_…sql:3`).
- The gateway has no non-wine write path.
- OD-113 is open (`OPEN-DECISIONS.md:72`).

Whether the 0115 migration has run in production is not verifiable read-only. Either way, there is no lot cost to multiply, and **cost per serve from current lot cost is impossible** for cocktails, spirits and beer.

**G4 (blocker).** Food recipes do not exist.

- There is no table, endpoint or screen for food recipes, sub-recipes, prep yields or plates.
- ADR 0048 names L2 (yield + recipe/BOM) as the keystone (`0048-*.md:68`). Nothing on main implements it.
- The house-item `kind` CHECK lists `food` (`…_the_house_item_is_the_ledgers_key.sql:347`), but nothing writes it.

**G5 (major).** The editor never links an ingredient to goods.

The textarea parser (`CocktailRegister.tsx:82-211`, regex `:113`) only produces `free_text`, quantity and unit. It never sets `beverageId` or `wineId`, so every line saved through the UI is an orphan string, even where the API could link it (`beverages.dto.ts:201`).

**G6 (major).** Units are unconstrained free text with no conversion.

- `cocktail_ingredients.unit` is `text` with no CHECK (`cocktails.sql:60-72`).
- The DTO accepts any unit up to 30 characters (`beverages.dto.ts:201`).
- There is no oz/cl/ml/dash/barspoon conversion anywhere on the recipe path.

This conflicts with the ADR 0070 `uom` vocabulary (`…ledgers_key.sql:361`). As a result, "1.5 oz" and "45 ml" cannot be summed or costed.

**G14 (major).** The model has no batch, yield, dilution, sub-recipe or serve size.

- `cocktails` has none of these columns (`cocktails.sql:26-42`).
- A single price column (`price numeric`) cannot express single/double or glass/bottle/pint per item.

This contradicts the founder's 2026-10-01 rulings: serve sizes per kind in ml, a serve price per (item, ml) and per named single/double, and kegs as stock with the glass derived from the open keg. Prebatched drinks, syrups and infusions cannot be represented.

### Write correctness

**G7 (major).** Saving a recipe can erase it, and the UI then says nothing changed.

`setCocktailIngredients` deletes all lines (`beverages.service.ts:691`) and then inserts the new ones (`:701`) in two separate PostgREST calls with no transaction.

If the insert fails, the old recipe is gone. The editor then shows "Nothing was changed" (`CocktailRegister.tsx:131`), which is false.

**G8 (major).** After a save the recipe shows stale lines.

`setRecipe`'s onSuccess invalidates only `['cellar','cocktails']` and `['cellar','register']` (`useCellarNextData.ts:1021-1070`). The recipe query key `['cellar','recipe',…]` (`:1077`) is not invalidated, so the open recipe keeps showing the old lines, or "No recipe recorded", until the next refetch.

**G9 (major).** Any signed-in staff member can create, re-price or retire a cocktail.

The controller carries `JwtAuthGuard` only, with no `@Roles` (`beverages.controller.ts` ~`:58`, routes `:184/:194/:206/:230`). The `guard()` helper checks tenancy, not role (`:254-275`). The price is a money field.

### Depletion and cost maths

**G10 (major).** Toast depletes whole bottles when the sale unit is unknown.

`toast.service.ts:638` `const unit = saleUnit ?? "bottle"`. This is the over-depletion default that ADR 0011 removed from pos-hub, where unknown volume now fails closed. An unmapped glass sale through Toast removes a full bottle.

**G11 (major).** Voiding glasses returns whole bottles.

- pos-hub: `p_delta: isVoid ? qty : -qty` (`pos-hub.service.ts:1480`, B19 comment `:1454`).
- Toast: `p_delta: qty` (`toast.service.ts:657`).

Voiding 2 glasses of a 750 ml wine adds 2 bottles (1500 ml), where the sale removed 300 ml. Stock is inflated on every glass void.

**G12 (major).** Cost of goods counts bottles opened, not ml poured.

- `record_glass_pour` writes the ledger as `-bottles_opened` (`a_short_pour_opens_the_next_bottle.sql:172-182`).
- `pos_item_sales.bottles_out = -sum(quantity_change)` (`cost_of_goods_reads_what_sold.sql:108-117`).

So the first 150 ml glass from a fresh bottle books one full bottle of cost and the next four glasses book zero. Per-period and per-item COGS is lumpy and wrong for anything poured by the glass. A 150 ml glass of a 750 ml bottle should cost 1/5 of the bottle (`margin-to-target.ts:112-121` does this correctly, but the ledger does not).

`pos_item_sales` has no consumer yet (grep), so the error is latent and will surface when ADR 0298 reads it.

**G13 (major).** Default pour size has three sources that disagree.

- The browser's localStorage (`MeasurementSection.tsx:2-12`).
- The server's `restaurants.default_pour_ml ?? 150` (`inventory.service.ts:86-94`).
- The SQL `COALESCE(p_pour_ml, ri.pour_size_ml, 150)`, which ignores `restaurants.default_pour_ml` (`a_short_pour_opens_the_next_bottle.sql:102-103`).

A house that sets 125 ml in Settings sees 125 on screen but is depleted at 150 by the database (Toast glass sales pass `p_pour_ml: null`, `toast.service.ts:675`).

**G15 (major).** The "Enable recipes" and "Recipe yield unit" switches do nothing.

Both live only in browser localStorage (`MeasurementSection.tsx:81-98`), and grep finds no consumer of either key. Separately, the server hard-codes `recipesAvailable: false` (`beverages.service.ts:367`, type `:227`; web VM `useCellarNextData.ts:447`).

The RECIPE column copy promises a cost per pour "derivable … needing no migration" (`cellar-columns.ts:650-662`). That is untrue given G3.

**G16 (minor).** Cost per glass is overstated by flooring.

`costPerGlass` divides bottle cost by `Math.floor(bottleMl / pourMl)` (`volumeUtils.ts:60-68, :86`). For 750/175 that is 4 glasses instead of 4.29, about 7% high, and 750/125 is exact while 700/125 floors 5.6 to 5 (12% high). It returns 0 when the input is unknown, which reads as free.

The server path in `margin-to-target.ts:112-121` is proportional and correct, so two screens can show different glass costs for the same wine.

**G17 (minor).** The minimum pour of 30 ml blocks common spirit serves.

`POUR_SIZE_MIN_ML = 30` (`volumeUtils.ts:9`) rejects the 20 ml and 25 ml measures used for spirits in TR/UK.

**G18 (minor).** The pos-hub capacity refusal is stale.

`if (ml > capacity)` (`pos-hub.service.ts:487`) refuses any sale volume above one bottle. ADR 0285's `record_glass_pour` draws across bottles, so a 1 L carafe sold from 750 ml bottles is wrongly refused.

**G19 (minor).** A retried manual pour pours twice.

The fallback idempotency key is `pour:${id}:${Date.now()}:${random}` (`inventory.service.ts:368-370`), so a network retry without a client key double-pours.

**G20 (minor).** Toast glass sales lose the pour size and the check date.

`p_pour_ml: null` (`toast.service.ts:675`) falls back to 150, and no `p_occurred_at` is passed, against ADR 0281. The pour_events insert does not record an occurred date either (`a_pos_sale_is_dated_by_its_check.sql:403`).

**G21 (minor).** Legacy screens fabricate a menu price.

`getDefaultMenuPrice` is 3× cost (`wineData.ts:87`). It drives the margin sort in `useInventoryPage.ts:51-58, :316-326`, so the sort orders by an invented number.

### API and UI polish

**G22 (minor).** PATCH cannot clear a field.

`updateCocktail` writes only defined fields (`beverages.service.ts:582`), so garnish, glass or price cannot be set back to empty.

**G23 (minor).** The form has no description field.

The column exists (`cocktails.sql:26-42`), but the add and edit forms omit it (`CocktailRegister.tsx:312-322, :445-455`).

**G24 (minor).** The recipe line parser mis-reads common specs.

With regex `:113`:

- "2 egg whites" becomes unit "egg", item "whites".
- "1/2 oz lime" and "¾ oz" fall through to free text with no quantity.
- "2 dashes Angostura" gets unit "dashes" with no normalisation.

**G25 (minor).** `truncated` is true at exactly the limit.

`truncated: rows.length >= limit` (`beverages.service.ts:324-372`) reports truncation when a list has exactly 300 rows. Fetching limit+1 would fix it.

**G26 (minor).** Internal jargon reaches staff.

The success copy names `cocktail_ingredients` (`CocktailRegister.tsx:127`).

**G27 (minor).** The `/cocktails` page loads the whole wine book, inventory and providers.

See §3: `useCellarNextData.ts:1307`.

**G28 (minor).** Sequential round trips on the recipe list and save, plus a Toast N+1.

- `beverages.service.ts:324-372, :665-722, :725`.
- `toast.service.ts:523-540`.

**G29 (minor).** The menu scan sees cocktails but never creates them.

`scan-parser.service.ts:80` classifies "cocktail" (`wine-extract-item.interface.ts:31`), yet no path writes a `cocktails` row. That leaves the table empty in practice (`cocktails.sql:19-24`, created empty).

**G30 (minor).** No software doc and no variance.

- `.planning/08-softwares/` has no recipes doc.
- No job or view compares theoretical usage (sales × recipe) with counted usage. Every SOTA tool in `sota.md` treats that as the core report.

---

## 5. Order this would be fixed in (session's call, per /goal 2026-11-07)

1. **G7 and G8.** Make the recipe write atomic in one RPC and invalidate the recipe key. These are pure correctness fixes, small, and need no decision.
2. **G11, G10 and G13.** Make voids reverse the ml poured, make Toast fail closed, and give default pour one source. These stop live stock drift on wine, which already depletes.
3. **G12.** Book the ml-proportional cost on the ledger, or in `pos_item_sales`, before ADR 0298 gets a reader.
4. **G3, G1 and G2.** Land the house-item key (ADR 0115 or #589, OD-113), then a `recipe_lines → house_item` FK, a `pos_item → recipe/serve` BOM table, and a set-based depletion RPC. This is the keystone. Everything about cocktail cost and depletion waits on it.
5. **G14, G5 and G6.** Add serve sizes, batch/sub-recipe, yield and dilution, a unit vocabulary with conversion, and a goods picker in the editor.
6. **G4.** Add food on the same model. Then add variance (G30).
