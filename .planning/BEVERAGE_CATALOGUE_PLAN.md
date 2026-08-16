# Beverage catalogue, display names, and blend data

Plan only — nothing here is built yet. Every number is measured against the
live library (2,443 rows) or the 26-menu corpus, not estimated.

---

## 0. What the measurements changed about the brief

Three of the five items turned out to be different problems than they looked.

**"There are many duplicates" — there are none.** Grouping every wine by
normalized (producer, name) finds 22 groups covering 46 rows. **All 22 are
purely vintage variants** — Château Pétrus 2004, 2006 and 2014 are three
bottles, not three copies. Zero groups contain a true duplicate. What makes
them look duplicated is that the UI renders `{wine.name}` alone, so all three
read "Chateau Petrus". This is a display bug, and §1 closes it.

**"Predict menus from location" — location barely predicts anything.**
Measured across the 26 menus (24 Chicago, 2 San Francisco):

| | mean overlap |
|---|---|
| two Chicago menus | **1.5%** (median 0%) |
| Chicago vs San Francisco | 0.14% |

Same-city is ~10× cross-city, so geography carries *a little* signal, but 1.5%
cannot support prediction. The pairs that actually overlap are **same
ownership**: Avli Taverna ↔ Avli on the Park 88%, Francesca's on Chestnut ↔
Mia Francesca 85%, Ema ↔ aba 23%. See §5.

**"Non-wines are in the wine library" — and they are free to move right now.**
Of the 342 non-wine rows, exactly **1** is referenced by `restaurant_inventory`
and **0** by `menu_items`, `inventory_lots` or submissions. The migration in §2
costs almost nothing today. It gets more expensive every week restaurants add
stock against these rows.

---

## 1. `display_name` — one canonical, fully descriptive name

**Problem.** Three naming conventions coexist: 194 rows start with a year, 150
end in an ALLCAPS country, 409 embed the producer inside `name`. The same wine
reads "2016 Gravner Ribolla Friuli-Venezia Giulia" on one row and "RIBOLLA
GIALLA" on another.

**Decision.** Keep the structured parts clean — they are what matching keys on,
and matching is currently at recall 1.000 / precision 1.000 — and add a
**derived `display_name`** carrying the full descriptive string.

```
display_name = <vintage> <producer> <cuvée> <region>
             = "2016 Gravner Ribolla Friuli-Venezia Giulia"
```

**Why not rewrite `name` itself.** `name` feeds `normalized_name`, which is a
match key. Verbose names reintroduce exactly the style split that made wines
unmatchable before (§8 of MENU_EXTRACTION_SCALE_PLAN). Deriving the display
string gets the UX without touching the key space.

**The non-obvious part.** 409 rows already contain the producer in `name`, so
naive concatenation yields "2016 Gravner **Gravner** Ribolla…". The suppression
rule already exists as `wineDisplayLabel()` in
`apps/api-gateway/src/vendor-intel/wine-identity.ts` — reduce the producer to
its distinctive words and omit it when the name already says them. Same for
region. Reuse it; do not write a second one.

**Tasks**
1. `wine_display_name(vintage, producer, name, region)` SQL function, mirroring
   `wineDisplayLabel()`. Strips a leading year and trailing ALLCAPS country
   from `name` first, so the composed string has one format.
2. `display_name` column, maintained by the existing
   `set_master_wine_library_search_vector` trigger (already fires on
   INSERT/UPDATE — extend it rather than adding a second trigger).
3. Add `display_name` to `search_vector`. **Vintage is currently not
   searchable at all** — searching "2016 Gravner" matches nothing today.
4. Return `display_name` from the wines API and render it wherever
   `{wine.name}` is rendered (`AddWineToInventoryModal.tsx:314` and siblings).
5. Parity test: `display_name` must never contain the same producer token
   twice, and must be non-empty for every row.

**Effect.** The 22 vintage-variant groups become visually distinct; three
conventions collapse to one; vintage becomes searchable. No matching change.

---

## 2. Beverage catalogue split

**Decision: one `beverages` table + `beverage_type` + `type_attributes` JSONB,
with a per-category VIEW for each. No physical per-category tables.**

Confirmed by audit against this codebase:

- **16 of 17** FK columns into `master_wine_library` are structurally
  beverage-generic (id + quantity/price/event). Only
  `vintage_substitution_rules` is wine-only.
- **~39 of 88 columns are wine-specific** (tannins, appellation, aromas,
  decanting, farming…), which is why a beer in that table is half NULL.
- `pos-hub.service.ts:328` already does `if (!it.is_wine) continue`, and
  `catalog-matcher.service.ts` hardcodes `is_wine: true`. **Non-wines are not
  wired into POS or inventory today**, so moving them breaks nothing live.
- Deep wine attributes appear nowhere in inventory, procurement, analytics or
  vendor-intel — only in the wines module and one isolated enrichment service.

**Why not a table per category (the original instinct).** A `whiskey_details`
row living *alongside* a `beverages` row for the same bottle is two
representations of one entity that drift independently. That is the exact
failure this codebase already paid to fix in inventory — `stock_live` written
by three uncoordinated actors, an "immutable" ledger nothing wrote to
(`.planning/INVENTORY_SOTA_PLAN.md` §1) — and it is *already recurring* in
`vendor_catalogue`, where a custom-provider row duplicates a curated row for
the same real vendor (`20260811010000_vendor_catalogue_match.sql`). Twice
burned is enough.

Since "ready for ML" means **a clean per-category dataset to export and train
on**, a VIEW answers it completely: `SELECT * FROM whiskey` yields a flat
whiskey table with whiskey columns, always current, with one physical row per
bottle. Nothing is lost — if one category later earns real query pressure
(indexed, constrained, joinable fields), promote **that one** category's JSONB
into a 1:1 table keyed on `beverages.id`. Not all nine preemptively.

**Shape**

```
beverages
  id, beverage_type, name, display_name, producer, brand,
  country, region, abv_pct, volume_ml, package_format,
  price_reference, barcode/sku/upc, embedding,
  library_tier, review_status, field_confidences, data_enrichment,
  signature_hash, normalized_name, normalized_producer,   -- same matcher
  type_attributes jsonb                                    -- category specifics
```

Per-category attributes to model in `type_attributes` (none exist today):

| type | n | attributes |
|---|---|---|
| whiskey/scotch | 60 | mash bill, age statement, cask type/finish, proof, chill-filtered, single-barrel vs blend |
| beer | 48 | style, IBU, ABV, format, fermentation |
| sake | 39 | seimaibuai, SMV, brewery, junmai/ginjo/daiginjo |
| tequila/agave | 18 | agave type, blanco/reposado/añejo, NOM |
| gin | 17 | botanical bill, style, proof |
| rum | 11 | still type, aging, molasses vs cane, spiced |
| vodka | 10 | base material, distillation count, filtration |
| amari | 9 | botanical bill, bittering agent, proof |

**Tasks**
1. **First, fix 40 misclassifications.** 40 rows are tagged `is_wine=false` but
   their menu category is red/white/rosé/sparkling. My loader set `is_wine`
   from "did the model return a primary_type", which conflates *not a wine*
   with *model could not classify*. Those stay in the wine library.
2. Create `beverages`, reusing the same normalizer/signature functions so the
   matcher, dedup and merge tooling work unchanged on it.
3. Per-category views (`whiskey`, `beer`, `sake`, …) flattening
   `type_attributes`, plus a GIN index on it.
4. `catalogue_items` view = wines ∪ beverages, for the places that genuinely
   need "everything" (search, menu display). One query surface, two physical
   tables, no duplicated rows.
5. Migrate the 342 (minus the 40, minus cocktails) with the same
   snapshot → dry-run → apply → invariant-check discipline as the wine merges.
   Repoint the single referencing inventory row.
6. Extend `merge_library_wines` and `find_library_duplicates` to `beverages`,
   or generalise them — non-wines will accumulate duplicates the same way.

---

## 3. Cocktails are recipes, not catalogue rows

35 cocktails ("Out of Office", "The Benito", "Dove Va Negroni") have no
producer, no vintage, no SKU and no purchasable unit. They were also the rows
that broke matching — five wines could not match themselves because
`producer` fell back to `name` while `normalized_producer` stayed empty.

**Decision.** Out of the catalogue, into their own structure, **categorised by
recipe**:

```
cocktails            id, restaurant_id, name, menu_section, method,
                     glass, garnish, price, description
cocktail_ingredients cocktail_id, beverage_id | wine_id | free_text,
                     quantity, unit
```

`cocktail_ingredients` pointing at `beverages.id` is what eventually makes a
poured cocktail deplete its base spirit — the thing that makes a cocktail menu
worth having rather than decorative. Recipes are not in the extracted data;
they need a separate extraction pass over the cocktail sections.

---

## 4. Blend percentages — tier-A sources only

**Decision.** Record a blend **only** when found on the producer's own
site/tech sheet (tier A in `SOURCE_TIER_DOMAINS`), stored with its citation and
the vintage it applies to. No model guessing.

The research agent already tiers sources and treats the producer's domain as
tier A, but `RESEARCH_PRIORITY_FIELDS`
(`services/agent-orchestrator/services/research_agent_helpers.py:71`) covers
`grape_variety` and **not** blend percentages. This is a new researched field.

**Tasks**
1. Add `grape_blend_pct` to the researched fields, with a parser for
   "Cabernet Sauvignon 60%, Merlot 30%, Cabernet Franc 10%".
2. Validate: components sum to 90-100%, every named grape appears in
   `grape_variety`, percentages are 0-100.
3. Populate `grape_blend_info` (already a column, currently 0/2,443) as
   `{grape, pct_min, pct_max, source_url, source_tier, vintage}`.
4. Scope: the **561** wines whose `grape_variety` already lists more than one
   grape. At the $0.04/record ceiling that is **~$22**.
5. Expect low coverage and report it honestly — most producers never publish a
   blend, and a blend changes every vintage. A null here is the correct answer,
   not a gap to fill.

---

## 5. Menu prediction — reframe, do not build as proposed

The proposal was: predict a new restaurant's list from nearby restaurants and
skip extraction. Two measurements argue against it.

**Geography does not predict.** 1.5% mean overlap between Chicago menus. The
predictive signal is **ownership** (85-88% between sibling restaurants), which
is a much smaller and more obvious population.

**Extraction is not where the money is.** Extraction cost **$2.60 for 305
pages** — about $0.10 per menu. Predicting it away saves ~$100 across 1,000
restaurants. Enrichment is the $12,000 line, and library matching **already**
bypasses it: Piccolo Sogno went from 0% to **88%** auto-link once the corpus
was loaded. That is the same saving the RAG idea was aiming at, already
banked.

And extraction cannot be skipped in principle: you cannot bill a restaurant for
inventory you guessed. The menu is the ground truth.

**What is worth doing instead**, cheaply:
- **Autocomplete on manual entry** from the 2,443-row library — helps the
  worst UX in the product, no prediction needed.
- **Sibling-restaurant pre-fill** when a group signs up its second location:
  offer the sibling's list to confirm rather than re-upload. 85-88% accurate,
  and it is a confirmation flow, not a guess.
- **Distributor availability** as the honest version of "what will they carry"
  — territory constrains what a restaurant *can* buy, which is a real signal
  the vendor-catalogue work already touches.

None of this needs a separate branch yet.

---

## 6. Order of work

| # | item | why this order | est. cost |
|---|---|---|---|
| 1 | `display_name` + search | Fixes the visible "duplicates" complaint; touches nothing structural | — |
| 2 | Fix the 40 `is_wine` misclassifications | Must precede any migration or 40 wines leave the wine library | — |
| 3 | Finish enrichment (2,099 wines) | Already paid for extraction; resumable | ~$4 |
| 4 | `beverages` + views + migrate 342 | Cheapest now (1 referencing row); cost grows weekly | — |
| 5 | Cocktails + recipes | Needs a second extraction pass | ~$1 |
| 6 | Blend research | Independent; can run any time | ~$22 |
| 7 | Autocomplete / sibling pre-fill | Product work, no research dependency | — |

## 7. Open

- **Whose data is `beverages`?** Wine is global/shared. Are beers and spirits
  equally shared, or restaurant-scoped? Affects whether dedup applies.
- **Sake sits oddly.** Brewed, vintage-less, but sold like wine and 39 rows
  strong. It may belong in the wine library's shape more than the spirits'.
- The 2,099 unenriched wines are loaded as extracted-only or not loaded at all;
  they need the enrichment pass before `beverages` migration to classify
  correctly.
