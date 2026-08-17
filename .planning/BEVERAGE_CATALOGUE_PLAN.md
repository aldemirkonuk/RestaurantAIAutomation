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

**Done 2026-08-17.** Full write-up in `BEVERAGE_CATALOGUE_ARCHITECTURE.md` §6;
short version and what shipped:

`load_enriched_wines.py:212` sets `"is_wine": bool(e.get("primary_type"))`. That
reads as "is this a wine?" but computes "did enrichment return a type?" — it
conflates *not a wine* with *the model could not classify it*. Proof: **every**
`is_wine=false` row carries `primary_type='unknown'`, without exception, at
every count taken during this build.

**The row count moved under us while this was being fixed** — a real,
instructive fact about this being a live, shared database, not a snapshot.
`is_wine=false` was 202 when first measured, then **671** by the time this item
was reached (total library size unchanged at 4,160 — concurrent enrichment
activity elsewhere in the system reclassified rows, not new rows arriving). The
mistag count moved with it: **8** real wines, not the 7 first reported — Vin
Santo Chianti Classico (Felsina) was the eighth, filed under `red` like the
other seven. This is exactly why the fix is a **trigger-maintained
classifier**, not a one-time correction of specific IDs: it has to be correct
regardless of which rows currently hold which state.

Shipped: `beverage_kind` (`wine | beer | spirit | sake | cider | cocktail |
non_alcoholic | unknown`) and `classification_status`
(`classified | unclassified`), both auto-maintained by
`trg_wine_beverage_kind`, by precedence — real `primary_type` (never `unknown`,
since that column has only ever held wine styles) > the menu's own section
header (`wine_classify_beverage_kind()`, keyword-matched with spirit/beer/sake/
cocktail/cider checked *before* the wine keywords, so an ambiguous word like
"dessert" in "brandy & dessert" doesn't misfire — caught by testing, not
assumed) > `unknown`. All 8 mistags logged to `wine_repair_log`
(`repaired_by='20260817060000_beverage_kind_classification.sql'`). Regression
check: `scripts/check_beverage_kind_regression.py` — passing, 0 wine-section
rows misclassified across the live library. `is_wine` itself is left inside
`data_enrichment` for backward compatibility but **must never be the migration
predicate again**; `beverage_kind` is.

The 218 legacy `is_wine`-absent rows are covered by the same trigger — they now
carry a real `beverage_kind` (derived from their own `primary_type`, all wine)
rather than a third, silent "absent" state.

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

**Tasks — done 2026-08-17, with corrected numbers and two deliberate scope
cuts, both explained below.**

1. ~~First, §2.0~~ — **done**, see §2.0.
2. ~~Create `beverages`~~ — **done.** `identity_key`/`identity_status` use a
   **new** function (`beverage_identity_key`), not the wine matcher —
   correct, per arch §3.4: beverages need the deterministic residual-token
   key, not word-similarity. Verified **byte-identical** to the validated
   Python reference (`scripts/eval_merge_policies.py`) across all 4,822
   corpus entries (`scripts/check_beverage_identity_parity.py`) — a first
   attempt reused `wine_normalize_text` for tokenizing and it silently
   diverged on 67 entries (abbreviation expansion — "St."→"saint" — that the
   validated Python version doesn't do); caught by the parity check before
   shipping, not assumed correct.
3. ~~Per-category views~~ — **shipped 2 of 9** (`whiskey`, `beer`), not all
   nine via a `beverage_type_schema` registry. **Deliberate cut**:
   `type_attributes` is empty (`{}`) on all 608 migrated rows — no
   beverage-specific enrichment has run yet — so a full registry-generated
   set of 9 views extracting named JSONB keys would be extracting nothing,
   the exact "infrastructure for data that doesn't exist" this plan refuses
   elsewhere (arch §4.2, §9.4). The 2 shipped are the worked template;
   adding a category is a small, mechanical migration once it has real
   attribute data. **The CI grep guard shipped** (`scripts/check_no_direct_
   type_attributes_access.sh`, wired into `.github/workflows/ci.yml`), plus a
   column-level `REVOKE`/`GRANT` at the database layer for the `authenticated`
   role — both landed in the same migration as the table, not after a
   violation.
4. ~~`catalogue_items` view~~ — **done.**
5. ~~Migrate ~160~~ — **608 rows migrated**, not ~160. The population moved
   during this build the same way the `is_wine`/mistag counts did (§2.0) —
   live, shared database, concurrent enrichment activity, not new rows
   arriving. Snapshot → dry-run → apply → invariant-check
   (`scripts/migrate_beverages.py`), **non-destructive**: source rows are
   soft-deleted (`deleted_at`), never hard-deleted — checked first, and
   correctly: `wine_repair_log.wine_id` has `ON DELETE CASCADE`, so a hard
   delete would have silently destroyed the audit trail for 15 rows'
   worth of prior repairs. New `beverages` rows reuse the source row's `id`
   for traceability. Verified independently post-migration: `beverage_kind`
   census on `master_wine_library` now shows only `wine`(3,497) and
   `cocktail`(55); `beverages` holds exactly 608 with 0 null identity keys.
6. ~~Not done — extending `merge_library_wines`/`find_library_duplicates` to
   `beverages`~~ — **done 2026-08-17.** `find_beverage_duplicates()`,
   deliberately **simpler** than the wine finder: a direct `GROUP BY
   identity_key` rather than trigram candidate-generation-then-classify.
   Not a shortcut — the right shape given what's different: wine's finder
   needs candidate generation because word-similarity is approximate;
   `beverage_identity_key` isn't (0 false merges, measured). Equal key
   already **is** the decision, so grouping has 100% recall with 0 false
   positives, for free. Same co-occurrence guard as 0b. **Verified against
   the live 608-row population**: 23 candidate pairs, 10 `safe_to_merge`
   (genuine extraction-artifact duplicates — "Hennessy"/"VSOP" vs
   "Hennessy"/"Hennessy VSOP", correctly matched even across a diacritic
   difference, "Añejo" vs "Anejo"), 13 blocked by co-occurrence. Some
   blocked pairs look like the *same* extraction artifact that also
   happens to appear twice on one menu — left blocked anyway, on purpose:
   the guard errs toward a false split (cheap, visible, a human clears it
   in seconds) over a false merge (the failure mode this whole build
   exists to prevent), consistent with §3.9's ~100:1 cost ratio.

---

## 3. Cocktails are recipes, not catalogue rows

**Done 2026-08-17.** **55 cocktails** migrated (not 35 — same live-database
drift as §2.0/§2.1's counts), not 35 ("Out of Office", "The Benito", "Dove Va
Negroni" among them) — no producer, no vintage, no SKU, no purchasable unit.
They were also the rows that broke matching — five wines could not match
themselves because `producer` fell back to `name` while `normalized_producer`
stayed empty.

`cocktails` + `cocktail_ingredients` created; 55 rows moved out of
`master_wine_library` with the same snapshot → dry-run → apply →
invariant-check discipline as §2.1 (`scripts/migrate_cocktails.py`),
soft-delete not hard-delete, source id reused. Verified independently:
`master_wine_library`'s `beverage_kind` census is now **wine only** —
non-wine content of every kind (spirits, beer, sake, cocktails) has fully
left the wine library. `restaurant_id` is nullable and left NULL for this
batch — checked first: none of the 26-menu demo corpus these rows come from
maps to a live `restaurants` row (11 real restaurants exist; corpus
provenance is a PDF filename, not a restaurant_id). `catalogue_items`
extended to union all three tables — 3,660 total rows across wine (3,497) +
beverages (608) + cocktails (55).

`cocktail_ingredients` is empty and stays empty — recipes were never
extracted (see below, unchanged from the original plan).

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

**Blocked 2026-08-17, not attempted separately.** Runs through the research
agent's own Anthropic API calls — the same account whose credit balance was
confirmed exhausted while working A10 immediately before this item. Not
re-tested independently since the constraint is already confirmed and shared;
this needs the same billing top-up as A10, then can run on its own schedule
(it doesn't depend on A10 finishing first).

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
| ~~N1~~ | ~~Persist POS food lines~~ — **withdrawn 2026-08-17, verified false.** Already persisted at `pos-hub.service.ts:168/202` and already consumed by `getBasketAffinity`. No code change; see register A11/A15 | — | — |
| **N2** | Log recommendation **impressions** (shown, position, not-chosen) | Must exist before the first recommendation is ever displayed, or the first model trains on its own output | — |
| **N3** | Stamp `observed_at` on enrichment writes | Point-in-time correctness cannot be retrofitted | — |
| **N4** | Preserve provenance through every projection | 76% of the library is `inferred`; one careless flatten loses the label | — |
| **0a** | Land `datasets/merge_eval/` + `eval_merge_policies.py` as a CI gate | The gate must exist before anything it guards changes. **Already built** — see arch §3.1/§3.8 | — |
| **0b** | Co-occurrence guard on `find_library_duplicates` | Closes a live hazard: 18 of 19 today's `safe_to_merge` proposals are provably wrong. One predicate | — |
| **0c** | Quarantine the 357 under-identified rows | Six different Hermitage Blanc wines are stored identically; a dedup pass would delete five real wines | — |
| **0d** | Stop extraction writing appellations into `producer` — **done 2026-08-17.** `WINE_EXTRACTION_PROMPT` now teaches the model to tell a place from a producer explicitly (Hermitage/Cornas/Côte-Rôtie → `region`, producer omitted, never duplicated); prefers omission over a guess. Drift guard + tsc verified | The durable fix for 0c | $0 (prompt-only) |
| 0d-2 | **Retroactively fix the 334 already-quarantined rows.** Not yet done. **Cost estimate corrected**: they span 21 of 26 menus (RL Restaurant 60, Obelix 53, aba 35, …), not the 2–3 assumed when "~$0.30" was written — a full re-extraction is closer to **~$2**. Quarantine (0c) already makes these rows harmless in the meantime: excluded from merge and fuzzy-match, so there is no urgency cost to deferring this | Rows are safe as quarantined; this is cleanup, not a blocker | ~$2 re-extract, or a cheaper text-only reclassification pass against the already-extracted region field before re-spending on image OCR |
| **0e** | Stamp `observed_at` on enrichment writes; never drop provenance in a projection | **Impossible to backfill.** 76% of the library is `inferred`; losing that label makes every future model train on our own guesses | — |
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
| ~~A4~~ | ~~`is_wine` is a null-flag wearing a classification's name~~ — **done 2026-08-17.** `beverage_kind`/`classification_status`, trigger-maintained, precedence classifier. 8 mistags found (count moved 7→8 as the live library changed under this fix) and logged to `wine_repair_log`. `scripts/check_beverage_kind_regression.py` passing | was: all `is_wine=false` rows carry `primary_type='unknown'`, no exception | §2.0 for the full account, including the mid-fix row-count shift | arch §6 |
| ~~A5~~ | ~~Merge is destructive~~ — **done 2026-08-17.** `merge_library_wines()` now soft-deletes the loser (`deleted_at` + new `superseded_by`) instead of `DELETE`, records a `wine_aliases` entry so a lookup by the loser's old identity redirects to the keeper, and blocks outright on a non-null vintage disagreement between keeper and loser — checked before this, no existing code calls the function, so nothing needed updating for the new soft-delete shape; every read path already filters `deleted_at IS NULL`. **`merge_library_wines_undo()` is new** — real merge→undo round trip executed against a live synthetic pair (not asserted): vintage guard fired correctly on a mismatch, merge soft-deleted + aliased, undo restored the row and removed the alias, verified by direct query after each step. **Scoped honestly, not oversold**: undo reverses the catalogue-level decision only — it does not reverse the FK repoints (inventory moves, reference repoints) from the original merge, since today's audit log records `table.column` and a row count, not row ids, so that reversal isn't automatically derivable | verified live: vintage guard blocks correctly; merge→undo round-trips cleanly | `merge_library_wines_undo()`, `superseded_by` column | arch §3.7 |
| **A6** | **No CI gate on identity.** Precision was self-graded against probes I wrote, which cannot find errors I did not imagine | the independent label set found failures the probes missed | `eval_merge_policies.py` in CI; **false merges must be 0**, not "low". Every new menu strengthens it for free | arch §3.1, §3.8 |
| **A7** | **Non-wines live in a table named for wine.** 202 beer/sake/spirit/cocktail rows sit in `master_wine_library`, ~39 of its 88 columns meaningless to them | 202 rows, referenced by **0** of 15 FK tables — the cheapest this will ever be | Migrate to `beverages` after A4. The zero is a window, not a stable state | plan §2, arch §4 |
| **A8** | **Cocktails are catalogue rows.** No producer, vintage, SKU or purchasable unit; they already broke matching once when `producer` fell back to `name` | 35 rows | Own tables (`cocktails`, `cocktail_ingredients`), excluded structurally — not by category name alone | plan §3 |
| **A9** | **Three naming conventions; vintage unsearchable.** 194 rows lead with a year, 150 end in an ALLCAPS country, 409 embed the producer | searching "2016 Gravner" matches nothing today | Derived `display_name` + add it to `search_vector`; never rewrite `name`, which is a match key | plan §1 |
| **A10** | **2,099 wines unenriched.** **Blocked 2026-08-17 — not skipped.** Anthropic API credit balance exhausted, confirmed via a live trial call (`HTTP 400 invalid_request_error`, "credit balance is too low"). Cannot be resolved by an agent — needs the user to top up billing; entering payment details is explicitly outside what an agent may do. **The original warning ("A4 recurs at 10× scale") is already mitigated, independent of this being blocked**: verified live that currently-unenriched rows (`primary_type='unknown'`) already classify `beverage_kind='wine'` correctly via the menu_category fallback built into §2.0's classifier — the fear was that unenriched rows would misclassify and get swept into `beverages`; they don't, by construction, regardless of enrichment status. **Ready to resume the moment credits return**: a wine-only filtered subset was built and verified — 1,448 of the 2,099 classify as `wine` via `wine_classify_beverage_kind()` (the same validated classifier, not a new keyword list), spirits/beer/sake/cocktail items correctly excluded so budget isn't spent enriching items headed for `beverages` anyway. **One real incident during the trial, caught and fixed immediately**: the trial run's `--out` pointed at the live `datasets/menu_corpus/enriched/` directory, and the script overwrote `enriched.json` down to 3 entries (the trial's own tiny subset) rather than merging with the existing 4,499 — a real data-loss bug in how I invoked it, not in the script's own logic. Caught by checking the file immediately after the failure rather than assuming success; `git checkout` restored all 4,499 entries and 2,099-unenriched count exactly. **Before re-running**: either point `--out` at a scratch directory and merge results back deliberately, or confirm the resume-merge behavior more carefully first | corpus manifest; verified live: 0 miscategorization risk from staying unenriched | Resume with `--in <wine-only filtered dir>`, budget ≈ `$4 × (1448/2099)` ≈ **$2.76** | plan §6 |
| ~~A11~~ | ~~POS discards every food line~~ — **false alarm, corrected 2026-08-17.** `pos-hub.service.ts:168` `.map()`s every line (wine and food) into `pos_checks.items`, upserted unconditionally at line 202. The `if (!it.is_wine) continue` at line 328 runs *after* persistence and only gates stock-depletion RPCs — it was misread as an ingestion filter. A consumer already exists: `table-analytics.service.ts:416` `getBasketAffinity()` reads `c.items` with no `is_wine` filter and runs lift-based market-basket pairing over every item name today | verified by reading both files directly, not by report | **No code change.** One clarifying comment at line 328. See A15 for the real gap this surfaced | — |
| **A15** | **No stable dish identity.** `pos_checks.items[].name` is a raw POS string — "Ribeye 12oz" and "Ribeye" are different entities to any grouping query. Pairing wine X to dish Y needs Y to be stable, and no table-shape decision fixes this | `menu_items` is wine-only; no dish/recipe entity anywhere | Product-scope question, not a schema fix — needs a decision on whether/how to canonicalize dish names before a learned pairing model is worth building | arch §10.2 |
| **A12** | **Sensory data has two homes.** Typed `acidity`/`tannins`/`texture`/`finish`/`primary_aromas` populated on **0** rows; values live in JSONB | `wine_structure` 3,350, `sensory_profile` 3,626 | Pick one — backfill the columns and derive the JSON, or drop the columns and add expression indexes. Choosing matters more than which | arch §10.3 |
| ~~A13~~ | ~~`embedding` indexed but empty~~ — **done 2026-08-17.** 3,497 wines + 608 beverages, 100% coverage, via `sentence-transformers/all-MiniLM-L6-v2` (already a configured dependency — `EMBEDDING_MODEL`/`EMBEDDING_DIMENSION` in `.env`, and a stub in `wine_matcher.py` that had never been wired up). Local inference, no API cost, ~15 min for all rows. Verified with a real nearest-neighbour query, not just a non-null count: querying a Champagne row's embedding surfaces the same "Blanc de Noirs" style first, then a genuine Champagne-house cluster | 3,497/3,497, 608/608 | `scripts/populate_embeddings.py` | arch §10.4 |
| **A14** | **No person identity anywhere.** A schema-wide search for `guest`/`customer`/`diner`/`loyalty`/`party` returns nothing | — | Not a bug to fix — a scope limit to state. Individual likeability is unreachable; the ladder tops out at **server** (`pos_checks.server_name`), which is already captured | arch §10.5 |

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
| **C9** | A wide "ML table" gets built **and written to**, because an analyst needed a column — `stock_live` with a data-science hat, at larger scale | One-way flow; the analytical layer must be droppable and rebuildable from source, and that is the acceptance test | arch §9.1 |
| **C10** | A flattened ML export drops `field_confidences` / `knowledge`, so **76% inferred values** are trained on as fact | Every ML feature carries its provenance beside it; training sets declare which tiers they accept | arch §9.3 |
| **C11** | A model is trained on today's enriched attributes against last quarter's sales — scores well offline, fails in production | `observed_at` stamped at write time. Cannot be retrofitted: the history was never recorded | arch §9.3 |
| **C12** | `price_reference` on a global row gets averaged into a report as if it were a restaurant's price | It is a market hint only — prices are relationship outcomes and live in the five scoped tables. Put the caveat in the column comment | arch §9.0 |

### The rule underneath all of it

Every entry above is the same mistake in a different costume: **a fact stored in
two places, or a decision made by a score where it should be made by a key.**
A1–A5 and C1–C3 are all one of those two. When a new design choice comes up, ask
which of the two it risks — that question has caught every defect in this
register.

---

## 9. Now-or-never captures (added after the ML fitness review)

`BEVERAGE_CATALOGUE_ARCHITECTURE.md` §10 grades the structure against the actual
goal — pairing to meals and ingredients, preference tendency, instant search.
The item side is strong. Four captures lose data permanently for every day they
are not in place, and they jump the queue for that reason alone.

| # | capture | cost | why it cannot wait |
|---|---|---|---|
| ~~N1~~ | ~~Persist POS food lines~~ — **corrected 2026-08-17, verified against source, no longer on this list.** They already are: `pos-hub.service.ts:168` maps every line, wine and food, into `pos_checks.items`, upserted unconditionally at line 202. `table-analytics.service.ts:416` already runs lift-based basket pairing over them with no `is_wine` filter. The `is_wine` skip at line 328 only gates stock RPCs and runs after persistence. See register A11/A15 | — | — |
| **N2** | **Log impressions**, not just conversions — what was recommended, in what position, and what was not chosen | small | Without it the first learned recommender trains on its own output. Offline metrics improve as it gets worse (arch §10.6 M1) |
| **N3** | **`observed_at`** on enrichment writes | small | Point-in-time correctness cannot be retrofitted; the history was never recorded |
| **N4** | **Preserve provenance** through every projection | discipline | 76% of the library is `inferred`; the label is one careless flatten from gone |

The two live sensory/embedding defects the fitness review surfaced are tracked
once, in the register at §8 (**A12**, **A13**) — not duplicated here.

### What is reachable, stated plainly

- **Pairing** — reachable in two stages. Rules over the sensory axes *now*
  (3,350 bottles already carry them, no labels needed, and it is explainable
  enough for a sommelier to accept); a learned model *after* N1 has accumulated
  co-occurrence. Stage 1 generates what stage 2 needs.
- **Ingredients** — not reachable yet; no ingredient entity exists. Use the dish
  *name* as the unit first and only decompose if dish-level proves insufficient.
- **Person-level likeability** — **not reachable, and should not be promised.**
  No guest identity exists anywhere in the schema. What *is* available today:
  restaurant profile, day-part, party size (`pos_checks.covers`), table/check,
  and **server** (`server_name`, `server_external_id`) — the last being the
  sleeper, since it is how wine actually gets sold and it is already captured.

