# 0071 — Intake admits mass, and an intake quantity is not integer-only

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — commissioned directly 2026-09-02; the intake half of the fork ADR 0070 left open
- **Keywords:** intake, receiving, uom, units, mass, kg, flour, quantity, numeric, IsInt, dimension, OD-113, boundary, food
- **Links:** [[0070-a-quantity-states-its-own-unit]], [[0054-order-capture-and-unit-arithmetic]],
  [[0062-a-quantity-declares-its-unit]], [[0011-pos-sale-volume-contract]],
  [[0048-domain-quant-under-research-math]], [[FOOD-REASONING-GRAPH]], OD-113,
  PR `fix/receiving-door-accepts-mass`

## Context

A receiver cannot record a delivery of flour. Not awkwardly — at all, and for two
independent reasons stacked on top of each other. Both were verified against live
production on 2026-09-02 before anything was changed.

**1. There is no mass unit in the vocabulary.** `procurement_document_lines.uom` is
CHECK-constrained to `{bottle, case, keg, pack, split_case, each, liter}`. A 25 kg sack
has no expressible unit under any spelling. Demonstrated rather than asserted — the
insert, against the real table with its real constraints:

```
INSERT INTO procurement_document_lines (..., qty, uom) VALUES (..., 4.5, 'kg');
ERROR:  new row violates check constraint "procurement_document_lines_uom_check"

INSERT INTO procurement_document_lines (..., qty, uom) VALUES (..., 4500, 'g');
ERROR:  new row violates check constraint "procurement_document_lines_uom_check"
```

**The register named one constraint; there are five.** The same seven-value vocabulary
is repeated on `procurement_document_lines.uom`, `procurement_receipt_events.counted_uom`,
`procurement_orders.unit_type`, `procurement_order_items.unit_type` and
`recurring_orders.unit_type` — the last three added as recently as
`20260901150000_order_line_capture_and_units.sql`, which consolidated the vocabulary
without noticing it could not express food. It was duplicated again in two TypeScript
files. Seven copies of one list is why widening it by hand was never going to stay
widened.

**2. `@IsInt()` refuses `4.5` before it reaches a column that would store it.** The
register's framing of this is right as far as it goes, and the count is right:
**15 quantity fields across 5 DTO files** — 10 in `procurement.dto.ts`,
`recurring-order.dto.ts` ×2, `retroactive-order.dto.ts` ×1, `inventory-ledger.dto.ts` ×1,
`storage-locations.dto.ts:146` ×1 — once pack sizes, pagination, priority levels and
shelf capacities are excluded, which is the reading that makes 15 come out. Verified.

**What the register's framing missed is where those fields land.** Only
`procurement_document_lines.qty` and `procurement_receipt_events.*` are
`numeric(12,3)`. `procurement_orders.quantity`, `procurement_order_items.quantity`,
both `quantity_received` columns and `recurring_orders.quantity` are **`integer`**.
Relaxing those validators alone would have replaced a loud 400 with a **silent
Postgres round** — strictly worse, and this repo's cardinal fault
(`memory/absence-reported-as-health`) reached through a bug fix.

OD-113's "**intake is fine**" is therefore wrong at three levels, not one: the
vocabulary, the validator, and the column type underneath both.

ADR 0070 locked the ledger on the same day and named this explicitly as still broken:
*"the intake `uom` CHECK still has no mass unit and `@IsInt()` still rejects 4.5, so the
receiving door stays broken under this decision."* This ADR closes that.

## Options considered

### The vocabulary

1. **Mirror the ledger's base units only (`mg`, `ml`).** One representation everywhere,
   no conversion anywhere. Costs the receiver: a 25 kg sack becomes `25000000`, typed by
   someone holding a sack. It also **overflows** — `numeric(12,3)` tops out at
   999,999,999.999, and a one-tonne flour delivery in mg is 10⁹. Rejected.

2. **Human units with an exact conversion at the boundary (`g`, `kg`, `ml`, `liter`).**
   The receiver types 25 and picks kg. Chosen; the conversion argument is below.

3. **Add imperial units too (`lb`, `oz`).** Real US restaurant vocabulary — flour comes
   in 50 lb sacks. Costs exactness: 1 lb is 453,592.37 mg, **not an integer number of
   milligrams**, so an imperial intake quantity could not cross into an mg-based ledger
   without a rounding error — the precise thing this ADR exists to make impossible.
   **Not decided here** (see below); the metric set is what the commission asked for and
   what converts exactly.

### The quantity type at intake

4. **Leave the order-path columns `integer` and relax only the document/receipt DTOs.**
   Smallest change, and the receipt columns are already `numeric(12,3)`. Costs: the door
   writes `procurement_orders.quantity_received`, so a receiver could count 4.5 kg and
   still not book it; and flour could never have been *ordered* in the first place, so
   the door's expected figure would be wrong regardless. Rejected on measurement, not
   taste.

5. **Widen the intake order columns to `numeric(12,3)`.** Chosen.

6. **Mirror ADR 0070's option F at intake — integer quantities in a stated base unit.**
   One representation across the whole system, no boundary at all. Costs the thing
   `procurement_document_lines` exists for: it is a record of **what a vendor's paper
   said**, and a vendor writes "25.5 kg". Storing `25500000` makes the row stop matching
   the document it was read from. It also moves an already-`numeric(12,3)` column
   *backwards*, which is a larger change than leaving it. Rejected.

7. **Do nothing.** Costs the founder's stated goal and leaves ADR 0070 half-landed: the
   ledger would be able to represent food that no intake path could ever put into it.

## Decision

**Intake admits `g`, `kg`, `ml` alongside the existing seven units; intake quantities are
`numeric(12,3)` in the unit the paper stated; and the conversion into the ledger's
integer base unit is exact-or-refused, never rounded.**

Three things carried it.

**1. The missing axis was dimension, and it is now a real one.** ADR 0070 found unit
ontology "designed nowhere" and `FOOD-REASONING-GRAPH`:73–83 calls it "the class of
failure that kills food software". `UOM_DIMENSION` in `document-types.ts` now maps every
unit to `count | mass | volume`, and every comparison and conversion routes through it.
`comparableUnits` is dimension-aware as a result — and this is checked, not asserted: a
test sweeps all 7×7 pairs of the original units against a transcription of the pre-fix
rule and requires identical answers, so the new axis cannot have loosened a receiving
discrepancy check that was previously firing.

**2. Rounding at the boundary is unreachable, not merely avoided.** This is the part the
commission asked to be explicit about, and the answer is arithmetic rather than care:

> Intake carries at most **three** decimal places. Every non-base unit's scale is at
> least **1000**. Therefore `qty × scale` is **always** a whole number.

4.5 kg is exactly 4,500,000 mg. 0.001 kg is exactly 1000 mg. There is no remainder to
round, because the product of a 3-decimal number and 1000 is an integer. Proven against
real Postgres, not reasoned about: the stored row came back `qty = 4.500`,
`qty * 1000000 = 4500000`, `= trunc(...)` true.

The one case where it would not hold is a quantity stated *in the base unit itself* with
a fraction (0.5 ml), and that is refused rather than rounded — `toBaseUnits` returns a
reason, and `resolveOrderUnits` refuses it before any column is touched.

**3. The same asymmetry that made integers right for the ledger makes them wrong here.**
ADR 0070 keeps ledger quantities `integer` and this ADR widens intake quantities to
`numeric`. That reads as a contradiction and is not one. Every one of 0070's five
arguments is an argument about **conservation** (`before + change = after` exact) or
about **weighted-average cost** (a `0.001` residue becoming a divisor and inflating WAC
~1000×). Neither exists on this side: there is no `valid_quantity_after` on any intake
table and no cost divisor. Nothing that integers were protecting is present here, and
0070 itself cites `procurement_document_lines`' existing `numeric(12,3)` approvingly as
the source of the `qty`+`uom` pairing it adopted.

**And the cost is counted, not estimated.** The check that made 0070's widening
expensive comes back empty on this side: **0 views dropped** (one view references these
tables; it selects no quantity column), **0 functions resignatured, 0 int locals** (one
function mentions them — a conversation-thread trigger touching no quantity). Rows at
risk: 2 / 1 / 0 / 0 / 0.

**One dependency was found only by running it.** `procurement_order_items.total_bottles`
is a **STORED GENERATED** column over `quantity`, and Postgres refuses to alter a column
a generated column reads. It appears in no schema diff, no view-dependency list and no
function body — nothing this repo currently checks would have predicted it. It was found
by executing the migration inside a transaction that rolled back, and it is dropped and
recreated as `numeric(12,3)`: leaving it `integer` would have reintroduced the exact
silent rounding this ADR removes, one level down and invisible to every writer.

### The 15 fields: what changed, and what deliberately did not

**Changed (4)** — quantities whose destination column this migration makes fractional:
`procurement.dto.ts:44` (`CreateOrderDto.quantity`), `recurring-order.dto.ts:58` and
`:146`, `retroactive-order.dto.ts:50`. All now carry `@IsIntakeQuantity()`.

**Deliberately left `@IsInt()` (2)**, because they are not intake:

- `inventory-ledger.dto.ts:72` `quantityChange` → `inventory_transactions.quantity_change`.
  **The ledger. ADR 0070 keeps it integer**, and relaxing it here would fight a locked
  decision. *This is a dependency, not an omission:* until the ledger lands its unit
  column, a fractional mass movement cannot be recorded on the ledger side even though
  intake can now receive one.
- `storage-locations.dto.ts:146` `AssignWineToLocationDto.quantity` →
  `wine_location_mappings.quantity`, keyed on `wine_id`. Bottles in a shelf slot. A count,
  on no food path.

**Deferred, not exempt (9)** — the `VerifyReceiptDto` family and `quantityReceived` in
`procurement.dto.ts`. PR #233 (`fix/verify-receipt-unit-safety`) is rewriting every one
of them right now, renaming them to declare their unit
(`invoiceQuantity` → `invoiceQuantityInInvoiceUom`). Editing the same lines from two
branches conflicts on all nine and buys nothing. They are listed in the guard's
`DEFERRED_PENDING_PR_233`, which **fails the build once those fields stop carrying
`@IsInt()`** — i.e. the moment #233 lands and the collision clears. The deferral expires
mechanically rather than on a promise.

### What was NOT decided

**Imperial units.** `lb` and `oz` are real US receiving vocabulary and are the obvious
next request, but 1 lb = 453,592.37 mg is not an integral number of milligrams, so
admitting them breaks the exactness argument above. Three ways out — refuse the
conversion case-by-case, make the ledger base finer than mg, or convert at intake and
store metric — and choosing between them is a founder call that also touches ADR 0070's
base unit. Recorded here rather than filed as an OD, per the register's citation-shift
cost.

**The ledger's actual base unit.** ADR 0070 requires "milligrams, not grams" for the
class that needs it but enumerates no vocabulary, and the ledger migration has not
landed. `UOM_BASE_SCALE` is written as the single seam: if the ledger picks something
other than mg/ml, that table is the one line that moves.

## Consequences

**Easier.** A receiver can record a delivery of flour. Mass and volume are expressible
end-to-end at intake, with one vocabulary instead of seven copies of one. Cross-unit
comparison is dimension-checked rather than accidental, so a gram cannot be weighed
against a bottle. The `g`↔`kg` and `ml`↔`liter` pairs now compare, which kegs and litres
never could.

**Harder, or given up.** Sub-milligram intake precision is gone by construction — a
quantity finer than three decimal places in its stated unit is **refused**, with a
message naming the finer unit ("0.5 g, not 0.0005 kg"), because `numeric(12,3)` would
otherwise round it silently. `ORDER_UNIT_TYPES` is now derived from `UOMS` rather than a
second literal list; the safety the copy pretended to give is now given by a guard that
actually fails the build. Anything reading `procurement_orders.quantity` as an integer
must stop.

**Still broken after this.** The ledger side cannot yet *store* what intake can now
receive: `inventory_transactions.quantity_change` remains integer with no unit column
until ADR 0070's migration lands. Intake and the ledger must land in that order or a
received mass has nowhere to go.

**Revisit if:** a real ingredient needs finer resolution than three decimal places of its
finest legal unit; or imperial units are adopted, which reopens the exactness argument;
or the ledger's base unit is decided as something other than mg/ml, which moves
`UOM_BASE_SCALE`.

**Gate.** No migration lands before `fix/schema-parity-sees-what-it-claims`. Founder
decision, 2026-09-02 — and it binds this migration harder than most: parity can see
neither CHECK constraints nor the difference between `numeric(12,3)` and bare `numeric`,
which is **both** halves of this change.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Verification pass | All three register claims re-measured against production. The `@IsInt()` count of 15 confirmed; the CHECK confirmed verbatim; **two claims corrected** — the vocabulary is duplicated across 5 constraints, not 1, and 6 of the 15 fields land in `integer` columns that a DTO relaxation alone would have made silently round |
| 2026-09-02 | Front-end re-count | 69 raw `type="number"` occurrences, 23 with `step`. The audit's "46 of 69" is 69−23 and holds, with a refinement: **5 of the 46 are in `form.stories.tsx`** (Storybook), so **41 shipped inputs** lack `step`. A second defect found and not previously named: `RecurringOrders.tsx:577` used `parseInt`, truncating "4.5" to 4 below any validator |
| 2026-09-02 | Executed, not reasoned | Migration run inside a rolled-back transaction against real Postgres. Surfaced the `total_bottles` **generated-column** dependency that no schema-diff, view-dependency or function-body check would have predicted. Pre-fix insert refused; post-fix row stored `4.500 kg` with an exact 4,500,000 mg conversion |
| 2026-09-02 | Guard proven against the pre-fix tree | `scripts/check_intake_units.py` exits **1** at `cb878109` naming both substantive rules (no mass unit; four `@IsInt()` quantities) and **2** when a file it reads is absent. 13-check `--self-test` wired into CI beside it |
| 2026-09-02 | Aldemir (founder) | *Pending.* Not merged, no PR opened — sequencing is the founder's, behind the schema-parity gate |
