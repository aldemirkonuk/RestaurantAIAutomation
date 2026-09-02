---
type: reference
title: The L2 transformation primitive
status: proposal — design settled, four forks named for the founder (2026-09-02)
updated: 2026-09-02
links: ["[[0048-domain-quant-under-research-math]]", "[[FOOD-REASONING-GRAPH]]",
  "[[0070-a-quantity-states-its-own-unit]]", "[[LEDGER-FOOD-MIGRATION-OPTIONS]]",
  "[[0051-rebuilt-pages-show-live-data-only]]", "[[OPEN-DECISIONS]]"]
---

# The L2 transformation primitive — the event, and the constraint that makes silent loss impossible

> **Scope.** A design, not a migration. No `.sql` is written here and nothing is
> applied. It covers the *primitive*: how "10 kg whole carrot became 7 kg peeled
> carrot and 3 kg of trim" becomes one recorded fact. It does **not** cover recipes,
> BOM, plate cost or menu costing — §8 draws that line explicitly.
>
> **Retire-to-write (CLAUDE.md §4).** Nothing qualifies for retirement and I am not
> inventing a candidate. The corpus contains no transformation document to supersede
> — [[FOOD-REASONING-GRAPH]] §L2 names the gap and stops, and
> [[LEDGER-FOOD-MIGRATION-OPTIONS]] §10.7 records that *no* ledger option delivers it.
> The cost is paid instead by **absorbing the L2 design obligation out of
> `FOOD-REASONING-GRAPH`**: that document keeps the map and stops carrying the design.
> Its §L2 now ends with a pointer here instead of growing, and two of its claims are
> sharpened in the same block (the `yield_factor` column is an *expected* yield on a
> vendor offer, §1.3; the FIFO write path discards consumed cost, §1.4). One row added
> to `07-reference/INDEX.md`; no new top-level file.
>
> **No ADR.** This is a proposal with four open forks (§11). Recording it as a
> decision would be exactly the failure OD-108's resolved row describes — writing an
> answer where the question was never asked. An ADR follows the founder's calls, not
> this document.

---

## 0. The primitive, in one paragraph

**A transformation is a balanced document, not a pointer.** One header row
(`transformation_events`) says *this happened, here, then, by them, of this process
kind*; N line rows (`transformation_lines`) say *this lot went in, these lots came
out, this much left as named loss*. Every line carries an integer quantity, its own
`uom`, and an integer `base_per_unit` factor, so its contribution to the balance is a
**generated** column the writer cannot state independently of the factor it claims.
A deferred constraint trigger fires at COMMIT and refuses the whole transaction
unless Σ inputs = Σ outputs + Σ loss, with at least one line on each side. Mass gain
(rice absorbing water) is modelled as an **input**, never as a negative loss, so the
loss term is `>= 0` and cannot absorb a shortfall. Each line still writes an ordinary
`inventory_transactions` row through the existing single write primitive, so the
ledger stays the one history of stock movement and the transformation tables are only
the join the ledger cannot express.

---

## 1. What is actually there today — measured, not recalled

### 1.1 The ledger has no join

`inventory_transactions` is one row, one item, one signed quantity, with a per-row
CHECK that the running balance for *that item* is self-consistent
(`valid_quantity_after`, baseline:3250). There is no group id anybody must fill, no
cross-row constraint, and no column that could hold "these four rows are one event".
`reference_type` / `reference_id` exist and are nullable, unconstrained, and pointed
at by nothing — using them as the grouping key would mean the absence of a group is
indistinguishable from a group that was never needed. That is this repo's cardinal
fault, and it is disqualifying on its own.

### 1.2 The one transformation that exists is hard-coded, and it has no loss channel

`record_glass_pour` (baseline:1132–1177) *is* a transformation: one bottle becomes N
pours plus a remainder, and the remainder lives in `inventory_lots.open_bottle_ml`
(baseline:3179). It conserves millilitres exactly — the opened bottle's residual is
computed, never dropped — but it conserves them **by construction, for exactly one
input/output pair, with no way to record that 20 ml were spilled or oxidised**. That
is the shape of every ad-hoc transformation: correct for its one case, silent about
loss, and not reusable.

It is also the reason the primitive has a live proof surface on beverage before food
identity is answered (§2.3).

### 1.3 The repo's `yield_factor` is a purchase-comparison number, not an observed one

`vendor_price_observations.yield_factor numeric DEFAULT 1.0 NOT NULL` with
`CHECK (> 0 AND <= 1)` (`20260805154027_vendor_price_observations.sql:88,119`). Its
own migration comment states what it is for: ranking *offers* — "a $40 case at 85%
yield beats a $36 case at 70%" (:45–46). It is an **expected** yield attached to a
vendor's price, decided at buying time.

`FOOD-REASONING-GRAPH`:118 is right that this column is trim yield and correctly ≤ 1.
The point this design adds: **there is nowhere in the schema an *observed* yield can
come from**, because there is no event that observes one. Expected and observed yield
are different quantities with different provenance and different consumers, and the
transformation event is the only thing that can produce the second (§4.2).

### 1.4 The write path deletes the evidence — the finding that shapes everything

`apply_stock_movement` is the single stock write primitive. When a FIFO draw consumes
a lot completely it does not mark it; it **deletes the row**
(`20260805130000_extend_apply_stock_movement.sql:97`). Two consequences:

- **Any foreign key from a transformation line to an input lot is unstable by
  design.** `ON DELETE SET NULL` erases lineage silently; `ON DELETE RESTRICT` breaks
  the depletion path. Neither is acceptable.
- **The cost it consumed is discarded.** The ledger row's `unit_cost` is the
  caller-supplied parameter (:112), not the FIFO-derived cost of the lots actually
  drawn, and `total_cost` is never written at all. So the input cost of a
  transformation is **not recoverable from the ledger today** — which means every
  costing method in §5, including both sides of OD-114, is unreachable without a
  change to this function.

`inventory_lots.status` already carries `'depleted'` in its CHECK (baseline:3191) and
**nothing anywhere sets it** — the only occurrence in the tree is a test fixture
(`apps/api-gateway/src/analytics/engine/cost-basis.spec.ts:35`). The schema
anticipated a soft depletion the write path then contradicted. §10 makes this a
prerequisite and §11 makes it a fork, because it changes a live primitive another
lane is currently editing.

### 1.5 The repo's only balanced document is deliberately soft — and correctly so

`procurement_documents` carries `computed_lines_total`, `tie_out_delta` and
`ties_out boolean` (baseline:4453–4455). A document whose lines do not sum to its
total is **recorded as not tying out**, not refused.

That is right for an invoice and wrong for a transformation, and the distinction is
the argument for a hard constraint here: **an invoice is an external fact you cannot
refuse — the vendor sent it. A transformation is a claim you are authoring about your
own kitchen.** You can refuse a claim. Softness at intake preserves reality; softness
here would preserve a lie.

---

## 2. The primitive

### 2.1 Shape

Three objects, one of which is optional-but-recommended:

| Object | Grain | Holds |
|---|---|---|
| `transformation_events` | one per real-world event | restaurant, `process_kind`, `balance_uom`, actor, `occurred_at`, `status`, `idempotency_key` |
| `transformation_lines` | one per input, output or loss | `role`, `qty` + `uom` + `base_per_unit` → generated `base_qty`, `measurement`, `loss_channel`, `inventory_id`/`output_lot_id`, `txn_id`, cost allocation |
| `transformation_line_draws` | one per lot actually drawn by an input line | `lot_id` (soft ref), `qty_drawn`, `unit_cost_at_draw` |

The third exists because of §1.4: it copies the cost **out** of the lot at draw time,
so cost provenance survives even under today's delete-on-depletion path. Lineage
survives too, but only once §11 F1 is answered.

### 2.2 New tables, not a discriminated `inventory_transactions`

Argued, because the cheap answer is tempting:

**For reuse.** One ledger, one history, existing RLS, existing indexes, and
`apply_stock_movement` already writes it.

**Against, and decisive:**

1. `inventory_transactions.wine_id` is `NOT NULL` with no FK
   (`LEDGER-FOOD-MIGRATION-OPTIONS`:67). Making the event a row *in* that table makes
   the event blocked on the identity fork. A separate table keyed on surrogate uuids
   is not. **This single point is why the naive design needs A-vs-C resolved and this
   one does not** (§2.3).
2. A transformation is inherently multi-row and must be atomic *as a set*. The table
   has no grouping column that anything forces (§1.1).
3. `valid_quantity_after` is per-row and per-item. It has nothing to say about a
   cross-item, cross-unit balance, and extending it to say something would impose a
   balance requirement on `sale`, `waste` and `adjustment`, which legitimately do not
   balance.
4. `transaction_type` is a Postgres **ENUM** (baseline:142–152), not a varchar CHECK.
   `ALTER TYPE … ADD VALUE` is irreversible (Postgres has no `DROP VALUE`) and the
   new value cannot be *used* in the transaction that adds it. Minor, but it means
   the enum extension and the first write must be separate migrations.

**The resolution is layered, and it is the accounting document/journal split.** The
transformation tables are the *document*. Each line still calls the existing write
primitive and produces an ordinary `inventory_transactions` row, referenced back by
`transformation_lines.txn_id NOT NULL`. Downstream readers of stock history learn
nothing new; they see depletions and receipts as they always have. The document says
those movements are one event and must balance.

One enum value is still needed — `transformation` — because typing a transformation
depletion as `adjustment` would be the same class of lie the rest of this document is
built to prevent. Sign already distinguishes direction, so one value suffices.

### 2.3 The identity question, answered

**The primitive does not require the A-vs-C fork to be resolved, and does not create
a new identity requirement.**

Every reference in §2.1 is a surrogate uuid: `inventory_transactions.id`,
`inventory_lots.id`, `restaurant_inventory.id`. None of them is an identity key.
Whichever way A-vs-C lands, those rows keep their `id`, so the transformation tables
are untouched by the fork — the property [[LEDGER-FOOD-MIGRATION-OPTIONS]] §10.6
credits option C with ("the only option that gives a future transformation table
something solid to point at") turns out not to be needed: a lot id is already solid.

What *is* blocked: creating an output lot for a **food** item, because
`inventory_lots.master_wine_id` is `NOT NULL`. That is the same block that stops food
existing at all. The primitive inherits it; it does not add to it. Stated precisely:

> **L2 is not blocked on identity. Food is, and L2 inherits food's block.** The
> primitive can be designed, built, constrained and proven now, on beverage, where
> identity is resolved and falsified at scale (732,874 pairs, zero false merges —
> `FOOD-REASONING-GRAPH`:66).

The available beverage proof is the one in §1.2: replace the `open_bottle_ml` bolt-on
with a real transformation whose output is an "opened" item lot measured in ml. That
is also what [[0070-a-quantity-states-its-own-unit]]'s reasoning point 5 asks for —
"a quantity is always the current amount in the stated base unit… no future item
needs its own bolt-on". It touches `record_glass_pour`, so whether to take it is
sequencing, not design (§11 F4).

Two things the primitive deliberately does **not** need item rows for: **loss sinks**
and **ambient inputs**. A loss line carries a channel and no lot (§3.6); water carries
a channel and no cost. Both were designed around rather than through, precisely so no
new identity is required.

### 2.4 Units at the boundary — integer factors, no division, and refusal

[[0070-a-quantity-states-its-own-unit]] is locked: quantities are `integer`, every row
states a CHECK-constrained `uom NOT NULL`, and the canonical unit belongs to the item.
A transformation crosses units, so this is where the hard part lands.

**The rule: every line converts into the event's balance dimension by multiplying by
an integer, and division never happens at write time.**

- The header declares `balance_uom`, drawn from the *base* unit vocabulary only
  (`mg` · `g` · `ml` · `each`) — never `case` or `pack`.
- Every line carries `base_per_unit integer NOT NULL CHECK (> 0)`: how many base
  units one stated unit of that line is. `1` when the line's `uom` already is the
  balance unit; `12` for a case of eaches; `180` for a 180 g portion; `920` for one
  ml of oil when the balance unit is mg.
- `base_qty bigint GENERATED ALWAYS AS (qty * base_per_unit) STORED`. The writer
  cannot state a balance figure independent of the factor it claims.
- `basis` names where the factor came from, from a closed vocabulary:
  `identity` · `pack_size` · `portion_weight` · `density` · `measured` · `manual`.

**Where a factor is not an integer, the base unit is too coarse — and the event is
refused, not rounded.** One ml of oil is 0.92 g; in grams that factor does not exist,
in milligrams it is 920. This inherits ADR 0070's own resolution ("milligrams, not
grams, for the ingredient class that needs it") rather than inventing a second
mechanism, and it gives a concrete selection rule for an item's canonical unit: fine
enough that every factor any transformation will need is a whole number.

**Where a factor is unknown, the write is refused.** No default, no assumed 1, no
implied pack size. This is `normalizeUom`/`toBottles`' discipline
(`apps/api-gateway/src/procurement/order-units.ts:25–49`, itself ADR 0011's rule)
applied one layer up: *"a guessed unit books a wrong quantity that nothing later can
detect."* Note the one difference from that module: it permits an **absent** unit to
resolve to `bottle` because bottle is the identity of that arithmetic and cannot
multiply. Here there is no identity to fall back on — a missing `base_per_unit` on a
line whose `uom` differs from `balance_uom` has no safe default, so the column is
`NOT NULL` and the refusal is total.

**Integer ceiling, measured:** `int4` caps at 2,147,483,647, so an item whose
canonical unit is mg cannot hold more than ~2,100 kg on hand. Because the canonical
unit is per-item (ADR 0070), only the mg-class items — saffron, vanilla, gold leaf —
pay that ceiling; flour in grams caps at 2.1 million kg. The ceiling is a non-issue
*because* the unit is per-item, which is the locked decision doing work.

### 2.5 Columns, illustrative

Not a migration. Types are stated so the constraints in §3 are checkable.

```
transformation_events
  id                uuid pk
  restaurant_id     uuid NOT NULL                    -- RLS + tenancy
  process_kind      text NOT NULL CHECK IN (fabrication, prep, cook, assembly, pack)
  balance_uom       text NOT NULL CHECK IN (mg, g, ml, each)
  status            text NOT NULL DEFAULT 'posted' CHECK IN (posted, voided)
  voided_by_event   uuid                              -- self-ref, null unless voided
  occurred_at       timestamptz NOT NULL              -- event time, never write time
  performed_by      uuid                              -- NO FK; see note
  performed_by_type text NOT NULL CHECK IN (user, system, agent)
  idempotency_key   text UNIQUE
  notes             text

transformation_lines
  id                uuid pk
  event_id          uuid NOT NULL REFERENCES transformation_events ON DELETE CASCADE
  role              text NOT NULL CHECK IN (input, ambient_input, output, loss)
  qty               integer NOT NULL CHECK (qty > 0)   -- magnitude; role carries sign
  uom               text NOT NULL                      -- ADR 0070 vocabulary
  base_per_unit     integer NOT NULL CHECK (> 0)
  base_qty          bigint GENERATED ALWAYS AS (qty * base_per_unit) STORED
  basis             text NOT NULL CHECK IN (identity, pack_size, portion_weight,
                                            density, measured, manual)
  measurement       text NOT NULL CHECK IN (measured, counted, estimated, derived)
  inventory_id      uuid                               -- null for loss / ambient
  output_lot_id     uuid                               -- outputs only
  txn_id            uuid                               -- the ledger row this produced
  loss_channel      text CHECK IN (trim, bone, evaporation, rendering, spill,
                                   sampling, unexplained)
  allocated_cost_c  bigint                             -- integer minor units; §5
  allocation_method text CHECK IN (by_product_credit, relative_sales_value, nrv,
                                   physical_mass, none, manual)
  allocation_basis  jsonb                              -- the inputs the method used

transformation_line_draws
  line_id           uuid NOT NULL REFERENCES transformation_lines ON DELETE CASCADE
  lot_id            uuid NOT NULL                      -- soft ref, deliberately (§1.4)
  qty_drawn         integer NOT NULL CHECK (> 0)
  unit_cost_at_draw numeric(10,2)                      -- copied out, survives deletion
```

> **`performed_by` carries no foreign key, deliberately.** `auth.users` and
> `public.users` are disjoint in this system — the JWT carries `public.users.user_id`,
> so an actor FK to `auth.users` fails 23503 on every write and a fresh CI database
> has no rows to violate, so CI cannot catch it. `inventory_transactions.performed_by`
> already has no FK ([[LEDGER-FOOD-MIGRATION-OPTIONS]]:100–103). Follow the existing
> precedent; if an FK is ever added it must target `public.users(user_id)`.

> **`performed_by_type` is load-bearing, not decoration.** A yield observed on a
> `system`-generated event must never train a prior. Without this column, an inferred
> transformation and a weighed one are the same row.

---

## 3. Conservation — the constraint, and the trap it must not repeat

### 3.1 The trap, restated precisely

`valid_quantity_after` is `quantity_after = quantity_before + quantity_change`, an
exact-equality CHECK. Under `numeric(12,3)` it **passes over both a create-from-nothing
and a destroy**, because `v_before` is always exactly 3dp, which makes the rounding
translation-invariant ([[0070-a-quantity-states-its-own-unit]] §Decision.1). It
validates that the ledger's numbers agree *with each other*, never that they match the
world.

The trap generalises, and this is what a second constraint must not repeat:

> **A balance equation in which any one term is a free field the writer also supplies
> is satisfied by construction and therefore carries no information.**

A naive conservation check — `inputs = outputs + loss`, with `loss` a scalar on the
header — has exactly that shape. The writer sets `loss` to whatever closes the gap and
the CHECK passes forever. It would be `valid_quantity_after` again, one table over.

Making `loss` a `GENERATED` column is worse, not better: it turns the equation into a
tautology that can never fail, and reports its own vacuity as health.

### 3.2 What a constraint can and cannot do

It has to be said plainly, because a design that claims otherwise is lying:

- **A database constraint cannot see physical reality.** No CHECK, trigger or
  exclusion constraint can tell a true 3 kg trim loss from a fabricated one.
- **What it can do is remove the free variable, force presence, and make every
  unaccounted gram appear as a named row with an actor.**

So "makes silent loss impossible" is achievable in its literal sense — loss cannot
occur without a row saying so — while "makes false loss impossible" is not achievable
at all and is not claimed. The detection of a *false* loss is statistical: observed
yield against a prior distribution, which is L6's job and needs the events to exist
first. This is the honest boundary and §9 A1 is where it is attacked.

### 3.3 The constraint

Three parts. Only the first is novel to this codebase.

**(a) A deferred constraint trigger on the lines, firing at COMMIT.**

```
CONSTRAINT TRIGGER … AFTER INSERT OR UPDATE OR DELETE ON transformation_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
```

At commit, for the affected `event_id`, it recomputes from the rows actually present:

```
Σ base_qty WHERE role IN (input, ambient_input)
  =  Σ base_qty WHERE role = output
   +  Σ base_qty WHERE role = loss
```

and raises otherwise. Deferral is what makes a multi-row write possible at all: the
balance is meaningless until the last line lands.

**(b) A deferred constraint trigger on the header, firing at COMMIT.** This is the
anti-absence clause and it is not optional. A trigger that lives only on the lines
table **never fires for an event that has no lines** — an empty header would pass, and
a system that passes on absence is the fault this repo has measured nine times. The
header trigger re-runs the same check and additionally requires:

- at least one line with `role IN (input, ambient_input)`;
- at least one line with `role IN (output, loss)`;
- every line's `uom` resolvable into `balance_uom`'s dimension (guaranteed by
  `base_per_unit NOT NULL`, restated here so the failure is legible);
- `status = 'posted'` events only — see (d).

It must skip, not raise, when the header itself was deleted in the same transaction
and the lines cascaded.

**(c) Per-row CHECKs that remove the remaining freedoms.**

- `qty > 0` on every line. Magnitude plus `role`, never a signed quantity — a signed
  model lets a negative output cancel a positive one inside the same sum.
- `base_per_unit > 0`, `NOT NULL`.
- `loss_channel NOT NULL` exactly when `role = 'loss'`, and NULL otherwise.
- `output_lot_id NOT NULL` exactly when `role = 'output'`.
- an output lot may not appear among the draws of any input line **of the same
  event** — forbids the one degenerate cycle a lot-level model admits (§6).

**(d) Void is administrative, and it fails closed.** A wrongly-recorded transformation
cannot be physically reversed — you cannot un-peel a carrot. Correction is
`status = 'voided'` plus a compensating pair of ledger rows, and **voiding must be
refused if any output lot of the event has already been drawn from**. Otherwise
voiding retroactively removes stock that a downstream event already consumed, and the
downstream event's balance silently becomes a lie. This is a real failure mode that is
cheap to design for now and expensive to discover in production.

### 3.4 Mass gain is an input; loss is non-negative

Cooking is not mass-conserving in the naive sense: rice, pasta and legumes **absorb**
water, so outputs exceed inputs (`FOOD-REASONING-GRAPH`:106–108). The tempting fix is
a signed loss term that may go negative. **Reject it** — a negative loss can absorb
any shortfall in either direction and reopens §3.1's hole from the other side.

The correct model: **water and any other absorbed medium are input lines**, with
`role = 'ambient_input'` and zero cost. 100 g dry rice + 250 g water → 300 g cooked
rice + 50 g evaporation. Conserved, with `loss >= 0` intact.

`ambient_input` is a distinct role from `input` for two reasons: it carries no cost
into the allocation (§5), and it must be excluded from the denominator when observed
yield is computed (§4.2), or every stock would report a yield above 1.

### 3.5 What this does not prevent — conceded

An operator can put the entire discrepancy into `loss_channel = 'unexplained'` and the
constraint passes. **The design does not stop that and must not claim to.**

What it changes is the kind of thing that failure is:

| Today | Under the primitive |
|---|---|
| A depletion and a receipt with nothing connecting them | One event, refused unless it balances |
| Loss is an absence | Loss is a row with a channel, an actor, a time and a measurement basis |
| Nothing to compare against | An `unexplained` share per event, per cook, per item, per shift |

**And `unexplained` must stay in the vocabulary.** Removing it does not remove the
behaviour; it pushes operators to mis-file into `trim`, which is worse — a false
channel is more damaging than an honest unknown, which is
[[0051-rebuilt-pages-show-live-data-only]]'s rule ("unknown is an em dash") applied to
a write path rather than a render.

**The condition under which the constraint actually bites, stated exactly:** it has
force when all but one line is measured, because then the residual is determined and
there is no freedom left. It degenerates toward bookkeeping as the number of
`estimated` lines rises. That is why `measurement` is `NOT NULL` per line and not a
header-level quality flag — the degeneracy must be visible at the grain where it
happens.

---

## 4. Yield — three quantities, and conflating them is the modelling error

### 4.1 They are different physics and different statistics

| | Trim / fabrication yield | Cooking yield | Portioning |
|---|---|---|---|
| Mechanism | Mechanical separation | Thermal moisture and fat transfer | Division into counted units |
| Mass | **Conserved** — the removed matter still exists | **Not conserved** without ambient inputs | Conserved |
| Produces | By-products that can be costed and sold | Nothing recoverable (evaporation); sometimes fat (rendering) | Off-cuts |
| Variance | Low; a property of the item and the butchering spec | **High**; a property of the process — temperature, time, batch size | Low |
| Direction | Always ≤ 1 | May exceed 1 (rice, pasta, legumes) | ≤ 1 |
| Public prior | USDA AH-102 (2,894 items, OCR needed) | USDA Cooking Yields R2; FNDDS `Moisture change (%)`, 976 dishes | — |

They **multiply**, they do not replace: `FOOD-REASONING-GRAPH`:113 records that the
Cooking Yields table excludes trim and bone by construction. A single "yield" number
per item therefore cannot be right for both, and averaging observations across them
produces a number that describes neither.

**This is why `process_kind` is on the header and is load-bearing.** Without it,
observed yields cannot be partitioned into populations, and the primitive would
produce one undifferentiated ratio — exactly the error this section exists to prevent.
`fabrication` and `prep` populate the trim distribution; `cook` populates the cooking
distribution; `assembly` and `pack` should show yield ≈ 1 and are a useful check that
the mechanism is being used honestly.

### 4.2 Observed yield is derived and is never stored

Storing observed yield as a column would be §3.1's trap a third time: a number the
writer supplies alongside the lines it is supposed to summarise, free to disagree with
them.

```
observed_yield(event, item) =  Σ base_qty(output lines for that item)
                             ─────────────────────────────────────────
                               Σ base_qty(role = 'input')          -- ambient excluded
```

`ambient_input` is excluded from the denominator deliberately (§3.4), so a stock
reports cooking yield against its solid ingredients rather than against the water.

**Correspondence with FNDDS, and its limit.** FNDDS `Moisture change (%)` maps onto
`(Σ outputs − Σ non-ambient inputs) / Σ non-ambient inputs` — the same quantity, so
the public prior and the tenant observation are directly comparable without a
conversion step. The limit, stated because it is easy to overstate: FNDDS records the
*moisture* component, while total mass change also includes rendered fat. The
correspondence is exact only when rendering is zero or recorded as its own channel —
which is why `rendering` is in the loss vocabulary rather than folded into
`evaporation`.

**Expected yield stays where it is and is not moved.** `vendor_price_observations.yield_factor`
is a buying-time number about an offer (§1.3). The yield-prior library — FNDDS
ingestion, AH-102 OCR, per-tenant distributions rather than points — is the BOM
programme's first task, not the primitive's (§8). The primitive's contribution is that
it makes the *observed* side exist at all, so expected-vs-observed variance becomes
computable for the first time.

---

## 5. By-products, and keeping OD-114 open

### 5.1 A by-product is not a schema concept

A butcher's test on a pork loin yields portions, trim and bone. Under this model those
are three **output lines** of one `fabrication` event. Nothing marks one of them
"primary" and the others "by-product" — that distinction is entirely a *costing*
choice, and hard-coding it into the schema would resolve OD-114 by accident.

What the schema holds instead is the allocation itself, per output line, with the
method named:

- `allocated_cost_c bigint` — integer minor units, never a float;
- `allocation_method` from a closed vocabulary — `by_product_credit` ·
  `relative_sales_value` · `nrv` · `physical_mass` · `none` · `manual`;
- `allocation_basis jsonb` — the inputs that method consumed. For
  `by_product_credit` that is the market price used for the credit **and its source**,
  which is a `vendor_price_observations.id` — the table that already exists for
  exactly this (§1.3).

### 5.2 What must be true for either OD-114 answer to sit on top

Three requirements, and the first is currently unmet:

1. **The event's total input cost must be computable.** Today it is not, because the
   FIFO draw discards the cost it consumed (§1.4). `transformation_line_draws.unit_cost_at_draw`
   is the fix and it is a prerequisite, not a nicety.
2. **Allocation must be re-derivable, not baked.** Every input to the calculation is
   stored beside the result and the method is a column, so a second method can be
   computed over the same rows and the two compared — the $21.78 vs $23.35 difference
   becomes a query, not a rebuild. **That is the property that lets OD-114 stay open
   without blocking anything**: history does not have to be rewritten when the
   definition is chosen, only recomputed.
3. **Money conserves like mass.** Σ `allocated_cost_c` over output lines = total input
   cost, enforced by the same deferred-trigger shape. Cents do not divide evenly, so
   remainder-safe allocation is required in the write path — the same requirement ADR
   0070 imposes on quantities, applied to money. The remainder goes to the largest
   line deterministically, never dropped.

`allocation_method = 'manual'` must exist for operator override and it reopens the
free-variable hole for that row only. It is therefore flagged and excluded from any
learned prior, the same treatment `performed_by_type = 'system'` gets in §2.5.

### 5.3 The sub-fork this exposes

Loss lines have a cost consequence and it is not one thing:

- **Evaporation** carries no cost. The money stays with the surviving outputs, which
  is why reduction concentrates cost per gram — physically correct and uncontroversial.
- **Discarded trim or bone** has two defensible treatments: *absorb* (its cost rolls
  into the surviving outputs, so the plate carries the waste) or *write off* (its cost
  goes to a waste account and the plate carries only what it received). Both are
  textbook. They differ on the plate, and they differ in exactly the way OD-114 is
  already about.

This is a sub-fork of OD-114, not a new decision, and §11 annotates that row rather
than filing a sixth.

---

## 6. Multi-stage — carrot → peeled carrot → mirepoix → stock

### 6.1 Why a parent pointer degrades, concretely

`inventory_lots.parent_lot_id` fails on the second hop, not the third: **mirepoix has
three parents.** A scalar column cannot hold a set. It also cannot represent loss at
all — a pointer says where something came from, never how much of the source stopped
existing. And under §1.4's delete-on-depletion it points at rows that get removed.

A lineage *edge* table (`parent_lot`, `child_lot`, `qty`) fixes the arity and still
fails: without an event grouping the edges, there is no set over which a balance can
be stated, and a transformation with **no** output — total spoilage during prep — has
no edge to record at all. The event grouping is what makes conservation expressible,
which is why it is the primitive rather than the edges.

### 6.2 Acyclic by construction — the reason to anchor at lots, not items

At the **item** level the graph genuinely has cycles: stock goes into a sauce which
goes into a stock (remouillage, mother sauces). `FOOD-REASONING-GRAPH`:123–125 flags
cycle detection as a requirement for sub-recipe rollup, and it is right about items.

At the **lot** level it cannot cycle. A lot must exist and hold quantity before it can
be drawn, and an event's outputs are created after its inputs are consumed, so no lot
can be its own ancestor. Time orders the graph.

That is a real structural advantage and it is an argument for the primitive's grain:
**lot-level lineage needs no cycle detection; item-level BOM does.** The single
degenerate case — an event whose output lot is also drawn by one of its own input
lines — is forbidden by the per-row CHECK in §3.3(c).

### 6.3 What happens to cost and mass over three hops

**Cost is O(1) per hop and needs no recursion.** Each event allocates the full input
cost across its outputs, so an output lot's `unit_cost` already *is* the rolled cost of
everything upstream of it. Plate cost reads one lot, not a tree. Recursion is needed
only for provenance questions — "which delivery is in this stock" — and those are
rare, explicitly requested, and can be a `WITH RECURSIVE` walk over events.

**Mass and money are conserved at every hop; what degrades is attribution.** Precisely:

- Both sums are exact at each hop by construction (integer base units, integer cents,
  remainder-safe allocation). Nothing leaks over three hops, or thirty.
- What accumulates is *sibling attribution* error, bounded by one minor unit per
  sibling per hop. After carrot → peeled → mirepoix → stock, the total cost of the
  stock is exact; the share of it attributable to the carrot rather than the onion is
  off by at most a few cents.
- **Multi-input joins convert measurement into allocation.** Before mirepoix, "how
  many grams of that carrot delivery" is a measured quantity. After it, it is a
  proportional estimate whose accuracy depends on the allocation method, not on the
  data. This is a property of mixing, not of the schema, and no design removes it —
  but the schema must not present a post-join attribution with the same confidence as
  a pre-join measurement. A `hops_from_measurement` figure is derivable from the walk
  and is the right thing to surface.

---

## 7. What it unlocks

### 7.1 L3 — consumption variance becomes reachable, by a specific mechanism

The usual framing is that L2 *computes* variance. It does not. What it does is
**remove the explainable part of the residual so that what remains is signal.**

Today, 10 kg of carrot leaving inventory is one undifferentiated depletion, and every
gram of it lands in the bucket L3 calls shrinkage/waste/theft/portion-drift. Under the
primitive, 7 kg is accounted to peeled carrot and 3 kg to a named trim channel, and
the unexplained residual shrinks to the part that genuinely is unexplained. The
variance number stops being dominated by ordinary kitchen physics.

The full theoretical-vs-actual comparison still needs the BOM (§8) — that dependency
is unchanged. But **prep-level yield variance is available with no BOM at all**:
expected yield (from a prior) versus observed yield (from §4.2), per item, per cook,
per shift. That is a shippable L3-class number that exists the day the first events
are written, and it is the earliest evidence that the primitive is working.

### 7.2 L2 BOM inference — which identification problem this attacks

`FOOD-REASONING-GRAPH`:277–282 argues the durable L2 is **inference**, not
elicitation, and names its four identification problems. The primitive moves two of
them:

1. **Waste and yield confounded in the same residual** — attacked directly. Recorded
   loss channels de-confound them: yield becomes *observed per event* rather than
   inferred from a residual that also contains waste. This is the problem the graph
   calls out as the hardest of the four, and it is the one transformation events
   dissolve rather than merely constrain.
2. **Collinearity between co-purchased ingredients** — partially attacked. Each prep
   event is a directly observed row of the BOM matrix for that prep item, so
   sub-recipe coefficients that inference would have to disentangle from receiving
   data are simply *read*. It does nothing for dish-level collinearity.
3. **Inventory-count noise** and **4. recipe drift** are untouched.

Framed for the inverse problem: transformation events are **labelled training rows**,
and labelled rows are the single most valuable input a regularised inverse problem can
receive. FNDDS remains the prior; these are the observations that correct it per
tenant.

### 7.3 L5 — the margin axis

Contribution margin needs plate cost, plate cost needs a per-unit cost of an EP
ingredient, and that number does not exist today because the only yield in the schema
is a vendor-offer estimate (§1.3). §6.3's rolled lot cost is that number.

---

## 8. What this is not

Named explicitly, because the boundary is where scope creep starts:

- **Not recipes or BOM.** A transformation is an **observed event that happened**; a
  recipe is a **specification of what should happen**. The primitive records history
  and predicts nothing. It has no standard quantity, no scaling, no menu link, no
  sub-recipe rollup, and no cycle detection (§6.2 explains why it needs none).
- **Not the yield-prior library.** FNDDS ingestion, AH-102 OCR, per-item distributions
  — the BOM programme's first task. The primitive produces observations; the library
  holds expectations.
- **Not plate cost or menu engineering.** Those need the dish→ingredient link the
  primitive deliberately does not provide.
- **Not the unit ontology.** [[0070-a-quantity-states-its-own-unit]] owns the ledger
  vocabulary and the intake vocabulary fix owns the receiving door. §2.4 consumes both
  and adds only the boundary rule.
- **Not identity.** §2.3.
- **Not production planning or scheduling.** No forward-looking batch, no par-based
  prep list. Those are L5 consumers.
- **Not a replacement for `inventory_transactions`.** §2.2 — the ledger stays the
  single history of stock movement. A full double-entry inventory journal, where
  "trim loss" is an account, is what this design converges toward and is compatible
  with; it is rejected *now* on blast radius, not on principle.

---

## 9. The adversarial pass

Thirteen attacks, run deliberately against the design above rather than by the
reasoning that produced it. Five changed it; the rest are recorded with their answers
so the wrong version cannot circulate.

| # | Attack | Outcome |
|---|---|---|
| A1 | The balance is vacuous — `loss` is a free variable | **Changed the design.** Loss is a line with a closed channel, `>= 0`, not a header scalar; `base_qty` is generated. §3.5 concedes the residue honestly |
| A2 | Nobody will weigh trim; the primitive stays empty | **Changed the design.** `measurement` per line + `performed_by_type`; and any yield over zero events must render as an em dash, never silently fall back to the prior |
| A3 | Inputs are not weighed either, so nothing can balance | **Changed the design.** §3.5 states the exact condition under which the constraint bites, rather than implying it always does |
| A4 | This is double-entry reinvented — put it in the ledger | Rejected. Cross-item, cross-unit balance; and imposing balance on `sale`/`waste`/`adjustment` is wrong. §2.2, §8 |
| A5 | A service-layer check is enough; a deferred trigger is over-engineering | Rejected. A service check is bypassed by every other writer and its absence is invisible. Conceded cost: the error surfaces at COMMIT and the API must translate it into a legible 4xx |
| A6 | `base_per_unit` is the free variable, just moved | **Partly conceded.** Moved from an invisible residual to a named, provenanced, item-stable constant that plate costing reuses — so a lie corrupts a number someone looks at, and an outlier is detectable against the item's own history. **But the first event for a new item has no history and its factor is unfalsifiable** — L0's unfalsifiability recurring one level up |
| A7 | Cycles | Answered: acyclic by construction at lot grain (§6.2); the one degenerate case is CHECK-forbidden |
| A8 | Corrections and reversals | **Changed the design.** §3.3(d) — void is administrative, and must be refused once an output has been drawn from |
| A9 | Concurrency and deadlock | **Changed the design.** `apply_stock_movement` locks `restaurant_inventory` `FOR UPDATE`; a multi-input event locks several, so inputs must be locked in a deterministic order (by `inventory_id`) or two concurrent events deadlock |
| A10 | Schema parity cannot see any of this | Conceded and inherited. The guard sees neither CHECK constraints, nor triggers, nor nullability, nor function signatures. This design's entire integrity is invisible to it, so it inherits ADR 0070's gate — nothing lands before `fix/schema-parity-sees-what-it-claims` — and needs its own test proving an unbalanced insert raises, run against the pre-fix tree |
| A11 | It needs identity after all | Rejected, with the nuance stated: the primitive adds no identity requirement; food's existing block is inherited, not created. §2.3 |
| A12 | Just use `inventory_transactions.metadata jsonb` | Rejected. Nothing constrains jsonb, nothing forces presence, no cross-row balance is expressible, and this corpus has a measured vocabulary-sprawl precedent (102 `close_time` values, 67 free text) |
| A13 | Integer overflow at mg scale | Rejected on measurement: `int4` caps at ~2,100 kg in mg, and only mg-class items pay it because the canonical unit is per-item. §2.4 |

**The design survived. The two concessions that matter and are not designed away** are
A6's first-observation unfalsifiability and A2's adoption risk — an unused primitive
delivers nothing, and no constraint can make a cook weigh trim.

---

## 10. Prerequisites and sequencing

In dependency order. Nothing here is scheduled; it is what must be true.

1. **ADR 0070's `uom` lands.** §2.4 is written on top of it and is meaningless without
   it. Already gated behind `fix/schema-parity-sees-what-it-claims`.
2. **`apply_stock_movement` stops deleting depleted lots** (§1.4, fork F1). Without
   it, lineage degrades to cost-only. Safe by inspection of all three consumers —
   `project_stock_from_lots` sums `qty` (a 0-qty row adds 0), `inventory_lot_rollup`'s
   WAC guard is `sum(qty) > 0` (a 0-qty row is excluded), and the FIFO loop filters
   `qty > 0`. **Inspected, not executed** — see §12.
3. **The FIFO draw records what it consumed** (`transformation_line_draws`). Without
   it no costing method is reachable, including both sides of OD-114.
4. **The enum value and the first write are separate migrations** (§2.2.4).
5. **A guard, per the standing rule.** A test that attempts an unbalanced insert and
   asserts the raise, plus the one-query detector shape ADR 0070 §10.5 uses:
   `SELECT event_id FROM transformation_lines GROUP BY event_id HAVING <imbalance>`
   must return zero rows. The guard must exit non-zero when it cannot check, never
   pass on absence.

---

## 11. Forks — the founder's, not mine

Four. None is defaulted. I am **not** filing a new `OPEN-DECISIONS` row for any of
them: a new row is positional and re-anchors on the order of 45–165 citations across
many files, and all four attach cleanly to rows that already exist. F2 and F3 are
annotations on **OD-114**; F1 belongs with **OD-113** but that row is being rewritten
on `docs/od-113-ledger-migration-options` right now, so it is stated here and left for
whoever lands that branch rather than edited into a conflict. **If the founder wants L2
tracked as its own register line, that is a new row and I have not added one.**

**F1 — Does the ledger write path stop deleting depleted lots?**
*Paths.* (a) Set `status = 'depleted'`, `qty = 0` and keep the row — the value the
schema already declares and nothing sets (§1.4). (b) Keep deleting; accept
cost-only lineage via `unit_cost_at_draw`, and lose the ability to answer "which
delivery is in this dish".
*Cost.* (a) edits `apply_stock_movement`, the single write primitive, which the ADR
0070 lane is editing concurrently — so it is a sequencing question as much as a
design one. It should ride *with* that migration, not follow it.
*Recommendation.* (a), folded into the ADR 0070 migration.

**F2 — May a transformation post with the entire residual in `unexplained`?**
*Paths.* (a) Allow it, flagged, excluded from every prior. (b) Refuse it, so an
event with an unweighed output cannot be recorded at all.
*Cost.* (b) buys clean data and pays for it in adoption: the operator records nothing
instead, and we are back to two unrelated transactions with no event at all. (a) keeps
strictly more information than today's behaviour in the worst case, at the price of a
population of low-quality events that must be filtered everywhere.
*Recommendation.* (a). It makes the primitive strictly dominate today's behaviour even
at zero measurement discipline. But it is a data-policy call, not an engineering one,
and it determines what "we have yield data" will mean.

**F3 — OD-114 sub-fork: discarded trim and bone — absorbed, or written off?**
*Paths.* (a) Absorb — the cost rolls into the surviving outputs and the plate carries
the waste. (b) Write off — the cost goes to a waste account and the plate carries only
what it received.
*Cost.* Both are textbook and they differ on the plate, in the same way and for the
same reason as OD-114's $21.78 vs $23.35. §5.2 keeps both computable, so this can be
answered later — but it must be answered before any margin number is shown to a user
as a fact.
*Recommendation.* None. This is a costing-definition call and OD-114 is the row that
owns definitions.

**F4 — Build the primitive now on beverage, or hold until identity resolves?**
*Paths.* (a) Build now, proving it by replacing the `open_bottle_ml` bolt-on (§2.3) —
which means touching `record_glass_pour`, a live path. (b) Hold the design and build
when food is representable.
*Cost.* (a) proves the constraint, the trigger pattern (new to this codebase — there
is not one `DEFERRABLE` constraint in any of the 87 migrations) and the write
ergonomics on data that exists, and it removes a bolt-on ADR 0070 already wants gone.
It also puts a live pour path at risk for a benefit that is entirely about food.
(b) is safe and leaves the keystone unbuilt for as long as identity stays open, which
`FOOD-REASONING-GRAPH`:288 records as *unfalsifiable* — i.e. possibly a long time.
*Recommendation.* (a), because it is the only path on which the design is falsified
before food depends on it. But it is genuinely a risk appetite call.

---

## 12. What I could not verify

Stated plainly per CLAUDE.md §0.5.

- **Nothing was executed against a database.** Every schema claim is read from
  migration files at `origin/main` and cited by `file:line`. The production row counts
  and rounding behaviour quoted from [[LEDGER-FOOD-MIGRATION-OPTIONS]] were verified
  by that document's authors, not re-verified here.
- **§10.2's "safe by inspection" is an inspection, not a test.** I read the three
  consumers of `inventory_lots.qty` and reasoned that a 0-qty row is inert in each.
  That is a code-reading claim and it must be proven by a test before the change lands.
- **The Postgres enum mechanic in §2.2.4 is documented behaviour I did not run.**
  Postgres 17 (`supabase/config.toml:36`) permits `ALTER TYPE … ADD VALUE` inside a
  transaction block but refuses to *use* the new value in that same transaction; the
  practical consequence for the migration split should be confirmed by running it.
- **Deferred constraint triggers are a new pattern here.** A grep for `DEFERRABLE`
  across all migrations returns nothing, so there is no in-repo precedent for the
  behaviour under `supabase db reset`, under RLS, or in the PostgREST error surface.
- **No performance work.** The deferred trigger's cost per event, and the recursive
  provenance walk's cost at depth, are unmeasured.
- **`services/` (Python) was not swept** for anything that would need to learn about
  transformation rows. The same gap [[LEDGER-FOOD-MIGRATION-OPTIONS]] §10.8 declares.
