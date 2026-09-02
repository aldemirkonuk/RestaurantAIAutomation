# 0070 — A quantity states its own unit, and stays an integer

- **Status:** Locked
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — ratified 2026-09-02 after a five-lens audit
- **Keywords:** ledger, inventory, quantity, uom, units, integer, numeric, food, conservation, OD-113
- **Links:** [[0048-domain-quant-under-research-math]], [[FOOD-REASONING-GRAPH]],
  [[LEDGER-FOOD-MIGRATION-OPTIONS]] §10, OD-113, [[0051-unknown-is-an-em-dash]],
  [[0025-citations-must-disagree-loudly]]

## Context

The inventory ledger cannot represent food. `inventory_lots.qty` and
`inventory_transactions.quantity_before/after/change` are `integer NOT NULL` and
**carry no unit column at all** — the unit is supplied entirely by a `master_wine_id`
FK meaning "bottles". `restaurant_inventory.unit_type` is CHECK-constrained to
`{BOTTLE, CASE, SHOT, GLASS}`. Verified against live production, 2026-09-02.

OD-113 framed this as one question — *widen the quantity columns to `numeric(12,3)`?* —
and framed it as expensive, "an `ALTER` of column types and nullability against live
production data". Both framings were wrong.

**It is not expensive.** Production holds **72 / 2 / 4 rows** across
`restaurant_inventory` / `inventory_lots` / `inventory_transactions`, and
`procurement_document_lines` is **empty**. Every risk argument resting on table size
is void.

**It is not one question.** There are three axes — identity, magnitude, and
**dimension** — and OD-113 collapsed dimension into magnitude without checking it.
Neither unit vocabulary in the system contains a mass unit: intake's `uom` CHECK is
`{bottle, case, keg, pack, split_case, each, liter}`. So "4.5 kg of flour is
unrepresentable" is true at intake as well as at the ledger, and OD-113's "**intake is
fine**" is wrong at the vocabulary level, not merely at the `@IsInt()` level.

`FOOD-REASONING-GRAPH`:73–83 already said this — L0 has "two sub-problems", identity
*and* unit ontology, and calls unit ontology "the class of failure that kills food
software". The dimension axis was designed nowhere.

## Options considered

The register's original framing offered five identity options and two quantity
options. A five-lens audit (premortem · scalability · longevity · operator reality ·
blast radius), each auditor ranking through one lens with no visibility of the others,
plus a prior independent adversary, is recorded in [[LEDGER-FOOD-MIGRATION-OPTIONS]]
§10. Only the quantity axis is decided here.

1. **Q1 — widen to `numeric(12,3)`.** Appeals because it matches intake's existing
   column type exactly and reads as the obvious "make it fractional" move. Costs: 8
   views dropped and recreated, **≥11 function signatures** (three of them carrying a
   live quantity in a `RETURNS` type, which a parameter-only reading misses), and
   **≥6 internal `int` locals** across `set_stock_absolute`, `transfer_stock`,
   `record_glass_pour`, `record_inventory_transaction` and the `log_inventory_change`
   trigger. PL/pgSQL rounds `numeric → int` silently on assignment, and **none of those
   locals appear in any schema diff**.

2. **Q2 — integer minor units, scale held outside the row.** Keeps integer arithmetic
   and has real precedent here (`open_bottle_ml`, `current_volume_ml`). Costs
   legibility: the unit is an implicit convention, so a wrong scale for a newly
   onboarded item is undetectable by inspecting any row.

3. **F — integer quantities, each row stating its own unit.** Not in the original
   five; it emerged from the adversarial pass. Keep `qty` as `integer`; add
   `uom NOT NULL` with a CHECK-constrained vocabulary including mass and volume base
   units; store each row in its own stated base unit. The precedent sits one table
   away: `procurement_document_lines` already pairs `qty` with a `NOT NULL uom`. F
   takes the pairing and drops the `numeric`.

4. **Do nothing.** Costs the founder's stated goal. Food stays unrepresentable, and
   L2 and everything below it in [[FOOD-REASONING-GRAPH]] stays blocked — but note
   this is *already* true and stays true until identity is also decided, so "do
   nothing" is not distinguishable from "decide quantity later" on capability grounds.
   It is distinguishable on cost: the ledger is empty **now**.

## Decision

**Quantities stay `integer`. Every ledger row carries a `uom NOT NULL` from a
CHECK-constrained vocabulary, and the canonical unit belongs to the item, not the
row.**

F won all five lenses. The reasoning that actually carried it, in order of weight:

**1. It repairs the integrity constraint instead of defeating it.** Under integer
arithmetic `before + change = after` is *exact*. Under `numeric(12,3)`,
`valid_quantity_after` **passes over both a create-from-nothing and a destroy** —
executed in production Postgres, not simulated:

| Operation | Stored | Physical consequence |
|---|---|---|
| receive 0.6 g saffron | `0.001` | **0.4 g created from nothing** — 67% of the movement |
| pour 0.6 g from a 1.000 kg lot | `0.999` | **0.4 g destroyed** |
| 1.000 depleted in three 0.333 draws | `0.001` | permanent residue lot; never depletes, never deletes |
| a real 0.4 g movement | `0.000` | trips the nonzero CHECK — a legitimate movement is *rejected* |

The CHECK passes in both directions because `v_before` is always exactly 3dp, which
makes the rounding translation-invariant. It validates that the ledger's rounded
numbers agree *with each other*, not that they match physical reality. That is this
repo's cardinal fault — **a system reporting absence as health** — sitting inside the
ledger's flagship integrity check.

**2. The money case has no catch mechanism.** `inventory_lot_rollup`'s weighted-average
cost is guarded only by `sum(qty) > 0`. With `integer` the divisor floors at 1. With
`numeric` the `0.001` residue above passes that guard and becomes the divisor —
**WAC inflated ~1000×**, into COGS and menu pricing, through three services that call
it "a real measurement". Every other failure the audit found is eventually caught by
something a restaurant already does: a physical count, a UI glance, a month-end
reconciliation. This one is caught by nothing. It lies dormant at today's 2 lots,
fires at scale, and **will be misdiagnosed as theft or waste before anyone suspects
arithmetic** — and a stored `0.999` cannot tell you afterwards whether the truth was
0.9994 or 0.9990.

**3. Two failure modes, only one of which is fixable by more decimals.** A coarse base
unit puts the floor at 1 g and a finer unit removes it — that is a choice, not a
property of `numeric`. But **one third has no finite decimal representation at any
scale**, so a fixed-point column leaves a permanent residue on any equal three-way
split forever, however many places are allowed. F does not escape this for free; it
needs remainder-safe allocation (333 + 333 + 334) in the write path. It does bound the
error at one atomic unit, where a 1 g residue against a 0.6 g saffron receipt is a
**167% error on the transaction itself**.

**4. It rebuilds nothing.** Counted, not estimated: 0 columns altered, 0 of 9 views
dropped, 0 of 93 functions resignatured, 0 `@IsInt()` decorators touched, 0 front-end
inputs broken — because no column changes type.

**5. It removes the bolt-on pattern rather than generalising it.** `open_bottle_ml`
exists only because bottles are counted, so a partial bottle needs a special column.
If a quantity is always "current amount, in the stated base unit", a half-used flour
sack is `12500 g` and no future item needs its own bolt-on.

**The unit belongs to the item, not the row.** `uom NOT NULL` requires *a* unit, not a
*consistent* one: the same flour logged in `g` on one delivery and `kg` on the next
makes `trg_project_stock_from_lots`' `SUM(qty)` add 25 to 25000 and project a nonsense
on-hand figure, with no constraint violation and no error. A per-item canonical unit is
part of this decision, not an optimisation of it.

### What was NOT decided

**The identity axis (A vs C) stays open.** F is additive and touches no identity
column, so this decision does not settle it. The founder parked it deliberately on
2026-09-02: food L0 identity is recorded as *unfalsifiable*
([[FOOD-REASONING-GRAPH]]:288), and the blast-radius lens **declared it never swept**
the gateway-query surface that fork needs. OD-113's identity half remains 🔴.

Note for whoever takes it up: the §8 argument that killed a generic `items` supertype —
that it forces an identity model up front — **was refuted**. `master_wine_library.id`
is a surrogate uuid whose `identity_key` arrived twelve days later, so this codebase
has already iterated an identity model on top of an existing table. C is revivable. It
is not thereby correct.

## Consequences

**Easier.** Food becomes representable without touching identity. Conservation is exact
on ordinary writes. `valid_quantity_after` starts meaning what it claims. A new column
is visible to schema-parity's `data_type` key, unlike the `DROP NOT NULL` the
alternative path needed — which that check is structurally blind to.

**Harder, or given up.** Every consumer must respect `uom` in every `GROUP BY`; a
cross-unit aggregate must convert or refuse rather than silently sum. Sub-atomic-unit
precision is gone by construction, so the base-unit vocabulary must be fine enough at
the outset — milligrams, not grams, for the ingredient class that needs it (saffron at
0.1–0.5 g doses, truffle at 2–5 g, vanilla, gold leaf). Extending the vocabulary later
is a CHECK change, cheap but not free. Remainder-safe allocation is now required in the
write path and is not optional.

**Explicitly out of scope, and blocking the same goal.** The intake `uom` CHECK still
has no mass unit and `@IsInt()` still rejects `4.5`, so **the receiving door stays
broken under this decision** — a receiver cannot select "kg" for a flour delivery. And
no option delivers L2: there is no `parent_lot_id` and no input→output link, so "10 kg
whole carrot → 7 kg peeled" is two unrelated transactions. Both were commissioned
separately on 2026-09-02.

**Revisit if:** a real ingredient needs finer resolution than the chosen base unit and
the vocabulary cannot express it; or a measured cross-unit aggregate proves the
`GROUP BY uom` discipline is not being kept; or the identity decision, when taken,
turns out to want dimension held somewhere other than the ledger row.

**Gate.** No migration lands before `fix/schema-parity-sees-what-it-claims` — the
parity check currently cannot distinguish `numeric(12,3)` from bare `numeric`, cannot
see nullability, function signatures, CHECK constraints, UNIQUE constraints, defaults,
or materialized views. Founder decision, 2026-09-02: fix the guard first.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Options pass | Five structural options measured; leading candidate did not survive its own adversarial pass |
| 2026-09-02 | Independent adversary | Killed "widen quantity now"; surfaced option F; refuted the argument that killed option C |
| 2026-09-02 | Five-lens audit | F wins the quantity axis 5–0; option E refused by every lens; longevity reversed its own Q1 ranking under challenge |
| 2026-09-02 | Aldemir (founder) | **Locked.** Quantity axis ratified as F; identity axis parked deliberately |
