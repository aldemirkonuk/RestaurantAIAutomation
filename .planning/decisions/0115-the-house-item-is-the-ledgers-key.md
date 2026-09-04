# 0115 — The house item is the ledger's key, and it is the row the house already has

- **Status:** Proposed — the founder locks. Migration written and **NOT applied**; no app code changed.
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** OD-113, identity axis, ledger, house item, restaurant_inventory, master_wine_id, beverages, uom, kind, stock, par, counts, orders, non-wine, keg
- **Links:** [[0070-a-quantity-states-its-own-unit]] (the quantity axis; this is the identity axis it parked),
  [[0108-a-register-is-the-houses-own-books-first]], [[0016-ledgers-must-express-unknown]],
  [[0030-pos-mapping-inventory-integrity]], [[0051-rebuilt-pages-show-live-data-only]],
  [[0072-schema-parity-sees-what-it-claims]], [[0076-a-repoint-names-the-referencing-column]],
  OD-113 in `OPEN-DECISIONS.md:68`,
  `supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql`,
  `scripts/check_house_item_invariants.py`,
  `.planning/06-pages/wines.md` §13, `.planning/06-pages/inventory.md` §13

## Context

The founder decided the identity axis on 2026-09-03, on the cellar's question:
**one house item id across all beverages.** A house item is the key for stock,
par, counts and orders; a wine row keeps its library link as an *attribute*.
ADR 0070 locked the quantity axis on 2026-09-02 and parked this one explicitly
(`0070…md`, "What was NOT decided": *"The identity axis (A vs C) stays open"*).

What made it urgent: six of the seven cellar registers can carry no On hand, no
par, no reorder and no count. The reason is two lines of DDL —
`restaurant_inventory.master_wine_id uuid NOT NULL`
(`supabase/migrations/20260805000000_baseline_from_production.sql:3262`) and
`UNIQUE (restaurant_id, master_wine_id)` (`…:7672`). To have a stock row you
must be a wine. `public.beverages` has no `restaurant_id` at all
(`supabase/migrations/20260817070000_beverages_table.sql:217`), so a keg has no
tenant-scoped row of any kind, and the platform holds five unjoinable records of
it (ADR 0108). The surfaces say so out loud rather than faking a zero —
`house-record.ts:176` types `available: false` as a literal and `:183` carries
the sentence — and `.planning/06-pages/wines.md:841` draws two expander cards
hatched for the same reason.

### What was measured, and where

Production (`Restaurant_Wine_Ops`, project `exzueerziesmczwlhomd`, read-only
through the Supabase connector, 2026-09-03):

| Table | Rows |
|---|---|
| `restaurant_inventory` | **206** (0 soft-deleted, across **7** restaurants, **199** distinct `master_wine_id`) |
| `master_wine_library` | 4 226 |
| `beverages` | **608**, 13 `beverage_type` values, **no `restaurant_id` column** |
| `inventory_lots` | 138 |
| `inventory_transactions` | 215 |
| `pour_events` | 72 |
| `wine_consumption_log` | 107 |
| `pos_unresolved_lines` | 130 |
| `pos_item_mappings` | 254 — **239** carry `inventory_id`, only **107** carry `master_wine_id` |
| `procurement_order_items` | 1 |
| `menu_items` | 342 |
| `cocktails` / `cocktail_ingredients` | 55 / **0** |
| `procurement_document_lines`, `vendor_price_observations`, `sales_events`, `sku_mappings`, `toast_item_mappings`, `glass_pour_tracking` | **0** |

Three of those numbers decide the shape:

1. **All 206 `restaurant_inventory` rows resolve to a `master_wine_library`
   row; none has a NULL `master_wine_id`.** So a backfill is exact, not a guess.
2. **`unit_type` is `BOTTLE` on all 206 rows**, and the CHECK vocabulary is
   `{BOTTLE, CASE, SHOT, GLASS}` (`…baseline…:3324`) — no keg, no case of cola.
3. **The POS bridge already keys on `inventory_id`, not on the wine.** 239 of
   254 mappings carry one; fewer than half carry a `master_wine_id`.

### The blast radius, measured from `pg_constraint`, not from the migrations

**18 foreign keys point at `restaurant_inventory.id`**, across 17 tables
(`pos_unresolved_lines` has two):

`glass_pour_tracking`, `inventory_lots`, `menu_price_versions`,
`photo_count_suggestions`, `pos_catalog_match_proposals(candidate_inventory_id)`,
`pos_item_mappings`, `pos_unresolved_lines(mapped_inventory_id)`,
`pos_unresolved_lines(resolved_inventory_id)`, `pricing_analyses`,
`procurement_order_items`, `procurement_orders`, `recurring_orders`,
`rfq_requests`, `sales_events`, `sku_mappings`, `stock_counts`,
`toast_item_mappings`, `wine_consumption_log`.

**21 foreign keys point at `master_wine_library.id`**: `cocktail_ingredients`,
`enrichment_queue`, `inventory_events`, `master_wine_library(superseded_by)`,
`master_wine_library_submissions`, `menu_items`, `one_tap_actions`,
`pos_catalog_match_proposals`, `pos_item_mappings`, `price_history`,
`procurement_order_items`, `restaurant_inventory`, `sku_mappings`,
`toast_item_mappings`, `trending_wines`, `vintage_substitution_rules`,
`wine_aliases`, `wine_menu_prices`, `wine_merge_log`, `wine_popularity`,
`wine_repair_log`.

**And the part a migration-grep misses, which is the important half.** The four
hottest ledger tables reference these keys **by convention, with no foreign key
at all**, so a dependency analysis reports them as *not dependent*:

| Column | Nullable | FK |
|---|---|---|
| `inventory_lots.master_wine_id` | NO | **none** |
| `inventory_transactions.wine_id` | NO | **none** |
| `inventory_transactions.inventory_id` | NO | **none** |
| `pour_events.inventory_id` | NO | **none** |
| `pour_events.master_wine_id` | YES | **none** |
| `inventory_alert_state.inventory_id` | NO | **none** |
| `inventory_lot_revaluations.inventory_id` | NO | **none** |

This is the repo's cardinal fault sitting in the blast radius itself: any tool
that plans a cut-over from `pg_constraint` will certify the ledger as untouched.
The guard, not the database, is the enforcement here — and that is why
`scripts/check_house_item_invariants.py` exists and why it is written before the
build rather than after it.

Code side, counted rather than estimated: **199 occurrences of
`restaurant_inventory` across 59 gateway files**, 43 gateway files naming
`master_wine_id`, 13 web files, 35 files under `services/`, **19 database
functions** and **6 views**. `total public tables: 224`.

## Options considered

### H1 — a new `house_items` table (the shape the brief proposed)

`house_items(id, restaurant_id, kind, display_name, uom, master_wine_id,
beverage_id, provenance, timestamps)`; `house_item_id` added to
`restaurant_inventory` and to every dependent; dual-write; readers switched
register by register; the old key dropped.

**Why it appeals, honestly.** It gives identity its own noun. `restaurant_inventory`
is a 64-column wine row — `pour_size_ml`, `glasses_per_bottle_override`,
`bottle_size_ml`, `wine_name`, `menu_price_glass`, `sale_type CHECK
{bottle,glass,both}` — and a sack of flour has no business carrying any of it.
It comes with no legacy defaults to fight. And it separates identity from a
**projection**: `restaurant_inventory.stock_live` is written by the trigger
`project_stock_from_lots` out of `inventory_lots`, which is exactly what
`INVENTORY_SOTA_PLAN.md` §6a demands ("lots as the single source of truth"), so
welding identity onto that table welds it onto a derived figure.

**What it costs, measured.** 18 FK dependents to widen, a `house_item_id` on each,
and a **dual-write window** across 199 gateway sites, 19 database functions and
6 views. During that window every write path must set both keys, and a path that
forgets one produces a row that looks correct and is invisible to half the
readers — the exact failure this repo is least able to detect. The data cost is
206 rows; the whole cost is code.

### H2 — `beverages` becomes the parent, wine becomes a beverages row

**Refused on four independent grounds, each measured.** (1) `beverages` has no
`restaurant_id` (`20260817070000:217`) — it is a shared reference catalogue of
608 global rows. (2) ADR 0108 already refused a tenant write path into it,
because identity there is set by the trigger `set_beverage_identity` (verified
live) and a tenant insert would be a second writer for somebody else's table.
(3) Wine would have to move: 4 226 library rows against 608 catalogue rows, with
**21 foreign keys** pointing at `master_wine_library`. Either the wine catalogue
is duplicated — two homes for one identity, the fault ADR 0108 §2 rejected by
name — or wine stays out, which defeats "one id across all beverages". (4)
`beverages.superseded_by` merge semantics operate on the shared catalogue, so a
merge somebody else performs would move this house's stock.

### H3 — the house item is `restaurant_inventory.id`; the row stops being a wine

Relax the wine key in place: `master_wine_id` becomes nullable, and the row
gains `kind`, `uom`, `display_name`, `beverage_id` and `identity_provenance`.
The id it already has **is** the house item id. **What was built and proposed.**

### H4 — per-register stock tables (`beer_stock`, `whiskey_stock`, …)

Costs the decision itself: seven registers means seven ledgers, seven low-stock
producers, seven count paths, and a POS mapping that must know which table a
till line lands in. Every cross-register question ("what is the whole cellar
worth") becomes a seven-way union that a new register silently breaks by being
absent from it. Refused.

### H5 — wine-only: do nothing, keep the register catalogue-first

Costs nothing to build and keeps every sentence in ADR 0108 true. It also means
`/beer`, `/whiskey`, `/spirits`, `/cocktails`, `/non-alcoholic` and
`/soft-drinks` never gain a count, a par or a reorder, and the two hatched
expander cards (`wines.md:841`) stay hatched forever. The founder has decided
against it; it is recorded because "do nothing" is always an option and its
price should be on the page.

## Decision

**The house item is `restaurant_inventory.id`. The row stops being a wine: it
carries a `kind` and a `uom` of its own, `master_wine_id` becomes a nullable
attribute rather than the key, and a `house_items` view gives the noun its
name.**

Four things carried it, in order of weight.

**1. The founder's four nouns are already keyed on this row, measured.** Stock is
`restaurant_inventory.stock_live`; par is `restaurant_inventory.threshold_min`;
counts are `stock_counts.inventory_id`; orders are
`procurement_order_items.inventory_id`, `procurement_orders.inventory_id`,
`recurring_orders.inventory_id` and `rfq_requests.inventory_id`. The POS bridge
maps to `inventory_id` on 239 of 254 rows. **The house item id the decision asks
for already exists and is already the key for all four.** The only thing keeping
a keg out of it is `master_wine_id NOT NULL` and nothing else. H1 would build a
second key beside a key that already does the job.

**2. The relaxation was measured, not reasoned, and it breaks nothing.** Executed
in a full local build of all 112 migration files (0 failures), inside a
transaction, then rolled back:

- `ALTER … DROP NOT NULL` on `restaurant_inventory.master_wine_id` succeeds.
- **Two rows with a NULL `master_wine_id` insert cleanly for the same
  restaurant.** The existing `UNIQUE (restaurant_id, master_wine_id)` treats
  NULLs as distinct, so it keeps its exactly-one-row-per-wine guarantee *and*
  admits unlimited non-wine rows with no constraint change at all.
- `project_stock_from_lots` keys on `inventory_id` alone (verified from
  `pg_get_functiondef`) — untouched.
- `sync_sku_to_new_inventory` does `SELECT sku INTO NEW.sku FROM
  master_wine_library WHERE id = NEW.master_wine_id`; with a NULL it sets NULL
  and **does not raise**.
- **`unit_type` defaults to `BOTTLE` on the inserted keg.** Measured. That is the
  one real hazard and §"Invariants" answers it.

**3. There is no dual-write window, so there is no window in which a row can be
half-written.** No FK is repointed, no reader is switched, no path writes two
keys. The 199 gateway sites keep working for wine unchanged and start working
for non-wine. The one silent-drop hazard a PostgREST codebase has here —
an `!inner` embed on the library, which would delete every non-wine row from a
list without an error — was measured at **zero**: `grep -rn
"master_wine_library!inner" apps/api-gateway/src` returns 0 of 15 `!inner`
embeds in the gateway.

**4. It inherits a security posture that a new table would have to re-earn.**
`restaurant_inventory` has RLS enabled, one policy, and **no grants to `anon` or
`authenticated`** — measured. Under OD-72/OD-73 a new tenant table must argue
all of that from scratch.

ADR 0070 chose the quantity axis on the same reasoning and said so: *"It rebuilds
nothing."* This is that argument applied to identity.

### The honest counter-argument, and why it loses

**H1's projection argument is the strongest thing said against this decision, and
it is not wrong.** `restaurant_inventory.stock_live` is written by a trigger out
of `inventory_lots`; `INVENTORY_SOTA_PLAN.md` §6a wants lots to be the source of
truth and this column to be derived. Making the projection table the identity
table couples the noun to a number that is supposed to be demoted.

It loses on two counts. First, `restaurant_inventory` is not *only* a projection:
it holds `threshold_min` (par), `provider_id`, `storage_location_id`,
`menu_section`, `custom_price`, `target_price` and `sku` — it is the item card,
with a projected figure printed on it. The SOTA plan demotes the **column**, not
the row, and `inventory_lots.inventory_id` already makes a lot hang off this row,
so identity is where it is either way. Second, and decisively: the cure H1
prescribes is a dual-write window across 199 call sites and 19 database
functions, in a codebase whose named cardinal fault is a system reporting absence
as health. Trading a naming problem for a period in which half the readers cannot
see half the rows is the wrong trade. If the noun matters — and it does — the
`house_items` **view** buys it for nothing, and phase 3 can rename the table with
a compatibility view in the other direction once nothing is moving.

### What this decision explicitly does not do

It does not unify wine's *library* facts with anything. 21 tables keep pointing
at `master_wine_library` for grape, region and vintage, and they should. What
stops being true is that `master_wine_id` is the key for **stock, par, counts
and orders** — and the only two places it still is, are relaxed in phase 1.

## The shape

On `public.restaurant_inventory`:

| Column | Type | Notes |
|---|---|---|
| `kind` | `text NOT NULL` | CHECK `{wine, beer, whiskey, spirit, liqueur, cocktail, sake, cider, non_alcoholic, soft_drink, food, supply, other}`. **No DEFAULT** — a default is how a keg becomes a bottle. |
| `uom` | `text NOT NULL` | CHECK: the container units `{bottle, case, keg, pack, each, glass, shot}` plus ADR 0070's base units `{ml, l, mg, g, kg}`. **No DEFAULT.** |
| `display_name` | `text NOT NULL` | Backfilled `coalesce(nullif(btrim(wine_name),''), library.name)` — measured to cover all 206 rows (53 have a blank `wine_name`; all 206 resolve to a named library row). |
| `beverage_id` | `uuid NULL REFERENCES public.beverages(id) ON DELETE SET NULL` | The catalogue link for a non-wine. Deleting a catalogue row must never delete a house's stock. |
| `identity_provenance` | `text NOT NULL` | CHECK `{wine_library, beverage_catalogue, house_declared, backfill}`. Says how this row got its name. |
| `master_wine_id` | `uuid` — **nullable** | Was the key; becomes an attribute, per the decision. |

Relaxed with it, because a non-wine lot and a non-wine movement are otherwise
unwritable: `inventory_lots.master_wine_id` and `inventory_transactions.wine_id`
lose `NOT NULL`. Neither has a foreign key, so nothing was enforcing them anyway.

**A `BEFORE INSERT` trigger instead of a default.** `set_house_item_identity()`:
if `kind` is null **and** `master_wine_id` is not null, the row is a wine and the
three columns are derived (`wine`, `bottle`, `wine_library`); if `kind` is null
and there is no library link, it **raises**. So every existing insert path keeps
working untouched, and the only thing that fails loudly is the case nobody can
interpret — a row with no library link and no declared kind. This is what lets
the three new columns be `NOT NULL` from the first migration without a
five-hundred on the add-wine path.

**Two partial unique indexes** so a non-wine cannot silently duplicate: on
`(restaurant_id, beverage_id) WHERE beverage_id IS NOT NULL AND deleted_at IS
NULL`, and on `(restaurant_id, lower(display_name)) WHERE master_wine_id IS NULL
AND beverage_id IS NULL AND deleted_at IS NULL`. The existing UNIQUE keeps wine.

**`public.house_items`**, a view over the table with `security_invoker = true` —
without that flag a view runs with the definer's rights and would bypass the
table's RLS. Revoked from `anon`/`authenticated`, granted to `service_role`.

## The cut-over, in three phases, each with its rollback

**Phase 1 — additive, written and NOT applied
(`20260903171000_the_house_item_is_the_ledgers_key.sql`).** Everything in §The
shape. No app code changes. No FK is repointed and no reader is switched.
*Rollback:* `DELETE FROM restaurant_inventory WHERE master_wine_id IS NULL`, then
`SET NOT NULL`, then drop the five columns, the trigger, the two indexes and the
view. Reversible **only while no non-wine row exists**, which is true for exactly
as long as phase 2 has not shipped. Stated because it is the phase boundary that
matters.

**Phase 2 — teach the write paths (a separate dispatch, app code).** In order:

1. `apps/api-gateway/src/inventory/inventory.service.ts:69` — `row.master_wine_library?.bottle_size_ml ?? 750`
   invents a 750 ml bottle for any row with no library link. It must become an em
   dash. **This is the one line that turns the migration from safe into
   dangerous if it ships alone**, and it is why the migration is gated.
2. `apps/api-gateway/src/database/database.service.ts:46` — the embed is a LEFT
   join and returns `master_wine_library: null` for a keg; every consumer of that
   shape must be read.
3. An add-a-non-wine write path that supplies `kind`, `uom`, `display_name` and
   `identity_provenance`, and the intake vocabulary widened to match (ADR 0070's
   "explicitly out of scope, and blocking the same goal" — the receiving door's
   `uom` CHECK still has no mass unit and 15 `@IsInt()` fields still reject 4.5).
4. `unit_type` documented as superseded by `uom` and stopped being read.
5. `low-stock-alerts.service.ts:683-690` already reads `stock_live` and
   `threshold_min` off whatever row it is given — it needs no change, and that is
   the point.

*Rollback:* revert the code; the schema stays, because the schema is additive.

**Phase 3 — drop the old key (a separate dispatch, gated on a green guard for a
measured period).** `inventory_lots.master_wine_id` and
`inventory_transactions.wine_id` resolve through `inventory_id` and are dropped.
Consider renaming the table to `house_items` with a compatibility view named
`restaurant_inventory` in the other direction. *Rollback:* re-add the columns and
repopulate from `restaurant_inventory` through `inventory_id` — possible because
the join exists; this is the phase to sequence last for that reason.

## The invariants a guard must hold

`scripts/check_house_item_invariants.py`, exit 0 pass / 1 fail / **2 when it
cannot check** — because a guard that cannot reach the database and prints PASS
is the fault this repo is named for.

1. **Every stock row keys on a house item.** Every `inventory_lots`,
   `inventory_transactions`, `pour_events`, `stock_counts`, `pos_item_mappings`,
   `inventory_alert_state`, `inventory_lot_revaluations` and
   `wine_consumption_log` row whose `inventory_id` is set resolves to a
   `restaurant_inventory` row. **Four of those eight — `inventory_transactions`,
   `pour_events`, `inventory_alert_state`, `inventory_lot_revaluations` — carry
   no foreign key on `inventory_id` at all** (re-measured 2026-09-04 against the
   full local build, correcting an earlier draft of this line that said "four of
   those five", which was this number attached to the wrong denominator). For
   those four the guard is the only enforcement that has ever existed.
2. **No house item without a kind and a uom.** `kind IS NOT NULL AND uom IS NOT
   NULL` on every row, and neither column has a `DEFAULT` in the catalogue — a
   default reintroduces exactly the silent characterisation the CHECK removes.
3. **Every POS mapping resolves to a house item.** `pos_item_mappings.inventory_id`
   either NULL or resolving; and no mapping carries a `master_wine_id` whose
   `restaurant_inventory` row it does not also point at.
4. **`beverage_house_key` is still not written to any row** — ADR 0108's one
   forbidden abuse, checked here because this is the migration that gives a
   non-wine a row to write it to.
5. **The identity link is consistent**: no row carries both a `master_wine_id`
   and a `beverage_id`; a row with `kind = 'wine'` has a `master_wine_id`; a row
   whose `identity_provenance` is `wine_library` has one too.
6. **The view is `security_invoker`.** A `house_items` view without it is a
   cross-tenant read.

The guard is **not wired into CI by this ADR** — the parent does that at lock
time, because a blocking guard against a migration that has not been applied
would fail every build.

## What this unlocks

- **The cellar's two withheld cards** (`wines.md:841`) — *Live vs shadow* and
  *Par and reorder* — stop being hatched. Both are arithmetic over `stock_live`
  and `threshold_min`, which a non-wine row now has.
- **"Count into the cellar"** (`house-record.ts:176`, `:183`) stops being a
  disabled control with a sentence. `available` is typed as a literal `false`
  precisely so a future build cannot flip it without deleting the sentence — this
  ADR is the deletion, and it must happen in the same change as the write path.
- **Low-stock notifications for non-wine, with no new producer.**
  `low-stock-alerts.service.ts:683-690` reads `stock_live` and `threshold_min`
  from the row it is handed and keys on `inventoryId`; a keg with a par gets
  alerts the day it has a row.
- **`pos_unresolved_lines` stops being the only sales ledger for non-wine.**
  ADR 0108 called this "the largest thing this pass found": every non-wine sale
  lands there because `restaurant_inventory` is a wine table. 130 rows in
  production today, invisible to `/reports` and the analytics engine. Once a keg
  has a row, those lines can resolve into it.
- **ADR 0108's own "easier later" clause comes due**: `house_beverage_ledger`
  already names every non-wine product a house touches, with its invoice history
  — which is most of the input a stocking backfill needs.

## Consequences

**Easier.** The founder's four nouns work for every register with no second key.
Food becomes representable end to end once ADR 0070's `uom` is on the item, which
it now is. `/menu` unblocks (`wines.md:1546` held it on OD-113). Deadstock and
velocity on a non-wine row become arithmetic rather than a wait.

**Harder, or given up.** The table keeps its name and its 64 wine-shaped columns
until phase 3; a keg row carries `pour_size_ml` and `glasses_per_bottle_override`
and means nothing by them. "House item" and "stock row" are the same object, so a
product the house knows about but does not stock needs a row with zero on hand
(`is_active` and `is_optional_tracking` already exist for that, and a zero row
for a thing you have bought is arguably the truth). And a merge of two library
wines now moves a house item, not just a wine — `20260902160000_merge_repoints_by_referenced_column.sql`
and ADR 0076 must be re-read before the first non-wine merge.

**Given up deliberately: enforcement by the database.** Four of the five ledger
tables have no foreign key to `restaurant_inventory`, so the invariant "every
stock row keys on a house item" is held by a script. That was already true before
this decision; this ADR is the first document to say so.

**Supersedes, by retire-to-write.** `INVENTORY_SOTA_PLAN.md:352` — *"Schema
early: `domain ∈ {beverage, food, supply}`, `subsection`, `subtype`, plus
type-specific attribute packs"* — is the identity paragraph this ADR replaces.
`kind` is the one axis, on the row, with a CHECK; there is no `subsection`/
`subtype` pair and no attribute pack, because `beverages.type_attributes`
(`20260817070000`) already holds category-specific attributes and a second copy
would be the two-homes fault again. `INVENTORY_SOTA_PLAN.md:134`'s
`inventory_lots(master_wine_id UUID NOT NULL, …)` is likewise superseded: phase 1
drops that NOT NULL. **That file gets no edit** — the ADR is the newer truth and
retire-to-write forbids a parallel document.

**Revisit if:** the guard's invariant 1 fails in production even once, which
means a write path is creating ledger rows against a house item that does not
exist and phase 3 must be pulled forward; **or** phase 2 finds more than a
handful of call sites that cannot tolerate a NULL `master_wine_id`, which would
be evidence that H1's separation was worth its window after all; **or** a house
needs an item it does not stock badly enough that the zero row misleads an
operator.

## Questions only the founder can answer

1. **`restaurant_inventory_master_wine_id_fkey` is `ON DELETE CASCADE`** — today,
   deleting a library wine deletes the house's stock row. If the library link is
   now an *attribute*, an attribute should probably not be able to delete the
   row. `SET NULL` keeps the stock and loses the identity; `RESTRICT` refuses the
   library delete. **Left as `CASCADE` in phase 1** because changing it is a
   behaviour change, not an additive one. Which do you want?
2. **Is the `kind` vocabulary right?** Phase 1 proposes thirteen values including
   `food` and `supply` so the ledger does not need a second migration when
   bakery arrives (`INVENTORY_SOTA_PLAN.md:338` sequences wine → beverages →
   bakery → kitchen). Adding a value later is a cheap CHECK change; getting the
   axis wrong is not.
3. **Does a house item exist before it is stocked?** Under this shape, no — the
   item *is* the stock row. ADR 0108's five-book ledger knows products the house
   has never stocked. Should a menu line or an invoice line create a zero row
   automatically, or only on an explicit "carry this"?
4. **Phase 3's rename.** Renaming `restaurant_inventory` to `house_items` is
   correct and costs a compatibility view plus a sweep of 199 call sites. Worth
   doing, or does the view alone settle it permanently?
5. **The ADR 0070 sequencing.** The receiving door still cannot express a mass
   unit (15 `@IsInt()` fields, a `uom` CHECK with no `kg`). Should phase 2 fix
   the door in the same dispatch, or is beverages-first the right cut?

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | Aldemir (founder) | Identity axis decided: **one house item id across all beverages** |
| 2026-09-03 | Design pass | Blast radius measured from `pg_constraint` on production; four unenforced ledger references found that a migration-grep and an FK sweep both miss |
| 2026-09-03 | Adversarial pass | H1 (a new `house_items` table) killed on its dual-write window after being the leading shape; H2 killed on four independent grounds; H3's own relaxation measured in a full local build (112 migrations, 0 failures) rather than reasoned |
| 2026-09-03 | — | Created — **Proposed**. Migration written and NOT applied; founder locks |
| 2026-09-04 | Migration proof | Applied inside a transaction and rolled back, against a local build of all 114 other migration files (0 failures, the file under test excluded as the control). Proven: the three `DROP NOT NULL`s take; the four new columns are `NOT NULL` with **0 defaults**; `house_items` is `security_invoker` and unreadable by `anon`/`authenticated`; both partial uniques exist; the §8 probe leaves no rows. Against seeded wine rows: the backfill fills `display_name` from the library for a blank `wine_name`, maps `unit_type='CASE'` to `uom='case'`, the legacy insert path still derives `wine`/`bottle`/`wine_library`, a declared keg keeps `beer`/`keg`, a duplicate keg name and an unknown `uom` and a both-catalogues row are each refused, and **a non-wine lot writes and projects `stock_live = 4`**. Negative control: a pre-existing row with a NULL `master_wine_id` makes §0 refuse the whole migration |
| 2026-09-04 | Guard | `scripts/check_house_item_invariants.py` written and proven: exit **2** on the unmigrated control and on an unreachable database, **1** on a stock row naming a house item that does not exist, **0** on a correct one; `--self-test` also catches a reintroduced `DEFAULT`, an inconsistent provenance, a view that lost `security_invoker` and a stored house key, inside one rolled-back transaction. Not wired into CI: the migration is gated, so a blocking guard would fail every build |
| 2026-09-04 | Correction | Invariant 1 said "four of those five" have no foreign key. Re-measured: it is **four of eight**, and the five named were the wrong denominator — `inventory_lots`, `stock_counts`, `pos_item_mappings` and `wine_consumption_log` all DO carry an `inventory_id` FK; the four without one are `inventory_transactions`, `pour_events`, `inventory_alert_state` and `inventory_lot_revaluations`. Fixed in place, per ADR 0025 |
