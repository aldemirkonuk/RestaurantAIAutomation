# 0075 — Four base units, filled from the item, allocated remainder-safe

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** ledger, uom, units, milligram, allocation, remainder, largest-remainder, canonical unit, depleted lot, OD-113, OD-118
- **Links:** [[0070-a-quantity-states-its-own-unit]] (the decision this implements),
  [[0051-unknown-is-an-em-dash]], [[0048-domain-quant-under-research-math]],
  [[LEDGER-FOOD-MIGRATION-OPTIONS]] §10,
  `supabase/migrations/20260902120000_ledger_unit_typed_quantities.sql`,
  `apps/api-gateway/src/inventory-ledger/ledger-units.ts`,
  `scripts/check_ledger_units.py`

## Context

[[0070-a-quantity-states-its-own-unit]] is Locked: ledger quantities stay
`integer`, every ledger row carries a `uom NOT NULL` from a CHECK-constrained
vocabulary, and **the canonical unit belongs to the item, not the row**. It
deliberately left three things open, each of which changes what gets built:

1. **What the vocabulary is.** 0070 says only "fine enough at the outset —
   milligrams, not grams, for the ingredient class that needs it", and that
   "extending the vocabulary later is a CHECK change, cheap but not free".
2. **How the item's canonical unit is enforced.** 0070 §10.5 states the
   requirement — a lot must not be able to disagree with its item — and names no
   mechanism.
3. **What "remainder-safe allocation" is**, which 0070 makes *required, not
   optional*, because one third has no finite representation at any scale.

Measured state, 2026-09-02: `restaurant_inventory` 72 rows (`stock_live = 0` on
71), `inventory_lots` 2, `inventory_transactions` 4,
`procurement_document_lines` 0. The ledger is effectively empty, which is the
only moment any of this is free.

## Options considered

### A. The vocabulary

1. **`{each, bottle, mg, ml}` — base units only.** *(chosen)* A base unit cannot
   be decomposed into a smaller unit of the same dimension and its meaning does
   not depend on a pack size, a bottle format, or a serving policy.
2. **Add `g`/`kg`/`l` as accepted units.** Appeals because operators speak them.
   Costs the entire guarantee: admitting both `g` and `kg` *is* the 25-vs-25000
   failure 0070 §10.5 names. Rejected — the operator still types "4.5 kg";
   `convertToBase` turns it into 4 500 000 mg at the edge, where the
   multiplication is exact.
3. **Mirror intake's seven singulars** (`bottle, case, keg, pack, split_case,
   each, liter`). Appeals as consistency. Costs pack arithmetic inside the
   ledger — the bug `toBottles` exists to prevent at intake, moved one table
   deeper. Rejected.
4. **`ul` instead of `ml` for volume, for symmetry with `mg`.** This is the
   close call and it was argued both ways. Against: every neighbouring column in
   the repo is millilitres — `open_bottle_ml`, `pour_size_ml`, `bottle_size_ml`,
   `current_volume_ml`, `format_ml` — so `ul` puts a permanent 1000× conversion
   at every boundary, forever, in a system whose whole premise is that a
   boundary must not be able to lie about scale. For: a drop (~0.05 ml) or a
   dash of bitters (~0.9 ml) sits at or under an `ml` floor. **Rejected on the
   failure-mode asymmetry**, which is the part that decided it:

   | | at the coarse unit | consequence |
   |---|---|---|
   | saffron 0.1 g at `g` | rounds to 0, or to 1 | routine doses unusable — the ingredient class cannot be logged at all |
   | bitters 0.9 ml at `ml` | 1 ml, an 11% error | rare in ledger terms, and bounded |
   | a drop 0.05 ml at `ml` | rounds to 0 | **rejected by `valid_quantity_change`** — a loud refusal, not a silent wrong number |

   `mg` over `g` is mandatory because gram resolution makes saffron
   *unrepresentable*. `ml` is sufficient because the sub-millilitre class fails
   *loudly*, and ADR 0051's rule is that a refusal beats a confident zero.

### B. Enforcing the item's canonical unit

1. **A CHECK constraint.** Cannot reference another table. Dead on arrival.
2. **A composite foreign key alone**, `(inventory_id, uom) → restaurant_inventory
   (id, canonical_uom)`. Declarative and unbypassable, but every existing INSERT
   omits the unit, so `apply_stock_movement`, `transfer_stock`,
   `record_glass_pour`, `log_inventory_change` and `sync_lots_from_inventory`
   would all need rewriting — exactly the rebuild cost 0070 chose option F to
   avoid.
3. **A new `p_uom` parameter on the write RPCs.** Makes the unit an *input*. A
   writer that can state a unit is a writer that can state the wrong one, which
   contradicts "the unit belongs to the item".
4. **A BEFORE trigger that fills from the item, or refuses.** *(chosen)*

### C. Allocation

1. **`Math.round(total / n)`.** 1000 three ways gives 999 or 1002. Rejected by
   0070 already; kept in the tree only as `naiveEqualSplitForComparison`, whose
   sole caller is the test that demonstrates it is lossy.
2. **Largest-remainder (Hamilton).** *(chosen)* Floor every share, then hand the
   leftover units out one at a time to the largest fractional remainders, ties
   to the last index.
3. **A tolerance rule** — accept sums within ±1. Rejected: that is the
   `valid_quantity_after`-passes-over-a-destroy shape 0070 was written to end.

## Decision

**The ledger vocabulary is `{each, bottle, mg, ml}`; a BEFORE trigger fills a
row's `uom` from its item's `canonical_uom` and refuses one that disagrees, with
a composite foreign key underneath as a declarative backstop; and apportionment
uses the largest-remainder method.**

What carried each:

**Vocabulary.** The base-unit rule is what makes the vocabulary decidable rather
than a taste question: it excludes pack units and coarse duplicates by
construction, and it leaves exactly one candidate per dimension once `mg` is
settled. `mg` over `g` is not a preference — at gram resolution a routine
saffron dose is unloggable. `ml` over `ul` is the asymmetry table above.

**Enforcement.** Fill-from-item is stronger than refusal *and* cheaper: it
satisfies "a quantity can never be written without a unit" by construction
rather than by erroring, and because `NOT NULL` is checked *after* BEFORE
triggers run, **zero existing INSERT statements change**. The composite FK sits
underneath for any path that bypasses the trigger — `psql`, another service, a
future function. Its `ON UPDATE RESTRICT` is load-bearing and CASCADE would be a
corruption bug: cascading a `canonical_uom` change would relabel a lot from `mg`
to `ml` *without rescaling `qty`*. RESTRICT instead blocks the parent update
until the lots are converted, which makes re-basing an item an explicit rescale.

`inventory_transactions` gets the trigger but **no** foreign key, deliberately.
That table has no FK on `inventory_id` today, so adding one would introduce
delete-time coupling that does not exist: CASCADE would destroy ledger history
when an item is merged or deleted, and NO ACTION would block merges that succeed
today. A ledger row is an audit record; it must outlive its subject.

**Allocation.** Largest-remainder conserves the total exactly for every input,
is deterministic, and bounds each share's error at one atomic unit. Ties break
toward the last index so an equal three-way split of 1000 gives `[333, 333, 334]`
— the shape 0070 names literally.

### Also decided here: a depleted lot is marked, not deleted

Folded in on founder instruction, 2026-09-02, because it edits the same
function. `apply_stock_movement`'s FIFO loop `DELETE`d a lot that a draw exactly
emptied. Three consequences, each verified against this tree: `status` declared
`'depleted'` in its CHECK (`baseline:3191`) and **nothing ever set it**, so
`analytics/engine/cost-basis.ts`'s status filter has been a dead branch since it
was written; any foreign key to an input lot was unstable by construction, which
blocks the L2 transformation primitive; and the consumed lot's own `unit_cost`
was discarded, since the ledger row records the *caller's* `p_unit_cost`.

An emptied lot is now `qty = 0, status = 'depleted'` — the status set **only
when `open_bottle_ml = 0` too**, because a lot with wine left in an open bottle
has not been depleted whatever its sealed count says. That last clause also
repairs a silent loss: the `DELETE` destroyed `open_bottle_ml` along with the
row.

**This makes lot-level cost attribution possible. It does not implement it.**
Writing the *consumed lot's* real cost into the transaction row is a separate
change and is not made here.

## Consequences

**Easier.** Food is representable without touching identity. A ledger row is
self-describing to a cold reader. `status = 'depleted'` means something for the
first time, and a lot id is stable enough for a transformation to point at. The
one-query mixed-unit detector 0070 §10.5 asked for is now evaluated on every
read, as `inventory_lot_rollup.distinct_uom_count`.

**Harder, or given up.** Sub-milligram and sub-millilitre precision is gone by
construction — such a movement is refused, not stored wrong. Re-basing an item's
unit requires converting or clearing its lots first. Depleted lots accumulate:
roughly 52k rows a year for a 500-item restaurant depleting two lots per item
per week, which is nothing for Postgres but is why the FIFO scan now has a
partial index (`idx_inventory_lots_fifo_open`, `WHERE qty > 0`). Every consumer
that filtered on *presence* rather than `qty > 0` had to be found and fixed —
three expressions in `inventory_lot_rollup` and a `HAVING` on
`inventory_location_breakdown`.

**Not solved, and named rather than hidden:**

- **`inventory_lots.unit_cost numeric(10,2)` cannot hold a per-milligram cost.**
  Flour at €0.80/kg is €0.0000008/mg, which rounds to `0.00` at INSERT — before
  any trigger can see it — so WAC and COGS for every mass item would be a
  structural zero wearing the costume of a measurement. This is a real
  consequence of the `mg` base that 0070 did not name. Filed as **OD-118**, not
  fixed here: the fix is a money-column type change with view dependents, it
  cannot bite until the first non-bottle item exists, and a CHECK that could
  refuse to apply against unread production rows does not belong in a migration
  the founder is sequencing.
- **`transfer_stock` still DELETEs the source lot** (`baseline:1869`). A
  transferred lot has not been depleted — it moved — so marking it `'depleted'`
  would be a lie, and the status CHECK has no word for "moved". Left alone
  because the honest fix is a new status value or a `moved_to_lot_id`, and that
  is a decision, not a cleanup.
- **Intake is untouched.** `procurement_document_lines.uom` still has no mass
  unit and `@IsInt()` still rejects `4.5`, so the receiving door stays broken
  for a flour delivery. 0070 says so explicitly; that lane is separate.
- **`allocateRemainderSafe` has no production caller today**, because *nothing
  in the ledger currently divides a quantity* — FIFO depletion is integer
  subtraction and `LEAST`, which is exact. That is a finding, not an omission:
  the primitive exists so the next apportionment cannot get it wrong, and
  `check_ledger_units.py` fails CI if a division appears without it.

**Revisit if:** a real ingredient needs finer resolution than `mg`/`ml` and the
loud refusal is being worked around rather than reported — that is the trigger
to add `ul`, and per-item canonical units mean existing rows are unaffected; or
a non-wine item is created and `canonical_uom`'s `DEFAULT 'bottle'` starts
guessing rather than describing, at which point the default should be dropped;
or `distinct_uom_count > 1` ever appears in the rollup, which would mean the
enforcement in §4 of the migration has been weakened.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Implementation pass | Vocabulary, enforcement and allocation decided; `ul` argued both ways and rejected on failure-mode asymmetry |
| 2026-09-02 | Founder (in-flight instruction) | Mark-not-delete folded in; lot-level cost attribution explicitly out of scope |
| 2026-09-02 | — | **Proposed.** Not locked: awaiting the founder, and gated behind `fix/schema-parity-sees-what-it-claims` per ADR 0070 |
