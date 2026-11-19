# R2 - State of the art: goods model, count sheets, taste profiles

Researcher R2, 2026-11-19. Web search only (no downloads, no page fetches). Evidence grades: [V] vendor help doc/official standard, [M] vendor marketing or third-party listing (treat skeptically), [G] gap (not verified).
Honest limits: MarketMan, Apicbase, Craftable, Sculpture/Tenzo and Partender internals were NOT confirmed from primary docs (search returned only aggregators). Official WSET/BJCP PDFs were located but not read in full; scale names below come from search excerpts. Re-check before quoting any number.

## 1. How leading systems model a good and count it

Common pattern across systems (convergent, so safe to adopt):
1. One **item master** (an "ingredient/product/inventory item"), separate from the **vendor item** (supplier SKU with pack size and price) and from the **recipe/dish** (which consumes items by weight/volume/each).
2. Item has a **base/stock unit**, and one or more **count units** (case, bottle, each, lb) with explicit conversions. Restaurant365 allows up to three units of measure per item on one count line [V]; MealSuite defines "items per stock unit" pack-size conversion [V]; Cogs-Well counts by pack, by count unit, or a mix [V].
3. **Storage areas/locations** order the count sheet (walk path); an item may live in several areas, each with its own count sheet (SalesVu) [V]; R365 shows per-location completion progress [V].
4. **Recipes carry yield** (usable percentage) and allergens; xtraCHEF defines yield as the usable fraction and lets prep recipes list "contains" and "may contain traces" allergens [V]; meez auto-tags allergens and computes total yield weight [M]; Galley lists ingredients, allergens, units of measure and vendor items as its food data [M]; Apicbase links ingredient database to suppliers and prices so allergens/nutrition/cost roll up from ingredient to recipe to menu [M].
5. Invoice-linked purchasing: xtraCHEF ties a product to an invoice line item; missing ingredient usually means no product linked [V].
6. **Beverage counting is by partial amount, not whole units**: BevSpot "tenthing" slider and bottle-level percentage, bottle weighing on paid tiers, keg weighing minus empty-keg tare [V/M]; Partender tap-the-liquid-level and Bluetooth scale [M]; WISK scale with per-item stored weights (average when several), spout tare, partial+full units in one count, offline, spot-check partial counts [V/M]. Wine by the glass is tenthed, by the bottle counted as bottles+cases (BevSpot) [V].
7. Variance = counted vs theoretical (system) quantity, par, last counted date: standard columns.
8. Menu engineering (Kasavana-Smith): per dish, contribution margin (price minus ingredient cost) vs popularity (unit share, 70%-of-average cutoff is the classic rule); quadrants Star/Plowhorse/Puzzle/Dog; cutoffs vary by tool and should be chosen deliberately [V/M]. Needs dish cost, which needs recipe + ingredient cost: so dishes are first-class "countable-by-sale" goods even if not counted physically.

Key gap in the founder's export: it is wine-only (Wine, Producer, Vintage, Type, Bottle size). Every competitor's count sheet is category-agnostic with category-specific optional columns. Dishes are not counted but are costed, allergen-tagged and engineered; prep/batch items (house stocks, sauces) ARE counted and are recipes.

## 2. Taste-profile standards by category

- **Basic tastes** (sweet, sour, salty, bitter, umami) plus trigeminal/mouthfeel: fat/richness, heat (pungency), astringency, carbonation, temperature. Intensity 0-10 line scale.
- **Wine - WSET SAT** [V]: appearance; nose; palate: sweetness (dry/off-dry/medium/sweet; L3 adds medium-dry, medium-sweet, luscious), acidity, tannin, alcohol (low/medium/high), body (light/medium/full), flavour intensity, flavour characteristics, finish; L3 uses medium(-)/medium(+) steps. 5-6 point ordinal scales.
- **Spirits - WSET SAT spirits** [V, partial]: appearance (clarity, intensity, colour), nose, palate, conclusions; lexicon is a prompt list, not closed. WSET refreshed L3 spirits in 2025 and reportedly simplified the SAT [G: confirm current version].
- **Beer - BJCP 2021** [V]: per style: aroma, appearance, flavor, mouthfeel, comments, history, ingredients, vital statistics (IBU, SRM, OG, FG, ABV ranges). Numeric measured stats (ABV, IBU, SRM) are facts, separate from sensory scores.
- **Coffee - SCA/WCR** [V]: Coffee Taster's Flavor Wheel (2016, built on the WCR Sensory Lexicon: 110 flavor/aroma/texture attributes with physical references, Kansas State). Wheel is CC BY-NC-ND: do not copy its artwork or modify; use own taxonomy that maps to its top-level families (fruity, floral, sweet, nutty/cocoa, spices, roasted, green/vegetative, sour/fermented, other).
- **Tea**: no single standard fetched [G]; use the generic schema (astringency, sweetness, umami, bitterness, body, aroma families: vegetal, floral, fruity, roasted, earthy, marine), plus type (green/black/oolong/white/pu-erh/herbal), steep temp and time.
- **Cocktails - WSET balance model** [V/blog]: two scales: strong vs weak (alcohol vs dilution/mixers) and sour/bitter vs sweet; families spirit-forward, short sour, long sour, highball. Sour template ratios disagree across sources (2:0.75:0.75 vs 2:1:0.75), so store actual recipe ratios, do not hard-code a "correct" one. Dilution is a first-class variable.
- **Foods/dishes**: no formal restaurant standard; borrow sensory science practice: basic-taste intensities, fat, heat, acid, texture words (crisp, creamy, chewy, ...), aroma families, plus cuisine/technique tags. Menu engineering supplies the commercial axes.
- **Sensory-science method** [V/M]: QDA (trained panel, line scale, 80-150 h training, most precise); CATA (check-all-that-apply, consumers or staff, rapid, less precise, can be untrained); 9-point hedonic scale for liking (5/7-point less sensitive); 0-10 line scales for intensity. Product consequence: staff tag with CATA (fast, forgiving), a trained few score intensities, guests give hedonic liking; keep the three signals in separate fields and never average them.

## 3. Recommendation: ONE unified taste-profile schema

Design rules: (a) core intensities shared by every category so any two goods are comparable and a pairing/substitution engine works; (b) category extension blocks hold the native vocabulary (WSET steps, BJCP stats, coffee families); (c) separate **source** (producer/style standard, house staff, panel, guest) and **confidence** per profile; (d) ordinal native values stored as-is AND normalised 0-10 for comparison; (e) facts (ABV, IBU) never stored as sensory scores.

```
taste_profile            -- 1 row per (good_id, source, version)
  good_id, tenant_id
  source        enum('standard','house','panel','guest_aggregate','ai_draft')
  confidence    0..1 ; rated_by, rated_at, method enum('qda','cata','line','native_ordinal')
  -- core intensities, 0..10, nullable (null = not rated, NEVER 0)
  sweet, sour, salty, bitter, umami, fat_richness, heat_pungency,
  astringency, body_weight, carbonation, aromatic_intensity, finish_length, temperature_served
  aroma_families  text[]   -- fruit, floral, herbal_vegetal, spice, nut_cocoa, roast_smoke, earth_mineral, dairy_bread_yeast, marine, chemical_oak (own taxonomy, mappable to WSET/SCA terms)
  descriptors     text[]   -- CATA free-ish tags from a controlled list per category
  texture         text[]   -- foods: crisp, creamy, chewy, flaky...
  summary         text     -- one line shown on count sheet / menu
  ext             jsonb    -- per-category block below, validated per category
liking (separate table): good_id, guest/staff id, hedonic 1-9, context, ts
```
Per-category `ext` (native vocabularies):
- wine: WSET fields (sweetness step, acidity, tannin, alcohol, body, flavour intensity, finish at low/med-/med/med+/high), style, grapes, region, vintage, closure.
- spirits: category/sub-style, age statement, cask, ABV, colour, clarity, WSET nose/palate notes.
- beer: BJCP style code, ABV, IBU, SRM, OG/FG, serve format (keg/can/bottle), freshness date.
- cocktail: family (spirit-forward/short sour/long sour/highball), spec ratios, dilution %, ABV est., garnish, glass.
- coffee: process, roast, origin, SCA family tags; tea: type, steep temp/time.
- food/dish: cuisine, technique, protein, course, spice level 0-5 label, dietary flags, heat/serve temp, menu-engineering class (derived, not stored by hand).

Derived (computed, not typed): menu-engineering quadrant, pairing score, substitution candidates, "similar goods", out-of-range flags (e.g. ABV vs BJCP style).

## 4. What a count sheet / goods export must carry per category

Universal columns (every row): good_id, name, category, subcategory, storage area, shelf/bin order, count unit, base unit, pack size (units per case), counted qty (in count unit; supports partial), system qty (live), par, variance, variance value, unit cost, extended value, last counted (date+by), supplier + vendor SKU, origin (country/region), allergens (FDA 9 + EU 14 flags; "contains" vs "may contain"), dietary flags, taste summary, status (active/86/seasonal).
Allergen lists: FDA nine = milk, egg, fish, crustacean shellfish, tree nuts, wheat, peanuts, soybeans, sesame (sesame since 2023) [V]; EU 14 adds cereals with gluten, mustard, celery, lupin, molluscs, sulphites (confirm Annex II of Reg. 1169/2011 [G]). Store the superset, tag the regime.

Per category additions:
- Wine: producer, vintage, type, bottle size ml, grapes, appearance of open bottle (tenths), by-glass vs by-bottle, case size.
- Spirits: brand, expression, ABV, bottle size, open-bottle fill (tenths or weight), bottle tare/full weight, pour size.
- Beer: brand, style (BJCP), ABV, container (keg size, can/bottle pack), keg tare + weight, freshness/best-by, tap line.
- Cocktail/batch: spec, yield, batch date, shelf life (counted as prep).
- Coffee/tea: roast/lot date, origin, pack weight.
- Food/produce/dry/dairy/protein: purchase unit vs recipe unit, yield %, catch-weight flag, lot/received date, expiry, temperature zone (ambient/chill/freeze), brand/grade.
- Supplies (paper, chemicals, smallwares): pack size, min order, no taste/allergen (chemicals: hazard flag).
- Prep/batch (house-made): recipe link, batch yield, made date, discard date, allergens rolled up from recipe.
- Dishes (not counted, but exported in goods sheet): price, plate cost, margin, units sold, menu class, recipe link, allergens rolled up, taste profile.
Count UX needs (from competitors): walk order by storage area, multi-UoM entry on one line, partial entry by slider/weight, offline, spot-check partials, blind count option, per-area completion progress.

## 5. Build-order suggestion for the lanes (R2 view)
1. Generalise the count export to the universal columns + category blocks (biggest user-visible fix, no new data).
2. Item master with count-unit conversions and storage area; allergens as a superset flag set.
3. taste_profile table + ext validation; start with wine/beer (standards exist), then food/dish via CATA tags; liking separate.
4. Dish costing + menu-engineering view derived from recipe + sales.
5. Partial-count capture (tenths/weight) for spirits and kegs.

## Sources
- MealSuite pack size / stock unit: https://support.mealsuite.com/hc/en-us/articles/47180858673555
- Restaurant365 count sheet details: https://docs.restaurant365.com/docs/inventory-count-sheet-details
- Restaurant365 create/enter count (up to 3 UoM): https://docs.restaurant365.com/docs/create-and-enter-inventory-count
- Restaurant365 multiple count UofMs: https://docs.restaurant365.com/docs/inventory-counts-using-multiple-count-u-of-ms
- Cogs-Well count worksheet: https://cogs-well-inc.helpscoutdocs.com/article/321-inventory-count-worksheet
- SalesVu count sheet / storage areas: https://salesvusupport.zendesk.com/hc/en-us/articles/25837423623053-How-to-Use-Count-Sheet-Feature
- meez counting inventory: https://intercom.help/getmeez/en/articles/9237334-counting-inventory
- Toast xtraCHEF recipes: https://intercom.help/toast-central/en/articles/14728216-xtrachef-get-started-with-recipes
- Galley vs meez (vendor page): https://www.galleysolutions.com/galley-vs-meez
- Apicbase listings: https://www.getapp.com/retail-consumer-services-software/a/apicbase-food-management
- BevSpot bar inventory: https://bevspot.com/blog/bar-inventory-usage-beginners/
- BevSpot keg weighing: https://bevspot.com/blog/how-to-weigh-draft-beer-kegs-for-bar-inventory-with-free-spreadsheet/
- WISK vs BevSpot: https://wisk.ai/vs/wisk-vs-bevspot
- WISK vs Partender: https://wisk.ai/vs/wisk-vs-partender
- WISK item weights help: https://help.wisk.ai/en/articles/3286786-how-to-add-remove-an-item-weight
- Partender listing: https://www.sourceforge.net/software/product/Partender
- WSET L2 wines SAT: https://www.WSETglobal.com/media/13156/wset_l2wines_sat_en_may2023_issue2.pdf
- WSET L3 wines SAT: https://www.WSETglobal.com/media/11766/wset_l3wines_sat_en_may2022_issue2.pdf
- WSET L3 spirits SAT: https://www.WSETglobal.com/media/10098/wset_l3spirits_sat_en_may2019-issue1.pdf
- WSET L2 spirits SAT: https://www.WSETglobal.com/media/11248/wset_l2spirits_sat_en_highres_may2022_issue2.pdf
- BJCP 2021 style guidelines: https://www.bjcp.org/bjcp-style-guidelines/ ; format: https://styles.bjcp.org/bjcp-2021-beer/introduction-to-the-2021-guidelines/format-of-a-style-description
- SCA flavor wheel: https://www.sca.coffee/research/coffee-tasters-flavor-wheel
- WCR sensory lexicon: https://worldcoffeeresearch.org/work/sensory-lexic
- Flavor wheel construction study: https://pmc.ncbi.nlm.nih.gov/articles/PMC5215420
- Sensory scales (pressbooks): https://pressbooks.pub/sensoryscience/chapter/define-scales
- DLG descriptive methods (QDA/Spectrum): https://www.dlg.org/en/food/topics/dlg-expert-reports/sensory-technology/sensory-analysis-overview-of-methods-and-application-areas
- Sensory descriptive tests overview: https://encyclopedia.pub/entry/20427
- Cocktail balance (WSET-style study guide): https://open-exam-prep.com/study-guides/wset-spirits-level-2/service-tasting-cocktails/cocktail-balancing-families
- Menu engineering matrix (Toast): https://pos.toasttab.com/blog/on-the-line/menu-engineering-matrix
- Menu engineering (Kasavana-Smith, FIU): https://digitalcommons.fiu.edu/record/18086/files/V19n22001d.pdf
- FDA food allergies: https://www.fda.gov/food/food-labeling-nutrition/food-allergies
- FASTER Act summary: https://www.fbm.com/maryjo-lopez-oneal/publications/the-faster-act-what-companies-need-to-know-about-the-new-food-allergy-law/
