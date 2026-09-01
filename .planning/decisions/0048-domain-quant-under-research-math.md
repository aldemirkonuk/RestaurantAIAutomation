# 0048 — "Food into math" folds into Research & Math; the keystone is transformation, and the program runs both-sequenced

- **Status:** **Locked 2026-08-31** on two founder calls made in-session via
  `AskUserQuestion` — placement ("Fold into Research & Math") and program shape
  ("Both, sequenced"). The team carve below is **proposed, not locked**: the founder
  redirected that question toward depth of operating detail before answering it, so
  §4 records the argued shape and §7 keeps the fork open.
- **Date:** 2026-08-31
- **Decider:** Aldemir (founder) — placement and program shape; Claude — the layer
  model and the carve, recorded for the founder to lock or overrule
- **Keywords:** food-into-math, domain-quant, yield, BOM, recipe, newsvendor, demand,
  menu-engineering, elasticity, research-math, keystone, ledger
- **Links:** [[0001-mudavym-single-entity]], [[0007-org-structure]],
  [[0008-nf-column-contract]], [[0009-loop-vocabulary-contract]],
  `01-org/research-math/research-math-charter.md`,
  `01-org/research-math/teams/backtests/backtests-charter.md`,
  `07-reference/FOOD-REASONING-GRAPH.md`, `07-reference/DISH_IDENTITY_DESIGN.md`

## Context

The founder stated the goal as **"turn food into math"** and asked the framing
question directly: *who do I need to reach to complete this goal, and who do I need
to reach to use their knowledge, and what fields.* The question is an org and
sequencing question before it is a hiring question, and the corpus could not answer
it: `Research & Math` exists as a division ([[0007-org-structure]],
`foundation/ORG_STRUCTURE.md` §2) but its charter is entirely about **AI-agent
infrastructure** — model routing cost, doneability grading, NF-A telemetry. Nothing
in 99 units owns yield, portion cost, demand, or price.

Six research passes ran (five parallel finders plus a dedicated adversarial
verification pass, per CLAUDE.md §3). The adversary killed or downgraded six of
twelve load-bearing claims. What follows is what survived it.

## Decision

### 1. Domain quantitative research folds into the existing Research & Math division

Not a new division. Research & Math already carries the four structural
compensations granted when the founder's two-company split was declined
([[0001-mudavym-single-entity]] review trail): division-level standing,
metrics that are not shipping velocity, a long-horizon schedule product deadlines
cannot preempt, and advisory independence. Domain quant needs exactly those
protections and inherits them at zero cost. Its identity broadens from *"how well
does our AI think"* to *"how well do we model a restaurant, and can we prove it"* —
which is the honest reading of what the division was always for.

**A second reason, decisive on inspection:** the division already contains a
**Backtests** team whose mandate is written generically enough to cover this work
unchanged — *"Backtest everything the company claims, for every unit — not only
models… any published number — insight counts, recovered dollars, vendor
scorecards, **forecast accuracy** — is fair game for replay"*
(`teams/backtests/backtests-charter.md`). The validation layer for the entire
program is already chartered. It has never run because nothing yet produces a
quantitative claim worth replaying. This decision produces them.

### 2. The work is a graph with a forced order, and it has exactly one keystone

Full model in [[FOOD-REASONING-GRAPH]]. Seven layers:

```
L0 identity & units → L1 ledger truth → L2 TRANSFORMATION
                                          ├→ L3 consumption truth
                                          ├→ L4 demand
                                          └→ L5 decision
                                    L6 validation wraps all of them
```

**L2 — yield factors plus recipe/BOM — is the keystone**, and it is the only node
with this property: it is the sole bridge between *ingredient* and *dish*, so it
gates three things simultaneously —

1. **L3**, theoretical-vs-actual usage variance (the shrinkage/waste/portion-drift
   number, arithmetically unreachable without it);
2. **L4's translation step**, dish demand → ingredient demand, without which a
   forecast cannot become an order;
3. **L5's margin axis**, without which contribution margin — and therefore all menu
   engineering and all pricing — is guessing.

The order is forced, not chosen. No prioritisation reorders it.

### 3. The program runs both-sequenced

**Lane A, now — wire the beverage decision layer.** The machinery already exists,
is tested, and has **zero callers**: `newsvendorOrder`, `seasonalNaive`, `fillRate`,
and `engine/pricing-agility.ts` (which handles pricing endogeneity correctly by
excluding agent-accepted price points). `prediction_outcomes` — a forecast-accuracy
ledger with `predicted_value` / `actual_value` / `prediction_made_at` — is migrated
and written to by nothing. Wiring this proves L6 end-to-end on a domain where L0–L2
already work, because **a bottle is a natural unit**.

**Lane B, in parallel — design the food ledger and BOM.** Informed by Lane A's
proof, not blocked on it. **The keystone is seeded rather than empty:** USDA FNDDS
ships a public-domain, machine-readable dish→ingredient BOM — **18,584 ingredient
rows across 5,431 dishes, 3,829 with ≥2 ingredients, and 976 carrying an explicit
cooking `Moisture change (%)`**, which is precisely the cooking-yield quantity the
repo has no column for. Counts verified in-session by downloading and parsing the
workbook, not by citation. It is a *prior*, not truth — national
consumption-weighted averages, so it says what a dish contains in America, never
what it contains in this kitchen — but correcting a starting BOM per tenant is a far
cheaper problem than eliciting one from nothing. Recorded in
[[FOOD-REASONING-GRAPH]] §L2 with the licensing traps that rule out the better-known
corpora (RecipeNLG and Recipe1M+ are non-commercial-research-only).

Rationale for running both rather than picking: Lane A is cheap, already built, and
exercises the whole graph on the one domain where the foundations hold; Lane B is a
design problem on live production data that benefits from that proof existing first.

## Evidence — what the adversarial pass confirmed

**The ledger cannot represent food.** Verified across all 64 migrations in their
*latest* state, not just the baseline: `restaurant_inventory.master_wine_id`,
`inventory_lots.master_wine_id` and `inventory_transactions.wine_id` are all
`NOT NULL`; quantity columns are `integer`, so 4.5 kg of flour is unrepresentable.
No generic item path, no polymorphic type column, no food table; `beverage_kind`'s
CHECK list is all drinks. **No BOM exists anywhere** — `cocktail_ingredients` is
created empty and its own migration says it stays empty by design.

**Scoping correction from the adversary, and it narrows the migration materially:**
`procurement_document_lines` is already `numeric(12,3)` with a seven-value `uom`
CHECK. **Intake is fine. The break is specifically at the ledger.**

**Beverage capability rests entirely on one fact:** a bottle is a natural unit.
Food has no natural unit, which is why L0 and L2 are the whole problem rather than
an implementation detail.

## What the adversary killed — recorded because the wrong version circulated first

Per CLAUDE.md §0.5, these were reported to the founder before verification and are
corrected here rather than quietly dropped.

| Claim as first made | Verdict |
|---|---|
| Margin math is inverted; GMROI improves as dead stock grows | **Mostly wrong.** `cogs` *is* used two lines later; `grossMargin`/`gmroi` are scale-invariant. Only `primeCostRatio` moves, and the function labels its own proxy. All four metrics have **zero hits** across `apps/web` and `apps/mobile` — nothing is on a screen |
| X12 `CS` line with no PO4 books 2 cases as 2 bottles — live 12× data corruption | **Real defect, wrong severity.** Receiving quantities are human-typed, not auto-filled from the document. A bad `qty_bottles` *breaks* exact-equality line matching into human review rather than corrupting stock. **No incident** |
| `yield_factor ≤ 1` is an incorrect constraint because cooking yields exceed 1.0 | **Refuted.** `yield_factor` is purchase/trim yield, ≤1 by definition and stated twice in its migration. Cooking gain is a *different* quantity, and that column does not exist — which is a gap, not a bug |
| The engine has ~87 tests | **Dissolved.** 141 in `analytics/engine`, 149 across `analytics/`; two agents counted different scopes and both were right |

## Method commitments this decision locks

Three findings are counterintuitive enough, and currently violated often enough,
that they are recorded as binding rather than left to implementation taste.

1. **The forecast deliverable is a distribution, not a point.** The newsvendor needs
   `F⁻¹(critical ratio)`, not `E[D]`. Point forecast plus an assumed distribution is
   the common shortcut and it is wrong. The live `serviceLevel = 0.95` hardcode
   asserts `Cu/Co = 19` for every SKU; replacing it with a computed critical ratio
   is the single highest-leverage correctness change in the inventory math.
2. **Never select models on MASE or MAPE.** MAE-family metrics are minimised by the
   conditional median, which for intermittent demand is **zero** — optimising them
   drives the model toward forecasting nothing and then holding no safety stock.
   Use RMSSE for point error and pinball loss at τ = critical ratio for selection.
3. **Elasticity is a category-level, partially-pooled estimand, never per-dish.**
   The arithmetic: a 10% price move on 100 units per arm returns a ±2.9 confidence
   interval that contains both *"raise the price"* and *"halve it"*.

And one standing hazard: **the architecture is structurally a regression-to-the-mean
machine** — it flags outliers, acts on outliers, then measures outliers. Under that
design *random* recommendations report a win. A holdout is not optional.

## Alternatives rejected

**Its own division.** Cleaner identity — "how our AI performs" and "how we model a
restaurant" are genuinely different research programs. Rejected: it reopens OD-18
(division count, already deferred), and every structural protection would have to be
rebuilt from scratch when an existing division already carries them and already
contains the validation team this work needs.

**Commit to food first.** Highest ceiling, and the founder's goal as stated.
Rejected as the *whole* program because it is an `ALTER` on a live production
ledger with everything downstream waiting on it, while a fully-built decision layer
sits unwired and unproven three feet away.

**Deepen beverage only, treat food as v2.** Fastest to defensible numbers. Rejected:
it answers a narrower question than the one the founder asked.

**Seven teams, one per discipline.** Rejected on the org's own measured evidence:
OD-26/OD-43 record 15 split triggers against 3 merge triggers, and this division has
zero people and zero shipped domain code. Seven units would be scaffolding around an
empty room — the failure mode `research-math-charter.md` already names for T4.

## Consequences

- Research & Math's mandate widens beyond agent infrastructure. Its charter must be
  amended, and the **division-vs-department contradiction open since 2026-08-24**
  ([[0001-mudavym-single-entity]]'s review trail says *division*;
  `research-math-charter.md` still reads `Parent division: Intelligence`) must be
  closed in the same pass — the charter's own fork box has been asking for two months.
- The **costing seam** sharpens rather than resolves. `research-math-charter.md`'s
  non-goals hand *"grading deterministic arithmetic against a ledger"* to Analytics
  & BI's AB-3. Costing **definition** is not conformance: the butcher's-test
  by-product credit returns **$21.78/kg vs $23.35/kg for the same pork loin** — a
  7.3% difference on the plate, both textbook-correct, both surviving any
  exact-equality check. Filed as a fork (§7), because two units chartered on one
  mandate is the defect shape this org has already hit twice (OD-29, the evaluation
  seam).
- **Cross-tenant pooling is required and unauthorised.** Elasticity and cold-start
  priors both need it. Nothing in `.planning/` records a DPA or ToS, so nothing says
  whether it is contractually permitted. Default until answered: tenant-local only.
- Production has **10 restaurants, 1 real tenant, and no column distinguishing a
  fixture from a customer**, so a pooled analysis run today would report nine
  fixtures' shape as the world.

## Forks this raises — filed, not decided

Registered as **OD-113 … OD-117** in [[OPEN-DECISIONS]]. **Numbering note:** the
register on `main` ends at OD-111, but the next id after it is already claimed by an
unmerged row on `feat/mudavym-design-p3`, so this ADR starts at 113 to avoid the
collision — a sweep of all 312 branches also found ADR numbers 0044–0047 taken, with
**0045 and 0047 each carrying two different files**. The register-row-first rule
([[0046-withdrawn-marks-and-mark-colour-risk]]) was applied before any of this was
written.

| Fork | Question |
|---|---|
| OD-113 | Ledger shape — does the core inventory ledger get altered to admit non-beverage items, and on what migration path against live production data? |
| OD-114 | Costing seam — where is the line between costing *definition* (research) and arithmetic *conformance* (Analytics & BI AB-3)? |
| OD-115 | Cross-tenant pooling — is it contractually permitted, and where is that recorded? |
| OD-116 | The team carve — three teams (deterministic · stochastic · decision-economics), or one unit that splits on evidence? |
| OD-117 | Research artifact shape — does a research unit need object types the standard 8/9-artifact template does not provide, and what does adding them retire? |
