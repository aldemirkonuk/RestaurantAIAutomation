# Ledger → food: migration options for OD-113

> **Status: evidence for a founder call. Nothing here is decided.**
> It is marked a founder call in
> OD-113 ([`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md):68). This document exists to
> make that call *ready*, not to make it. No option below is recommended as settled;
> §9 states the one question that remains.
>
> **Measured 2026-09-02** against `origin/main` @ `a645c06a`, **86 migrations**, and the
> live production database (`exzueerziesmczwlhomd`, read-only). No migration was
> written and nothing was applied.
>
> **§10 supersedes §9.** A five-lens audit (premortem · scalability · longevity ·
> operator reality · blast radius) plus an independent adversarial pass ran after §1–§9
> were written. It **killed this document's own conclusion** and surfaced a sixth
> option. Read §10 first; §1–§8 remain the evidence base, §9 is kept as the superseded
> question so the change of mind is legible rather than silently overwritten.

**Retire-to-write (CLAUDE.md §4).** This document **supersedes the ledger paragraph of
[`FOOD-REASONING-GRAPH.md`](FOOD-REASONING-GRAPH.md):92–100** and takes over OD-113's
evidence base. That paragraph's denominator ("all 64 migrations") is stale — there are
87 — and its scoping claim ("Intake is fine") is **false at the API boundary** (§2.3).
The stale line is corrected in the same commit so the corpus does not carry two
disagreeing numbers ([ADR 0025](../decisions/0025-citations-must-disagree-loudly.md)).
No whole document is retired: nothing in `07-reference/` covers ledger shape, and
`INVENTORY_ADD_REMOVE_SCENARIOS.md` — the nearest neighbour — is a UI-flow brief whose
content this would destroy rather than absorb.

**Migration-count corrections, kept on purpose.** OD-113 said 64. This document first
said 87. A session counting `supabase/migrations/*.sql` said 91. The true figure at
`a645c06a` is **86**, plus 5 files under `migrations/seed/` which are not migrations —
that is where 91 came from, and where 87 was simply off by one. Four numbers for one
`ls`. They are recorded rather than quietly replaced because the discrepancy is the
point: this is the same corpus that documents "numbers get re-measured, never copied
forward" (CLAUDE.md §5b), and it happened anyway, four times, inside the document
written to fix a stale denominator.

---

## 1. The measured present

### 1.1 The three ledger tables

All three are created in the baseline and **have never been altered since**. A
case-insensitive sweep for `ALTER TABLE … inventory_lots|restaurant_inventory|inventory_transactions`
across all **86** migrations at the commit named in the header returns only three
`ENABLE ROW LEVEL SECURITY` statements and
one unrelated `ADD COLUMN` batch
(`20260805132000_counting_catalog_and_correlation_columns.sql:8`). The baseline shape
is the live shape, and `information_schema` on production agrees column-for-column.

> **Denominator, dated.** This paragraph shipped saying *87* while the header of the
> same document said *86* — the fifth count in the sequence the register row was
> written to end. Both are snapshots: migrations are append-only, and `ls
> supabase/migrations/*.sql` returns **94** on `origin/main` as of 2026-09-02 22:44Z.
> The sweep's *result* is unaffected — it is a claim about which statements exist, not
> about how many files were searched — but a denominator with no date is a claim that
> starts rotting the moment it is written.

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
(:4401) — both confirmed. But the DTOs that write that table enforce **`@IsInt()` on 15
live quantity fields across 5 files**, ten of them in `procurement.dto.ts` alone —
`quantity` (:46), `quantityReceivedInOrderUom` (:179), `invoiceQuantityInInvoiceUom`
(:350), `shippedQuantityInShippedUom` (:369), `freeGoodsQuantityInCountedUom` (:378),
`acceptedQuantityInCountedUom` (:395), `rejectedQuantityInCountedUom` (:405) and the
three `prefilled*` twins (:467, :485, :494) — plus `recurring-order.dto.ts:60, :149`,
`retroactive-order.dto.ts:52`, `inventory-ledger.dto.ts:73` and
`storage-locations.dto.ts:154`. Nine further `@IsInt()` quantity fields in
`procurement.dto.ts` sit in the `@deprecated` unitless block (:196, :529, :540, :551,
:562, :573, :584, :595, :606) and are excluded — 24 in total if they are counted.
`procurement.dto.ts:347–350` rejects an `invoiceQuantityInInvoiceUom` of `4.5` with a
400 before it ever reaches the `numeric(12,3)` column that would have stored it
perfectly. **Intake cannot accept 4.5 kg of flour today either.** The break is at the
ledger *and* at the API boundary; only the intake *column* is ready.

> **Re-anchored 2026-09-02** (merge-check on #248). The ten `procurement.dto.ts`
> anchors this paragraph shipped with — `:46, :173, :243, :258, :267, :282, :290,
> :351, :367, :375` — resolved on the very commit that merged them to a string
> fragment, three comment lines, a `})`, a `@Min(0)` and two blank lines; only `:46`
> named a quantity field. The *count* was right and the finding is real; the locators
> were measured against a pre-rebase tree and never re-read. The fifth file the
> sentence promised was also missing from the list — `storage-locations.dto.ts`,
> which OD-113's register row names — so "14 across 5 files" was 14 across 4. Every
> anchor above is the FIELD line, matching the convention the other four files use,
> and was re-measured on `origin/main` @ `77eb7888`.

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

`inventory.service.ts:408` and `:435` (`Math.round(Number(dto.countedQty))` — a spot
count, rounded before the RPC) · `toast.service.ts:464` · `pos-hub.service.ts:746` ·
`pos-mapping-review.service.ts:380` · `simpos.service.ts:318` ·
`photo-count.service.ts:163` · `photo-count-verdict.ts:79` ·
`receiving.service.ts:575` (`Math.round(totals.receivedBottles / packSize)` — bottles
converted to whole cases) · `inventory.service.ts:76` (`Math.floor` for glasses per
bottle — legitimately integer; listed for completeness, not for change).

> **Re-anchored 2026-09-02** (merge-check on #248). Four of the ten moved: three by
> ordinary drift after this document merged (`inventory.service.ts:373→408`,
> `:409→435`, `:75→76`, `pos-hub.service.ts:711→746`), and one — `receiving.service.ts`
> — was wrong when written: `:449` was a closing brace on the merging commit, and the
> rounding site it describes is `:575`. The count of ten and the claim each makes are
> unchanged; only the locators are.

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

## 9. The question for the founder — ⚠️ SUPERSEDED BY §10

> **Kept deliberately, not deleted.** The audit in §10 killed the "widen quantity now"
> half of this section. It is preserved so the reasoning that was abandoned stays
> visible; ADR 0025's rule is that citations must disagree loudly rather than silently.

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

---

## 10. Five-lens audit — the decision as it actually stands

Commissioned by the founder on 2026-09-02: *"deploy 5 audit agents — each agent serves a
different purpose: premortem, scalability, longevity…"* Five independent auditors each
ranked every option through **one lens only**, with no visibility of each other, on a
shared fact base re-verified against live production. A separate adversary attacked §1–§9
beforehand. The single-reasoner limitation §8 admits to is what this section repairs.

### 10.1 What the audit changed

**The quantity axis is settled. The identity axis is not, and the two are severable — so
only one of them has to be decided now.**

| Lens | Quantity ranking | Identity ranking |
|---|---|---|
| Premortem | **F** > Q2 > Q1 | A > D > B > C > **E refused outright** |
| Scalability | **F** > Q2 > Q1 | C > A > B > D > E |
| Longevity | **F** > Q2 > Q1 *(revised under challenge — see 10.3)* | A > C > B > D > E |
| Operator reality | **F** > Q1 > Q2 | C ≈ A > B > E > D |
| Blast radius (counted, not judged) | **F** — 0 SQL objects, 0 gateway files, 0 inputs | not swept — gap declared |

**Option F wins the quantity axis 5–0.** It is not in §5's list of three; it emerged from
the adversarial pass. **Option E is refused by every lens that ranked it.**

### 10.2 Option F, stated

**Keep `qty` as `integer`. Add `uom NOT NULL` to the three ledger tables with a
CHECK-constrained vocabulary including mass and volume base units, and store each row in
its own stated base unit.**

The precedent is already one table away: `procurement_document_lines` pairs `qty` with a
`NOT NULL uom`. F adopts the pairing and drops the `numeric`.

Why it beat `numeric(12,3)` on every lens:

- **Conservation is exact.** Under integer arithmetic `before + change = after` holds
  exactly, so `valid_quantity_after` starts meaning what it claims. Under
  `numeric(12,3)` that CHECK **passes over both the create and the destroy case** (§10.4)
  — the ledger's flagship integrity constraint certifies its own corruption.
- **It rebuilds nothing.** Counted, not estimated: 0 columns altered, 0 of 9 views
  dropped, 0 of 93 functions resignatured, 0 `@IsInt()` decorators touched, 0 front-end
  inputs broken — because no column changes type. Q1 by contrast needs 8 views, **≥11
  function signatures** (not the 7 §1.4 claims — three more carry an integer *return*
  type holding a live quantity), **≥6 internal `int` locals** across
  `set_stock_absolute`, `transfer_stock`, `record_glass_pour`,
  `record_inventory_transaction` and the `log_inventory_change` trigger, and **15**
  `@IsInt()` fields across 5 files (not 14 across 4).
- **It removes the bolt-on pattern instead of generalising it.** `open_bottle_ml` exists
  only because bottles are counted, so a partial bottle needs a special column. If a
  quantity is always "current amount, in the stated base unit", a half-used flour sack is
  `12500 g` and no future item needs its own bolt-on.
- **It is more legible, not less.** A row reading `(qty: 600, uom: 'mg')` is
  self-describing to a cold reader in three years. A row reading `(qty: 0.001)` whose
  unit is an implicit convention of which table it sits in is tribal knowledge — the same
  shape as the `close_time` sprawl (102 values, 67 free text) that a closed vocabulary
  fixed.

### 10.3 The reversal, kept on the record

The longevity lens initially ranked **Q1 first** and was challenged for not applying the
rounding evidence it had been given. It revised to **F** and separated two failure modes
that this document had treated as one:

- **Floor mismatch is fixable.** A coarse base unit puts the floor at 1 g; a finer one
  removes it. This is a choice, not a property of `numeric`.
- **Repeating-decimal residue is not.** One third has no finite decimal representation at
  *any* scale, so a fixed-point column leaves a permanent residue on any equal three-way
  split forever, however many places are allowed. It needs remainder-safe integer
  allocation (333 + 333 + 334) or a tolerance rule. `valid_quantity_after` has neither.

It also conceded it had argued against F using the very precedent that supports it. **F
does not escape the residue mode for free** — it needs remainder-safe allocation in the
write path — but the error is then bounded by one atomic unit, where under a coarse Q1
floor a 1 g residue against a 0.6 g saffron receipt is a **167% error on the transaction
itself**.

### 10.4 The finding to read before anything else

Executed directly in production Postgres, not simulated:

| Operation | Stored | Physical consequence |
|---|---|---|
| receive 0.6 g saffron | `0.001` | **0.4 g created from nothing** (67% of the movement) |
| pour 0.6 g from a 1.000 kg lot | `0.999` | **0.4 g destroyed** |
| 1.000 depleted in three 0.333 draws | `0.001` | permanent residue lot, never depletes, never deletes |
| a real 0.4 g movement | `0.000` | trips the nonzero CHECK; a legitimate movement is rejected |

`valid_quantity_after` passes in **both** the create and the destroy case, because
`v_before` is always exactly 3dp, which makes the rounding translation-invariant.

Then the money. `inventory_lot_rollup`'s weighted-average cost is guarded only by
`sum(qty) > 0`. With `integer` the divisor floors at 1. With `numeric` the `0.001`
residue above passes that guard and becomes the divisor — **WAC inflated ~1000×**,
feeding COGS and menu pricing through three services that call it "a real measurement".

The premortem's verdict on this stands as the audit's headline: every other failure in
the set is eventually caught by something a restaurant already does — a physical count, a
UI glance, a month-end reconciliation. **This one has no catch mechanism anywhere in the
stack**, lies dormant at today's 2 lots, and fires when the founder is scaling and least
likely to be auditing rounding artefacts. It will be **misdiagnosed as theft or waste
before anyone suspects arithmetic**, and a stored `0.999` cannot tell you afterwards
whether the truth was 0.9994 or 0.9990.

### 10.5 F's own failure mode, and its fix

The premortem found it: **`uom NOT NULL` requires *a* unit, not a *consistent* one.** The
same flour logged in `g` on one delivery and `kg` on the next makes
`trg_project_stock_from_lots`' `SUM(qty)` add 25 to 25000 and project a nonsense on-hand
figure. No constraint violation, no error.

It is also the only failure in the entire audit with a one-query detector:

```sql
SELECT item_id, COUNT(DISTINCT uom) FROM inventory_lots
GROUP BY item_id HAVING COUNT(DISTINCT uom) > 1;
```

**Therefore F must carry a per-item canonical unit, not per-row freedom** — the unit
belongs to the item, and lot rows must match it. That refinement is part of the option,
not an optimisation of it.

### 10.6 Identity — genuinely unresolved, and it does not block F

**A** places 1st or 2nd on every lens that ranked it. **C** has the higher ceiling —
best query shape, a real FK, and the only option that gives a future transformation table
something solid to point at — and the worst floor, 5th on premortem. The disagreement is
principled and neither lens is wrong: C is structurally better but forces a food identity
key to exist while `FOOD-REASONING-GRAPH`:288 records food L0 as **unfalsifiable**, and
that mistake would not surface until L2 recipe costing is built on top of it.

The §8 argument that killed C — that a supertype forces an identity model up front — was
itself refuted: `master_wine_library.id` is a **surrogate uuid** and its `identity_key`
arrived twelve days later, so this codebase has already iterated an identity model on top
of an existing table. C is revivable. It is not thereby correct.

**F is additive and touches no identity column, so shipping F decides nothing here.**

### 10.7 What no option delivers, and what breaks first regardless

- **No option provides L2.** There is no transformation primitive anywhere — no
  `parent_lot_id`, no input→output link. "10 kg whole carrot → 7 kg peeled" is two
  unrelated transactions under every option including F. The keystone stays unbuilt until
  it is designed deliberately.
- **The receiving door is broken today and no ledger option fixes it.** The intake `uom`
  CHECK is `{bottle, case, keg, pack, split_case, each, liter}` — **no mass unit at all**
  — so a receiver cannot select "kg" for a flour delivery. Past that, `@IsInt()` rejects
  `4.5` before it reaches the `numeric(12,3)` column that would hold it fine. This is the
  first wall an operator hits under **any** decision, and it sits outside OD-113's scope.
- **The 1-gram floor bites narrowly but really**: saffron at 0.1–0.5 g doses, truffle at
  2–5 g, vanilla, gold leaf. Flour, carrots and proteins do not care. The auditor stated
  plainly that the dosing figures are general culinary knowledge, not this repo's data.

### 10.8 What the audit could not do

Four of five auditors reasoned from the shared fact base rather than re-querying
production; the row counts, rounding results, unit vocabularies and WAC guard in that
base were verified directly against live Postgres before the audit ran. The blast-radius
lens **declared its own gap**: it swept the quantity axis only, so A and C's gateway-query
surface is unmeasured — which is precisely the evidence the A-versus-C fork would need.
Its gateway file count (29–30 of 339 non-spec) is ~2.5× this document's claimed 12 and it
could not reconstruct the methodology behind 12; both numbers are recorded rather than
one being picked. No auditor benchmarked the projection trigger or ran a `numeric`
migration locally. `services/` (Python) was swept by nobody.

### 10.9 The question that is actually left

> **Ratify F — integer quantities with a CHECK-constrained `uom NOT NULL` and a per-item
> canonical unit — and keep the identity axis (A vs C) open until food L0 is answerable?**

Choosing F is not a way of deferring. It is the only quantity option that restores the
ledger's own integrity constraint to being true, and it is the cheapest by measurement.
Deferring identity remains deliberate rather than accidental, and A-vs-C should not be
taken until the blast-radius gap in §10.8 is filled.
