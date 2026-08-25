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

## 3. Decision 2 — identity is a deterministic key, not a similarity score

Scope and merge policy are separable decisions, and only the second one is
dangerous. This section replaces an earlier draft of the contract that did not
survive measurement. **The corrections are kept visible rather than swapped
out**, because the reasons the first version failed are the reasons the second
one is shaped as it is.

### 3.0 What the first draft got wrong

| first draft said | measurement | verdict |
|---|---|---|
| "UPC/EAN is authoritative when present" | menus print no barcodes; 0% of rows carry one | **inapplicable** — and wrong in principle: wine producers reuse one UPC across vintages (hence the existing `barcode_vintage_mapping` column), and GS1 permits GTIN reuse years after a product is discontinued. A barcode is strong *evidence*, never an authority. |
| "merge only when every present discriminator agrees" | 13% of spirit rows carry an age, 10% a cask, **0% a proof, 0% a volume** | **a fiction for 87% of rows** — with no discriminator present the rule silently falls back to name similarity, the exact thing it was written to prevent |
| "discriminators are columns", enumerated as age/cask/expression/proof | an enumerated key produced **145 false merges** | **unachievable** — §3.3 |
| "pick an auto-link threshold from the measurement" | positive and negative similarity distributions **overlap** | **no threshold exists** — §3.2 |

### 3.1 The instrument: labels from the world, not from me

Matcher precision was previously measured against adversarial probes I
generated, which cannot surface the errors I did not think to simulate. The
labelled set in `datasets/merge_eval/` is different, and everything below rests
on it:

> **Two different entries on the same menu are different products.**

A restaurant does not print one bottle twice at two prices. Every pair of
distinct entries within one menu is therefore a free *negative* label, and the
26-menu corpus yields **732,874** of them — against 12 positives built the same
way (entries on *different* menus that coincide under aggressive orthographic
canonicalisation).

The asymmetry in set sizes matches the asymmetry in risk: the negative set
bounds precision tightly, which is what guards the silent global failure; the
positive set bounds recall loosely, which is the error we can afford. Both
caveats are handled rather than ignored — extraction artifacts (one bottle read
twice) and under-identified rows (§3.5) are excluded, and manual label
corrections live in `datasets/merge_eval/adjudicated.json` with a written reason
each. **Exclusions are never derived from the policy under test**; that would
make the evaluation circular.

`scripts/build_merge_eval_set.py` builds it; `scripts/eval_merge_policies.py`
scores against it.

### 3.2 Result: no similarity threshold can work

```
policy                                    false MERGES  false splits
--------------------------------------------------------------------
exact signature (today, wine)                        0            12
residual-token key (proposed)                        0             5
fuzzy similarity >= 0.98                             1            12
fuzzy similarity >= 0.95                            61            12
fuzzy similarity >= 0.90                           123             5
fuzzy similarity >= 0.85                           212             5
```

The two error columns must never be summed into one score. A false merge is
silent, global, and destroys the evidence of itself; a false split shows a
duplicate in a list.

Why no threshold survives — the worst *true* match scores **0.919**
(`johnnie walker blue` / `johnnie walker blue label`) while the worst *false*
pair scores **0.979**:

```
0.979  pappy van winkle 12          |  pappy van winkle 15       $60 vs $80
0.973  macallan double cask 12 yr   |  macallan double cask 25 yr
0.973  macallan classic cut 2020    |  macallan classic cut 2024
```

The distributions **overlap**, so the ordering itself is uninformative and no
cut point separates them. The cause is structural, not a tuning problem:

> **The discriminating token is usually a number. A number is worth ~2% of
> string similarity and 100% of the product identity. Similarity therefore
> *rises* as names grow more descriptive, because the shared prefix dominates
> precisely when the names are most complete.**

Weighting numbers more heavily does not rescue it either: `Don Julio 1942` and
`Old Forester 1924 Series` are expression names, `Classic Cut 2020` is a release
year, `Weller 107` is a proof, `Macallan 12` is an age. One token shape, four
meanings.

### 3.3 Discriminators cannot be enumerated

The first structural key enumerated the discriminating vocabulary — age, cask,
finish, proof. It produced **145 false merges**, and the failures name the flaw:

```
johnnie walker black label  |  johnnie walker blue label
blanton's bourbon           |  blanton's gold bourbon
weller 12yr bourbon         |  weller cypb bourbon
glenlivet 12yr              |  glenlivet 18yr      (\b\d+\b never matches '12yr')
```

`black` / `blue` / `gold` / `cypb` / `primavera` / `birthday` — no enumeration is
ever complete, and **every gap is a silent false merge**. That is the wrong
direction for incompleteness to fail.

### 3.4 The rule: residual-token equality under a closed equivalence

Invert it. **Every non-brand token discriminates until an explicit, tested
equivalence says otherwise.**

```
identity_key = ( brand tokens,
                 COMPLETE multiset of remaining tokens,
                 vintage )
```

- Numbers are never normalised away. They are the identity.
- Glued forms are split (`12yr` → `12 yr`, `107proof` → `107 proof`), so that
  spelling varies rather than content.
- The equivalence relation is **closed, tiny and versioned**: `{yrs, year,
  years, yo} → yr`, plus a noise set `{the, label, co, company, distillery,
  distillers, and}`. `label` is in it because *Johnnie Walker Blue* and *Johnnie
  Walker Blue Label* are one product. `black` and `blue` are not in it, and
  never will be.
- Adding an entry to either set is a reviewed change that must re-run §3.1.

**The property that makes this bulletproof: incompleteness fails safe.** An
unrecognised token is assumed to discriminate, so a gap in the equivalence
relation costs a false *split* — visible, cheap, recoverable — never a false
merge. Contrast the enumerated design, where the same gap costs a false merge.
Identical ignorance, opposite consequence.

Measured: **0 false merges across 732,874 known-distinct pairs**, in every
category, while still collapsing 4,822 rows to 4,418 products with 293 appearing
on more than one menu. It dominates today's exact-signature rule on both axes —
the same zero false merges, with fewer false splits (5 vs 12).

### 3.5 The third failure class: under-identified rows

Merge policy has two familiar failure modes. The corpus exposed a third that no
merge policy can fix, and that the first draft missed entirely.

**357 library rows have `normalized_producer = normalized_name`.** On one menu
alone, *six different* Hermitage Blanc wines — different growers, different
prices — are stored as six identical rows, because the extractor wrote the
**appellation into the producer field**:

```
  6x  hermitage blanc     [Obelix_Chicago_Wine_Menu.pdf]
  4x  cote rotie          [Obelix_Chicago_Wine_Menu.pdf]
  4x  hermitage           [Obelix_Chicago_Wine_Menu.pdf]
  3x  chateau petrus      [Obelix_Chicago_Wine_Menu.pdf]
```

These rows carry **no identity**. Merging them is "correct given the data" and
destroys real, distinct products. Keeping them apart is equally unjustified —
there is nothing to keep apart *by*. The information was lost upstream and
cannot be recovered downstream.

**Rule: under-identified rows are quarantined, never merged.** A row is
under-identified when its residual token multiset is empty — the name adds
nothing to the producer — optionally strengthened by the producer matching a
known appellation. Such rows may be stored, displayed and counted, but are
ineligible to be merged, ineligible as a match target, and flagged for
re-extraction. The real fix is upstream: extraction must never put an
appellation in `producer`.

> **Live hazard.** `find_library_duplicates(85)` returns 289 proposals today, of
> which **200 are pairs co-occurring on a single menu** — provably different
> products — and **18 are flagged `safe_to_merge`**. Nothing auto-merges, so this
> is latent rather than active, but the merge tool must not be run against the
> library until the quarantine rule and the §3.8 gate exist.

### 3.6 Separate candidate *generation* from the merge *decision*

This is the move that reconciles the evidence above with the fact that the wine
matcher genuinely measures recall 1.000.

| stage | tool | property needed | cost of an error |
|---|---|---|---|
| **generate** candidates | trigram / `word_similarity`, embeddings | high recall, cheap | a miss is a duplicate; a spurious candidate is wasted review |
| **decide** merge | `identity_key` equality (§3.4) | **zero false merges** | permanent and global |
| **adjudicate** the remainder | human review queue | throughput | an uncleared queue leaves duplicates — safe |

Fuzzy matching is excellent at generation and unacceptable as a decider. The
existing recall measurement was measuring generation, and it was not wrong — it
answered a different question from the one that matters here. Keeping the stages
separate is what lets each tool be used where it is strong.

**Nothing auto-merges. Ever, in any category.** A key match may auto-*link* an
incoming menu line to an existing catalogue row — that creates a link, not a
rewrite, and is reversible. Collapsing two catalogue rows is always reviewed.

### 3.7 Merge must be non-destructive

Given §3.5, and given that a catalogue row accumulates inventory, price history
and POS mappings over time, merge cannot mean "collapse two rows' attributes and
keep one".

- **Supersede, don't overwrite.** The loser is marked superseded and gains an
  alias pointing at the keeper. `wine_aliases.canonical_id` already exists for
  exactly this; `beverages` gets the same.
- **Never fuse conflicting non-null attributes.** Two rows disagreeing on a
  non-null ABV, volume or vintage is *evidence they are different products*. It
  **blocks** the merge; it is not resolved by picking a winner.
- **Repoint current references; leave history alone.** After first reference by
  inventory or procurement, a merge stops being a catalogue edit and starts
  rewriting financial history. Past facts keep pointing where they pointed.
- **Un-merge must be tested, not asserted.** A reversible merge nobody has ever
  reversed is not reversible. A property test merges then un-merges random pairs
  and asserts bit-identical state.

### 3.8 The gate

§3.1 is not a one-off study; it is a permanent CI fixture.

- Any change to the normalizer, the equivalence relation, the noise set, the
  identity key or the matcher re-runs `eval_merge_policies.py`.
- **False merges must be 0.** Not "low" — zero. This is the one hard gate.
- False splits are reported and may move; a rise is a discussion, not a failure.
- Every new menu extends the negative set for free, so the gate strengthens over
  time with nobody labelling anything.

### 3.9 Why the two errors are never traded off

If a false merge costs *c*ᶠᵐ and a false split costs *c*ᶠˢ, merging is rational
only when `P(same) > cᶠᵐ / (cᶠᵐ + cᶠˢ)`. A false merge silently mis-states a
product for every restaurant at once with its own evidence destroyed; a false
split shows a duplicate in a list. That ratio is not 2:1 or 10:1, it is nearer
100:1, putting the rational threshold above 0.99 — and §3.2 showed no threshold
that high is achievable. The quantitative argument lands on the same place as
the structural one: **do not use a threshold at all.**

### 3.10 What this means for wine

Wine keeps its matcher. The `word_similarity` work solved a real problem —
bare-vs-verbose names (`Ribolla` vs `Ribolla Gialla Friuli`) — and wine's
discriminating axis, vintage, is already a typed column rather than free text.
Beverages have four discriminating axes, all in free text. Different problems,
different tools: a deliberate split, not an inconsistency.

Wine does adopt three things from this section, all pure additions that change
no matching behaviour:

1. **Quarantine** for the 357 under-identified rows (§3.5).
2. **The §3.8 CI gate**, which wine has never had — its precision was measured
   against probes I wrote myself.
3. **A guard on `find_library_duplicates` / `merge_library_wines`:** no pair may
   be proposed `safe_to_merge` when its two rows co-occur on a single menu. That
   one rule removes 18 of today's 19 `safe_to_merge` proposals, all of which are
   wrong.

---

## 4. Decision 3 — one physical table, typed, with per-category views

```
beverages
  id, beverage_type, name, display_name, producer, brand,
  country, region, abv_pct, volume_ml, package_format,
  price_reference, barcode / sku / upc / ean, embedding,
  library_tier, review_status, field_confidences, data_enrichment,
  signature_hash, normalized_name, normalized_producer,   -- same normalizer
  identity_key, identity_status,                          -- §3.4 / §3.5
  body, acidity, serving_temp_celsius, glass_type,        -- sensory core (§4.5)
  age_years, cask_finish, expression, proof,              -- parsed projections (§4.1)
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
| is the identity itself | **`identity_key`**, a generated column | §3.4 — it must be indexable, comparable and impossible to disagree with |
| is referenced by a foreign key or a CHECK | **column** | JSONB cannot be an FK target |
| is filtered, sorted or joined at scale | **column** (promote when it happens — §4.3) | |
| is descriptive, or an ML feature only ever read as a block | **`type_attributes`** | |

**An important correction from §3.** An earlier draft put `age_years`,
`cask_finish`, `expression` and `proof` in columns *because they were
identity-bearing*. §3.3 retired that: identity cannot be carried by an
enumerated set of parsed fields, because the enumeration is never complete and
every gap is a silent false merge. Identity is carried by `identity_key` — the
complete residual token multiset — which by construction cannot have a gap.

Those four columns stay, but their job changed. They are **best-effort parsed
projections** for filtering, faceting and ML ("show me 12-year whiskies"), and
they are explicitly **not authoritative for identity**. A null `age_years` on a
row whose name says `12 yr` is a parsing miss, not an identity change — the key
already has the token. This distinction must be written into the column comments
in the migration, or someone will reasonably assume the parsed columns decide
identity and reintroduce §3.3's failure.

Sake's `seimaibuai` and `smv`, beer's `ibu`, gin's botanical bill are
descriptive → JSONB.

### 4.2 Why not nine physical tables now

A `whiskey_details` row living *alongside* a `beverages` row for the same bottle
is two representations of one entity that drift independently. That is the exact
failure this codebase already paid to fix in inventory — `stock_live` written by
three uncoordinated actors, an "immutable" ledger nothing wrote to
(`.planning/INVENTORY_SOTA_PLAN.md` §1).

*(An earlier draft also cited `vendor_catalogue` as a second instance. Checked:
it holds 25 rows, all `source='curated'`. The real pattern there is one vendor
appearing both as a restaurant-scoped `providers` row and as a global
`vendor_catalogue` row — which is an **identity** problem of the §3 kind, not
independent copies drifting. It belongs in the argument for §3, not this one,
and the overstatement is corrected rather than left standing.)*

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

`Pappy Van Winkle 12` was folded into `Pappy Van Winkle 15` — a real pair from
the corpus, priced $60 and $80 on one menu, and **97.9% string-similar**. The
bottle is now mispriced everywhere, and nobody notices, because there is no
per-restaurant discrepancy to compare against: every restaurant is wrong
identically. Inventory value, procurement suggestions and analytics all inherit
it, and the evidence that the two were ever distinct is gone.

*Guard:* §3 in full, and specifically §3.4 — a deterministic residual-token key
measured at **0 false merges across 732,874 known-distinct pairs**, in place of
any threshold. **This is the single highest-value guard in the document.** If
only one thing here survives, it should be §3.4 plus the §3.8 gate that keeps
it true.

*Status in shipped code, measured — the two paths differ sharply and should not
be conflated:*

- **Linking** an incoming menu line to a library row (`match_library_wine` at
  ≥85) is in good shape: **1 wrong auto-link in 3,074** same-menu wine pairs —
  `Gabbiano Chianti Classico` vs `Gabbiano Chianti Classico Riserva`. (Sample
  skewed toward smaller menus; the residual-token key catches even this one,
  since `riserva` is a residual token.)
- **Merging** two catalogue rows (`find_library_duplicates` at ≥85) is not:
  200 of 289 proposals are pairs that co-occur on a single menu, and **18 are
  flagged `safe_to_merge`**. Nothing runs it automatically, so this is a loaded
  gun rather than a fired one — but it must not be run before §3.5's quarantine
  and §3.10's co-occurrence guard exist.

### P1b — Rows that never had an identity got merged anyway
**Likelihood: certain if unguarded (357 rows exist today). Blast radius: silent data loss. Detectability: none after the fact.**

Six different Hermitage Blanc wines are stored as six identical rows because the
extractor wrote the appellation into `producer`. A dedup pass "correctly"
collapses them to one, and five real wines — with five real prices — vanish. No
merge policy can prevent this, because by the time the rows exist there is
nothing left to distinguish them by.

*Guard:* §3.5 — quarantine any row whose residual token multiset is empty:
ineligible to merge, ineligible as a match target, flagged for re-extraction.
The durable fix is upstream, in the extraction prompt. This failure is the
reason "improve the matcher" is the wrong response to duplicate complaints.

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

### P10 — The review queue was never cleared, so the design degraded to "never merge"
**Likelihood: high. Blast radius: lost value, not lost correctness.**

Because nothing auto-merges (§3.6), everything the key does not decide waits for
a human. Nobody had time. Two years of duplicates accumulated, enrichment was
paid for twice on the same bottle, and demand aggregation fragmented.

This is the *designed* failure direction — it degrades to safe — but it is a
failure, and pretending otherwise would be dishonest.

*Guard:* make the queue cheap rather than large. Order proposals by value
(restaurants affected × price impact), show the evidence inline (both names,
both menus, both prices, which tokens differ), and accept the whole queue's
existence as the price of §3.9's cost ratio. Track queue age as a health metric.
If it proves unclearable, the answer is better candidate generation — fewer,
better proposals — never a loosened decision rule.

### What would make me change the recommendation

Stated in advance, so it is a measurement rather than a retrofit:

- **A single false merge appearing in the §3.8 gate** ⇒ the identity key is
  wrong and ships nothing until it is 0 again. No exceptions, no "it's only
  one".
- **False splits climbing above ~2% of catalogue rows** ⇒ the equivalence
  relation is too small. Response: add reviewed entries to `EQUIV`/`NOISE`, each
  re-running the gate. Never a threshold.
- **Review queue unclearable** (age trending up for a quarter) ⇒ P10 has
  arrived; fix generation, not the decision rule.
- **House/unbranded share above ~5%** ⇒ revisit P8's scoping exit.
- **Any single category past ~5,000 rows within 12 months** ⇒ promotion becomes
  a near-term plan item rather than a hypothetical.

The earlier trigger "discriminator-parse coverage below ~70%" is withdrawn: it
was measured at 13%/10%/0%/0%, which retired the enumerated-discriminator design
entirely (§3.0) rather than tuning it.

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
- **Phase 4 (`beverages`)** gains: `identity_key` + `identity_status` (§3.4,
  §3.5), the wine-shaped sensory core as columns (§4.5), the parsed projection
  columns with their non-authoritative status documented in-migration (§4.1),
  the `beverage_type_schema` registry (§4.4), the CI grep guarding the view
  contract (§4.3), and generated rather than hand-written views (P9).
- **Phase 4 migration predicate** changes from `is_wine=false` to a verified
  `beverage_kind`, with cocktails excluded structurally (P6).
- **Beverage dedup tooling** is not a copy of the wine tooling. It shares the
  normalizer but replaces the decision rule (§3.4) and never auto-merges.

**A new phase belongs before the rest, and it is cheap.** The identity work in
§3 is independent of the beverage split, benefits wine immediately, and closes
a live hazard:

| | item | why it comes first | status |
|---|---|---|---|
| 0a | Land `datasets/merge_eval/` + `eval_merge_policies.py` in CI | The gate must exist before anything it guards changes | **done** — wired into `.github/workflows/ci.yml`, verified to fail on a deliberately broken policy |
| 0b | Co-occurrence guard on `find_library_duplicates` | Removes wrong `safe_to_merge` proposals | **done** — 18→0 co-occurring-and-safe proposals, verified live |
| 0c | Quarantine the under-identified rows | Stops P1b outright; no schema change, one status column | **done** — 334 rows flagged (measured live at apply time; the 357 first quoted had already drifted in this shared database), matcher and duplicate-finder both verified to exclude them |
| 0d | Fix the extraction prompt so `producer` never takes an appellation | The durable fix for 0c, forward-looking | **done** — prompt updated, drift guard + tsc verified. Retroactively fixing the 334 already-quarantined rows is separate cleanup, not required for this to be closed — plan §6 item 0d-2, cost corrected from an assumed ~$0.30 to ~$2 once the true span (21 of 26 menus) was measured |

---

## 8. Still open

Both of the previously-open identity questions are now **closed by
measurement**, and the answers changed the design rather than tuning it:

- ~~Discriminator-parse coverage~~ → measured at 13% age, 10% cask, **0% proof,
  0% volume**. It did not set a threshold; it retired the enumerated-
  discriminator design entirely (§3.0, §3.3).
- ~~Barcode coverage~~ → 0% on menu-sourced rows, and a barcode is not an
  identity authority even when present (UPC reuse across vintages, GS1 GTIN
  reuse after discontinuation). Demoted from "authoritative" to "evidence"
  (§3.0). It becomes useful only once distributor catalogues are joined.

Genuinely still open:

- **The 2,099 unenriched corpus wines** must be enriched before the migration,
  or they classify as `unknown` and land in the wrong population — the same
  failure §6 describes, at 10× the scale.
- **Positive labels are thin** — 12 pairs. The negative set (732,874) bounds
  precision tightly, which is the error that matters, but recall is bounded only
  loosely. Two cheap sources would fix it: distributor catalogues (same product,
  many spellings) and human review-queue decisions, which become labels the
  moment someone confirms a merge. Until then, false-split figures should be
  read as indicative, not precise.
- **Per-category attribute detail** — the sake/beer/whiskey/gin `type_attributes`
  schemas are sketched in §4 but not specified to field level, and the
  `beverage_type_schema` registry rows are what make them real. That work is
  scoped per category and best done at the point each category is populated,
  not preemptively.
- **Cross-category collision is untested.** The identity key is evaluated within
  the corpus as a whole, but a beer and a whiskey from the same parent brand
  (Guinness, Jameson, Sam Adams' spirits line) could in principle collide. Add
  `beverage_type` to the key, or measure that it never happens, before the
  first multi-category load.
---

## 9. Read models: one source of truth, two audiences

### 9.0 The vendor model is the house pattern, and it was right

An earlier draft called the `providers` / `vendor_catalogue` split an identity
defect. That was wrong, and the reasoning matters more than the correction.

Vendors are **relationships, not catalogue entries**. Every restaurant has its
own history with a distributor: communication style, personality notes, who owes
whom a favour, what was said last time. And prices are not equal to everyone —
a vendor genuinely quotes its better customers differently. A global vendor row
cannot hold any of that without flattening 500 relationships into one.

The schema already models this correctly:

```
vendor_catalogue          providers                     (per restaurant)
  global, curated   ←──   catalogue_vendor_id            personality_notes
  27 rows                 is_custom                      response_pattern
                          21 rows, 18 custom, 3 linked   close_relationship
                                                         relationship_health_score
                                                         last_contact_notes
                                                         payment_terms, tier
```

and `procurement_order_items` carries `quoted_unit_price`,
`negotiated_unit_price` and `final_unit_price` separately — which is precisely
the "vendors favour their better customers" fact, already first-class.

`catalogue_vendor_id` is the nullable link that makes the eventual verification
flow non-destructive: when a phone number or email later matches a verified
vendor, the suggestion sets the link and **nothing scoped is touched**. Notes,
sentiment and terms stay exactly where they are. That is the correct design and
it needs no repair.

**Name it as the house pattern, because it is the same shape as everything else
here:**

> **A global row for what the thing *is*. A restaurant-scoped row for what the
> thing *is to us*. A nullable link between them, so the two can be connected
> later without disturbing either.**

| what it is (global) | what it is to us (scoped) | link |
|---|---|---|
| `vendor_catalogue` | `providers` | `catalogue_vendor_id` |
| `master_wine_library` | `restaurant_inventory`, `menu_items` | `master_wine_id` |
| `beverages` (planned) | same | same |

**A correction to the beverage design falls out of this.** `price_reference` and
`retail_price_avg` sit on the global library row. Given that price is a
relationship outcome, those are **market hints, never a restaurant's price**,
and must never be displayed or computed against as if they were. Real prices are
already scoped, in five tables (`menu_items`, `wine_menu_prices`, `price_history`,
`vendor_price_observations`, `procurement_order_items`). The global fields should
carry that caveat in their column comments, or someone will one day average them
into a report.

### 9.1 The rule

> **One write model. Many read models. The flow is one-way, and every read model
> is disposable.**

- **Layer 1 — source of truth (OLTP).** `master_wine_library`, `beverages`,
  `cocktails`, the scoped tables. Normalized, constrained, RLS'd. **All writes
  land here and nowhere else.** This is what §3 and §4 specify.
- **Layer 2 — serving views (UX).** `catalogue_items`, the per-category views,
  `display_name`. Zero-copy, always current, no staleness, no sync job. Serves
  search, autocomplete, display, ad-hoc analysis.
- **Layer 3 — analytical marts (ML).** Materialized, versioned, per-grain,
  provenance-carrying. Built by a job from Layer 1. **Never hand-edited.**

**The test that keeps Layer 3 from becoming a second master:** you must be able
to `DROP` the entire analytical layer and rebuild it from Layer 1 without losing
anything. If you can't, something was written there that exists nowhere else —
and that is dual-bookkeeping wearing a data-science hat, at a bigger scale than
`stock_live` ever managed.

### 9.2 Views serve UX. They do not serve ML

An earlier claim in §4 — "`SELECT * FROM whiskey` is ML-ready" — is true for
*exporting a snapshot* and false as an ML architecture. Four reasons, and none
is fixable by writing a better view:

1. **No reproducibility.** A view returns today's rows. A model trained "on the
   whiskey view" cannot be retrained on the same data tomorrow, so a regression
   can never be attributed to the code rather than the data.
2. **No point-in-time correctness.** This is the one that silently destroys
   models. Train a "what will this restaurant reorder" model using today's
   enriched attributes against last quarter's sales, and the model learns from
   facts that did not exist when the sale happened. It scores beautifully
   offline and fails in production. Preventing it requires knowing *when we
   learned* each fact, not just when it became true.
3. **No provenance carried through.** §9.3 — the single biggest risk here.
4. **Wrong grain.** One row per bottle answers product questions. Demand,
   elasticity and vendor-behaviour questions each need a different grain, and no
   single wide table serves all of them.

### 9.3 The four things that must be designed now because they cannot be backfilled

Everything else in Layer 3 can wait. These cannot — each one is either captured
at write time or lost permanently.

**1. Provenance. 76% of the library is a guess, and it is currently labelled.**

```
inferred   3,151    typical profile for the grape/region — a reasoned default
known        468    the model recognises this specific bottling
unknown      323
(absent)     218    legacy seed
```

`field_confidences` and `library_tier` are populated on **all 4,160 rows**. That
is a genuinely valuable asset and it is one careless flattening away from being
destroyed. If a wide table is built with `tannins` but not
`tannins_confidence`/`knowledge`, then 76% of the training signal is *a model's
prior about typical Barolo*, presented as fact. Training on it teaches the next
model to reproduce the first model's assumptions rather than reality — confident,
wrong, and unfalsifiable, because the errors are self-consistent.

> **Rule: every ML feature carries its provenance alongside it, and every
> training set declares which tiers it accepts.** The default for any model that
> predicts real-world outcomes should be `known` only, with `inferred` admitted
> deliberately and recorded in the model card.

**2. Bitemporality — `observed_at`, not just `updated_at`.**

Two different questions: *when did this become true* (a wine's vintage was
always 2016) versus *when did we learn it* (we enriched it on 2026-08-14).
Point-in-time correctness needs the second, and it must be stamped at write
time. The library has `updated_at`, `library_tier_updated_at` and
`scores_last_updated_at` — partial, and overwritten in place. Enrichment writes
should append an observation with its own timestamp rather than only mutating
the row. **Retrofitting this is impossible: the history was never recorded.**

**3. Stable join keys.** Every training set will reference `id`. A merge that
deletes a row orphans historical training data and silently changes what a past
experiment meant. This is a second, independent argument for §3.7's
supersede-and-alias over destructive merge. And a rule: **ML joins on `id`,
never on `identity_key`** — the identity key legitimately changes when the
equivalence relation is versioned, which is a schema event, not an entity event.

**4. Grain, declared per question.** One wide table cannot serve these:

| question | grain |
|---|---|
| what is this bottle like | product |
| what will sell next week | restaurant × product × week |
| how does price move volume | restaurant × product × price-change event |
| which vendor treats us well | restaurant × vendor × order |

Layer 3 is therefore **one mart per grain**, not one big table. Each is built
from Layer 1, versioned by snapshot date, and independently droppable.

### 9.4 What to build now, and what not to

Honest assessment of whether there is anything to train on today:

```
pos_checks                 47      procurement_order_items      1
inventory_events            8      wine_menu_prices             0
inventory_lots             94      price_history                0
restaurant_inventory      138      recommendation_actions       0
menu_items                342      master_wine_library      4,160
```

**There is no transaction-grain ML to do yet.** The only rich asset is the
product catalogue itself. Building a feature store now would be building
infrastructure for data that does not exist — the same mistake as nine
per-category tables for categories of four rows.

So:

| now (cannot be backfilled) | later (easy to add once data exists) |
|---|---|
| Preserve provenance columns through every projection | The marts themselves |
| Stamp `observed_at` on enrichment writes | Snapshot versioning + content hashes |
| Stable ids: supersede + alias, never delete | Feature engineering, encoders, embeddings |
| Declare grain in any new fact table | Training/serving skew checks |

The first column is cheap today and impossible later. The second is
straightforward whenever it is needed. That asymmetry is the whole scheduling
argument.

### 9.5 So — ML-ready or best UX?

Both, and they are not in tension, because they are **read models over the same
truth** rather than two designs competing for one table:

- **UX** gets the normalized row plus zero-copy views: one query surface, one
  display name, point lookups on indexed columns, no staleness. Fast because the
  data is small and indexed, not because it was denormalized.
- **ML** gets materialized per-grain marts carrying provenance and observation
  time, versioned so an experiment is reproducible, rebuildable so they are
  safe to throw away.

The failure mode to refuse is the tempting one: a second wide table that is
*also* written to, because "the analysts needed a column". That is `stock_live`
again. Analysts get a mart; the mart gets rebuilt; the truth stays in one place.
---

## 10. Fitness for the goal: pairing, ingredients, preference, and speed

The stated end goal is to predict how well a bottle matches a **meal**, its
**ingredients**, and a **person's** tendency to like it — while the app stays
instant to search and browse. This section grades the structure against that,
honestly, with what is measured today.

**Verdict in one line: the item side is genuinely strong, the interaction side
barely exists, and one line of code is destroying the data the whole goal
depends on, every service, permanently.**

| capability | ready? | blocker |
|---|---|---|
| describe a bottle richly enough to pair it | **yes** | — |
| pair bottle ↔ dish | **no** | no dish entity; and pairing observations are discarded at POS ingestion |
| match ↔ ingredients | **no** | no ingredient entity anywhere |
| person-level likeability | **not reachable** | no guest identity exists in the schema |
| fast search / browse | **yes at today's size**, two real risks at scale | sensory filters hit JSONB; `embedding` is empty |

### 10.1 The item side is strong, and it is the hard half

```
wine_structure   3,350 rows   body, acidity, tannins, texture, sweetness, finish, alcohol
sensory_profile  3,626 rows   primary / secondary / tertiary aromas, flavor_profile,
                              aroma_complexity, flavor_intensity
provenance       4,160 rows   knowledge + field_confidences + library_tier on every row
```

Those are precisely the axes classical pairing reasons over — acidity against
fat and salt, tannin against protein, body against weight, sweetness against
heat, intensity against intensity. Having them on 3,350 bottles, each labelled
with how it was obtained, is a real asset and it is the part most projects never
get. **Nothing in the identity or catalogue design threatens it.**

### 10.2 The interaction side is nearly absent — and one gap is actively bleeding

**a) There is no food.** No dish, recipe or ingredient table exists.
`menu_items` is wine-only — its columns are `producer`, `vintage`, `region`,
`grape_variety`, `wine_library_id`. A pairing model cannot be built against an
entity that does not exist.

**b) There is no person.** A schema-wide search for `guest`, `customer`,
`diner`, `loyalty` or `party` columns returns **nothing**. Individual-level
"likeability tendency" has no key to hang on. §10.5 gives the reachable ladder.

**c) ~~The pairing label is being destroyed at ingestion.~~ Withdrawn,
2026-08-17 — I read the code wrong. Kept here rather than deleted, because the
mistake and how it was caught are both worth having on record.**

I saw

```ts
// apps/api-gateway/src/pos-hub/pos-hub.service.ts:328
if (!it.is_wine) continue;   // pos-hub tracks wine only
```

and concluded food lines never reach storage. Sent to a premortem review before
building anything on it (per the build directive: an architecture claim outside
the written plan gets checked before it's acted on), and independently verified
by reading the cited lines directly. Both wrong:

```ts
// pos-hub.service.ts:168 — a MAP, not a filter. Every line, wine and food.
const items = check.items.map((it) => { ... is_wine, ... });
// :199-204 — the full array is upserted into pos_checks.items UNCONDITIONALLY,
// on conflict (restaurant_id, source, external_check_id) — idempotent on replay.
row.items = items;
await client.from("pos_checks").upsert(row, { onConflict: "..." });
// :212 — only THEN does applyStockEffects run, closed checks only.
// :328 — the line above lives INSIDE applyStockEffects. It gates inventory
// RPCs (apply_stock_movement / record_glass_pour), which food correctly has
// none of. It has nothing to do with whether the line was persisted — it was,
// 126 lines earlier.
```

And a consumer already exists:

```ts
// table-analytics.service.ts:416 — getBasketAffinity()
const items: any[] = Array.isArray(c.items) ? c.items : [];
const names = items.map((it) => it?.name).filter(Boolean);   // no is_wine filter
// ... E.pairAssociations(transactions, ...) — lift-based market-basket pairing,
// wine and food together, over every closed check today.
```

So the grain question the original §10.2 asked answers itself: **the pairing
grain is the check, and one `pos_checks` row already *is* one check** — the
basket is a single row, which is the ideal shape, not a compromise. `sales_events`
(cited below as "the richest schema for this") turned out to be the wrong target
regardless: it has `inventory_id NOT NULL` FK'd to `restaurant_inventory`, and a
matching non-Optional Pydantic contract on the Python side
(`services/agent-orchestrator/core/database.py:168`, `SalesEvent.inventory_id: str`)
with real if currently-idle consumers (weekly reports, `inequality_detector.py`,
`inventory_count_service.py`) that assume every row is an inventory-tracked sale.
Repurposing it for food would have silently changed what "revenue from
sales_events" means in every one of those, with no error anywhere.

**What actually blocks pairing is not storage — it's identity.**
`pos_checks.items[].name` is a raw POS string. "Ribeye 12oz" and "Ribeye" are
different entities to any grouping query, so a model can accumulate
co-occurrence counts today but cannot yet answer "how does this dish pair"
without deciding what counts as the same dish. That is a product-scope question,
not a schema fix, and no table design resolves it. Tracked as register A15.

**Resolved 2026-08-20 — deferred, with the design written first.** The product
owner's call is to keep raw strings for now. The full design, the traps, and the
revisit triggers live in `.planning/DISH_IDENTITY_DESIGN.md`. Two findings from
writing it are worth carrying here, because they change what "deferred" means:

1. **There is no negative-label source for dishes.** What makes the beverage key
   trustworthy is not its construction but that it was falsified against 732,874
   known-distinct pairs, harvested free from same-menu entries. No food menu
   exists in this schema, so that test cannot be run at all. A dish-matching
   policy adopted today would be *unfalsifiable*, which is strictly worse than
   having none.
2. **The volume is 47 checks, one restaurant, one day, 37 distinct strings.**
   Any policy fitted to that is fitted to noise — and would pass human review
   precisely because n=37 is eyeballable.

The trap to name explicitly, since it is the way this will try to enter the
codebase: "just normalize the strings and strip the sizes" *is* a merge policy.
It would merge `Ribeye 12oz` with `Ribeye 16oz` — the same error class as
`Pappy 12` vs `Pappy 15`, which fuzzy matching at 0.85 committed 212 times.

No code changed as a result of this section, beyond one clarifying comment at
`pos-hub.service.ts:328` so the next reader doesn't make the same misreading.

### 10.3 A live dual-home defect in the sensory data

```
typed columns   acidity=0  tannins=0  texture=0  finish=0  primary_aromas=0
JSONB           wine_structure=3,350        sensory_profile=3,626
```

The typed columns exist and are **empty**; the values live in JSONB. That is the
§4.1 rule already violated inside `master_wine_library` — one fact with two
possible homes, which is how they drift the moment anyone writes the column.

It also directly costs the goal: pairing filters ("light body, high acidity")
and ML feature extraction both go through a JSONB scan rather than an index.

**Decide one way and enforce it**: either backfill the typed columns from JSONB
and make the JSON a derived view, or drop the empty columns and add expression
indexes on the JSONB keys. Having both is the defect; which one wins is a
smaller question than choosing.

### 10.4 `embedding` is indexed but empty

`pgvector` is installed and `idx_master_wine_library_embedding` exists —
over a column populated on **0 of 4,160 rows**. Semantic search ("something like
this but lighter"), nearest-neighbour pairing and cold-start similarity are all
unavailable until it is filled. Cheap to fix once `display_name` exists, since
the natural embedding input is display name + sensory profile + region.

### 10.5 What each target actually requires

**Pairing (bottle ↔ dish).** Reachable, in two stages, and the first stage needs
no ML at all:

1. **A knowledge-based pairing engine now.** The classical axes are already
   populated on 3,350 bottles. Rules over acidity/tannin/body/sweetness/intensity
   give useful recommendations immediately, with no labels, and — critically —
   they are *explainable*, which is what a sommelier will accept.
2. **A learned model later**, once food lines have been captured long enough to
   have co-occurrence data. Stage 1 is what generates the data stage 2 needs.

Do not skip to stage 2. With no labels, a "model" here is a rules engine wearing
a costume, and calling it ML makes it unfalsifiable.

**Ingredients.** Not reachable without an ingredient entity. The cheapest
credible path is to treat the dish *name* as the unit first (POS gives you
"Branzino, Grilled") and only decompose into ingredients if dish-level pairing
proves insufficient. Building an ingredient ontology before knowing that is
premature by a wide margin.

**Person-level likeability.** **Not reachable today, and it should not be
promised.** The honest ladder, in order of what the data can actually support:

| level | key available? | notes |
|---|---|---|
| restaurant taste profile | **yes** | aggregate of what this list carries and sells |
| occasion / day-part | **yes** | `sales_events` has day_of_week, hour_of_day, is_weekend, time_window |
| party size | **yes** | `pos_checks.covers` |
| **server** | **yes** | `pos_checks.server_name`, `server_external_id` — who recommends what, and what converts |
| table / check | **yes** | the natural unit of a pairing observation |
| individual guest | **no** | needs a loyalty or reservation identity that does not exist |

Server-level is the sleeper here: it is available today, it is the actual
mechanism by which wine gets sold in a restaurant, and "which staff member sells
which style" is both useful and immediately actionable.

### 10.6 Premortem for the ML goal

**M1 — We built a recommender and then trained on its own output.**
*Likelihood: near-certain if unguarded.* Recommend a pairing, it sells, train on
the sale, recommend it harder. Within months the model has learned its own
priors and the catalogue's tail is invisible. **This is the classic recommender
failure and it is invisible in offline metrics, which improve as it worsens.**
*Guard:* log **impressions, not just conversions** — what was shown, in what
position, and what was *not* chosen. Impossible to reconstruct later. It must
exist before the first recommendation is ever displayed.

**M2 — Beautiful features, no labels.** *Likelihood: high.* 35 attributes per
bottle invite modelling before there is anything to predict. *Guard:* §10.5's
two-stage path; ship rules first and say so plainly.

**M3 — Trained on inferred attributes for a task that cannot tolerate them.**
*Likelihood: medium.* Note the nuance that makes provenance more valuable, not
less: **the requirement differs by task.** For *pairing*, an `inferred` typical
Barolo profile is a legitimate basis — pairing reasons about style. For *"will
this specific bottle sell here at this price"*, inferred attributes are a
guess about the very thing being predicted. *Guard:* every training set declares
its accepted tiers, and the model card records it.

**M4 — Leakage through enrichment time.** Training on today's attributes against
last quarter's sales. *Guard:* §9.3's `observed_at`.

**M5 — Cold start.** A new restaurant with no history, a new bottle with no
sales. *This is where the structure is strongest*: content features carry
recommendations from day one, which is exactly why the 4,160-row library was
worth building. Already banked.

**M6 — The pairing engine is right and nobody trusts it.** Sommeliers reject
opaque recommendations. *Guard:* keep stage 1 explainable and keep the
explanation attached to stage 2's output ("high acidity cuts the cream sauce"),
not just a score.

### 10.7 Search and browse: fast today, two things to fix before it isn't

At 4,160 rows every query is instant regardless of design, so today's speed
proves nothing about tomorrow's. The indexes are in good shape — GIN trigram on
normalized name and producer, a tsvector `search_vector`, btree on the identity
and barcode columns. Three real risks:

1. **Sensory filtering hits JSONB** (§10.3). This is the filter a pairing UI uses
   most. Fix with the same decision.
2. **`embedding` is empty** (§10.4), so there is no semantic or similarity search.
3. **`search_vector` lacks `display_name`**, so vintage is unsearchable — already
   plan §1, and it is the most visible of the three to a user typing
   "2016 Gravner".

None is a re-architecture; all three are population and indexing work.

### 10.8 The now-or-never list

Everything else in this document can be built whenever it is needed. These four
lose data permanently for every day they are not done, and they are all cheap:

| # | capture | why it cannot wait |
|---|---|---|
| ~~N1~~ | ~~Persist POS food lines~~ — withdrawn, §10.2(c). They already are (`pos-hub.service.ts:168/202`), and `getBasketAffinity` already consumes them | — |
| **N2** | **Log impressions** for anything recommended — shown, position, not-chosen | Without it the first learned model trains on its own output (M1) |
| **N3** | **`observed_at`** on enrichment writes | Point-in-time correctness cannot be retrofitted (§9.3) |
| **N4** | **Preserve provenance** through every projection | 76% of the library is `inferred`; the label is one flatten from gone |

N2 is now the highest-value line of work remaining on this list. Dish-identity
canonicalization (register A15) is deliberately **not** on it: the raw POS item
name is already stored, so nothing is lost by deciding it later — it is a
product-scope call (fuzzy-match on read? a canonical dish table fed by menu
extraction? require POS-side menu integration?) genuinely requiring the human's
input, not a data-loss risk. Escalated rather than built.

