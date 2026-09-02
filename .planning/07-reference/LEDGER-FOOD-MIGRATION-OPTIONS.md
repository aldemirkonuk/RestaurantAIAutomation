# Ledger → food: migration options for OD-113

> **Status: evidence for a founder call. Nothing here is decided.**
> OD-113 is marked a founder call in
> [`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md):67. This document exists to
> make that call *ready*, not to make it. No option below is recommended as settled;
> §9 states the one question that remains.
>
> **Measured 2026-09-02** against `origin/main` @ `a645c06a`, 87 migrations, and the
> live production database (`exzueerziesmczwlhomd`, read-only). No migration was
> written and nothing was applied.

**Retire-to-write (CLAUDE.md §4).** This document **supersedes the ledger paragraph of
[`FOOD-REASONING-GRAPH.md`](FOOD-REASONING-GRAPH.md):92–100** and takes over OD-113's
evidence base. That paragraph's denominator ("all 64 migrations") is stale — there are
87 — and its scoping claim ("Intake is fine") is **false at the API boundary** (§2.3).
The stale line is corrected in the same commit so the corpus does not carry two
disagreeing numbers ([ADR 0025](../decisions/0025-citations-must-disagree-loudly.md)).
No whole document is retired: nothing in `07-reference/` covers ledger shape, and
`INVENTORY_ADD_REMOVE_SCENARIOS.md` — the nearest neighbour — is a UI-flow brief whose
content this would destroy rather than absorb.

---

## 1. The measured present

### 1.1 The three ledger tables

All three are created in the baseline and **have never been altered since**. A
case-insensitive sweep for `ALTER TABLE … inventory_lots|restaurant_inventory|inventory_transactions`
across all 87 migrations returns only three `ENABLE ROW LEVEL SECURITY` statements and
one unrelated `ADD COLUMN` batch
(`20260805132000_counting_catalog_and_correlation_columns.sql:8`). The baseline shape
is the live shape, and `information_schema` on production agrees column-for-column.

| Column | Type | Null | Cite (`supabase/migrations/20260805000000_baseline_from_production.sql`) |
|---|---|---|---|
| `restaurant_inventory.master_wine_id` | `uuid` | **NOT NULL** | :3262 |
| `restaurant_inventory.stock_live` | `integer` d`0` | NOT NULL | :3264 |
| `restaurant_inventory.physical_stock` | `integer` | null | :3265 |
| `restaurant_inventory.shadow_stock` | `integer` d`0` | null | :3266 |
| `restaurant_inventory.expected_stock` | `integer` d`0` | null | :3267 |
| `restaurant_inventory.in_transit_quantity` | `integer` d`0` | null | :3268 |
| `restaurant_inventory.threshold_min` | `integer` d`3` | NOT NULL | :3269 |
| `restaurant_inventory.current_volume_ml` | `double precision` | null | :3300 |
| `restaurant_inventory.unit_type` | `varchar(20)` d`'BOTTLE'` | null | :3301 |
| `restaurant_inventory.is_generic_bucket` | `boolean` d`false` | null | :3302 |
| `inventory_lots.master_wine_id` | `uuid` | **NOT NULL** | :3175 |
| `inventory_lots.inventory_id` | `uuid` | null | :3174 |
| `inventory_lots.qty` | `integer` d`0` | NOT NULL | :3178 |
| `inventory_lots.open_bottle_ml` | `integer` d`0` | NOT NULL | :3179 |
| `inventory_transactions.wine_id` | `uuid` | **NOT NULL** | :3227 |
| `inventory_transactions.quantity_change` | `integer` | NOT NULL | :3230 |
| `inventory_transactions.quantity_before` | `integer` | NOT NULL | :3231 |
| `inventory_transactions.quantity_after` | `integer` | NOT NULL | :3232 |

**OD-113's structural claim is TRUE.** Three `NOT NULL` wine FKs, integer quantities, no
`item_type`, no food table, no generic path. `is_generic_bucket` exists as an escape
hatch and is **`false` on all 72 production rows** — it was never used. `unit_type` is
`'BOTTLE'` on all 72.

### 1.2 Constraints, indexes, FKs, triggers

**Constraints.** `inventory_lots`: `qty >= 0`, `open_bottle_ml >= 0`, plus CHECKs on
`cost_provenance`, `status`, `stock_state` (:3188–3192). `inventory_transactions`:
`valid_quantity_after` (`quantity_after = quantity_before + quantity_change`) and
`valid_quantity_change` (`<> 0`) (:3250–3251). `restaurant_inventory`: `sale_type` and
`unit_type` CHECKs (:3323–3324).

> **The load-bearing one:** `restaurant_inventory_restaurant_id_master_wine_id_key
> UNIQUE (restaurant_id, master_wine_id)` (:7672). Postgres treats `NULL`s as distinct,
> so **the moment `master_wine_id` becomes nullable this constraint stops constraining
> food entirely** — unlimited duplicate flour rows per restaurant, silently. Any option
> that nullifies this column must replace it. This is not a detail; it is the
> difference between a ledger and a pile.

**Foreign keys — inbound (9 tables point at `restaurant_inventory.id`):**
`glass_pour_tracking` (:12670), `inventory_lots` (:12686, `ON DELETE CASCADE`),
`procurement_order_items` (:13118), `procurement_orders` (:13150), `rfq_requests`
(:13422), `sales_events` (:13446), `sku_mappings` (:13542), `toast_item_mappings`
(:13662), `wine_consumption_log` (:13814, `ON DELETE CASCADE`).

**Foreign keys — outbound:** `restaurant_inventory.master_wine_id → master_wine_library(id) ON DELETE CASCADE`
(:13334) is the **only** FK on any of the three wine-identity columns.
`inventory_lots.master_wine_id` and `inventory_transactions.wine_id` have **no FK at
all** — they are already unenforced references. `inventory_transactions` carries exactly
one FK, on `restaurant_id` (:12702); its `inventory_id` and `wine_id` are unguarded.

**Indexes.** `idx_inv_txn_wine` (:9360), `idx_inventory_lots_ri (restaurant_id, master_wine_id)`
(:9402), `idx_restaurant_inventory_wine` (:10949), plus a duplicate at
`20260813170000_enrichment_demand_priority.sql:115`. Eleven further `inventory_transactions`
indexes (:9290–9353) and fifteen on `restaurant_inventory` (:10820–10949).

**Triggers.** `trg_project_stock_from_lots` on `inventory_lots` (:12188) →
`project_stock_from_lots()` (:1111–1125), which projects `SUM(qty)` back into
`restaurant_inventory.stock_live` / `shadow_stock`.
`update_restaurant_inventory_updated_at` (:12286) and `sync_sku_on_inventory_insert`
(:12125).

**RLS.** `restaurant_inventory` 1 policy, `inventory_transactions` 2, `inventory_lots`
RLS-enabled with **zero policies**. No policy references any wine column, so the
identity decision does not touch RLS.

### 1.3 Production row counts — the finding that changes the question

| Table | Rows |
|---|---|
| `master_wine_library` | 4,094 |
| `restaurant_inventory` | **72** |
| `inventory_lots` | **2** |
| `inventory_transactions` | **4** |
| `procurement_document_lines` | **0** |
| `sales_events` · `wine_consumption_log` · `glass_pour_tracking` · `sku_mappings` · `toast_item_mappings` | 0 |
| `procurement_order_items` | 1 |
| `restaurants` | 10 |

The 72 `restaurant_inventory` rows sit across 5 restaurants; 50 of them belong to
`550e8400-e29b-41d4-a716-446655440000` — the seed UUID. Consistent with the recorded
production tenant shape (10 restaurants, 1 real tenant).

> **OD-113 frames this as "an `ALTER` of column types and nullability against live
> production data, not an additive migration." That framing is technically true and
> practically empty.** An `ALTER TABLE … TYPE numeric` rewrites the table; on 72, 2 and
> 4 rows it completes in milliseconds under a lock nobody will observe. The cost of this
> migration is **not** a function of table size, because there is no table size. Every
> argument in this decision that rests on migration risk is void. What remains is a pure
> modelling question — which is a different, and better, question.

### 1.4 What depends on the quantity columns

**9 views/matviews** read these tables; **8 use a quantity column**:
`inventory_analytics`, `inventory_location_breakdown`, `inventory_lot_rollup`
(:3200–3216), `inventory_volume_details`, `v_active_inventory`, `v_low_stock_items`,
`v_restaurant_sku_reference`, and the **materialized** `inventory_transaction_summary`.
Postgres refuses `ALTER COLUMN … TYPE` on a column any view selects, so all 8 must be
dropped and recreated inside the migration, and the matview rebuilt.

**20 functions** reference these tables; **14 touch a quantity column**, **15 touch a
wine id**. Seven carry an **integer quantity in their signature**:

| Function | Integer quantity parameter |
|---|---|
| `apply_stock_movement` | `p_delta integer` |
| `set_stock_absolute` | `p_target_qty integer` |
| `transfer_stock` | `p_qty integer` |
| `record_glass_pour` | `p_pours integer`, `p_pour_ml integer` |
| `log_pos_sale` | `p_quantity integer` |
| `log_waste` | `p_quantity integer` |
| `log_comp` | `p_quantity integer` |

`apply_stock_movement`
(`20260805130000_extend_apply_stock_movement.sql`:31–120) is the single stock write
primitive — it locks the inventory row, reads `master_wine_id` into `v_wine` (:76–77),
depletes lots FIFO, and writes the ledger row. Its locals are `int` (:55).

> A signature change here is **not** a `CREATE OR REPLACE`. Postgres treats a different
> argument type as a *new overload*, and two overloads of one name make PostgREST RPC
> ambiguous (`PGRST203`). Each of the seven needs `DROP FUNCTION` + `CREATE` in the same
> migration. Because the gateway calls these by **named** arguments through supabase-js,
> a clean drop-and-recreate that keeps parameter names is transparent to the running
> gateway — but only if drop and create are atomic.

---

## 2. Where OD-113 is wrong

Verified before reasoning from it, per CLAUDE.md §5b. Three corrections.

**2.1 "all 64 migrations" — there are 87.** The claim was true when written and the
denominator was never re-measured. The *conclusion* survives re-measurement: no
migration between #65 and #87 touched these columns.

**2.2 "an ALTER against live production data" implies a cost that does not exist.**
72 / 2 / 4 rows. See §1.3.

**2.3 "Intake is fine" is true at the database and false at the API.**
`procurement_document_lines.qty` is `numeric(12,3)` (:4386) with a 7-value `uom` CHECK
(:4401) — both confirmed. But the DTOs that write that table enforce **`@IsInt()` on 14
quantity fields across 5 files**, ten of them in `procurement.dto.ts` alone
(`:46, :173, :243, :258, :267, :282, :290, :351, :367, :375`), plus
`recurring-order.dto.ts:60, :149`, `retroactive-order.dto.ts:52`, and
`inventory-ledger.dto.ts:73`. `procurement.dto.ts:240–243` rejects an `invoiceQuantity`
of `4.5` with a 400 before it ever reaches the `numeric(12,3)` column that would have
stored it perfectly. **Intake cannot accept 4.5 kg of flour today either.** The break is
at the ledger *and* at the API boundary; only the intake *column* is ready.

---

## 3. Two decisions wearing one coat

OD-113 asks one question. It contains two, and they are independent — either can be
taken without the other.

- **The identity axis (§4).** Can a ledger row denote something that is not a row in
  `master_wine_library`? This is a modelling decision about referential integrity.
- **The quantity axis (§5).** Can a ledger row hold a fractional amount? This is a
  representation decision.

They are severable: you can widen quantities today and never touch identity, or vice
versa. Conflating them is what makes OD-113 look bigger than it is.

---

## 4. Identity axis — five structural options

### Option A — Widen in place (nullable wine id + polymorphic pair)

`master_wine_id` / `wine_id` → nullable; add `item_kind` + `item_id` (or the
`domain ∈ {beverage, food, supply}` discriminator already sketched at
[`INVENTORY_SOTA_PLAN.md`](INVENTORY_SOTA_PLAN.md):352).

- **Breaks:** the `UNIQUE (restaurant_id, master_wine_id)` guarantee (§1.2) — must be
  replaced with per-kind partial uniques or a generated identity column. Every existing
  query that joins `master_wine_library` unconditionally needs a kind filter.
- **Migrate:** trivial. 72/2/4 rows, 8 views rebuilt.
- **Live with:** `item_id` **can carry no foreign key** — polymorphic references are
  FK-less by construction. This repo has three ADRs on exactly this failure class
  ([0015](../decisions/0015-pos-referential-integrity.md),
  [0028](../decisions/0028-phantom-relations-repoint-or-delete.md),
  [0030](../decisions/0030-pos-mapping-inventory-integrity.md)) and a measured history
  of 92 orphaned mappings. A is the option that *reintroduces* the defect those ADRs
  closed.
- **Forecloses:** least of any option; it is the most reversible.

### Option B — Parallel food ledger, shared transaction log

New `food_inventory` + `food_lots`; `inventory_transactions` becomes the shared log.

- **Breaks:** to be shared, the log still needs a nullable `wine_id` and a discriminator
   — so B **inherits A's polymorphism problem at the log** while also duplicating the
  on-hand tables and forking `apply_stock_movement` in two.
- **Migrate:** moderate — new tables are additive, but the log change is A's change.
- **Live with:** two on-hand tables that must agree; two write primitives; every
  analytics query unioned. `cost-basis.ts` and the 8 views double.
- **Forecloses:** a single ledger, more or less permanently — once two write paths
  exist, merging them is a second migration nobody funds.
- **Honest strength:** beverage's working hot path stays typed and untouched.

### Option C — Generic `items` supertype

New `items(id, restaurant_id, kind, name, uom, …)`; `restaurant_inventory.item_id` FK →
`items(id)`; beverage detail moves to a `beverage_items` side table or stays as a
nullable `master_wine_id`.

- **Breaks:** the identity column of the one subsystem that currently works.
- **Migrate:** highest — but **only 72 item rows to backfill**, not millions. The row
  counts make C's migration cost roughly equal to A's.
- **Live with:** a real FK. One ledger, one `apply_stock_movement`, one set of views.
  This is the textbook-correct model.
- **Forecloses:** nothing structurally — but see §8.

### Option D — Intake-side only; never touch the ledger

Answer food questions from `procurement_document_lines` plus a separate consumption
model.

- **Migrate:** zero.
- **Live with:** `procurement_document_lines` has **0 rows in production** (§1.3), so
  this option's data source is as empty as the ledger's. It yields purchases but never
  on-hand: no variance, no waste, no theoretical-vs-actual. `FOOD-REASONING-GRAPH`
  L3 is explicitly unreachable without L1.
- **Forecloses:** L3 and everything above it — permanently, unless A or C happens later
  anyway. D is a decision to answer a smaller question, not a cheaper way to answer this
  one.

### Option E — Do nothing; force food through `master_wine_library`

**This works today and needs no migration**, which is why it must be named and refused
explicitly rather than discovered later under time pressure. `master_wine_library`
requires only `wine_id`, `name`, `producer`, `primary_type`, `country` and
`bottle_size_ml` (defaulted `750`); `beverage_kind` defaults to `'unknown'`, which
passes its own CHECK (`wine, beer, spirit, sake, cider, cocktail, non_alcoholic,
unknown`). Flour inserts cleanly.

- **Live with:** it poisons a 4,094-row library with non-wine, breaks
  `beverage_identity_key` and the merge-policy gates that CI enforces
  (`schema-parity.yml`:159–181), and makes `beverage_kind` a lie in every downstream
  classifier.
- **Named here so that "we could just…" has a written answer.**

---

## 5. Quantity axis — three options, decided separately

The blast radius, measured, with denominators.

| Surface | Touching quantity | Denominator |
|---|---|---|
| Gateway TS (non-spec) | **12 files** | 339 |
| Gateway TS (incl. specs) | 23 files | 474 |
| Hard-rounding sites that would silently destroy a fraction | **10** | — |
| `@IsInt()` on a quantity DTO field | **14 fields** | 5 files |
| Web + mobile TS | 18 files | — |
| Python (`services/`) | 38 files | — |
| DB functions touching quantity | 14 | 20 referencing |
| DB functions with integer quantity in signature | 7 | 20 |
| Views to drop/recreate | 8 (1 materialized) | 9 |

**The 10 rounding sites** — each turns 4.5 into 5 (JS `Math.round` is half-up), silently:

`inventory.service.ts:373` and `:409` (`Math.round(Number(dto.countedQty))` — a spot
count, rounded before the RPC) · `toast.service.ts:464` · `pos-hub.service.ts:711` ·
`pos-mapping-review.service.ts:380` · `simpos.service.ts:318` ·
`photo-count.service.ts:163` · `photo-count-verdict.ts:79` ·
`receiving.service.ts:449` · `inventory.service.ts:75` (`Math.floor` for glasses per
bottle — legitimately integer; listed for completeness, not for change).

The API boundary is **already inconsistent**: the same logical field `stockLive` is
`@IsNumber()` at `inventory.dto.ts:43–45` and `@IsInt()` at `:279–282`.

- **Q1 — `integer` → `numeric(12,3)`.** Matches `procurement_document_lines` exactly, so
  intake and ledger finally speak one type. Nearly free at the DB (§1.3); the work is the
  10 rounding sites, 14 decorators, 7 function signatures and 8 views. **Note:** widening
  to `numeric` also means every `Number()` in TS now reads a string from supabase-js —
  `numeric` serialises as a string in JSON to preserve precision. That is a quiet
  third category of consumer, not counted above.
- **Q2 — Keep `integer`; store minor units (grams, millilitres).** The financial-cents
  pattern. Zero DB migration, zero view rebuild, zero function signature change, and the
  codebase already does this for volume (`open_bottle_ml`, `current_volume_ml`). Cost is
  a permanent per-item scale factor and a legibility tax forever. **This option is
  invisible in OD-113's framing and is a genuine contender.**
- **Q3 — `numeric` unconstrained.** Rejected on sight: no scale means no equality, and
  `valid_quantity_after` is an exact-equality CHECK (:3250).

---

## 6. A migration path that does not break schema parity

### 6.1 How the gate actually behaves

`schema-parity.yml` runs on **push to main, on `pull_request`, and daily** (:27–36). It
rebuilds a local DB from migrations and diffs against **production**. Production is
currently at `20260901200000_receiving_preserves_the_pair` — exactly `main`'s newest
migration, which is the evidence that migrations arrive on merge rather than by hand.

Two properties of `check_schema_parity.sh` decide everything:

1. **The comparison key is `table_name||'.'||column_name||':'||data_type`** (:66–68). A
   type change is caught **twice** — once as `IN LOCAL, NOT IN REMOTE` and once as
   `IN REMOTE, NOT IN LOCAL`.
2. **`is_nullable` is not in the key.** A `DROP NOT NULL` is **invisible** to this
   check. That is an instance of the recorded cross-cutting fault — a system reporting
   absence as health — and it means the identity half of this migration would pass
   parity silently while the quantity half goes red.

**Therefore: any type-changing PR is red on schema-parity from the moment it is opened
until the merge applies it.** This is by construction, not a defect. It is survivable
because `CI Complete` (`ci.yml`:389–398) requires `build, gateway-boot, test-typescript,
test-e2e, test-python, merge-identity-gate, security` — **schema-parity is not among
them**, so branch protection does not block on it.

### 6.2 The sequence

Each step is one merge that leaves production and `main` consistent.

| # | Merge | Parity after merge |
|---|---|---|
| 0 | **Nothing.** Record the decision as an ADR first. | green |
| 1 | **Code tolerates both shapes.** Remove the 10 hard-roundings; relax the 14 `@IsInt()` to `@IsNumber()` + an explicit scale check; make every reader `Number()`-coerce so a `numeric` string parses. No DDL. | green (no DDL) |
| 2 | **DDL: quantity widening.** One migration: drop 8 views → `ALTER … TYPE numeric(12,3)` → recreate 8 views → `DROP`+`CREATE` the 7 functions with `numeric` parameters, names unchanged. | red on the PR, **green after merge** |
| 3 | **DDL: identity**, if chosen. Additive first (`items` / discriminator), backfill 72 rows, *then* `DROP NOT NULL` in a later migration once no writer omits the new column. | green throughout (nullability is invisible to the check — §6.1) |
| 4 | **Replace the uniqueness guarantee** lost at step 3 (§1.2). | green |

Step 2 is the only red, and only between opening and merging. **Nothing is ever applied
by hand**; hand-applying ahead of merge creates the version mismatch this workflow was
written to catch.

---

## 7. What is irreversible

| Step | Reversible? | Cost of rollback after it |
|---|---|---|
| Relaxing `@IsInt()` → `@IsNumber()` (step 1) | Yes | A revert. But any fractional value **accepted and stored** while relaxed cannot be un-accepted — the ledger now holds values the integer column cannot represent. This is the first one-way door, and it is in a *code* change, not a DDL one. |
| `integer` → `numeric` (step 2) | **Narrowing back is not** | `numeric → integer` fails on any row with a fraction, and succeeds by **silent rounding** if you add a `USING` cast. Reversible only while no fractional row exists. |
| Dropping and recreating 8 views | Yes | The definitions are in migrations; the matview must be repopulated. |
| `DROP`+`CREATE` of the 7 functions | Yes | But there is a window inside the migration where the function does not exist. Any concurrent RPC in that window fails. |
| Backfilling 72 rows into `items` (C) | Yes | 72 rows, deletable. |
| `DROP NOT NULL` on a wine id (A/C) | **No, in practice** | Restoring `NOT NULL` requires every row to have a value. Once one food row exists with a null wine id, the constraint cannot come back without deleting real data. |
| Writing food rows into `master_wine_library` (E) | **No** | The library is the input to identity, merge and dedup algorithms with their own CI gates. Non-wine rows contaminate 4,094 rows of curated data and every model trained or tuned on them. |

The genuinely irreversible acts are **admitting the first fractional value** and
**admitting the first null wine id** — not the DDL. Both are cheap to *do* and
impossible to undo, which is the opposite of the risk profile OD-113 describes.

---

## 8. The adversarial pass

**I was drawn to Option C** (generic `items` supertype). It is the textbook-correct
model, it preserves a real foreign key in a codebase with a documented FK-integrity
failure history, it keeps one write primitive, and the row counts (§1.3) collapse its
supposed migration cost to roughly A's.

**The strongest case against C**, argued to kill it:

1. **It is scaffolding around an empty room.** Production holds 72 inventory rows, 2
   lots, 4 transactions, 0 procurement lines and 1 real tenant. C builds a supertype for
   a food business with zero food rows and zero food customers. **This register already
   contains that exact argument** — OD-116 rejects a three-team carve because the
   division "has zero people and zero shipped domain code, so three units risks
   scaffolding around an empty room." The same test applied here fails C.
2. **It rewrites the identity column of the one thing that works.** The POS bridge took
   insights from 1.4% to 67.4% on the beverage ledger. C's blast radius lands squarely
   on that path in exchange for capability nobody is yet asking the system for.
3. **The killer: C requires a food identity model that does not exist and cannot be
   validated.** `FOOD-REASONING-GRAPH`:288 records that food L0 identity is
   **unfalsifiable** — there is no negative-label source, unlike beverage which is
   "strong, falsified at scale". An `items` supertype forces you to declare an identity
   key for food *in order to create the table*. That inverts the graph's own forced
   order (L0 → L1 → L2, :259) by making L1's schema depend on an unanswered L0. The
   repo's 4,094-row wine library and its merge-policy gates are a standing demonstration
   of how expensive a wrong identity model is to unwind.

**Did C survive? No — not as the immediate move.** Point 3 is not a cost objection that
better engineering absorbs; it is a sequencing error. C cannot be built correctly before
food identity is answered, and food identity is a research question that
`FOOD-REASONING-GRAPH` places *below* the ledger in the dependency order for a reason.

**What survived the pass is not an option but a reframing.** Because the migration is
nearly free at 72/2/4 rows (§1.3), and because the two axes are severable (§3), *there
is no cost to deferring the identity decision and no benefit to rushing it.* The
quantity decision, by contrast, is cheap, independently useful, and unblocks the API
boundary defect found at §2.3 — which is a live inconsistency today, wholly independent
of food.

This means the honest output of this pass is that **A, B and C are all premature, D is a
decision to answer a smaller question, and E is refused** — while the *quantity* axis is
ready to decide now. I record that as the result rather than nominating a survivor,
because nominating one would be the anchoring failure CLAUDE.md §3 exists to prevent.

**Where this analysis is weakest:** the fan-out was single-threaded. CLAUDE.md §3 calls
for parallel `Workflow` fan-out with independent finders on decisions of this weight;
the harness this session ran under forbids spawning subagents unless asked, so §4's five
options were generated and attacked by one reasoner. A genuinely independent adversary
might find an option-space branch not represented here. Stated per §0.5.

---

## 9. The question for the founder

Everything above reduces to one fork. It is genuinely open and it is not mine to take.

> **Do we widen the quantity columns now — cheap, reversible-while-empty, fixes a live
> API inconsistency, and commits to nothing about food identity — and defer the identity
> decision (A/B/C) until a food identity model exists? Or do we commit to an item model
> now and accept building it before its L0 is answerable?**

Deciding "widen quantities, defer identity" costs one ADR and the §6 steps 1–2. It does
**not** unblock `FOOD-REASONING-GRAPH` L2 on its own — L2 waits on identity either way —
so choosing it is a decision to keep waiting deliberately rather than by accident.

Subsidiary, and only if the first answer is "widen": **Q1 (`numeric(12,3)`) or Q2
(integer minor units)?** §5 argues Q1 for type-parity with intake; Q2 is defensible and
cheaper and should not be dismissed silently.

---

*Measured and written 2026-09-02 against `origin/main` @ `a645c06a`. Read-only against
production; no migration written, nothing applied.*
