---
type: adr
id: 0011
title: POS sale-volume contract
status: locked
updated: 2026-08-25
links: []
---

# 0011 — A POS sale removes a volume, not a unit: `sale_volume_ml` and fail-closed depletion

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder)
- **Keywords:** pos, sale_unit, sale_volume_ml, pos_item_mappings, pos_unresolved_lines, depletion, fail-closed, record_glass_pour, B36, B19, B20
- **Links:** [[0008-nf-column-contract]] (tone/format), `supabase/migrations/20260825120000_pos_sale_volume_contract.sql`, `apps/api-gateway/src/pos-hub/pos-hub.service.ts`

## Context

`pos_item_mappings.sale_unit` has been a two-value enum — `glass` or `bottle` —
since it was migrated off `toast_item_mappings`
(`20260805132000_counting_catalog_and_correlation_columns.sql:33-40`). The POS
depletion path read it as `it.sale_unit ?? "bottle"`
(`pos-hub.service.ts:377`, pre-fix).

On 2026-08-24 we found that `upsertItemMapping` — the **only** writer of the
column — never included it in the row it upserted. So the fallback was not a
fallback: **all 92 production mappings are `sale_unit = null`**, every one of
them is wine carrying an `inventory_id`, and every by-the-glass sale of any of
them booked a whole 750ml bottle instead of a 150ml pour. Writing the column
fixed mappings created *from now on*. It did nothing for the 92, which is the
entire installed base.

Fixing the write exposed the real defect, which is the model. A restaurant does
not sell "a glass" or "a bottle". It sells a 150ml pour, a 60ml taster, a 375ml
half bottle, a 500ml carafe, a 1500ml magnum, five 40ml pours in a flight. The
founder's call, verbatim: *"i don't want to keep bottle default, I want to make
it convertible for each type of bottle measurement and glass per occasion or
other."*

The database layer was already convertible and had been from the beginning:
`record_glass_pour(p_inventory_id, p_pours, p_pour_ml, ...)` takes an arbitrary
pour volume in millilitres
(`20260805000000_baseline_from_production.sql:1132`). Only the application layer
was binary. Note what this does **not** mean: production holds one shape of row
— 750ml bottle, 150ml pour, on every single one — so **the existing data cannot
validate a multi-format design**. The RPC's capability is evidence; the data is
not.

## Options considered

1. **Keep the enum, widen it to a longer list** (`glass | bottle | half_bottle |
   magnum | carafe`). Cheapest diff. Rejected: it moves the cliff rather than
   removing it. Every new format a restaurant invents needs a migration, a code
   change and a deploy, and the arithmetic still lives in a `switch` that has to
   guess a volume for each label. It also does not answer "a 90ml tasting pour",
   which is a volume, not a category.
2. **`sale_volume_ml` as the truth, `sale_unit` as an open reporting label —
   with the `?? "bottle"` default kept** as the last resort. Rejected: the
   default is the bug. Keeping it means the 92 rows keep over-depleting by 5x
   after this change lands, and the queue never fills, so nobody ever learns.
3. **`sale_volume_ml` as the truth, open label, and fail closed** — an
   unresolvable line is queued in `pos_unresolved_lines` and depletes nothing.
   **Chosen.**
4. **Do nothing.** Costs: the 92 mappings keep booking 750ml per glass. It has
   corrupted nothing so far for exactly one reason — `pos_checks` held 0 rows
   until 2026-08-24 — and goes live the moment a real POS connects.

## Decision

**Option 3.** `pos_item_mappings.sale_volume_ml numeric` is the truth: the
millilitres one sale of this POS item removes. `sale_unit` becomes an open human
label (`glass`, `bottle`, `half_bottle`, `magnum`, `carafe`, `taster`,
`flight`, …) for reporting and UI, never for arithmetic.

Resolution order in `applyStockEffects`, in full:

| # | Condition | Result |
|---|---|---|
| 1 | `sale_volume_ml` present and plausible | that volume |
| 1a | …and it equals the row's `bottle_size_ml` | **whole-bottle move** (`apply_stock_movement`) |
| 1b | …and it exceeds the container it pours from | **queue** — see below |
| 2 | `sale_unit` = `bottle` | whole-bottle move; the inventory row is not consulted |
| 3 | `sale_unit` = `glass` and the row has `pour_size_ml` | that pour size, via `p_pour_ml` |
| 4 | anything else — including all 92 production rows | **queue the line, deplete nothing** |

Volume-based depletion routes through `record_glass_pour`'s existing
`p_pour_ml`, passed **explicitly** rather than as `null`, so the millilitres
that move stock and the millilitres written to `wine_consumption_log` are the
same number, decided in one place. Whole-bottle sales stay on
`apply_stock_movement`, because that is what such a sale actually is.

Two guards were added beyond the brief, and both are load-bearing:

- **1b, a pour larger than its container.** `record_glass_pour` opens a bottle
  and subtracts the pour from it (`baseline:1170`). A 1500ml pour against a
  750ml row sets `inventory_lots.open_bottle_ml` to **−750** — it does not
  raise. That is silent lot corruption, a different and worse failure than
  under-depletion, so it queues rather than fails closed *into* the RPC.
- **A plausibility band of 10–30 000 ml on `sale_volume_ml`.** A bare `> 0`
  check accepts `1.5` from someone who meant 1.5 **litres**, and the item then
  pours 1.5ml per sale forever — the same silent-wrong-number failure this ADR
  exists to end, pointed the other way.

`sale_unit` still rejects malformed input — non-string, empty, whitespace-only,
over 32 characters. A blank label is a caller bug, not a word anyone chose, and
it would render as "mapped" in the review UI while meaning nothing.

### `pos_unresolved_lines` gets a `reason`, and it is not optional

The brief asked whether queueing an already-mapped line fits that table's
contract. **It does not, as the table stood.** The queue now receives two
populations that need different questions asked of a human:

- `unmapped` — no mapping row resolves this line to stock. *"What wine is this?"*
- `no_sale_volume` — mapped, inventory row known, but nothing says how much one
  sale removes. *"How much does one of these pour?"*

Without the discriminator the reviewer gets one undifferentiated pile, and the
second population reads as a mapping failure it is not — at precisely the moment
the queue fills with all 92 rows. So the migration adds `reason` (NOT NULL
DEFAULT `'unmapped'`, which is correct for every row written before today, that
having been the only reason then) and `mapped_inventory_id` (what the pipeline
already **knew**, as distinct from `resolved_inventory_id`, which is what a
human **decided**).

The partial unique dedupe index gains `reason`. Otherwise a line still open as
`unmapped` would swallow the `no_sale_volume` insert that follows once someone
maps it but sets no volume — the newer, more actionable problem suppressed by
the older one, and silently, since the service treats `23505` here as "already
queued".

### No backfill

The 92 rows stay null. Backfilling `bottle` is the defect; backfilling `glass`
is the same guess pointed the other way. They queue.

### The name parser is deliberately not used

`normalizeDescription()` (`procurement/documents/line-matcher.ts:108`) already
parses `"1.5L magnum"` → `formatMl: 1500`, and `catalog-matcher.service.ts`
already imports it, so auto-filling `sale_volume_ml` from the item name or the
POS catalog's `size_ml` looks free. It is not. **A by-the-glass SKU carries the
size of the bottle it is poured FROM** — a "Glass of Barolo" line in a POS
catalog is `size_ml: 750`. Auto-filling from it would rebuild the bottle default
under a new name, and this time it would look deliberate. The parser's correct
home is the review surface, as a *suggestion shown to a human*, never an
automatic write. This is decision B36 ("sale unit is never inferred from the
item name") extended to volume.

## The trade-off, stated plainly

**Fail-closed under-depletes. That is not free.**

Before: every unresolved glass sale removed 750ml when it should have removed
150 — **over-depletion by 5x, silent**, with stock reading low, par alerts
firing on phantom shortfalls, and reorder points, XYZ classification and the
Holt-Winters forecast all fed a demand series inflated fivefold. Nothing in the
product says this is happening. There is no artifact to inspect and no way to
reconstruct the truth after the fact.

After: an unresolved sale removes **nothing**. Stock reads **high** — the
restaurant believes it has wine it has already sold — until someone works the
queue. Every skipped line leaves a row naming the check, the item, the quantity
and the reason, so the error is bounded, attributable and reversible. But the
queue is not self-clearing, and a restaurant that ignores it accumulates
invisible shrinkage exactly as if the depletion had never been wired up.

The reason this is the right side of the trade is not that under-depletion is
harmless. It is that **one failure mode is visible and the other is not.**
A wrong number that nobody can see is worse than a missing number that everybody
can, and 5x is not a rounding error.

## Consequences

- **The queue will spike on the first real POS connection.** All 92 mappings
  land in it. That is the design working, not a regression, and the review
  surface being built alongside this change is what drains it. Anyone reading
  the queue depth as a health metric needs to know this first.
- `sale_unit` is no longer safe to `switch` on. Two labels carry a derivation;
  every other value is a word. Code that assumes otherwise is wrong.
- `wine_consumption_log.consumption_type` stays `'bottle' | 'glass'` — it is
  `varchar(10)` with a CHECK on exactly those (`baseline:6394`) and
  `wine_consumption_summary` branches on it. It now records the **depletion
  mode**, not the label: a 500ml carafe is a `glass` row of `volume_ml: 500`.
  Volume readers sum `volume_ml` and are exact; the two count columns
  (`bottles_consumed` / `glasses_consumed`) become mode counts. Widening that
  CHECK is a separate decision with a view rewrite attached.
- **The Toast door is not fixed** and still carries `saleUnit ?? "bottle"`
  (`toast.service.ts:502`). It is a second live depletion path with the same
  defect. Not touched here because closing it changes behaviour for a live
  integration, which is the founder's call — raised as **OD-64**.
  `resolveSaleVolume()` is exported and pure so that door can adopt this
  contract in one line rather than growing a second implementation of it.
- **B19 is left in place and it is wrong.** A partial-volume void returns `qty`
  **whole bottles**, because `record_glass_pour` has no reversal mode — voiding
  5 glasses returns 5 bottles, the same 5x error as the bottle default, in the
  opposite direction. It is a recorded decision, so superseding it is the
  founder's call, not this change's. Flagged in code at the call site.
- **`pos_unresolved_lines.external_item_id` is nullable**, and a UNIQUE index
  treats NULLs as distinct — so a POS that sends no item id piles up one queue
  row per replay. Pre-existing; fixing it means deciding what identity a
  name-only line has.
- One batched inventory read per check replaces the per-line `maybeSingle()` the
  consumption mirror used to issue on its own — a 20-line check costs one query
  rather than twenty.
- **Revisit if:** the queue is not being worked (under-depletion then compounds
  and the trade above stops holding), or a restaurant needs a sale that spans
  more than one container — 2×750ml as a single 1500ml line — which this design
  queues rather than serves.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Aldemir | Set the direction: no bottle default, convertible per format, fail closed like every other path in this pipeline |
| 2026-08-25 | Claude | Design implemented as specified. Added two guards the brief did not name — the pour-exceeds-container check (silent negative `open_bottle_ml`, not an under-depletion) and the 10–30 000ml plausibility band (litres-into-an-ml-field). Answered the queue-contract question as **yes, it needs a distinct `reason`**, with the dedupe index widened to match |
| 2026-08-25 | Claude | Declined to auto-fill `sale_volume_ml` from `normalizeDescription()` despite the pointer: a by-the-glass SKU carries the size of the bottle it is poured from, so parsing it rebuilds the bottle default under a new name |
| 2026-08-25 | Claude | Left B19 (glass voids return whole bottles) and the Toast door untouched and raised both rather than fixing them silently — both change recorded/live behaviour and are the founder's call. OD-64 |
