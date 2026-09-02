---
type: reference
title: Food Reasoning Graph
status: adversarially verified 2026-08-31 — layer model locked by ADR 0048; per-layer state is point-in-time
updated: 2026-08-31
links: ["[[0048-domain-quant-under-research-math]]", "[[DISH_IDENTITY_DESIGN]]", "[[ANALYTICS_FEATURE_CATALOG]]", "[[research-math-charter]]", "[[backtests-charter]]", "[[OPEN-DECISIONS]]"]
---

# The food-reasoning graph — what must be computed, in what order

> The dependency structure behind the founder's goal, *"turn food into math"*
> (2026-08-31). Produced by five parallel research passes and one dedicated
> adversarial verification pass; **six of twelve load-bearing claims were killed or
> downgraded by the adversary**, and this document carries the surviving versions.
> Claims the adversary rejected are recorded in
> [[0048-domain-quant-under-research-math]] rather than deleted, so the wrong version
> cannot circulate again.
>
> *Retire-to-write (CLAUDE.md §4): this document supersedes nothing — it is the first
> statement of a structure the corpus never held. Its cost is paid by absorbing the
> five session research reports, which are not committed anywhere; this is their
> only durable form.*

## 0. Why a graph and not a list

"Turn food into math" is not one problem. It is seven bodies of knowledge with a
**forced execution order**, because each consumes the output of the one before it.
The order is not a preference and cannot be resequenced by prioritisation: you
cannot compute a dish's contribution margin without its plate cost, you cannot
compute plate cost without a yield factor and a recipe, and you cannot hold either
without a unit model and a ledger able to represent a non-beverage item.

That is the finding. Everything below is its detail.

## 1. The layers

```
L0  IDENTITY & UNITS        product identity · unit ontology · pack size · density
        │
L1  LEDGER TRUTH            invoice lines · lots + cost basis · transactions
        │                   → on-hand quantity, WAC
        │
L2  TRANSFORMATION  ◄── THE KEYSTONE
        │                   yield factors (AP→EP) · recipe/BOM · sub-recipe rollup
        │                   → plate cost
        ├──────────────┬──────────────────┐
        │              │                  │
L3  CONSUMPTION    L4 DEMAND          L5 DECISION
    theoretical vs     covers → attach     inventory (newsvendor)
    actual usage       → dish → BOM        pricing (elasticity)
    → variance         → ingredient        menu (CM × popularity)
        │              → F(demand)              │
        └──────────────┴──────────────────┬─────┘
                                          │
L6  VALIDATION                            ▼
    walk-forward backtest · holdout · outcome re-grade · prediction ledger
    └──────────── feeds back into every layer above ────────────┘
```

### L0 — Identity and units

The layer everything else silently assumes. Two sub-problems.

**Product identity.** Is a case of tomatoes from vendor A the same product as from
vendor B? Solved for beverages, and solved well: the identity key was validated
against **732,874 known-distinct pairs with zero false merges**
(`scripts/eval_merge_policies.py`), and that harness killed three earlier designs,
one of which committed 212 false merges. Food has no equivalent, and
[[DISH_IDENTITY_DESIGN]] records why: no negative-label source, so the problem is
currently **unfalsifiable**. Caveat worth carrying: the beverage harness has 732,874
negatives against **12 positives**, so it is barely powered on false *splits*.

**Unit ontology.** The class of failure that kills food software. Three conversion
classes:

| Class | Example | Requirement |
|---|---|---|
| Lossless | kg ↔ lb | Fixed factor within one dimension |
| Constant-dependent | case → each; cup → gram | A per-product pack size or density. Correct **only** if that constant is known *for that product* |
| Irreducibly ambiguous | "1 bunch"; "1 cup chopped onion" against whole onions by the pound | Cannot resolve without a yield step — i.e. requires L2 |

The repo's `normalizeUom`/`toBottles` **refuse rather than guess**. That is the right
discipline and should be the model for the food equivalent.

### L1 — Ledger truth

What is on hand and what it cost. The repo's genuine strength: procurement documents
and lines with tie-out deltas, UoM, pack and freight split; `inventory_lots` carrying
cost provenance; `cost-basis.ts` reporting coverage rather than silently averaging a
partial set.

**But the ledger is beverage-shaped at the column level.** Verified across all
migrations in their latest state: `restaurant_inventory.master_wine_id`,
`inventory_lots.master_wine_id` and `inventory_transactions.wine_id` are `NOT NULL`;
quantity columns are `integer`. No generic item path, no polymorphic type column, no
food table; `beverage_kind`'s CHECK list is all drinks.

> **Superseded in part, 2026-09-02 — see [[LEDGER-FOOD-MIGRATION-OPTIONS]].** The
> structural claim above survives re-measurement; two things around it did not. The
> denominator was **"all 64 migrations"** and there are now **87** — corrected in place
> above rather than carried forward, per [[0025-citations-must-disagree-loudly]]. And
> the scoping correction below is **false at the API boundary**: `procurement_document_lines.qty`
> is indeed `numeric(12,3)`, but **14 `@IsInt()` quantity fields across 5 DTO files**
> reject `4.5` with a 400 before it ever reaches that column. Intake cannot accept 4.5 kg
> of flour today either. Also material to any plan built on this section: the tables in
> question hold **72 / 2 / 4 production rows**, so the migration OD-113 describes as an
> `ALTER` against live data is nearly free — the constraint here is modelling, not cost.

**Scoping correction, and it narrows the migration materially:**
`procurement_document_lines` is already `numeric(12,3)` with a seven-value `uom`
CHECK. **The break is at the ledger** — and, per the note above, at the API boundary.
→ **OD-113**.

### L2 — Transformation · the keystone

The only bridge between *ingredient* and *dish*. Two halves.

**Yield factors.** AP (as-purchased) → EP (edible portion): trim loss, bone, cooking
loss — and cooking *gain*, because rice, pasta and legumes absorb water. Public
sources:

| Source | Contains | Usable? |
|---|---|---|
| USDA Agricultural Handbook 102 | 2,894 items, average yield + range, losses decomposed | **1975 scan with no text layer** — `pdftotext` on the 2.8 MB file returns 12 bytes. An OCR project, not a download |
| USDA Cooking Yields R2 (2014) | `Yield% = 100 × W_ch/W_cr`; **cooking loss only** | Yes. Trim and bone excluded by construction, so it *multiplies* with AH-102 rather than replacing it |
| USDA FoodData Central | `food_component.is_refuse/pct_weight`, `food_portion.gram_weight` | Yes — the machine-readable hooks |
| Book of Yields | The industry standard | **Commercially licensed. Cannot be ingested** |
| BCcampus culinary text | Complete open treatment, worked formulas | **CC BY 4.0** — the only open complete source; quotable in-product |

**Note the repo's `yield_factor` is *purchase/trim* yield and is correctly ≤1.**
Cooking gain is a different quantity and **that column does not exist** — a gap to
fill, not a bug to fix. (An earlier research pass called the ≤1 constraint a defect;
the adversary refuted it.)

**Recipe / BOM.** `dish = Σ(ingredient × quantity × yield)`, recursive through
sub-recipes, requiring cycle detection. **Absent entirely from the repo.** The one
ingredient table that exists (`cocktail_ingredients`) states in its own migration that
it is created empty and stays empty by design.

> **A public BOM prior exists, and it is the keystone's exact shape — verified
> in-session 2026-08-31 by downloading and parsing the file, not by citation.**
> **USDA FNDDS** (Food and Nutrient Database for Dietary Studies, 2021–2023 release)
> ships `FNDDS Ingredients` as an Excel workbook whose columns are
> `Food code · Main food description · Seq num · Ingredient code · Ingredient
> description · Ingredient weight (g) · Retention code · Moisture change (%)`.
> Measured counts, reproduced independently:
>
> | Measure | Count |
> |---|---|
> | Ingredient rows | **18,584** |
> | Distinct dishes | **5,431** |
> | Dishes with ≥2 ingredients | **3,829** |
> | Dishes carrying a non-zero cooking `Moisture change (%)` | **976** |
>
> Two consequences. First, `Moisture change (%)` **is the cooking-yield quantity this
> section records as a missing column** — it is public, machine-readable, and free.
> Second, it is filed as a *nutrition-survey* artifact rather than a costing one, which
> is the likely reason restaurant software does not appear to use it.
>
> **It is a prior, not truth.** Weights are national consumption-weighted averages, so
> FNDDS says what "beef stew" contains in America, never what it contains in this
> kitchen. That is exactly the right role: a starting BOM to be corrected per tenant,
> which is a far cheaper problem than eliciting one from nothing.

**Licensing traps, verified — do not reach for the famous corpora.** RecipeNLG and
Recipe1M+ are **non-commercial-research-only**: hard blockers for a commercial product.
Food.com/Kaggle recipe sets could not be verified and carry a second problem — an
uploader cannot grant rights they never held. FNDDS is public domain and is the only
large corpus of this kind that is usable here.

**A deterministic problem with two correct answers.** The butcher's-test by-product
credit yields **$21.78/kg vs $23.35/kg for the same pork loin** depending on method —
a 7.3% difference on the plate, both textbook-correct, both surviving any
exact-equality check. This is why costing methodology is *research* and not
arithmetic: choosing the definition is the work, and no conformance test can choose
for you. → **OD-114**.

### L3 — Consumption truth

POS sales → dish → (through L2's BOM) → ingredient depletion = **theoretical** usage.
Physical counts → **actual** usage. The gap contains shrinkage, waste, theft and
portion drift — the most operationally valuable number in restaurant operations, and
one that is *arithmetically unreachable without L2*.

### L4 — Demand

The cascade that makes cold-start tractable: **covers** (dense from day one) → attach
rate (dish | cover) → dish demand → through the BOM → ingredient demand.
`pos_checks.covers` and `server_sales.covers` are already captured and read today
**only** by a logs timeline and the team page — the most under-exploited asset found.

Two binding method commitments, both currently violated:

1. **The deliverable is a distribution, not a point.** The newsvendor needs
   `F⁻¹(critical ratio)`, not `E[D]`. Point forecast plus assumed distribution is the
   common shortcut and it is wrong.
2. **Never select on MASE or MAPE.** MAE-family metrics are minimised by the
   conditional median, which for intermittent demand is **zero** — optimising them
   drives the model toward forecasting nothing, then holding no safety stock. Use
   RMSSE for point error, pinball loss at τ = critical ratio for selection.

Known data hazards at this layer: day bucketing is UTC while `restaurants.timezone`
exists and is ignored, which smears day-of-week — the strongest restaurant signal —
before any model sees it; and consumption is filtered on write time (`created_at`)
rather than event time, so a historical backfill would collapse the whole history
onto one date.

### L5 — Decision

**Inventory.** Newsvendor with a critical ratio computed from real overage/underage
costs — not the hardcoded `serviceLevel = 0.95` that currently asserts `Cu/Co = 19`
for every SKU. Plus case-pack constraints (you cannot order 1.4 cases), shelf life,
and per-vendor lead-time variance — which is *already computed* in the repo and never
passed to the safety-stock function that accepts it. The cheapest correctness win.

**Pricing.** Elasticity is a **category-level, partially-pooled, cross-tenant**
estimand, never per-dish. Pinning one dish to ±0.5 at 95% needs ~960 units per arm at
a 20% price gap; a 10% move on 100 units per arm returns a **±2.9** interval that
contains both "raise the price" and "halve it". Cross-tenant pooling is therefore
required — and unauthorised. → **OD-115**.

**Menu.** Kasavana–Smith is a ranking heuristic, not a model: its 70% popularity
threshold is admittedly subjective, and because it scales with category size,
**splitting a category in two re-classifies items with no change in the world**.
Forty years of successors (Pavesic, Hayes & Huffman, Bayou & Bennett, LeBruto's
labor model, ABC costing, DEA) each fix one cost dimension and **none models demand
response** — so every "action per quadrant" in the literature is an untested causal
assertion.

The psychology claims fare worse. Separated by evidence quality:

| Claim | Status |
|---|---|
| "Golden triangle" eye path | **Rejected** by the only eye-tracking study of it (n=25; reading is book-like) |
| Descriptive labels "+27%" | **Tainted** — traces to a lab found to have falsified data |
| Menu decoy / attraction effect | **Weak** — 11 reliable effects in 91 attempts for realistic products |
| Serial position (edges win ~55%) | **Survives** — lab n=240 plus field n=951 |
| $9-endings | **Survives in retail field data**; restaurant transfer unproven |

### L6 — Validation · the loop that closes

The repo already holds the *pattern* worth copying: ground truth free from a fact
about the world, error types never summed, rejected alternatives scored in the same
run, fails closed, grows for free with new data. It also already holds the ledger —
`prediction_outcomes`, with `predicted_value` / `actual_value` /
`prediction_made_at` — **migrated and written to by nothing**.

Nothing in the repo currently backtests a forecast, a reorder point, an elasticity,
or an insight. The existing "backtest" scores against an in-sample fit whose
`fitted[i]` is pushed *after* the state absorbs `series[i]`, so it is not a
one-step-ahead forecast; every accuracy number it reports is optimistically biased by
construction, and the leakiest model is the only one that runs against a dense series.

**Two standing hazards, both structural:**

- **Regression to the mean.** The architecture flags outliers, acts on outliers, then
  measures outliers. Under that design *random* recommendations report a win. A
  holdout is not optional; it is the only thing separating a real effect from
  arithmetic. A rollout bucketer already exists and is unused by the one pre/post
  loop in the product.
- **Multiple comparisons.** A 40-item menu generates 780 pairwise basket tests. No
  false-discovery control exists anywhere in what is structurally a
  multiple-comparisons machine.

## 2. What the graph implies

**One keystone.** L2 gates L3, L4's translation step, and L5's margin axis
simultaneously. It is the only node with that property, so sequencing arguments about
which discipline to staff first are downstream of it and largely moot until it exists.

**The order is forced.** L0 → L1 → L2 → (L3 ‖ L4) → L5, with L6 wrapping all of them.

**Most of L5 already exists and is unwired.** `newsvendorOrder`, `seasonalNaive`,
`fillRate` and a pricing engine that handles endogeneity correctly — exported,
tested, catalogued, **zero callers**. The gap is not capability: nothing converts a
forecast into an order, and nothing validates the conversion.

**Beverage works because a bottle is a natural unit.** Every capability that exists
today rests on that single fact. Food has no natural unit — which is precisely why L0
and L2 *are* the problem rather than an implementation detail.

**The keystone is seeded, not empty — and that reorders the cheap work.** FNDDS
supplies a public BOM prior and a cooking-yield figure at zero acquisition cost, so
L2 does not start from nothing. The corollary is a sequencing argument worth stating:
the durable version of L2 is **not** an elicitation project (interviews, yield-test
kits) but an **inference** one — recovering BOM coefficients and yields from the
tenant's own receiving-versus-sales data as a regularised inverse problem, with
FNDDS and AH-102 as priors. That has zero marginal data cost, compounds across
tenants, and cannot be bought. Its four real identification problems — collinearity
between co-purchased ingredients, waste and yield confounded in the same residual,
inventory-count noise, and recipe drift over time — are where it succeeds or fails,
and are the honest research agenda for this layer. Yield-test kits are then a
*follow-on* that resolves specific unidentified coefficients, rather than a programme
to run first.

## 3. Where each layer stands today

| Layer | State | Blocker |
|---|---|---|
| L0 identity | Beverage: strong, falsified at scale. Food: **unfalsifiable** | No negative-label source ([[DISH_IDENTITY_DESIGN]]) |
| L0 units | Intake *column* correct (`numeric(12,3)` + UoM CHECK) but its **DTOs are `@IsInt()`** (14 fields, 5 files); ledger integer-only | OD-113 |
| L1 ledger | Strong for beverage; **cannot represent food** | OD-113 |
| L2 yield | Column exists for trim yield; **no cooking-yield column** — though FNDDS `Moisture change (%)` supplies that quantity free for 976 dishes | AH-102's finer-grained data needs OCR (3–5 days; three free integrity checks make it a safe target) |
| L2 BOM | **Absent in the repo**; a public-domain prior of the right shape exists (FNDDS, 18,584 rows / 5,431 dishes) | The keystone — but seeded, not from zero |
| L3 variance | **Unreachable** | Requires L2 |
| L4 demand | Primitives correct; plumbing leaks (UTC bucketing, write-time filter, in-sample backtest) | Method commitments in §L4 |
| L5 inventory | Built, **zero callers**, hardcoded service level | Lane A |
| L5 pricing | Best module in the repo, **fully unwired** | Lane A |
| L5 menu | Live path median-splits while citing Kasavana–Smith; no sample-size gate | — |
| L6 validation | Ledger migrated, **nothing writes to it**; no backtest of any numeric claim | Backtests team's entry trigger |
