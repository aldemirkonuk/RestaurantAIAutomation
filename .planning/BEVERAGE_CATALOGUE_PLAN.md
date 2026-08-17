# Beverage catalogue, display names, and blend data

Plan only — nothing here is built yet. Every number is measured against the
live library or the 26-menu corpus, not estimated.

**Companion document:** `.planning/BEVERAGE_CATALOGUE_ARCHITECTURE.md` holds the
design contract — global identity scope, the beverage merge policy, the
one-table/JSONB/view shape, **the promotion path to per-category 1:1 tables**,
the premortem, and the `is_wine` bug. This file stays the *what and in what
order*; that file is the *how, and how it is allowed to change later*.

> **Numbers corrected 2026-08-16.** The library is **4,160 rows**, not 2,443 —
> it grew after the corpus load. The non-wine population is **202**, not 342
> (342 was `menu_items`' row count, misattributed). References to those 202
> rows across all 15 FK tables: **0**, not 1. The `is_wine` mistag count is
> **7**, not 40 — but the underlying defect is broader than the count; see §2.0.

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
The 202 non-wine rows are referenced by **nothing**: a sweep of all 15 tables
with a foreign key into `master_wine_library` returns 0 rows pointing at them.
The migration in §2 costs almost nothing today. That zero is a window, not a
stable state — it rises every week restaurants add stock, price menu items or
map POS checks against these rows.

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

### 2.0 Blocker — the `is_wine` flag is a null-flag, not a classification

**Nothing in §2 may ship before this is fixed.** Full write-up in
`BEVERAGE_CATALOGUE_ARCHITECTURE.md` §6; the short version:

`load_enriched_wines.py:212` sets `"is_wine": bool(e.get("primary_type"))`. That
reads as "is this a wine?" but computes "did enrichment return a type?" — it
conflates *not a wine* with *the model could not classify it*. The proof is that
**all 202** `is_wine=false` rows carry `primary_type='unknown'`, without
exception: a sake and a Napa Cabernet are flagged identically because the model
returned nothing for both.

**7 actual wines** are mistagged today — BonAnno, Duc des Nauves, Frank Family
Vineyards, Heitz Cellar, Ink Grade, My Favorite Neighbor, Renaissance Vineyard,
all listed under a menu's `red` section. (I previously reported 40; 7 is the
measured figure.) The count is small; the defect is not, because it is *the
migration predicate*. Selecting on `is_wine=false` walks those 7 out of the wine
library, and the rule stays wrong for every future load.

Fix: split into `classification_status` and `beverage_kind`, fall back to the
menu's own section header when enrichment is silent, re-run over the 202,
log to `wine_repair_log`, add a regression test, and gate the migration on a
verified `beverage_kind` with a pre-migration assertion that zero wine-section
rows are in the migration set. Also backfill the 218 legacy rows where `is_wine`
is *absent*, so absent/false/unknown stop being three states every consumer has
to interpret.

### 2.1 Shape

**Decision: one `beverages` table + `beverage_type` + `type_attributes` JSONB,
with a per-category VIEW for each. No physical per-category tables.**

**Rows are globally shared, like wine** — one Hendrick's row for every
restaurant — **and identity is decided by a deterministic key, never by a
similarity threshold.** Measured on 732,874 pairs of provably-different products
(two entries on one menu are two products), no threshold separates true matches
from false ones: the worst true match scores 0.919 and the worst false pair
0.979, because the discriminating token is usually a *number* — worth ~2% of
string similarity and 100% of the identity. `Pappy Van Winkle 12` and `15` are
97.9% similar and $20 apart.

The rule that replaces it: **every non-brand token discriminates until a small,
closed, versioned equivalence says otherwise.** 0 false merges across all
732,874 pairs, strictly better than today's exact-signature rule on both error
axes. Its key property is that *incompleteness fails safe* — a gap in the
equivalence list costs a visible duplicate, never a silent global merge.
Full derivation, the retired first draft and why it failed, the third failure
class (under-identified rows), and the CI gate are in architecture doc §3.

**Promotion to a real 1:1 table is deferred, not refused.** The view is the
contract, so promotion later swaps a view's implementation while its signature
stays byte-identical and nothing downstream changes. Objective triggers,
expand→migrate→contract mechanics, and the anti-patterns that would make
promotion impossible are in the architecture doc §4.3 — read it before adding
any per-category table.

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
1. **First, §2.0** — fix the `is_wine` semantics and the 7 mistagged wines.
   Hard prerequisite.
2. Create `beverages`, reusing the same normalizer/signature functions so the
   matcher, dedup and merge tooling work unchanged on it.
3. Per-category views (`whiskey`, `beer`, `sake`, …) flattening
   `type_attributes`, plus a GIN index on it. **Generate them from the
   `beverage_type_schema` registry**, not by hand, so adding a category
   attribute is one registry row rather than nineteen edited definitions.
   Add the CI grep that forbids reading `type_attributes` outside migrations
   and view bodies **in the same PR** — that guard is what keeps promotion
   possible (architecture doc §4.3).
4. `catalogue_items` view = wines ∪ beverages, for the places that genuinely
   need "everything" (search, menu display). One query surface, two physical
   tables, no duplicated rows.
5. Migrate the 202 (minus the 7, minus 35 cocktails ⇒ ~160) with the same
   snapshot → dry-run → apply → invariant-check discipline as the wine merges.
   No rows to repoint — the FK sweep found zero references.
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

*Not final — further items pending. Phase 1 has not started.*

| # | item | why this order | est. cost |
|---|---|---|---|
| **0a** | Land `datasets/merge_eval/` + `eval_merge_policies.py` as a CI gate | The gate must exist before anything it guards changes. **Already built** — see arch §3.1/§3.8 | — |
| **0b** | Co-occurrence guard on `find_library_duplicates` | Closes a live hazard: 18 of 19 today's `safe_to_merge` proposals are provably wrong. One predicate | — |
| **0c** | Quarantine the 357 under-identified rows | Six different Hermitage Blanc wines are stored identically; a dedup pass would delete five real wines | — |
| **0d** | Stop extraction writing appellations into `producer` | The durable fix for 0c | ~$0.30 re-extract |
| 1 | `display_name` + search | Fixes the visible "duplicates" complaint; touches nothing structural | — |
| 2 | Fix `is_wine` semantics + the 7 mistags (§2.0) | Hard prerequisite: it is the migration predicate, and it is wrong | — |
| 3 | Finish enrichment (2,099 wines) | Already paid for extraction; resumable | ~$4 |
| 4 | `beverages` + views + migrate ~160 | Cheapest now (**zero** FK references); cost grows weekly | — |
| 5 | Cocktails + recipes | Needs a second extraction pass | ~$1 |
| 6 | Blend research | Independent; can run any time | ~$22 |
| 7 | Autocomplete / sibling pre-fill | Product work, no research dependency | — |

## 7. Resolved, and still open

**Resolved 2026-08-16** (detail in `BEVERAGE_CATALOGUE_ARCHITECTURE.md`):

- **Whose data is `beverages`?** → **Global, like wine**, with a stricter
  identity contract than wine gets. Spirits repeat 6.2% across menus vs wine's
  1.0% and carry real UPCs; house/unbranded items are 2 of 829 rows, which
  killed the hybrid option. Arch §2–§3.
- **Where does sake go?** → **`beverages`, `beverage_type='sake'`, wine-shaped
  core.** Not the wine library — it is brewed from rice. The consequence is that
  `beverages` must carry `body`, `acidity`, `serving_temp_celsius` and
  `glass_type` as real columns, since all four apply to sake. Arch §4.5.

**Still open:**

- **Discriminator-parse coverage on spirits is unmeasured.** What share of 733
  spirit rows yield a clean `age_years` / `cask_finish` / `proof`? This sets the
  beverage auto-link threshold and is the leading indicator for the worst
  failure mode in the premortem (a global wrong merge). Measure before writing
  the matcher.
- **Barcode coverage is unmeasured.** The contract makes UPC authoritative, but
  menus don't print barcodes — if coverage is near zero at load time, that rule
  only pays off once distributor catalogues are joined, and conservatism carries
  the whole load until then.
- The 2,099 unenriched wines are loaded as extracted-only or not loaded at all;
  they need the enrichment pass before the `beverages` migration or they
  classify as `unknown` and land in the wrong population — §2.0's failure at
  10× the scale.
- **Order of work is not final** — more items to be added before phase 1 starts.
---

## 8. Architecture remediation register

Every architectural defect found so far, in one place: what is already wrong and
must be repaired, what is already fixed and must stay fixed, and what is not yet
wrong and must be prevented by construction. Detail for each lives in
`BEVERAGE_CATALOGUE_ARCHITECTURE.md` at the section named.

Ordered by *blast radius × how quietly it fails*, not by effort. Everything in
group A is live today.

### A. Already made — repair these

| # | defect | evidence today | fix | ref |
|---|---|---|---|---|
| **A1** | **Merge decides identity by similarity.** A score cannot separate `Pappy Van Winkle 12` from `15` (97.9% similar, $20 apart) — positive and negative distributions overlap, so no threshold exists | 212 false merges at 0.85 across 732,874 labelled pairs | Replace the *decision* rule with the deterministic residual-token key (0 false merges). Keep fuzzy for *candidate generation* only | arch §3.2, §3.4, §3.6 |
| **A2** | **`find_library_duplicates` proposes provably-wrong merges** | 200 of 289 proposals co-occur on one menu; **18 flagged `safe_to_merge`** | Add the co-occurrence predicate: no pair may be `safe_to_merge` if its rows appear on a single menu. Do **not** run the merge tool before this lands | arch §3.10 |
| **A3** | **357 under-identified rows.** Extraction wrote appellations into `producer`, so six different Hermitage Blanc wines are stored identically | 357 rows with `normalized_producer = normalized_name` | Quarantine: ineligible to merge, ineligible as a match target, flagged for re-extraction. Then fix the extraction prompt so `producer` never takes an appellation | arch §3.5 |
| **A4** | **`is_wine` is a null-flag wearing a classification's name.** It computes "did enrichment return a type", not "is this wine" | all 202 `is_wine=false` rows carry `primary_type='unknown'`; **7 real wines** mistagged; 218 rows have the flag *absent*, a silent third state | Split into `classification_status` + `beverage_kind`; fall back to the menu's own section header; backfill the 218; gate any migration on the verified kind, never on `is_wine` | arch §6 |
| **A5** | **Merge is destructive.** Attribute collapse loses the evidence that two rows were ever distinct, and un-merge has never been executed | `wine_merge_log` exists; no un-merge has ever run | Supersede + alias instead of overwrite; block merges on conflicting non-null attributes; repoint current references but never rewrite history; property-test un-merge | arch §3.7 |
| **A6** | **No CI gate on identity.** Precision was self-graded against probes I wrote, which cannot find errors I did not imagine | the independent label set found failures the probes missed | `eval_merge_policies.py` in CI; **false merges must be 0**, not "low". Every new menu strengthens it for free | arch §3.1, §3.8 |
| **A7** | **Non-wines live in a table named for wine.** 202 beer/sake/spirit/cocktail rows sit in `master_wine_library`, ~39 of its 88 columns meaningless to them | 202 rows, referenced by **0** of 15 FK tables — the cheapest this will ever be | Migrate to `beverages` after A4. The zero is a window, not a stable state | plan §2, arch §4 |
| **A8** | **Cocktails are catalogue rows.** No producer, vintage, SKU or purchasable unit; they already broke matching once when `producer` fell back to `name` | 35 rows | Own tables (`cocktails`, `cocktail_ingredients`), excluded structurally — not by category name alone | plan §3 |
| **A9** | **Three naming conventions; vintage unsearchable.** 194 rows lead with a year, 150 end in an ALLCAPS country, 409 embed the producer | searching "2016 Gravner" matches nothing today | Derived `display_name` + add it to `search_vector`; never rewrite `name`, which is a match key | plan §1 |
| **A10** | **2,099 wines unenriched**, so they classify as `unknown` and would land in the wrong population | corpus manifest | Finish the resumable enrichment pass *before* the beverages migration — otherwise A4 recurs at 10× scale | plan §6 |

### B. Already fixed — keep the guard, do not re-litigate

| # | was | why it stays fixed |
|---|---|---|
| **B1** | `stock_live` written by three uncoordinated actors | `inventory_lots` is the source of truth, `stock_live` a projection; `scripts/check_no_direct_stock_writes.sh` fails the build on regression |
| **B2** | `ON CONFLICT` against a **partial** unique index → 42P10, silently swallowed | **Verified clean today:** every upsert conflict target in `apps/api-gateway/src` was cross-checked against the 21 partial unique indexes in the database — none is backed only by a partial index. Worth a periodic re-check, not a task |
| **B3** | `raw_text` in the extraction prompt cost ~45% of output spend; names carried producer + vintage + region | prompt pins `name` to the cuvée only; `extract_menu_corpus.py` reads the prompt out of the service and **refuses to run** if it drifts |

### C. Not yet made — prevent by construction

These are cheap now and expensive later. Each has a guard that must ship *with*
the thing it guards, not after the first violation.

| # | the future mistake | guard | ref |
|---|---|---|---|
| **C1** | Something reads `type_attributes` directly, so a category can never be promoted without a four-repo change | CI grep forbidding it outside migrations and view bodies; grants on views, not the base table; no `type_attributes` in serializers | arch §4.3, P2 |
| **C2** | A promotion writes an attribute to both JSONB and the new table "during transition" — `stock_live` for the third time | Read path flips atomically at the view swap; the contract migration that drops the old keys is mandatory and separate; "keep both for now" is a blocking review comment | arch §4.3, P3 |
| **C3** | JSONB key sprawl — `age`, `age_statement`, `age_years` all written by different runs | `beverage_type_schema` registry; unregistered keys **rejected** at write, not tolerated; weekly drift report | arch §4.4, P4 |
| **C4** | Nine physical per-category tables built preemptively for categories of 4 and 9 rows | Promotion requires **two** objective triggers; a single hot JSONB key is answered with a GIN expression index first | arch §4.3 |
| **C5** | The review queue is never cleared, so "never auto-merge" degrades into "never merge" | Order by value (restaurants × price impact), show evidence inline, track queue age as a health metric. If unclearable, fix *generation* — never the decision rule | arch P10 |
| **C6** | A beer and a whiskey from one parent brand collide on the identity key | Add `beverage_type` to the key, or measure that it never happens, before the first multi-category load | arch §8 |
| **C7** | Global scope turns out wrong for house-made items | Accepted risk with a cheap exit: nullable `owned_by_restaurant_id` (NULL = global) needs no backfill. Measured at 2 of 829 rows; revisit above ~5% | arch P8 |
| **C8** | Parsed columns (`age_years`, `cask_finish`, …) get mistaken for the identity, reintroducing the enumeration failure | Their non-authoritative status is written into the **column comments** in the migration itself | arch §4.1 |

### The rule underneath all of it

Every entry above is the same mistake in a different costume: **a fact stored in
two places, or a decision made by a score where it should be made by a key.**
A1–A5 and C1–C3 are all one of those two. When a new design choice comes up, ask
which of the two it risks — that question has caught every defect in this
register.

