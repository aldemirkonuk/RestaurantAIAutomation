# Beverage catalogue — architecture, identity contract, and the promotion path

**Status:** design contract. Nothing here is built. This document is the
authority for *how* the beverage catalogue is shaped and how it is allowed to
change later; `BEVERAGE_CATALOGUE_PLAN.md` is the authority for *what order*
the work happens in.

**Audience:** whoever picks up phase 4 (`beverages` migration) and — more
importantly — whoever, twelve months from now, wants to promote a category out
of JSONB into its own table. §4 exists entirely for that person.

Every number below was measured against the live database on 2026-08-16. Where
a number supersedes one I stated earlier in planning, the correction is called
out inline rather than quietly swapped.

---

## 1. Measured baseline

| fact | value | note |
|---|---|---|
| live library rows | **4,160** | supersedes "2,443" — the library grew after the corpus load |
| `is_wine=true` | 3,740 | |
| `is_wine=false` | **202** | the migration population |
| `is_wine` absent | 218 | legacy seed (`wineops_basic_v1` 153, `sim` 64, 1 null) — pre-corpus, all wine |
| FK tables referencing `master_wine_library` | 15 | swept individually |
| **references to the 202 non-wine rows** | **0** | supersedes "1 referencing inventory row" |

The "342 non-wines" figure used in earlier planning was wrong: 342 is the row
count of `menu_items`, which I misattributed. The real non-wine population is
**202**, and it is referenced by nothing at all.

Non-wine rows by menu section:

```
 43 beer          16 gin        8 tequila     4 amari            2 cider
 39 sake          10 rum        8 whisk(e)y   4 signature cktl   2 brandy&dessert
 35 cocktail       9 vodka      7 red  ←bug   3 spirit free      2 tequila/mezcal
                                6 agave                          2 whiskey
                                                                 + 3 singletons
```

**Migration cost is at its global minimum right now and rises monotonically.**
Zero FK references is not a stable state — it is a window. Every restaurant
that adds stock, prices a menu item, or matches a POS check against one of
these rows converts a delete-and-reinsert into a repointing exercise with live
data behind it.

---

## 2. Decision 1 — identity is global; availability, price and recipe are scoped

**Resolved.** Beverage rows are globally shared, exactly like wine. One
`Hendrick's Gin` row serves every restaurant.

This is not a new axis. The schema already splits product identity from
restaurant facts for wine: `master_wine_library` holds the product,
`restaurant_inventory` / `menu_items` / `inventory_lots` hold what one
restaurant stocks and charges. Beverages inherit that split unchanged.

### Why global, on evidence

Cross-menu repetition across the 26-menu corpus, measured on (producer, name):

| bucket | rows | mean cross-menu overlap |
|---|---|---|
| wine | 3,945 | 1.0% |
| **spirits** | **733** | **6.2%** |
| beer | 102 | 1.3% |
| sake | 42 | (2 menus only) |

Spirits repeat **6× more than wine**. Tito's appears on 6 of 26 menus;
Hendrick's, Grey Goose and Ketel One on 5; Woodford, Campari, Maker's Mark and
Don Julio on 4. Branded bottles also carry real UPC/EAN — columns that already
exist (`upc`, `ean`, `sku`, `barcode`) — so identity resolution for spirits can
be an exact key join rather than the trigram work wine needed.

Beer's 1.3% is low, but that reflects assortment churn (craft rotates), not
identity ambiguity. Guinness Draught is one product worldwide regardless of how
many menus list it.

### Why not the hybrid (global-if-branded, scoped-otherwise)

The hybrid exists to serve house pours and unbranded items. Measured on 829
real spirit/beer rows:

```
house / well / rotating / "ask your server"    2   (0.2%)
no producer at all                             1
```

Restaurants list branded bottles by name. The hybrid would buy a nullable owner
column, two code paths through every query, and a promotion policy for when a
scoped row turns out to be branded — to serve **two rows**. Rejected.

### The cost of going global, stated honestly

Global scope removes the per-restaurant blast radius. A wrong merge no longer
mis-states one restaurant's inventory; it mis-states everyone's simultaneously,
silently. **That is the price, and §3 is what buys it back.**

### Where scope genuinely is per-restaurant

Cocktails. A restaurant's Negroni recipe is its own. Cocktails carry
`restaurant_id` and live outside the catalogue entirely (plan §3).

---

## 3. Decision 2 — a stricter identity contract for beverages than wine gets

Scope and merge policy are separable decisions, and only the second one is
dangerous. Beverages are global *and* harder to identify than wine, so the
merge policy must be strictly more conservative.

### The problem, in the data

132 of 405 non-wine producers write the same brand more than one way:

```
macallan      → 'macallan 12', 'macallan 12 year', 'macallan 12yr sherry cask',
                'macallan 15', 'macallan 15 year'
the macallan  → 'classic cut 2017 release', '2017 5223 10', ...
balvenie      → 'balvenie 14yr caribbean cask', 'balvenie caribbean cask 14 year',
                'balvenie doublewood 12 year', 'balvenie portwood 21 year'
```

Two opposite forces are tangled in there:

- `macallan 12` and `macallan 12 year` — **one product**, two spellings → must merge.
- `macallan 12` and `macallan 12yr sherry cask` — **possibly two products** → must not merge.
- `macallan` and `the macallan` — two producer strings, one distillery. The
  trade-word machinery built for wine (`Dom.`, `Ch.`, `Bodega`, family guard)
  extends to `The`, `Distillery`, `Brewing Co.`, `Brouwerij` almost for free.

Wine's identity key is (producer, cuvée, vintage), and vintage is a clean
integer in its own column. A spirit's identity key is **(brand, expression, age
statement, cask finish, proof, size)** — and the last four sit inside free text.
`Don Julio 1942` is an expression name, not a vintage; the data-quality checker
already had to special-case it.

### The contract

1. **UPC/EAN is authoritative when present.** Equal barcode ⇒ same product, no
   fuzzy work, no review. This is a *stronger* key than wine ever gets.
2. **Default to distinct.** Wine proposes a merge on high similarity. Beverages
   merge only when every *present* discriminator agrees. Any discriminator that
   differs, or is absent on one side and present on the other, ⇒ separate rows.
   Duplicates are visible and cheap to fix; a wrong merge is invisible and
   global.
3. **Discriminators are columns, never JSONB.** See §4.1 — this is the rule
   that makes point 2 enforceable rather than aspirational.
4. **No auto-link.** Wine auto-links at confidence ≥ 85 (`AUTO_LINK_CONFIDENCE`).
   Beverages produce review-queue proposals only, until discriminator-parse
   coverage has been measured. Pick a threshold from that measurement; do not
   inherit 85 by default.
5. **Merges are logged and reversible.** `wine_merge_log` has a `beverages`
   equivalent, with the same snapshot → dry-run → apply → invariant-check
   discipline the wine merges used.

---

## 4. Decision 3 — one physical table, typed, with per-category views

```
beverages
  id, beverage_type, name, display_name, producer, brand,
  country, region, abv_pct, volume_ml, package_format,
  price_reference, barcode / sku / upc / ean, embedding,
  library_tier, review_status, field_confidences, data_enrichment,
  signature_hash, normalized_name, normalized_producer,   -- same matcher
  age_years, cask_finish, expression, proof,              -- identity-bearing (§4.1)
  type_attributes jsonb                                   -- descriptive only
```

Plus one view per category:

```sql
CREATE VIEW whiskey AS
SELECT id, name, display_name, producer, abv_pct, volume_ml,
       age_years, cask_finish, expression, proof,
       type_attributes->>'mash_bill'        AS mash_bill,
       (type_attributes->>'chill_filtered')::boolean AS chill_filtered,
       type_attributes->>'barrel_type'      AS barrel_type
FROM beverages WHERE beverage_type = 'whiskey';
```

`SELECT * FROM whiskey` yields a flat whiskey table with whiskey columns,
always current, ML-exportable — with **exactly one physical row per bottle**.

### 4.1 What goes in a column and what goes in JSONB

The split is **not** "common vs rare". It is:

| the attribute… | lives in | why |
|---|---|---|
| participates in identity / matching / dedup | **column** | §3.2 cannot enforce a rule against a value it can't constrain or index reliably |
| is referenced by a foreign key or a CHECK | **column** | JSONB cannot be an FK target |
| is filtered, sorted or joined at scale | **column** (promote when it happens — §4.3) | |
| is descriptive, or an ML feature only ever read as a block | **`type_attributes`** | |

`age_years`, `cask_finish`, `expression` and `proof` are promoted **on day one**
despite being whiskey-specific, because they are identity-bearing. Sake's
`seimaibuai` and `smv`, beer's `ibu`, gin's botanical bill are descriptive →
JSONB.

This rule is the whole reason the architecture is safe. A category whose
identity depends on an attribute that is buried in JSONB is a category whose
dedup silently doesn't work.

### 4.2 Why not nine physical tables now

A `whiskey_details` row living *alongside* a `beverages` row for the same bottle
is two representations of one entity that drift independently. That is the exact
failure this codebase already paid to fix in inventory — `stock_live` written by
three uncoordinated actors, an "immutable" ledger nothing wrote to
(`.planning/INVENTORY_SOTA_PLAN.md` §1) — and it is **already recurring** in
`vendor_catalogue`, where a custom-provider row duplicates a curated row for the
same real vendor (`20260811010000_vendor_catalogue_match.sql`). Twice burned is
enough to make it a rule rather than a preference.

Nine tables also means nine migrations, nine matchers, nine dedup paths, and a
nine-way UNION for every "search all drinks" query — paid up front, for
categories of 4 and 9 rows.

### 4.3 The promotion path — how a category earns a real 1:1 table

**This section is the point of the document.** The design is chosen so that
promotion is a *non-event*, and it only stays a non-event if the rules below are
respected from day one.

#### The load-bearing invariant

> **The view is the contract. The physical layout is an implementation detail.**

No application code, query, export, or model training script may read
`beverages.type_attributes` directly for a category that has a view. It reads
`whiskey`. Enforced by:

- `type_attributes` is not returned by any API serializer.
- A CI grep — same shape as `scripts/check_no_direct_stock_writes.sh`, which
  already guards the equivalent invariant for inventory — fails the build on
  `type_attributes` outside the migration and view definitions.
- Category views are `SECURITY INVOKER` and carry the grants; `beverages` itself
  is not granted to the API role for category-scoped reads.

Hold that invariant and promotion swaps the view's *implementation* while its
*signature* stays byte-identical. Nothing downstream changes. Break it — let one
export script reach into the JSONB — and promotion becomes a coordinated
multi-repo change, which is how "we'll promote it later" turns into "we never
promoted it".

#### Objective promotion triggers

Promotion is a measurement, not a taste call. Promote category *C* when **any
two** of the following hold:

| # | trigger | how to measure |
|---|---|---|
| T1 | A `type_attributes` key is in a WHERE/ORDER BY on a hot path | `pg_stat_statements`, ≥ 1% of category query time |
| T2 | A key needs a real constraint (NOT NULL, CHECK, enum, FK) | a data-quality rule keeps firing that JSONB can't prevent |
| T3 | The category exceeds ~5,000 rows **and** ≥ 3 keys are queried | row count + T1 across keys |
| T4 | A key must be an FK target (e.g. `distillery_id → distilleries`) | a real join requirement appears |
| T5 | JSONB key sprawl: > 15 distinct keys, or > 20% of rows carrying keys outside the registered schema (§4.4) | registry drift report |

One trigger alone is not enough — T1 on a single key is usually answered by a
**GIN expression index on that key**, which is a five-minute change and keeps
one physical row. Reach for the index first, every time.

#### Promotion mechanics (expand → migrate → contract; never dual-write)

Given category `whiskey` with view `whiskey`:

1. **Snapshot + freeze.** `CREATE TABLE _promo_whiskey_snapshot AS SELECT id,
   type_attributes FROM beverages WHERE beverage_type='whiskey'`. Record the row
   count and a checksum.
2. **Create the 1:1 table**, keyed on `beverages.id`, `ON DELETE CASCADE`, with
   a `UNIQUE (beverage_id)` — 1:1 must be enforced by a constraint, not by
   convention.
   ```sql
   CREATE TABLE whiskey_attributes (
     beverage_id uuid PRIMARY KEY REFERENCES beverages(id) ON DELETE CASCADE,
     mash_bill      text,
     barrel_type    text,
     chill_filtered boolean
   );
   ```
3. **Backfill** from `type_attributes` in one transaction. Assert
   `count(whiskey_attributes) = count(beverages WHERE beverage_type='whiskey')`.
4. **Swap the view.** `CREATE OR REPLACE VIEW whiskey AS SELECT … FROM beverages
   b JOIN whiskey_attributes w ON w.beverage_id = b.id WHERE b.beverage_type =
   'whiskey'`. **The column list and types must be identical to before.** A
   contract test asserts this by comparing `information_schema.columns` for the
   view against a committed fixture.
5. **Make the view writable** via `INSTEAD OF INSERT/UPDATE/DELETE` triggers, so
   writers that wrote through the view keep working unchanged.
6. **Contract.** In a *separate, later* migration — never the same one — drop the
   promoted keys from `type_attributes`. This is the step that guarantees a
   single source of truth. Until it runs, the old keys are stale copies, and the
   window between step 4 and step 6 is the only moment dual-bookkeeping exists.
   Keep it short and make it a tracked task, not a TODO.
7. **Verify.** Row counts match the snapshot; the view's column signature is
   unchanged; no row has a promoted key remaining in `type_attributes`; the
   category's dedup invariants still hold.

**Anti-patterns that must never happen:**

- *Dual-write.* Writing a promoted attribute to both `type_attributes` and
  `whiskey_attributes` "during transition". That is the exact `stock_live`
  failure. Step 4 flips the read path atomically; step 6 removes the old copy.
  There is no interval where both are authoritative.
- *Partial promotion.* Promoting some keys but leaving the category's other keys
  in JSONB **is fine and expected** — what is not fine is promoting a key and
  leaving a copy behind (that is the same anti-pattern as above).
- *Promoting the base table's columns.* `abv_pct`, `producer`, `name` etc. stay
  on `beverages`. `whiskey_attributes` holds only what was in JSONB. A promoted
  table that re-declares `producer` has forked the entity.
- *Category-specific FKs into the promoted table from outside.* Other tables
  reference `beverages.id`, never `whiskey_attributes.beverage_id`. Otherwise
  de-promotion becomes impossible.

#### De-promotion

If a promoted category turns out not to need its table (query pressure was
seasonal, the feature was cut), the same steps run in reverse: backfill JSONB
from the table, swap the view back, drop the table in a later migration. This is
only possible because of the "no outside FKs" rule above. Keep it possible.

#### Worked expectation

On the current 202-row population, **no category qualifies for promotion, and
none is close.** Whiskey is 8 rows. The realistic first candidate is beer or
whiskey at a few thousand rows once multiple restaurants' spirit lists are
extracted — likely 12–24 months out. Building nine tables today to serve that is
paying a certain cost now for an uncertain benefit later, which is the trade this
architecture exists to refuse.

### 4.4 Keeping JSONB from rotting

JSONB's real failure mode is not performance, it is **silent schema drift**: two
enrichment runs write `age` and `age_statement`, and nothing complains.

- `beverage_type_schema` registry table: one row per `(beverage_type, key)` with
  its JSON type, whether required, and an optional enum. Small, boring, and it
  is what makes T5 measurable.
- A CHECK constraint (or trigger) validating `type_attributes` against the
  registry on write. Unregistered keys are **rejected**, not tolerated — a
  rejected write is a five-minute fix, a tolerated one is a year of cleanup.
- Adding a key is a migration that inserts a registry row. That keeps JSONB's
  flexibility where it belongs (the value space) and removes it where it hurts
  (the key space).
- A weekly drift report: unregistered keys seen, registered keys never
  populated, per-category fill rates. This report *is* the T5 trigger.

### 4.5 Sake — resolved

Sake goes into `beverages` as `beverage_type='sake'`, **not** into
`master_wine_library`. It is brewed from rice; the wine library stays wine.

The evidence that shaped the shape: 42 corpus rows, field fill

```
producer 42/42   region 42/42   bottle_price 41/42
vintage   1/42   grape      0/42
```

Brewery → `producer`, cuvée → `name`, prefecture → `region`. The two null fields
are precisely the two the matcher already tolerates as null, so sake matches with
no special handling.

**The consequence for `beverages`:** it must carry the wine-shaped sensory core
as real columns — `body`, `acidity`, `serving_temp_celsius`, `glass_type` — not
only a name and a price. All four apply meaningfully to sake and would be lost in
transit otherwise. Sake-specific facts (`seimaibuai`, `smv`, `rice_varietal`,
`grade` ∈ junmai/ginjo/daiginjo/honjozo) are descriptive → `type_attributes`.

Sake is also the category most likely to *look* like it needs promotion early
(39 rows, a rich vocabulary, an obvious "sake table" instinct). It does not meet
a single trigger. It is the test case for whether §4.3 is followed or
rationalised around.

---

## 5. Premortem

*It is 2027. The beverage catalogue is a mess. What happened?* Ranked by
expected damage (likelihood × blast radius), with the guard that prevents each.

### P1 — A wrong merge corrupted a product across every restaurant at once
**Likelihood: high. Blast radius: global. Detectability: very poor.**

`Macallan 12 Sherry Cask` was folded into `Macallan 12 Double Cask` because the
names were 94% similar. A $90 bottle is now mispriced everywhere, and nobody
notices because there is no per-restaurant discrepancy to compare against — all
restaurants are wrong identically. Reservation counts, procurement suggestions
and analytics all inherit it.

*Guard:* §3 in full — barcode-authoritative, default-to-distinct, discriminators
as columns, review queue instead of auto-link, reversible logged merges. **This
is the single highest-value guard in the document.** If only one thing from here
survives, it should be §3.2.

### P2 — The view contract leaked, and promotion became impossible
**Likelihood: medium-high. Blast radius: architectural. Detectability: good, if instrumented.**

An ML export script read `type_attributes->>'mash_bill'` directly because it was
"just a script". Then a dashboard did. Then the mobile app. By the time whiskey
earned promotion, the swap touched four repos, so it never happened, and the
JSONB kept growing.

*Guard:* §4.3's CI grep, no `type_attributes` in serializers, grants on views
rather than the base table. Add the grep **in the same migration PR that creates
the table**, not later — a guard added after the first violation never catches
up.

### P3 — Dual-bookkeeping reappeared during a promotion
**Likelihood: medium. Blast radius: category-wide. Detectability: poor.**

Someone did the safe-feeling thing: wrote the promoted attribute to both places
"until we're confident". Reads diverged by writer. This is `stock_live` for the
third time in this codebase.

*Guard:* §4.3's explicit prohibition, the mandatory separate contract migration,
and the post-promotion assertion that no promoted key remains in JSONB. Treat
"we'll keep both for now" as a blocking review comment.

### P4 — JSONB key sprawl
**Likelihood: high without a registry, low with one. Blast radius: data quality.**

Three enrichment runs wrote `age`, `age_statement` and `age_years`. Every
consumer coalesces across all three. The views quietly stop reflecting reality.

*Guard:* §4.4's registry + write-time rejection + drift report. Reject
unregistered keys from day one; tolerance here compounds faster than anywhere
else in the design.

### P5 — The `beverages` split ships before `is_wine` is fixed
**Likelihood: medium (it is a sequencing mistake, not a design one). Blast radius: 7+ wines.**

The 7 mistagged wines migrate out of the wine library, lose their wine-specific
columns, and become unmatchable against wine submissions. Worse, the *rule* that
moved them (`is_wine=false`) is still wrong, so it keeps moving wines out.

*Guard:* §6 — fix the classifier and the flag before the migration, and gate the
migration on a checked invariant rather than on someone remembering. Migration
selects on a **verified** classification, never on `is_wine=false` alone.

### P6 — Cocktails leaked into the catalogue
**Likelihood: medium. Blast radius: matching quality.**

35 cocktails have no producer, vintage, SKU or purchasable unit. They already
broke wine matching once: five wines could not match themselves because
`producer` fell back to `name` while `normalized_producer` stayed empty. If the
migration sweeps "everything not wine" into `beverages`, cocktails poison
beverage matching the same way.

*Guard:* cocktails are excluded explicitly by menu section **and** by a
structural rule (no producer AND no barcode AND no volume ⇒ not a catalogue
row), and they go to their own tables (plan §3).

### P7 — The migration window closed
**Likelihood: rises weekly. Blast radius: effort, not correctness.**

Today: 0 FK references to the 202 rows. In six months: inventory lots, menu
prices, POS mappings and procurement history point at rows that need to move,
turning a clean insert-and-delete into a live repointing exercise with an
audit trail to preserve.

*Guard:* do phase 4 early. The 0 is the argument.

### P8 — Global scope was wrong for a category nobody anticipated
**Likelihood: low. Blast radius: contained.**

House-made limoncello, a restaurant's barrel-aged private cask, a private-label
beer. These are genuinely restaurant-specific products in a globally-scoped
table.

*Guard:* accepted risk, with an exit. A nullable `owned_by_restaurant_id`
(NULL = global) can be added later without touching a single existing row,
because "global" is the default and NULL already means it. Measured today: 2 of
829 rows look house/unbranded. Revisit if that exceeds ~5%.

### P9 — Per-category views multiplied into an unmaintainable layer
**Likelihood: low-medium. Blast radius: maintenance.**

Nine views became nine views plus nine "enriched" views plus per-view grants,
and adding a `beverages` column meant editing nineteen definitions.

*Guard:* generate the views from the `beverage_type_schema` registry rather than
hand-writing them, so a registry row is the only edit. One generator, nine
outputs.

### What would make me change the recommendation

Stated in advance, so it is a measurement rather than a retrofit:

- Discriminator-parse coverage below ~70% on spirits ⇒ §3.2's "default to
  distinct" degrades to "never merge", and the catalogue accumulates duplicates
  faster than review can clear them. Response: invest in parsing, not in
  loosening the threshold.
- House/unbranded share above ~5% ⇒ revisit P8's scoping exit.
- Any single category past ~5,000 rows within 12 months ⇒ promotion becomes a
  near-term plan item rather than a hypothetical.

---

## 6. Bug — `is_wine` conflates "not a wine" with "could not classify"

**This must be fixed before any migration.** It is both smaller and more serious
than I previously reported, and I had the number wrong.

### What I said, and what is true

I reported **40 actual wines mistagged `is_wine=false`**. Measured against the
live library, the correct number is **7**:

```
menu_category='red', is_wine=false, primary_type='unknown'
  BonAnno            | Duc des Nauves        | Frank Family Vineyards
  Heitz Cellar       | Ink Grade             | My Favorite Neighbor (Paso Robles)
  Renaissance Vineyard (Taken From Granite Soleil)
```

All seven are real wineries listed in a menu's red-wine section. (Two further
`is_wine=false` rows sit under `brandy & dessert` — Hennessy VSOP and Ramazzotti
Sambuca — and are correctly *not* wine.)

### The defect is worse than the count

`load_enriched_wines.py:212` sets:

```python
"is_wine": bool(e.get("primary_type")),
```

That reads as "is this a wine?" but computes "did enrichment return a
`primary_type`?" — which is *enrichment success*, not classification. The proof
is that **all 202** `is_wine=false` rows have `primary_type='unknown'`, without
exception. A Roka sake row and a Heitz Cellar Napa Cabernet are marked
`is_wine=false` for exactly the same reason: the model returned nothing.

So `is_wine` currently encodes:

```
is_wine = false   ⟺   the enrichment call did not produce a type
```

It is a null-flag wearing a classification's name. Today it is right 195 times
out of 202 by coincidence — most unclassifiable rows genuinely aren't wine. That
coincidence is what makes it dangerous: it looks correct until it is used as a
migration predicate, at which point 7 wines silently leave the wine library and
the rule that moved them stays wrong for every future load.

### Fix

1. **Separate the two facts.** `classification_status` ∈
   `{classified, unclassified}` and `beverage_kind` ∈
   `{wine, beer, spirit, sake, cider, cocktail, non_alcoholic, unknown}`.
   `is_wine` becomes derived (`beverage_kind = 'wine'`) or is dropped. Never let
   one boolean carry both.
2. **Classify from the menu section when enrichment is silent.** The menu's own
   section header (`red`, `sake`, `gin`) is present on every corpus row, is
   restaurant-authored ground truth, and is exactly the signal that reveals all
   7 mistags. Precedence: explicit enrichment type > menu section > unknown.
3. **Re-run over the 202** and record the corrections in `wine_repair_log`, the
   same audit path the wine repairs used.
4. **Regression test:** no row may have `beverage_kind='non-wine'` while its
   menu section is a wine section, and no row may be selected for migration on
   `is_wine=false` alone.
5. **Gate the migration.** Phase 4 selects on verified `beverage_kind`, never on
   `is_wine`. Add a pre-migration assertion that the count of wine-section rows
   in the migration set is zero.

### Note on the 218 `is_wine`-absent rows

Legacy seed (`wineops_basic_v1`, `sim`), predating the flag, all wine
(red 103, white 55, sparkling 18, rosé 8, orange 5, …). They need
`beverage_kind='wine'` backfilled so that "absent" stops being a third state
that every consumer has to interpret. Absent, false and unknown being three
different things is how this bug class recurs.

---

## 7. Consequences for phases already planned

- **Phase 2 (`is_wine` fix)** is upgraded from "fix 40 rows" to "fix the flag's
  semantics, then the 7 rows". It is a prerequisite for phase 4, not a
  nice-to-have. See §6.
- **Phase 4 (`beverages`)** gains: the wine-shaped sensory core as columns
  (§4.5), the four identity-bearing discriminator columns (§4.1), the
  `beverage_type_schema` registry (§4.4), the CI grep guarding the view contract
  (§4.3), and generated rather than hand-written views (P9).
- **Phase 4 migration predicate** changes from `is_wine=false` to a verified
  `beverage_kind`, with cocktails excluded structurally (P6).
- **Beverage dedup tooling** is not a copy of the wine tooling. It shares the
  normalizer and signature functions but carries a different merge policy (§3).

---

## 8. Still open

- **Discriminator-parse coverage is unmeasured.** What share of the 733 spirit
  rows yield a clean `age_years` / `cask_finish` / `proof`? This number sets the
  beverage auto-link threshold and is the leading indicator for P1. Measure it
  before writing the matcher, not after.
- **The 2,099 unenriched corpus wines** must be enriched before the migration,
  or they classify as `unknown` and land in the wrong population — the same
  failure §6 describes, at 10× the scale.
- **Barcode coverage is unmeasured.** §3.1 makes UPC authoritative, but nothing
  yet says how many beverage rows will actually have one from a menu (likely
  near zero — menus don't print barcodes). If it is near zero at load time, the
  barcode rule only becomes valuable once distributor catalogues are joined,
  and §3.2's conservatism carries the whole load until then.
